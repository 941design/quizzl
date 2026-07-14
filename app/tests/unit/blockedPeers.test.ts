/**
 * Unit tests for blockedPeers.ts — epic: block-contact, S1.
 *
 * Covers AC-CORE-1 (isBlockedPeer membership + purity), AC-CORE-2 (block-set
 * derivation from readStoredContacts()), AC-CORE-3 (composite gate,
 * deny-overrides-allow, assembled at the call site — NOT inside
 * walledGarden.ts), AC-CORE-6 (defensive lowercase normalization), plus the
 * cross-cutting AC-SCOPE-1/2/3 regression proofs and the BlockedPeersSnapshot
 * / CompositeDmGate seam contracts consumed by S2 and S4.
 *
 * Convention (mirroring walledGarden.test.ts): AC-ID'd describe blocks,
 * literal 64-hex fixtures, explicit case-insensitivity checks. Hand-rolled
 * localStorage mock (mirroring contacts.test.ts / contacts-add-by-npub.test.ts)
 * since this module derives its set from the real readStoredContacts().
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { isAllowedDmSenderComposite, isBlockedPeer, loadBlockedPeers } from '@/src/lib/blockedPeers';
import { isAllowedDmSender } from '@/src/lib/walledGarden';
import {
  archiveContact,
  commonGroups,
  purgeStrangerContacts,
  readStoredContacts,
  rememberContact,
  unarchiveContact,
} from '@/src/lib/contacts';
import { loadKnownPeers, rememberKnownPeers } from '@/src/lib/knownPeers';
import { STORAGE_KEYS, type Group } from '@/src/types';

const store: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => { store[key] = value; },
  removeItem: (key: string) => { delete store[key]; },
  clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

const ALICE = 'a'.repeat(64);
const BOB = 'b'.repeat(64);
const CAROL = 'c'.repeat(64);
const MALLORY = 'f'.repeat(64);
const OWN_PUBKEY = 'e'.repeat(64);

const EMPTY_SET: ReadonlySet<string> = new Set();

beforeEach(() => {
  localStorageMock.clear();
});

// ── AC-CORE-1 ────────────────────────────────────────────────────────────────
describe('isBlockedPeer — AC-CORE-1', () => {
  it('returns true when the lowercased peerHex is a member of blockedPeers', () => {
    expect(isBlockedPeer(ALICE, new Set([ALICE]))).toBe(true);
  });

  it('returns false when peerHex is absent from blockedPeers', () => {
    expect(isBlockedPeer(BOB, new Set([ALICE]))).toBe(false);
  });

  it('returns false for an empty peerHex', () => {
    expect(isBlockedPeer('', new Set([ALICE]))).toBe(false);
  });

  it('returns false for an empty peerHex even when the empty string is itself a block-set member (AC-CORE-1 non-empty clause)', () => {
    // Locks the explicit "non-empty" half of the contract: the `if (!peerHex)`
    // short-circuit must win over a set membership check. Without the guard,
    // `''.toLowerCase()` is `''` and `has('')` would return true for this
    // (degenerate but type-valid) set — so this input is the only one that
    // distinguishes the guard from its fall-through.
    expect(isBlockedPeer('', new Set([''] ))).toBe(false);
  });

  it('returns false for an empty blockedPeers set regardless of input', () => {
    expect(isBlockedPeer(ALICE, EMPTY_SET)).toBe(false);
  });

  it('matches case-insensitively — uppercase input against a lowercase set member', () => {
    expect(isBlockedPeer(ALICE.toUpperCase(), new Set([ALICE]))).toBe(true);
  });

  it('body reads exclusively from its two parameters (no localStorage/IDB/React access)', () => {
    // Blow away localStorage entirely; the predicate must still work purely
    // off its arguments, proving it never reads storage internally.
    const originalGetItem = localStorageMock.getItem;
    localStorageMock.getItem = () => { throw new Error('isBlockedPeer must not touch localStorage'); };
    try {
      expect(isBlockedPeer(ALICE, new Set([ALICE]))).toBe(true);
      expect(isBlockedPeer(BOB, new Set([ALICE]))).toBe(false);
    } finally {
      localStorageMock.getItem = originalGetItem;
    }
  });
});

// ── AC-CORE-2 ────────────────────────────────────────────────────────────────
describe('loadBlockedPeers — AC-CORE-2 derivation from readStoredContacts()', () => {
  it('derives an empty set when no contact is archived', () => {
    rememberContact(ALICE, '2021-01-01T00:00:00.000Z');
    expect(loadBlockedPeers().size).toBe(0);
  });

  it('a contact newly archived via archiveContact appears in the very next derivation', () => {
    rememberContact(ALICE, '2021-01-01T00:00:00.000Z');
    expect(loadBlockedPeers().has(ALICE)).toBe(false);

    archiveContact(ALICE);

    expect(loadBlockedPeers().has(ALICE)).toBe(true);
  });

  it('a contact newly unarchived via unarchiveContact does not appear in the next derivation', () => {
    rememberContact(BOB, '2021-01-01T00:00:00.000Z');
    archiveContact(BOB);
    expect(loadBlockedPeers().has(BOB)).toBe(true);

    unarchiveContact(BOB);

    expect(loadBlockedPeers().has(BOB)).toBe(false);
  });

  it('derives multiple archived contacts, excluding non-archived ones', () => {
    rememberContact(ALICE, '2021-01-01T00:00:00.000Z');
    rememberContact(BOB, '2021-01-01T00:00:00.000Z');
    rememberContact(CAROL, '2021-01-01T00:00:00.000Z');
    archiveContact(ALICE);
    archiveContact(CAROL);

    const blocked = loadBlockedPeers();
    expect(blocked.has(ALICE)).toBe(true);
    expect(blocked.has(CAROL)).toBe(true);
    expect(blocked.has(BOB)).toBe(false);
  });
});

// ── AC-CORE-6 ────────────────────────────────────────────────────────────────
describe('loadBlockedPeers / isBlockedPeer — AC-CORE-6 defensive lowercase normalization', () => {
  it('represents a mixed-case-keyed archived contact in lowercase form in the derived set', () => {
    const mixedCaseKey = ALICE.toUpperCase();
    rememberContact(mixedCaseKey, '2021-01-01T00:00:00.000Z');
    archiveContact(mixedCaseKey);

    // Sanity: the stored key really is mixed-case, and pubkeyHex mirrors it
    // (rememberContact does not normalize) — a derivation that assumed
    // lowercase-already would silently pass without this check.
    expect(Object.keys(readStoredContacts())).toEqual([mixedCaseKey]);
    expect(readStoredContacts()[mixedCaseKey].pubkeyHex).toBe(mixedCaseKey);

    const blocked = loadBlockedPeers();
    expect(blocked.has(mixedCaseKey.toLowerCase())).toBe(true);
    // The set must contain ONLY the lowercase form, not the raw mixed-case one.
    expect(blocked.has(mixedCaseKey)).toBe(false);
    expect(Array.from(blocked)).toEqual([mixedCaseKey.toLowerCase()]);
  });

  it('isBlockedPeer matches an uppercase, lowercase, and mixed-case lookup against the same derived entry', () => {
    const mixedCaseKey = 'AbCdEf01'.repeat(8); // 64 chars, mixed case
    rememberContact(mixedCaseKey, '2021-01-01T00:00:00.000Z');
    archiveContact(mixedCaseKey);

    const blocked = loadBlockedPeers();
    expect(isBlockedPeer(mixedCaseKey.toLowerCase(), blocked)).toBe(true);
    expect(isBlockedPeer(mixedCaseKey.toUpperCase(), blocked)).toBe(true);
    expect(isBlockedPeer(mixedCaseKey, blocked)).toBe(true);
  });
});

// ── AC-CORE-3 / AC-CORE-4 — composite gate, assembled at the call site ──────
describe('composite gate (isAllowedDmSender(...) && !isBlockedPeer(...)) — AC-CORE-3', () => {
  it('deny overrides allow: a peer that is both group-allowed AND blocked evaluates to false', () => {
    const group: Group = {
      id: 'g1',
      name: 'Test',
      createdAt: 1,
      memberPubkeys: [ALICE],
      relays: [],
    };
    const blockedPeers = new Set([ALICE]);

    // isAllowedDmSender alone says true (ALICE shares a group)...
    expect(isAllowedDmSender(ALICE, [group], EMPTY_SET, OWN_PUBKEY)).toBe(true);
    // ...but the composite, assembled here at the call site, says false.
    const composite = isAllowedDmSender(ALICE, [group], EMPTY_SET, OWN_PUBKEY) && !isBlockedPeer(ALICE, blockedPeers);
    expect(composite).toBe(false);
  });

  it('deny overrides allow: a knownPeer who is also blocked evaluates to false', () => {
    const knownPeers = new Set([BOB]);
    const blockedPeers = new Set([BOB]);

    expect(isAllowedDmSender(BOB, [], knownPeers, OWN_PUBKEY)).toBe(true);
    const composite = isAllowedDmSender(BOB, [], knownPeers, OWN_PUBKEY) && !isBlockedPeer(BOB, blockedPeers);
    expect(composite).toBe(false);
  });

  it('an allowed, non-blocked peer still passes the composite gate', () => {
    const knownPeers = new Set([CAROL]);
    const blockedPeers = new Set([MALLORY]); // unrelated peer blocked
    const composite = isAllowedDmSender(CAROL, [], knownPeers, OWN_PUBKEY) && !isBlockedPeer(CAROL, blockedPeers);
    expect(composite).toBe(true);
  });

  it('a blocked peer who is also disallowed (stranger) still evaluates to false via isAllowedDmSender alone', () => {
    const blockedPeers = new Set([MALLORY]);
    const composite = isAllowedDmSender(MALLORY, [], EMPTY_SET, OWN_PUBKEY) && !isBlockedPeer(MALLORY, blockedPeers);
    expect(composite).toBe(false);
  });

  it('never caches across a blockedPeers change — re-evaluating with an updated set changes the result (CompositeDmGate seam, VQ-S1-018)', () => {
    const knownPeers = new Set([ALICE]);
    let blockedPeers = new Set<string>();

    const before = isAllowedDmSender(ALICE, [], knownPeers, OWN_PUBKEY) && !isBlockedPeer(ALICE, blockedPeers);
    expect(before).toBe(true);

    blockedPeers = new Set([ALICE]); // ALICE gets blocked
    const after = isAllowedDmSender(ALICE, [], knownPeers, OWN_PUBKEY) && !isBlockedPeer(ALICE, blockedPeers);
    expect(after).toBe(false);
  });
});

// ── isAllowedDmSenderComposite — the single shared exported composite ──────
// Exercises the REAL exported function (not an inline re-composition) now
// that it lives here in blockedPeers.ts, the one place both the
// notification watcher and ContactChat's S4 ingestion sites import it from.
describe('isAllowedDmSenderComposite — single shared definition (DD-8)', () => {
  it('deny overrides allow: a peer that is both group-allowed AND blocked evaluates to false', () => {
    const group: Group = {
      id: 'g1',
      name: 'Test',
      createdAt: 1,
      memberPubkeys: [ALICE],
      relays: [],
    };
    const blockedPeers = new Set([ALICE]);
    expect(isAllowedDmSenderComposite(ALICE, [group], EMPTY_SET, blockedPeers, OWN_PUBKEY)).toBe(false);
  });

  it('both true: a known peer who is also blocked evaluates to false', () => {
    const knownPeers = new Set([BOB]);
    const blockedPeers = new Set([BOB]);
    expect(isAllowedDmSenderComposite(BOB, [], knownPeers, blockedPeers, OWN_PUBKEY)).toBe(false);
  });

  it('the allowed case: an allowed, non-blocked peer passes', () => {
    const knownPeers = new Set([CAROL]);
    const blockedPeers = new Set([MALLORY]); // unrelated peer blocked
    expect(isAllowedDmSenderComposite(CAROL, [], knownPeers, blockedPeers, OWN_PUBKEY)).toBe(true);
  });

  it('a stranger who is also blocked (already denied by isAllowedDmSender alone) still evaluates to false', () => {
    const blockedPeers = new Set([MALLORY]);
    expect(isAllowedDmSenderComposite(MALLORY, [], EMPTY_SET, blockedPeers, OWN_PUBKEY)).toBe(false);
  });
});

// ── AC-CORE-4 / DD-8 — isAllowedDmSender stays pure and untouched ───────────
describe('isAllowedDmSender purity preservation — AC-CORE-4 (DD-8)', () => {
  it('isAllowedDmSender remains synchronous and returns a plain boolean (no Promise, no isBlockedPeer call inside)', () => {
    const result = isAllowedDmSender(ALICE, [], new Set([ALICE]), OWN_PUBKEY);
    expect(typeof result).toBe('boolean');
  });

  it('isAllowedDmSender ignores block state entirely — a blocked-but-known peer still returns true from isAllowedDmSender alone', () => {
    // This is the crux of AC-SCOPE-3: the walled-garden predicate has no
    // concept of "blocked", so a blocked contact remains, from its
    // perspective, an ordinary known peer.
    rememberContact(ALICE, '2021-01-01T00:00:00.000Z');
    rememberKnownPeers([ALICE]);
    archiveContact(ALICE);
    expect(readStoredContacts()[ALICE].archivedAt).not.toBeNull();
    expect(isAllowedDmSender(ALICE, [], loadKnownPeers(), OWN_PUBKEY)).toBe(true);
  });
});

// ── AC-SCOPE-1 — shared-group membership/rendering untouched by block ──────
describe('AC-SCOPE-1 — blocking does not disturb shared-group membership', () => {
  it('a blocked contact still appears via commonGroups for a group they share with the user', () => {
    const sharedGroup: Group = {
      id: 'g-shared',
      name: 'Biology',
      createdAt: 1,
      memberPubkeys: [ALICE, BOB],
      relays: [],
    };
    rememberContact(ALICE, '2021-01-01T00:00:00.000Z');

    const before = commonGroups([sharedGroup], ALICE);
    expect(before).toEqual([sharedGroup]);

    archiveContact(ALICE);

    const after = commonGroups([sharedGroup], ALICE);
    expect(after).toEqual([sharedGroup]);
    // Membership in the group's memberPubkeys is unaffected by the block —
    // commonGroups reads only the group snapshot, not blockedPeers/archivedAt.
    expect(sharedGroup.memberPubkeys).toContain(ALICE);
  });

  it('isAllowedDmSender (the predicate group rendering keys off) still returns true for a blocked shared-group member', () => {
    const sharedGroup: Group = {
      id: 'g-shared-2',
      name: 'History',
      createdAt: 1,
      memberPubkeys: [BOB],
      relays: [],
    };
    rememberContact(BOB, '2021-01-01T00:00:00.000Z');
    archiveContact(BOB);

    expect(isAllowedDmSender(BOB, [sharedGroup], EMPTY_SET, OWN_PUBKEY)).toBe(true);
  });
});

// ── AC-SCOPE-2 — knownPeers membership untouched by block ───────────────────
describe('AC-SCOPE-2 — blocking does not remove the peer from knownPeers', () => {
  it('knownPeers set membership is unchanged immediately after archiveContact', () => {
    rememberContact(ALICE, '2021-01-01T00:00:00.000Z');
    rememberKnownPeers([ALICE]);
    expect(loadKnownPeers().has(ALICE)).toBe(true);

    archiveContact(ALICE);

    expect(loadKnownPeers().has(ALICE)).toBe(true);
  });
});

// ── AC-SCOPE-3 — purgeStrangerContacts leaves a blocked-but-retained contact intact ──
describe('AC-SCOPE-3 — purgeStrangerContacts does not delete a blocked-but-retained contact', () => {
  it('a blocked (archived) contact that is still an ever-known peer survives the sweep, with archivedAt intact', () => {
    rememberContact(ALICE, '2021-01-01T00:00:00.000Z');
    rememberKnownPeers([ALICE]);
    archiveContact(ALICE);

    const before = readStoredContacts()[ALICE];
    expect(before.archivedAt).not.toBeNull();

    const result = purgeStrangerContacts(() => ({
      groups: [],
      knownPeers: loadKnownPeers(),
      ownPubkeyHex: OWN_PUBKEY,
    }));

    const after = readStoredContacts()[ALICE];
    expect(after).toBeDefined();
    expect(after.archivedAt).toBe(before.archivedAt);
    // Negative control: a genuine stranger (never in knownPeers, never in a
    // group) IS purged — proves survival above isn't because the sweep never
    // deletes anything.
    expect(result.deleted).toBe(0);
  });

  it('sweep still purges an unrelated stranger contact while retaining the blocked one (negative control)', () => {
    rememberContact(ALICE, '2021-01-01T00:00:00.000Z');
    rememberKnownPeers([ALICE]);
    archiveContact(ALICE);
    rememberContact(MALLORY, '2021-01-01T00:00:00.000Z'); // stranger, never known/grouped

    const result = purgeStrangerContacts(() => ({
      groups: [],
      knownPeers: loadKnownPeers(),
      ownPubkeyHex: OWN_PUBKEY,
    }));

    expect(readStoredContacts()[ALICE]).toBeDefined();
    expect(readStoredContacts()[ALICE].archivedAt).not.toBeNull();
    expect(readStoredContacts()[MALLORY]).toBeUndefined();
    expect(result.deleted).toBe(1);
  });
});

// ── BlockedPeersSnapshot seam contract (VQ-S1-017) ──────────────────────────
describe('BlockedPeersSnapshot seam contract — { blockedPeers, revision }', () => {
  it('the snapshot exposes only lowercase-hex members regardless of underlying storage case', () => {
    const mixedCaseKey = ALICE.toUpperCase();
    rememberContact(mixedCaseKey, '2021-01-01T00:00:00.000Z');
    archiveContact(mixedCaseKey);

    const snapshot = { blockedPeers: loadBlockedPeers(), revision: 1 };
    for (const peer of snapshot.blockedPeers) {
      expect(peer).toBe(peer.toLowerCase());
    }
    expect(snapshot.blockedPeers.has(ALICE)).toBe(true);
  });
});

describe('mock-transparency check (VQ-S1-020) — this suite exercises the real contacts persistence path', () => {
  it('readStoredContacts/archiveContact/unarchiveContact are the real, non-mocked functions from contacts.ts', () => {
    rememberContact(ALICE, '2021-01-01T00:00:00.000Z');
    archiveContact(ALICE);
    expect(readStoredContacts()[ALICE].archivedAt).not.toBeNull();
    unarchiveContact(ALICE);
    expect(readStoredContacts()[ALICE].archivedAt).toBeNull();
    // Confirms the localStorage mock backs a real read/write round trip
    // rather than a stubbed contacts module.
    expect(JSON.parse(store[STORAGE_KEYS.contacts])[ALICE].archivedAt).toBeNull();
  });
});
