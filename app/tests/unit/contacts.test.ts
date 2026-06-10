import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  archiveContact,
  getContact,
  listContacts,
  rememberContact,
  rememberContactsFromGroups,
  unarchiveContact,
} from '@/src/lib/contacts';
import { STORAGE_KEYS, type Group } from '@/src/types';

const store: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => { store[key] = value; },
  removeItem: (key: string) => { delete store[key]; },
  clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
};

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

describe('contacts', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it('remembers shared-group members except the local identity', () => {
    const groups: Group[] = [
      {
        id: 'g1',
        name: 'Biology',
        createdAt: 1,
        memberPubkeys: ['self', 'alice', 'bob'],
        relays: [],
      },
      {
        id: 'g2',
        name: 'History',
        createdAt: 2,
        memberPubkeys: ['self', 'bob', 'carol'],
        relays: [],
      },
    ];

    rememberContactsFromGroups(groups, 'self');

    const contacts = listContacts('self');
    expect(contacts.map((contact) => contact.pubkeyHex)).toEqual(['alice', 'bob', 'carol']);
  });

  it('overlays cached profile data onto remembered contacts', () => {
    rememberContact('alice', '2026-05-01T10:00:00.000Z');
    localStorage.setItem(STORAGE_KEYS.contactCache, JSON.stringify({
      alice: {
        nickname: 'Alice',
        avatar: { imageUrl: 'https://example.test/alice.png' },
        updatedAt: '2026-05-02T10:00:00.000Z',
      },
    }));

    const [contact] = listContacts(null);
    expect(contact.nickname).toBe('Alice');
    expect(contact.avatar?.imageUrl).toContain('alice.png');
    expect(contact.updatedAt).toBe('2026-05-02T10:00:00.000Z');
  });

  it('keeps contacts available even when no current groups are passed later', () => {
    rememberContactsFromGroups([
      {
        id: 'g1',
        name: 'Math',
        createdAt: 1,
        memberPubkeys: ['self', 'bob'],
        relays: [],
      },
    ], 'self');

    expect(listContacts('self')).toHaveLength(1);
    rememberContactsFromGroups([], 'self');
    expect(listContacts('self')).toHaveLength(1);
    expect(getContact('bob', 'self')?.pubkeyHex).toBe('bob');
  });

  it('hides archived contacts by default and can reveal or unarchive them', () => {
    rememberContact('alice', '2026-05-01T10:00:00.000Z');
    rememberContact('bob', '2026-05-01T11:00:00.000Z');
    archiveContact('bob', '2026-05-02T10:00:00.000Z');

    expect(listContacts(null).map((contact) => contact.pubkeyHex)).toEqual(['alice']);

    const withArchived = listContacts(null, { includeArchived: true });
    expect(withArchived.map((contact) => [contact.pubkeyHex, contact.isArchived])).toEqual([
      ['alice', false],
      ['bob', true],
    ]);
    expect(getContact('bob', null, { includeArchived: true })?.archivedAt).toBe('2026-05-02T10:00:00.000Z');

    unarchiveContact('bob');

    expect(listContacts(null).map((contact) => contact.pubkeyHex)).toEqual(['bob', 'alice']);
    expect(getContact('bob', null)?.isArchived).toBe(false);
  });
});

describe('rememberContact — whitelist gate (AC-STRUCT-2)', () => {
  // Reuses the top-level localStorageMock already wired above.
  beforeEach(() => {
    localStorageMock.clear();
  });

  it('silently no-ops (does not mutate storage) when isAllowed returns false for the peer', () => {
    const strangerPubkey = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
    const isAllowed = vi.fn(() => false);

    rememberContact(strangerPubkey, '2026-06-01T00:00:00.000Z', isAllowed);

    expect(isAllowed).toHaveBeenCalledWith(strangerPubkey);
    expect(localStorageMock.getItem(STORAGE_KEYS.contacts)).toBeNull();
  });

  it('does not throw when isAllowed returns false', () => {
    const strangerPubkey = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
    const isAllowed = vi.fn(() => false);
    expect(() => rememberContact(strangerPubkey, '2026-06-01T00:00:00.000Z', isAllowed)).not.toThrow();
  });

  it('does not call console.error or console.warn when isAllowed returns false', () => {
    const strangerPubkey = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
    const isAllowed = vi.fn(() => false);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    rememberContact(strangerPubkey, '2026-06-01T00:00:00.000Z', isAllowed);

    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();

    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('writes storage when isAllowed returns true for an allowed peer (VQ-S1-012)', () => {
    const memberPubkey = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const isAllowed = vi.fn(() => true);
    const setItemSpy = vi.spyOn(localStorageMock, 'setItem');

    rememberContact(memberPubkey, '2026-06-01T00:00:00.000Z', isAllowed);

    expect(isAllowed).toHaveBeenCalledWith(memberPubkey);
    expect(setItemSpy).toHaveBeenCalledWith(STORAGE_KEYS.contacts, expect.any(String));

    setItemSpy.mockRestore();
  });

  it('writes storage when no isAllowed parameter is provided (backward compatibility)', () => {
    const pubkey = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const setItemSpy = vi.spyOn(localStorageMock, 'setItem');

    rememberContact(pubkey, '2026-06-01T00:00:00.000Z');

    expect(setItemSpy).toHaveBeenCalledWith(STORAGE_KEYS.contacts, expect.any(String));

    setItemSpy.mockRestore();
  });
});
