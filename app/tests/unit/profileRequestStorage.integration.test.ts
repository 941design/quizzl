/**
 * Integration test for profileRequestStorage against a real IDB-API surface
 * (provided by fake-indexeddb). Closes the AC-045 scenario-5 coverage gap that
 * currently lives in app/tests/e2e/groups-profile-request.spec.ts:298 as a
 * test.fixme — the boundary math (1h retry / 7d dedupe / 3-attempts cap) does
 * not need to be tested through Playwright + page navigation; it is a pure
 * data-layer contract.
 *
 * fake-indexeddb/auto installs IndexedDB on globalThis so idb-keyval can run
 * unmodified in node. The storage module is exercised end-to-end (its own
 * createStore call, its own get/set/del/entries) — not mocked.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordRequestEmitted,
  recordRequestAnswered,
  loadProfileRequestMemo,
  saveProfileRequestMemo,
  clearProfileRequestMemos,
} from '@/src/lib/marmot/profileRequestStorage';
import {
  shouldEmitRequest,
  REQUEST_DEDUPE_MS,
  UNANSWERED_RETRY_MS,
  UNANSWERED_MAX_ATTEMPTS,
} from '@/src/lib/marmot/profileRequestSync';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const T0 = 1_700_000_000_000;

describe('profileRequestStorage — IDB persistence + retry boundaries (AC-045 scenario 5)', () => {
  const G = 'group-1';
  const T = 'pubkey-bob';

  beforeEach(async () => {
    await clearProfileRequestMemos('*');
  });

  it('absent memo → emit allowed, recordRequestEmitted writes attempts=1', async () => {
    expect(await loadProfileRequestMemo(G, T)).toBeNull();
    expect(shouldEmitRequest(null, T0)).toBe(true);
    await recordRequestEmitted(G, T, T0);
    const memo = await loadProfileRequestMemo(G, T);
    expect(memo).not.toBeNull();
    expect(memo!.attempts).toBe(1);
    expect(memo!.lastRequestAt).toBe(T0);
    expect(memo!.lastAnsweredAt).toBeNull();
  });

  it('within-1h cooldown → shouldEmitRequest returns false', async () => {
    await recordRequestEmitted(G, T, T0);
    const memo = await loadProfileRequestMemo(G, T);
    expect(shouldEmitRequest(memo, T0 + UNANSWERED_RETRY_MS - 1)).toBe(false);
  });

  it('past 1h, attempts<MAX → emit allowed, recordRequestEmitted increments attempts', async () => {
    await recordRequestEmitted(G, T, T0);
    let memo = await loadProfileRequestMemo(G, T);

    expect(shouldEmitRequest(memo, T0 + 2 * HOUR)).toBe(true);
    await recordRequestEmitted(G, T, T0 + 2 * HOUR);
    memo = await loadProfileRequestMemo(G, T);
    expect(memo!.attempts).toBe(2);
    expect(memo!.lastRequestAt).toBe(T0 + 2 * HOUR);
  });

  it('attempts cap at UNANSWERED_MAX_ATTEMPTS across four 2h-spaced sweeps', async () => {
    // Sweep 1: T0
    await recordRequestEmitted(G, T, T0);
    expect((await loadProfileRequestMemo(G, T))!.attempts).toBe(1);

    // Sweep 2: T0 + 2h
    let memo = await loadProfileRequestMemo(G, T);
    expect(shouldEmitRequest(memo, T0 + 2 * HOUR)).toBe(true);
    await recordRequestEmitted(G, T, T0 + 2 * HOUR);
    expect((await loadProfileRequestMemo(G, T))!.attempts).toBe(2);

    // Sweep 3: T0 + 4h
    memo = await loadProfileRequestMemo(G, T);
    expect(shouldEmitRequest(memo, T0 + 4 * HOUR)).toBe(true);
    await recordRequestEmitted(G, T, T0 + 4 * HOUR);
    expect((await loadProfileRequestMemo(G, T))!.attempts).toBe(UNANSWERED_MAX_ATTEMPTS);

    // Sweep 4: T0 + 6h — predicate must say NO (cap reached, still inside dedupe window)
    memo = await loadProfileRequestMemo(G, T);
    expect(shouldEmitRequest(memo, T0 + 6 * HOUR)).toBe(false);
  });

  it('dedupe window expiry resets attempts to 1 (window pivots on lastRequestAt, not first request)', async () => {
    // Three attempts in the first 4 hours. The dedupe window pivots on the LAST
    // request, so the seven-day blockade extends from T0+4h, not from T0.
    await recordRequestEmitted(G, T, T0);
    await recordRequestEmitted(G, T, T0 + 2 * HOUR);
    await recordRequestEmitted(G, T, T0 + 4 * HOUR);
    expect((await loadProfileRequestMemo(G, T))!.attempts).toBe(3);

    // T0 + 7d + 1h is only ~7d-3h since the last request — still inside the
    // retry window, attempts cap is binding, must skip. This is the contract:
    // a peer that keeps retrying every 2h DOES extend the blackout, but only
    // until the cap is reached, then the window quietly expires off the
    // most-recent attempt.
    const sevenDaysAfterT0 = T0 + REQUEST_DEDUPE_MS + HOUR;
    expect(shouldEmitRequest(await loadProfileRequestMemo(G, T), sevenDaysAfterT0)).toBe(false);

    // Past 7d after the LAST attempt → emit is allowed, attempts resets to 1
    const past7dAfterLast = T0 + 4 * HOUR + REQUEST_DEDUPE_MS + 1;
    expect(shouldEmitRequest(await loadProfileRequestMemo(G, T), past7dAfterLast)).toBe(true);

    await recordRequestEmitted(G, T, past7dAfterLast);
    const after = await loadProfileRequestMemo(G, T);
    expect(after!.attempts).toBe(1);
    expect(after!.lastRequestAt).toBe(past7dAfterLast);
    expect(after!.lastAnsweredAt).toBeNull();
  });

  it('answer arrival resets attempts to 0 and blocks further requests for 7d', async () => {
    await recordRequestEmitted(G, T, T0);
    await recordRequestEmitted(G, T, T0 + 2 * HOUR);
    await recordRequestAnswered(G, T, T0 + 3 * HOUR);

    const memo = await loadProfileRequestMemo(G, T);
    expect(memo!.attempts).toBe(0);
    expect(memo!.lastAnsweredAt).toBe(T0 + 3 * HOUR);

    // Anywhere inside the 7d post-answer window → skip
    expect(shouldEmitRequest(memo, T0 + 6 * DAY)).toBe(false);
    // Past 7d → eligible again
    expect(shouldEmitRequest(memo, T0 + 3 * HOUR + REQUEST_DEDUPE_MS + 1)).toBe(true);
  });

  it('clearProfileRequestMemos(groupId) deletes only that group, * deletes all', async () => {
    await recordRequestEmitted('g-a', 't1', T0);
    await recordRequestEmitted('g-a', 't2', T0);
    await recordRequestEmitted('g-b', 't3', T0);

    await clearProfileRequestMemos('g-a');
    expect(await loadProfileRequestMemo('g-a', 't1')).toBeNull();
    expect(await loadProfileRequestMemo('g-a', 't2')).toBeNull();
    expect(await loadProfileRequestMemo('g-b', 't3')).not.toBeNull();

    await clearProfileRequestMemos('*');
    expect(await loadProfileRequestMemo('g-b', 't3')).toBeNull();
  });

  it('saveProfileRequestMemo persists shape verbatim', async () => {
    const memo = {
      groupId: G,
      targetPubkey: T,
      lastRequestAt: T0,
      lastAnsweredAt: T0 + HOUR,
      attempts: 2,
    };
    await saveProfileRequestMemo(memo);
    expect(await loadProfileRequestMemo(G, T)).toEqual(memo);
  });
});
