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
  saveInviteLink,
  loadInviteLinks,
  getInviteLink,
  updateInviteLinkMuted,
} = await import('@/src/lib/marmot/inviteLinkStorage');

function makeLink(overrides: Partial<InviteLink> = {}): InviteLink {
  return {
    nonce: 'nonce-1',
    groupId: 'group-1',
    createdAt: 1700000000000,
    label: undefined,
    muted: false,
    ...overrides,
  };
}

describe('ManageInviteLinksModal logic', () => {
  beforeEach(() => {
    store.clear();
  });

  describe('loadInviteLinks for modal listing', () => {
    it('returns all links for the group', async () => {
      await saveInviteLink(makeLink({ nonce: 'n1', label: 'Class chat' }));
      await saveInviteLink(makeLink({ nonce: 'n2', label: 'Email' }));
      await saveInviteLink(makeLink({ nonce: 'n3', groupId: 'group-2' }));

      const links = await loadInviteLinks('group-1');
      expect(links).toHaveLength(2);
      expect(links.map((l) => l.nonce).sort()).toEqual(['n1', 'n2']);
    });

    it('returns empty array when no links exist for the group', async () => {
      await saveInviteLink(makeLink({ nonce: 'n1', groupId: 'other-group' }));
      const links = await loadInviteLinks('group-1');
      expect(links).toEqual([]);
    });
  });

  describe('mute toggle via updateInviteLinkMuted', () => {
    it('mutes an active link', async () => {
      await saveInviteLink(makeLink({ nonce: 'n1', muted: false }));
      await updateInviteLinkMuted('n1', true);
      const link = await getInviteLink('n1');
      expect(link?.muted).toBe(true);
    });

    it('unmutes a muted link', async () => {
      await saveInviteLink(makeLink({ nonce: 'n1', muted: true }));
      await updateInviteLinkMuted('n1', false);
      const link = await getInviteLink('n1');
      expect(link?.muted).toBe(false);
    });

    it('preserves other link fields when toggling mute', async () => {
      const original = makeLink({ nonce: 'n1', label: 'My Link', createdAt: 12345 });
      await saveInviteLink(original);
      await updateInviteLinkMuted('n1', true);
      const link = await getInviteLink('n1');
      expect(link?.label).toBe('My Link');
      expect(link?.createdAt).toBe(12345);
      expect(link?.groupId).toBe('group-1');
      expect(link?.muted).toBe(true);
    });
  });

  describe('link display properties', () => {
    it('link with label shows the label', async () => {
      await saveInviteLink(makeLink({ nonce: 'n1', label: 'Sent to class' }));
      const links = await loadInviteLinks('group-1');
      expect(links[0].label).toBe('Sent to class');
    });

    it('link without label has undefined label (UI shows "Untitled")', async () => {
      await saveInviteLink(makeLink({ nonce: 'n1', label: undefined }));
      const links = await loadInviteLinks('group-1');
      expect(links[0].label).toBeUndefined();
    });

    it('link has createdAt for date display', async () => {
      await saveInviteLink(makeLink({ nonce: 'n1', createdAt: 1700000000000 }));
      const links = await loadInviteLinks('group-1');
      expect(links[0].createdAt).toBe(1700000000000);
    });
  });

  describe('i18n keys for ManageInviteLinksModal', () => {
    it('English copy has all required keys', async () => {
      const { getCopy } = await import('@/src/lib/i18n');
      const en = getCopy('en');
      expect(en.groups.manageLinksButton).toBe('Manage Links');
      expect(en.groups.manageLinksTitle).toBe('Manage Invite Links');
      expect(en.groups.manageLinksMuteLabel).toBe('Muted');
      expect(en.groups.manageLinksUntitled).toBe('Untitled');
    });

    it('German copy has all required keys', async () => {
      const { getCopy } = await import('@/src/lib/i18n');
      const de = getCopy('de');
      expect(de.groups.manageLinksButton).toBe('Links verwalten');
      expect(de.groups.manageLinksTitle).toBe('Einladungslinks verwalten');
      expect(de.groups.manageLinksMuteLabel).toBe('Stummgeschaltet');
      expect(de.groups.manageLinksUntitled).toBe('Ohne Titel');
    });
  });
});
