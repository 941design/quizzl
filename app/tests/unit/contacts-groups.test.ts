import { describe, expect, it } from 'vitest';
import { commonGroups, eligibleGroupsForContact } from '@/src/lib/contacts';
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
