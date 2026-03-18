import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  loadAllGroups,
  saveGroup,
  loadGroup,
  deleteGroup,
  loadMemberScores,
  saveMemberScores,
  mergeMemberScore,
  clearMemberScores,
} from '@/src/lib/marmot/groupStorage';
import type { Group, MemberScore, ScoreUpdate } from '@/src/types';

// ---------------------------------------------------------------------------
// Mock idb-keyval
// ---------------------------------------------------------------------------

const stores: Record<string, Record<string, unknown>> = {};

function getOrCreateStore(name: string): Record<string, unknown> {
  if (!stores[name]) stores[name] = {};
  return stores[name];
}

vi.mock('idb-keyval', () => {
  return {
    createStore: (dbName: string, storeName: string) => `${dbName}:${storeName}`,
    get: vi.fn(async (key: string, store: string) => {
      return getOrCreateStore(store)[key] ?? undefined;
    }),
    set: vi.fn(async (key: string, value: unknown, store: string) => {
      getOrCreateStore(store)[key] = value;
    }),
    del: vi.fn(async (key: string, store: string) => {
      delete getOrCreateStore(store)[key];
    }),
    keys: vi.fn(async (store: string) => {
      return Object.keys(getOrCreateStore(store));
    }),
    clear: vi.fn(async (store: string) => {
      const s = getOrCreateStore(store);
      Object.keys(s).forEach((k) => delete s[k]);
    }),
  };
});

beforeEach(() => {
  // Clear all mock stores
  Object.keys(stores).forEach((k) => delete stores[k]);
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const sampleGroup: Group = {
  id: 'abc123',
  name: 'Biology Study Group',
  createdAt: 1700000000000,
  memberPubkeys: ['pubkey1hex'],
  relays: ['wss://relay.damus.io'],
};

const sampleScore: ScoreUpdate = {
  topicSlug: 'biology-101',
  quizPoints: 10,
  maxPoints: 20,
  completedTasks: 3,
  totalTasks: 5,
  lastStudiedAt: '2026-03-18T09:00:00Z',
  sequenceNumber: 1,
};

// ---------------------------------------------------------------------------
// Group metadata tests
// ---------------------------------------------------------------------------

describe('groupStorage — group metadata', () => {
  it('saves and loads a group', async () => {
    await saveGroup(sampleGroup);
    const loaded = await loadGroup('abc123');
    expect(loaded).toEqual(sampleGroup);
  });

  it('returns undefined for unknown group id', async () => {
    const result = await loadGroup('nonexistent');
    expect(result).toBeUndefined();
  });

  it('loads all groups', async () => {
    const group2: Group = { ...sampleGroup, id: 'def456', name: 'Math Group' };
    await saveGroup(sampleGroup);
    await saveGroup(group2);

    const all = await loadAllGroups();
    expect(all).toHaveLength(2);
    expect(all.map((g) => g.id)).toContain('abc123');
    expect(all.map((g) => g.id)).toContain('def456');
  });

  it('deletes a group', async () => {
    await saveGroup(sampleGroup);
    await deleteGroup('abc123');
    const loaded = await loadGroup('abc123');
    expect(loaded).toBeUndefined();
  });

  it('returns empty array when no groups exist', async () => {
    const all = await loadAllGroups();
    expect(all).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Member score tests
// ---------------------------------------------------------------------------

describe('groupStorage — member scores', () => {
  it('returns empty array for unknown group', async () => {
    const scores = await loadMemberScores('unknown-group');
    expect(scores).toEqual([]);
  });

  it('saves and loads member scores', async () => {
    const scores: MemberScore[] = [
      {
        pubkeyHex: 'pubkey1hex',
        nickname: 'Alice',
        scores: { 'bio-101': sampleScore },
        lastSeq: 1,
      },
    ];
    await saveMemberScores('group1', scores);
    const loaded = await loadMemberScores('group1');
    expect(loaded).toEqual(scores);
  });

  it('merges a new member score (first entry)', async () => {
    await mergeMemberScore('group1', 'pubkey1', 'Alice', sampleScore);
    const scores = await loadMemberScores('group1');
    expect(scores).toHaveLength(1);
    expect(scores[0].pubkeyHex).toBe('pubkey1');
    expect(scores[0].scores['biology-101']).toEqual(sampleScore);
  });

  it('merges a score update (higher seq wins)', async () => {
    await mergeMemberScore('group1', 'pubkey1', 'Alice', sampleScore);

    const updatedScore: ScoreUpdate = {
      ...sampleScore,
      quizPoints: 15,
      sequenceNumber: 2, // newer
    };
    await mergeMemberScore('group1', 'pubkey1', 'Alice', updatedScore);

    const scores = await loadMemberScores('group1');
    expect(scores[0].scores['biology-101'].quizPoints).toBe(15);
    expect(scores[0].lastSeq).toBe(2);
  });

  it('ignores a score update with older sequence number', async () => {
    const newerScore: ScoreUpdate = { ...sampleScore, quizPoints: 20, sequenceNumber: 5 };
    await mergeMemberScore('group1', 'pubkey1', 'Alice', newerScore);

    const olderScore: ScoreUpdate = { ...sampleScore, quizPoints: 5, sequenceNumber: 2 };
    await mergeMemberScore('group1', 'pubkey1', 'Alice', olderScore);

    const scores = await loadMemberScores('group1');
    // Newer score should remain
    expect(scores[0].scores['biology-101'].quizPoints).toBe(20);
  });

  it('adds a second member without affecting the first', async () => {
    await mergeMemberScore('group1', 'pubkey1', 'Alice', sampleScore);
    const score2: ScoreUpdate = { ...sampleScore, quizPoints: 8, sequenceNumber: 1 };
    await mergeMemberScore('group1', 'pubkey2', 'Bob', score2);

    const scores = await loadMemberScores('group1');
    expect(scores).toHaveLength(2);
  });

  it('clears member scores for a group', async () => {
    await mergeMemberScore('group1', 'pubkey1', 'Alice', sampleScore);
    await clearMemberScores('group1');
    const scores = await loadMemberScores('group1');
    expect(scores).toEqual([]);
  });
});
