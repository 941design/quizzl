/**
 * Unit tests for reaction UI pure helper functions (story-08).
 *
 * All tests are pure — no component rendering, no react-testing-library.
 * No idb-keyval or crypto mocking needed (these functions are synchronous
 * and have no I/O side effects).
 */

import { describe, it, expect } from 'vitest';
import { computeReactOp, formatReactorList, selfReactedStyle } from '@/src/lib/reactions/reactionUiHelpers';
import type { ReactionAggregate } from '@/src/lib/reactions/api';

// ─── computeReactOp ───────────────────────────────────────────────────────────

describe('computeReactOp', () => {
  const SELF = 'aabbccdd1234';
  const OTHER = 'eeff00991234';

  function agg(emoji: string, selfReacted: boolean, count = 1): ReactionAggregate {
    return { emoji, count, reactors: selfReacted ? [SELF] : [OTHER], selfReacted };
  }

  it('returns add when agg exists and selfReacted=false', () => {
    const aggregates = [agg('👍', false)];
    expect(computeReactOp(aggregates, '👍')).toBe('add');
  });

  it('returns remove when agg exists and selfReacted=true', () => {
    const aggregates = [agg('👍', true)];
    expect(computeReactOp(aggregates, '👍')).toBe('remove');
  });

  it('returns add when agg does not exist (selfReacted=false by absence)', () => {
    const aggregates = [agg('❤️', false)];
    expect(computeReactOp(aggregates, '👍')).toBe('add');
  });

  it('returns add for degenerate case: agg absent but emoji not in list (selfReacted=true elsewhere)', () => {
    // selfReacted=true on a DIFFERENT emoji — clicking new emoji should still add
    const aggregates = [agg('❤️', true)];
    expect(computeReactOp(aggregates, '👍')).toBe('add');
  });

  it('returns add when aggregates is empty', () => {
    expect(computeReactOp([], '👍')).toBe('add');
  });

  it('handles multiple aggregates correctly', () => {
    const aggregates = [agg('👍', true), agg('❤️', false), agg('🎉', true)];
    expect(computeReactOp(aggregates, '👍')).toBe('remove');
    expect(computeReactOp(aggregates, '❤️')).toBe('add');
    expect(computeReactOp(aggregates, '🎉')).toBe('remove');
    expect(computeReactOp(aggregates, '🔥')).toBe('add');
  });

  it('D2 compliance: returns remove only for the clicked emoji, not others', () => {
    // User has reacted with both 👍 and ❤️; clicking 👍 should be 'remove' not 'add'
    // and should not affect ❤️'s op
    const aggregates = [agg('👍', true, 2), agg('❤️', true, 1)];
    expect(computeReactOp(aggregates, '👍')).toBe('remove');
    expect(computeReactOp(aggregates, '❤️')).toBe('remove');
    // A new emoji not reacted to yet
    expect(computeReactOp(aggregates, '🔥')).toBe('add');
  });
});

// ─── selfReactedStyle ─────────────────────────────────────────────────────────

describe('selfReactedStyle', () => {
  it('returns highlighted style for selfReacted=true', () => {
    const style = selfReactedStyle(true);
    expect(style.bg).toBe('brand.50');
    expect(style.borderColor).toBe('brand.300');
    expect(style.borderWidth).toBe('1px');
  });

  it('returns normal style for selfReacted=false', () => {
    const style = selfReactedStyle(false);
    expect(style.bg).toBe('surfaceMutedBg');
    expect(style.borderColor).toBe('borderSubtle');
    expect(style.borderWidth).toBe('1px');
  });

  it('produces different styles for true vs false (visually distinguishable)', () => {
    const highlighted = selfReactedStyle(true);
    const normal = selfReactedStyle(false);
    expect(highlighted.bg).not.toBe(normal.bg);
    expect(highlighted.borderColor).not.toBe(normal.borderColor);
  });
});

describe('formatReactorList', () => {
  const SELF = 'aabbccdd1234aabbccdd1234aabbccdd1234aabbccdd1234aabbccdd12341234';
  // Use recognizable short hex so we can test truncation without full npub encoding
  const P1 = '1111111111111111111111111111111111111111111111111111111111111111';
  const P2 = '2222222222222222222222222222222222222222222222222222222222222222';
  const P3 = '3333333333333333333333333333333333333333333333333333333333333333';
  const P4 = '4444444444444444444444444444444444444444444444444444444444444444';
  const P5 = '5555555555555555555555555555555555555555555555555555555555555555';
  const P6 = '6666666666666666666666666666666666666666666666666666666666666666';

  const cache = new Map<string, string>([
    [P1, 'Alice'],
    [P2, 'Bob'],
  ]);

  it('returns empty string for empty reactors', () => {
    expect(formatReactorList([], cache, SELF)).toBe('');
  });

  it('labels selfPubkey as "you"', () => {
    const result = formatReactorList([SELF], cache, SELF);
    expect(result).toBe('you');
  });

  it('uses display name from cache for known pubkeys', () => {
    const result = formatReactorList([P1], cache, SELF);
    expect(result).toBe('Alice');
  });

  it('falls back to truncated npub for uncached pubkeys', () => {
    const result = formatReactorList([P3], cache, SELF);
    // Should be a non-empty string (truncated npub), not the raw 64-char hex
    expect(result.length).toBeGreaterThan(0);
    expect(result.length).toBeLessThan(P3.length);
  });

  it('combines cached, uncached, and self in a comma-separated list', () => {
    const result = formatReactorList([SELF, P1, P2], cache, SELF);
    expect(result).toContain('you');
    expect(result).toContain('Alice');
    expect(result).toContain('Bob');
  });

  it('shows overflow suffix when reactors exceed maxDisplay', () => {
    const reactors = [P1, P2, P3, P4, P5, P6];
    const result = formatReactorList(reactors, cache, SELF, 5);
    expect(result).toContain('... and 1 others');
    // First 5 should be included
    expect(result).toContain('Alice');
    expect(result).toContain('Bob');
  });

  it('no overflow suffix when reactors equal maxDisplay exactly', () => {
    const reactors = [P1, P2, P3, P4, P5];
    const result = formatReactorList(reactors, cache, SELF, 5);
    expect(result).not.toContain('others');
  });

  it('respects custom maxDisplay parameter', () => {
    const reactors = [P1, P2, P3];
    const result = formatReactorList(reactors, cache, SELF, 2);
    expect(result).toContain('... and 1 others');
  });

  it('handles self-only list correctly', () => {
    const result = formatReactorList([SELF], new Map(), SELF);
    expect(result).toBe('you');
  });

  it('is case-insensitive for selfPubkey comparison', () => {
    const upperSelf = SELF.toUpperCase();
    const result = formatReactorList([upperSelf], cache, SELF.toLowerCase());
    expect(result).toBe('you');
  });
});
