/**
 * profile-announce-fanout.test.ts — unit tests for the push-trigger
 * announce-on-change fan-out exported from `app/pages/profile.tsx` (epic:
 * direct-contact-profile-exchange, story 06; AC-PROF-11b).
 *
 * `profile.tsx` is a page component (Chakra/Next imports) — this repo has no
 * jsdom/@testing-library/renderHook precedent (see testing.md conventions in
 * exploration.json), so the fan-out logic worth testing directly is
 * extracted into two exported, dependency-injectable functions (mirrors
 * `ProfileHealWatcher.tsx`'s `planDueSweep`/`advanceAfterFire` split):
 *
 *   - `planProfileAnnounceFanout` — PURE. Audience + stagger schedule.
 *   - `executeProfileAnnounceFanout` — fires/schedules the actual sends,
 *     with `sendAnnounce`/`scheduleDelay` injectable for deterministic
 *     assertions here.
 *
 * A separate "real send.ts + real receive.ts round trip" describe block at
 * the bottom exercises the REAL `sendProfileAnnounce` (never mocked) end to
 * end into `handleProfileAnnounce`, proving the recipient's cache actually
 * lands via the AC-PROF-6/AC-PROF-4 receive path with no profile-request
 * ever having been sent — closing VQ-S06-001 and VQ-S06-006(b).
 */
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    writable: false,
    configurable: true,
  });
}

import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { bytesToHex } from 'nostr-tools/utils';
import { NDKEvent } from '@nostr-dev-kit/ndk';
import { STORAGE_KEYS } from '@/src/types';

import {
  planProfileAnnounceFanout,
  executeProfileAnnounceFanout,
  PROFILE_EDIT_FANOUT_STAGGER_THRESHOLD,
  PROFILE_EDIT_FANOUT_STAGGER_WINDOW_MS,
  type ProfileAnnounceContactSnapshot,
} from '@/pages/profile';

import * as directMessagesModule from '@/src/lib/directMessages';
const { unwrapAndOpen } = directMessagesModule;

import { sendProfileAnnounce } from '@/src/lib/dmProfile/send';
import { DM_PROFILE_ANNOUNCE_KIND } from '@/src/lib/dmProfile/kinds';
import { handleProfileAnnounce, type ProfileAnnounceHandlerContext } from '@/src/lib/dmProfile/receive';
import { readContactEntry } from '@/src/lib/contactCache';

// ── localStorage mock (hand-rolled, no jsdom — mirrors contacts-property.test.ts) ──

const store: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => {
    store[key] = value;
  },
  removeItem: (key: string) => {
    delete store[key];
  },
  clear: () => {
    Object.keys(store).forEach((k) => delete store[k]);
  },
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

function makeIdentity() {
  const priv = generateSecretKey();
  const privHex = bytesToHex(priv);
  const pubHex = getPublicKey(priv);
  return { privHex, pubHex };
}

function seedActiveContact(pubkeyHex: string): void {
  const raw = store[STORAGE_KEYS.contacts];
  const contacts = raw ? JSON.parse(raw) : {};
  contacts[pubkeyHex] = {
    pubkeyHex,
    firstSeenAt: new Date(0).toISOString(),
    lastSeenAt: new Date(0).toISOString(),
    archivedAt: null,
  };
  store[STORAGE_KEYS.contacts] = JSON.stringify(contacts);
}

beforeEach(() => {
  localStorageMock.clear();
  vi.restoreAllMocks();
});

// ── planProfileAnnounceFanout (pure) ────────────────────────────────────────

describe('planProfileAnnounceFanout (AC-PROF-11b)', () => {
  it('includes every active, non-archived contact and excludes every archived contact — asserted at the plan boundary itself (VQ-S06-005)', () => {
    const contacts: ProfileAnnounceContactSnapshot[] = [
      { pubkeyHex: 'a'.repeat(64), archived: false },
      { pubkeyHex: 'b'.repeat(64), archived: true },
      { pubkeyHex: 'c'.repeat(64), archived: false },
    ];

    const plan = planProfileAnnounceFanout(contacts);
    const recipients = plan.map((e) => e.pubkeyHex);

    expect(recipients).toContain('a'.repeat(64));
    expect(recipients).toContain('c'.repeat(64));
    expect(recipients).not.toContain('b'.repeat(64));
    expect(recipients).toHaveLength(2);
  });

  it('case-folds every recipient pubkeyHex', () => {
    const plan = planProfileAnnounceFanout([{ pubkeyHex: 'A'.repeat(64), archived: false }]);
    expect(plan[0].pubkeyHex).toBe('a'.repeat(64));
  });

  it('an empty or all-archived contact list produces an empty plan (no accidental sends)', () => {
    expect(planProfileAnnounceFanout([])).toEqual([]);
    expect(
      planProfileAnnounceFanout([{ pubkeyHex: 'a'.repeat(64), archived: true }]),
    ).toEqual([]);
  });

  it(`fires every recipient with delayMs 0 when the audience is <= ${PROFILE_EDIT_FANOUT_STAGGER_THRESHOLD} (no stagger needed)`, () => {
    const contacts: ProfileAnnounceContactSnapshot[] = Array.from(
      { length: PROFILE_EDIT_FANOUT_STAGGER_THRESHOLD },
      (_, i) => ({ pubkeyHex: i.toString(16).padStart(64, '0'), archived: false }),
    );
    const plan = planProfileAnnounceFanout(contacts);
    expect(plan).toHaveLength(PROFILE_EDIT_FANOUT_STAGGER_THRESHOLD);
    expect(plan.every((e) => e.delayMs === 0)).toBe(true);
  });

  it(`staggers sends across ${PROFILE_EDIT_FANOUT_STAGGER_WINDOW_MS}ms when the audience exceeds the threshold (VQ-S06-004: not a synchronous burst)`, () => {
    const audienceSize = PROFILE_EDIT_FANOUT_STAGGER_THRESHOLD + 3;
    const contacts: ProfileAnnounceContactSnapshot[] = Array.from({ length: audienceSize }, (_, i) => ({
      pubkeyHex: i.toString(16).padStart(64, '0'),
      archived: false,
    }));

    const plan = planProfileAnnounceFanout(contacts);
    expect(plan).toHaveLength(audienceSize);

    // Not every delay is 0 — this is the crux of "not a synchronous burst".
    const nonZeroDelays = plan.filter((e) => e.delayMs > 0);
    expect(nonZeroDelays.length).toBeGreaterThan(0);

    // Every delay stays within the stagger window, and delays are
    // non-decreasing in plan order (monotonic spread, not random).
    for (let i = 1; i < plan.length; i++) {
      expect(plan[i].delayMs).toBeGreaterThanOrEqual(plan[i - 1].delayMs);
    }
    expect(Math.max(...plan.map((e) => e.delayMs))).toBeLessThanOrEqual(PROFILE_EDIT_FANOUT_STAGGER_WINDOW_MS);
  });
});

// ── executeProfileAnnounceFanout (send orchestration, injectable deps) ─────

describe('executeProfileAnnounceFanout (AC-PROF-11b)', () => {
  it('fires an immediate (delayMs 0) send synchronously — VQ-S06-001: at least one real call reaches the send seam given a non-empty audience', () => {
    const sendAnnounce = vi.fn().mockResolvedValue({ recipientPubkeyHex: 'x', result: 'sent' });
    const scheduleDelay = vi.fn();

    executeProfileAnnounceFanout({
      ndk: {} as never,
      keys: { ownPubkeyHex: 'a'.repeat(64), ownPrivateKeyHex: 'b'.repeat(64) },
      localProfile: { nickname: 'Carol', avatar: null },
      plan: [{ pubkeyHex: 'c'.repeat(64), delayMs: 0 }],
      sendAnnounce,
      scheduleDelay,
    });

    expect(sendAnnounce).toHaveBeenCalledTimes(1);
    expect(sendAnnounce).toHaveBeenCalledWith(
      expect.objectContaining({ recipientPubkeyHex: 'c'.repeat(64), localProfile: { nickname: 'Carol', avatar: null } }),
    );
    expect(scheduleDelay).not.toHaveBeenCalled();
  });

  it('hands a staggered (delayMs > 0) entry to scheduleDelay instead of firing it synchronously', () => {
    const sendAnnounce = vi.fn().mockResolvedValue({ recipientPubkeyHex: 'x', result: 'sent' });
    const scheduleDelay = vi.fn();

    executeProfileAnnounceFanout({
      ndk: {} as never,
      keys: { ownPubkeyHex: 'a'.repeat(64), ownPrivateKeyHex: 'b'.repeat(64) },
      localProfile: { nickname: 'Carol', avatar: null },
      plan: [{ pubkeyHex: 'c'.repeat(64), delayMs: 15_000 }],
      sendAnnounce,
      scheduleDelay,
    });

    expect(sendAnnounce).not.toHaveBeenCalled();
    expect(scheduleDelay).toHaveBeenCalledTimes(1);
    expect(scheduleDelay).toHaveBeenCalledWith(expect.any(Function), 15_000);

    // Invoking the captured callback now fires the send.
    const [fireFn] = scheduleDelay.mock.calls[0];
    fireFn();
    expect(sendAnnounce).toHaveBeenCalledTimes(1);
  });

  it('a single recipient rejection is swallowed and never stops the remaining sends', async () => {
    const sendAnnounce = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ recipientPubkeyHex: 'y', result: 'sent' });

    executeProfileAnnounceFanout({
      ndk: {} as never,
      keys: { ownPubkeyHex: 'a'.repeat(64), ownPrivateKeyHex: 'b'.repeat(64) },
      localProfile: { nickname: 'Carol', avatar: null },
      plan: [
        { pubkeyHex: 'c'.repeat(64), delayMs: 0 },
        { pubkeyHex: 'd'.repeat(64), delayMs: 0 },
      ],
      sendAnnounce,
    });

    expect(sendAnnounce).toHaveBeenCalledTimes(2);
    // Let the rejected promise's .catch() settle so it can't surface as an
    // unhandled rejection in this test run.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('an empty plan calls neither sendAnnounce nor scheduleDelay', () => {
    const sendAnnounce = vi.fn();
    const scheduleDelay = vi.fn();
    executeProfileAnnounceFanout({
      ndk: {} as never,
      keys: { ownPubkeyHex: 'a'.repeat(64), ownPrivateKeyHex: 'b'.repeat(64) },
      localProfile: { nickname: 'Carol', avatar: null },
      plan: [],
      sendAnnounce,
      scheduleDelay,
    });
    expect(sendAnnounce).not.toHaveBeenCalled();
    expect(scheduleDelay).not.toHaveBeenCalled();
  });
});

// ── Real send.ts -> real receive.ts round trip (VQ-S06-001, VQ-S06-006b) ───

describe('announce-on-change round trip: real sendProfileAnnounce -> real handleProfileAnnounce', () => {
  it("lands the recipient's cache entry via the receive path with no profile-request ever sent (VQ-S06-006 sub-claim b)", async () => {
    const sender = makeIdentity(); // the profile owner making the edit
    const recipient = makeIdentity(); // an active, non-archived 1:1 contact

    // Recipient-side state the disclosure gate needs: an active,
    // non-archived contact entry for the sender, and sender present in
    // knownPeers (isAllowedDmSender's OR-branch).
    seedActiveContact(sender.pubHex);

    let published: { rawEvent: () => { kind: number; pubkey: string; tags: string[][]; content: string } } | undefined;
    vi.spyOn(NDKEvent.prototype, 'publish').mockImplementation(async function (this: NDKEvent) {
      published = this as unknown as typeof published;
      return new Set() as never;
    });

    // Real send.ts call (never mocked) — the exact chokepoint push-triggers reuse.
    const sendResult = await sendProfileAnnounce({
      ndk: {} as never,
      recipientPubkeyHex: recipient.pubHex,
      keys: { ownPubkeyHex: sender.pubHex, ownPrivateKeyHex: sender.privHex },
      localProfile: { nickname: 'Carol', avatar: { imageUrl: 'https://example.test/carol.png' } },
    });
    expect(sendResult.result).toBe('sent');
    expect(published).toBeDefined();

    // Recipient unwraps for real (strict primitive only, AC-PROF-5).
    const rawWrap = published!.rawEvent();
    const rumor = await unwrapAndOpen(rawWrap as never, recipient.privHex);
    expect(rumor.kind).toBe(DM_PROFILE_ANNOUNCE_KIND);

    const ctx: ProfileAnnounceHandlerContext = {
      groups: [],
      knownPeers: new Set([sender.pubHex.toLowerCase()]),
      ownPubkeyHex: recipient.pubHex,
    };
    await handleProfileAnnounce(rumor, sender.pubHex.toLowerCase(), ctx);

    // The recipient's cache entry for the sender now carries the pushed
    // nickname/avatar, landed via the AC-PROF-6/AC-PROF-4 receive path —
    // and at no point in this test was sendProfileRequest ever imported,
    // constructed, or called: this is a pure push, never a pull response.
    const landed = readContactEntry(sender.pubHex);
    expect(landed?.nickname).toBe('Carol');
    expect(landed?.avatar?.imageUrl).toBe('https://example.test/carol.png');
  });
});
