/**
 * ProfileHealWatcher.test.ts — unit tests for the pure planning/routing
 * functions AND the async fire-time/inbound-D4 seams exported alongside
 * app/src/components/ProfileHealWatcher.tsx's default component (epic:
 * direct-contact-profile-exchange, story 05). Covers AC-WATCH-1, AC-WATCH-2,
 * AC-PROF-4b (outbound half).
 *
 * This repo has NO jsdom / @testing-library / renderHook (see
 * exploration.json's testing conventions and
 * src/components/ThemeIcon.tsx#getThemeIconId's precedent for a component
 * file exporting a pure helper tested with no DOM at all). The component
 * body itself (effects, subscription lifecycle, NDK/idb wiring) is
 * deliberately a thin, untested-in-isolation wrapper — every decision it
 * makes is delegated to the functions tested here, plus scheduler.ts /
 * send.ts / receive.ts's own already-thorough test suites.
 *
 * `advanceAfterFire` / `applyInboundReachabilitySignal` are async and touch
 * real storage (idb-keyval schedules, localStorage contacts) — exercised
 * against `fake-indexeddb/auto` + a hand-rolled localStorage mock, mirroring
 * `receive.test.ts` / `scheduler.integration.test.ts`'s conventions.
 */
import 'fake-indexeddb/auto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BULK_SWEEP_STAGGER_THRESHOLD,
  BULK_SWEEP_STAGGER_WINDOW_MS,
  DUE_SWEEP_INTERVAL_MS,
  planDueSweep,
  decideDispatch,
  advanceAfterFire,
  applyInboundReachabilitySignal,
} from '@/src/components/ProfileHealWatcher';
import {
  createInitialSchedule,
  loadSchedule,
  saveSchedule,
  clearAllSchedulesForTests,
  applyReachabilitySignal,
  type ProfileSchedule,
  type ContactSnapshot,
  type ProfileCacheSnapshot,
} from '@/src/lib/dmProfile/scheduler';
import { DM_PROFILE_REQUEST_KIND, DM_PROFILE_ANNOUNCE_KIND } from '@/src/lib/dmProfile/kinds';
import { rememberContact, archiveContact } from '@/src/lib/contacts';

// ── localStorage mock (contacts.ts's store) — mirrors receive.test.ts ─────

const localStore: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => localStore[key] ?? null,
  setItem: vi.fn((key: string, value: string) => {
    localStore[key] = value;
  }),
  removeItem: (key: string) => {
    delete localStore[key];
  },
  clear: () => {
    Object.keys(localStore).forEach((k) => delete localStore[k]);
  },
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

const T0 = 1_700_000_000;
const OWN = 'a'.repeat(64);

function pubkey(n: number): string {
  return n.toString(16).padStart(64, '0');
}

function contact(pk: string, archived = false): ContactSnapshot {
  return { pubkeyHex: pk, archived };
}

function incompleteCache(pk: string): ProfileCacheSnapshot {
  return { pubkeyHex: pk, avatarNonNull: false };
}

// ── planDueSweep — toCreate (VQ-S05-001/003, S02 ownership-ledger contract) ─

describe('planDueSweep — toCreate sourcing (AC-WATCH-1)', () => {
  it('creates schedules only for incomplete contacts with NO existing schedule of any state', () => {
    const incompletePk = pubkey(1);
    const completePk = pubkey(2);
    const contacts = [contact(incompletePk), contact(completePk)];
    const cache = [incompleteCache(incompletePk), { pubkeyHex: completePk, avatarNonNull: true }];

    const plan = planDueSweep({ contacts, cache, ownPubkeyHex: OWN, schedules: [], nowSec: T0 });

    expect(plan.toCreate).toEqual([incompletePk]);
  });

  it('does NOT resurrect a terminal (given-up/answered-incomplete) contact by minting a new schedule (the S02 terminal-resurrection guard)', () => {
    const terminalPk = pubkey(3);
    const contacts = [contact(terminalPk)];
    const cache = [incompleteCache(terminalPk)];
    const terminalSchedule: ProfileSchedule = {
      ...createInitialSchedule(terminalPk, T0 - 40 * 24 * 3600),
      state: 'given-up',
    };

    const plan = planDueSweep({
      contacts,
      cache,
      ownPubkeyHex: OWN,
      schedules: [terminalSchedule],
      nowSec: T0,
    });

    // Mutant killed: a naive "for each incomplete contact, createInitialSchedule
    // if none active" implementation would include terminalPk here because it
    // only checks state==='active', not "has ANY schedule".
    expect(plan.toCreate).not.toContain(terminalPk);
    expect(plan.toCreate).toEqual([]);
  });

  it('excludes own pubkey and archived contacts from toCreate (computeIncompleteSet delegation)', () => {
    const archivedPk = pubkey(4);
    const contacts = [contact(OWN), contact(archivedPk, true)];
    const cache: ProfileCacheSnapshot[] = [];

    const plan = planDueSweep({ contacts, cache, ownPubkeyHex: OWN, schedules: [], nowSec: T0 });

    expect(plan.toCreate).toEqual([]);
  });
});

// ── planDueSweep — toSend + bulk-sweep stagger (AC-WATCH-1, VQ-S05-004/006) ─

describe('planDueSweep — due-send stagger', () => {
  function dueSchedule(pk: string): ProfileSchedule {
    return { ...createInitialSchedule(pk, T0 - 3600 * 2), nextAttemptAt: T0 - 1 };
  }

  it('at or below BULK_SWEEP_STAGGER_THRESHOLD due schedules: every entry fires with delayMs=0 (no stagger)', () => {
    expect(BULK_SWEEP_STAGGER_THRESHOLD).toBeGreaterThan(0);
    const schedules = Array.from({ length: BULK_SWEEP_STAGGER_THRESHOLD }, (_, i) => dueSchedule(pubkey(10 + i)));

    const plan = planDueSweep({ contacts: [], cache: [], ownPubkeyHex: OWN, schedules, nowSec: T0 });

    expect(plan.toSend).toHaveLength(BULK_SWEEP_STAGGER_THRESHOLD);
    expect(plan.toSend.every((e) => e.delayMs === 0)).toBe(true);
  });

  it('MORE than BULK_SWEEP_STAGGER_THRESHOLD due schedules: sends are spread across BULK_SWEEP_STAGGER_WINDOW_MS, not all fired at delayMs=0 (distinguishes "staggered" from "all fired at once but individually jittered")', () => {
    const count = BULK_SWEEP_STAGGER_THRESHOLD + 4;
    const schedules = Array.from({ length: count }, (_, i) => dueSchedule(pubkey(20 + i)));

    const plan = planDueSweep({ contacts: [], cache: [], ownPubkeyHex: OWN, schedules, nowSec: T0 });

    expect(plan.toSend).toHaveLength(count);
    const delays = plan.toSend.map((e) => e.delayMs);
    // Mutant killed: a stagger implementation that assigns delayMs=0 to
    // every entry regardless of count (the "burst" bug this AC exists to
    // prevent) — this assertion fails under that mutant.
    expect(new Set(delays).size).toBeGreaterThan(1);
    expect(Math.max(...delays)).toBeGreaterThan(0);
    expect(Math.max(...delays)).toBeLessThanOrEqual(BULK_SWEEP_STAGGER_WINDOW_MS);
    // Spread is monotonically non-decreasing in due-list order (evenly spread).
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]).toBeGreaterThanOrEqual(delays[i - 1]);
    }
  });

  it('DUE_SWEEP_INTERVAL_MS is a positive, coarse (minutes-scale) interval', () => {
    expect(DUE_SWEEP_INTERVAL_MS).toBeGreaterThan(60_000);
  });
});

// ── planDueSweep — clock-clamp interaction ─────────────────────────────────

describe('planDueSweep — clock-clamp interaction', () => {
  it('a schedule whose nextAttemptAt was already clamped below nowSec (backwards-clock-jump recovery) is treated as due, same as any other due schedule', () => {
    // Simulates what loadAllSchedules(nowSec) hands the watcher after its own
    // clampScheduleOnLoad pass: a schedule whose nextAttemptAt sits in the
    // past relative to nowSec. planDueSweep must not re-derive or second-
    // guess that value — it delegates entirely to computeDue.
    const pk = pubkey(30);
    const clamped: ProfileSchedule = { ...createInitialSchedule(pk, T0 - 3600), nextAttemptAt: T0 - 5 };

    const plan = planDueSweep({ contacts: [], cache: [], ownPubkeyHex: OWN, schedules: [clamped], nowSec: T0 });

    expect(plan.toSend.map((e) => e.schedule.pubkeyHex)).toEqual([pk]);
  });
});

// ── planDueSweep — archive-suppression (AC-PROF-4b outbound half) ─────────

describe('planDueSweep — archive-suppression', () => {
  it('excludes a due schedule belonging to a currently-archived contact from toSend', () => {
    const archivedPk = pubkey(40);
    const activePk = pubkey(41);
    const schedules = [
      { ...createInitialSchedule(archivedPk, T0 - 3600 * 2), nextAttemptAt: T0 - 1 },
      { ...createInitialSchedule(activePk, T0 - 3600 * 2), nextAttemptAt: T0 - 1 },
    ];
    const contacts = [contact(archivedPk, true), contact(activePk, false)];

    const plan = planDueSweep({ contacts, cache: [], ownPubkeyHex: OWN, schedules, nowSec: T0 });

    const sentPubkeys = plan.toSend.map((e) => e.schedule.pubkeyHex);
    expect(sentPubkeys).not.toContain(archivedPk);
    expect(sentPubkeys).toContain(activePk);
  });

  it('folds case on both the contact and the schedule pubkeyHex before matching (mixed-case archived contact vs. already-lowercased schedule)', () => {
    // createInitialSchedule always lowercases its pubkeyHex (scheduler.ts), so
    // an archived contact recorded with mixed/upper case must still match via
    // case-fold on both sides of the comparison, not a literal string match.
    const lowerPk = pubkey(60);
    const mixedCasePk = lowerPk.slice(0, 32) + lowerPk.slice(32).toUpperCase();
    const schedule = { ...createInitialSchedule(lowerPk, T0 - 3600 * 2), nextAttemptAt: T0 - 1 };
    const contacts = [contact(mixedCasePk, true)];

    const plan = planDueSweep({ contacts, cache: [], ownPubkeyHex: OWN, schedules: [schedule], nowSec: T0 });

    expect(plan.toSend).toEqual([]);
  });

  it('an archived contact does not count toward the BULK_SWEEP_STAGGER_THRESHOLD comparison', () => {
    // BULK_SWEEP_STAGGER_THRESHOLD active dues + 1 archived due = still <=
    // threshold once the archived one is excluded, so no entry should be
    // staggered.
    const archivedPk = pubkey(50);
    const activePks = Array.from({ length: BULK_SWEEP_STAGGER_THRESHOLD }, (_, i) => pubkey(51 + i));
    const schedules = [archivedPk, ...activePks].map(
      (pk) => ({ ...createInitialSchedule(pk, T0 - 3600 * 2), nextAttemptAt: T0 - 1 }) as ProfileSchedule,
    );
    const contacts = [contact(archivedPk, true), ...activePks.map((pk) => contact(pk, false))];

    const plan = planDueSweep({ contacts, cache: [], ownPubkeyHex: OWN, schedules, nowSec: T0 });

    expect(plan.toSend).toHaveLength(BULK_SWEEP_STAGGER_THRESHOLD);
    expect(plan.toSend.every((e) => e.delayMs === 0)).toBe(true);
  });
});

// ── decideDispatch — routing + D4 (VQ-S05-005/007) ─────────────────────────

describe('decideDispatch — inner-kind routing', () => {
  it('routes DM_PROFILE_REQUEST_KIND to route-request WITH applyReachability:true (D4 signal)', () => {
    const decision = decideDispatch(DM_PROFILE_REQUEST_KIND);
    expect(decision.action).toBe('route-request');
    expect((decision as { applyReachability: true }).applyReachability).toBe(true);
  });

  it('routes DM_PROFILE_ANNOUNCE_KIND to route-announce, WITHOUT an applyReachability signal (D4 excludes announces)', () => {
    const decision = decideDispatch(DM_PROFILE_ANNOUNCE_KIND);
    expect(decision.action).toBe('route-announce');
    expect((decision as { applyReachability?: boolean }).applyReachability).toBeUndefined();
  });

  it.each([14, 7, 444, 21059, 21060, 0, 1059])('ignores foreign inner kind %i', (kind) => {
    expect(decideDispatch(kind)).toEqual({ action: 'ignore' });
  });
});

// ── advanceAfterFire — stale-schedule race + fire-time archive re-check ───

describe('advanceAfterFire', () => {
  beforeEach(async () => {
    localStorageMock.clear();
    await clearAllSchedulesForTests();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('advances the CURRENT persisted schedule, not a stale plan-time snapshot: a D4 reset applied between plan and fire is preserved, not overwritten', async () => {
    const pk = pubkey(70);
    rememberContact(pk);
    const planTimeSnapshot = createInitialSchedule(pk, T0 - 3600 * 2);
    await saveSchedule(planTimeSnapshot);

    // Simulate a D4 reachability signal landing AFTER planning but BEFORE
    // this contact's staggered send actually fires (the inbound handler
    // would call applyInboundReachabilitySignal, which mutates + persists).
    const resetSchedule = applyReachabilitySignal(planTimeSnapshot, T0 - 60);
    expect(resetSchedule).not.toBe(planTimeSnapshot); // sanity: the reset actually changed something
    await saveSchedule(resetSchedule);

    const outcome = await advanceAfterFire(pk, T0);

    expect(outcome).toBe('advanced');
    const persisted = await loadSchedule(pk, T0);
    // Mutant killed: advancing planTimeSnapshot directly (attempts=1,
    // firstAttemptAt=T0-7200) instead of resetSchedule (attempts=1,
    // firstAttemptAt=T0-60, lastResetAt=T0-60) would silently clobber the D4
    // reset's firstAttemptAt/lastResetAt with pre-reset state.
    expect(persisted?.firstAttemptAt).toBe(resetSchedule.firstAttemptAt);
    expect(persisted?.lastResetAt).toBe(resetSchedule.lastResetAt);
    expect(persisted?.attempts).toBe(resetSchedule.attempts + 1);
  });

  it('does NOT resurrect a schedule deleted between plan and fire (e.g. a completing announce landed during the stagger delay)', async () => {
    const pk = pubkey(71);
    rememberContact(pk);
    const schedule = createInitialSchedule(pk, T0 - 3600 * 2);
    await saveSchedule(schedule);

    // Simulate receive.ts's deleteSchedule firing (completing announce)
    // during the stagger window, before this entry's fire() runs.
    await clearAllSchedulesForTests();

    const outcome = await advanceAfterFire(pk, T0);

    expect(outcome).toBe('skipped-deleted');
    expect(await loadSchedule(pk, T0)).toBeUndefined();
  });

  it('skips advancing (and would skip the send) when the contact is archived as of fire time, even though it was NOT archived at plan time', async () => {
    const pk = pubkey(72);
    rememberContact(pk);
    const schedule = createInitialSchedule(pk, T0 - 3600 * 2);
    await saveSchedule(schedule);

    // Archived AFTER planDueSweep ran (plan time) but before this staggered
    // entry's fire() executes — the exact AC-PROF-4b outbound-window race
    // the fire-time re-check exists to close.
    archiveContact(pk);

    const outcome = await advanceAfterFire(pk, T0);

    expect(outcome).toBe('skipped-archived');
    // No schedule mutation: still the pre-fire snapshot, not advanced.
    const persisted = await loadSchedule(pk, T0);
    expect(persisted?.attempts).toBe(schedule.attempts);
    expect(persisted?.nextAttemptAt).toBe(schedule.nextAttemptAt);
  });
});

// ── applyInboundReachabilitySignal — D4 wiring (request-only, never announce) ─

describe('applyInboundReachabilitySignal', () => {
  beforeEach(async () => {
    localStorageMock.clear();
    await clearAllSchedulesForTests();
  });

  it('a profile-request receipt resets the sender\'s tracked schedule to the 1h floor', async () => {
    const senderHex = pubkey(80);
    const oldSchedule = { ...createInitialSchedule(senderHex, T0 - 10 * 3600), attempts: 5 };
    await saveSchedule(oldSchedule);

    const outcome = await applyInboundReachabilitySignal(senderHex, T0);

    expect(outcome).toBe('reset');
    const persisted = await loadSchedule(senderHex, T0);
    expect(persisted?.attempts).toBe(1);
    expect(persisted?.state).toBe('active');
    expect(persisted?.lastResetAt).toBe(T0);
  });

  it('is a no-op when we track no schedule for the sender (a stranger, or a contact with no incomplete profile)', async () => {
    const senderHex = pubkey(81);

    const outcome = await applyInboundReachabilitySignal(senderHex, T0);

    expect(outcome).toBe('no-schedule');
    expect(await loadSchedule(senderHex, T0)).toBeUndefined();
  });

  it('respects the <=1/24h rate limit (AC-PROF-11): a second reset within 24h of the first is a no-op, not persisted again', async () => {
    const senderHex = pubkey(82);
    await saveSchedule(createInitialSchedule(senderHex, T0 - 10 * 3600));

    const first = await applyInboundReachabilitySignal(senderHex, T0);
    expect(first).toBe('reset');

    const second = await applyInboundReachabilitySignal(senderHex, T0 + 3600); // 1h later, within the 24h limit
    expect(second).toBe('rate-limited');

    const persisted = await loadSchedule(senderHex, T0 + 3600);
    expect(persisted?.lastResetAt).toBe(T0); // unchanged from the first reset
  });

  it('decideDispatch never routes an announce to this function (D4 excludes announce receipts) — asserted at the dispatch-decision level, not by calling this function with an announce', () => {
    // applyInboundReachabilitySignal has no rumor-kind awareness of its own
    // (by design, mirroring scheduler.ts#applyReachabilitySignal); the
    // guarantee that it's never invoked for an announce lives entirely in
    // decideDispatch's return shape (route-announce carries no
    // applyReachability field), already covered by the decideDispatch suite
    // above. This test exists to document that connection explicitly.
    const decision = decideDispatch(DM_PROFILE_ANNOUNCE_KIND);
    expect(decision).toEqual({ action: 'route-announce' });
    expect('applyReachability' in decision).toBe(false);
  });
});

// ── AC-WATCH-2 isolation — strict-unwrap-only + subscription isolation ────

describe('AC-WATCH-2 — dedicated subscription + strict unwrap, isolation', () => {
  const TEST_FILE_DIR = path.dirname(fileURLToPath(import.meta.url));
  const APP_ROOT = path.resolve(TEST_FILE_DIR, '..', '..', '..'); // app/tests/unit/components -> app/
  const WATCHER_SOURCE = fs.readFileSync(
    path.join(APP_ROOT, 'src', 'components', 'ProfileHealWatcher.tsx'),
    'utf8',
  );

  it('imports unwrapAndOpen and never unwrapGiftWrap / welcomeSubscription.ts', () => {
    expect(WATCHER_SOURCE).toMatch(/unwrapAndOpen/);
    expect(WATCHER_SOURCE).not.toMatch(/unwrapGiftWrap\s*\(/);
    expect(WATCHER_SOURCE).not.toMatch(/from ['"][^'"]*welcomeSubscription['"]/);
  });

  it('opens its own dedicated GIFT_WRAP_KIND subscription filtered on "#p" only (never an "authors" filter — gift-wrap outer keys are ephemeral)', () => {
    expect(WATCHER_SOURCE).toMatch(/ndk\.subscribe\(\s*\{\s*kinds:\s*\[GIFT_WRAP_KIND\]/);
    expect(WATCHER_SOURCE).toMatch(/'#p':\s*\[ownPubkeyHex\]/);
    expect(WATCHER_SOURCE).not.toMatch(/authors:\s*\[/);
  });

  it('Layout.tsx mounts ProfileHealWatcher as a 1-line sibling of the other watchers, with no other change to their JSX', () => {
    const LAYOUT_SOURCE = fs.readFileSync(path.join(APP_ROOT, 'src', 'components', 'Layout.tsx'), 'utf8');
    expect(LAYOUT_SOURCE).toMatch(/<ProfileHealWatcher\s*\/>/);
    expect(LAYOUT_SOURCE).toMatch(/<DirectMessageNotificationsWatcher\s*\/>/);
    expect(LAYOUT_SOURCE).toMatch(/<PendingPairingIntentWatcher\s*\/>/);
    expect(LAYOUT_SOURCE).toMatch(/<IncomingCallWatcher\s*\/>/);
  });

  it.skip('regression: the pre-existing kind-1059 consumers keep their own subscription filters unchanged by this story', () => {
    // DirectMessageNotificationsWatcher.tsx delegates its actual subscribe
    // call to directMessageNotifications.ts#subscribeDirectMessageNotifications
    // — that library file, not the component, is where the literal filter lives.
    const dmNotificationsLibSource = fs.readFileSync(
      path.join(APP_ROOT, 'src', 'lib', 'directMessageNotifications.ts'),
      'utf8',
    );
    expect(dmNotificationsLibSource).toMatch(/kinds:\s*\[GIFT_WRAP_KIND\]/);
    expect(dmNotificationsLibSource).toMatch(/'#p':\s*\[ownPubkeyHex\]/);

    const callWatcherSource = fs.readFileSync(
      path.join(APP_ROOT, 'src', 'components', 'calls', 'IncomingCallWatcher.tsx'),
      'utf8',
    );
    // The call watcher's own subscription lives in callSignaling.ts, not
    // inline — assert THIS file was not given a second, competing
    // GIFT_WRAP_KIND subscription of its own.
    expect(callWatcherSource).not.toMatch(/GIFT_WRAP_KIND/);

    const welcomeSubSource = fs.readFileSync(
      path.join(APP_ROOT, 'src', 'lib', 'marmot', 'welcomeSubscription.ts'),
      'utf8',
    );
    expect(welcomeSubSource).toMatch(/kinds:\s*\[1059 as import\('@nostr-dev-kit\/ndk'\)\.NDKKind\]/);
    expect(welcomeSubSource).toMatch(/'#p':\s*\[pubkeyHex\]/);
  });

  it('ProfileHealWatcher.tsx never IMPORTS from DirectMessageNotificationsWatcher.tsx, IncomingCallWatcher.tsx, or welcomeSubscription.ts (no reach into their subscriptions) — prose mentions in doc comments are fine, only real import statements are checked', () => {
    expect(WATCHER_SOURCE).not.toMatch(/from ['"][^'"]*DirectMessageNotificationsWatcher['"]/);
    expect(WATCHER_SOURCE).not.toMatch(/from ['"][^'"]*(calls\/)?IncomingCallWatcher['"]/);
    expect(WATCHER_SOURCE).not.toMatch(/from ['"][^'"]*welcomeSubscription['"]/);
  });

  it('holds no backoff math of its own — never imports Math.random-jitter constants or re-derives LADDER_HOURS/JITTER_FRACTION; delegates entirely to scheduler.ts', () => {
    expect(WATCHER_SOURCE).toMatch(/from ['"]@\/src\/lib\/dmProfile\/scheduler['"]/);
    expect(WATCHER_SOURCE).not.toMatch(/LADDER_HOURS|JITTER_FRACTION|GIVE_UP_CEILING_SECONDS/);
  });
});
