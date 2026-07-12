/**
 * scheduler.ts — Pure backoff-ladder math + persisted per-contact schedule
 * store for the direct-contact profile-heal loop.
 *
 * Epic: direct-contact-profile-exchange | Story 02 (scheduler)
 *
 * Mirrors `app/src/lib/pairing/nonceStore.ts` / `pendingIntent.ts`'s
 * convention exactly: ONE file owns both the pure math/predicates (every
 * piece of state — clock, contact list, cache snapshot, rng — is an
 * explicit parameter, never read from a module-level singleton or the wall
 * clock) AND the idb-keyval CRUD adapter, clearly separated below. This
 * module imports NO React, NO NDK, and NO other dmProfile/contacts/
 * contactCache module — see architecture.md's "Scheduler ↔ watcher" seam
 * and `dependencies_forbidden` in this story's architecture.json. Story 05
 * (the watcher) is the only caller; it holds no backoff math of its own.
 *
 * ## Backoff ladder (AC-PROF-1, AC-PROF-11)
 *
 * Nominal (pre-jitter) attempt intervals: `1h → 2h → 4h → 8h → 16h → 24h`,
 * then 24h repeating for every attempt beyond the ladder's length. The
 * FIRST fire for a newly-incomplete contact happens after the initial 1h
 * interval — never immediately (`createInitialSchedule`). Every fire is
 * jittered by ±20% (D2, `JITTER_FRACTION`) via `applyJitter`, which accepts
 * an injectable `RandomSource` so tests can assert exact jitter bounds
 * without flakiness. "Exponential growth is monotonic before jitter" means
 * the nominal ladder itself (`LADDER_HOURS`) is non-decreasing — the ±20%
 * jitter is applied per-fire on top of that fixed nominal value, it does
 * not need to preserve strict ordering ACROSS rungs (the 16h/24h rungs sit
 * exactly at the boundary where a maximally-negative-jittered 24h fire can
 * equal a maximally-positive-jittered 16h fire: 16*1.2 === 24*0.8 === 19.2).
 *
 * ## State machine (AC-PROF-11 / 11a / 11c)
 *
 * A schedule is in exactly one of three states:
 *
 *   - `'active'` — normal backoff loop; `computeDue` may select it.
 *   - `'answered-incomplete'` — a valid, gate-passing, non-malformed
 *     announce arrived but left `avatar` empty (only reachable from a
 *     non-Few/legacy peer, AC-PROF-11a). Terminal: dropped from the
 *     periodic loop entirely (no long/reduced cadence).
 *   - `'given-up'` — the contact's total attempt span reached the 30-day
 *     ceiling with no completing announce (AC-PROF-11c). Terminal, same as
 *     above.
 *
 * Both terminal states are re-armed (restarted at the 1h floor) by the SAME
 * function, `applyReachabilitySignal`, the moment a later D4 signal (an
 * inbound gift-wrapped event from that contact OTHER than a profile-announce
 * receipt) arrives — this reuses the give-up/re-arm machinery rather than
 * introducing a third tunable interval, per spec.md's "Resolved Decisions"
 * validator-gap note. The caller (story 04/05) is responsible for NOT
 * invoking this function for an announce receipt; this module does not
 * inspect rumor kinds.
 *
 * `applyReachabilitySignal` is also how AC-PROF-11's ordinary reset-on-
 * activity works for an `'active'` schedule (same function, same rate
 * limit) — one code path handles "reset while still trying" and "re-arm
 * after giving up" identically, so they can never drift apart.
 *
 * ## The two extra fields beyond a bare `{pubkeyHex, attempts,
 * nextAttemptAt, state}` shape
 *
 * `firstAttemptAt` (epoch seconds the CURRENT streak's first fire was
 * scheduled) and `lastResetAt` (epoch seconds of the last applied D4 reset,
 * or `null` if never reset) are additive fields beyond the minimal shape
 * this story's pre-impl verification questions (VQ-S02-010) probed for.
 * Both are necessary and neither is derivable from the other three fields
 * alone:
 *
 *   - AC-PROF-11c's 30-day ceiling is a WALL-CLOCK span ("total attempt
 *     span reaches 30 days"), not a count of attempts — deriving it from
 *     `attempts` via the ladder's own nominal-hour sum would only
 *     approximate real elapsed time (off by up to the ±20% jitter actually
 *     applied at each fire, compounding over ~30 rungs), and would silently
 *     drift further if the ladder constants are ever retuned. Persisting
 *     the actual streak-start timestamp is exact and trivially testable
 *     (seed `firstAttemptAt` 30 days in the past, call `advance`, assert
 *     `state === 'given-up'`).
 *   - AC-PROF-11's "MUST NOT fire more than once per contact per 24h"
 *     requires knowing WHEN the last reset happened; nothing else in the
 *     record encodes that (`attempts`/`nextAttemptAt` right after a reset
 *     are indistinguishable from a few-hours-later state reached by
 *     ordinary, non-reset advancement).
 *
 * Both fields are opaque outside this module — story 05 (watcher) and
 * story 04 (receive) consume `ProfileSchedule` only through the exported
 * functions below (`computeDue`, `advance`, `applyReachabilitySignal`,
 * `isCompletingAnnounce`, the CRUD), never by hand-constructing or pattern-
 * matching individual fields. This is recorded as a deliberate deviation in
 * `architecture.json` and appended to `verification.json` as a post-impl
 * question rather than silently landed.
 */

import { createStore, get, set, del, entries, clear } from 'idb-keyval';

// ── Constants ────────────────────────────────────────────────────────────

/** Nominal (pre-jitter) backoff rungs, in hours, 1-based by attempt number. */
export const LADDER_HOURS = [1, 2, 4, 8, 16, 24] as const;

/** Every attempt beyond `LADDER_HOURS.length` repeats at this interval (hours). */
export const CAP_HOURS = 24;

/** ±20% jitter bound applied to every scheduled fire (D2). */
export const JITTER_FRACTION = 0.2;

/** AC-PROF-11c: total attempt span ceiling before a contact is dropped, in seconds. */
export const GIVE_UP_CEILING_SECONDS = 30 * 24 * 3600;

/** AC-PROF-11: a D4 reset-on-activity/re-arm may apply at most once per contact per this many seconds. */
export const RESET_RATE_LIMIT_SECONDS = 24 * 3600;

const SEC_PER_HOUR = 3600;

function defaultNowSec(): number {
  return Math.floor(Date.now() / 1000);
}

// ── Types ────────────────────────────────────────────────────────────────

/** The three states a persisted schedule can be in. */
export type ProfileScheduleState = 'active' | 'answered-incomplete' | 'given-up';

/**
 * A single contact's persisted backoff schedule, keyed by lowercased
 * `pubkeyHex`. See the file header doc for why `firstAttemptAt` and
 * `lastResetAt` exist beyond the minimal `{pubkeyHex, attempts,
 * nextAttemptAt, state}` shape.
 */
export type ProfileSchedule = {
  /** Lowercased hex pubkey — case-folded on every write and read (defensive, per architecture.md). */
  pubkeyHex: string;
  /** Count of fires used in the current streak since creation or the last reset. Always >= 1 once a schedule exists. */
  attempts: number;
  /** Epoch seconds of the next scheduled fire. Meaningless while `state !== 'active'`. */
  nextAttemptAt: number;
  state: ProfileScheduleState;
  /** Epoch seconds the current streak's first fire was scheduled — the give-up-ceiling anchor. */
  firstAttemptAt: number;
  /** Epoch seconds of the last applied D4 reset, or `null` if never reset — the reset-rate-limit anchor. */
  lastResetAt: number | null;
};

/** Injectable jitter source, returning a value in `[0, 1)`. Defaults to `Math.random`. */
export type RandomSource = () => number;

// ── Pure ladder + jitter math ───────────────────────────────────────────

/**
 * The nominal (pre-jitter) interval, in hours, for the Nth (1-based) fire.
 * Attempts beyond the ladder's length repeat at `CAP_HOURS`.
 */
export function nominalIntervalHours(attemptNumber: number): number {
  if (attemptNumber <= LADDER_HOURS.length) {
    return LADDER_HOURS[attemptNumber - 1];
  }
  return CAP_HOURS;
}

/**
 * Applies ±`JITTER_FRACTION` jitter to a nominal hour value and returns a
 * whole number of seconds. `rng()` is called exactly once.
 */
export function applyJitter(nominalHours: number, rng: RandomSource = Math.random): number {
  const nominalSeconds = nominalHours * SEC_PER_HOUR;
  const factor = 1 + (rng() * 2 - 1) * JITTER_FRACTION;
  return Math.round(nominalSeconds * factor);
}

// ── State machine ────────────────────────────────────────────────────────

/**
 * The first-ever schedule for a newly-incomplete contact (AC-PROF-1's
 * "first request fires after the initial 1h interval, not immediately").
 */
export function createInitialSchedule(
  pubkeyHex: string,
  nowSec: number,
  rng: RandomSource = Math.random,
): ProfileSchedule {
  const key = pubkeyHex.toLowerCase();
  return {
    pubkeyHex: key,
    attempts: 1,
    nextAttemptAt: nowSec + applyJitter(nominalIntervalHours(1), rng),
    state: 'active',
    firstAttemptAt: nowSec,
    lastResetAt: null,
  };
}

/**
 * Advances an `'active'` schedule after its due fire went out: either
 * schedules the next rung, or — if the streak has reached the 30-day
 * give-up ceiling (AC-PROF-11c) — transitions to `'given-up'` instead. A
 * no-op (returns `schedule` unchanged) for any non-`'active'` input, since
 * a terminal schedule is never re-scheduled by ordinary advancement (only
 * `applyReachabilitySignal` moves it).
 */
export function advance(
  schedule: ProfileSchedule,
  nowSec: number,
  rng: RandomSource = Math.random,
): ProfileSchedule {
  if (schedule.state !== 'active') {
    return schedule;
  }
  if (nowSec - schedule.firstAttemptAt >= GIVE_UP_CEILING_SECONDS) {
    return { ...schedule, state: 'given-up' };
  }
  const nextAttempts = schedule.attempts + 1;
  return {
    ...schedule,
    attempts: nextAttempts,
    nextAttemptAt: nowSec + applyJitter(nominalIntervalHours(nextAttempts), rng),
    state: 'active',
  };
}

/**
 * Terminal transition for AC-PROF-11a: a gate-passing, non-malformed
 * announce arrived but left `avatar` empty. Drops the contact from the
 * periodic loop entirely (not a reduced cadence) until a later D4 signal.
 */
export function markAnsweredIncomplete(schedule: ProfileSchedule): ProfileSchedule {
  return { ...schedule, state: 'answered-incomplete' };
}

/**
 * The single D4 handler for BOTH reset-on-activity (from `'active'`,
 * AC-PROF-11) and re-arm-from-terminal (from `'answered-incomplete'` or
 * `'given-up'`, AC-PROF-11a/11c): resets to the 1h floor and `'active'`.
 * Rate-limited to at most once per `RESET_RATE_LIMIT_SECONDS` — a no-op
 * (returns `schedule` unchanged) if `lastResetAt` is non-null and less
 * than that many seconds ago. The caller MUST NOT invoke this for a
 * profile-announce receipt (D4 excludes those); this function does not
 * inspect rumor kinds itself.
 */
export function applyReachabilitySignal(
  schedule: ProfileSchedule,
  nowSec: number,
  rng: RandomSource = Math.random,
): ProfileSchedule {
  if (schedule.lastResetAt !== null && nowSec - schedule.lastResetAt < RESET_RATE_LIMIT_SECONDS) {
    return schedule;
  }
  return {
    pubkeyHex: schedule.pubkeyHex,
    attempts: 1,
    nextAttemptAt: nowSec + applyJitter(nominalIntervalHours(1), rng),
    state: 'active',
    firstAttemptAt: nowSec,
    lastResetAt: nowSec,
  };
}

/**
 * Pure predicate for "this announce should clear the schedule" — true iff
 * the cache write's LWW comparison landed AND the resulting avatar is
 * non-null (AC-PROF-6's completing-announce definition). Story 04 calls
 * this after its cache write and, on `true`, calls `deleteSchedule`;
 * scheduler.ts holds no receive-path logic of its own.
 */
export function isCompletingAnnounce(params: { lwwWon: boolean; avatarNonNull: boolean }): boolean {
  return params.lwwWon && params.avatarNonNull;
}

// ── Due-check ────────────────────────────────────────────────────────────

/**
 * The due subset of `schedules`: `state === 'active'` AND `nowSec >=
 * nextAttemptAt` AND the 30-day give-up ceiling has NOT already elapsed
 * (`nowSec - firstAttemptAt < GIVE_UP_CEILING_SECONDS`). Never returns an
 * `'answered-incomplete'` or `'given-up'` entry (VQ-S02-010) — the watcher
 * (story 05) holds no additional state filter of its own.
 *
 * Codex review remediation (VQ-S02-015): a schedule can reach or pass the
 * give-up ceiling while STILL `'active'` — `advance()` is the function that
 * actually flips the state to `'given-up'`, and it only runs after a fire
 * goes out. Between "the ceiling has elapsed" and "the next `advance()`
 * call observes that", the schedule is `active` with a past-due
 * `nextAttemptAt` (e.g. the app slept past the ceiling, or a prior
 * `advance()` scheduled a fire beyond it). Without this exclusion,
 * `computeDue` would hand the watcher one more due request before
 * `advance()` gets a chance to transition it — leaking a fire past the
 * ceiling the state machine is supposed to enforce. `advance()` still
 * performs the actual state transition to `'given-up'` when it next runs
 * (so persisted state converges); this exclusion only prevents the
 * in-between leak at the due-check layer.
 */
export function computeDue(schedules: ProfileSchedule[], nowSec: number): ProfileSchedule[] {
  return schedules.filter(
    (s) =>
      s.state === 'active' &&
      nowSec >= s.nextAttemptAt &&
      nowSec - s.firstAttemptAt < GIVE_UP_CEILING_SECONDS,
  );
}

// ── Incomplete-set computation (§3.1) ────────────────────────────────────

/**
 * Minimal injected view of a contact-list entry. The watcher (story 05)
 * maps its own `contacts.ts#listContacts()` read into this shape;
 * scheduler.ts never imports contacts.ts.
 */
export type ContactSnapshot = {
  pubkeyHex: string;
  archived: boolean;
};

/**
 * Minimal injected view of a `contactCache.ts` entry for one pubkey. The
 * watcher maps its own cache read into this shape; scheduler.ts never
 * imports contactCache.ts.
 */
export type ProfileCacheSnapshot = {
  pubkeyHex: string;
  /** True iff the cached entry's avatar is present and non-null. */
  avatarNonNull: boolean;
};

/**
 * §3.1's incomplete-contact-set rule: a contact (drawn ONLY from the
 * injected `contacts` list — anything not present there is implicitly
 * excluded) is incomplete when it has no `cache` entry, or a `cache` entry
 * whose avatar is empty, EXCLUDING `ownPubkeyHex` and any archived contact.
 * Returns lowercased pubkeyHex values.
 */
export function computeIncompleteSet(
  contacts: ContactSnapshot[],
  cache: ProfileCacheSnapshot[],
  ownPubkeyHex: string,
): string[] {
  const ownLower = ownPubkeyHex.toLowerCase();
  const cacheByPubkey = new Map(cache.map((c) => [c.pubkeyHex.toLowerCase(), c] as const));
  const result: string[] = [];
  for (const contact of contacts) {
    const pk = contact.pubkeyHex.toLowerCase();
    if (pk === ownLower) continue;
    if (contact.archived) continue;
    const cached = cacheByPubkey.get(pk);
    if (!cached || !cached.avatarNonNull) {
      result.push(pk);
    }
  }
  return result;
}

/**
 * Review-remediation (Stage-1, integration hazard closer): `computeIncompleteSet`
 * is schedule-state-blind by design (it only knows about contacts/cache, not
 * schedules) — so a naive watcher loop of "for each incomplete contact,
 * createInitialSchedule if none active" would resurrect a TERMINAL
 * (`'answered-incomplete'` or `'given-up'`) contact by minting a fresh
 * `'active'` schedule on the very next sweep, re-opening the permanent-loop
 * hole AC-PROF-11a/11c close at the state-machine layer.
 *
 * This is the module-owned fix: given the incomplete set and every existing
 * schedule (of ANY state), returns only the pubkeys that have NO schedule
 * entry at all — active, answered-incomplete, or given-up. A contact with
 * an existing `'active'` schedule is excluded because the watcher advances
 * it via `advance`, never recreates it; a contact with an existing terminal
 * schedule is excluded because it must only ever leave that state via
 * `applyReachabilitySignal` on a real non-announce D4 signal, never via a
 * fresh `createInitialSchedule` minted by a due-check sweep. Case-folds
 * both sides on the join so a case mismatch between the incomplete-set
 * pubkey and the schedule store key still joins correctly. The watcher
 * (story 05) calls `createInitialSchedule` ONLY for the pubkeys this
 * function returns — it holds no terminal-exclusion logic of its own.
 */
export function computeContactsNeedingNewSchedule(
  incompleteSet: string[],
  existingSchedules: ProfileSchedule[],
): string[] {
  const existingByPubkey = new Set(existingSchedules.map((s) => s.pubkeyHex.toLowerCase()));
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of incompleteSet) {
    const pk = raw.toLowerCase();
    if (existingByPubkey.has(pk)) continue;
    if (seen.has(pk)) continue;
    seen.add(pk);
    result.push(pk);
  }
  return result;
}

// ── Clock-clamp on load (AC-PROF-1) ─────────────────────────────────────

/**
 * Backwards-clock-jump guard: clamps `nextAttemptAt` down to `nowSec +
 * CAP_HOURS*3600` when it exceeds that bound, so a wall clock that jumped
 * backward cannot freeze a schedule indefinitely. A no-op (returns
 * `schedule` unchanged, no new object) when no clamping is needed.
 *
 * PURE — this function never persists anything. Codex review remediation
 * (VQ-S02-015): the clamp must be made DURABLE by whichever load adapter
 * calls this (`loadSchedule`/`loadAllSchedules` below), by writing the
 * clamped value back to the store whenever it actually lowers
 * `nextAttemptAt`. Without that persistence step, a wall clock that stays
 * behind across repeated reloads (e.g. the watcher's periodic due-check
 * interval) would re-derive a FRESH `now+24h` on every single reload — with
 * `now` creeping forward each time — so the schedule's effective fire time
 * keeps sliding forward and NEVER arrives, which is the opposite of this
 * guard's "can't freeze a schedule" intent. Persisting the first clamp
 * result makes every subsequent reload (at an unchanged or still-behind
 * clock) see the SAME already-clamped value, so the schedule fires ~24h
 * after the first clamp and recovers exactly once, rather than being
 * pushed out indefinitely.
 */
export function clampScheduleOnLoad(schedule: ProfileSchedule, nowSec: number): ProfileSchedule {
  const maxNextAttemptAt = nowSec + CAP_HOURS * SEC_PER_HOUR;
  if (schedule.nextAttemptAt > maxNextAttemptAt) {
    return { ...schedule, nextAttemptAt: maxNextAttemptAt };
  }
  return schedule;
}

// ── Store (idb-keyval CRUD adapter) ─────────────────────────────────────

const scheduleStore = createStore('few-dm-profile-schedule', 'schedules');

/** Upsert, case-folding `pubkeyHex` on both the store key and the persisted record. */
export async function saveSchedule(schedule: ProfileSchedule): Promise<void> {
  const key = schedule.pubkeyHex.toLowerCase();
  await set(key, { ...schedule, pubkeyHex: key }, scheduleStore);
}

/**
 * Load one schedule, case-folding the lookup key AND defensively re-folding
 * the returned record's `pubkeyHex` to match (in case a pre-existing/
 * malformed record was ever written with a mismatched case), applying
 * `clampScheduleOnLoad` before returning. `undefined` if absent.
 *
 * DURABLE CLAMP (VQ-S02-015): when `clampScheduleOnLoad` actually lowers
 * `nextAttemptAt` relative to what was stored, the clamped value is
 * persisted back to the store before returning, so a subsequent load at an
 * unchanged (still-behind) clock sees the already-clamped value instead of
 * re-deriving a fresh `now+24h` that creeps forward on every reload.
 */
export async function loadSchedule(
  pubkeyHex: string,
  nowSec: number = defaultNowSec(),
): Promise<ProfileSchedule | undefined> {
  const key = pubkeyHex.toLowerCase();
  const stored = await get<ProfileSchedule>(key, scheduleStore);
  if (!stored) return undefined;
  const clamped = clampScheduleOnLoad({ ...stored, pubkeyHex: key }, nowSec);
  if (clamped.nextAttemptAt !== stored.nextAttemptAt) {
    await saveSchedule(clamped);
  }
  return clamped;
}

/**
 * Load every persisted schedule, each defensively re-folded to its
 * (already-lowercase-by-construction) store key and passed through
 * `clampScheduleOnLoad`.
 *
 * DURABLE CLAMP (VQ-S02-015): mirrors `loadSchedule` — any entry whose
 * `nextAttemptAt` is actually lowered by the clamp is persisted back to the
 * store before this function returns, so a subsequent bulk load at an
 * unchanged clock does not re-derive a fresh (further-forward) `now+24h`
 * for the same entry.
 */
export async function loadAllSchedules(nowSec: number = defaultNowSec()): Promise<ProfileSchedule[]> {
  const all = await entries<string, ProfileSchedule>(scheduleStore);
  const result: ProfileSchedule[] = [];
  const toPersist: ProfileSchedule[] = [];
  for (const [key, value] of all) {
    const clamped = clampScheduleOnLoad({ ...value, pubkeyHex: key.toLowerCase() }, nowSec);
    if (clamped.nextAttemptAt !== value.nextAttemptAt) {
      toPersist.push(clamped);
    }
    result.push(clamped);
  }
  if (toPersist.length > 0) {
    await Promise.all(toPersist.map((s) => saveSchedule(s)));
  }
  return result;
}

/**
 * Delete a contact's schedule — called on a completing announce
 * (`isCompletingAnnounce(...) === true`) or on contact archive/remove.
 */
export async function deleteSchedule(pubkeyHex: string): Promise<void> {
  await del(pubkeyHex.toLowerCase(), scheduleStore);
}

/**
 * Test-only full-store reset, mirroring `nonceStore.ts#clearAllNonces` /
 * `pendingIntent.ts#clearPendingIntentsForTests`. This module holds no
 * module-scope mutable state beyond the idb-keyval store itself, so this is
 * the only reset needed.
 */
export async function clearAllSchedulesForTests(): Promise<void> {
  await clear(scheduleStore);
}
