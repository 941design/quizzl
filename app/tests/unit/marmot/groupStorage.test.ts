/**
 * Unit tests for groupStorage.ts — focused on AC-039 regression protection.
 *
 * AC-039: When two peers' relays land for the same target, the second
 * mergeMemberProfile call is a no-op; observable as zero net IDB writes for
 * the duplicate (LWW no-update branch must NOT call saveMemberProfiles).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── idb-keyval mock ─────────────────────────────────────────────────────────
const idbStore = new Map<string, unknown>();
const idbSetSpy = vi.fn(async (key: string, value: unknown) => { idbStore.set(key, value); });

vi.mock('idb-keyval', () => ({
  get: vi.fn(async (key: string) => idbStore.get(key) ?? undefined),
  set: idbSetSpy,
  del: vi.fn(async (key: string) => { idbStore.delete(key); }),
  keys: vi.fn(async () => [...idbStore.keys()]),
  delMany: vi.fn(async (ks: string[]) => { ks.forEach((k) => idbStore.delete(k)); }),
  createStore: vi.fn(() => ({})),
}));

const { mergeMemberProfile } = await import('@/src/lib/marmot/groupStorage');
import type { MemberProfile } from '@/src/types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const GROUP_ID = 'group-storage-test';
const AUTHOR_PUBKEY = 'ab'.repeat(32);

function makeProfile(updatedAt: string, overrides: Partial<MemberProfile> = {}): MemberProfile {
  return {
    pubkeyHex: AUTHOR_PUBKEY,
    nickname: 'Alice',
    avatar: null,
    updatedAt,
    ...overrides,
  };
}

beforeEach(() => {
  idbStore.clear();
  vi.clearAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('mergeMemberProfile — AC-039 zero-write on duplicate', () => {
  it('first merge (new profile) writes to IDB once', async () => {
    const profile = makeProfile('2026-01-01T00:00:00.000Z');
    const result = await mergeMemberProfile(GROUP_ID, profile);

    expect(result).toBe(true);
    // one load (get) + one save (set)
    expect(idbSetSpy).toHaveBeenCalledTimes(1);
  });

  it('duplicate merge (same updatedAt) returns false and produces zero IDB writes', async () => {
    const ts = '2026-01-01T00:00:00.000Z';
    const profile = makeProfile(ts);

    // First merge — establishes the stored profile
    await mergeMemberProfile(GROUP_ID, profile);
    idbSetSpy.mockClear();

    // Second merge — identical updatedAt (LWW no-update branch)
    const result = await mergeMemberProfile(GROUP_ID, profile);

    expect(result).toBe(false);
    // AC-039: zero net IDB writes for the duplicate
    expect(idbSetSpy).not.toHaveBeenCalled();
  });

  it('stale merge (incoming updatedAt < stored) returns false and produces zero IDB writes', async () => {
    const newerProfile = makeProfile('2026-06-01T00:00:00.000Z');
    const olderProfile = makeProfile('2026-01-01T00:00:00.000Z');

    await mergeMemberProfile(GROUP_ID, newerProfile);
    idbSetSpy.mockClear();

    const result = await mergeMemberProfile(GROUP_ID, olderProfile);

    expect(result).toBe(false);
    expect(idbSetSpy).not.toHaveBeenCalled();
  });

  it('newer merge (incoming updatedAt > stored) returns true and writes once', async () => {
    const olderProfile = makeProfile('2026-01-01T00:00:00.000Z');
    const newerProfile = makeProfile('2026-06-01T00:00:00.000Z');

    await mergeMemberProfile(GROUP_ID, olderProfile);
    idbSetSpy.mockClear();

    const result = await mergeMemberProfile(GROUP_ID, newerProfile);

    expect(result).toBe(true);
    expect(idbSetSpy).toHaveBeenCalledTimes(1);
  });
});
