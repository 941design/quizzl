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
  confirmContact,
  isPendingConfirmation,
  unarchiveContact,
  rememberContact,
  rememberPendingContact,
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

// ── Gap 3: a blocked re-add must not silently reactivate or re-seed ever-known ──
// (epic: block-contact, DD-9 — this describe block previously pinned the OLD
// "reactivate on re-add" behavior; that behavior was intentionally removed so
// that re-adding a blocked contact by npub can no longer reopen the DM
// channel. Updated here rather than left failing, since it exercises the
// exact code path DD-9 changed.)
describe('addContactByNpub — blocked re-add guard (epic: block-contact, DD-9)', () => {
  it('does not register a blocked contact as an ever-known peer as a side effect of the rejected re-add', () => {
    const pubkeyHex = 'e'.repeat(64);
    const seededAt = '2020-01-01T00:00:00.000Z';
    rememberContact(pubkeyHex, seededAt);
    archiveContact(pubkeyHex, seededAt);
    // knownPeers is derived from localStorage; the beforeEach clear left it empty,
    // and archiving alone never seeds it either.
    expect(loadKnownPeers().has(pubkeyHex)).toBe(false);

    const result = addContactByNpub(pubkeyToNpub(pubkeyHex), null);

    expect(result).toEqual({ ok: false, error: 'already_exists', blocked: true, pubkeyHex });
    // The removed reactivate branch used to call rememberKnownPeers([pubkeyHex]);
    // a re-add attempt on a blocked contact must NOT do so — no channel reopens,
    // and no side-channel write leaves the peer purge-exempt behind the block.
    expect(loadKnownPeers().has(pubkeyHex)).toBe(false);
    // archivedAt itself is untouched — the guard this test now pins.
    expect(readStoredContacts()[pubkeyHex].archivedAt).toBe(seededAt);
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
      // Epic: pending-contact-confirmation (AC-STRUCT-1/AC-STRUCT-2) — purely
      // additive default for any entry (including this null-valued legacy
      // one) that lacks the field.
      pendingConfirmationSince: null,
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

// ── Gap 8: pending-confirmation empty-pubkey guards (epic: pending-contact-confirmation) ──
describe('rememberPendingContact — empty-pubkey guard', () => {
  it('rememberPendingContact("") persists nothing — no empty-key contact leaks in', () => {
    rememberPendingContact('', '2026-06-01T00:00:00.000Z');
    expect(readStoredContacts()).toEqual({});
    expect(Object.keys(readStoredContacts())).not.toContain('');
  });
});

describe('isPendingConfirmation — empty-pubkey guard', () => {
  it('isPendingConfirmation("") returns false, never true', () => {
    rememberPendingContact('a'.repeat(64), '2026-06-01T00:00:00.000Z');
    expect(isPendingConfirmation('')).toBe(false);
  });
});

// ── Gap 9: rememberPendingContact must not regress lastSeenAt on a stale re-pair ──
describe('rememberPendingContact — lastSeenAt is monotonic-forward on re-pairing', () => {
  it('does not regress lastSeenAt when a re-pairing arrives with an earlier seenAt than the stored one', () => {
    const pubkeyHex = 'b'.repeat(64);
    const newerSeenAt = '2026-06-01T00:00:00.000Z';
    const staleSeenAt = '2020-01-01T00:00:00.000Z';
    rememberPendingContact(pubkeyHex, newerSeenAt);

    rememberPendingContact(pubkeyHex, staleSeenAt); // older re-pair

    // Regression pin: the ternary `existing.lastSeenAt >= seenAt ? existing.lastSeenAt : seenAt`
    // must keep the newer stored value. A collapse to always-seenAt would rewind to staleSeenAt.
    expect(readStoredContacts()[pubkeyHex].lastSeenAt).toBe(newerSeenAt);
  });
});

// ── Gap 10: confirmContact must isolate its cleared pubkey ────────────────────
describe('confirmContact — isolation across independently-stored pending contacts', () => {
  it('clears only the target pending contact and leaves other pending contacts untouched', () => {
    // Two independently-stored pending contacts. A confirm on the first must
    // NOT clear the second — a filter-collapse mutation (all keys "match")
    // would clear both.
    const target = 'a'.repeat(64);
    const other = 'b'.repeat(64);
    rememberPendingContact(target, '2026-06-01T00:00:00.000Z');
    rememberPendingContact(other, '2026-06-02T00:00:00.000Z');

    confirmContact(target);

    const contacts = readStoredContacts();
    expect(contacts[target].pendingConfirmationSince).toBeNull();
    expect(contacts[other].pendingConfirmationSince).toBe('2026-06-02T00:00:00.000Z');
  });
});

// ── Gap 11: listContacts sort — force the sort into both comparator orders ────
// The Gap 6 test above pins the "archived at the end" outcome but does not
// exhaustively cover the `-1` limb of `a.isArchived ? 1 : -1`. V8's TimSort on
// the seed order [active, active, archived] happens to never invoke the
// comparator with (active, archived) — the seed already agrees with the
// desired order for that pair. This block seeds in an order that forces V8 to
// invoke the comparator with the second argument archived (and vice versa).
describe('listContacts — archived-sort under adversarial seed orders', () => {
  it('places archived at the end when the seed order interleaves active/archived', () => {
    const active1 = 'c'.repeat(63) + '1';
    const active2 = 'c'.repeat(63) + '2';
    const archived1 = 'c'.repeat(63) + '3';
    const archived2 = 'c'.repeat(63) + '4';
    // Interleave: active, archived, active, archived — every comparison the
    // sort makes between an adjacent pair straddles the archive boundary.
    rememberContact(active1, '2021-01-01T00:00:00.000Z');
    rememberContact(archived1, '2021-02-01T00:00:00.000Z');
    archiveContact(archived1, '2021-02-01T00:00:00.000Z');
    rememberContact(active2, '2021-03-01T00:00:00.000Z');
    rememberContact(archived2, '2021-04-01T00:00:00.000Z');
    archiveContact(archived2, '2021-04-01T00:00:00.000Z');

    const listed = listContacts(null, { includeArchived: true });

    // Both actives must precede both archived, regardless of lastSeenAt.
    const archivedFlags = listed.map((c) => c.isArchived);
    expect(archivedFlags).toEqual([false, false, true, true]);
  });

  it('places archived at the end when the seed order lists all archived before actives', () => {
    const active1 = 'd'.repeat(63) + '1';
    const active2 = 'd'.repeat(63) + '2';
    const archived1 = 'd'.repeat(63) + '3';
    const archived2 = 'd'.repeat(63) + '4';
    // Archived-first seed forces the sort to actively move them past every
    // active — the comparator must return positive for (archived, active) AND
    // negative for (active, archived).
    rememberContact(archived1, '2021-01-01T00:00:00.000Z');
    archiveContact(archived1, '2021-01-01T00:00:00.000Z');
    rememberContact(archived2, '2021-02-01T00:00:00.000Z');
    archiveContact(archived2, '2021-02-01T00:00:00.000Z');
    rememberContact(active1, '2021-03-01T00:00:00.000Z');
    rememberContact(active2, '2021-04-01T00:00:00.000Z');

    const listed = listContacts(null, { includeArchived: true });

    const archivedFlags = listed.map((c) => c.isArchived);
    expect(archivedFlags).toEqual([false, false, true, true]);
  });
});
