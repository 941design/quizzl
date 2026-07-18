import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  archiveContact,
  confirmContact,
  getContact,
  isPendingConfirmation,
  listContacts,
  readStoredContacts,
  rememberContact,
  rememberContactsFromGroups,
  rememberPendingContact,
  unarchiveContact,
} from '@/src/lib/contacts';
import { STORAGE_KEYS, type Group } from '@/src/types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

function readSource(relPath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf-8');
}

// Stryker runs the suite from an instrumented copy under .stryker-tmp/sandbox-*/,
// where every source-scan text match would hit mutant-switch wrappers instead of
// the real code. These tests assert source shape rather than behavior, so a
// mutation run has nothing to learn from them — skip there, run everywhere else.
const itSourceScan = REPO_ROOT.includes('.stryker-tmp') ? it.skip : it;

const store: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => { store[key] = value; },
  removeItem: (key: string) => { delete store[key]; },
  clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
};

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

// Mock idb-keyval — needed only so `chatPersistence.ts` can be safely
// imported (for the loadMessages spy below) without touching real
// IndexedDB, which does not exist under vitest's node environment. Mirrors
// unreadStore.test.ts's identical mock.
vi.mock('idb-keyval', () => ({
  get: vi.fn(async () => undefined),
  set: vi.fn(async () => undefined),
  del: vi.fn(async () => undefined),
  delMany: vi.fn(async () => undefined),
  keys: vi.fn(async () => []),
}));

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

// ── pendingConfirmationSince normalization (AC-STRUCT-1, AC-STRUCT-2) ──────
// Epic: pending-contact-confirmation, S1.

describe('pendingConfirmationSince normalization (AC-STRUCT-1, AC-STRUCT-2)', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it('resolves pendingConfirmationSince to null for a legacy stored entry missing the field entirely (AC-STRUCT-1)', () => {
    const pubkeyHex = 'a'.repeat(64);
    // Simulates a contact persisted before this epic shipped — the raw
    // stored value has no pendingConfirmationSince key at all.
    localStorage.setItem(STORAGE_KEYS.contacts, JSON.stringify({
      [pubkeyHex]: {
        pubkeyHex,
        firstSeenAt: '2020-01-01T00:00:00.000Z',
        lastSeenAt: '2020-01-01T00:00:00.000Z',
        archivedAt: null,
      },
    }));

    const contacts = readStoredContacts();

    expect(contacts[pubkeyHex].pendingConfirmationSince).toBeNull();
  });

  it('resolves pendingConfirmationSince to null for a legacy BLOCKED/archived entry missing the field (AC-STRUCT-2)', () => {
    const pubkeyHex = 'b'.repeat(64);
    localStorage.setItem(STORAGE_KEYS.contacts, JSON.stringify({
      [pubkeyHex]: {
        pubkeyHex,
        firstSeenAt: '2020-01-01T00:00:00.000Z',
        lastSeenAt: '2020-01-01T00:00:00.000Z',
        archivedAt: '2020-06-01T00:00:00.000Z',
      },
    }));

    const contacts = readStoredContacts();

    // Purely additive — the pre-existing archivedAt is unaffected...
    expect(contacts[pubkeyHex].archivedAt).toBe('2020-06-01T00:00:00.000Z');
    // ...and the new field resolves to null, not undefined or anything else.
    expect(contacts[pubkeyHex].pendingConfirmationSince).toBeNull();
  });

  it('listContacts derives isPendingConfirmation: false for a legacy (non-pending) entry (AC-STRUCT-2)', () => {
    rememberContact('legacy-peer', '2020-01-01T00:00:00.000Z');

    const [contact] = listContacts(null);

    expect(contact.isPendingConfirmation).toBe(false);
  });

  it('listContacts derives isPendingConfirmation: true for a pending entry', () => {
    rememberPendingContact('pending-peer', '2026-06-01T00:00:00.000Z');

    const [contact] = listContacts(null);

    expect(contact.isPendingConfirmation).toBe(true);
  });
});

// ── rememberPendingContact (AC-ADMIT-1, AC-ADMIT-2, AC-STRUCT-4) ──────────
// Epic: pending-contact-confirmation, S1. Direct unit coverage of the
// primitive itself; pairingAck.test.ts covers it through handlePairingAck.

describe('rememberPendingContact (AC-ADMIT-1, AC-ADMIT-2, AC-STRUCT-4)', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it('creates a brand-new contact with pendingConfirmationSince set to a non-null timestamp (AC-ADMIT-1)', () => {
    const pubkeyHex = 'c'.repeat(64);

    rememberPendingContact(pubkeyHex, '2026-06-01T00:00:00.000Z');

    const contacts = readStoredContacts();
    expect(contacts[pubkeyHex]).toBeDefined();
    expect(contacts[pubkeyHex].pendingConfirmationSince).toBe('2026-06-01T00:00:00.000Z');
    expect(contacts[pubkeyHex].archivedAt).toBeNull();
    expect(contacts[pubkeyHex].firstSeenAt).toBe('2026-06-01T00:00:00.000Z');
    expect(contacts[pubkeyHex].lastSeenAt).toBe('2026-06-01T00:00:00.000Z');
  });

  it('preserves a previously-null pendingConfirmationSince on re-pairing — never sets null to non-null (AC-ADMIT-2)', () => {
    const pubkeyHex = 'd'.repeat(64);
    rememberContact(pubkeyHex, '2020-01-01T00:00:00.000Z'); // already confirmed (null)

    rememberPendingContact(pubkeyHex, '2026-06-01T00:00:00.000Z');

    expect(readStoredContacts()[pubkeyHex].pendingConfirmationSince).toBeNull();
  });

  it('preserves an already-pending value on re-pairing — never clears it (AC-ADMIT-2)', () => {
    const pubkeyHex = 'e'.repeat(64);
    rememberPendingContact(pubkeyHex, '2020-01-01T00:00:00.000Z');

    rememberPendingContact(pubkeyHex, '2026-06-01T00:00:00.000Z');

    expect(readStoredContacts()[pubkeyHex].pendingConfirmationSince).toBe('2020-01-01T00:00:00.000Z');
  });

  it('bumps lastSeenAt on re-pairing exactly like rememberContact, leaving firstSeenAt untouched', () => {
    const pubkeyHex = 'f'.repeat(64);
    rememberPendingContact(pubkeyHex, '2020-01-01T00:00:00.000Z');

    rememberPendingContact(pubkeyHex, '2026-06-01T00:00:00.000Z');

    expect(readStoredContacts()[pubkeyHex].lastSeenAt).toBe('2026-06-01T00:00:00.000Z');
    expect(readStoredContacts()[pubkeyHex].firstSeenAt).toBe('2020-01-01T00:00:00.000Z');
  });

  it('preserves archivedAt on a blocked re-pairing sender, mirroring the pairingAck.ts precedent', () => {
    const pubkeyHex = '1'.repeat(64);
    rememberContact(pubkeyHex, '2020-01-01T00:00:00.000Z');
    archiveContact(pubkeyHex, '2020-06-01T00:00:00.000Z');

    rememberPendingContact(pubkeyHex, '2026-06-01T00:00:00.000Z');

    expect(readStoredContacts()[pubkeyHex].archivedAt).toBe('2020-06-01T00:00:00.000Z');
  });

  it('resolves an existing entry case-insensitively — a mixed-case-keyed contact is found and preserved, not duplicated (AC-STRUCT-4)', () => {
    const pubkeyHex = '0123456789abcdef'.repeat(4);
    const mixedCaseKey = pubkeyHex.toUpperCase();
    rememberPendingContact(mixedCaseKey, '2020-01-01T00:00:00.000Z');

    rememberPendingContact(pubkeyHex, '2026-06-01T00:00:00.000Z'); // lowercase form, re-pairing

    const contacts = readStoredContacts();
    expect(Object.keys(contacts)).toEqual([mixedCaseKey]); // no duplicate created
    expect(contacts[mixedCaseKey].pendingConfirmationSince).toBe('2020-01-01T00:00:00.000Z');
    expect(contacts[mixedCaseKey].lastSeenAt).toBe('2026-06-01T00:00:00.000Z');
  });

  it('bumps lastSeenAt on ALL coexisting case-variant entries for the same pubkey, not just the first (regression: plural filter over singular find)', () => {
    const pubkeyHex = '9876543210abcdef'.repeat(4);
    const lowerKey = pubkeyHex;
    const upperKey = pubkeyHex.toUpperCase();
    // rememberContact keys by exact string (no case-insensitive lookup of
    // its own), so these two calls seed two genuinely separate stored
    // entries for the same pubkey, differing only in key case.
    rememberContact(lowerKey, '2020-01-01T00:00:00.000Z');
    rememberContact(upperKey, '2020-02-01T00:00:00.000Z');

    rememberPendingContact(pubkeyHex, '2026-06-01T00:00:00.000Z');

    const contacts = readStoredContacts();
    expect(Object.keys(contacts).sort()).toEqual([lowerKey, upperKey].sort());
    expect(contacts[lowerKey].lastSeenAt).toBe('2026-06-01T00:00:00.000Z');
    expect(contacts[upperKey].lastSeenAt).toBe('2026-06-01T00:00:00.000Z');
  });
});

// ── confirmContact (AC-CONFIRM-1, AC-CONFIRM-2, AC-STRUCT-4) ─────────────
// Epic: pending-contact-confirmation, S1.

describe('confirmContact (AC-CONFIRM-1, AC-CONFIRM-2, AC-STRUCT-4)', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it('clears pendingConfirmationSince to null and leaves firstSeenAt/lastSeenAt/archivedAt byte-for-byte unchanged (AC-CONFIRM-1)', () => {
    const pubkeyHex = '2'.repeat(64);
    rememberPendingContact(pubkeyHex, '2026-06-01T00:00:00.000Z');
    const before = readStoredContacts()[pubkeyHex];

    confirmContact(pubkeyHex);

    const after = readStoredContacts()[pubkeyHex];
    expect(after.pendingConfirmationSince).toBeNull();
    expect(after.firstSeenAt).toBe(before.firstSeenAt);
    expect(after.lastSeenAt).toBe(before.lastSeenAt);
    expect(after.archivedAt).toBe(before.archivedAt);
  });

  it('is a true no-op — no throw, no storage write — for a pubkey with no matching stored contact (AC-CONFIRM-2)', () => {
    const setItemSpy = vi.spyOn(localStorageMock, 'setItem');

    expect(() => confirmContact('f'.repeat(64))).not.toThrow();
    expect(setItemSpy).not.toHaveBeenCalled();

    setItemSpy.mockRestore();
  });

  it('is a true no-op — no throw, no storage write — for a contact whose pendingConfirmationSince is already null (AC-CONFIRM-2)', () => {
    const pubkeyHex = '3'.repeat(64);
    rememberContact(pubkeyHex, '2020-01-01T00:00:00.000Z'); // confirmed already (null)
    const setItemSpy = vi.spyOn(localStorageMock, 'setItem');
    setItemSpy.mockClear();

    expect(() => confirmContact(pubkeyHex)).not.toThrow();
    expect(setItemSpy).not.toHaveBeenCalled();

    setItemSpy.mockRestore();
  });

  it('finds and clears a pending contact stored under a differently-cased key, without creating a duplicate (AC-STRUCT-4)', () => {
    const pubkeyHex = 'abcdef0123456789'.repeat(4);
    const mixedCaseKey = pubkeyHex.toUpperCase();
    rememberPendingContact(mixedCaseKey, '2026-06-01T00:00:00.000Z');

    confirmContact(pubkeyHex); // lowercase form

    const contacts = readStoredContacts();
    expect(Object.keys(contacts)).toEqual([mixedCaseKey]);
    expect(contacts[mixedCaseKey].pendingConfirmationSince).toBeNull();
  });

  it('clears pendingConfirmationSince on ALL coexisting case-variant entries that have it set, not just the first (regression: plural filter over singular find)', () => {
    const pubkeyHex = 'fedcba0123456789'.repeat(4);
    const lowerKey = pubkeyHex;
    const upperKey = pubkeyHex.toUpperCase();
    // Seed two independent stored entries for the same pubkey, differing
    // only in key case, both already pending — mirrors legacy storage that
    // can hold case-variant duplicates.
    localStorage.setItem(STORAGE_KEYS.contacts, JSON.stringify({
      [lowerKey]: {
        pubkeyHex: lowerKey,
        firstSeenAt: '2020-01-01T00:00:00.000Z',
        lastSeenAt: '2020-01-01T00:00:00.000Z',
        archivedAt: null,
        pendingConfirmationSince: '2020-01-01T00:00:00.000Z',
      },
      [upperKey]: {
        pubkeyHex: upperKey,
        firstSeenAt: '2020-02-01T00:00:00.000Z',
        lastSeenAt: '2020-02-01T00:00:00.000Z',
        archivedAt: null,
        pendingConfirmationSince: '2020-02-01T00:00:00.000Z',
      },
    }));

    confirmContact(pubkeyHex);

    const contacts = readStoredContacts();
    expect(Object.keys(contacts).sort()).toEqual([lowerKey, upperKey].sort());
    expect(contacts[lowerKey].pendingConfirmationSince).toBeNull();
    expect(contacts[upperKey].pendingConfirmationSince).toBeNull();
  });
});

// ── Gate-remediation (Codex P2, 2026-07-15): the contacts-LIST confirm
// action must never route through chatPersistence.ts#loadMessages ────────
// `app/pages/contacts.tsx`'s list-row confirm handler (`handleConfirmFromList`,
// AC-UX-1) used to call `PendingConfirmationPrompt.tsx`'s
// `confirmPendingContact`, which also runs
// `reconcileConfirmedContactDirectMessageCount` — and that routes through
// `chatPersistence.ts#loadMessages`, which marks the DM thread "healed" and
// returns any repair `refetchIds` to whichever caller invoked it FIRST; a
// thread already marked healed returns `refetchIds: []` on every later
// call. The list row never mounts `ContactChat` afterward (unlike the
// detail view), so any refetchIds it received would have been silently
// discarded — and because the thread is now marked healed, a LATER opening
// of that contact's `ContactChat` would never get another chance to detect
// and repair those rows. The fix: `handleConfirmFromList` now calls the
// plain `confirmContact` directly, with no reconciliation step at all —
// per AC-OBS-1/AC-OBS-2, the bell was never incorrectly bumped while
// pending, so it simply catches up the next time the user opens the
// conversation (ContactChat's own mount-time `loadMessages`).
describe('list-confirm path never triggers loadMessages/self-heal (gate-remediation, Codex P2, 2026-07-15)', () => {
  it('contacts.tsx no longer imports confirmPendingContact, and the list-confirm handler body has no path to reconciliation', () => {
    const source = readSource('pages/contacts.tsx');
    // Not imported at all — the structural proof this file cannot reach
    // confirmPendingContact (and therefore reconcileConfirmedContactDirectMessageCount)
    // from anywhere, regardless of call site.
    expect(source).not.toMatch(/import\s*\{[^}]*confirmPendingContact/);

    // The handler body itself (not surrounding prose/comments, which may
    // legitimately name these identifiers for context) calls confirmContact
    // directly and nothing reconciliation-shaped. Gate-remediation
    // (2026-07-15, finding G): the handler is plain/synchronous now — the
    // prior `async` declaration had nothing to await and its
    // `if (!pubkeyHex) return;` guard was dead code that silently no-op'd
    // the confirm action before identity state hydrated.
    const handlerMatch = source.match(
      /function handleConfirmFromList\(peerPubkeyHex: string\) \{[\s\S]*?\n {2}\}/,
    );
    expect(handlerMatch).not.toBeNull();
    const handlerBody = handlerMatch![0];
    expect(handlerBody).not.toMatch(/^async /);
    expect(handlerBody).not.toContain('if (!pubkeyHex)');
    expect(handlerBody).toContain('confirmContact(peerPubkeyHex)');
    expect(handlerBody).not.toContain('confirmPendingContact');
    expect(handlerBody).not.toContain('reconcileConfirmedContactDirectMessageCount');
    expect(handlerBody).not.toContain('loadMessages');
  });

  it('calling exactly what the list-confirm handler calls (confirmContact) never touches chatPersistence#loadMessages', async () => {
    const chatPersistence = await import('@/src/lib/marmot/chatPersistence');
    const loadMessagesSpy = vi.spyOn(chatPersistence, 'loadMessages');

    const pubkeyHex = '5'.repeat(64);
    rememberPendingContact(pubkeyHex, '2026-06-01T00:00:00.000Z');

    confirmContact(pubkeyHex);

    expect(loadMessagesSpy).not.toHaveBeenCalled();
    // The underlying data mutation the list row's badge reacts to
    // (isPendingConfirmation, AC-UX-1) still happened on this exact path —
    // the deeper confirmContact behavior itself is already covered by the
    // `confirmContact` describe block above (AC-CONFIRM-1/2).
    expect(readStoredContacts()[pubkeyHex].pendingConfirmationSince).toBeNull();

    loadMessagesSpy.mockRestore();
  });

  it('the detail-view confirm path (PendingConfirmationPrompt.tsx) is unchanged — still wires confirmPendingContact to reconcileConfirmedContactDirectMessageCount (covered end-to-end by unreadStore.test.ts)', () => {
    const source = readSource('src/components/contacts/PendingConfirmationPrompt.tsx');
    expect(source).toContain('reconcileConfirmedContactDirectMessageCount(peerPubkeyHex, ownPubkeyHex)');
  });
});

// ── The pending-confirmation prompt offers a first-class "Reject" button ──
// The prompt asks a yes/no question ("Confirm this contact?"), so it renders
// a first-class Reject button next to Confirm — mirroring the group join-
// request `[Approve] [Deny]` layout. Reject is not a new mechanism: per
// spec.md Non-Goals, declining reuses the existing block/archive flow
// (BlockContactButton), relabelled to "Reject" via its `label` prop. Verified
// via source assertion — no jsdom/renderHook per project convention.
describe('PendingConfirmationPrompt.tsx renders a Reject button alongside Confirm', () => {
  it('imports and renders BlockContactButton with isArchived={false}, reusing the existing component', () => {
    const source = readSource('src/components/contacts/PendingConfirmationPrompt.tsx');
    expect(source).toMatch(/import BlockContactButton from ['"]@\/src\/components\/contacts\/BlockContactButton['"]/);
    expect(source).toMatch(/<BlockContactButton[\s\S]*?isArchived=\{false\}/);
  });

  it('the Confirm button remains the primary (brand-colored) action; the Reject (BlockContactButton) is the secondary control', () => {
    const source = readSource('src/components/contacts/PendingConfirmationPrompt.tsx');
    const confirmBtnMatch = source.match(/<Button[\s\S]*?data-testid="pending-confirmation-confirm-btn"/);
    expect(confirmBtnMatch).not.toBeNull();
    expect(confirmBtnMatch![0]).toContain('colorScheme="brand"');
  });

  it('the Reject label is passed via BlockContactButton\'s label prop from useCopy(), never hardcoded', () => {
    const source = readSource('src/components/contacts/PendingConfirmationPrompt.tsx');
    expect(source).toMatch(/label=\{copy\.contacts\.pendingRejectButton\}/);
  });
});

// ── Gate-remediation (2026-07-15, finding B): the contacts-LIST row must
// honor "blocked wins over pending" (spec.md Design Decision 9) ───────────
// Before the fix, the list row rendered the pending badge + live "Confirm
// contact" button independently of `isArchived`, reachable whenever
// `showHidden` is toggled on (which lists blocked contacts too, via
// `listContacts(pubkeyHex, { includeArchived: showHidden })`). Since
// blocking IS this epic's decline mechanism (spec.md Non-Goals — there is
// no separate "reject" action), a user who just declined a pending contact
// by blocking them would see a working un-decline ("Confirm contact")
// button on the very row that represents their decline. No render test
// exists for `contacts.tsx` (no jsdom/renderHook per project convention),
// so this is verified via source assertion, mirroring the existing
// `readSource()` pattern used throughout this file.
describe('contacts.tsx list row — pending badge/confirm button gated on !isArchived (AC-UX-1, spec.md Design Decision 9)', () => {
  it('the pending-badge/confirm-button block is gated on `contact.isPendingConfirmation && !contact.isArchived`', () => {
    const source = readSource('pages/contacts.tsx');
    expect(source).toContain('{contact.isPendingConfirmation && !contact.isArchived ? (');
    // The bare (ungated) condition must not appear anywhere in the file —
    // this is the exact regression finding B fixed.
    expect(source).not.toMatch(/\{contact\.isPendingConfirmation \? \(/);
  });

  it('the inline comment no longer claims blocked+pending "only ever happens if" a pre-epic contact was blocked — it must cite DD-9\'s actual decline-by-blocking rationale', () => {
    const source = readSource('pages/contacts.tsx');
    expect(source).not.toMatch(/only ever happens if the user's own\s*contact was blocked before this epic's admission gate\s*existed/);
    expect(source).toMatch(/Design Decision 9/);
    expect(source).toMatch(/decline/i);
  });
});

// ── isPendingConfirmation — the single exported predicate (AC-STRUCT-3) ──
// Epic: pending-contact-confirmation, S1.

describe('isPendingConfirmation (AC-STRUCT-3)', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it('returns true for a pending contact and false for a confirmed one, reading readStoredContacts() by default', () => {
    rememberPendingContact('pending-peer', '2026-06-01T00:00:00.000Z');
    rememberContact('confirmed-peer', '2026-06-01T00:00:00.000Z');

    expect(isPendingConfirmation('pending-peer')).toBe(true);
    expect(isPendingConfirmation('confirmed-peer')).toBe(false);
  });

  it('returns false for an unknown pubkey', () => {
    expect(isPendingConfirmation('nobody')).toBe(false);
  });

  it('matches case-insensitively and accepts an explicit contacts array instead of reading storage (AC-STRUCT-4-adjacent, contract-declared param)', () => {
    const pubkeyHex = 'fedcba9876543210'.repeat(4);
    const mixedCaseKey = pubkeyHex.toUpperCase();
    rememberPendingContact(mixedCaseKey, '2026-06-01T00:00:00.000Z');
    const explicitList = Object.values(readStoredContacts());
    localStorageMock.clear(); // proves the explicit-array branch does NOT re-read storage

    expect(isPendingConfirmation(pubkeyHex, explicitList)).toBe(true);
    expect(isPendingConfirmation(pubkeyHex)).toBe(false); // storage is now empty
  });

  itSourceScan('is exported from exactly one location in contacts.ts (AC-STRUCT-3 — single export site)', () => {
    const source = readSource('src/lib/contacts.ts');
    const exportMatches = source.match(/export function isPendingConfirmation\(/g) ?? [];
    expect(exportMatches).toHaveLength(1);
  });

  itSourceScan('contacts.ts never imports blockedPeers.ts, and never CALLS isBlockedPeer/isAllowedDmSenderComposite — the predicate cannot be folded into either (AC-STRUCT-3, ADR-008 exception)', () => {
    // Matches actual usage (an import statement or a function call), not
    // this module's own JSDoc prose documenting the ADR-008 exception (which
    // legitimately names these functions in plain text without calling them).
    const source = readSource('src/lib/contacts.ts');
    expect(source).not.toMatch(/from ['"]@\/src\/lib\/blockedPeers['"]/);
    expect(source).not.toMatch(/isBlockedPeer\(/);
    expect(source).not.toMatch(/isAllowedDmSenderComposite\(/);
  });

  it('a contact that is both pending AND blocked still reports pending=true — proves the predicate does not consult archivedAt/blocking at all', () => {
    const pubkeyHex = '4'.repeat(64);
    rememberPendingContact(pubkeyHex, '2026-06-01T00:00:00.000Z');
    archiveContact(pubkeyHex, '2026-06-02T00:00:00.000Z');

    expect(isPendingConfirmation(pubkeyHex)).toBe(true);
  });

  it('returns true if ANY case-variant duplicate has pendingConfirmationSince set, even when another matching duplicate does not (regression: some() over all matches, not find() + single check)', () => {
    const pubkeyHex = 'abcd1234ef567890'.repeat(4);
    const lowerKey = pubkeyHex;
    const upperKey = pubkeyHex.toUpperCase();
    // Seed two independent stored entries for the same pubkey, differing
    // only in key case: the lower-case entry is already confirmed (null),
    // the upper-case entry is still pending. Object.values() ordering must
    // not determine the result — any matching duplicate with the field set
    // makes this pending.
    localStorage.setItem(STORAGE_KEYS.contacts, JSON.stringify({
      [lowerKey]: {
        pubkeyHex: lowerKey,
        firstSeenAt: '2020-01-01T00:00:00.000Z',
        lastSeenAt: '2020-01-01T00:00:00.000Z',
        archivedAt: null,
        pendingConfirmationSince: null,
      },
      [upperKey]: {
        pubkeyHex: upperKey,
        firstSeenAt: '2020-02-01T00:00:00.000Z',
        lastSeenAt: '2020-02-01T00:00:00.000Z',
        archivedAt: null,
        pendingConfirmationSince: '2020-02-01T00:00:00.000Z',
      },
    }));

    expect(isPendingConfirmation(pubkeyHex)).toBe(true);
  });
});
