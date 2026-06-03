/**
 * Unit tests for isAllowedDmSender — AC-TEST-1.
 * Covers AC-SEC-1 (boundary rejections) and AC-SEC-2 (whitelist membership).
 */

import { describe, expect, it } from 'vitest';
import { isAllowedDmSender } from '@/src/lib/walledGarden';
import type { Group } from '@/src/types';

const GROUP_A: Group = {
  id: 'group-a',
  name: 'Biology',
  createdAt: 1,
  memberPubkeys: [
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  ],
  relays: [],
};

const GROUP_B: Group = {
  id: 'group-b',
  name: 'History',
  createdAt: 2,
  memberPubkeys: [
    'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
  ],
  relays: [],
};

const OWN_PUBKEY = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const ALICE = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const BOB = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const CAROL = 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
const MALLORY = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

describe('isAllowedDmSender — AC-SEC-1 boundary rejections', () => {
  it('(1) returns false when peerHex is the empty string', () => {
    expect(isAllowedDmSender('', [GROUP_A], OWN_PUBKEY)).toBe(false);
  });

  it('(2) returns false when peerHex equals ownPubkeyHex (exact match)', () => {
    const groupWithSelf: Group = {
      id: 'g-self',
      name: 'Test',
      createdAt: 1,
      memberPubkeys: [OWN_PUBKEY, ALICE],
      relays: [],
    };
    expect(isAllowedDmSender(OWN_PUBKEY, [groupWithSelf], OWN_PUBKEY)).toBe(false);
  });

  it('(2) returns false when peerHex equals ownPubkeyHex (case-insensitive)', () => {
    const groupWithSelf: Group = {
      id: 'g-self',
      name: 'Test',
      createdAt: 1,
      memberPubkeys: [OWN_PUBKEY.toUpperCase(), ALICE],
      relays: [],
    };
    expect(isAllowedDmSender(OWN_PUBKEY.toUpperCase(), [groupWithSelf], OWN_PUBKEY.toLowerCase())).toBe(false);
  });

  it('(3) returns false when groups is an empty array', () => {
    expect(isAllowedDmSender(ALICE, [], OWN_PUBKEY)).toBe(false);
  });
});

describe('isAllowedDmSender — AC-SEC-2 whitelist membership', () => {
  it('returns true for a peer present in exactly one of many groups', () => {
    // CAROL is in GROUP_B only, not GROUP_A
    expect(isAllowedDmSender(CAROL, [GROUP_A, GROUP_B], OWN_PUBKEY)).toBe(true);
  });

  it('returns true for a peer present in the first group when multiple groups exist', () => {
    expect(isAllowedDmSender(ALICE, [GROUP_A, GROUP_B], OWN_PUBKEY)).toBe(true);
  });

  it('returns true for a peer with mixed-case pubkey (case-insensitive comparison)', () => {
    const mixedCasePeer = ALICE.toUpperCase();
    expect(isAllowedDmSender(mixedCasePeer, [GROUP_A], OWN_PUBKEY)).toBe(true);
  });

  it('returns true when memberPubkeys contains mixed-case entries (case-insensitive comparison)', () => {
    const groupMixedCase: Group = {
      id: 'g-mixed',
      name: 'Mixed',
      createdAt: 1,
      memberPubkeys: [ALICE.toUpperCase()],
      relays: [],
    };
    expect(isAllowedDmSender(ALICE.toLowerCase(), [groupMixedCase], OWN_PUBKEY)).toBe(true);
  });

  it('returns false for a peer absent from all groups', () => {
    expect(isAllowedDmSender(MALLORY, [GROUP_A, GROUP_B], OWN_PUBKEY)).toBe(false);
  });

  it('returns false for a peer absent when only one group is present', () => {
    expect(isAllowedDmSender(MALLORY, [GROUP_A], OWN_PUBKEY)).toBe(false);
  });

  it('returns true when ownPubkeyHex is null (no self-check)', () => {
    expect(isAllowedDmSender(BOB, [GROUP_A], null)).toBe(true);
  });

  it('returns true when ownPubkeyHex is undefined (no self-check)', () => {
    expect(isAllowedDmSender(BOB, [GROUP_A], undefined)).toBe(true);
  });
});

describe('isAllowedDmSender — cross-story seam invariants (VQ-S1-009)', () => {
  it('invariant 1: returns false for empty peerHex', () => {
    expect(isAllowedDmSender('', [GROUP_A], OWN_PUBKEY)).toBe(false);
  });

  it('invariant 2: returns false when peerHex (case-insensitive) equals ownPubkeyHex', () => {
    expect(isAllowedDmSender(OWN_PUBKEY.toUpperCase(), [GROUP_A], OWN_PUBKEY.toLowerCase())).toBe(false);
  });

  it('invariant 3: returns false when groups is []', () => {
    expect(isAllowedDmSender(ALICE, [], OWN_PUBKEY)).toBe(false);
  });

  it('invariant 4a: returns true if and only if peer is in memberPubkeys (positive case)', () => {
    expect(isAllowedDmSender(ALICE, [GROUP_A], OWN_PUBKEY)).toBe(true);
  });

  it('invariant 4b: returns false if peer is not in any memberPubkeys (negative case)', () => {
    expect(isAllowedDmSender(MALLORY, [GROUP_A, GROUP_B], OWN_PUBKEY)).toBe(false);
  });

  it('invariant 5: function is synchronous and has no observable side effects (returns boolean immediately)', () => {
    const result = isAllowedDmSender(ALICE, [GROUP_A], OWN_PUBKEY);
    expect(typeof result).toBe('boolean');
  });
});
