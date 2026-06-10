import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PROFILE_REQUEST_KIND,
  PROFILE_STALENESS_MS,
  REQUEST_DEDUPE_MS,
  UNANSWERED_RETRY_MS,
  UNANSWERED_MAX_ATTEMPTS,
  RELAY_BACKOFF_MIN_MS,
  RELAY_BACKOFF_MAX_MS,
  ProfileRequestPayload,
  serialiseProfileRequest,
  parseProfileRequestPayload,
  isProfileStale,
  shouldEmitRequest,
  pickBackoffMs,
  type ProfileRequestMemo,
} from '@/src/lib/marmot/profileRequestSync';
import type { MemberProfile } from '@/src/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('profileRequestSync constants', () => {
  it('PROFILE_REQUEST_KIND is 30', () => {
    expect(PROFILE_REQUEST_KIND).toBe(30);
  });

  it('PROFILE_STALENESS_MS = 7 days in ms', () => {
    expect(PROFILE_STALENESS_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('REQUEST_DEDUPE_MS = 7 days in ms', () => {
    expect(REQUEST_DEDUPE_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('UNANSWERED_RETRY_MS = 1 hour in ms', () => {
    expect(UNANSWERED_RETRY_MS).toBe(60 * 60 * 1000);
  });

  it('UNANSWERED_MAX_ATTEMPTS = 3', () => {
    expect(UNANSWERED_MAX_ATTEMPTS).toBe(3);
  });

  it('RELAY_BACKOFF_MIN_MS = 5_000', () => {
    expect(RELAY_BACKOFF_MIN_MS).toBe(5_000);
  });

  it('RELAY_BACKOFF_MAX_MS = 30_000', () => {
    expect(RELAY_BACKOFF_MAX_MS).toBe(30_000);
  });
});

// ---------------------------------------------------------------------------
// serialiseProfileRequest
// ---------------------------------------------------------------------------

describe('serialiseProfileRequest', () => {
  it('returns a valid JSON string', () => {
    const result = serialiseProfileRequest({ targetPubkey: 'abc123' });
    expect(() => JSON.parse(result)).not.toThrow();
  });

  it('carries the required type field', () => {
    const result = serialiseProfileRequest({ targetPubkey: 'abc123' });
    const parsed = JSON.parse(result) as Record<string, unknown>;
    expect(parsed.type).toBe('profile_request');
  });

  it('carries the targetPubkey verbatim', () => {
    const result = serialiseProfileRequest({ targetPubkey: 'deadbeef' });
    const parsed = JSON.parse(result) as Record<string, unknown>;
    expect(parsed.targetPubkey).toBe('deadbeef');
  });

  it('omits sinceUpdatedAt when not provided', () => {
    const result = serialiseProfileRequest({ targetPubkey: 'abc123' });
    const parsed = JSON.parse(result) as Record<string, unknown>;
    expect(parsed.sinceUpdatedAt).toBeUndefined();
  });

  it('includes sinceUpdatedAt when provided', () => {
    const since = '2026-05-01T00:00:00.000Z';
    const result = serialiseProfileRequest({ targetPubkey: 'abc123', sinceUpdatedAt: since });
    const parsed = JSON.parse(result) as Record<string, unknown>;
    expect(parsed.sinceUpdatedAt).toBe(since);
  });

  it('generates a different nonce on every call (even with identical inputs)', () => {
    const a = serialiseProfileRequest({ targetPubkey: 'abc123' });
    const b = serialiseProfileRequest({ targetPubkey: 'abc123' });
    const nonceA = (JSON.parse(a) as { nonce: string }).nonce;
    const nonceB = (JSON.parse(b) as { nonce: string }).nonce;
    expect(nonceA).not.toBe(nonceB);
    expect(typeof nonceA).toBe('string');
    expect(nonceA.length).toBeGreaterThan(0);
    expect(typeof nonceB).toBe('string');
    expect(nonceB.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// parseProfileRequestPayload
// ---------------------------------------------------------------------------

describe('parseProfileRequestPayload', () => {
  it('parses a valid payload', () => {
    const wire = JSON.stringify({
      type: 'profile_request',
      targetPubkey: 'deadbeef',
      nonce: 'nonce-1',
    });
    const result = parseProfileRequestPayload(wire);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('profile_request');
    expect(result!.targetPubkey).toBe('deadbeef');
    expect(result!.nonce).toBe('nonce-1');
    expect(result!.sinceUpdatedAt).toBeUndefined();
  });

  it('parses sinceUpdatedAt when present', () => {
    const wire = JSON.stringify({
      type: 'profile_request',
      targetPubkey: 'abc',
      sinceUpdatedAt: '2026-04-01T00:00:00.000Z',
      nonce: 'n',
    });
    const result = parseProfileRequestPayload(wire);
    expect(result!.sinceUpdatedAt).toBe('2026-04-01T00:00:00.000Z');
  });

  it('returns null for malformed JSON', () => {
    expect(parseProfileRequestPayload('not json')).toBeNull();
    expect(parseProfileRequestPayload('[]')).toBeNull();
    expect(parseProfileRequestPayload('null')).toBeNull();
  });

  it('returns null when type field is missing', () => {
    expect(parseProfileRequestPayload(JSON.stringify({ targetPubkey: 'x', nonce: 'n' }))).toBeNull();
  });

  it('returns null when type is not "profile_request"', () => {
    expect(
      parseProfileRequestPayload(JSON.stringify({ type: 'other', targetPubkey: 'x', nonce: 'n' })),
    ).toBeNull();
  });

  it('returns null when targetPubkey is missing', () => {
    expect(parseProfileRequestPayload(JSON.stringify({ type: 'profile_request', nonce: 'n' }))).toBeNull();
  });

  it('returns null when targetPubkey is empty string', () => {
    expect(
      parseProfileRequestPayload(JSON.stringify({ type: 'profile_request', targetPubkey: '', nonce: 'n' })),
    ).toBeNull();
  });

  it('returns null when targetPubkey is not a string', () => {
    expect(
      parseProfileRequestPayload(JSON.stringify({ type: 'profile_request', targetPubkey: 123, nonce: 'n' })),
    ).toBeNull();
  });

  it('accepts nonce that is not a string (returns empty)', () => {
    const wire = JSON.stringify({ type: 'profile_request', targetPubkey: 'x', nonce: 42 });
    const result = parseProfileRequestPayload(wire);
    expect(result).not.toBeNull();
    expect(result!.nonce).toBe('');
  });

  it('round-trips serialise → parse', () => {
    const wire = serialiseProfileRequest({ targetPubkey: 'deadbeef', sinceUpdatedAt: '2026-05-01T00:00:00Z' });
    const parsed = parseProfileRequestPayload(wire);
    expect(parsed).not.toBeNull();
    expect(parsed!.targetPubkey).toBe('deadbeef');
    expect(parsed!.sinceUpdatedAt).toBe('2026-05-01T00:00:00Z');
    expect(typeof parsed!.nonce).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// isProfileStale
// ---------------------------------------------------------------------------

describe('isProfileStale', () => {
  const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

  function makeProfile(updatedAtIso: string): MemberProfile {
    return {
      pubkeyHex: 'pk',
      nickname: 'Test',
      avatar: null,
      updatedAt: updatedAtIso,
    };
  }

  it('returns true when profile is undefined', () => {
    expect(isProfileStale(undefined, Date.now())).toBe(true);
  });

  it('returns true when profile is null', () => {
    expect(isProfileStale(null as unknown as MemberProfile | undefined, Date.now())).toBe(true);
  });

  it('returns true when profile.updatedAt is exactly PROFILE_STALENESS_MS old', () => {
    const old = new Date(Date.now() - SEVEN_DAYS).toISOString();
    expect(isProfileStale(makeProfile(old), Date.now())).toBe(true);
  });

  it('returns true when profile.updatedAt is older than PROFILE_STALENESS_MS', () => {
    const old = new Date(Date.now() - SEVEN_DAYS - 1).toISOString();
    expect(isProfileStale(makeProfile(old), Date.now())).toBe(true);
  });

  it('returns false when profile.updatedAt is fresh (now)', () => {
    const fresh = new Date(Date.now()).toISOString();
    expect(isProfileStale(makeProfile(fresh), Date.now())).toBe(false);
  });

  it('returns false when profile.updatedAt is within PROFILE_STALENESS_MS', () => {
    const recent = new Date(Date.now() - SEVEN_DAYS + 1).toISOString();
    expect(isProfileStale(makeProfile(recent), Date.now())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// shouldEmitRequest — full truth table (parameterised)
// ---------------------------------------------------------------------------

describe('shouldEmitRequest', () => {
  const now = 10_000_000_000; // Unix ms

  const CASES: Array<{
    label: string;
    memo: ProfileRequestMemo | null;
    now: number;
    expectEmit: boolean;
  }> = [
    // --- null memo ---
    {
      label: 'null memo → always emit',
      memo: null,
      now,
      expectEmit: true,
    },

    // --- answered within REQUEST_DEDUPE_MS → skip ---
    {
      label: 'answered 1ms ago → skip',
      memo: { groupId: 'g', targetPubkey: 'pk', lastRequestAt: now - 100, lastAnsweredAt: now - 1, attempts: 1 },
      now,
      expectEmit: false,
    },
    {
      label: 'answered 6 days ago → skip (within dedupe window)',
      memo: { groupId: 'g', targetPubkey: 'pk', lastRequestAt: now - 100, lastAnsweredAt: now - 6 * 24 * 60 * 60 * 1000, attempts: 1 },
      now,
      expectEmit: false,
    },

    // --- last request within UNANSWERED_RETRY_MS → skip ---
    {
      label: 'last request 1ms ago → skip (too soon)',
      memo: { groupId: 'g', targetPubkey: 'pk', lastRequestAt: now - 1, lastAnsweredAt: null, attempts: 1 },
      now,
      expectEmit: false,
    },
    {
      label: 'last request 30min ago → skip (within retry window)',
      memo: { groupId: 'g', targetPubkey: 'pk', lastRequestAt: now - 30 * 60 * 1000, lastAnsweredAt: null, attempts: 1 },
      now,
      expectEmit: false,
    },
    {
      label: 'last request 59min59s ago → skip (just within retry window)',
      memo: { groupId: 'g', targetPubkey: 'pk', lastRequestAt: now - (60 * 60 * 1000 - 1), lastAnsweredAt: null, attempts: 1 },
      now,
      expectEmit: false,
    },

    // --- UNANSWERED_RETRY_MS <= elapsed <= REQUEST_DEDUPE_MS ---
    {
      label: '1h+1ms ago, 0 attempts → emit',
      memo: { groupId: 'g', targetPubkey: 'pk', lastRequestAt: now - (60 * 60 * 1000 + 1), lastAnsweredAt: null, attempts: 0 },
      now,
      expectEmit: true,
    },
    {
      label: '1h+1ms ago, 2 attempts (< MAX) → emit',
      memo: { groupId: 'g', targetPubkey: 'pk', lastRequestAt: now - (60 * 60 * 1000 + 1), lastAnsweredAt: null, attempts: 2 },
      now,
      expectEmit: true,
    },
    {
      label: '1h+1ms ago, 3 attempts (== MAX) → skip',
      memo: { groupId: 'g', targetPubkey: 'pk', lastRequestAt: now - (60 * 60 * 1000 + 1), lastAnsweredAt: null, attempts: 3 },
      now,
      expectEmit: false,
    },
    {
      label: '1h+1ms ago, 4 attempts (> MAX) → skip',
      memo: { groupId: 'g', targetPubkey: 'pk', lastRequestAt: now - (60 * 60 * 1000 + 1), lastAnsweredAt: null, attempts: 4 },
      now,
      expectEmit: false,
    },
    {
      label: '3 days ago, 2 attempts (< MAX) → emit',
      memo: { groupId: 'g', targetPubkey: 'pk', lastRequestAt: now - 3 * 24 * 60 * 60 * 1000, lastAnsweredAt: null, attempts: 2 },
      now,
      expectEmit: true,
    },

    // --- elapsed >= REQUEST_DEDUPE_MS → always emit regardless of attempts ---
    {
      label: '7 days ago, 0 attempts → emit',
      memo: { groupId: 'g', targetPubkey: 'pk', lastRequestAt: now - 7 * 24 * 60 * 60 * 1000, lastAnsweredAt: null, attempts: 0 },
      now,
      expectEmit: true,
    },
    {
      label: '7 days ago, 3 attempts (== MAX) → emit (dedupe window expired)',
      memo: { groupId: 'g', targetPubkey: 'pk', lastRequestAt: now - 7 * 24 * 60 * 60 * 1000, lastAnsweredAt: null, attempts: 3 },
      now,
      expectEmit: true,
    },
    {
      label: '7 days ago, 100 attempts → emit',
      memo: { groupId: 'g', targetPubkey: 'pk', lastRequestAt: now - 7 * 24 * 60 * 60 * 1000, lastAnsweredAt: null, attempts: 100 },
      now,
      expectEmit: true,
    },
    {
      label: '8 days ago, never answered, MAX attempts hit → emit (dedupe window expired)',
      memo: { groupId: 'g', targetPubkey: 'pk', lastRequestAt: now - 8 * 24 * 60 * 60 * 1000, lastAnsweredAt: null, attempts: 3 },
      now,
      expectEmit: true,
    },
  ];

  it.each(CASES)('shouldEmitRequest: $label', ({ memo, now: testNow, expectEmit }) => {
    expect(shouldEmitRequest(memo, testNow)).toBe(expectEmit);
  });
});

// ---------------------------------------------------------------------------
// pickBackoffMs — property test
// ---------------------------------------------------------------------------

describe('pickBackoffMs', () => {
  it('returns a number (not NaN)', () => {
    const result = pickBackoffMs();
    expect(Number.isFinite(result)).toBe(true);
  });

  it('returns >= RELAY_BACKOFF_MIN_MS on first call', () => {
    expect(pickBackoffMs()).toBeGreaterThanOrEqual(RELAY_BACKOFF_MIN_MS);
  });

  it('returns <= RELAY_BACKOFF_MAX_MS on first call', () => {
    expect(pickBackoffMs()).toBeLessThanOrEqual(RELAY_BACKOFF_MAX_MS);
  });

  it('returns within [MIN, MAX] for 200 consecutive calls', () => {
    vi.useFakeTimers();
    try {
      for (let i = 0; i < 200; i++) {
        const val = pickBackoffMs();
        expect(val).toBeGreaterThanOrEqual(RELAY_BACKOFF_MIN_MS);
        expect(val).toBeLessThanOrEqual(RELAY_BACKOFF_MAX_MS);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('covers the full range: some calls below midpoint, some above (sanity)', () => {
    vi.useFakeTimers();
    try {
      const mid = (RELAY_BACKOFF_MIN_MS + RELAY_BACKOFF_MAX_MS) / 2;
      const belowMid = Array.from({ length: 100 }, () => pickBackoffMs()).filter((v) => v < mid);
      const aboveMid = Array.from({ length: 100 }, () => pickBackoffMs()).filter((v) => v > mid);
      // At least one call should land below midpoint and one above — with 200 samples
      // this is overwhelmingly likely to pass even with a poor RNG; if it flakes, the
      // range-bound property above is the authoritative test.
      expect(belowMid.length).toBeGreaterThan(0);
      expect(aboveMid.length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
