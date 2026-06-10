import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  loadAllGroups,
  saveGroup,
  loadGroup,
  deleteGroup,
} from '@/src/lib/marmot/groupStorage';
import type { Group } from '@/src/types';

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
