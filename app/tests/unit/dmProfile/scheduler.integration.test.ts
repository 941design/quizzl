/**
 * Integration test for scheduler.ts's idb-keyval CRUD adapter against a real
 * IDB-API surface (fake-indexeddb/auto), mirroring
 * app/tests/unit/profileRequestStorage.integration.test.ts's convention.
 * The storage module is exercised end-to-end (its own createStore call, its
 * own get/set/del/entries) — not mocked.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { createStore, set as idbSet, get as idbGet } from 'idb-keyval';
import {
  saveSchedule,
  loadSchedule,
  loadAllSchedules,
  deleteSchedule,
  clearAllSchedulesForTests,
  createInitialSchedule,
  advance,
  markAnsweredIncomplete,
  computeDue,
  CAP_HOURS,
  type ProfileSchedule,
} from '@/src/lib/dmProfile/scheduler';

// Same (dbName, storeName) scheduler.ts uses internally — lets tests write a
// record directly, bypassing saveSchedule, to simulate a pre-existing/
// malformed record (e.g. from an older code version) that never went
// through the case-folding write path.
const rawScheduleStore = createStore('few-dm-profile-schedule', 'schedules');

const HOUR = 3600;
const DAY = 24 * HOUR;
const T0 = 1_700_000_000;
const PUBKEY = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9';

function fixedRng(value: number): () => number {
  return () => value;
}

describe('scheduler.ts — idb-keyval persistence (AC-PROF-1, VQ-S02-005, VQ-S02-006)', () => {
  beforeEach(async () => {
    await clearAllSchedulesForTests();
  });

  it('saveSchedule + loadSchedule round-trips a schedule verbatim (mod case-fold)', async () => {
    const s = createInitialSchedule(PUBKEY, T0, fixedRng(0.5));
    await saveSchedule(s);
    const loaded = await loadSchedule(PUBKEY, T0);
    expect(loaded).toEqual(s);
  });

  it('loadSchedule returns undefined for an absent pubkey', async () => {
    expect(await loadSchedule('f'.repeat(64), T0)).toBeUndefined();
  });

  it('case-folds the store key on write: an uppercase pubkeyHex is retrievable via lowercase lookup and vice versa', async () => {
    const s = createInitialSchedule(PUBKEY.toUpperCase(), T0, fixedRng(0.5));
    await saveSchedule(s);
    const viaLower = await loadSchedule(PUBKEY.toLowerCase(), T0);
    const viaUpper = await loadSchedule(PUBKEY.toUpperCase(), T0);
    expect(viaLower).toBeDefined();
    expect(viaLower).toEqual(viaUpper);
    expect(viaLower!.pubkeyHex).toBe(PUBKEY.toLowerCase());
  });

  it('persists across a simulated page reload with no reset to the 1h floor (AC-PROF-1)', async () => {
    // Mutant killed: a load path that silently re-initializes any schedule
    // it can't recognize instead of returning the persisted attempts count.
    let s = createInitialSchedule(PUBKEY, T0, fixedRng(0.5));
    s = advance(s, s.nextAttemptAt, fixedRng(0.5)); // attempts=2, at the 2h rung
    s = advance(s, s.nextAttemptAt, fixedRng(0.5)); // attempts=3, at the 4h rung
    await saveSchedule(s);

    // "Simulated restart": load fresh, as a newly-booted app would.
    const reloaded = await loadSchedule(PUBKEY, s.nextAttemptAt);
    expect(reloaded).toBeDefined();
    expect(reloaded!.attempts).toBe(3);
    expect(reloaded!.nextAttemptAt).toBe(s.nextAttemptAt);
    expect(reloaded!.state).toBe('active');
  });

  it('loadAllSchedules returns every persisted schedule, clamped', async () => {
    const s1 = createInitialSchedule('a'.repeat(64), T0, fixedRng(0.5));
    const s2 = createInitialSchedule('b'.repeat(64), T0, fixedRng(0.5));
    await saveSchedule(s1);
    await saveSchedule(s2);
    const all = await loadAllSchedules(T0);
    expect(all.length).toBe(2);
    const byKey = new Map(all.map((s) => [s.pubkeyHex, s]));
    expect(byKey.get(s1.pubkeyHex)).toEqual(s1);
    expect(byKey.get(s2.pubkeyHex)).toEqual(s2);
  });

  it('loadSchedule clamps a backwards-clock-jumped nextAttemptAt to now+24h on read', async () => {
    const s = createInitialSchedule(PUBKEY, T0, fixedRng(0.5));
    await saveSchedule(s);
    const jumpedNow = s.nextAttemptAt - 365 * DAY;
    const reloaded = await loadSchedule(PUBKEY, jumpedNow);
    expect(reloaded!.nextAttemptAt).toBe(jumpedNow + CAP_HOURS * HOUR);
    // No retry storm: the clamped value is still in the future relative to the jumped clock.
    expect(reloaded!.nextAttemptAt).toBeGreaterThan(jumpedNow);
  });

  it('loadAllSchedules clamps every entry independently', async () => {
    const fresh = createInitialSchedule('a'.repeat(64), T0, fixedRng(0.5));
    let stale = createInitialSchedule('b'.repeat(64), T0, fixedRng(0.5));
    stale = advance(stale, stale.nextAttemptAt, fixedRng(0.5));
    await saveSchedule(fresh);
    await saveSchedule(stale);

    const jumpedNow = T0 - 365 * DAY;
    const all = await loadAllSchedules(jumpedNow);
    const byKey = new Map(all.map((s) => [s.pubkeyHex, s]));
    expect(byKey.get(fresh.pubkeyHex)!.nextAttemptAt).toBe(jumpedNow + CAP_HOURS * HOUR);
    expect(byKey.get(stale.pubkeyHex)!.nextAttemptAt).toBe(jumpedNow + CAP_HOURS * HOUR);
  });

  it('(VQ-S02-015) loadSchedule durably PERSISTS the clamp, so a second reload at an unchanged clock returns the SAME clamped value instead of re-pushing it forward', async () => {
    // Mutant killed: a loadSchedule that clamps in-memory but never writes
    // the clamped value back would, on every reload while the clock stays
    // behind, re-derive a FRESH now+24h off a `now` that creeps forward —
    // so the schedule's effective fire time keeps sliding and never
    // arrives. This test proves the clamp is durable, not transient.
    const s = createInitialSchedule(PUBKEY, T0, fixedRng(0.5));
    await saveSchedule(s);
    const jumpedNow = s.nextAttemptAt - 365 * DAY;
    const expectedClamp = jumpedNow + CAP_HOURS * HOUR;

    const firstLoad = await loadSchedule(PUBKEY, jumpedNow);
    expect(firstLoad!.nextAttemptAt).toBe(expectedClamp);

    // Confirm the clamp was actually written back to the store (not just
    // returned in-memory) by reading the raw record directly.
    const rawAfterFirstLoad = await idbGet<ProfileSchedule>(PUBKEY, rawScheduleStore);
    expect(rawAfterFirstLoad!.nextAttemptAt).toBe(expectedClamp);

    // Second load at the SAME (still-behind) clock: must return the exact
    // same clamped value, not `jumpedNow + CAP_HOURS*HOUR` re-derived off a
    // clock that has since crept forward in a real reload loop.
    const secondLoad = await loadSchedule(PUBKEY, jumpedNow);
    expect(secondLoad!.nextAttemptAt).toBe(expectedClamp);

    // Recovery: the persisted, clamped schedule fires ~24h after the first
    // clamp — computeDue observes it as due once nowSec reaches that value.
    expect(computeDue([secondLoad!], expectedClamp)).toEqual([secondLoad]);
  });

  it('(VQ-S02-015) loadAllSchedules durably persists a clamp for every entry it lowers', async () => {
    const s = createInitialSchedule(PUBKEY, T0, fixedRng(0.5));
    await saveSchedule(s);
    const jumpedNow = T0 - 365 * DAY;
    const expectedClamp = jumpedNow + CAP_HOURS * HOUR;

    await loadAllSchedules(jumpedNow);
    const rawAfterLoad = await idbGet<ProfileSchedule>(PUBKEY, rawScheduleStore);
    expect(rawAfterLoad!.nextAttemptAt).toBe(expectedClamp);

    // A second bulk load at the same clock must not re-derive a further-forward value.
    const second = await loadAllSchedules(jumpedNow);
    expect(second[0].nextAttemptAt).toBe(expectedClamp);
  });

  it('(VQ-S02-015) does NOT persist (no-op write) when no clamping was needed', async () => {
    const s = createInitialSchedule(PUBKEY, T0, fixedRng(0.5));
    await saveSchedule(s);
    await loadSchedule(PUBKEY, T0); // clock not jumped — no clamp needed
    const raw = await idbGet<ProfileSchedule>(PUBKEY, rawScheduleStore);
    expect(raw!.nextAttemptAt).toBe(s.nextAttemptAt); // unchanged
  });

  it('deleteSchedule removes a persisted schedule (case-folded key) — the completing-announce / archive path', async () => {
    const s = createInitialSchedule(PUBKEY.toUpperCase(), T0, fixedRng(0.5));
    await saveSchedule(s);
    expect(await loadSchedule(PUBKEY, T0)).toBeDefined();
    await deleteSchedule(PUBKEY.toLowerCase());
    expect(await loadSchedule(PUBKEY, T0)).toBeUndefined();
  });

  it('clearAllSchedulesForTests wipes the whole store', async () => {
    await saveSchedule(createInitialSchedule('a'.repeat(64), T0, fixedRng(0.5)));
    await saveSchedule(createInitialSchedule('b'.repeat(64), T0, fixedRng(0.5)));
    await clearAllSchedulesForTests();
    expect(await loadAllSchedules(T0)).toEqual([]);
  });

  it('saveSchedule persists updated state transitions (e.g. given-up) verbatim', async () => {
    let s = createInitialSchedule(PUBKEY, T0, fixedRng(0.5));
    s = advance(s, s.firstAttemptAt + 30 * DAY, fixedRng(0.5));
    expect(s.state).toBe('given-up');
    await saveSchedule(s);
    const reloaded = await loadSchedule(PUBKEY, s.firstAttemptAt + 30 * DAY);
    expect(reloaded!.state).toBe('given-up');
  });

  it('loadSchedule defensively re-folds pubkeyHex even for a record written with mismatched case outside saveSchedule', async () => {
    // Mutant killed: a load path that trusts the stored record's pubkeyHex
    // verbatim instead of folding it to match the (already-lowercase)
    // lookup key — would leak an uppercase pubkeyHex from a pre-existing/
    // malformed record (e.g. written by an older code version) into
    // callers that pattern-match on pubkeyHex case-sensitively.
    const mismatched: ProfileSchedule = { ...createInitialSchedule(PUBKEY, T0, fixedRng(0.5)), pubkeyHex: PUBKEY.toUpperCase() };
    await idbSet(PUBKEY.toLowerCase(), mismatched, rawScheduleStore);
    const loaded = await loadSchedule(PUBKEY, T0);
    expect(loaded!.pubkeyHex).toBe(PUBKEY.toLowerCase());
  });

  it('loadAllSchedules defensively re-folds pubkeyHex to each entry\'s own store key', async () => {
    const mismatchedA: ProfileSchedule = { ...createInitialSchedule('a'.repeat(64), T0, fixedRng(0.5)), pubkeyHex: 'A'.repeat(64) };
    await idbSet('a'.repeat(64), mismatchedA, rawScheduleStore);
    const all = await loadAllSchedules(T0);
    expect(all).toHaveLength(1);
    expect(all[0].pubkeyHex).toBe('a'.repeat(64));
  });

  it('a terminal-state schedule survives a backwards clock jump as still-terminal and never resurfaces via computeDue', async () => {
    // Mutant killed: clampScheduleOnLoad (or the load path around it)
    // accidentally reviving a terminal schedule's due-ness by rewriting
    // its nextAttemptAt into something computeDue would treat as due,
    // or a load path that drops the terminal state on clamp.
    let s = createInitialSchedule(PUBKEY, T0, fixedRng(0.5));
    s = markAnsweredIncomplete(s); // nextAttemptAt is now stale/meaningless
    await saveSchedule(s);

    const jumpedNow = T0 - 365 * DAY; // clock jumped far back
    const reloaded = await loadSchedule(PUBKEY, jumpedNow);
    expect(reloaded!.state).toBe('answered-incomplete');
    expect(computeDue([reloaded!], jumpedNow)).toEqual([]);
    // Even at the clamped nextAttemptAt itself, still never due.
    expect(computeDue([reloaded!], reloaded!.nextAttemptAt)).toEqual([]);

    const allReloaded = await loadAllSchedules(jumpedNow);
    expect(computeDue(allReloaded, jumpedNow)).toEqual([]);
  });
});
