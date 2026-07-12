/**
 * Pure-math + state-machine tests for scheduler.ts (epic:
 * direct-contact-profile-exchange, story S02). No idb-keyval, no fake time
 * APIs — every clock value is an explicit parameter, per the pure-core
 * convention this module follows (mirrors nonceStore.ts/pendingIntent.ts).
 *
 * "Property tests" here are hand-rolled parametric sweeps (repo convention:
 * no fast-check), each annotated with the mutant it kills.
 */

import { describe, it, expect } from 'vitest';
import {
  LADDER_HOURS,
  CAP_HOURS,
  JITTER_FRACTION,
  GIVE_UP_CEILING_SECONDS,
  RESET_RATE_LIMIT_SECONDS,
  nominalIntervalHours,
  applyJitter,
  createInitialSchedule,
  advance,
  markAnsweredIncomplete,
  applyReachabilitySignal,
  isCompletingAnnounce,
  computeDue,
  computeIncompleteSet,
  computeContactsNeedingNewSchedule,
  clampScheduleOnLoad,
  type ProfileSchedule,
} from '@/src/lib/dmProfile/scheduler';

const HOUR = 3600;
const DAY = 24 * HOUR;
const T0 = 1_700_000_000;
const PUBKEY = 'ABCDEF0123456789abcdef0123456789abcdef0123456789abcdef01234567'.slice(0, 64);

// A deterministic rng sequence, so jitter tests are exact, not merely bounded.
function fixedRng(...values: number[]): () => number {
  let i = 0;
  return () => {
    const v = values[Math.min(i, values.length - 1)];
    i++;
    return v;
  };
}

describe('nominalIntervalHours — the ladder (VQ-S02-001, VQ-S02-004)', () => {
  it('sweeps every rung 1..6 to the exact ladder values, not a frozen constant', () => {
    // Mutant killed: a stand-in that always returns e.g. 1 for every attempt.
    expect(LADDER_HOURS).toEqual([1, 2, 4, 8, 16, 24]);
    for (let n = 1; n <= LADDER_HOURS.length; n++) {
      expect(nominalIntervalHours(n)).toBe(LADDER_HOURS[n - 1]);
    }
  });

  it('caps at 24h for every attempt beyond the ladder length (7, 8, 100)', () => {
    // Mutant killed: an off-by-one that returns undefined/NaN past index 6,
    // or a cap that keeps growing instead of holding at 24.
    expect(nominalIntervalHours(7)).toBe(CAP_HOURS);
    expect(nominalIntervalHours(8)).toBe(CAP_HOURS);
    expect(nominalIntervalHours(100)).toBe(CAP_HOURS);
  });

  it('the nominal ladder is monotonically non-decreasing before jitter', () => {
    // Mutant killed: a shuffled or non-monotonic ladder table.
    let prev = 0;
    for (let n = 1; n <= 10; n++) {
      const cur = nominalIntervalHours(n);
      expect(cur).toBeGreaterThanOrEqual(prev);
      prev = cur;
    }
  });
});

describe('applyJitter — ±20% bound (D2, VQ-S02-004)', () => {
  it('never exceeds the ±20% bound across a dense rng sweep, for every rung', () => {
    // Mutant killed: a jitter fraction constant changed to something other
    // than 0.2, or a jitter formula that can exceed its own bound.
    expect(JITTER_FRACTION).toBe(0.2);
    for (const hours of [...LADDER_HOURS, CAP_HOURS]) {
      const nominalSeconds = hours * HOUR;
      for (let i = 0; i <= 20; i++) {
        const r = i / 20; // dense sweep of rng() ∈ [0,1]
        const jittered = applyJitter(hours, () => r);
        expect(jittered).toBeGreaterThanOrEqual(Math.round(nominalSeconds * 0.8));
        expect(jittered).toBeLessThanOrEqual(Math.round(nominalSeconds * 1.2));
      }
    }
  });

  it('rng()=0 yields exactly the -20% floor and rng()=1 yields exactly the +20% ceiling', () => {
    // Mutant killed: an inverted jitter sign, or a jitter formula that
    // doesn't reach its own stated bounds at the rng extremes.
    expect(applyJitter(10, () => 0)).toBe(Math.round(10 * HOUR * 0.8));
    expect(applyJitter(10, () => 1)).toBe(Math.round(10 * HOUR * 1.2));
  });

  it('rng()=0.5 yields exactly the nominal value (no jitter)', () => {
    expect(applyJitter(10, () => 0.5)).toBe(10 * HOUR);
  });

  it('defaults to Math.random when no rng is injected (genuine entropy, not a frozen constant)', () => {
    // Mutant killed: a stand-in that ignores the rng param entirely.
    const seen = new Set<number>();
    for (let i = 0; i < 20; i++) seen.add(applyJitter(24));
    expect(seen.size).toBeGreaterThan(1);
  });

  it('rng()=0 and rng()=largest-value-below-1 hold their exact/bounded jitter for EVERY rung, including the repeating 24h cap', () => {
    // Mutant killed: a jitter formula correct only for one hard-coded rung
    // (e.g. the 10h value the two tests above happen to use) but wrong for
    // others — e.g. an off-by-rung indexing bug in a rewritten applyJitter,
    // or rounding that overshoots the +20% bound for a specific hour value.
    // NUMBER_JUST_BELOW_ONE is the largest IEEE-754 double strictly < 1 —
    // RandomSource's contract is [0,1), so Math.random() can approach this
    // but never reach exactly 1 (unlike the rng()=>1 probe above, which
    // exercises a value outside the documented domain on purpose).
    const NUMBER_JUST_BELOW_ONE = 1 - Number.EPSILON / 2;
    expect(NUMBER_JUST_BELOW_ONE).toBeLessThan(1);
    for (const hours of [...LADDER_HOURS, CAP_HOURS]) {
      const nominalSeconds = hours * HOUR;
      const floor = applyJitter(hours, () => 0);
      const nearCeiling = applyJitter(hours, () => NUMBER_JUST_BELOW_ONE);
      expect(floor).toBe(Math.round(nominalSeconds * 0.8));
      // Never exceeds the +20% bound even after rounding, and — since the
      // math only ever rounds UP TO the bound, never past it — the closed
      // bound is also the tightest correct assertion here (see file header
      // doc's rounding-boundary note).
      expect(nearCeiling).toBeLessThanOrEqual(Math.round(nominalSeconds * 1.2));
      expect(nearCeiling).toBeGreaterThan(nominalSeconds); // still meaningfully jittered upward
    }
  });
});

describe('createInitialSchedule — first fire after 1h, not immediately (AC-PROF-1, VQ-S02-006)', () => {
  it('schedules attempt=1 at now + jittered 1h, never at now', () => {
    const s = createInitialSchedule(PUBKEY, T0, fixedRng(0.5));
    expect(s.attempts).toBe(1);
    expect(s.nextAttemptAt).toBe(T0 + HOUR); // rng=0.5 → no jitter, exact 1h
    expect(s.nextAttemptAt).toBeGreaterThan(T0);
    expect(s.state).toBe('active');
    expect(s.firstAttemptAt).toBe(T0);
    expect(s.lastResetAt).toBeNull();
  });

  it('case-folds pubkeyHex on creation', () => {
    const s = createInitialSchedule(PUBKEY, T0, fixedRng(0.5));
    expect(s.pubkeyHex).toBe(PUBKEY.toLowerCase());
  });
});

describe('advance — ladder progression (AC-PROF-1, AC-PROF-11, VQ-S02-004)', () => {
  it('sweeps the full ladder in sequence with exact nominal values at rng=0.5 (no jitter)', () => {
    // Mutant killed: advance() returning a fixed interval regardless of
    // attempts, or applying the wrong rung.
    let s: ProfileSchedule = createInitialSchedule(PUBKEY, T0, fixedRng(0.5));
    const expectedRungsAfterFirst = [2, 4, 8, 16, 24, 24, 24]; // attempts 2..8
    let now = s.nextAttemptAt;
    for (const hours of expectedRungsAfterFirst) {
      s = advance(s, now, fixedRng(0.5));
      expect(s.nextAttemptAt - now).toBe(hours * HOUR);
      now = s.nextAttemptAt;
    }
    expect(s.attempts).toBe(8);
    expect(s.state).toBe('active');
  });

  it('increments attempts by exactly 1 per call (not frozen, not double-incrementing)', () => {
    let s = createInitialSchedule(PUBKEY, T0, fixedRng(0.5));
    for (let expected = 2; expected <= 5; expected++) {
      s = advance(s, s.nextAttemptAt, fixedRng(0.5));
      expect(s.attempts).toBe(expected);
    }
  });

  it('is a no-op for a non-active schedule (answered-incomplete, given-up)', () => {
    const incomplete = markAnsweredIncomplete(createInitialSchedule(PUBKEY, T0, fixedRng(0.5)));
    expect(advance(incomplete, T0 + 100 * DAY)).toEqual(incomplete);

    const givenUp: ProfileSchedule = { ...incomplete, state: 'given-up' };
    expect(advance(givenUp, T0 + 100 * DAY)).toEqual(givenUp);
  });
});

describe('advance — 30-day give-up ceiling (AC-PROF-11c, VQ-S02-009)', () => {
  it('transitions active -> given-up once the streak reaches GIVE_UP_CEILING_SECONDS', () => {
    const s = createInitialSchedule(PUBKEY, T0, fixedRng(0.5));
    expect(GIVE_UP_CEILING_SECONDS).toBe(30 * DAY);
    const atCeiling = advance(s, s.firstAttemptAt + GIVE_UP_CEILING_SECONDS, fixedRng(0.5));
    expect(atCeiling.state).toBe('given-up');
  });

  it('does NOT give up one second before the ceiling', () => {
    const s = createInitialSchedule(PUBKEY, T0, fixedRng(0.5));
    const justBefore = advance(s, s.firstAttemptAt + GIVE_UP_CEILING_SECONDS - 1, fixedRng(0.5));
    expect(justBefore.state).toBe('active');
  });

  it('given-up is excluded from computeDue entirely (not a long/reduced cadence)', () => {
    const s = createInitialSchedule(PUBKEY, T0, fixedRng(0.5));
    const givenUp = advance(s, s.firstAttemptAt + GIVE_UP_CEILING_SECONDS, fixedRng(0.5));
    const farFuture = givenUp.firstAttemptAt + 365 * DAY;
    expect(computeDue([givenUp], farFuture)).toEqual([]);
  });

  it('computeDue excludes an ACTIVE, otherwise-due schedule at exactly the give-up ceiling, but includes it one second before (AC-PROF-11c boundary)', () => {
    // Distinct from advance()'s give-up transition: this is computeDue's OWN
    // ceiling arm, exercised on a still-`active` schedule (never transitioned
    // to 'given-up'). Kills the `< GIVE_UP_CEILING_SECONDS` -> `<=` mutant,
    // observable only at the exact ceiling.
    const nowSec = T0 + 90 * DAY;
    const dueActive = (firstAttemptAt: number): ProfileSchedule => ({
      pubkeyHex: PUBKEY.toLowerCase(),
      attempts: 5,
      nextAttemptAt: nowSec - HOUR, // due (nowSec >= nextAttemptAt)
      state: 'active',
      firstAttemptAt,
      lastResetAt: null,
    });

    const atCeiling = dueActive(nowSec - GIVE_UP_CEILING_SECONDS);
    expect(computeDue([atCeiling], nowSec)).toEqual([]); // given up AT the ceiling

    const oneSecondBefore = dueActive(nowSec - GIVE_UP_CEILING_SECONDS + 1);
    expect(computeDue([oneSecondBefore], nowSec)).toEqual([oneSecondBefore]);
  });

  it('the give-up decision is purely time-based, never attempt-count-based, even at attempts far beyond the ladder', () => {
    // Mutant killed: an `attempts >= N` (or similar count-based) substitute
    // for the wall-clock ceiling check — attempts=100 is nowhere close to a
    // literal ladder-length or a plausible hard-coded count threshold, so
    // this would only be caught by asserting the ceiling fires (or doesn't)
    // strictly according to elapsed time regardless of how large attempts is.
    const highAttemptsJustBefore: ProfileSchedule = {
      pubkeyHex: PUBKEY.toLowerCase(),
      attempts: 100,
      nextAttemptAt: T0,
      state: 'active',
      firstAttemptAt: T0 - (GIVE_UP_CEILING_SECONDS - 1),
      lastResetAt: null,
    };
    const stillActive = advance(highAttemptsJustBefore, T0, fixedRng(0.5));
    expect(stillActive.state).toBe('active');
    expect(stillActive.attempts).toBe(101);

    const highAttemptsAtCeiling: ProfileSchedule = {
      ...highAttemptsJustBefore,
      attempts: 50,
      firstAttemptAt: T0 - GIVE_UP_CEILING_SECONDS,
    };
    const givesUp = advance(highAttemptsAtCeiling, T0, fixedRng(0.5));
    expect(givesUp.state).toBe('given-up');
  });
});

describe('Fuller lifecycle: reset -> ladder cap again -> given-up (AC-PROF-11, AC-PROF-11c)', () => {
  it('a D4 reset restarts the 30-day give-up clock from the reset time, not the original firstAttemptAt', () => {
    // Mutant killed: applyReachabilitySignal failing to overwrite
    // firstAttemptAt on reset, which would either give up prematurely
    // (anchored to the stale original streak start) or never give up
    // (if the give-up check were mistakenly skipped after any reset).
    let s = createInitialSchedule(PUBKEY, T0, fixedRng(0.5));
    // Walk the streak past the ladder into the repeating 24h cap.
    for (let i = 0; i < 8; i++) {
      s = advance(s, s.nextAttemptAt, fixedRng(0.5));
    }
    expect(s.attempts).toBe(9);
    expect(s.state).toBe('active');

    // A D4 signal arrives long after the original firstAttemptAt (more
    // than 30 days from T0), resetting the streak.
    const resetAt = T0 + 40 * DAY;
    const reset = applyReachabilitySignal(s, resetAt, fixedRng(0.5));
    expect(reset.attempts).toBe(1);
    expect(reset.firstAttemptAt).toBe(resetAt);
    expect(reset.state).toBe('active');

    // Walk the NEW streak back up through the ladder into the cap again.
    let s2 = reset;
    for (let i = 0; i < 8; i++) {
      s2 = advance(s2, s2.nextAttemptAt, fixedRng(0.5));
    }
    expect(s2.attempts).toBe(9);
    expect(s2.state).toBe('active');

    // One second before 30 days past the RESET (not the original streak):
    // still active — proves the ceiling tracks the reset anchor.
    const justBeforeNewCeiling = advance(s2, reset.firstAttemptAt + GIVE_UP_CEILING_SECONDS - 1, fixedRng(0.5));
    expect(justBeforeNewCeiling.state).toBe('active');

    // Exactly 30 days past the reset: gives up.
    const givesUp = advance(s2, reset.firstAttemptAt + GIVE_UP_CEILING_SECONDS, fixedRng(0.5));
    expect(givesUp.state).toBe('given-up');
  });
});

describe('markAnsweredIncomplete — terminal state (AC-PROF-11a, VQ-S02-008)', () => {
  it('drops the schedule from computeDue entirely regardless of how much time passes', () => {
    const s = createInitialSchedule(PUBKEY, T0, fixedRng(0.5));
    const answeredIncomplete = markAnsweredIncomplete(s);
    expect(answeredIncomplete.state).toBe('answered-incomplete');
    // Not a long/reduced cadence: due-check excludes it forever, not just for a while.
    expect(computeDue([answeredIncomplete], T0 + 365 * DAY)).toEqual([]);
  });
});

describe('applyReachabilitySignal — D4 reset-on-activity + re-arm (AC-PROF-11, AC-PROF-11a, AC-PROF-11c, VQ-S02-007)', () => {
  it('resets an active, mid-ladder schedule back to the 1h floor', () => {
    let s = createInitialSchedule(PUBKEY, T0, fixedRng(0.5));
    s = advance(s, s.nextAttemptAt, fixedRng(0.5)); // attempts=2, at the 2h rung
    s = advance(s, s.nextAttemptAt, fixedRng(0.5)); // attempts=3, at the 4h rung
    const resetAt = s.nextAttemptAt + 100;
    const reset = applyReachabilitySignal(s, resetAt, fixedRng(0.5));
    expect(reset.attempts).toBe(1);
    expect(reset.nextAttemptAt).toBe(resetAt + HOUR);
    expect(reset.state).toBe('active');
    expect(reset.lastResetAt).toBe(resetAt);
  });

  it('a second reset within 24h of the first is a no-op', () => {
    const s = createInitialSchedule(PUBKEY, T0, fixedRng(0.5));
    const firstReset = applyReachabilitySignal(s, T0 + HOUR, fixedRng(0.5));
    const secondAttempt = applyReachabilitySignal(firstReset, T0 + HOUR + RESET_RATE_LIMIT_SECONDS - 1, fixedRng(0.5));
    expect(secondAttempt).toEqual(firstReset);
  });

  it('a reset arriving exactly at (or past) the 24h boundary applies', () => {
    const s = createInitialSchedule(PUBKEY, T0, fixedRng(0.5));
    const firstReset = applyReachabilitySignal(s, T0 + HOUR, fixedRng(0.5));
    const laterResetAt = T0 + HOUR + RESET_RATE_LIMIT_SECONDS;
    const secondReset = applyReachabilitySignal(firstReset, laterResetAt, fixedRng(0.5));
    expect(secondReset.lastResetAt).toBe(laterResetAt);
    expect(secondReset.nextAttemptAt).toBe(laterResetAt + HOUR);
  });

  it('re-arms an answered-incomplete schedule back to active at the 1h floor', () => {
    const s = markAnsweredIncomplete(createInitialSchedule(PUBKEY, T0, fixedRng(0.5)));
    const rearmAt = T0 + 5 * DAY;
    const rearmed = applyReachabilitySignal(s, rearmAt, fixedRng(0.5));
    expect(rearmed.state).toBe('active');
    expect(rearmed.attempts).toBe(1);
    expect(rearmed.nextAttemptAt).toBe(rearmAt + HOUR);
    expect(computeDue([rearmed], rearmAt + HOUR)).toEqual([rearmed]);
  });

  it('re-arms a given-up schedule back to active at the 1h floor', () => {
    let s = createInitialSchedule(PUBKEY, T0, fixedRng(0.5));
    s = advance(s, s.firstAttemptAt + GIVE_UP_CEILING_SECONDS, fixedRng(0.5));
    expect(s.state).toBe('given-up');
    const rearmAt = s.firstAttemptAt + GIVE_UP_CEILING_SECONDS + 10 * DAY;
    const rearmed = applyReachabilitySignal(s, rearmAt, fixedRng(0.5));
    expect(rearmed.state).toBe('active');
    expect(rearmed.attempts).toBe(1);
    expect(rearmed.firstAttemptAt).toBe(rearmAt);
  });
});

describe('isCompletingAnnounce — pure predicate (AC-PROF-6 completing definition)', () => {
  it('true only when the LWW write landed AND avatar is non-null', () => {
    expect(isCompletingAnnounce({ lwwWon: true, avatarNonNull: true })).toBe(true);
    expect(isCompletingAnnounce({ lwwWon: true, avatarNonNull: false })).toBe(false);
    expect(isCompletingAnnounce({ lwwWon: false, avatarNonNull: true })).toBe(false);
    expect(isCompletingAnnounce({ lwwWon: false, avatarNonNull: false })).toBe(false);
  });
});

describe('computeDue — the seam story 05 consumes (VQ-S02-010)', () => {
  it('selects only active schedules whose nextAttemptAt has arrived', () => {
    const due: ProfileSchedule = createInitialSchedule('a'.repeat(64), T0, fixedRng(0.5));
    const notYetDue: ProfileSchedule = createInitialSchedule('b'.repeat(64), T0 + HOUR, fixedRng(0.5));
    const result = computeDue([due, notYetDue], due.nextAttemptAt);
    expect(result).toEqual([due]);
  });

  it('never returns answered-incomplete or given-up entries even when nextAttemptAt has "arrived"', () => {
    const stale = markAnsweredIncomplete(createInitialSchedule('a'.repeat(64), T0, fixedRng(0.5)));
    const givenUp: ProfileSchedule = { ...stale, state: 'given-up' };
    expect(computeDue([stale, givenUp], T0 + 1000 * DAY)).toEqual([]);
  });

  it('boundary: nowSec exactly equal to nextAttemptAt counts as due (inclusive)', () => {
    const s = createInitialSchedule(PUBKEY, T0, fixedRng(0.5));
    expect(computeDue([s], s.nextAttemptAt)).toEqual([s]);
    expect(computeDue([s], s.nextAttemptAt - 1)).toEqual([]);
  });

  it('(VQ-S02-015) does NOT leak a still-active schedule whose give-up ceiling has already elapsed', () => {
    // Mutant killed: a computeDue that only checks state==='active' &&
    // nowSec>=nextAttemptAt would return this schedule — one fire past the
    // 30-day ceiling — before advance() gets a chance to transition it to
    // 'given-up'. The app having slept past the ceiling, or a prior
    // advance() call scheduling a fire beyond it, both produce exactly
    // this shape: state still 'active', nextAttemptAt in the past, but
    // firstAttemptAt already >=30 days behind nowSec.
    const s: ProfileSchedule = {
      ...createInitialSchedule(PUBKEY, T0, fixedRng(0.5)),
      firstAttemptAt: T0,
      nextAttemptAt: T0 + 31 * DAY, // in the past relative to nowSec below
      state: 'active',
    };
    const nowSec = T0 + 31 * DAY; // firstAttemptAt is 31 days behind nowSec — past GIVE_UP_CEILING_SECONDS (30d)
    expect(computeDue([s], nowSec)).toEqual([]);
  });

  it('(VQ-S02-015) still returns a due, active schedule one second BEFORE its give-up ceiling elapses', () => {
    const s: ProfileSchedule = {
      ...createInitialSchedule(PUBKEY, T0, fixedRng(0.5)),
      firstAttemptAt: T0,
      nextAttemptAt: T0 + 100,
      state: 'active',
    };
    const nowSec = T0 + GIVE_UP_CEILING_SECONDS - 1;
    expect(computeDue([s], nowSec)).toEqual([s]);
  });
});

describe('computeIncompleteSet — §3.1 rules', () => {
  const OWN = 'own'.padEnd(64, '0');
  const A = 'a'.repeat(64);
  const B = 'b'.repeat(64);
  const C = 'c'.repeat(64);
  const STRANGER = 'd'.repeat(64); // not in contacts list

  it('includes a contact with no cache entry', () => {
    const result = computeIncompleteSet([{ pubkeyHex: A, archived: false }], [], OWN);
    expect(result).toEqual([A]);
  });

  it('includes a contact whose cache entry has a null avatar', () => {
    const result = computeIncompleteSet(
      [{ pubkeyHex: A, archived: false }],
      [{ pubkeyHex: A, avatarNonNull: false }],
      OWN,
    );
    expect(result).toEqual([A]);
  });

  it('excludes a contact whose cache entry has a non-null avatar', () => {
    const result = computeIncompleteSet(
      [{ pubkeyHex: A, archived: false }],
      [{ pubkeyHex: A, avatarNonNull: true }],
      OWN,
    );
    expect(result).toEqual([]);
  });

  it('excludes the own pubkey even when incomplete', () => {
    const result = computeIncompleteSet([{ pubkeyHex: OWN, archived: false }], [], OWN);
    expect(result).toEqual([]);
  });

  it('excludes an archived contact even when incomplete', () => {
    const result = computeIncompleteSet([{ pubkeyHex: A, archived: true }], [], OWN);
    expect(result).toEqual([]);
  });

  it('excludes a cache entry for a pubkey not present in the contact list (stranger)', () => {
    const result = computeIncompleteSet(
      [{ pubkeyHex: A, archived: false }],
      [
        { pubkeyHex: A, avatarNonNull: true },
        { pubkeyHex: STRANGER, avatarNonNull: false },
      ],
      OWN,
    );
    expect(result).toEqual([]);
  });

  it('mixed set: only the genuinely-incomplete, non-own, non-archived contacts are returned', () => {
    const result = computeIncompleteSet(
      [
        { pubkeyHex: A, archived: false }, // no cache entry -> incomplete
        { pubkeyHex: B, archived: false }, // avatar present -> complete
        { pubkeyHex: C, archived: true }, // incomplete but archived -> excluded
      ],
      [{ pubkeyHex: B, avatarNonNull: true }],
      OWN,
    );
    expect(result).toEqual([A]);
  });

  it('is case-insensitive when matching contacts against cache entries', () => {
    const result = computeIncompleteSet(
      [{ pubkeyHex: A.toUpperCase(), archived: false }],
      [{ pubkeyHex: A, avatarNonNull: true }],
      OWN,
    );
    expect(result).toEqual([]);
  });
});

describe('computeContactsNeedingNewSchedule — terminal-resurrection guard (Stage-1 review remediation, AC-PROF-11a/11c)', () => {
  const A = 'a'.repeat(64);
  const B = 'b'.repeat(64);
  const C = 'c'.repeat(64);
  const D = 'd'.repeat(64);

  it('(a) an incomplete contact with no existing schedule is returned', () => {
    const result = computeContactsNeedingNewSchedule([A], []);
    expect(result).toEqual([A]);
  });

  it('(b) an incomplete contact with an active schedule is NOT returned — the watcher advances it, never recreates it', () => {
    // Mutant killed: a naive "no ACTIVE schedule" filter that only checks
    // state==='active' would wrongly re-include a terminal contact too;
    // this test pins that an active schedule alone is sufficient to exclude.
    const activeSchedule = createInitialSchedule(A, T0, fixedRng(0.5));
    const result = computeContactsNeedingNewSchedule([A], [activeSchedule]);
    expect(result).toEqual([]);
  });

  it('(c) an incomplete contact with an answered-incomplete schedule is NOT returned — not resurrected', () => {
    const terminal = markAnsweredIncomplete(createInitialSchedule(B, T0, fixedRng(0.5)));
    const result = computeContactsNeedingNewSchedule([B], [terminal]);
    expect(result).toEqual([]);
  });

  it('(d) an incomplete contact with a given-up schedule is NOT returned — not resurrected', () => {
    let s = createInitialSchedule(C, T0, fixedRng(0.5));
    s = advance(s, s.firstAttemptAt + GIVE_UP_CEILING_SECONDS, fixedRng(0.5));
    expect(s.state).toBe('given-up');
    const result = computeContactsNeedingNewSchedule([C], [s]);
    expect(result).toEqual([]);
  });

  it('(e) case-mismatch between the incomplete-set pubkey and the existing schedule key still joins correctly', () => {
    const existing = createInitialSchedule(D, T0, fixedRng(0.5)); // stored lowercase
    const result = computeContactsNeedingNewSchedule([D.toUpperCase()], [existing]);
    expect(result).toEqual([]);
  });

  it('mixed set: only genuinely schedule-less incomplete contacts are returned, deduped and lowercased', () => {
    const activeSchedule = createInitialSchedule(A, T0, fixedRng(0.5));
    const terminal = markAnsweredIncomplete(createInitialSchedule(B, T0, fixedRng(0.5)));
    const result = computeContactsNeedingNewSchedule([A, B, C, C.toUpperCase()], [activeSchedule, terminal]);
    expect(result).toEqual([C]);
  });
});

describe('clampScheduleOnLoad — backwards clock-jump guard (AC-PROF-1, VQ-S02-005)', () => {
  it('clamps nextAttemptAt down to now + 24h when a backwards clock jump makes it look far in the future', () => {
    const s = createInitialSchedule(PUBKEY, T0, fixedRng(0.5));
    // Simulate a backwards jump: "now" is much earlier than when the store
    // last computed nextAttemptAt against a since-corrected clock.
    const jumpedNow = s.nextAttemptAt - 100 * DAY;
    const clamped = clampScheduleOnLoad(s, jumpedNow);
    expect(clamped.nextAttemptAt).toBe(jumpedNow + CAP_HOURS * HOUR);
  });

  it('is a no-op when nextAttemptAt is within the now+24h bound', () => {
    const s = createInitialSchedule(PUBKEY, T0, fixedRng(0.5));
    const clamped = clampScheduleOnLoad(s, T0);
    expect(clamped).toEqual(s);
  });

  it('boundary: exactly now+24h is left unclamped', () => {
    const s: ProfileSchedule = { ...createInitialSchedule(PUBKEY, T0, fixedRng(0.5)), nextAttemptAt: T0 + CAP_HOURS * HOUR };
    const clamped = clampScheduleOnLoad(s, T0);
    expect(clamped.nextAttemptAt).toBe(T0 + CAP_HOURS * HOUR);
  });
});
