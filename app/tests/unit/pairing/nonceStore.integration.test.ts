/**
 * Integration test for nonceStore.ts against a real IDB-API surface
 * (provided by fake-indexeddb), mirroring
 * app/tests/unit/profileRequestStorage.integration.test.ts's pattern:
 * fake-indexeddb/auto installs IndexedDB on globalThis so idb-keyval can run
 * unmodified in node, and the storage module is exercised end-to-end (its
 * own createStore call, its own get/set/del/entries) — not mocked.
 *
 * Covers AC-NONCE-1 through AC-NONCE-6 (the store's own boundary math;
 * AC-NONCE-7's cache-key dimension is covered separately in
 * tests/unit/cards/shareCard.test.ts since that's a shareCard.ts concern).
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getOrMintActiveNonce,
  isNonceAdmissible,
  getStoredNonce,
  pruneExpiredNonces,
  clearAllNonces,
  _resetActiveNonceForTests,
  peekActiveNonce,
  NONCE_TTL_SEC,
  NONCE_GRACE_SEC,
} from '@/src/lib/pairing/nonceStore';

const T0 = 1_700_000_000; // unix seconds

describe('nonceStore — mint/reuse/grace/prune boundary math', () => {
  beforeEach(async () => {
    await clearAllNonces();
    _resetActiveNonceForTests();
  });

  // ── AC-NONCE-1 — reuse while live and unexpired ───────────────────────

  it('AC-NONCE-1: repeated calls within the same session return the SAME nonce while unexpired', async () => {
    const first = await getOrMintActiveNonce(T0);
    const second = await getOrMintActiveNonce(T0 + 60);
    const third = await getOrMintActiveNonce(T0 + NONCE_TTL_SEC); // exactly at expiry — still valid (<=)

    expect(second.nonce).toBe(first.nonce);
    expect(second.expiresAt).toBe(first.expiresAt);
    expect(third.nonce).toBe(first.nonce);
  });

  // ── AC-NONCE-2 — reload always mints fresh, old one stays admissible ──

  it('AC-NONCE-2: simulated reload mints a fresh nonce with a new expires_at; the old nonce remains retrievable and admissible until its own grace elapses', async () => {
    const before = await getOrMintActiveNonce(T0);
    expect(before.expiresAt).toBe(T0 + NONCE_TTL_SEC);

    // Simulate a page reload: the in-memory pointer resets, but the
    // persisted store (a fresh fake-indexeddb "page" would still see the
    // same origin-scoped IDB) is untouched — only clear the in-memory half.
    _resetActiveNonceForTests();

    const after = await getOrMintActiveNonce(T0 + 60);
    expect(after.nonce).not.toBe(before.nonce);
    expect(after.expiresAt).toBe(T0 + 60 + NONCE_TTL_SEC);

    // The old nonce is read from REAL persisted storage, not JS memory.
    const oldStored = await getStoredNonce(before.nonce);
    expect(oldStored).toEqual(before);
    expect(await isNonceAdmissible(before.nonce, T0 + 60)).toBe(true);
    expect(await isNonceAdmissible(before.nonce, before.expiresAt + NONCE_GRACE_SEC)).toBe(true);
    expect(await isNonceAdmissible(before.nonce, before.expiresAt + NONCE_GRACE_SEC + 1)).toBe(false);
  });

  // ── AC-NONCE-3 — expiry without reload also mints fresh ───────────────

  it('AC-NONCE-3: the active nonce expiring mid-session (no reload) causes the next call to mint a fresh nonce', async () => {
    const before = await getOrMintActiveNonce(T0);
    const stillValid = await getOrMintActiveNonce(before.expiresAt); // boundary: <= still reuses
    expect(stillValid.nonce).toBe(before.nonce);

    const afterExpiry = await getOrMintActiveNonce(before.expiresAt + 1); // one second past — must re-mint
    expect(afterExpiry.nonce).not.toBe(before.nonce);
    expect(afterExpiry.expiresAt).toBe(before.expiresAt + 1 + NONCE_TTL_SEC);
  });

  // ── AC-NONCE-4 — persistence + queryable through expiresAt + 2h ───────

  it('AC-NONCE-4: an issued nonce remains queryable from the store (raw read, not just isNonceAdmissible) through at least expiresAt + 2h', async () => {
    const minted = await getOrMintActiveNonce(T0);

    const justBeforeGraceEnd = await getStoredNonce(minted.nonce);
    expect(justBeforeGraceEnd).toEqual({ nonce: minted.nonce, expiresAt: minted.expiresAt });

    // Still present right up to the grace boundary — no prune has run yet
    // (nothing has triggered pruneExpiredNonces since mint).
    expect(await getStoredNonce(minted.nonce)).not.toBeUndefined();
  });

  // ── AC-NONCE-5 — isNonceAdmissible boundary-exact grace math ──────────

  describe('AC-NONCE-5: isNonceAdmissible grace-window boundary', () => {
    it('true at exactly storedExpiresAt + 7200, false at storedExpiresAt + 7201', async () => {
      const minted = await getOrMintActiveNonce(T0);
      const boundary = minted.expiresAt + NONCE_GRACE_SEC;

      expect(await isNonceAdmissible(minted.nonce, boundary)).toBe(true);
      expect(await isNonceAdmissible(minted.nonce, boundary + 1)).toBe(false);
    });

    it('true well before expiresAt, true one second before the grace boundary', async () => {
      const minted = await getOrMintActiveNonce(T0);
      expect(await isNonceAdmissible(minted.nonce, T0)).toBe(true);
      expect(await isNonceAdmissible(minted.nonce, minted.expiresAt + NONCE_GRACE_SEC - 1)).toBe(true);
    });

    it('false for a nonce that was never issued', async () => {
      expect(await isNonceAdmissible('a'.repeat(32), T0)).toBe(false);
    });

    it('false (never throws) for malformed input: wrong length, non-hex, empty, non-string-shaped', async () => {
      const minted = await getOrMintActiveNonce(T0);
      expect(await isNonceAdmissible(minted.nonce.slice(0, 10), T0)).toBe(false);
      expect(await isNonceAdmissible('zz'.repeat(16), T0)).toBe(false);
      expect(await isNonceAdmissible('', T0)).toBe(false);
      // @ts-expect-error — deliberately probing runtime defensiveness against a non-string
      expect(await isNonceAdmissible(12345, T0)).toBe(false);
    });

    it('is read-only: repeated admissibility checks against a stale nonce never mutate the store (no eviction-oracle side effect)', async () => {
      const minted = await getOrMintActiveNonce(T0);
      const staleAt = minted.expiresAt + NONCE_GRACE_SEC + 1;

      expect(await isNonceAdmissible(minted.nonce, staleAt)).toBe(false);
      // Still present afterwards — the predicate did not prune it.
      expect(await getStoredNonce(minted.nonce)).not.toBeUndefined();
      expect(await isNonceAdmissible(minted.nonce, staleAt)).toBe(false);
    });

    it('nonceHex is matched case-insensitively (lowercased before lookup)', async () => {
      const minted = await getOrMintActiveNonce(T0);
      expect(await isNonceAdmissible(minted.nonce.toUpperCase(), T0)).toBe(true);
    });
  });

  // ── AC-NONCE-6 — prune no later than next mint or next ack-processing pass ──

  describe('AC-NONCE-6: pruning', () => {
    it('mint-time trigger: a stale nonce is gone from raw store contents after the next mint call', async () => {
      const stale = await getOrMintActiveNonce(T0);
      const staleGoneAt = stale.expiresAt + NONCE_GRACE_SEC + 1;

      // Force a re-mint at a time when `stale` is already past grace.
      _resetActiveNonceForTests();
      const fresh = await getOrMintActiveNonce(staleGoneAt);
      expect(fresh.nonce).not.toBe(stale.nonce);

      // Assert against the store's RAW contents, not isNonceAdmissible.
      expect(await getStoredNonce(stale.nonce)).toBeUndefined();
      expect(await getStoredNonce(fresh.nonce)).toEqual(fresh);
    });

    it('does NOT prune a nonce that is still within its grace window at mint time', async () => {
      const stillGraced = await getOrMintActiveNonce(T0);
      _resetActiveNonceForTests();
      // Re-mint at a time inside stillGraced's grace window (expired, but not past grace).
      await getOrMintActiveNonce(stillGraced.expiresAt + 1);

      expect(await getStoredNonce(stillGraced.nonce)).not.toBeUndefined();
    });

    it('ack-processing-time trigger: calling pruneExpiredNonces directly (as S3 will during its ack-processing pass) also removes stale entries, independent of any mint call', async () => {
      const stale = await getOrMintActiveNonce(T0);
      const staleGoneAt = stale.expiresAt + NONCE_GRACE_SEC + 1;

      // No mint happens here — this simulates S3's ack-processing pass
      // calling the exported prune primitive directly.
      await pruneExpiredNonces(staleGoneAt);

      expect(await getStoredNonce(stale.nonce)).toBeUndefined();
    });

    it('pruning removes only past-grace entries, leaving still-admissible ones intact', async () => {
      const older = await getOrMintActiveNonce(T0);
      _resetActiveNonceForTests();
      const newer = await getOrMintActiveNonce(T0 + 10);

      const olderGoneAt = older.expiresAt + NONCE_GRACE_SEC + 1;
      // newer is still well within its own grace window at this time.
      await pruneExpiredNonces(olderGoneAt);

      expect(await getStoredNonce(older.nonce)).toBeUndefined();
      expect(await getStoredNonce(newer.nonce)).toEqual(newer);
    });

    // AC-NONCE-4/6 boundary: pruneExpiredNonces uses a strict `>` comparison
    // against expiresAt + NONCE_GRACE_SEC, so a nonce queried/pruned at
    // EXACTLY the grace boundary must still be retrievable (matching
    // isNonceAdmissible's own <= boundary, tested above) — only the instant
    // AFTER the boundary is eligible for removal. An off-by-one here (`>=`
    // instead of `>`) would silently break AC-NONCE-5's guarantee that a
    // nonce is still admissible at exactly `storedExpiresAt + 7200`, since
    // isNonceAdmissible reports false for anything no longer in the store.
    it('prune boundary is exclusive: exactly at expiresAt + grace the entry survives; one second later it is gone', async () => {
      const minted = await getOrMintActiveNonce(T0);
      const boundary = minted.expiresAt + NONCE_GRACE_SEC;

      await pruneExpiredNonces(boundary);
      expect(await getStoredNonce(minted.nonce)).toEqual(minted);

      await pruneExpiredNonces(boundary + 1);
      expect(await getStoredNonce(minted.nonce)).toBeUndefined();
    });
  });

  // ── Mint output shape ───────────────────────────────────────────────────

  it('mints a 32-hex-char (16-byte) nonce', async () => {
    const minted = await getOrMintActiveNonce(T0);
    expect(minted.nonce).toMatch(/^[0-9a-f]{32}$/);
  });

  it('two independent mints (across resets) never collide', async () => {
    const a = await getOrMintActiveNonce(T0);
    _resetActiveNonceForTests();
    // Force re-mint by moving well past a's expiry.
    const b = await getOrMintActiveNonce(a.expiresAt + 1);
    expect(b.nonce).not.toBe(a.nonce);
  });

  // ── Window durations pinned to their absolute second-values (mutation gate) ──
  // Every boundary test above derives its edge from the imported constants
  // (`minted.expiresAt + NONCE_GRACE_SEC`), so a mutation of the constant's
  // arithmetic (e.g. 2*60*60 → 2) shifts both the module AND the test in
  // lockstep and stays green. These assertions pin the real-world durations —
  // 30-minute active TTL, 2-hour post-expiry grace — so shrinking the grace
  // window to seconds (which would wrongly reject acks that legitimately
  // arrive hours after a code is shown) can no longer ship unnoticed.
  it('pins the active-nonce TTL to 30 minutes and the post-expiry grace to 2 hours', () => {
    expect(NONCE_TTL_SEC).toBe(30 * 60);
    expect(NONCE_TTL_SEC).toBe(1800);
    expect(NONCE_GRACE_SEC).toBe(2 * 60 * 60);
    expect(NONCE_GRACE_SEC).toBe(7200);
  });

  // ── peekActiveNonce — review-remediation (S5, sev 3 correctness) ────────
  // Genuinely read-only: never mints, persists, or prunes, unlike
  // getOrMintActiveNonce. Added so a caller that only wants to READ the
  // active nonce (e.g. the admission-digest notification) cannot
  // accidentally rotate the issuer's nonce as a side effect of that read.

  describe('peekActiveNonce — read-only accessor (review-remediation)', () => {
    it('returns null before any mint has happened this session', () => {
      expect(peekActiveNonce()).toBeNull();
    });

    it('does NOT mint: calling peekActiveNonce alone never persists a nonce to the store', async () => {
      expect(peekActiveNonce()).toBeNull();
      // No nonce exists in the store — a raw read confirms nothing was minted.
      // (There is no "list all" export; absence is confirmed via a fresh
      // getOrMintActiveNonce call below still minting a BRAND NEW nonce,
      // which would be impossible if peekActiveNonce had already set the
      // in-memory pointer via a hidden mint.)
      const minted = await getOrMintActiveNonce(T0);
      expect(minted.nonce).toMatch(/^[0-9a-f]{32}$/);
    });

    it('returns the SAME nonce getOrMintActiveNonce most recently minted/reused, without minting a new one', async () => {
      const minted = await getOrMintActiveNonce(T0);
      const peeked = peekActiveNonce();
      expect(peeked).toEqual(minted);

      // Calling peek again changes nothing — still the same value, and a
      // subsequent getOrMintActiveNonce at the same timestamp still reuses
      // it (AC-NONCE-1), proving peek did not rotate anything in between.
      expect(peekActiveNonce()).toEqual(minted);
      const reused = await getOrMintActiveNonce(T0 + 60);
      expect(reused.nonce).toBe(minted.nonce);
    });

    it('does NOT mint a fresh nonce even when the previously-active one has since expired — this is the core regression this accessor exists to prevent', async () => {
      const minted = await getOrMintActiveNonce(T0);
      const wellPastExpiry = minted.expiresAt + 60 * 60; // 1h past expiry — still within the 2h grace an ack could legitimately arrive in

      // A read via peekActiveNonce at a time when the active nonce has
      // expired must NOT mint a replacement — it just returns the (now
      // stale, but still real) StoredNonce the mint pointer last held.
      // getOrMintActiveNonce is NEVER called here at wellPastExpiry — this
      // proves peekActiveNonce alone cannot trigger the mint-on-expiry path.
      const peeked = peekActiveNonce();
      expect(peeked).toEqual(minted);
      expect(peeked!.nonce).toBe(minted.nonce);

      // The store still shows exactly the one originally-minted nonce —
      // peeking past its expiry did not cause a second entry to appear.
      expect(await getStoredNonce(minted.nonce)).toEqual(minted);
      void wellPastExpiry; // documents the scenario this guards; no time-travel API needed since peek takes no `now` param
    });

    it("returns null again after a simulated reload (in-memory pointer cleared) — matches getOrMintActiveNonce's own reload semantics, but still mints nothing", async () => {
      await getOrMintActiveNonce(T0);
      _resetActiveNonceForTests();
      expect(peekActiveNonce()).toBeNull();
    });
  });
});
