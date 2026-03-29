import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { InviteLink } from '@/src/lib/marmot/inviteLinkStorage';

// Mock idb-keyval — in-memory store
const store = new Map<string, unknown>();
vi.mock('idb-keyval', () => ({
  createStore: vi.fn(() => 'mock-store'),
  get: vi.fn(async (key: string) => store.get(key) ?? undefined),
  set: vi.fn(async (key: string, value: unknown) => { store.set(key, value); }),
  del: vi.fn(async (key: string) => { store.delete(key); }),
  keys: vi.fn(async () => [...store.keys()]),
  entries: vi.fn(async () => [...store.entries()]),
}));

const {
  createInviteLinkStore,
  saveInviteLink,
  loadInviteLinks,
  getInviteLink,
  updateInviteLinkMuted,
  deleteInviteLink,
  loadAllInviteLinks,
} = await import('@/src/lib/marmot/inviteLinkStorage');

function makeLink(overrides: Partial<InviteLink> = {}): InviteLink {
  return {
    nonce: 'abc123def456abc123def456abc123ff',
    groupId: 'group-1',
    createdAt: 1000,
    label: undefined,
    muted: false,
    ...overrides,
  };
}

describe('inviteLinkStorage', () => {
  beforeEach(() => {
    store.clear();
  });

  describe('createInviteLinkStore', () => {
    it('returns a store reference', () => {
      const s = createInviteLinkStore();
      expect(s).toBe('mock-store');
    });
  });

  describe('saveInviteLink', () => {
    it('persists an invite link keyed by nonce', async () => {
      const link = makeLink();
      await saveInviteLink(link);
      expect(store.has(link.nonce)).toBe(true);
      expect(store.get(link.nonce)).toEqual(link);
    });

    it('overwrites an existing link with the same nonce', async () => {
      await saveInviteLink(makeLink({ label: 'first' }));
      await saveInviteLink(makeLink({ label: 'second' }));
      const stored = store.get('abc123def456abc123def456abc123ff') as InviteLink;
      expect(stored.label).toBe('second');
    });
  });

  describe('getInviteLink', () => {
    it('returns undefined for non-existent nonce', async () => {
      const result = await getInviteLink('nonexistent');
      expect(result).toBeUndefined();
    });

    it('returns the invite link for a known nonce', async () => {
      const link = makeLink();
      await saveInviteLink(link);
      const result = await getInviteLink(link.nonce);
      expect(result).toEqual(link);
    });
  });

  describe('loadInviteLinks', () => {
    it('returns empty array when no links exist', async () => {
      const result = await loadInviteLinks('group-1');
      expect(result).toEqual([]);
    });

    it('returns only links for the specified group', async () => {
      await saveInviteLink(makeLink({ nonce: 'n1', groupId: 'group-1' }));
      await saveInviteLink(makeLink({ nonce: 'n2', groupId: 'group-2' }));
      await saveInviteLink(makeLink({ nonce: 'n3', groupId: 'group-1' }));

      const result = await loadInviteLinks('group-1');
      expect(result).toHaveLength(2);
      expect(result.map((l) => l.nonce).sort()).toEqual(['n1', 'n3']);
    });
  });

  describe('loadAllInviteLinks', () => {
    it('returns empty array when no links exist', async () => {
      const result = await loadAllInviteLinks();
      expect(result).toEqual([]);
    });

    it('returns all links across all groups', async () => {
      await saveInviteLink(makeLink({ nonce: 'n1', groupId: 'group-1' }));
      await saveInviteLink(makeLink({ nonce: 'n2', groupId: 'group-2' }));
      const result = await loadAllInviteLinks();
      expect(result).toHaveLength(2);
    });
  });

  describe('updateInviteLinkMuted', () => {
    it('sets muted to true', async () => {
      await saveInviteLink(makeLink());
      await updateInviteLinkMuted('abc123def456abc123def456abc123ff', true);
      const result = await getInviteLink('abc123def456abc123def456abc123ff');
      expect(result?.muted).toBe(true);
    });

    it('sets muted back to false', async () => {
      await saveInviteLink(makeLink({ muted: true }));
      await updateInviteLinkMuted('abc123def456abc123def456abc123ff', false);
      const result = await getInviteLink('abc123def456abc123def456abc123ff');
      expect(result?.muted).toBe(false);
    });

    it('is a no-op for non-existent nonce', async () => {
      await updateInviteLinkMuted('nonexistent', true);
      expect(store.has('nonexistent')).toBe(false);
    });
  });

  describe('deleteInviteLink', () => {
    it('removes an existing link', async () => {
      await saveInviteLink(makeLink());
      await deleteInviteLink('abc123def456abc123def456abc123ff');
      const result = await getInviteLink('abc123def456abc123def456abc123ff');
      expect(result).toBeUndefined();
    });

    it('is a no-op for non-existent nonce', async () => {
      await deleteInviteLink('nonexistent');
      // No error thrown
    });
  });
});
