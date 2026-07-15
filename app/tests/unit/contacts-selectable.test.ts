import { describe, expect, it } from 'vitest';
import { selectableContactsForGroup } from '@/src/lib/contacts';
import type { ContactListItem } from '@/src/lib/contacts';

function makeContact(pubkeyHex: string, overrides: Partial<ContactListItem> = {}): ContactListItem {
  return {
    pubkeyHex,
    firstSeenAt: '2026-01-01T00:00:00.000Z',
    lastSeenAt: '2026-01-01T00:00:00.000Z',
    archivedAt: null,
    nickname: '',
    avatar: null,
    updatedAt: null,
    isArchived: false,
    isPendingConfirmation: false,
    ...overrides,
  };
}

const ALICE = 'aa11';
const BOB = 'bb22';
const CAROL = 'cc33';

describe('selectableContactsForGroup', () => {
  it('(a) returns an empty array for an empty contact-array input', () => {
    expect(selectableContactsForGroup([], { memberPubkeys: [] })).toEqual([]);
    expect(selectableContactsForGroup([], { memberPubkeys: [ALICE] })).toEqual([]);
  });

  it('(b) marks every contact selectable when none are members or blocked', () => {
    const contacts = [makeContact(ALICE), makeContact(BOB)];
    const result = selectableContactsForGroup(contacts, { memberPubkeys: [CAROL] });
    expect(result).toStrictEqual([
      { contact: contacts[0], selectable: true },
      { contact: contacts[1], selectable: true },
    ]);
  });

  it('(c) disables every contact when all are either members or blocked', () => {
    const contacts = [makeContact(ALICE), makeContact(BOB, { isArchived: true, archivedAt: '2026-02-01T00:00:00.000Z' })];
    const result = selectableContactsForGroup(contacts, { memberPubkeys: [ALICE] });
    expect(result).toEqual([
      { contact: contacts[0], selectable: false, disabledReason: 'already_member' },
      { contact: contacts[1], selectable: false, disabledReason: 'blocked' },
    ]);
  });

  it('(d) matches memberPubkeys case-insensitively (AC-ERR-1)', () => {
    const contact = makeContact(ALICE);
    const result = selectableContactsForGroup([contact], { memberPubkeys: [ALICE.toUpperCase()] });
    expect(result).toEqual([{ contact, selectable: false, disabledReason: 'already_member' }]);
  });

  it('(e) already-member takes precedence over blocked when both apply (AC-ERR-1)', () => {
    const contact = makeContact(ALICE, { isArchived: true, archivedAt: '2026-02-01T00:00:00.000Z' });
    const result = selectableContactsForGroup([contact], { memberPubkeys: [ALICE] });
    expect(result).toEqual([{ contact, selectable: false, disabledReason: 'already_member' }]);
  });

  it('a non-member, non-archived contact is selectable with disabledReason omitted (AC-ERR-3)', () => {
    const contact = makeContact(ALICE);
    const result = selectableContactsForGroup([contact], { memberPubkeys: [] });
    expect(result).toStrictEqual([{ contact, selectable: true }]);
    expect('disabledReason' in result[0]).toBe(false);
  });

  it('a non-member, blocked contact is disabled with reason blocked (AC-ERR-2)', () => {
    const contact = makeContact(ALICE, { isArchived: true, archivedAt: '2026-02-01T00:00:00.000Z' });
    const result = selectableContactsForGroup([contact], { memberPubkeys: [BOB] });
    expect(result).toEqual([{ contact, selectable: false, disabledReason: 'blocked' }]);
  });

  it('(f) preserves input order across a mixed selectable/disabled set', () => {
    const contacts = [
      makeContact(CAROL),
      makeContact(ALICE),
      makeContact(BOB, { isArchived: true, archivedAt: '2026-02-01T00:00:00.000Z' }),
    ];
    const result = selectableContactsForGroup(contacts, { memberPubkeys: [ALICE] });
    expect(result.map((entry) => entry.contact.pubkeyHex)).toEqual([CAROL, ALICE, BOB]);
    expect(result.map((entry) => entry.selectable)).toEqual([true, false, false]);
  });

  it('returns exactly one entry per input contact', () => {
    const contacts = [makeContact(ALICE), makeContact(BOB), makeContact(CAROL)];
    const result = selectableContactsForGroup(contacts, { memberPubkeys: [] });
    expect(result).toHaveLength(3);
  });
});

// ── AC-GROUP-1 (epic: pending-contact-confirmation, S1) ──────────────────
// Precedence: already_member > blocked > pending_confirmation > selectable.

describe('selectableContactsForGroup — pending_confirmation precedence (AC-GROUP-1)', () => {
  it('a non-member, non-blocked, pending contact resolves to disabledReason: pending_confirmation', () => {
    const contact = makeContact(ALICE, { isPendingConfirmation: true });
    const result = selectableContactsForGroup([contact], { memberPubkeys: [] });
    expect(result).toEqual([{ contact, selectable: false, disabledReason: 'pending_confirmation' }]);
  });

  it('a contact that is BOTH pending AND blocked resolves to disabledReason: blocked, never pending_confirmation (spec.md Design Decision 9)', () => {
    const contact = makeContact(ALICE, {
      isPendingConfirmation: true,
      isArchived: true,
      archivedAt: '2026-02-01T00:00:00.000Z',
    });
    const result = selectableContactsForGroup([contact], { memberPubkeys: [] });
    expect(result).toEqual([{ contact, selectable: false, disabledReason: 'blocked' }]);
  });

  it('a contact that is BOTH pending AND already a member resolves to disabledReason: already_member', () => {
    const contact = makeContact(ALICE, { isPendingConfirmation: true });
    const result = selectableContactsForGroup([contact], { memberPubkeys: [ALICE] });
    expect(result).toEqual([{ contact, selectable: false, disabledReason: 'already_member' }]);
  });

  it('a non-pending, non-blocked, non-member contact remains selectable (control case)', () => {
    const contact = makeContact(ALICE, { isPendingConfirmation: false });
    const result = selectableContactsForGroup([contact], { memberPubkeys: [] });
    expect(result).toStrictEqual([{ contact, selectable: true }]);
  });

  it('all four combinations resolve correctly in a single mixed input, preserving order (full precedence matrix)', () => {
    const alreadyMemberAndPending = makeContact(ALICE, { isPendingConfirmation: true });
    const blockedAndPending = makeContact(BOB, {
      isPendingConfirmation: true,
      isArchived: true,
      archivedAt: '2026-02-01T00:00:00.000Z',
    });
    const pendingOnly = makeContact(CAROL, { isPendingConfirmation: true });
    const selectable = makeContact('dd44', { isPendingConfirmation: false });

    const contacts = [alreadyMemberAndPending, blockedAndPending, pendingOnly, selectable];
    const result = selectableContactsForGroup(contacts, { memberPubkeys: [ALICE] });

    expect(result).toEqual([
      { contact: alreadyMemberAndPending, selectable: false, disabledReason: 'already_member' },
      { contact: blockedAndPending, selectable: false, disabledReason: 'blocked' },
      { contact: pendingOnly, selectable: false, disabledReason: 'pending_confirmation' },
      { contact: selectable, selectable: true },
    ]);
  });
});
