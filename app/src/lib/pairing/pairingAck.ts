/**
 * pairingAck.ts — Pairing-ack protocol: build, send, unwrap, sender-bind,
 * validate, and admit (epic: contact-pairing-code, story S3; RD-6 in
 * specs/epic-contact-pairing-code/architecture.md).
 *
 * Single owning module for the full ack round trip — see stories.json's S3
 * description for why "ack protocol" and "admission" are NOT split into
 * separate stories: admission (knownPeers.ts/contacts.ts) is reused as-is,
 * with no new admission-decision logic introduced anywhere else.
 *
 * SECURITY-CRITICAL. Three invariants are non-negotiable (architecture.md
 * boundary rules 2, 3, 5) and are why this module exists as pure orchestration
 * over already-audited primitives rather than reimplementing any of them:
 *
 *   1. Sender binding (AC-SEC-1, AC-SEC-2). The authenticated sender of a
 *      received ack MUST come from `directMessages.ts#unwrapAndOpen` — the
 *      ONLY primitive in this codebase that asserts `rumor.pubkey ===
 *      seal.pubkey` before returning. `welcomeSubscription.ts#unwrapGiftWrap`
 *      does NOT perform that assertion and MUST NEVER be used here. The
 *      enclosed card's claimed pubkey is admitted ONLY when it equals this
 *      authenticated sender — never the other way around, and never on its
 *      own.
 *   2. Walled-garden bypass (AC-ADMIT-4). `isAllowedDmSender` is never called
 *      from this module. Admission is gated solely by nonce-admissibility +
 *      sender-binding, mirroring `joinRequestHandler.ts`'s precedent (nonce
 *      possession is itself the trust decision — the whole point of the
 *      pairing flow is admitting a stranger the issuer has never met).
 *   3. Kind isolation (AC-SEC-3, AC-SEC-4). `PAIRING_ACK_KIND` (21060) is
 *      confirmed, by repo-wide grep immediately before landing, to collide
 *      with none of the sentinel kinds this codebase's other kind-1059
 *      consumers (`ContactChat.tsx`, `directMessageNotifications.ts`) check
 *      for (444, 21059, 5, 7, 14) — nor with 9 (chatPersistence.ts's own,
 *      differently-scoped `CHAT_MESSAGE_KIND`) or 20602 (`CARD_SIG_KIND_V2`).
 *      Those two consumers fail closed on an unrecognized kind, so a
 *      pairing-ack rumor is automatically excluded from chat rendering and
 *      the notification bell — no new exclusion code is added to either file.
 *
 * Also carries the epic-wide privacy invariant (AC-PRIV-1, architecture.md
 * boundary rule 6): no function reachable from `sendPairingAck` or
 * `handlePairingAck` ever calls a relay-publish primitive with an unaddressed
 * kind-0 event. The only outbound traffic this module produces is the single
 * gift-wrapped (kind-1059) pairing-ack addressed to one recipient pubkey.
 */

import type NDK from '@nostr-dev-kit/ndk';
import { NDKEvent } from '@nostr-dev-kit/ndk';
import { createRumor } from 'nostr-tools/nip59';
import type { EventSigner } from 'applesauce-core';
import { encodeCard, decodeCard } from '@/src/lib/contactCard';
import { hasShareableName } from '@/src/lib/shareCard';
import { sealAndWrap, unwrapAndOpen } from '@/src/lib/directMessages';
import type { UnsignedRumor } from '@/src/lib/directMessages';
import { isNonceAdmissible, pruneExpiredNonces } from '@/src/lib/pairing/nonceStore';
import { rememberKnownPeers } from '@/src/lib/knownPeers';
import { rememberContact } from '@/src/lib/contacts';
import { hexToBytes } from '@/src/lib/nostrKeys';
import { createLogger } from '@/src/lib/logger';

const logger = createLogger('pairing-ack');

// ── Kind sentinel (RD-6, AC-SEC-3) ──────────────────────────────────────────

/**
 * Fixed, non-zero rumor kind for a pairing-ack (RD-6). Confirmed via
 * repo-wide grep immediately before landing (2026-07-12):
 * `grep -rn "21060" app/src app/tests` returns zero hits prior to this
 * story. Confirmed distinct from every other in-repo kind sentinel this
 * codebase checks or defines: 444 (Welcome), 21059
 * (`JOIN_REQUEST_KIND`/`JOIN_REQUEST_RUMOR_KIND`/`CALL_GIFT_WRAP_KIND`), 5
 * (delete signal), 7 (reaction), 14 (`CHAT_MESSAGE_KIND` in
 * directMessages.ts), 9 (a differently-scoped `CHAT_MESSAGE_KIND` in
 * chatPersistence.ts), 20602 (`CARD_SIG_KIND_V2`). See AC-SEC-3.
 */
export const PAIRING_ACK_KIND = 21060 as const;

const PAIRING_ACK_SENTINEL_KINDS = [444, 21059, 5, 7, 14] as const;
if ((PAIRING_ACK_SENTINEL_KINDS as readonly number[]).includes(PAIRING_ACK_KIND)) {
  // Defense in depth: fail loudly at module load time (not just in a test) if
  // this constant is ever edited to collide with a sentinel kind.
  throw new Error('pairingAck: PAIRING_ACK_KIND collides with a reserved sentinel kind');
}

// ── Wire content shape (RD-6) ────────────────────────────────────────────

/** The pairing-ack rumor's JSON content shape (RD-6). */
export type PairingAckContent = {
  type: 'pairing-ack';
  /** The echoed issuer nonce, 32 lowercase hex chars (16 bytes). */
  nonce: string;
  /** Base64url identity-only card (contactCard.ts#encodeCard output) — never a v2/pairing card. */
  card: string;
};

function isPairingAckContent(value: unknown): value is PairingAckContent {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>).type === 'pairing-ack' &&
    typeof (value as Record<string, unknown>).nonce === 'string' &&
    typeof (value as Record<string, unknown>).card === 'string'
  );
}

// ── sendPairingAck — the PairingAckSend seam ────────────────────────────

/**
 * The `PairingAckSend` seam contract (specs/epic-contact-pairing-code/
 * stories.json) — consumed cross-story by S4's `processContactInput.ts` /
 * `pendingIntent.ts` drain.
 */
export type PairingAckSendResult = {
  issuerPubkeyHex: string;
  echoedNonceHex: string;
  result: 'sent' | 'queued-for-retry';
};

export type SendPairingAckParams = {
  /** NDK instance used to publish the gift wrap. */
  ndk: NDK;
  /** The issuer's pubkey — the ack is addressed to exactly this recipient. */
  issuerPubkeyHex: string;
  /** The nonce scanned from the issuer's card, echoed back verbatim. */
  echoedNonceHex: string;
  /** The scanner's (caller's) own pubkey — the identity the enclosed card names. */
  ownPubkeyHex: string;
  /**
   * The scanner's own raw private key hex. Required because the gift-wrap
   * primitives this module reuses (`directMessages.ts#sealAndWrap`) operate
   * on a raw key, not an `EventSigner` — the same pre-existing constraint
   * `publishDirectMessage`/`directMessageNotifications.ts` already have.
   */
  ownPrivateKeyHex: string;
  /** The scanner's own profile, used to sign the enclosed identity card. */
  ownProfile: { nickname: string; createdAt: number };
  /**
   * The scanner's active signer's `signEvent` — used only to sign the
   * enclosed identity-only card via `contactCard.ts#encodeCard`. Caller
   * resolves this the same way `shareCard.ts#getOwnShareCard` does
   * (`activeEventSignerOverride.current ?? createPrivateKeySigner(...)`);
   * this module never imports `signerAdapter` itself.
   */
  signEvent: EventSigner['signEvent'];
};

/**
 * Build and gift-wrap-send a pairing-ack rumor to `issuerPubkeyHex`.
 *
 * Exactly one gift-wrapped pairing-ack is sent per call (AC-SCAN-1's
 * mechanics half — the SCAN-side decision of whether/when to call this is
 * S4's, not this function's). The enclosed card is always built via
 * `encodeCard` (v1, identity-only) — never `encodeCardV2` — so it
 * structurally cannot carry a `pairing` field (AC-ACK-1). Never publishes a
 * kind-0 event under any circumstance (AC-PRIV-1).
 *
 * Malformed `issuerPubkeyHex`/`echoedNonceHex` throw immediately (caller
 * bugs a retry cannot fix). Any other failure — signer unavailable, offline,
 * relay rejection — is caught and reported as `'queued-for-retry'`; this
 * function does NOT persist anything itself (S4's `pendingIntent.ts` owns
 * that), it only reports whether the attempt needs a retry.
 */
const PUBKEY_HEX_RE = /^[0-9a-f]{64}$/i;
const NONCE_HEX_RE = /^[0-9a-f]{32}$/i;

export async function sendPairingAck(params: SendPairingAckParams): Promise<PairingAckSendResult> {
  // Malformed issuerPubkeyHex/echoedNonceHex are caller bugs, not retryable
  // conditions — throw immediately, before the try/catch below that only
  // guards the send attempt itself.
  if (!PUBKEY_HEX_RE.test(params.issuerPubkeyHex)) {
    throw new Error('pairingAck: issuerPubkeyHex must be 64 hex characters');
  }
  if (!NONCE_HEX_RE.test(params.echoedNonceHex)) {
    throw new Error('pairingAck: echoedNonceHex must be 32 hex characters (16 bytes)');
  }
  // Fail loudly (mirroring encodeCardV2's guard) rather than silently emit an
  // UNSIGNED identity card that the issuer's handlePairingAck would reject at
  // the signature step — that would make a nameless echo a silent no-op while
  // returning 'sent'. S4 gates the echo on hasShareableName; this is the
  // symmetric guard at the send source.
  if (!hasShareableName(params.ownProfile.nickname)) {
    throw new Error('pairingAck: sendPairingAck requires a shareable name (RD-7 name-set gate)');
  }

  try {
    // Identity-only card — encodeCard (never encodeCardV2), so the enclosed
    // card structurally cannot carry a `pairing` field (AC-ACK-1).
    const card = await encodeCard(params.ownPubkeyHex, params.ownProfile, params.signEvent);
    const content: PairingAckContent = {
      type: 'pairing-ack',
      nonce: params.echoedNonceHex,
      card,
    };
    const rumor = createRumor(
      {
        kind: PAIRING_ACK_KIND,
        content: JSON.stringify(content),
        tags: [['p', params.issuerPubkeyHex]],
        created_at: Math.floor(Date.now() / 1000),
        pubkey: params.ownPubkeyHex,
      },
      hexToBytes(params.ownPrivateKeyHex),
    ) as UnsignedRumor;
    const wrap = await sealAndWrap(rumor, params.issuerPubkeyHex, params.ownPrivateKeyHex);
    const ndkEvent = new NDKEvent(params.ndk, wrap as any);
    await ndkEvent.publish();
    return { issuerPubkeyHex: params.issuerPubkeyHex, echoedNonceHex: params.echoedNonceHex, result: 'sent' };
  } catch (err) {
    logger.info('pairing-ack:send-failed', { issuerPubkeyHex: params.issuerPubkeyHex });
    return { issuerPubkeyHex: params.issuerPubkeyHex, echoedNonceHex: params.echoedNonceHex, result: 'queued-for-retry' };
  }
}

// ── handlePairingAck — unwrap, validate, sender-bind, admit ────────────

export type HandlePairingAckResult =
  /** `giftWrapEvent` could not be unwrapped as a gift wrap addressed to us at all — not necessarily a pairing-ack (could be any foreign/malformed kind-1059). Caller should fall through to its existing dispatch. */
  | { status: 'unwrap-failed' }
  /** Unwrapped successfully, but the inner rumor's kind is not `PAIRING_ACK_KIND` — caller should fall through to its existing dispatch (e.g. Welcome/join-request). */
  | { status: 'wrong-kind' }
  /** Correct kind, but content is not valid JSON or doesn't match `PairingAckContent`'s shape. */
  | { status: 'malformed-content' }
  /** The echoed nonce is unknown or past its grace window (AC-ADMIT-2). */
  | { status: 'nonce-inadmissible' }
  /** The enclosed card failed to decode/verify (AC-ADMIT-2's "signature verifies" gate). */
  | { status: 'card-invalid' }
  /** AC-SEC-1: the enclosed card's pubkey differs from the authenticated gift-wrap sender — NEITHER pubkey is admitted. */
  | { status: 'sender-mismatch' }
  /** AC-ACK-3: this sender was already admitted via a prior pairing-ack this session — idempotent no-op. */
  | { status: 'already-admitted'; senderPubkeyHex: string }
  /** Successful admission: `rememberKnownPeers` then `rememberContact` were called for `senderPubkeyHex` (ADR-005 ordering, AC-ADMIT-1). */
  | { status: 'admitted'; senderPubkeyHex: string };

/**
 * Minimal shape `handlePairingAck` needs from an inbound kind-1059 event.
 * Callers (welcomeSubscription.ts) normalize their NDK event into this shape
 * the same way `directMessageNotifications.ts`'s kind-1059 handler already
 * does for `unwrapAndOpen`.
 */
export type GiftWrapEventLike = {
  id?: string;
  pubkey: string;
  content: string;
  created_at?: number;
  kind?: number;
  tags?: string[][];
  sig?: string;
};

/**
 * Process one received gift-wrapped pairing-ack candidate.
 *
 * Unwraps `giftWrapEvent` via `directMessages.ts#unwrapAndOpen` ONLY — never
 * `welcomeSubscription.ts#unwrapGiftWrap` (AC-SEC-2). On a genuine
 * `PAIRING_ACK_KIND` rumor: validates the echoed nonce via
 * `nonceStore.isNonceAdmissible` (called verbatim — this function never
 * re-derives the grace math), decodes and verifies the enclosed card via
 * `contactCard.ts#decodeCard`, and admits ONLY when the decoded card's
 * pubkey equals the authenticated sender (AC-SEC-1). On admission: calls
 * `pruneExpiredNonces` (AC-NONCE-6's ack-processing-pass trigger), then
 * `rememberKnownPeers([senderPubkeyHex])` strictly before
 * `rememberContact(senderPubkeyHex)` (ADR-005, AC-ADMIT-1) — WITHOUT ever
 * calling `isAllowedDmSender` (AC-ADMIT-4). Never constructs or sends a
 * further ack (AC-ACK-2). Idempotent for a sender already admitted this
 * session (AC-ACK-3).
 *
 * Never throws for any input, malformed or adversarial (mirrors
 * `decodeCard`/`unwrapAndOpen`'s own never-throw-on-bad-input discipline at
 * this module's own boundary) — always resolves to a `HandlePairingAckResult`.
 */
export async function handlePairingAck(
  giftWrapEvent: GiftWrapEventLike,
  ownPrivateKeyHex: string,
  opts?: { nowSec?: number },
): Promise<HandlePairingAckResult> {
  try {
    // Step 1: unwrap via the STRICT primitive only (AC-SEC-2) — never
    // welcomeSubscription.ts's unwrapGiftWrap.
    let rumor: UnsignedRumor;
    try {
      rumor = await unwrapAndOpen(giftWrapEvent as never, ownPrivateKeyHex);
    } catch {
      return { status: 'unwrap-failed' };
    }

    // Step 2: kind gate — caller falls through to its existing dispatch.
    if (rumor.kind !== PAIRING_ACK_KIND) {
      return { status: 'wrong-kind' };
    }

    // Step 3: parse + shape-validate content.
    let payload: PairingAckContent;
    try {
      const parsed: unknown = JSON.parse(rumor.content);
      if (!isPairingAckContent(parsed)) {
        return { status: 'malformed-content' };
      }
      payload = parsed;
    } catch {
      return { status: 'malformed-content' };
    }

    // Step 4: unconditional prune sweep (AC-NONCE-6) — this rumor genuinely
    // claims to be a pairing-ack, so the sweep runs regardless of what
    // happens next.
    const nowSec = opts?.nowSec ?? Math.floor(Date.now() / 1000);
    await pruneExpiredNonces(nowSec);

    // Step 5: nonce admissibility, called verbatim — never re-derive the
    // grace math here.
    const admissible = await isNonceAdmissible(payload.nonce, nowSec);
    if (!admissible) {
      return { status: 'nonce-inadmissible' };
    }

    // Step 6: decode + verify the enclosed identity card.
    const decoded = decodeCard(payload.card);
    if ('error' in decoded || !decoded.profile) {
      return { status: 'card-invalid' };
    }

    // Step 7: sender-binding — the AUTHENTICATED sender (rumor.pubkey, as
    // returned by unwrapAndOpen) must equal the card's claimed pubkey.
    // Neither pubkey is admitted on a mismatch (AC-SEC-1).
    if (decoded.pubkeyHex.toLowerCase() !== rumor.pubkey.toLowerCase()) {
      return { status: 'sender-mismatch' };
    }

    const senderHex = rumor.pubkey.toLowerCase();

    // Step 8: idempotency (AC-ACK-3) — the same map backs both this check
    // and the admission-digest read surface below.
    if (pairingAckAdmissions.has(senderHex)) {
      return { status: 'already-admitted', senderPubkeyHex: senderHex };
    }

    // Step 9: admit — rememberKnownPeers strictly BEFORE rememberContact
    // (ADR-005, AC-ADMIT-1). isAllowedDmSender is never called here (AC-ADMIT-4).
    rememberKnownPeers([senderHex]);
    rememberContact(senderHex);
    pairingAckAdmissions.set(senderHex, payload.nonce);
    return { status: 'admitted', senderPubkeyHex: senderHex };
  } catch (err) {
    // Defense in depth — mirrors decodeCard's/unwrapAndOpen's own
    // never-throw-on-bad-input discipline at this module's own boundary.
    logger.info('pairing-ack:handle-unexpected-error', {});
    return { status: 'malformed-content' };
  }
}

// ── Admission-digest signal (S5 consumes; S3 renders nothing) ──────────

/**
 * Session-scoped, in-memory `senderPubkeyHex -> echoedNonceHex` map of every
 * sender admitted via a pairing-ack so far this session. The single source
 * of truth backing BOTH `handlePairingAck`'s own AC-ACK-3 idempotency check
 * and the admission-digest signal S5's UI consumes for AC-UI-2 ("N people
 * paired with your code") — deliberately not a separate incrementing
 * counter that could drift from the actual admitted set. S3 renders no UI
 * itself; this is only the exposed read surface.
 *
 * Resets on page reload (in-memory only, like `nonceStore.ts`'s
 * `activeNonce` pointer). This is safe: `rememberKnownPeers`/`rememberContact`
 * are independently idempotent across reloads via their own persisted
 * stores, so a reload can never produce a duplicate contact — at most a
 * repeat ack after a reload is re-counted once in the digest signal, which
 * is a cosmetic S5 concern, not a correctness one.
 */
const pairingAckAdmissions = new Map<string, string>();

export function getPairingAckAdmissions(): ReadonlyMap<string, string> {
  return pairingAckAdmissions;
}

/** Test-only reset of the in-memory admissions map (mirrors nonceStore.ts's `_resetActiveNonceForTests`). */
export function _resetPairingAckAdmissionsForTests(): void {
  pairingAckAdmissions.clear();
}
