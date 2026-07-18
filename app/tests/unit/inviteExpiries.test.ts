/**
 * Unit tests for the `inviteExpiries` unread-counter slice (epic:
 * invite-link-lifecycle, story S4 — `app/src/lib/unreadStore.ts`'s
 * `initInviteExpiries` / `incrementInviteExpiry` / `markInviteExpiriesRead` /
 * `clearInviteExpiries`, plus its fold-in to `useUnreadCounts()`).
 *
 * Mocks `idb-keyval` with a single flat map (mirrors
 * `inviteLinkLifecycle.test.ts`/`inviteExpirySweep.test.ts`) so the REAL
 * `inviteLinkStorage.ts` helpers back `initInviteExpiries`/
 * `markInviteExpiriesRead`'s dynamic imports. `react` is mocked so
 * `useUnreadCounts()` (built on `useSyncExternalStore`) can be read
 * synchronously outside a component, mirroring `unreadStore.test.ts`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { InviteLink } from '@/src/lib/marmot/inviteLinkStorage';

const idbStore = new Map<string, unknown>();

vi.mock('idb-keyval', () => ({
  createStore: vi.fn(() => 'mock-store'),
  get: vi.fn(async (key: string) => idbStore.get(key) ?? undefined),
  set: vi.fn(async (key: string, value: unknown) => {
    idbStore.set(key, value);
  }),
  del: vi.fn(async (key: string) => {
    idbStore.delete(key);
  }),
  keys: vi.fn(async () => [...idbStore.keys()]),
  entries: vi.fn(async () => [...idbStore.entries()]),
  clear: vi.fn(async () => {
    idbStore.clear();
  }),
}));

vi.mock('react', () => ({
  useSyncExternalStore: (_subscribe: any, getSnapshot: any) => getSnapshot(),
}));

const { DAY_MS, saveInviteLink, getInviteLink, deleteInviteLink } = await import(
  '@/src/lib/marmot/inviteLinkStorage'
);
const {
  initInviteExpiries,
  incrementInviteExpiry,
  markInviteExpiriesRead,
  clearInviteExpiries,
  useUnreadCounts,
} = await import('@/src/lib/unreadStore');

function makeLink(overrides: Partial<InviteLink> = {}): InviteLink {
  return {
    nonce: 'nonce-1',
    groupId: 'group-1',
    createdAt: 1_700_000_000_000,
    expiresAt: 1_700_000_000_000 + DAY_MS,
    usageCount: 0,
    expiryNotified: false,
    expiryAcknowledged: false,
    label: undefined,
    muted: false,
    ...overrides,
  };
}

describe('unreadStore — inviteExpiries slice', () => {
  beforeEach(() => {
    idbStore.clear();
    clearInviteExpiries('group-1');
    clearInviteExpiries('group-2');
  });

  // AC-NOTIFY-1: exactly the (expired && expiryNotified && !expiryAcknowledged)
  // true positive counts — fixture covers all four boolean-combination
  // pitfalls named by VQ-S4-007.
  describe('initInviteExpiries — AC-NOTIFY-1', () => {
    it('counts only links satisfying expired && expiryNotified && !expiryAcknowledged', async () => {
      await saveInviteLink(
        makeLink({ nonce: 'expired-not-notified', groupId: 'group-1', expiresAt: 5_000, expiryNotified: false, expiryAcknowledged: false }),
      );
      await saveInviteLink(
        makeLink({ nonce: 'notified-not-expired', groupId: 'group-1', expiresAt: 9_000, expiryNotified: true, expiryAcknowledged: false }),
      );
      await saveInviteLink(
        makeLink({ nonce: 'notified-and-acked', groupId: 'group-1', expiresAt: 5_000, expiryNotified: true, expiryAcknowledged: true }),
      );
      await saveInviteLink(
        makeLink({ nonce: 'true-positive', groupId: 'group-1', expiresAt: 5_000, expiryNotified: true, expiryAcknowledged: false }),
      );

      await initInviteExpiries(5_000);

      expect(useUnreadCounts().inviteExpiries['group-1']).toBe(1);
    });

    it('derives per-groupId buckets independently', async () => {
      await saveInviteLink(
        makeLink({ nonce: 'a', groupId: 'group-1', expiresAt: 5_000, expiryNotified: true, expiryAcknowledged: false }),
      );
      await saveInviteLink(
        makeLink({ nonce: 'b', groupId: 'group-2', expiresAt: 5_000, expiryNotified: true, expiryAcknowledged: false }),
      );
      await saveInviteLink(
        makeLink({ nonce: 'c', groupId: 'group-2', expiresAt: 5_000, expiryNotified: true, expiryAcknowledged: false }),
      );

      await initInviteExpiries(5_000);

      expect(useUnreadCounts().inviteExpiries['group-1']).toBe(1);
      expect(useUnreadCounts().inviteExpiries['group-2']).toBe(2);
    });

    it('produces an empty slice when the store is empty', async () => {
      await initInviteExpiries(5_000);
      expect(useUnreadCounts().inviteExpiries).toEqual({});
    });

    it('fully recomputes rather than merging with a stale in-memory count (no cached carry-over)', async () => {
      incrementInviteExpiry('group-1'); // simulate a stale live bump for a group with nothing persisted
      expect(useUnreadCounts().inviteExpiries['group-1']).toBe(1);

      await initInviteExpiries(5_000); // store is empty — recompute must not preserve the stale 1

      expect(useUnreadCounts().inviteExpiries['group-1']).toBeUndefined();
    });
  });

  // AC-INV-2: a reload (re-running initInviteExpiries against the SAME
  // persisted flags) reproduces the identical count.
  describe('initInviteExpiries — AC-INV-2 (reload reproduces identical count)', () => {
    it('re-deriving after a simulated reload yields the same count as the first derivation', async () => {
      await saveInviteLink(
        makeLink({ nonce: 'n1', groupId: 'group-1', expiresAt: 5_000, expiryNotified: true, expiryAcknowledged: false }),
      );

      await initInviteExpiries(5_000);
      const first = useUnreadCounts().inviteExpiries['group-1'];

      // Simulate "app reloads": module state does not persist across a real
      // reload, but re-running the derivation from the SAME persisted store
      // is the behavior that must reproduce identically.
      await initInviteExpiries(6_000);
      const second = useUnreadCounts().inviteExpiries['group-1'];

      expect(first).toBe(1);
      expect(second).toBe(1);
    });
  });

  describe('incrementInviteExpiry', () => {
    it('bumps a group counter by 1 per call', () => {
      incrementInviteExpiry('group-1');
      expect(useUnreadCounts().inviteExpiries['group-1']).toBe(1);
      incrementInviteExpiry('group-1');
      expect(useUnreadCounts().inviteExpiries['group-1']).toBe(2);
      incrementInviteExpiry('group-2');
      expect(useUnreadCounts().inviteExpiries['group-2']).toBe(1);
      expect(useUnreadCounts().inviteExpiries['group-1']).toBe(2);
    });
  });

  // AC-NOTIFY-4: mark-read zeroes exactly the activated group's count and
  // persists expiryAcknowledged; an unrelated group's count is unaffected.
  describe('markInviteExpiriesRead — AC-NOTIFY-4', () => {
    it('zeroes the activated group count and persists expiryAcknowledged, leaving an unrelated group untouched', async () => {
      await saveInviteLink(
        makeLink({ nonce: 'g1-link', groupId: 'group-1', expiresAt: 5_000, expiryNotified: true, expiryAcknowledged: false }),
      );
      await saveInviteLink(
        makeLink({ nonce: 'g2-link', groupId: 'group-2', expiresAt: 5_000, expiryNotified: true, expiryAcknowledged: false }),
      );
      await initInviteExpiries(5_000);
      expect(useUnreadCounts().inviteExpiries['group-1']).toBe(1);
      expect(useUnreadCounts().inviteExpiries['group-2']).toBe(1);

      await markInviteExpiriesRead('group-1');

      expect(useUnreadCounts().inviteExpiries['group-1']).toBeUndefined();
      expect(useUnreadCounts().inviteExpiries['group-2']).toBe(1); // unaffected

      const persisted = await getInviteLink('g1-link');
      expect(persisted?.expiryAcknowledged).toBe(true);
    });

    it('the acknowledged flag survives a subsequent initInviteExpiries recompute (would otherwise resurrect the count)', async () => {
      await saveInviteLink(
        makeLink({ nonce: 'n1', groupId: 'group-1', expiresAt: 5_000, expiryNotified: true, expiryAcknowledged: false }),
      );
      await initInviteExpiries(5_000);
      await markInviteExpiriesRead('group-1');

      await initInviteExpiries(6_000); // simulated reload after ack

      expect(useUnreadCounts().inviteExpiries['group-1']).toBeUndefined();
    });
  });

  describe('clearInviteExpiries', () => {
    it('removes a group entry from the in-memory slice', () => {
      incrementInviteExpiry('group-1');
      expect(useUnreadCounts().inviteExpiries['group-1']).toBe(1);

      clearInviteExpiries('group-1');

      expect(useUnreadCounts().inviteExpiries['group-1']).toBeUndefined();
    });

    it('is a no-op when the group has no tracked count', () => {
      expect(() => clearInviteExpiries('never-tracked-group')).not.toThrow();
    });
  });

  describe('useUnreadCounts — fold-in', () => {
    it('includes inviteExpiries counts in totalUnread', () => {
      incrementInviteExpiry('group-1');
      incrementInviteExpiry('group-1');
      incrementInviteExpiry('group-2');

      const snapshot = useUnreadCounts();

      expect(snapshot.inviteExpiries['group-1']).toBe(2);
      expect(snapshot.inviteExpiries['group-2']).toBe(1);
      expect(snapshot.totalUnread).toBeGreaterThanOrEqual(3);
    });
  });

  // Gate-remediation (Codex round 6, Finding 2): when the manage-links modal
  // deletes an expired, notified link, it re-derives the slice so the bell
  // updates immediately. This exercises the behavioral core of that fix — a
  // deleted expired+notified link no longer contributes to the derived count.
  describe('re-derive after delete (Finding 2)', () => {
    it('drops a deleted expired+notified link from the derived badge count', async () => {
      const now = 10_000;
      await saveInviteLink(
        makeLink({
          nonce: 'expired-notified',
          groupId: 'group-1',
          expiresAt: 5_000, // already expired at `now`
          expiryNotified: true,
          expiryAcknowledged: false,
        }),
      );
      await initInviteExpiries(now);
      expect(useUnreadCounts().inviteExpiries['group-1']).toBe(1);

      // The modal's delete path: remove the link, then re-derive.
      await deleteInviteLink('expired-notified');
      await initInviteExpiries(now);

      expect(useUnreadCounts().inviteExpiries['group-1'] ?? 0).toBe(0);
    });
  });
});
