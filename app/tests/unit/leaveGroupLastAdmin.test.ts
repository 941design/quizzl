import { describe, it, expect } from 'vitest';
import { isSoleAdmin } from '@/src/components/groups/LeaveGroupButton';

describe('isSoleAdmin', () => {
  it('returns true when the single admin matches the current user (exact case)', () => {
    expect(isSoleAdmin(['alice'], 'alice')).toBe(true);
  });

  it('returns false when two admins exist and current user is one of them', () => {
    expect(isSoleAdmin(['alice', 'bob'], 'alice')).toBe(false);
  });

  it('returns false when one admin exists but is NOT the current user', () => {
    expect(isSoleAdmin(['bob'], 'alice')).toBe(false);
  });

  it('returns false when adminPubkeys is undefined', () => {
    expect(isSoleAdmin(undefined, 'alice')).toBe(false);
  });

  it('returns false when adminPubkeys is empty', () => {
    expect(isSoleAdmin([], 'alice')).toBe(false);
  });

  it('returns false when ownPubkeyHex is null', () => {
    expect(isSoleAdmin(['alice'], null)).toBe(false);
  });

  it('returns false when ownPubkeyHex is undefined', () => {
    expect(isSoleAdmin(['alice'], undefined)).toBe(false);
  });

  it('returns true with case-insensitive match: UPPER admin vs lower own', () => {
    expect(isSoleAdmin(['ALICE'], 'alice')).toBe(true);
  });

  it('returns true with case-insensitive match: lower admin vs UPPER own', () => {
    expect(isSoleAdmin(['alice'], 'ALICE')).toBe(true);
  });
});
