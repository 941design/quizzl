import { describe, expect, it } from 'vitest';
import { addableGroupsForContact, commonGroups, eligibleGroupsForContact } from '@/src/lib/contacts';
import type { Group } from '@/src/types';

function makeGroup(id: string, members: string[]): Group {
  return {
    id,
    name: `Group ${id}`,
    createdAt: 1,
    memberPubkeys: members,
    relays: [],
  };
}

const CONTACT = 'aa11';
const OTHER = 'bb22';
const OWN = 'cc33';

describe('commonGroups', () => {
  it('returns an empty array when there are no groups', () => {
    expect(commonGroups([], CONTACT)).toEqual([]);
  });

  it('returns an empty array when no group contains the contact', () => {
    const groups = [makeGroup('1', [OWN, OTHER]), makeGroup('2', [OWN])];
    expect(commonGroups(groups, CONTACT)).toEqual([]);
  });

  it('returns the single group that contains the contact', () => {
    const groups = [makeGroup('1', [OWN, CONTACT]), makeGroup('2', [OWN])];
    const result = commonGroups(groups, CONTACT);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
  });

  it('returns all groups that contain the contact, preserving input order', () => {
    const groups = [
      makeGroup('1', [OWN, CONTACT]),
      makeGroup('2', [OWN]),
      makeGroup('3', [OWN, CONTACT, OTHER]),
    ];
    const result = commonGroups(groups, CONTACT);
    expect(result.map((g) => g.id)).toEqual(['1', '3']);
  });

  it('matches the contact pubkey case-insensitively', () => {
    const groups = [makeGroup('1', [OWN, CONTACT.toUpperCase()])];
    expect(commonGroups(groups, CONTACT)).toHaveLength(1);
  });

  it('returns an empty array when the contact pubkey is empty', () => {
    const groups = [makeGroup('1', [OWN, CONTACT])];
    expect(commonGroups(groups, '')).toEqual([]);
  });
});

describe('eligibleGroupsForContact', () => {
  it('returns an empty array when there are no groups', () => {
    expect(eligibleGroupsForContact([], CONTACT)).toEqual([]);
  });

  it('returns all groups when the contact is in none of them', () => {
    const groups = [makeGroup('1', [OWN]), makeGroup('2', [OWN, OTHER])];
    expect(eligibleGroupsForContact(groups, CONTACT).map((g) => g.id)).toEqual(['1', '2']);
  });

  it('excludes groups the contact is already a member of', () => {
    const groups = [
      makeGroup('1', [OWN, CONTACT]),
      makeGroup('2', [OWN]),
      makeGroup('3', [OWN, CONTACT]),
    ];
    expect(eligibleGroupsForContact(groups, CONTACT).map((g) => g.id)).toEqual(['2']);
  });

  it('returns an empty array when the contact is in all groups', () => {
    const groups = [makeGroup('1', [OWN, CONTACT]), makeGroup('2', [OWN, CONTACT])];
    expect(eligibleGroupsForContact(groups, CONTACT)).toEqual([]);
  });

  it('excludes membership case-insensitively', () => {
    const groups = [makeGroup('1', [OWN, CONTACT.toUpperCase()])];
    expect(eligibleGroupsForContact(groups, CONTACT)).toEqual([]);
  });

  it('is the exact complement of commonGroups over the same input', () => {
    const groups = [
      makeGroup('1', [OWN, CONTACT]),
      makeGroup('2', [OWN]),
      makeGroup('3', [OWN, CONTACT]),
      makeGroup('4', [OWN, OTHER]),
    ];
    const common = commonGroups(groups, CONTACT).map((g) => g.id);
    const eligible = eligibleGroupsForContact(groups, CONTACT).map((g) => g.id);
    expect([...common, ...eligible].sort()).toEqual(['1', '2', '3', '4']);
    expect(common.filter((id) => eligible.includes(id))).toEqual([]);
  });
});

describe('addableGroupsForContact', () => {
  it('returns an empty array when there are no groups', () => {
    expect(addableGroupsForContact([], CONTACT, new Set(['1']))).toEqual([]);
  });

  it('returns an empty array when the admin set is empty', () => {
    const groups = [makeGroup('1', [OWN]), makeGroup('2', [OWN, OTHER])];
    expect(addableGroupsForContact(groups, CONTACT, new Set())).toEqual([]);
  });

  it('includes an eligible group only when its id is in the admin set', () => {
    const groups = [makeGroup('1', [OWN]), makeGroup('2', [OWN, OTHER])];
    const result = addableGroupsForContact(groups, CONTACT, new Set(['2']));
    expect(result.map((g) => g.id)).toEqual(['2']);
  });

  it('excludes a group where the user is NOT an admin even when the contact is not a member (AC-STRUCT-3)', () => {
    // Contact is not in either group, so both are eligible — but the user only
    // administers group '1', so group '2' must be excluded.
    const groups = [makeGroup('1', [OWN]), makeGroup('2', [OWN])];
    const result = addableGroupsForContact(groups, CONTACT, new Set(['1']));
    expect(result.map((g) => g.id)).toEqual(['1']);
  });

  it('excludes a group the contact is already a member of even when the user is an admin', () => {
    // User administers both groups, but the contact is already in group '1',
    // so only group '2' is addable.
    const groups = [makeGroup('1', [OWN, CONTACT]), makeGroup('2', [OWN])];
    const result = addableGroupsForContact(groups, CONTACT, new Set(['1', '2']));
    expect(result.map((g) => g.id)).toEqual(['2']);
  });

  it('requires BOTH eligibility and admin: contact-member or non-admin groups are dropped', () => {
    const groups = [
      makeGroup('1', [OWN, CONTACT]), // contact member → not eligible
      makeGroup('2', [OWN]), // eligible + admin → addable
      makeGroup('3', [OWN]), // eligible but not admin → dropped
      makeGroup('4', [OWN, OTHER]), // eligible + admin → addable
    ];
    const result = addableGroupsForContact(groups, CONTACT, new Set(['1', '2', '4']));
    expect(result.map((g) => g.id)).toEqual(['2', '4']);
  });

  it('preserves input order', () => {
    const groups = [makeGroup('3', [OWN]), makeGroup('1', [OWN]), makeGroup('2', [OWN])];
    const result = addableGroupsForContact(groups, CONTACT, new Set(['1', '2', '3']));
    expect(result.map((g) => g.id)).toEqual(['3', '1', '2']);
  });
});
