/**
 * Unit/integration tests for pendingIntent.ts (epic: contact-pairing-code,
 * story S4). Covers AC-SCAN-1, AC-SCAN-3, AC-SCAN-5, AC-SCAN-6, AC-SCAN-7,
 * AC-SCAN-8 (AC-SCAN-2 and AC-SCAN-4 are covered where they actually live —
 * AC-SCAN-2 in processContactInput.ts's own tests in
 * tests/unit/cards/addContactCardWiring.test.ts, since the "no pairing
 * candidate at all" decision is that module's, not this one's; AC-SCAN-4 is
 * copy text, S5's).
 *
 * Conventions mirrored from precedent in this repo:
 *   - `fake-indexeddb/auto` for REAL idb-keyval persistence against
 *     `few-pairing-intents` (nonceStore.integration.test.ts's pattern) — no
 *     Map-mock, so a genuine store bug (wrong key, wrong store name) would
 *     actually surface here.
 *   - The REAL `pairingAck.ts#sendPairingAck` (never mocked) with
 *     `vi.spyOn(NDKEvent.prototype, 'publish')` standing in for the relay
 *     (pairingAck.test.ts's pattern) — so "sendPairingAck was actually
 *     called and actually built a real gift wrap" is a genuine assertion,
 *     not a stub logging "would retry" (VQ-S4-001).
 *   - `@/src/lib/knownPeers` / `@/src/lib/contacts` are mocked out exactly
 *     like pairingAck.test.ts does — `sendPairingAck` never calls either
 *     (only `handlePairingAck`, the issuer-side handler, does), so this is a
 *     load-time isolation shim, not a behavioral stub.
 *
 * The `window 'online'` retry trigger and the app-mount trigger themselves
 * live in `PendingPairingIntentWatcher.tsx` (React) — this repo has no
 * jsdom/@testing-library precedent for any watcher component (mirrors
 * `useOnlineStatus`/`OfflineBanner`/`DirectMessageNotificationsWatcher`,
 * none of which have dedicated component tests either). What IS tested here
 * end-to-end is the exact payload that listener invokes on every "online"
 * event and on every mount: a fresh `drainPendingIntents` call over
 * whatever is currently persisted — see the "AC-SCAN-3: retry" block below,
 * which fails a send, confirms persistence, then calls `drainPendingIntents`
 * again (the literal function body the watcher's `online` handler runs) and
 * confirms the retried send succeeds and clears the intent.
 */
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    writable: false,
    configurable: true,
  });
}

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { bytesToHex } from 'nostr-tools/utils';
import { createPrivateKeySigner } from '@/src/lib/marmot/signerAdapter';
import { unwrapAndOpen } from '@/src/lib/directMessages';

vi.mock('@/src/lib/knownPeers', () => ({
  rememberKnownPeers: vi.fn(),
}));

// Gate-remediation finding 2: `@/src/lib/contacts` is mocked wholesale below,
// which would otherwise leave `readStoredContacts` undefined —
// `blockedPeers.ts#loadBlockedPeers()` (now called from `processIntentCore`)
// imports exactly that export. `contactsState` stands in for `lp_contacts_v1`
// and lets a test seed an issuer as blocked (archivedAt set) before draining.
const { contactsState } = vi.hoisted(() => ({
  contactsState: {} as Record<string, { pubkeyHex: string; firstSeenAt: string; lastSeenAt: string; archivedAt: string | null }>,
}));
vi.mock('@/src/lib/contacts', () => ({
  rememberContact: vi.fn(),
  readStoredContacts: () => contactsState,
}));

/** Test helper: marks `hex` as a blocked peer in the mocked contacts store. */
function blockPeer(hex: string, archivedAt: string = new Date('2026-01-01T00:00:00.000Z').toISOString()): void {
  contactsState[hex] = { pubkeyHex: hex, firstSeenAt: archivedAt, lastSeenAt: archivedAt, archivedAt };
}

import { NDKEvent } from '@nostr-dev-kit/ndk';
import {
  savePendingIntent,
  loadPendingIntents,
  getPendingIntent,
  deletePendingIntent,
  clearPendingIntentsForTests,
  isIntentInWindow,
  attemptOrQueuePairingEcho,
  drainPendingIntents,
  _clearInFlightLocksForTests,
  type PendingPairingIntent,
  type PairingEchoCandidate,
  type PendingIntentSendContext,
} from '@/src/lib/pairing/pendingIntent';
import type { PairingAckContent } from '@/src/lib/pairing/pairingAck';

const T0 = 1_700_000_000; // unix seconds

function makeIdentity() {
  const priv = generateSecretKey();
  const privHex = bytesToHex(priv);
  const pubHex = getPublicKey(priv);
  return { privHex, pubHex, signer: createPrivateKeySigner(privHex) };
}

/** Fixed-clock `now` injector for attemptOrQueuePairingEcho/drainPendingIntents (both take seconds). */
function fixedNow(nowSec: number): () => number {
  return () => nowSec;
}

function namedCtx(scanner: ReturnType<typeof makeIdentity>, nickname: string): PendingIntentSendContext {
  return {
    ownPubkeyHex: scanner.pubHex,
    ownPrivateKeyHex: scanner.privHex,
    ownProfile: { nickname, createdAt: T0 },
    resolveSendDeps: async () => ({ ndk: {} as never, signEvent: scanner.signer.signEvent }),
  };
}

beforeEach(async () => {
  await clearPendingIntentsForTests();
  _clearInFlightLocksForTests();
  vi.restoreAllMocks();
  for (const key of Object.keys(contactsState)) delete contactsState[key];
});

// ── Store CRUD sanity ────────────────────────────────────────────────────

describe('pendingIntent store CRUD (real idb-keyval, few-pairing-intents)', () => {
  it('saves, loads, and deletes an intent keyed by issuerPubkey', async () => {
    const intent: PendingPairingIntent = { issuerPubkey: 'a'.repeat(64), nonce: 'b'.repeat(32), expiresAt: T0 + 1800 };
    await savePendingIntent(intent);

    expect(await getPendingIntent(intent.issuerPubkey)).toEqual(intent);
    expect(await loadPendingIntents()).toEqual([intent]);

    await deletePendingIntent(intent.issuerPubkey);
    expect(await getPendingIntent(intent.issuerPubkey)).toBeUndefined();
    expect(await loadPendingIntents()).toEqual([]);
  });

  it('upserts — saving twice for the same issuer overwrites, not duplicates', async () => {
    const issuerPubkey = 'c'.repeat(64);
    await savePendingIntent({ issuerPubkey, nonce: 'd'.repeat(32), expiresAt: T0 });
    await savePendingIntent({ issuerPubkey, nonce: 'e'.repeat(32), expiresAt: T0 + 60 });

    const all = await loadPendingIntents();
    expect(all).toHaveLength(1);
    expect(all[0]).toEqual({ issuerPubkey, nonce: 'e'.repeat(32), expiresAt: T0 + 60 });
  });
});

// ── isIntentInWindow — pure boundary math ───────────────────────────────

describe('isIntentInWindow (AC-SCAN-6/7 boundary, inclusive <=)', () => {
  it('true at and before expiresAt, false one second after', () => {
    const intent: PendingPairingIntent = { issuerPubkey: 'f'.repeat(64), nonce: 'g'.repeat(32), expiresAt: T0 };
    expect(isIntentInWindow(intent, T0 - 1)).toBe(true);
    expect(isIntentInWindow(intent, T0)).toBe(true);
    expect(isIntentInWindow(intent, T0 + 1)).toBe(false);
  });
});

// ── AC-SCAN-1 / AC-SCAN-8 — named scanner, immediate echo, no detour ───

describe('attemptOrQueuePairingEcho — named scanner (AC-SCAN-1, AC-SCAN-8)', () => {
  it('sends exactly one gift-wrapped pairing-ack addressed to the issuer, and the intent is cleared afterward', async () => {
    const issuer = makeIdentity();
    const scanner = makeIdentity();
    const candidate: PairingEchoCandidate = { issuerPubkeyHex: issuer.pubHex, nonceHex: 'aa'.repeat(16), expiresAt: T0 + 1800 };

    const publishedKinds: number[] = [];
    let publishedWrap: unknown;
    vi.spyOn(NDKEvent.prototype, 'publish').mockImplementation(async function (this: NDKEvent) {
      const raw = (this as unknown as { rawEvent: () => { kind: number } }).rawEvent();
      publishedKinds.push(raw.kind);
      publishedWrap = raw;
      return new Set() as never;
    });

    const status = await attemptOrQueuePairingEcho(candidate, namedCtx(scanner, 'Alice'), fixedNow(T0));

    expect(status).toBe('sent');
    expect(NDKEvent.prototype.publish).toHaveBeenCalledTimes(1);

    // AC-PRIV-1 backstop (ownership-ledger.json watch: "S4 MUST also assert
    // no public kind-0 on the scanner-side echo trigger") — the only thing
    // this call ever publishes is the addressed kind-1059 gift wrap, never
    // an unaddressed kind-0.
    expect(publishedKinds).toEqual([1059]);
    expect(publishedKinds).not.toContain(0);

    // Decode the real wrap the way the issuer would — confirms this is the
    // genuine PairingAckSend seam output, not a hand-rolled stand-in.
    const recoveredRumor = await unwrapAndOpen(publishedWrap as never, issuer.privHex);
    expect(recoveredRumor.pubkey).toBe(scanner.pubHex);
    const content = JSON.parse(recoveredRumor.content) as PairingAckContent;
    expect(content.nonce).toBe(candidate.nonceHex);

    // Cleared — a completed echo leaves nothing pending.
    expect(await getPendingIntent(issuer.pubHex)).toBeUndefined();
  });

  it('AC-SCAN-8: a scanner who already has a shareable name at scan time never yields a "deferred" (name-setup-redirect) outcome', async () => {
    const issuer = makeIdentity();
    const scanner = makeIdentity();
    const candidate: PairingEchoCandidate = { issuerPubkeyHex: issuer.pubHex, nonceHex: 'bb'.repeat(16), expiresAt: T0 + 1800 };
    vi.spyOn(NDKEvent.prototype, 'publish').mockImplementation(async () => new Set() as never);

    const status = await attemptOrQueuePairingEcho(candidate, namedCtx(scanner, 'Bob'), fixedNow(T0));

    // add.tsx's ONLY redirect-to-name-setup trigger is a 'deferred' outcome —
    // asserting it is never produced for an already-named scanner is the
    // absence-of-redirect guarantee (distinct from AC-SCAN-1's presence-of-
    // echo assertion above).
    expect(status).not.toBe('deferred');
    expect(['sent', 'queued-for-retry']).toContain(status);
  });
});

// ── AC-SCAN-5 — nameless scanner defers + persists ──────────────────────

describe('attemptOrQueuePairingEcho — nameless scanner (AC-SCAN-5)', () => {
  it('persists the intent with the scanned card\'s real values and does not attempt a send', async () => {
    const issuer = makeIdentity();
    const scanner = makeIdentity();
    const candidate: PairingEchoCandidate = { issuerPubkeyHex: issuer.pubHex, nonceHex: 'cc'.repeat(16), expiresAt: T0 + 1800 };
    const publishSpy = vi.spyOn(NDKEvent.prototype, 'publish');

    const status = await attemptOrQueuePairingEcho(candidate, namedCtx(scanner, ''), fixedNow(T0));

    expect(status).toBe('deferred');
    expect(publishSpy).not.toHaveBeenCalled();

    const persisted = await getPendingIntent(issuer.pubHex);
    expect(persisted).toEqual({ issuerPubkey: issuer.pubHex, nonce: candidate.nonceHex, expiresAt: candidate.expiresAt });
  });

  it('a whitespace-only nickname is also treated as nameless (hasShareableName trims)', async () => {
    const issuer = makeIdentity();
    const scanner = makeIdentity();
    const candidate: PairingEchoCandidate = { issuerPubkeyHex: issuer.pubHex, nonceHex: 'dd'.repeat(16), expiresAt: T0 + 1800 };

    const status = await attemptOrQueuePairingEcho(candidate, namedCtx(scanner, '   '), fixedNow(T0));

    expect(status).toBe('deferred');
  });
});

// ── AC-SCAN-3 — publish failure persists, retry (via drainPendingIntents) succeeds ──

describe('AC-SCAN-3 — a failed send is persisted, never dropped, and a later drain retries it', () => {
  it('queues on failure, then the retry drain sends the SAME issuerPubkey/nonce and clears it', async () => {
    const issuer = makeIdentity();
    const scanner = makeIdentity();
    const candidate: PairingEchoCandidate = { issuerPubkeyHex: issuer.pubHex, nonceHex: 'ee'.repeat(16), expiresAt: T0 + 1800 };

    vi.spyOn(NDKEvent.prototype, 'publish').mockRejectedValueOnce(new Error('offline'));

    const firstStatus = await attemptOrQueuePairingEcho(candidate, namedCtx(scanner, 'Carol'), fixedNow(T0));
    expect(firstStatus).toBe('queued-for-retry');

    // Never dropped — this is the mechanism, not just a policy statement.
    const stillPersisted = await getPendingIntent(issuer.pubHex);
    expect(stillPersisted).toEqual({ issuerPubkey: issuer.pubHex, nonce: candidate.nonceHex, expiresAt: candidate.expiresAt });

    // Simulate the retry a real `online` event (via
    // PendingPairingIntentWatcher.tsx) would trigger — the exact same
    // drainPendingIntents call, now with a healthy relay.
    let publishedWrap: unknown;
    vi.spyOn(NDKEvent.prototype, 'publish').mockImplementation(async function (this: NDKEvent) {
      publishedWrap = (this as unknown as { rawEvent: () => unknown }).rawEvent();
      return new Set() as never;
    });

    const drainResult = await drainPendingIntents(namedCtx(scanner, 'Carol'), fixedNow(T0 + 10));

    expect(drainResult.sent).toEqual([issuer.pubHex]);
    expect(drainResult.retried).toEqual([]);
    expect(await getPendingIntent(issuer.pubHex)).toBeUndefined();

    // Same issuerPubkey/nonce as the original attempt — not corrupted or
    // re-derived from unrelated state.
    const recoveredRumor = await unwrapAndOpen(publishedWrap as never, issuer.privHex);
    const content = JSON.parse(recoveredRumor.content) as PairingAckContent;
    expect(content.nonce).toBe(candidate.nonceHex);
  });

  it('a still-failing retry leaves the intent persisted (repeated queued-for-retry, no data loss)', async () => {
    const issuer = makeIdentity();
    const scanner = makeIdentity();
    const candidate: PairingEchoCandidate = { issuerPubkeyHex: issuer.pubHex, nonceHex: 'ff'.repeat(16), expiresAt: T0 + 1800 };
    vi.spyOn(NDKEvent.prototype, 'publish').mockRejectedValue(new Error('still offline'));

    await attemptOrQueuePairingEcho(candidate, namedCtx(scanner, 'Dana'), fixedNow(T0));
    const result = await drainPendingIntents(namedCtx(scanner, 'Dana'), fixedNow(T0 + 5));

    expect(result.retried).toEqual([issuer.pubHex]);
    expect(await getPendingIntent(issuer.pubHex)).not.toBeUndefined();
  });
});

// ── AC-SCAN-6 — in-window name-transition drain fires automatically ────

describe('drainPendingIntents — AC-SCAN-6 (in-window fire on name transition)', () => {
  it('fires the held echo once a name is set, while still within the intent\'s own expiresAt', async () => {
    const issuer = makeIdentity();
    const scanner = makeIdentity();
    // Persisted directly, as add.tsx would have left it for a nameless scan.
    await savePendingIntent({ issuerPubkey: issuer.pubHex, nonce: 'aa'.repeat(16), expiresAt: T0 + 1800 });
    vi.spyOn(NDKEvent.prototype, 'publish').mockImplementation(async () => new Set() as never);

    // "Sets a name" — the caller (profile.tsx's saveProfile-chokepoint
    // effect) now has a shareable nickname; still one second before expiry.
    const result = await drainPendingIntents(namedCtx(scanner, 'Eve'), fixedNow(T0 + 1799));

    expect(result.sent).toEqual([issuer.pubHex]);
    expect(NDKEvent.prototype.publish).toHaveBeenCalledTimes(1);
    expect(await getPendingIntent(issuer.pubHex)).toBeUndefined();
  });

  it('exactly at expiresAt is still in-window (inclusive boundary)', async () => {
    const issuer = makeIdentity();
    const scanner = makeIdentity();
    await savePendingIntent({ issuerPubkey: issuer.pubHex, nonce: 'bb'.repeat(16), expiresAt: T0 + 1800 });
    vi.spyOn(NDKEvent.prototype, 'publish').mockImplementation(async () => new Set() as never);

    const result = await drainPendingIntents(namedCtx(scanner, 'Frank'), fixedNow(T0 + 1800));

    expect(result.sent).toEqual([issuer.pubHex]);
  });
});

// ── AC-SCAN-7 — past-window drain silently drops, no send, no error ────

describe('drainPendingIntents — AC-SCAN-7 (past-window silently degrades)', () => {
  it('a name set AFTER expiresAt has passed sends nothing and surfaces no error', async () => {
    const issuer = makeIdentity();
    const scanner = makeIdentity();
    await savePendingIntent({ issuerPubkey: issuer.pubHex, nonce: 'cc'.repeat(16), expiresAt: T0 + 1800 });
    const publishSpy = vi.spyOn(NDKEvent.prototype, 'publish');

    // "Sets a name" one second past the window.
    const result = await expect(
      drainPendingIntents(namedCtx(scanner, 'Grace'), fixedNow(T0 + 1801)),
    ).resolves.toEqual({ sent: [], retried: [], droppedExpired: [issuer.pubHex], deferredNoName: [], droppedBlocked: [] });

    expect(publishSpy).not.toHaveBeenCalled();
    // Cleaned up — not left to be silently retried again later (which could
    // otherwise violate the AC-SCAN-6/7 window semantics on a future drain).
    expect(await getPendingIntent(issuer.pubHex)).toBeUndefined();
  });

  it('an intent past its window is dropped on a drain even while the scanner still has no name (window check runs first)', async () => {
    const issuer = makeIdentity();
    const scanner = makeIdentity();
    await savePendingIntent({ issuerPubkey: issuer.pubHex, nonce: 'dd'.repeat(16), expiresAt: T0 + 1800 });
    const publishSpy = vi.spyOn(NDKEvent.prototype, 'publish');

    const result = await drainPendingIntents(namedCtx(scanner, ''), fixedNow(T0 + 1801));

    expect(result.droppedExpired).toEqual([issuer.pubHex]);
    expect(publishSpy).not.toHaveBeenCalled();
    expect(await getPendingIntent(issuer.pubHex)).toBeUndefined();
  });

  it('an in-window intent for a still-nameless scanner is left untouched, not dropped and not sent', async () => {
    const issuer = makeIdentity();
    const scanner = makeIdentity();
    await savePendingIntent({ issuerPubkey: issuer.pubHex, nonce: 'ee'.repeat(16), expiresAt: T0 + 1800 });
    const publishSpy = vi.spyOn(NDKEvent.prototype, 'publish');

    const result = await drainPendingIntents(namedCtx(scanner, ''), fixedNow(T0));

    expect(result.deferredNoName).toEqual([issuer.pubHex]);
    expect(publishSpy).not.toHaveBeenCalled();
    expect(await getPendingIntent(issuer.pubHex)).not.toBeUndefined();
  });
});

// ── Multi-intent drain ───────────────────────────────────────────────────

describe('drainPendingIntents — multiple held intents are each resolved independently', () => {
  it('sends the in-window ones and drops the expired one in a single pass', async () => {
    const issuerA = makeIdentity();
    const issuerB = makeIdentity();
    const scanner = makeIdentity();
    await savePendingIntent({ issuerPubkey: issuerA.pubHex, nonce: 'aa'.repeat(16), expiresAt: T0 + 1800 });
    await savePendingIntent({ issuerPubkey: issuerB.pubHex, nonce: 'bb'.repeat(16), expiresAt: T0 - 1 });
    vi.spyOn(NDKEvent.prototype, 'publish').mockImplementation(async () => new Set() as never);

    const result = await drainPendingIntents(namedCtx(scanner, 'Heidi'), fixedNow(T0));

    expect(result.sent).toEqual([issuerA.pubHex]);
    expect(result.droppedExpired).toEqual([issuerB.pubHex]);
    expect(await loadPendingIntents()).toEqual([]);
  });
});

// ── Concurrency — review-remediation (sev 3): overlapping drains coalesce ──

describe('processIntent concurrency lock (review-remediation, sev 3)', () => {
  it('two concurrent drainPendingIntents calls for the same held intent (profile.tsx\'s flip effect racing PendingPairingIntentWatcher) publish exactly once', async () => {
    const issuer = makeIdentity();
    const scanner = makeIdentity();
    await savePendingIntent({ issuerPubkey: issuer.pubHex, nonce: 'aa'.repeat(16), expiresAt: T0 + 1800 });

    let publishCount = 0;
    vi.spyOn(NDKEvent.prototype, 'publish').mockImplementation(async () => {
      publishCount += 1;
      // Artificial delay so the second concurrent caller is GENUINELY
      // in-flight (not just "resolved fast enough that ordering happened to
      // work out") when it reaches processIntent for the same issuer.
      await new Promise((resolve) => setTimeout(resolve, 10));
      return new Set() as never;
    });

    // Simulates profile.tsx's hasShareableName false->true flip effect and
    // PendingPairingIntentWatcher's mount/online drain both firing for the
    // same freshly-named scanner at nearly the same time.
    const [resultA, resultB] = await Promise.all([
      drainPendingIntents(namedCtx(scanner, 'Quinn'), fixedNow(T0)),
      drainPendingIntents(namedCtx(scanner, 'Quinn'), fixedNow(T0)),
    ]);

    expect(publishCount).toBe(1);
    // Both callers observe the SAME (shared) outcome — the coalesced call's
    // result, not a race where one sees 'sent' and the other double-sends.
    expect(resultA.sent).toEqual([issuer.pubHex]);
    expect(resultB.sent).toEqual([issuer.pubHex]);
    expect(await getPendingIntent(issuer.pubHex)).toBeUndefined();
  });

  it('a non-overlapping (sequential) second drain after the first completes is unaffected by the lock — it just finds nothing left to send', async () => {
    const issuer = makeIdentity();
    const scanner = makeIdentity();
    await savePendingIntent({ issuerPubkey: issuer.pubHex, nonce: 'bb'.repeat(16), expiresAt: T0 + 1800 });
    vi.spyOn(NDKEvent.prototype, 'publish').mockImplementation(async () => new Set() as never);

    const first = await drainPendingIntents(namedCtx(scanner, 'Rae'), fixedNow(T0));
    const second = await drainPendingIntents(namedCtx(scanner, 'Rae'), fixedNow(T0 + 1));

    expect(first.sent).toEqual([issuer.pubHex]);
    expect(second.sent).toEqual([]);
    expect(NDKEvent.prototype.publish).toHaveBeenCalledTimes(1);
  });
});

// ── Gate-remediation finding 2 (2026-07-14): blocked-issuer privacy gate ────
// The queued echo/profile-announce must never reach an issuer who was
// blocked AFTER the intent was queued — checked at SEND time (every
// processIntent call), not just at queue time, so no producer of a pending
// intent can bypass it.

describe('processIntentCore — privacy gate for a blocked issuer (gate-remediation finding 2)', () => {
  it('a held intent for an issuer blocked AFTER queuing (nameless/offline scenario) is dropped on the SAME drain a name-set would otherwise fire it', async () => {
    const issuer = makeIdentity();
    const scanner = makeIdentity();
    // Queued while nameless/offline — mirrors AC-SCAN-5's persist-without-send.
    await savePendingIntent({ issuerPubkey: issuer.pubHex, nonce: 'aa'.repeat(16), expiresAt: T0 + 1800 });

    // The scanner then blocks the issuer BEFORE ever setting a name.
    blockPeer(issuer.pubHex);

    const publishSpy = vi.spyOn(NDKEvent.prototype, 'publish');

    // A name is now set (or an online/retry drain fires) — absent the fix,
    // this would send the echo + a profile-announce to the blocked issuer.
    const result = await drainPendingIntents(namedCtx(scanner, 'Alice'), fixedNow(T0 + 5));

    expect(result.droppedBlocked).toEqual([issuer.pubHex]);
    expect(result.sent).toEqual([]);
    expect(result.retried).toEqual([]);
    expect(result.deferredNoName).toEqual([]);
    expect(publishSpy).not.toHaveBeenCalled();

    // Dropped, not left to be retried later.
    expect(await getPendingIntent(issuer.pubHex)).toBeUndefined();
  });

  it('a blocked issuer is dropped even while the scanner is STILL nameless (checked before the name gate, not after)', async () => {
    const issuer = makeIdentity();
    const scanner = makeIdentity();
    await savePendingIntent({ issuerPubkey: issuer.pubHex, nonce: 'bb'.repeat(16), expiresAt: T0 + 1800 });
    blockPeer(issuer.pubHex);
    const publishSpy = vi.spyOn(NDKEvent.prototype, 'publish');

    const result = await drainPendingIntents(namedCtx(scanner, ''), fixedNow(T0));

    expect(result.droppedBlocked).toEqual([issuer.pubHex]);
    expect(result.deferredNoName).toEqual([]);
    expect(publishSpy).not.toHaveBeenCalled();
    expect(await getPendingIntent(issuer.pubHex)).toBeUndefined();
  });

  it('attemptOrQueuePairingEcho itself never sends to an issuer that is ALREADY blocked at scan time', async () => {
    const issuer = makeIdentity();
    const scanner = makeIdentity();
    blockPeer(issuer.pubHex);
    const candidate: PairingEchoCandidate = { issuerPubkeyHex: issuer.pubHex, nonceHex: 'cc'.repeat(16), expiresAt: T0 + 1800 };
    const publishSpy = vi.spyOn(NDKEvent.prototype, 'publish');

    const status = await attemptOrQueuePairingEcho(candidate, namedCtx(scanner, 'Bob'), fixedNow(T0));

    expect(status).toBe('droppedBlocked');
    expect(publishSpy).not.toHaveBeenCalled();
    expect(await getPendingIntent(issuer.pubHex)).toBeUndefined();
  });

  it('control: an UNBLOCKED issuer is unaffected by the new gate — drains and sends exactly as before', async () => {
    const issuer = makeIdentity();
    const scanner = makeIdentity();
    await savePendingIntent({ issuerPubkey: issuer.pubHex, nonce: 'dd'.repeat(16), expiresAt: T0 + 1800 });
    vi.spyOn(NDKEvent.prototype, 'publish').mockImplementation(async () => new Set() as never);

    const result = await drainPendingIntents(namedCtx(scanner, 'Carol'), fixedNow(T0 + 1));

    expect(result.sent).toEqual([issuer.pubHex]);
    expect(result.droppedBlocked).toEqual([]);
  });
});
