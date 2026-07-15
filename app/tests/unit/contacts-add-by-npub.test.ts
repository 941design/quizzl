import { beforeEach, describe, expect, it } from 'vitest';
import { nip19 } from 'nostr-tools';
import {
  addContactByNpub,
  archiveContact,
  purgeStrangerContacts,
  readStoredContacts,
  rememberContact,
} from '@/src/lib/contacts';
import { loadKnownPeers } from '@/src/lib/knownPeers';
import { isAllowedDmSender } from '@/src/lib/walledGarden';
import { isBlockedPeer, loadBlockedPeers } from '@/src/lib/blockedPeers';
import { npubToPubkeyHex, pubkeyToNpub } from '@/src/lib/nostrKeys';
import { STORAGE_KEYS } from '@/src/types';

const store: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => { store[key] = value; },
  removeItem: (key: string) => { delete store[key]; },
  clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
};

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

describe('addContactByNpub', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it('adds a brand-new contact from a valid npub (AC-STRUCT-1)', () => {
    const pubkeyHex = 'a'.repeat(64);
    const npub = pubkeyToNpub(pubkeyHex);

    const result = addContactByNpub(npub, null);

    expect(result).toEqual({ ok: true, pubkeyHex, reactivated: false });

    const contacts = readStoredContacts();
    expect(contacts[pubkeyHex]).toBeDefined();
    expect(contacts[pubkeyHex].archivedAt).toBeNull();
  });

  it('creates the new contact with pendingConfirmationSince: null — scanning a card MUST NOT produce a pending contact (AC-ADMIT-3, epic: pending-contact-confirmation)', () => {
    const pubkeyHex = '6'.repeat(64);
    const npub = pubkeyToNpub(pubkeyHex);

    const result = addContactByNpub(npub, null);

    expect(result).toEqual({ ok: true, pubkeyHex, reactivated: false });
    expect(readStoredContacts()[pubkeyHex].pendingConfirmationSince).toBeNull();
  });

  it('reports blocked rather than reactivating an archived (blocked) contact, leaving archivedAt untouched (AC-CORE-5, DD-9)', () => {
    const pubkeyHex = 'b'.repeat(64);
    const npub = pubkeyToNpub(pubkeyHex);
    const seededAt = '2020-01-01T00:00:00.000Z';

    rememberContact(pubkeyHex, seededAt);
    archiveContact(pubkeyHex, seededAt);
    const before = readStoredContacts()[pubkeyHex];

    const result = addContactByNpub(npub, null);

    expect(result).toEqual({ ok: false, error: 'already_exists', blocked: true, pubkeyHex });
    expect(result).not.toEqual(expect.objectContaining({ reactivated: true }));

    // archivedAt is read back completely unchanged from its pre-call value —
    // no silent unblock, no lastSeenAt bump.
    const contacts = readStoredContacts();
    expect(contacts[pubkeyHex]).toEqual(before);
    expect(contacts[pubkeyHex].archivedAt).toBe(seededAt);

    // No DM channel becomes reachable as a consequence of the re-add: the
    // composite gate (assembled at the call site, mirroring later stories'
    // enforcement) still denies this peer immediately after the call.
    const blockedPeers = loadBlockedPeers();
    expect(isBlockedPeer(pubkeyHex, blockedPeers)).toBe(true);
  });

  it('rejects an invalid npub without mutating storage (AC-ERR-1)', () => {
    const before = readStoredContacts();

    const result = addContactByNpub('not-an-npub', null);

    expect(result).toEqual({ ok: false, error: 'invalid_npub' });
    expect(readStoredContacts()).toEqual(before);
    // Defense-in-depth (VQ-S1-017): a rejection must not seed knownPeers either,
    // so a future guard-reorder that leaks a write is caught here, not just in storage.
    expect(loadKnownPeers().size).toBe(0);
  });

  it('rejects a well-formed but malformed-payload npub that decodes to a non-32-byte pubkey (P2 correctness regression)', () => {
    // nip19.decode succeeds (the bech32 checksum is valid) but the decoded
    // payload is a 2-character string, not a 32-byte pubkey. Without the
    // 64-hex-char validation, this would be treated as a valid contact.
    const malformedNpub = nip19.npubEncode('aa');
    const before = readStoredContacts();

    const result = addContactByNpub(malformedNpub, null);

    expect(result).toEqual({ ok: false, error: 'invalid_npub' });
    expect(readStoredContacts()).toEqual(before);
  });

  it('rejects adding your own npub, same case (AC-ERR-2)', () => {
    const pubkeyHex = 'c'.repeat(64);
    const npub = pubkeyToNpub(pubkeyHex);
    const before = readStoredContacts();

    const result = addContactByNpub(npub, pubkeyHex);

    expect(result).toEqual({ ok: false, error: 'self' });
    expect(readStoredContacts()).toEqual(before);
    // Defense-in-depth (VQ-S1-017): self-rejection must not seed knownPeers.
    expect(loadKnownPeers().size).toBe(0);
  });

  it('rejects adding your own npub even when ownPubkeyHex differs only in case (AC-ERR-2 / VQ-S1-010)', () => {
    const pubkeyHex = 'd'.repeat(64);
    const npub = pubkeyToNpub(pubkeyHex);

    const result = addContactByNpub(npub, pubkeyHex.toUpperCase());

    expect(result).toEqual({ ok: false, error: 'self' });
  });

  it('rejects a duplicate add of an already-active contact without touching its record (AC-ERR-3)', () => {
    const pubkeyHex = 'e'.repeat(64);
    const npub = pubkeyToNpub(pubkeyHex);
    rememberContact(pubkeyHex, '2021-06-01T00:00:00.000Z');
    const before = readStoredContacts()[pubkeyHex];

    const result = addContactByNpub(npub, null);

    expect(result).toEqual({ ok: false, error: 'already_exists' });
    expect(readStoredContacts()[pubkeyHex]).toEqual(before);
  });

  it('rejects a duplicate add when the existing active contact is stored under a different-case key (case-insensitivity regression)', () => {
    // Hex pubkey with letters so .toUpperCase() actually changes it, simulating
    // a group-derived entry stored un-normalized (rememberContactsFromGroups
    // forwards memberPubkey as-is, without lowercasing).
    const pubkeyHex = '0123456789abcdef'.repeat(4);
    const mixedCaseKey = pubkeyHex.toUpperCase();
    const npub = pubkeyToNpub(pubkeyHex);
    rememberContact(mixedCaseKey, '2021-06-01T00:00:00.000Z');
    const before = readStoredContacts();

    const result = addContactByNpub(npub, null);

    expect(result).toEqual({ ok: false, error: 'already_exists' });
    // No duplicate entry was created under the lowercase key — the store is
    // untouched and still holds exactly the one mixed-case entry.
    expect(readStoredContacts()).toEqual(before);
    expect(Object.keys(readStoredContacts())).toEqual([mixedCaseKey]);
  });

  it('reports blocked (not reactivated) for an archived contact stored under a different-case key, and does not create a duplicate (AC-CORE-5 + AC-CORE-6)', () => {
    const pubkeyHex = 'fedcba9876543210'.repeat(4);
    const mixedCaseKey = pubkeyHex.toUpperCase();
    const npub = pubkeyToNpub(pubkeyHex);
    const seededAt = '2020-01-01T00:00:00.000Z';
    rememberContact(mixedCaseKey, seededAt);
    archiveContact(mixedCaseKey, seededAt);

    const result = addContactByNpub(npub, null);

    expect(result).toEqual({ ok: false, error: 'already_exists', blocked: true, pubkeyHex });

    const contacts = readStoredContacts();
    // Exactly one entry — the original mixed-case key stays archived in
    // place, no second (lowercase-keyed) entry was created, and it was NOT
    // unarchived.
    expect(Object.keys(contacts)).toEqual([mixedCaseKey]);
    expect(contacts[mixedCaseKey].archivedAt).toBe(seededAt);

    // AC-CORE-6: the block-set derivation still recognizes this mixed-case-
    // keyed contact as blocked, matching a lowercase lookup.
    expect(isBlockedPeer(pubkeyHex, loadBlockedPeers())).toBe(true);
  });

  it('rejects reactivation when an active entry exists alongside a differently-cased archived entry (P2 correctness regression)', () => {
    const pubkeyHex = 'abcdef0123456789'.repeat(4);
    const activeKey = pubkeyHex; // lowercase, active
    const archivedKey = pubkeyHex.toUpperCase(); // different case, archived
    const npub = pubkeyToNpub(pubkeyHex);

    rememberContact(activeKey, '2021-06-01T00:00:00.000Z');
    rememberContact(archivedKey, '2020-01-01T00:00:00.000Z');
    archiveContact(archivedKey, '2020-01-01T00:00:00.000Z');

    const beforeActive = readStoredContacts()[activeKey];
    const beforeArchived = readStoredContacts()[archivedKey];

    const result = addContactByNpub(npub, null);

    expect(result).toEqual({ ok: false, error: 'already_exists' });

    const after = readStoredContacts();
    // The active entry is untouched, and the archived duplicate remains
    // archived — neither was reactivated nor was a new entry created.
    expect(after[activeKey]).toEqual(beforeActive);
    expect(after[archivedKey]).toEqual(beforeArchived);
    expect(Object.keys(after).sort()).toEqual([activeKey, archivedKey].sort());
  });

  it('registers the new contact as an ever-known peer (AC-SEC-1)', () => {
    const pubkeyHex = 'f'.repeat(64);
    const npub = pubkeyToNpub(pubkeyHex);

    addContactByNpub(npub, null);

    expect(loadKnownPeers().has(pubkeyHex)).toBe(true);
  });

  it('allows the newly-added peer as a DM sender via the ever-known set with no shared groups (AC-SEC-2)', () => {
    const pubkeyHex = '1'.repeat(64);
    const npub = pubkeyToNpub(pubkeyHex);
    const ownPubkeyHex = '2'.repeat(64);

    addContactByNpub(npub, ownPubkeyHex);

    expect(isAllowedDmSender(pubkeyHex, [], loadKnownPeers(), ownPubkeyHex)).toBe(true);
  });

  it('survives a concurrent purgeStrangerContacts sweep in both contacts and contactCache stores (AC-SEC-3)', () => {
    const pubkeyHex = '3'.repeat(64);
    const npub = pubkeyToNpub(pubkeyHex);
    const strangerPubkeyHex = '4'.repeat(64);
    const ownPubkeyHex = '5'.repeat(64);

    // Seed knownPeers via the real function under test (not a hand-inserted mock).
    // Note: this is a synchronous, single-threaded test, so it cannot observe
    // "before-ness" directly — both the knownPeers write and the contacts-store
    // write have already completed by the time purgeStrangerContacts runs below.
    // The ordering guarantee itself (rememberKnownPeers before any contacts-store
    // write) is enforced by the code and documented in the addContactByNpub JSDoc
    // (ADR-005), not by this test. What this test verifies is the end-state that
    // ordering is meant to produce: because knownPeers was seeded, the contact is
    // purge-safe — it survives a subsequent purgeStrangerContacts sweep.
    addContactByNpub(npub, ownPubkeyHex);

    // Seed a matching contactCache entry for the same pubkey.
    localStorage.setItem(
      STORAGE_KEYS.contactCache,
      JSON.stringify({ [pubkeyHex]: { nickname: 'x', avatar: null, updatedAt: '2021-01-01T00:00:00.000Z' } }),
    );

    // Negative control: a stranger contact NOT seeded via addContactByNpub/knownPeers.
    rememberContact(strangerPubkeyHex, '2021-01-01T00:00:00.000Z');

    const result = purgeStrangerContacts(() => ({
      groups: [],
      knownPeers: loadKnownPeers(),
      ownPubkeyHex,
    }));

    // The real contact survives in both storage keys.
    expect(readStoredContacts()[pubkeyHex]).toBeDefined();
    const cacheRaw = JSON.parse(localStorage.getItem(STORAGE_KEYS.contactCache) ?? '{}');
    expect(cacheRaw[pubkeyHex]).toBeDefined();

    // The stranger contact does not survive — proves survival above isn't
    // because purgeStrangerContacts never deletes anything.
    expect(readStoredContacts()[strangerPubkeyHex]).toBeUndefined();
    expect(result.deleted).toBeGreaterThan(0);
  });
});

// Sanity check on the fixture helper documented in the story: encoding/decoding
// round-trips through nostrKeys without curve validation getting in the way.
describe('npub fixture helper (pubkeyToNpub / npubToPubkeyHex round-trip)', () => {
  it('round-trips a repeated-hex-char fixture back to the same lowercase hex', () => {
    const pubkeyHex = 'a'.repeat(64);
    expect(npubToPubkeyHex(pubkeyToNpub(pubkeyHex))).toBe(pubkeyHex);
  });
});
