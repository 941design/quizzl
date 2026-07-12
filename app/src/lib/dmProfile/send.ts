/**
 * send.ts — Outbound send path for the DM profile-exchange channel (epic:
 * direct-contact-profile-exchange, story 03).
 *
 * `sendProfileRequest` / `sendProfileAnnounce` are thin orchestration over
 * already-audited primitives, mirroring `app/src/lib/pairing/pairingAck.ts
 * #sendPairingAck` exactly: `createRumor` (nostr-tools/nip59) + `sealAndWrap`
 * (`directMessages.ts`) + `new NDKEvent(ndk, wrap).publish()`, catching any
 * publish/network failure and reporting `'queued-for-retry'` rather than
 * throwing — only a malformed caller-supplied identifier (bad hex) throws,
 * since that is a caller bug a retry cannot fix.
 *
 * NDK, keys, and signer are always explicit function parameters — never a
 * module-level singleton — per architecture.md's boundary rule ("NDK, keys,
 * and signer are passed as explicit params to send/receive (never a
 * singleton), matching pairingAck.ts").
 *
 * This module is the SOLE outbound-construction chokepoint for both new
 * kinds (`DM_PROFILE_REQUEST_KIND` / `DM_PROFILE_ANNOUNCE_KIND`), which is
 * why the epic-wide privacy invariant (AC-PROF-8, CLAUDE.md's hard "never
 * broadcast profile information" rule) is enforced and tested here once
 * rather than re-asserted at every future caller (story 06's push triggers
 * reuse this module rather than re-implementing send logic):
 *
 *   1. Every outbound event is a NIP-59 gift wrap (kind-1059) addressed to
 *      exactly ONE recipient pubkey via `sealAndWrap` — never a broadcast,
 *      never an unaddressed publish. There is no code path in this module
 *      that calls any relay-publish primitive with more than one recipient
 *      or with no `'p'` tag at all.
 *   2. The profile-announce inner rumor is UNSIGNED by construction —
 *      `createRumor` (nostr-tools/nip59) computes only `id` + `pubkey`,
 *      never a `sig` (rumors are never signed; that is the entire point of
 *      a NIP-59 rumor). A signed kind-0-shaped envelope is deliberately
 *      never constructed anywhere in this module: a signed inner event
 *      handed to a recipient would be a *publishable* kind-0 a buggy/
 *      hostile recipient could launder onto a public relay as the sender's
 *      own public profile, which is exactly what CLAUDE.md's privacy
 *      invariant forbids.
 *   3. No function in this module ever imports or calls anything from
 *      `app/src/lib/contactCache.ts` / `contacts.ts` / a relay-list /
 *      any other public-facing publish primitive. The only relay traffic
 *      this module produces is the single gift-wrapped event per call.
 *
 * AC-PROF-2 (answer content + answer-time stamping): `sendProfileAnnounce`
 * runs `ensureAvatar` (`app/src/lib/avatar.ts`) on the local profile BEFORE
 * building the announce, so a Few peer can never answer `avatar: null`.
 * `updatedAt` is stamped by `kinds.ts#encodeProfileAnnounce` at THIS call
 * (answer-time) — this module never passes the local profile's own
 * last-edit timestamp through, and never re-derives or overrides the
 * timestamp the codec stamps.
 *
 * AC-PROF-12 (nameless owner defers): when `hasShareableName` is false for
 * the local profile, `sendProfileAnnounce` returns `'deferred-nameless'`
 * with ZERO I/O — checked BEFORE `ensureAvatar`/`encodeProfileAnnounce`/
 * `sealAndWrap` are ever invoked, not merely before the final publish call.
 * This is a deferred, non-error outcome (mirrors the card-share gate in
 * `shareCard.ts#getOwnShareCard`) — an onboarding user with no name yet is
 * expected, not a bug. `sendProfileRequest` has NO local-name precondition
 * at all: it never reads or requires any local profile, since a request
 * reveals only the sender's own pubkey (already known to the addressed
 * contact).
 *
 * Boundary (architecture.md): this module ONLY constructs and publishes
 * outbound wraps. It holds no inbound gating logic (that is story 04's
 * receive.ts) and no idb-keyval schedule access (that is scheduler.ts's,
 * consumed only via its exports if a later story needs to — never
 * duplicated here).
 */

import type NDK from '@nostr-dev-kit/ndk';
import { NDKEvent } from '@nostr-dev-kit/ndk';
import { createRumor } from 'nostr-tools/nip59';
import { sealAndWrap } from '@/src/lib/directMessages';
import type { UnsignedRumor } from '@/src/lib/directMessages';
import { hexToBytes } from '@/src/lib/nostrKeys';
import {
  DM_PROFILE_REQUEST_KIND,
  DM_PROFILE_ANNOUNCE_KIND,
  encodeProfileRequest,
  encodeProfileAnnounce,
} from '@/src/lib/dmProfile/kinds';
import { ensureAvatar } from '@/src/lib/avatar';
import { hasShareableName } from '@/src/lib/shareCard';
import type { UserProfile } from '@/src/types';
import { createLogger } from '@/src/lib/logger';

const logger = createLogger('dm-profile-send');

const PUBKEY_HEX_RE = /^[0-9a-f]{64}$/i;

function assertPubkeyHex(value: string, label: string): void {
  if (!PUBKEY_HEX_RE.test(value)) {
    throw new Error(`dmProfile/send: ${label} must be 64 hex characters`);
  }
}

/** Explicit key params, never a module-level singleton (architecture.md boundary rule). */
export type ProfileSendKeys = {
  /** The caller's own pubkey — becomes the inner rumor's `pubkey` field. */
  ownPubkeyHex: string;
  /**
   * The caller's own raw private key hex. Required because `sealAndWrap`
   * (`directMessages.ts`) operates on a raw key, not an `EventSigner` — the
   * same pre-existing constraint `sendPairingAck` already has.
   */
  ownPrivateKeyHex: string;
};

// ── sendProfileRequest ──────────────────────────────────────────────────

export type SendProfileRequestParams = {
  /** NDK instance used to publish the gift wrap. */
  ndk: NDK;
  /** The owner's pubkey — the request is addressed to exactly this recipient. */
  recipientPubkeyHex: string;
  keys: ProfileSendKeys;
  /**
   * Optional "only answer if your profile is newer than this" hint
   * (spec.md §4). Pass-through to `kinds.ts#encodeProfileRequest`'s own
   * `since` field; must be a strict ISO-8601 UTC timestamp when provided
   * (encodeProfileRequest throws otherwise — a caller bug, not a retryable
   * condition).
   */
  since?: string;
};

export type SendProfileRequestResult = {
  recipientPubkeyHex: string;
  result: 'sent' | 'queued-for-retry';
};

/**
 * Build and gift-wrap-send a profile-request rumor to `recipientPubkeyHex`.
 *
 * NO local-name precondition (AC-PROF-12 request half) — this function
 * never reads or requires any local profile; requesting reveals only the
 * caller's own pubkey, already known to the addressed contact.
 *
 * Malformed `recipientPubkeyHex`/`keys.ownPubkeyHex`/`keys.ownPrivateKeyHex`
 * throw immediately (a caller bug a retry cannot fix). Any other failure —
 * signer unavailable, offline, relay rejection, a malformed `since` — is
 * caught and reported as `'queued-for-retry'`. `recipientPubkeyHex` is
 * defensively lowercased before use in the wrap's `'p'` tag and the
 * `sealAndWrap` call (architecture.md's case-folding rule) so a mixed/
 * upper-case input can never produce an undeliverable wrap.
 */
export async function sendProfileRequest(params: SendProfileRequestParams): Promise<SendProfileRequestResult> {
  assertPubkeyHex(params.recipientPubkeyHex, 'recipientPubkeyHex');
  // Own-key hex is validated here too (not just recipientPubkeyHex) so a
  // malformed own key is a synchronous caller-bug throw rather than falling
  // into the try below and masquerading as a transient 'queued-for-retry' —
  // a malformed key can never self-correct on retry (gate-remediation, sev 2).
  assertPubkeyHex(params.keys.ownPubkeyHex, 'keys.ownPubkeyHex');
  assertPubkeyHex(params.keys.ownPrivateKeyHex, 'keys.ownPrivateKeyHex');

  // Defensive lowercase (architecture.md: "Pubkey map-keys are case-folded
  // defensively at every read/write site") — PUBKEY_HEX_RE is
  // case-insensitive, so a mixed/upper-case recipient would otherwise flow
  // into the wrap's 'p' tag verbatim. The recipient's watcher subscribes
  // with an exact-string-matched, lowercased '#p' filter (story 05), so an
  // un-folded tag would silently make the wrap undeliverable while this
  // function still reports 'sent' (gate-remediation, sev 4).
  const recipient = params.recipientPubkeyHex.toLowerCase();

  try {
    const content = encodeProfileRequest(params.since !== undefined ? { since: params.since } : undefined);
    const rumor = createRumor(
      {
        kind: DM_PROFILE_REQUEST_KIND,
        content,
        tags: [['p', recipient]],
        created_at: Math.floor(Date.now() / 1000),
        pubkey: params.keys.ownPubkeyHex,
      },
      hexToBytes(params.keys.ownPrivateKeyHex),
    ) as UnsignedRumor;
    const wrap = await sealAndWrap(rumor, recipient, params.keys.ownPrivateKeyHex);
    const ndkEvent = new NDKEvent(params.ndk, wrap as any);
    await ndkEvent.publish();
    return { recipientPubkeyHex: params.recipientPubkeyHex, result: 'sent' };
  } catch (err) {
    logger.info('dm-profile:request-send-failed', { recipientPubkeyHex: params.recipientPubkeyHex });
    return { recipientPubkeyHex: params.recipientPubkeyHex, result: 'queued-for-retry' };
  }
}

// ── sendProfileAnnounce ──────────────────────────────────────────────────

export type SendProfileAnnounceParams = {
  /** NDK instance used to publish the gift wrap. */
  ndk: NDK;
  /** The requester's pubkey — the announce is addressed to exactly this recipient. */
  recipientPubkeyHex: string;
  keys: ProfileSendKeys;
  /**
   * The caller's current local profile, BEFORE `ensureAvatar` backfill —
   * this function runs `ensureAvatar` itself, so callers must not
   * pre-backfill or double-apply it.
   */
  localProfile: UserProfile;
};

export type SendProfileAnnounceResult =
  | { recipientPubkeyHex: string; result: 'sent' }
  | { recipientPubkeyHex: string; result: 'queued-for-retry' }
  /**
   * AC-PROF-12: `hasShareableName(localProfile.nickname)` was false. Not an
   * error — a nameless (onboarding) owner defers answering until named;
   * callers should treat this as "try again once named", never surface it
   * as a failure.
   */
  | { recipientPubkeyHex: string; result: 'deferred-nameless' };

/**
 * Build and gift-wrap-send a profile-announce rumor to `recipientPubkeyHex`.
 *
 * Order (VQ-S03-005/009 — the nameless gate must short-circuit before ANY
 * I/O, not merely before the final publish call):
 *   1. Validate `recipientPubkeyHex`/`keys.ownPubkeyHex`/`keys.ownPrivateKeyHex`
 *      format — throws on any malformed input (caller bug a retry cannot
 *      fix), then defensively lowercases `recipientPubkeyHex` for use below
 *      (architecture.md's case-folding rule — a mixed/upper-case recipient
 *      would otherwise produce a wrap the recipient's lowercased `'#p'`
 *      subscription filter can never match).
 *   2. `hasShareableName(localProfile.nickname)` gate (AC-PROF-12) — returns
 *      `'deferred-nameless'` immediately when false, before `ensureAvatar`,
 *      `encodeProfileAnnounce`, or `sealAndWrap` are ever invoked.
 *   3. `ensureAvatar(localProfile)` (AC-PROF-2) — backfills a real avatar
 *      so the announce can never carry `avatar: null`.
 *   4. `encodeProfileAnnounce` (kinds.ts) — stamps `updatedAt` at THIS call
 *      (answer-time), never `localProfile`'s own last-edit time. Produces
 *      an UNSIGNED inner payload; this function never signs it and never
 *      constructs a publishable kind-0 (AC-PROF-8).
 *   5. `sealAndWrap` — gift-wraps to exactly the lowercased recipient.
 *   6. Publish via `NDKEvent`.
 *
 * Any failure from step 3 onward — signer unavailable, offline, relay
 * rejection — is caught and reported as `'queued-for-retry'`, never thrown.
 */
export async function sendProfileAnnounce(params: SendProfileAnnounceParams): Promise<SendProfileAnnounceResult> {
  assertPubkeyHex(params.recipientPubkeyHex, 'recipientPubkeyHex');
  // Own-key hex validated here too (not just recipientPubkeyHex), BEFORE the
  // nameless gate and the try below, so a malformed own key is a synchronous
  // caller-bug throw rather than surfacing later as a permanently-unfixable
  // 'queued-for-retry' (gate-remediation, sev 2).
  assertPubkeyHex(params.keys.ownPubkeyHex, 'keys.ownPubkeyHex');
  assertPubkeyHex(params.keys.ownPrivateKeyHex, 'keys.ownPrivateKeyHex');

  // Defensive lowercase (architecture.md: "Pubkey map-keys are case-folded
  // defensively at every read/write site") — see sendProfileRequest's
  // matching comment. Applies to both the wrap's 'p' tag and the
  // sealAndWrap recipient argument (gate-remediation, sev 4).
  const recipient = params.recipientPubkeyHex.toLowerCase();

  // AC-PROF-12: a nameless (onboarding) owner defers answering until named —
  // deferred, not an error. Checked BEFORE ensureAvatar/encodeProfileAnnounce/
  // sealAndWrap so this is a true no-op with zero I/O (VQ-S03-005/009), the
  // exact precondition story 04's request-gate arm relies on before calling
  // into this seam.
  if (!hasShareableName(params.localProfile.nickname)) {
    return { recipientPubkeyHex: params.recipientPubkeyHex, result: 'deferred-nameless' };
  }

  try {
    // AC-PROF-2: run ensureAvatar FIRST so this module can never answer
    // avatar:null.
    const profileWithAvatar = ensureAvatar(params.localProfile);
    const content = encodeProfileAnnounce({
      nickname: profileWithAvatar.nickname,
      avatar: profileWithAvatar.avatar,
    });
    const rumor = createRumor(
      {
        kind: DM_PROFILE_ANNOUNCE_KIND,
        content,
        tags: [['p', recipient]],
        created_at: Math.floor(Date.now() / 1000),
        pubkey: params.keys.ownPubkeyHex,
      },
      hexToBytes(params.keys.ownPrivateKeyHex),
    ) as UnsignedRumor;
    const wrap = await sealAndWrap(rumor, recipient, params.keys.ownPrivateKeyHex);
    const ndkEvent = new NDKEvent(params.ndk, wrap as any);
    await ndkEvent.publish();
    return { recipientPubkeyHex: params.recipientPubkeyHex, result: 'sent' };
  } catch (err) {
    logger.info('dm-profile:announce-send-failed', { recipientPubkeyHex: params.recipientPubkeyHex });
    return { recipientPubkeyHex: params.recipientPubkeyHex, result: 'queued-for-retry' };
  }
}
