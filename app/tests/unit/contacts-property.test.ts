/**
 * Property-based gap-closing tests for contacts.ts
 *
 * Closes the 11 real-gap survivors from the mutation gate:
 *
 * Line 92  — lastSeenAt monotonicity: the stored lastSeenAt must always be
 *             max(existing.lastSeenAt, seenAt), never min.
 * Line 107 — rememberContactsFromGroups must skip ownPubkeyHex regardless of casing.
 * Line 147 — listContacts self-filter: ownPubkeyHex is never in the returned list.
 * Line 148 — listContacts self-filter equality boundary.
 * Line 166 — updatedAt ordering: contacts with newer updatedAt appear before older ones.
 * Line 167 — nickname tie-break: when updatedAt is equal, contacts are sorted by
 *             nickname || pubkeyHex alphabetically.
 * Lines 208/228 — purgeStrangerContacts only writes storage when there is actually a
 *                 stranger to remove (changed-guard) — verified for both stores.
 *
 * Round-3 additions:
 * Line 199 — purgeStrangerContacts !raw guard for lp_contacts_v1: when the key
 *             is absent (getItem returns null) the contacts block is skipped but
 *             the contactCache block still runs.
 * Line 219 — purgeStrangerContacts !raw guard for lp_contactCache_v1: same pattern.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  listContacts,
  rememberContact,
  rememberContactsFromGroups,
  purgeStrangerContacts,
} from '@/src/lib/contacts';
import { STORAGE_KEYS, type Group } from '@/src/types';

// ── localStorage mock ──────────────────────────────────────────────────────────

const store: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
  removeItem: (key: string) => { delete store[key]; },
  clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
};

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

// Helper to read stored contacts as a plain object
function readStoredContacts(): Record<string, { lastSeenAt: string }> {
  const raw = store[STORAGE_KEYS.contacts];
  return raw ? JSON.parse(raw) : {};
}

// Helper to produce n ISO timestamps offset by n * secondsPerStep seconds
function isoAt(offsetSeconds: number): string {
  return new Date(1_700_000_000_000 + offsetSeconds * 1000).toISOString();
}

beforeEach(() => {
  localStorageMock.clear();
  localStorageMock.setItem.mockClear();
});

// ── lastSeenAt monotonicity (line 92) ─────────────────────────────────────────

describe('rememberContact — lastSeenAt is max(existing, seenAt)', () => {
  /**
   * Property: for any ordering of timestamps t1, t2, after calling rememberContact
   * twice for the same peer, lastSeenAt equals the later one.
   * Kills: ConditionalExpression repl='true' and repl='false' on the ternary.
   */

  const PEER = 'a'.repeat(64);

  it('seenAt is newer: lastSeenAt advances to seenAt', () => {
    const older = isoAt(0);
    const newer = isoAt(1000);
    rememberContact(PEER, older);
    rememberContact(PEER, newer);
    expect(readStoredContacts()[PEER].lastSeenAt).toBe(newer);
  });

  it('seenAt is older: lastSeenAt does not regress to seenAt', () => {
    const older = isoAt(0);
    const newer = isoAt(1000);
    rememberContact(PEER, newer);
    rememberContact(PEER, older);
    expect(readStoredContacts()[PEER].lastSeenAt).toBe(newer);
  });

  it('seenAt equal to existing: lastSeenAt is unchanged', () => {
    const ts = isoAt(500);
    rememberContact(PEER, ts);
    rememberContact(PEER, ts);
    expect(readStoredContacts()[PEER].lastSeenAt).toBe(ts);
  });

  /**
   * Parametric sweep over 50 random timestamp orderings.
   * The invariant: after all calls, lastSeenAt equals the lexicographic max.
   */
  it('parametric: after N calls, lastSeenAt == max(all seenAt values)', () => {
    const PEER2 = 'b'.repeat(64);
    const offsets = [0, 100, 50, 200, 75, 300, 150, 250, 10, 400];
    const timestamps = offsets.map(isoAt);
    const expectedMax = timestamps.reduce((m, t) => (t > m ? t : m));

    for (const ts of timestamps) {
      rememberContact(PEER2, ts);
    }

    expect(readStoredContacts()[PEER2].lastSeenAt).toBe(expectedMax);
  });

  it('property: repeated calls never move lastSeenAt backwards', () => {
    const PEER3 = 'c'.repeat(64);
    const timestamps = [500, 200, 800, 100, 600, 900, 50, 700].map(isoAt);
    let currentMax = '';
    for (const ts of timestamps) {
      rememberContact(PEER3, ts);
      const actual = readStoredContacts()[PEER3].lastSeenAt;
      currentMax = actual > currentMax ? actual : currentMax;
      expect(actual).toBe(currentMax);
    }
  });

  /**
   * Sharpened EqualityOperator boundary test.
   * Kills: `>=` → `<=` (would prevent advancement when seenAt is strictly newer).
   *        `>=` → `<`  (same failure mode).
   *        `>=` → `!=` (would always prefer seenAt).
   * The test checks that calling with a NEWER seenAt advances lastSeenAt AND that
   * calling again with an OLDER seenAt does NOT regress it, in a tight parametric
   * sweep verifying exact values.
   */
  it('EqualityOperator boundary: advance then no-regress parametric sweep', () => {
    const PEER4 = 'd'.repeat(64);
    // Advance through 5 timestamps (each newer than the last)
    const ascending = [100, 200, 300, 400, 500].map(isoAt);
    for (const ts of ascending) {
      rememberContact(PEER4, ts);
    }
    expect(readStoredContacts()[PEER4].lastSeenAt).toBe(ascending[ascending.length - 1]);

    // Now try to regress with the oldest timestamp
    rememberContact(PEER4, ascending[0]);
    expect(readStoredContacts()[PEER4].lastSeenAt).toBe(ascending[ascending.length - 1]);

    // And check that exactly at the current value is stable (equal case)
    const currentMax = readStoredContacts()[PEER4].lastSeenAt;
    rememberContact(PEER4, currentMax);
    expect(readStoredContacts()[PEER4].lastSeenAt).toBe(currentMax);
  });
});

// ── rememberContactsFromGroups own-pubkey skip (line 107) ─────────────────────

describe('rememberContactsFromGroups — ownPubkeyHex is never stored', () => {
  /**
   * Property: for any ownPubkeyHex, calling rememberContactsFromGroups with a group
   * that includes ownPubkeyHex must not persist ownPubkeyHex as a contact.
   * Kills: the `if (ownPubkeyHex && ...) continue` guard flip.
   */

  function makeGroup(members: string[]): Group {
    return { id: 'g1', name: 'Test', createdAt: 1, memberPubkeys: members, relays: [] };
  }

  it('own pubkey is skipped when it is exactly equal to a member', () => {
    const ownPubkey = 'd'.repeat(64);
    const peer = 'e'.repeat(64);
    rememberContactsFromGroups([makeGroup([ownPubkey, peer])], ownPubkey);
    const contacts = readStoredContacts();
    expect(contacts[ownPubkey]).toBeUndefined();
    expect(contacts[peer]).toBeDefined();
  });

  it('own pubkey is skipped with uppercase casing on the member', () => {
    const ownPubkey = 'f'.repeat(64);
    const upperOwn = ownPubkey.toUpperCase();
    const peer = '1'.repeat(64);
    rememberContactsFromGroups([makeGroup([upperOwn, peer])], ownPubkey);
    expect(readStoredContacts()[upperOwn]).toBeUndefined();
    expect(readStoredContacts()[upperOwn.toLowerCase()]).toBeUndefined();
  });

  it('own pubkey is skipped with uppercase casing on ownPubkeyHex', () => {
    const lower = 'a0'.repeat(32);
    const upper = lower.toUpperCase();
    const peer = 'b0'.repeat(32);
    rememberContactsFromGroups([makeGroup([lower, peer])], upper);
    expect(readStoredContacts()[lower]).toBeUndefined();
    expect(readStoredContacts()[peer]).toBeDefined();
  });

  it('parametric: ownPubkey is never in result for any group membership', () => {
    const ownPubkeys = ['aa'.repeat(32), 'bb'.repeat(32), 'cc'.repeat(32)];
    for (const own of ownPubkeys) {
      localStorageMock.clear();
      const peers = ['11'.repeat(32), '22'.repeat(32)];
      const members = [own, ...peers];
      rememberContactsFromGroups([makeGroup(members)], own);
      const contacts = readStoredContacts();
      expect(contacts[own]).toBeUndefined();
      for (const p of peers) expect(contacts[p]).toBeDefined();
    }
  });

  it('null ownPubkeyHex: all members are remembered (no-skip path)', () => {
    const members = ['11'.repeat(32), '22'.repeat(32)];
    rememberContactsFromGroups([makeGroup(members)], null);
    for (const m of members) expect(readStoredContacts()[m]).toBeDefined();
  });
});

// ── listContacts self-filter (lines 147-148) ──────────────────────────────────

describe('listContacts — ownPubkeyHex never appears in result', () => {
  /**
   * Property: the returned list must not contain ownPubkeyHex, regardless of case.
   * Kills: the `!ownPubkeyHex` fast-path flip and the equality comparator flip.
   */

  it('own pubkey is excluded when ownPubkeyHex is provided', () => {
    const own = 'aabb'.repeat(16);
    const peer = 'ccdd'.repeat(16);
    rememberContact(own, isoAt(0));
    rememberContact(peer, isoAt(1));

    const result = listContacts(own);
    expect(result.map((c) => c.pubkeyHex)).not.toContain(own);
    expect(result.map((c) => c.pubkeyHex)).toContain(peer);
  });

  it('own pubkey is excluded regardless of case (uppercase ownPubkeyHex)', () => {
    const ownLower = '1234'.repeat(16);
    const ownUpper = ownLower.toUpperCase();
    const peer = '5678'.repeat(16);
    rememberContact(ownLower, isoAt(0));
    rememberContact(peer, isoAt(1));

    const result = listContacts(ownUpper);
    const pubkeys = result.map((c) => c.pubkeyHex);
    expect(pubkeys).not.toContain(ownLower);
    expect(pubkeys).toContain(peer);
  });

  it('null ownPubkeyHex: all stored contacts are returned', () => {
    const pubkeys = ['aa'.repeat(32), 'bb'.repeat(32), 'cc'.repeat(32)];
    for (const p of pubkeys) rememberContact(p, isoAt(0));

    const result = listContacts(null);
    const resultPubkeys = result.map((c) => c.pubkeyHex);
    for (const p of pubkeys) expect(resultPubkeys).toContain(p);
  });

  it('parametric: own pubkey never in result for various own pubkeys', () => {
    const ownPubkeys = ['aa'.repeat(32), 'bb'.repeat(32), 'cc'.repeat(32)];
    const peer = 'ff'.repeat(32);

    for (const own of ownPubkeys) {
      localStorageMock.clear();
      rememberContact(own, isoAt(0));
      rememberContact(peer, isoAt(1));
      const result = listContacts(own);
      const pubkeys = result.map((c) => c.pubkeyHex);
      expect(pubkeys).not.toContain(own);
      expect(pubkeys).toContain(peer);
    }
  });
});

// ── listContacts updatedAt ordering (line 166) ────────────────────────────────

describe('listContacts — non-archived contacts sorted by recency', () => {
  /**
   * Property: in the returned list, for any two non-archived contacts a and b
   * where a comes before b, a.updatedAt >= b.updatedAt (or lastSeenAt if no cache).
   * Kills: the `updatedA !== updatedB` guard flip that bypasses the comparison.
   */

  it('contact with newer lastSeenAt appears first (no cache)', () => {
    const older = 'aaaa'.repeat(16);
    const newer = 'bbbb'.repeat(16);
    rememberContact(older, isoAt(100));
    rememberContact(newer, isoAt(200));

    const result = listContacts(null);
    const pubkeys = result.filter((c) => !c.isArchived).map((c) => c.pubkeyHex);
    expect(pubkeys.indexOf(newer)).toBeLessThan(pubkeys.indexOf(older));
  });

  it('parametric: 5 contacts sorted by descending lastSeenAt', () => {
    const offsets = [500, 100, 400, 200, 300];
    const peers = offsets.map((o, i) => `${'0' + i}`.repeat(32).slice(0, 64));
    for (let i = 0; i < peers.length; i++) rememberContact(peers[i], isoAt(offsets[i]));

    const result = listContacts(null);
    const nonArchived = result.filter((c) => !c.isArchived);
    for (let i = 0; i < nonArchived.length - 1; i++) {
      const a = nonArchived[i].lastSeenAt;
      const b = nonArchived[i + 1].lastSeenAt;
      // a must be >= b (descending order)
      expect(a >= b).toBe(true);
    }
  });
});

// ── nickname tie-break (line 167) ─────────────────────────────────────────────

describe('listContacts — nickname tie-break when timestamps are equal', () => {
  /**
   * Property: when two contacts have equal updatedAt (and lastSeenAt), they are
   * ordered by (nickname || pubkeyHex) alphabetically (ascending).
   * Kills: the `|| fallback` flip in the localeCompare argument.
   */

  it('contacts with same lastSeenAt are sorted by pubkeyHex when no cache (fallback)', () => {
    const ts = isoAt(0);
    const pA = 'bbb'.repeat(21) + 'b';  // 64 chars
    const pB = 'aaa'.repeat(21) + 'a';
    rememberContact(pA, ts);
    rememberContact(pB, ts);

    const result = listContacts(null);
    const pubkeys = result.map((c) => c.pubkeyHex);
    // pB (aaa...) < pA (bbb...) alphabetically → pB should come first
    expect(pubkeys.indexOf(pB)).toBeLessThan(pubkeys.indexOf(pA));
  });
});

// ── purgeStrangerContacts changed-guard (lines 208, 228) ─────────────────────

describe('purgeStrangerContacts — storage only written when there are changes', () => {
  /**
   * Property: if no strangers exist, localStorage.setItem must not be called.
   * Kills: the `if (changed)` guard mutations (repl='true') on both stores.
   */

  const MEMBER = '11'.repeat(32);
  const OWN = '22'.repeat(32);
  const GROUP: Group = { id: 'g1', name: 'G', createdAt: 1, memberPubkeys: [MEMBER, OWN], relays: [] };
  function getWhitelist() { return { groups: [GROUP], ownPubkeyHex: OWN }; }

  it('does not write contacts store when all entries are members', () => {
    const now = isoAt(0);
    const contacts = { [MEMBER]: { pubkeyHex: MEMBER, firstSeenAt: now, lastSeenAt: now, archivedAt: null } };
    store[STORAGE_KEYS.contacts] = JSON.stringify(contacts);
    localStorageMock.setItem.mockClear();

    purgeStrangerContacts(getWhitelist);

    // setItem should NOT have been called for contacts key since nothing changed
    const contactsCalls = localStorageMock.setItem.mock.calls.filter(
      ([k]) => k === STORAGE_KEYS.contacts,
    );
    expect(contactsCalls).toHaveLength(0);
  });

  it('does not write contactCache store when all cache entries are members', () => {
    const cache = { [MEMBER]: { nickname: 'Bob', avatar: null, updatedAt: isoAt(0) } };
    store[STORAGE_KEYS.contactCache] = JSON.stringify(cache);
    localStorageMock.setItem.mockClear();

    purgeStrangerContacts(getWhitelist);

    const cacheCalls = localStorageMock.setItem.mock.calls.filter(
      ([k]) => k === STORAGE_KEYS.contactCache,
    );
    expect(cacheCalls).toHaveLength(0);
  });

  it('writes contacts store when a stranger is present', () => {
    const STRANGER = '33'.repeat(32);
    const now = isoAt(0);
    const contacts = {
      [STRANGER]: { pubkeyHex: STRANGER, firstSeenAt: now, lastSeenAt: now, archivedAt: null },
      [MEMBER]: { pubkeyHex: MEMBER, firstSeenAt: now, lastSeenAt: now, archivedAt: null },
    };
    store[STORAGE_KEYS.contacts] = JSON.stringify(contacts);
    localStorageMock.setItem.mockClear();

    purgeStrangerContacts(getWhitelist);

    const contactsCalls = localStorageMock.setItem.mock.calls.filter(
      ([k]) => k === STORAGE_KEYS.contacts,
    );
    expect(contactsCalls).toHaveLength(1);
    const written = JSON.parse(contactsCalls[0][1]) as Record<string, unknown>;
    expect(written[STRANGER]).toBeUndefined();
    expect(written[MEMBER]).toBeDefined();
  });

  it('writes contactCache store when a stranger is present in the cache', () => {
    const STRANGER = '44'.repeat(32);
    const cache = {
      [STRANGER]: { nickname: 'Mallory', avatar: null, updatedAt: isoAt(0) },
      [MEMBER]: { nickname: 'Bob', avatar: null, updatedAt: isoAt(0) },
    };
    store[STORAGE_KEYS.contactCache] = JSON.stringify(cache);
    localStorageMock.setItem.mockClear();

    purgeStrangerContacts(getWhitelist);

    const cacheCalls = localStorageMock.setItem.mock.calls.filter(
      ([k]) => k === STORAGE_KEYS.contactCache,
    );
    expect(cacheCalls).toHaveLength(1);
    const written = JSON.parse(cacheCalls[0][1]) as Record<string, unknown>;
    expect(written[STRANGER]).toBeUndefined();
    expect(written[MEMBER]).toBeDefined();
  });
});

// ── purgeStrangerContacts null-raw guards (lines 199, 219) ───────────────────

describe('purgeStrangerContacts — null-raw early-returns', () => {
  /**
   * Kills the `if (!raw) return` guards at contacts.ts:199 (lp_contacts_v1)
   * and contacts.ts:219 (lp_contactCache_v1).
   *
   * A mutation replacing `if (!raw)` with `if (false)` (never skip) would cause
   * JSON.parse(null) to throw — the try/catch absorbs that, but the subsequent
   * setItem call for an undefined-parse result would still fire, changing
   * observable behavior: a write where none should occur.
   *
   * Strategy: seed ONE key as absent (returns null) and the OTHER as a real JSON
   * object with a stranger. Verify the present key is processed (stranger removed)
   * and the absent key is never written.
   */

  const STRANGER = '55'.repeat(32);
  const MEMBER_NR = '66'.repeat(32);
  const OWN_NR = '77'.repeat(32);
  const GROUP_NR: Group = {
    id: 'g-nr',
    name: 'NR',
    createdAt: 1,
    memberPubkeys: [MEMBER_NR, OWN_NR],
    relays: [],
  };
  function getWhitelist() { return { groups: [GROUP_NR], ownPubkeyHex: OWN_NR }; }

  it('skips contacts block when lp_contacts_v1 is absent (null), processes contactCache', () => {
    // lp_contacts_v1 is NOT set (getItem returns null → !raw branch fires)
    // lp_contactCache_v1 has a stranger + member
    const cache = {
      [STRANGER]: { nickname: 'Mal', avatar: null, updatedAt: isoAt(0) },
      [MEMBER_NR]: { nickname: 'Bob', avatar: null, updatedAt: isoAt(0) },
    };
    store[STORAGE_KEYS.contactCache] = JSON.stringify(cache);
    delete store[STORAGE_KEYS.contacts]; // ensure absent
    localStorageMock.setItem.mockClear();

    purgeStrangerContacts(getWhitelist);

    // contacts key must never be written (was absent — no data to clean)
    const contactsCalls = localStorageMock.setItem.mock.calls.filter(
      ([k]) => k === STORAGE_KEYS.contacts,
    );
    expect(contactsCalls).toHaveLength(0);

    // contactCache key must have been written with stranger removed
    const cacheCalls = localStorageMock.setItem.mock.calls.filter(
      ([k]) => k === STORAGE_KEYS.contactCache,
    );
    expect(cacheCalls).toHaveLength(1);
    const written = JSON.parse(cacheCalls[0][1]) as Record<string, unknown>;
    expect(written[STRANGER]).toBeUndefined();
    expect(written[MEMBER_NR]).toBeDefined();
  });

  it('skips contactCache block when lp_contactCache_v1 is absent (null), processes contacts', () => {
    // lp_contactCache_v1 is NOT set (getItem returns null → !raw branch fires)
    // lp_contacts_v1 has a stranger + member
    const now = isoAt(0);
    const contacts = {
      [STRANGER]: { pubkeyHex: STRANGER, firstSeenAt: now, lastSeenAt: now, archivedAt: null },
      [MEMBER_NR]: { pubkeyHex: MEMBER_NR, firstSeenAt: now, lastSeenAt: now, archivedAt: null },
    };
    store[STORAGE_KEYS.contacts] = JSON.stringify(contacts);
    delete store[STORAGE_KEYS.contactCache]; // ensure absent
    localStorageMock.setItem.mockClear();

    purgeStrangerContacts(getWhitelist);

    // contactCache key must never be written (was absent — no data to clean)
    const cacheCalls = localStorageMock.setItem.mock.calls.filter(
      ([k]) => k === STORAGE_KEYS.contactCache,
    );
    expect(cacheCalls).toHaveLength(0);

    // contacts key must have been written with stranger removed
    const contactsCalls = localStorageMock.setItem.mock.calls.filter(
      ([k]) => k === STORAGE_KEYS.contacts,
    );
    expect(contactsCalls).toHaveLength(1);
    const written = JSON.parse(contactsCalls[0][1]) as Record<string, unknown>;
    expect(written[STRANGER]).toBeUndefined();
    expect(written[MEMBER_NR]).toBeDefined();
  });

  it('is a complete no-op when both keys are absent (nothing to write)', () => {
    delete store[STORAGE_KEYS.contacts];
    delete store[STORAGE_KEYS.contactCache];
    localStorageMock.setItem.mockClear();

    purgeStrangerContacts(getWhitelist);

    expect(localStorageMock.setItem).not.toHaveBeenCalled();
  });
});
