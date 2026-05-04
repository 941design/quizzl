import { beforeEach, describe, expect, it } from 'vitest';
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
        avatar: {
          id: 'apple',
          imageUrl: 'https://example.test/alice.png',
          subject: 'apple',
          accessories: [],
        },
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
