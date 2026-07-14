/**
 * pendingIntent.ts — Scanner-side pending pairing-intent persistence + drain
 * (epic: contact-pairing-code, story S4; RD-7 in
 * specs/epic-contact-pairing-code/architecture.md).
 *
 * Owns the "when does a nameless scanner's echo actually go out" lifecycle.
 * A scanner who opens a live (unexpired) v2 pairing code but has no
 * shareable name yet (`hasShareableName(nickname) === false`) cannot sign an
 * outgoing identity card at all — `pairingAck.ts#sendPairingAck` throws for
 * exactly that reason (its own loud RD-7 name-set gate). Rather than losing
 * the pairing opportunity, this module durably persists a `{ issuerPubkey,
 * nonce, expiresAt }` pending intent (idb-keyval `few-pairing-intents`,
 * architecture.md boundary rule 7's `few-*` naming) and fires the echo later
 * — automatically, with no further user action — the moment the scanner's
 * name becomes shareable, PROVIDED the intent is still in-window
 * (AC-SCAN-6). Past the window, the intent silently degrades: no send, no
 * error, no UI surface (AC-SCAN-7).
 *
 * The exact same per-intent state machine (`processIntent` below) backs
 * THREE distinct call sites, deliberately unified into one code path so
 * "immediate send", "deferred send on name-set", and "retry on reconnect"
 * can never drift out of sync with each other:
 *
 *   1. `attemptOrQueuePairingEcho` — the scanner-import call site
 *      (`app/pages/add.tsx`) for a FRESH scan. Always persists the intent
 *      FIRST, then attempts a send if a name is already set (AC-SCAN-1,
 *      AC-SCAN-8). Persisting before attempting means a page unload racing
 *      the async send can never lose the echo (AC-SCAN-3's "never
 *      fire-and-forget" — this is the mechanism that guarantees it, not
 *      just a policy statement).
 *   2. `drainPendingIntents` — the retry queue, called by the scanner-side
 *      watcher on `window 'online'` and on app mount (AC-SCAN-3), and by
 *      `app/pages/profile.tsx`'s saveProfile chokepoint the moment
 *      `hasShareableName` flips true (AC-SCAN-6/7).
 *
 * Neither function ever imports React, storage other than idb-keyval, or any
 * app/src/context/* module — this stays a stateless adapter over the
 * `PairingAckSend` seam, matching `nonceStore.ts`'s precedent. Callers
 * (React components) inject a `PendingIntentSendContext`, resolving the NDK
 * instance + signer LAZILY (`resolveSendDeps`) so a nameless caller never
 * needs a live relay connection just to persist an intent.
 *
 * Review-remediation (sev 3, concurrency): two of this module's call sites
 * are BOTH always-mounted-or-triggered on the same event — `profile.tsx`'s
 * `hasShareableName` false->true flip effect and `PendingPairingIntentWatcher`
 * (mount + `online`) — and can race each other, each `loadPendingIntents()`-
 * ing the same not-yet-deleted intent and each calling `sendPairingAck` for
 * it before either finishes deleting it (harmless to correctness — S3's ack
 * handler is sender-idempotent, AC-ACK-3 — but a redundant relay publish).
 * `processIntent` below closes this with a per-issuer in-flight lock
 * (`inFlightByIssuer`): a second concurrent call for the SAME issuer shares
 * the first call's in-progress promise instead of starting its own
 * `sendPairingAck`, so at most one gift wrap goes out per issuer per
 * overlapping window, regardless of how many call sites raced into it.
 */

import { createStore, get, set, del, entries } from 'idb-keyval';
import type NDK from '@nostr-dev-kit/ndk';
import type { EventSigner } from 'applesauce-core';
import { sendPairingAck } from '@/src/lib/pairing/pairingAck';
import { hasShareableName } from '@/src/lib/shareCard';
import { createLogger } from '@/src/lib/logger';
// Privacy gate (gate-remediation finding 2, epic: block-contact DD-1). Reused
// verbatim, never re-implemented.
import { loadBlockedPeers, isBlockedPeer } from '@/src/lib/blockedPeers';

const logger = createLogger('pending-pairing-intent');

// ── Store ─────────────────────────────────────────────────────────────────

const pendingIntentStore = createStore('few-pairing-intents', 'intents');

function defaultNowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/** A scanner-side persisted pending pairing intent (RD-7). */
export type PendingPairingIntent = {
  /** The issuer's pubkey (hex) — where the deferred echo will be addressed. */
  issuerPubkey: string;
  /** The nonce scanned from the issuer's live code, echoed back verbatim. */
  nonce: string;
  /** The scanned card's own `expiresAt` (unix seconds) — the pairing window's hard edge (AC-SCAN-6/7), NOT the 2h issuer-side grace (that's nonceStore's concern, evaluated on the issuer's side by isNonceAdmissible). */
  expiresAt: number;
};

/** The pure input this module needs from a freshly-parsed pairing card (mirrors processContactInput.ts's `PairingEchoCandidate`). */
export type PairingEchoCandidate = {
  issuerPubkeyHex: string;
  nonceHex: string;
  expiresAt: number;
};

// ── CRUD ──────────────────────────────────────────────────────────────────

/** Upsert a pending intent, keyed by issuer pubkey (one held intent per issuer). */
export async function savePendingIntent(intent: PendingPairingIntent): Promise<void> {
  await set(intent.issuerPubkey, intent, pendingIntentStore);
}

/** Load every currently-persisted pending intent. */
export async function loadPendingIntents(): Promise<PendingPairingIntent[]> {
  const all = await entries<string, PendingPairingIntent>(pendingIntentStore);
  return all.map(([, value]) => value);
}

export async function getPendingIntent(issuerPubkey: string): Promise<PendingPairingIntent | undefined> {
  return await get<PendingPairingIntent>(issuerPubkey, pendingIntentStore);
}

export async function deletePendingIntent(issuerPubkey: string): Promise<void> {
  await del(issuerPubkey, pendingIntentStore);
}

/** Test-only: clear every persisted intent, mirroring nonceStore.ts's `clearAllNonces` precedent. */
export async function clearPendingIntentsForTests(): Promise<void> {
  const all = await entries(pendingIntentStore);
  await Promise.all(all.map(([key]) => del(key, pendingIntentStore)));
}

// ── Window predicate (pure) ─────────────────────────────────────────────

/**
 * True iff `nowSec` is still at or before the intent's own `expiresAt`
 * (AC-SCAN-6's boundary is inclusive — `<=`, mirroring nonceStore's own
 * boundary-inclusive convention). This is the scanned card's OWN expiry, not
 * the issuer-side 2h admission grace — a scanner has no visibility into the
 * issuer's grace window and must not assume one.
 */
export function isIntentInWindow(intent: PendingPairingIntent, nowSec: number): boolean {
  return nowSec <= intent.expiresAt;
}

// ── Send context (lazy NDK/signer resolution) ───────────────────────────

/**
 * Everything a send attempt needs, injected by the React call site.
 * `resolveSendDeps` is only invoked once `hasShareableName(ownProfile.nickname)`
 * is true and a send is actually about to be attempted — a nameless caller
 * (the common case right after a fresh onboarding scan) never pays for an
 * NDK connect or a signer resolution it can't use yet.
 */
export type PendingIntentSendContext = {
  ownPubkeyHex: string;
  ownPrivateKeyHex: string;
  ownProfile: { nickname: string; createdAt: number };
  resolveSendDeps: () => Promise<{ ndk: NDK; signEvent: EventSigner['signEvent'] }>;
};

export type PendingIntentOutcome =
  /** Sent successfully this call — the intent has been deleted. */
  | 'sent'
  /** A name is set and in-window, but the send attempt itself failed (offline, signer error, relay rejection) — the intent remains persisted for a later retry (AC-SCAN-3). */
  | 'queued-for-retry'
  /** Still in-window, but no shareable name yet — the intent remains persisted, untouched, waiting for a future drain once a name is set. */
  | 'deferred'
  /** Past the intent's own `expiresAt` — deleted with no send attempt and no error (AC-SCAN-7). */
  | 'expired'
  /**
   * The issuer is a blocked peer (gate-remediation finding 2, epic:
   * block-contact DD-1) — the intent is deleted with NO send attempt, same
   * as `expired`. Checked at SEND time (every `processIntent` call), not
   * just at queue time, so a peer blocked AFTER an intent was queued (e.g.
   * queued while nameless/offline, blocked before a name was ever set) can
   * never receive the deferred echo/profile-announce once a name is
   * eventually set or a retry fires.
   */
  | 'droppedBlocked';

/**
 * Per-issuer in-flight lock (review-remediation, sev 3 — see file header).
 * Keyed by `issuerPubkey`; holds the in-progress `processIntentCore` promise
 * for that issuer, if any, so overlapping calls (e.g. profile.tsx's
 * name-transition effect and PendingPairingIntentWatcher's mount/online
 * drain both firing for the same held intent) coalesce into a single
 * `sendPairingAck` attempt instead of each publishing their own gift wrap.
 */
const inFlightByIssuer = new Map<string, Promise<PendingIntentOutcome>>();

/** Test-only: clear any leaked in-flight locks, mirroring nonceStore.ts's `_resetActiveNonceForTests` precedent. */
export function _clearInFlightLocksForTests(): void {
  inFlightByIssuer.clear();
}

/**
 * The single per-intent state machine shared by every call site in this
 * module (see file header). Never throws — any failure resolving send
 * dependencies or sending is caught and reported as `'queued-for-retry'`,
 * matching `sendPairingAck`'s own never-throw-for-expected-failures
 * discipline.
 *
 * Coalesces concurrent calls for the SAME `intent.issuerPubkey` via
 * `inFlightByIssuer` (review-remediation, sev 3) — a second caller racing
 * the first receives the exact same outcome the first call produces,
 * rather than independently re-attempting the send.
 */
async function processIntent(
  intent: PendingPairingIntent,
  ctx: PendingIntentSendContext,
  nowSec: number,
): Promise<PendingIntentOutcome> {
  const existing = inFlightByIssuer.get(intent.issuerPubkey);
  if (existing) return existing;

  const run = (async (): Promise<PendingIntentOutcome> => {
    try {
      return await processIntentCore(intent, ctx, nowSec);
    } finally {
      inFlightByIssuer.delete(intent.issuerPubkey);
    }
  })();
  inFlightByIssuer.set(intent.issuerPubkey, run);
  return run;
}

async function processIntentCore(
  intent: PendingPairingIntent,
  ctx: PendingIntentSendContext,
  nowSec: number,
): Promise<PendingIntentOutcome> {
  if (!isIntentInWindow(intent, nowSec)) {
    await deletePendingIntent(intent.issuerPubkey);
    return 'expired';
  }

  // Privacy gate (gate-remediation finding 2, epic: block-contact DD-1):
  // checked BEFORE sendPairingAck, on every call — not just at queue time —
  // so a producer that queued this intent before the issuer was ever blocked
  // cannot bypass the gate. A blocked issuer's held intent is dropped
  // immediately, regardless of whether a shareable name is set yet, since it
  // can never legitimately be sent.
  if (isBlockedPeer(intent.issuerPubkey, loadBlockedPeers())) {
    await deletePendingIntent(intent.issuerPubkey);
    return 'droppedBlocked';
  }

  if (!hasShareableName(ctx.ownProfile.nickname)) {
    return 'deferred';
  }

  try {
    const { ndk, signEvent } = await ctx.resolveSendDeps();
    const result = await sendPairingAck({
      ndk,
      issuerPubkeyHex: intent.issuerPubkey,
      echoedNonceHex: intent.nonce,
      ownPubkeyHex: ctx.ownPubkeyHex,
      ownPrivateKeyHex: ctx.ownPrivateKeyHex,
      ownProfile: ctx.ownProfile,
      signEvent,
    });
    if (result.result === 'sent') {
      await deletePendingIntent(intent.issuerPubkey);
      return 'sent';
    }
    return 'queued-for-retry';
  } catch (err) {
    logger.info('pending-intent:send-failed', { issuerPubkey: intent.issuerPubkey });
    return 'queued-for-retry';
  }
}

// ── Call site 1 — fresh scan (add.tsx) ──────────────────────────────────

/**
 * Persist-then-attempt entry point for a freshly-scanned pairing candidate
 * (AC-SCAN-1, AC-SCAN-5, AC-SCAN-8). ALWAYS persists the intent first — even
 * when a send is about to be attempted immediately — so an interrupted async
 * send (e.g. the page navigates away) can never silently lose the echo; the
 * retry queue (`drainPendingIntents`) picks it back up on the next online
 * event or app mount.
 *
 * Returns `'deferred'` for a nameless scanner (the caller's cue to redirect
 * to name setup, AC-SCAN-5) and `'sent'`/`'queued-for-retry'` for a named
 * one (AC-SCAN-1/8 — the caller proceeds straight to the contact either way,
 * since a failed immediate send is not a user-facing error, only a retry
 * candidate).
 */
export async function attemptOrQueuePairingEcho(
  candidate: PairingEchoCandidate,
  ctx: PendingIntentSendContext,
  now: () => number = defaultNowSec,
): Promise<PendingIntentOutcome> {
  const intent: PendingPairingIntent = {
    issuerPubkey: candidate.issuerPubkeyHex,
    nonce: candidate.nonceHex,
    expiresAt: candidate.expiresAt,
  };
  await savePendingIntent(intent);
  return processIntent(intent, ctx, now());
}

// ── Call site 2 — retry queue (online event / app mount / name-set) ────

export type DrainPendingIntentsResult = {
  sent: string[];
  retried: string[];
  droppedExpired: string[];
  deferredNoName: string[];
  /** Issuer pubkeys whose held intent was dropped because the issuer is a blocked peer (gate-remediation finding 2). */
  droppedBlocked: string[];
};

/**
 * Attempt every persisted pending intent once (AC-SCAN-3, AC-SCAN-6,
 * AC-SCAN-7). Safe to call at any time — an intent with no shareable name
 * yet is left untouched (`deferredNoName`), an expired one is silently
 * dropped (`droppedExpired`, AC-SCAN-7), and everything else is attempted
 * via the same `processIntent` core `attemptOrQueuePairingEcho` uses.
 */
export async function drainPendingIntents(
  ctx: PendingIntentSendContext,
  now: () => number = defaultNowSec,
): Promise<DrainPendingIntentsResult> {
  const nowSec = now();
  const intents = await loadPendingIntents();
  const result: DrainPendingIntentsResult = { sent: [], retried: [], droppedExpired: [], deferredNoName: [], droppedBlocked: [] };

  for (const intent of intents) {
    const outcome = await processIntent(intent, ctx, nowSec);
    switch (outcome) {
      case 'sent':
        result.sent.push(intent.issuerPubkey);
        break;
      case 'queued-for-retry':
        result.retried.push(intent.issuerPubkey);
        break;
      case 'expired':
        result.droppedExpired.push(intent.issuerPubkey);
        break;
      case 'deferred':
        result.deferredNoName.push(intent.issuerPubkey);
        break;
      case 'droppedBlocked':
        result.droppedBlocked.push(intent.issuerPubkey);
        break;
    }
  }

  return result;
}
