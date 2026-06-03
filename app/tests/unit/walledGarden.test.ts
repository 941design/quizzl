/**
 * Unit tests for isAllowedDmSender — AC-TEST-1.
 * Covers AC-SEC-1 (boundary rejections), AC-SEC-2 (whitelist membership),
 * and AC-SEC-12 (ever-known peers as second whitelist source).
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

const EMPTY_KNOWN: ReadonlySet<string> = new Set();

describe('isAllowedDmSender — AC-SEC-1 boundary rejections', () => {
  it('(1) returns false when peerHex is the empty string', () => {
    expect(isAllowedDmSender('', [GROUP_A], EMPTY_KNOWN, OWN_PUBKEY)).toBe(false);
  });

  it('(2) returns false when peerHex equals ownPubkeyHex (exact match)', () => {
    const groupWithSelf: Group = {
      id: 'g-self',
      name: 'Test',
      createdAt: 1,
      memberPubkeys: [OWN_PUBKEY, ALICE],
      relays: [],
    };
    expect(isAllowedDmSender(OWN_PUBKEY, [groupWithSelf], EMPTY_KNOWN, OWN_PUBKEY)).toBe(false);
  });

  it('(2) returns false when peerHex equals ownPubkeyHex (case-insensitive)', () => {
    const groupWithSelf: Group = {
      id: 'g-self',
      name: 'Test',
      createdAt: 1,
      memberPubkeys: [OWN_PUBKEY.toUpperCase(), ALICE],
      relays: [],
    };
    expect(isAllowedDmSender(OWN_PUBKEY.toUpperCase(), [groupWithSelf], EMPTY_KNOWN, OWN_PUBKEY.toLowerCase())).toBe(false);
  });

  it('(3) returns false when groups is empty AND knownPeers is empty', () => {
    expect(isAllowedDmSender(ALICE, [], EMPTY_KNOWN, OWN_PUBKEY)).toBe(false);
  });
});

describe('isAllowedDmSender — AC-SEC-2 whitelist membership (group path)', () => {
  it('returns true for a peer present in exactly one of many groups', () => {
    // CAROL is in GROUP_B only, not GROUP_A
    expect(isAllowedDmSender(CAROL, [GROUP_A, GROUP_B], EMPTY_KNOWN, OWN_PUBKEY)).toBe(true);
  });

  it('returns true for a peer present in the first group when multiple groups exist', () => {
    expect(isAllowedDmSender(ALICE, [GROUP_A, GROUP_B], EMPTY_KNOWN, OWN_PUBKEY)).toBe(true);
  });

  it('returns true for a peer with mixed-case pubkey (case-insensitive comparison)', () => {
    const mixedCasePeer = ALICE.toUpperCase();
    expect(isAllowedDmSender(mixedCasePeer, [GROUP_A], EMPTY_KNOWN, OWN_PUBKEY)).toBe(true);
  });

  it('returns true when memberPubkeys contains mixed-case entries (case-insensitive comparison)', () => {
    const groupMixedCase: Group = {
      id: 'g-mixed',
      name: 'Mixed',
      createdAt: 1,
      memberPubkeys: [ALICE.toUpperCase()],
      relays: [],
    };
    expect(isAllowedDmSender(ALICE.toLowerCase(), [groupMixedCase], EMPTY_KNOWN, OWN_PUBKEY)).toBe(true);
  });

  it('returns false for a peer absent from all groups (and not knownPeer)', () => {
    expect(isAllowedDmSender(MALLORY, [GROUP_A, GROUP_B], EMPTY_KNOWN, OWN_PUBKEY)).toBe(false);
  });

  it('returns false for a peer absent when only one group is present (and not knownPeer)', () => {
    expect(isAllowedDmSender(MALLORY, [GROUP_A], EMPTY_KNOWN, OWN_PUBKEY)).toBe(false);
  });

  it('returns true when ownPubkeyHex is null (no self-check)', () => {
    expect(isAllowedDmSender(BOB, [GROUP_A], EMPTY_KNOWN, null)).toBe(true);
  });

  it('returns true when ownPubkeyHex is undefined (no self-check)', () => {
    expect(isAllowedDmSender(BOB, [GROUP_A], EMPTY_KNOWN, undefined)).toBe(true);
  });
});

describe('isAllowedDmSender — AC-SEC-12 ever-known peers whitelist', () => {
  it('returns true for a knownPeer even when not in any current group (VQ-S1-014)', () => {
    const knownPeers: ReadonlySet<string> = new Set([MALLORY]);
    expect(isAllowedDmSender(MALLORY, [], knownPeers, OWN_PUBKEY)).toBe(true);
  });

  it('returns true for a knownPeer even when groups list is empty', () => {
    const knownPeers: ReadonlySet<string> = new Set([ALICE]);
    expect(isAllowedDmSender(ALICE, [], knownPeers, OWN_PUBKEY)).toBe(true);
  });

  it('knownPeer check is case-insensitive', () => {
    const knownPeers: ReadonlySet<string> = new Set([ALICE.toLowerCase()]);
    expect(isAllowedDmSender(ALICE.toUpperCase(), [], knownPeers, OWN_PUBKEY)).toBe(true);
  });

  it('returns false for a peer absent from both groups and knownPeers', () => {
    const knownPeers: ReadonlySet<string> = new Set([ALICE]);
    expect(isAllowedDmSender(MALLORY, [GROUP_A], knownPeers, OWN_PUBKEY)).toBe(false);
  });

  it('returns false when both groups and knownPeers are empty even if peerHex is non-empty', () => {
    expect(isAllowedDmSender(ALICE, [], EMPTY_KNOWN, OWN_PUBKEY)).toBe(false);
  });

  it('own pubkey in knownPeers is still rejected (self-addressing guard)', () => {
    // Even if own pubkey were somehow stored in knownPeers, the self-check fires first
    const knownPeers: ReadonlySet<string> = new Set([OWN_PUBKEY]);
    expect(isAllowedDmSender(OWN_PUBKEY, [], knownPeers, OWN_PUBKEY)).toBe(false);
  });

  it('AC-SEC-15: ex-member still passes gate when still in knownPeers', () => {
    // Simulates: ALICE was a member (hence in knownPeers), then left GROUP_A
    const knownPeers: ReadonlySet<string> = new Set([ALICE]);
    const groupWithoutAlice: Group = { ...GROUP_A, memberPubkeys: [BOB] };
    expect(isAllowedDmSender(ALICE, [groupWithoutAlice], knownPeers, OWN_PUBKEY)).toBe(true);
  });

  // AC-TEST-3 case (c): peer present in BOTH groups and knownPeers → true
  it('AC-TEST-3(c): peer in both current groups AND knownPeers → true', () => {
    // ALICE is in GROUP_A's memberPubkeys AND in knownPeers
    const knownPeers: ReadonlySet<string> = new Set([ALICE]);
    expect(isAllowedDmSender(ALICE, [GROUP_A], knownPeers, OWN_PUBKEY)).toBe(true);
  });

  // AC-TEST-3(a): peer in current groups only (knownPeers explicitly empty) → true
  it('AC-TEST-3(a): peer in current groups only (knownPeers empty) → true', () => {
    expect(isAllowedDmSender(ALICE, [GROUP_A], EMPTY_KNOWN, OWN_PUBKEY)).toBe(true);
  });

  // AC-TEST-3(b): peer in knownPeers only (not in any current group) → true
  it('AC-TEST-3(b): peer in knownPeers only (no groups) → true', () => {
    const knownPeers: ReadonlySet<string> = new Set([CAROL]);
    expect(isAllowedDmSender(CAROL, [], knownPeers, OWN_PUBKEY)).toBe(true);
  });

  // AC-TEST-3(d): peer in neither → false
  it('AC-TEST-3(d): peer in neither groups nor knownPeers → false', () => {
    const knownPeers: ReadonlySet<string> = new Set([ALICE]);
    expect(isAllowedDmSender(MALLORY, [GROUP_A], knownPeers, OWN_PUBKEY)).toBe(false);
  });

  // AC-TEST-3(e): mixed-case peer hex in knownPeers branch (stored lowercase, passed uppercase) → true
  it('AC-TEST-3(e): mixed-case peer hex in knownPeers — stored lowercase, passed uppercase → true', () => {
    const knownPeers: ReadonlySet<string> = new Set([CAROL.toLowerCase()]);
    expect(isAllowedDmSender(CAROL.toUpperCase(), [], knownPeers, OWN_PUBKEY)).toBe(true);
  });
});

describe('isAllowedDmSender — cross-story seam invariants (VQ-S1-009)', () => {
  it('invariant 1: returns false for empty peerHex', () => {
    expect(isAllowedDmSender('', [GROUP_A], EMPTY_KNOWN, OWN_PUBKEY)).toBe(false);
  });

  it('invariant 2: returns false when peerHex (case-insensitive) equals ownPubkeyHex', () => {
    expect(isAllowedDmSender(OWN_PUBKEY.toUpperCase(), [GROUP_A], EMPTY_KNOWN, OWN_PUBKEY.toLowerCase())).toBe(false);
  });

  it('invariant 3: returns false when groups is [] and knownPeers is empty', () => {
    expect(isAllowedDmSender(ALICE, [], EMPTY_KNOWN, OWN_PUBKEY)).toBe(false);
  });

  it('invariant 4a: returns true if peer is in memberPubkeys (positive case)', () => {
    expect(isAllowedDmSender(ALICE, [GROUP_A], EMPTY_KNOWN, OWN_PUBKEY)).toBe(true);
  });

  it('invariant 4b: returns false if peer is not in any memberPubkeys and not knownPeer (negative case)', () => {
    expect(isAllowedDmSender(MALLORY, [GROUP_A, GROUP_B], EMPTY_KNOWN, OWN_PUBKEY)).toBe(false);
  });

  it('invariant 5: function is synchronous and has no observable side effects (returns boolean immediately)', () => {
    const result = isAllowedDmSender(ALICE, [GROUP_A], EMPTY_KNOWN, OWN_PUBKEY);
    expect(typeof result).toBe('boolean');
  });
});
