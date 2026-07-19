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

const idbClearSpy = vi.fn(async () => { idbStore.clear(); });

vi.mock('idb-keyval', () => ({
  get: vi.fn(async (key: string) => idbStore.get(key) ?? undefined),
  set: idbSetSpy,
  del: vi.fn(async (key: string) => { idbStore.delete(key); }),
  keys: vi.fn(async () => [...idbStore.keys()]),
  delMany: vi.fn(async (ks: string[]) => { ks.forEach((k) => idbStore.delete(k)); }),
  entries: vi.fn(async () => [...idbStore.entries()]),
  clear: idbClearSpy,
  createStore: vi.fn(() => ({})),
}));

const clearAllPendingDirectInvitesSpy = vi.fn(async () => {});
vi.mock('@/src/lib/marmot/pendingDirectInviteStorage', () => ({
  clearAllPendingDirectInvites: clearAllPendingDirectInvitesSpy,
}));

const { mergeMemberProfile, deleteMemberProfile, clearAllGroupData, saveMemberProfiles, loadMemberProfiles } =
  await import('@/src/lib/marmot/groupStorage');
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

// ─── deleteMemberProfile — AC-PURGE-1 ───────────────────────────────────────

describe('deleteMemberProfile — AC-PURGE-1 per-member purge', () => {
  const OTHER_PUBKEY = 'cd'.repeat(32);
  const THIRD_PUBKEY = 'ef'.repeat(32);

  it('removes only the target pubkey, leaving other members\' entries byte-for-byte unchanged', async () => {
    const target = makeProfile('2026-01-01T00:00:00.000Z', { pubkeyHex: AUTHOR_PUBKEY, nickname: 'Alice' });
    const other = makeProfile('2026-02-01T00:00:00.000Z', { pubkeyHex: OTHER_PUBKEY, nickname: 'Bob', avatar: 'bob.png' });
    const third = makeProfile('2026-03-01T00:00:00.000Z', { pubkeyHex: THIRD_PUBKEY, nickname: 'Carol', provisional: true } as Partial<MemberProfile>);

    await saveMemberProfiles(GROUP_ID, [target, other, third]);
    idbSetSpy.mockClear();

    await deleteMemberProfile(GROUP_ID, AUTHOR_PUBKEY);

    const remaining = await loadMemberProfiles(GROUP_ID);
    expect(remaining).toHaveLength(2);
    expect(remaining).toContainEqual(other);
    expect(remaining).toContainEqual(third);
    expect(remaining.find((p) => p.pubkeyHex === AUTHOR_PUBKEY)).toBeUndefined();
  });

  it('matches pubkeyHex case-insensitively', async () => {
    const target = makeProfile('2026-01-01T00:00:00.000Z', { pubkeyHex: AUTHOR_PUBKEY, nickname: 'Alice' });
    const other = makeProfile('2026-02-01T00:00:00.000Z', { pubkeyHex: OTHER_PUBKEY, nickname: 'Bob' });

    await saveMemberProfiles(GROUP_ID, [target, other]);

    await deleteMemberProfile(GROUP_ID, AUTHOR_PUBKEY.toUpperCase());

    const remaining = await loadMemberProfiles(GROUP_ID);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].pubkeyHex).toBe(OTHER_PUBKEY);
  });

  it('is a no-op (no IDB write, no throw) when the pubkey has no stored entry', async () => {
    const other = makeProfile('2026-02-01T00:00:00.000Z', { pubkeyHex: OTHER_PUBKEY, nickname: 'Bob' });
    await saveMemberProfiles(GROUP_ID, [other]);
    idbSetSpy.mockClear();

    await expect(deleteMemberProfile(GROUP_ID, AUTHOR_PUBKEY)).resolves.toBeUndefined();

    expect(idbSetSpy).not.toHaveBeenCalled();
    const remaining = await loadMemberProfiles(GROUP_ID);
    expect(remaining).toEqual([other]);
  });

  it('is a no-op when the group has no stored profiles at all', async () => {
    await expect(deleteMemberProfile('empty-group', AUTHOR_PUBKEY)).resolves.toBeUndefined();
    expect(idbSetSpy).not.toHaveBeenCalled();
  });
});

// ─── clearAllGroupData — AC-MARKER-9 account-reset half ─────────────────────

describe('clearAllGroupData — AC-MARKER-9 account-reset marker clear', () => {
  it('clears every pre-existing store AND the pending-direct-invite marker store account-wide', async () => {
    await clearAllGroupData();

    // pre-existing four clear() calls (groupMeta/groupState/keyPackage/memberProfile)
    expect(idbClearSpy).toHaveBeenCalled();
    // new: S1's account-wide marker full-clear
    expect(clearAllPendingDirectInvitesSpy).toHaveBeenCalledTimes(1);
    expect(clearAllPendingDirectInvitesSpy).toHaveBeenCalledWith();
  });
});
