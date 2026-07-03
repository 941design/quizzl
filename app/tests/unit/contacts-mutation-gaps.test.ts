/**
 * Mutation-gap closure for src/lib/contacts.ts.
 *
 * Each block below pins a user-facing behavior that the existing contacts
 * suites exercise but never *assert*, surfaced as a surviving mutant by a
 * Stryker run on this module. These are behavior-level assertions (what the
 * function is for), not mirrors of the implementation's branching.
 *
 * Not duplicated here (already covered elsewhere): happy-path add/reactivate,
 * case-insensitive duplicate/reactivation, the malformed-*short* npub, the
 * new-contact ever-known-peer registration, and the purge SSR guard.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { nip19 } from 'nostr-tools';
import {
  addContactByNpub,
  archiveContact,
  unarchiveContact,
  rememberContact,
  readStoredContacts,
  listContacts,
  eligibleGroupsForContact,
  purgeStrangerContacts,
} from '@/src/lib/contacts';
import { loadKnownPeers } from '@/src/lib/knownPeers';
import { pubkeyToNpub } from '@/src/lib/nostrKeys';
import { STORAGE_KEYS, type Group } from '@/src/types';

// jsdom provides localStorage, but mirror the explicit backing-store mock the
// sibling suites use so state is fully isolated and clearable per test.
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => { store[key] = value; },
  removeItem: (key: string) => { delete store[key]; },
  clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

const EPOCH = new Date(0).toISOString(); // '1970-01-01T00:00:00.000Z'

function makeGroup(id: string, memberPubkeys: string[]): Group {
  return { id, memberPubkeys } as unknown as Group;
}

beforeEach(() => {
  localStorageMock.clear();
});

// ── Gap 1: empty / non-existent-input contracts must not mutate storage ───────
describe('contacts — empty and non-existent input contracts', () => {
  it('rememberContact("") persists nothing (empty-pubkey guard)', () => {
    rememberContact('');
    expect(readStoredContacts()).toEqual({});
    // Belt-and-braces: no empty-string key leaked in.
    expect(Object.keys(readStoredContacts())).not.toContain('');
  });

  it('archiveContact on an unknown pubkey creates no entry (existence guard)', () => {
    archiveContact('a'.repeat(64));
    expect(readStoredContacts()).toEqual({});
  });

  it('unarchiveContact on an unknown pubkey creates no entry (existence guard)', () => {
    unarchiveContact('b'.repeat(64));
    expect(readStoredContacts()).toEqual({});
  });

  it('eligibleGroupsForContact(groups, "") returns [] rather than every group', () => {
    const groups = [makeGroup('g1', ['x'.repeat(64)]), makeGroup('g2', ['y'.repeat(64)])];
    expect(eligibleGroupsForContact(groups, '')).toEqual([]);
  });
});

// ── Gap 2: add-by-npub must isolate its case-insensitive match ────────────────
describe('addContactByNpub — match isolation against unrelated contacts', () => {
  it('adds a brand-new contact even when an unrelated contact is already stored', () => {
    // Pre-seed an entirely different contact. A match filter that ignores the
    // target pubkey would see this as an existing match and reject the add.
    rememberContact('c'.repeat(64), '2021-01-01T00:00:00.000Z');

    const newPubkey = 'd'.repeat(64);
    const result = addContactByNpub(pubkeyToNpub(newPubkey), null);

    expect(result).toEqual({ ok: true, pubkeyHex: newPubkey, reactivated: false });
    expect(readStoredContacts()[newPubkey]).toBeDefined();
  });
});

// ── Gap 3: reactivation must register the peer as ever-known (ADR-005) ─────────
describe('addContactByNpub — ever-known-peer registration on reactivation', () => {
  it('registers a reactivated archived contact as an ever-known peer', () => {
    const pubkeyHex = 'e'.repeat(64);
    const seededAt = '2020-01-01T00:00:00.000Z';
    rememberContact(pubkeyHex, seededAt);
    archiveContact(pubkeyHex, seededAt);
    // knownPeers is derived from localStorage; the beforeEach clear left it empty.
    expect(loadKnownPeers().has(pubkeyHex)).toBe(false);

    const result = addContactByNpub(pubkeyToNpub(pubkeyHex), null);

    expect(result).toEqual({ ok: true, pubkeyHex, reactivated: true });
    // The reactivate branch must call rememberKnownPeers([pubkeyHex]); an empty
    // argument would leave the peer purge-exposed.
    expect(loadKnownPeers().has(pubkeyHex)).toBe(true);
  });
});

// ── Gap 4: pubkey validation must reject an over-long decoded payload ──────────
describe('addContactByNpub — decoded-payload length validation', () => {
  it('rejects an npub whose decoded payload is longer than 64 hex chars', () => {
    // 33-byte (66 hex char) payload: nip19 encodes/decodes it fine, but it is
    // not a 32-byte pubkey. Only a fully-anchored /^[0-9a-f]{64}$/ rejects it;
    // dropping either anchor lets a 64-hex substring slip through.
    const overLongHex = 'ab'.repeat(33); // 66 hex chars
    const overLongNpub = nip19.npubEncode(overLongHex);
    const before = readStoredContacts();

    const result = addContactByNpub(overLongNpub, null);

    expect(result).toEqual({ ok: false, error: 'invalid_npub' });
    expect(readStoredContacts()).toEqual(before);
  });
});

// ── Gap 5: purge must count deletions in BOTH stores exactly ──────────────────
describe('purgeStrangerContacts — exact deleted count across both stores', () => {
  it('returns the exact total of entries removed from contacts and contactCache', () => {
    const ownPubkeyHex = 'f'.repeat(64);
    // With empty groups and empty knownPeers, isAllowedDmSender rejects every
    // peer, so every seeded entry is a stranger and gets purged.
    const stranger1 = '1'.repeat(64);
    const stranger2 = '2'.repeat(64);
    const stranger3 = '3'.repeat(64);
    const stranger4 = '4'.repeat(64);
    const stranger5 = '5'.repeat(64);

    // 2 entries in the contacts store.
    localStorage.setItem(
      STORAGE_KEYS.contacts,
      JSON.stringify({
        [stranger1]: { pubkeyHex: stranger1, firstSeenAt: EPOCH, lastSeenAt: EPOCH, archivedAt: null },
        [stranger2]: { pubkeyHex: stranger2, firstSeenAt: EPOCH, lastSeenAt: EPOCH, archivedAt: null },
      }),
    );
    // 3 entries in the contactCache store.
    localStorage.setItem(
      STORAGE_KEYS.contactCache,
      JSON.stringify({
        [stranger3]: { nickname: 'a', avatar: null, updatedAt: EPOCH },
        [stranger4]: { nickname: 'b', avatar: null, updatedAt: EPOCH },
        [stranger5]: { nickname: 'c', avatar: null, updatedAt: EPOCH },
      }),
    );

    const result = purgeStrangerContacts(() => ({
      groups: [],
      knownPeers: new Set<string>(),
      ownPubkeyHex,
    }));

    // 2 (contacts) + 3 (contactCache) = 5. A miscounting cache loop would not
    // land on exactly 5.
    expect(result.deleted).toBe(5);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.contacts) ?? '{}')).toEqual({});
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.contactCache) ?? '{}')).toEqual({});
  });
});

// ── Gap 6: listContacts must sort active contacts before archived ─────────────
describe('listContacts — archived contacts sort after active ones', () => {
  it('orders active contacts before archived when both are included', () => {
    // Two active + one archived. Three elements force the sort comparator to run
    // in both argument orders, so BOTH sides of the `a.isArchived ? 1 : -1`
    // branch execute (a lone active/archived pair leaves one side unreached).
    const active1 = 'a'.repeat(63) + '1';
    const active2 = 'a'.repeat(63) + '3';
    const archivedPubkey = 'a'.repeat(63) + '2';
    rememberContact(active1, '2021-01-01T00:00:00.000Z');
    rememberContact(active2, '2021-03-01T00:00:00.000Z');
    rememberContact(archivedPubkey, '2022-01-01T00:00:00.000Z');
    archiveContact(archivedPubkey, '2022-06-01T00:00:00.000Z');

    const listed = listContacts(null, { includeArchived: true });

    // The archived-vs-active comparison decides order before any timestamp
    // tiebreak: both active contacts lead, the archived one trails — even
    // though the archived entry has the newest lastSeenAt.
    expect(listed[listed.length - 1].pubkeyHex).toBe(archivedPubkey);
    expect(listed[listed.length - 1].isArchived).toBe(true);
    expect(listed.slice(0, 2).every((c) => !c.isArchived)).toBe(true);
  });
});

// ── Gap 7: readStoredContacts resilience and partial-entry normalization ──────
describe('readStoredContacts — corrupt input and partial-entry normalization', () => {
  it('returns {} for corrupt JSON instead of throwing', () => {
    localStorage.setItem(STORAGE_KEYS.contacts, '{ this is not json');
    expect(() => readStoredContacts()).not.toThrow();
    expect(readStoredContacts()).toEqual({});
  });

  it('normalizes an entry missing all fields: pubkeyHex from the key, timestamps to epoch', () => {
    const key = '9'.repeat(64);
    localStorage.setItem(STORAGE_KEYS.contacts, JSON.stringify({ [key]: { archivedAt: null } }));

    const normalized = readStoredContacts()[key];

    expect(normalized.pubkeyHex).toBe(key);
    expect(normalized.firstSeenAt).toBe(EPOCH);
    expect(normalized.lastSeenAt).toBe(EPOCH);
  });

  it('falls back lastSeenAt to firstSeenAt when only lastSeenAt is missing', () => {
    const key = '8'.repeat(64);
    const firstSeenAt = '2022-05-05T00:00:00.000Z';
    localStorage.setItem(STORAGE_KEYS.contacts, JSON.stringify({ [key]: { firstSeenAt, archivedAt: null } }));

    const normalized = readStoredContacts()[key];

    expect(normalized.firstSeenAt).toBe(firstSeenAt);
    expect(normalized.lastSeenAt).toBe(firstSeenAt);
  });

  it('normalizes a null entry value to a fully-defaulted contact rather than throwing', () => {
    // A legacy/corrupt store can hold `{ key: null }`. Normalization must read
    // through the null defensively (optional chaining) instead of dereferencing.
    const key = '7'.repeat(64);
    localStorage.setItem(STORAGE_KEYS.contacts, JSON.stringify({ [key]: null }));

    let normalized: ReturnType<typeof readStoredContacts>[string] | undefined;
    expect(() => { normalized = readStoredContacts()[key]; }).not.toThrow();
    expect(normalized).toEqual({
      pubkeyHex: key,
      firstSeenAt: EPOCH,
      lastSeenAt: EPOCH,
      archivedAt: null,
    });
  });
});

// ── Gap 7b: listContacts tolerates a corrupt contactCache snapshot ────────────
describe('listContacts — corrupt contactCache resilience', () => {
  it('lists stored contacts even when the contactCache JSON is corrupt', () => {
    const pubkeyHex = '6'.repeat(64);
    rememberContact(pubkeyHex, '2021-01-01T00:00:00.000Z');
    localStorage.setItem(STORAGE_KEYS.contactCache, '{ not valid json');

    let listed: ReturnType<typeof listContacts> = [];
    expect(() => { listed = listContacts(null); }).not.toThrow();
    expect(listed.map((c) => c.pubkeyHex)).toContain(pubkeyHex);
    // Corrupt cache degrades to empty profile fields rather than crashing.
    expect(listed.find((c) => c.pubkeyHex === pubkeyHex)?.nickname).toBe('');
  });
});
