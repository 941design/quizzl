import { describe, it, expect } from 'vitest';
import { membersChanged } from '@/src/lib/marmot/memberGuard';

describe('membersChanged', () => {
  it('returns true when same-length arrays differ in identity (AC-TEST-1 / AC-BUG-1 / AC-BUG-2)', () => {
    expect(membersChanged(['alice', 'bob'], ['alice', 'carol'])).toBe(true);
  });

  it('returns false when arrays are set-equal in same order (AC-TEST-2)', () => {
    expect(membersChanged(['alice', 'bob'], ['alice', 'bob'])).toBe(false);
  });

  it('returns false when arrays are set-equal in different order (AC-BUG-3 — order-agnostic)', () => {
    expect(membersChanged(['alice', 'bob'], ['bob', 'alice'])).toBe(false);
  });

  it('returns true when current is larger than stored', () => {
    expect(membersChanged(['alice'], ['alice', 'bob'])).toBe(true);
  });

  it('returns false for two empty arrays', () => {
    expect(membersChanged([], [])).toBe(false);
  });
});
