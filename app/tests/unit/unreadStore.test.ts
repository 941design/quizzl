import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock localStorage
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => { store[key] = value; },
  removeItem: (key: string) => { delete store[key]; },
  clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
  get length() { return Object.keys(store).length; },
  key: (i: number) => Object.keys(store)[i] ?? null,
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

// Mock idb-keyval
vi.mock('idb-keyval', () => ({
  get: vi.fn(async () => undefined),
}));

// Mock react — useSyncExternalStore just calls getSnapshot
vi.mock('react', () => ({
  useSyncExternalStore: (subscribe: any, getSnapshot: any) => getSnapshot(),
}));

beforeEach(() => {
  localStorageMock.clear();
});

describe('unreadStore join request counters', () => {
  // We import once — module state persists across tests in same describe,
  // but that's fine since we test incremental behavior.
  // For isolation we test sequences within individual tests.

  it('incrementJoinRequest increases counter for a group', async () => {
    const {
      incrementJoinRequest,
      markJoinRequestsRead,
      clearJoinRequestGroup,
      useUnreadCounts,
    } = await import('@/src/lib/unreadStore');

    // Reset any prior state by clearing
    clearJoinRequestGroup('group-a');
    clearJoinRequestGroup('group-b');

    incrementJoinRequest('group-a');
    const s1 = useUnreadCounts();
    expect(s1.joinRequests['group-a']).toBe(1);

    incrementJoinRequest('group-a');
    const s2 = useUnreadCounts();
    expect(s2.joinRequests['group-a']).toBe(2);

    incrementJoinRequest('group-b');
    const s3 = useUnreadCounts();
    expect(s3.joinRequests['group-b']).toBe(1);
    expect(s3.joinRequests['group-a']).toBe(2);
  });

  it('markJoinRequestsRead resets counter to 0', async () => {
    const {
      incrementJoinRequest,
      markJoinRequestsRead,
      clearJoinRequestGroup,
      useUnreadCounts,
    } = await import('@/src/lib/unreadStore');

    clearJoinRequestGroup('group-c');
    incrementJoinRequest('group-c');
    incrementJoinRequest('group-c');
    incrementJoinRequest('group-c');

    markJoinRequestsRead('group-c');
    const s = useUnreadCounts();
    expect(s.joinRequests['group-c']).toBeUndefined();
  });

  it('clearJoinRequestGroup removes tracking', async () => {
    const {
      incrementJoinRequest,
      clearJoinRequestGroup,
      useUnreadCounts,
    } = await import('@/src/lib/unreadStore');

    clearJoinRequestGroup('group-d');
    incrementJoinRequest('group-d');
    incrementJoinRequest('group-d');

    clearJoinRequestGroup('group-d');
    const s = useUnreadCounts();
    expect(s.joinRequests['group-d']).toBeUndefined();
  });

  it('markJoinRequestsRead is a no-op for unknown group', async () => {
    const { markJoinRequestsRead, useUnreadCounts } = await import('@/src/lib/unreadStore');
    // Should not throw
    markJoinRequestsRead('nonexistent');
    const s = useUnreadCounts();
    expect(s.joinRequests['nonexistent']).toBeUndefined();
  });

  it('totalUnread sums both counts and joinRequests', async () => {
    const {
      incrementUnread,
      incrementJoinRequest,
      markAsRead,
      clearJoinRequestGroup,
      useUnreadCounts,
    } = await import('@/src/lib/unreadStore');

    // Clear prior state
    markAsRead('group-e');
    markAsRead('group-f');
    clearJoinRequestGroup('group-e');
    clearJoinRequestGroup('group-f');

    incrementUnread('group-e');
    incrementUnread('group-e');
    incrementJoinRequest('group-f');

    const s = useUnreadCounts();
    // 2 unread messages + 1 join request = 3
    expect(s.totalUnread).toBeGreaterThanOrEqual(3);
    expect(s.counts['group-e']).toBe(2);
    expect(s.joinRequests['group-f']).toBe(1);
  });

  it('useUnreadCounts returns joinRequests field', async () => {
    const { useUnreadCounts } = await import('@/src/lib/unreadStore');
    const s = useUnreadCounts();
    expect(s).toHaveProperty('joinRequests');
    expect(typeof s.joinRequests).toBe('object');
  });

  it('exports all join request functions for test bridge', async () => {
    // The window.__quizzlUnread bridge is set at module load time only when
    // typeof window !== 'undefined'. In Vitest (no jsdom), window is undefined.
    // Instead we verify the functions are exported — the bridge just
    // re-exports these same references.
    const mod = await import('@/src/lib/unreadStore');
    expect(typeof mod.incrementJoinRequest).toBe('function');
    expect(typeof mod.markJoinRequestsRead).toBe('function');
    expect(typeof mod.clearJoinRequestGroup).toBe('function');
  });

  it('join request operations do not affect message counts', async () => {
    const {
      incrementUnread,
      incrementJoinRequest,
      clearJoinRequestGroup,
      markAsRead,
      useUnreadCounts,
    } = await import('@/src/lib/unreadStore');

    // Set up known state
    markAsRead('group-g');
    clearJoinRequestGroup('group-g');

    incrementUnread('group-g');
    incrementUnread('group-g');
    incrementJoinRequest('group-g');

    const s1 = useUnreadCounts();
    expect(s1.counts['group-g']).toBe(2);
    expect(s1.joinRequests['group-g']).toBe(1);

    // Clear join requests — counts should remain
    clearJoinRequestGroup('group-g');
    const s2 = useUnreadCounts();
    expect(s2.counts['group-g']).toBe(2);
    expect(s2.joinRequests['group-g']).toBeUndefined();
  });
});

describe('unreadStore direct-message counters', () => {
  const PEER_A = 'aa'.repeat(32);
  const PEER_B = 'bb'.repeat(32);

  it('incrementDirectMessage tracks per-peer counts and feeds totalUnread', async () => {
    const {
      incrementDirectMessage,
      clearDirectMessageContact,
      useUnreadCounts,
    } = await import('@/src/lib/unreadStore');

    clearDirectMessageContact(PEER_A);
    clearDirectMessageContact(PEER_B);

    incrementDirectMessage(PEER_A);
    incrementDirectMessage(PEER_A);
    incrementDirectMessage(PEER_B);

    const s = useUnreadCounts();
    expect(s.directMessages[PEER_A]).toBe(2);
    expect(s.directMessages[PEER_B]).toBe(1);
    // 3 DMs counted in totalUnread
    expect(s.totalUnread).toBeGreaterThanOrEqual(3);
  });

  it('peer pubkey is normalised to lowercase', async () => {
    const {
      incrementDirectMessage,
      clearDirectMessageContact,
      useUnreadCounts,
    } = await import('@/src/lib/unreadStore');

    const mixed = 'AbCdEf' + '00'.repeat(29);
    clearDirectMessageContact(mixed);

    incrementDirectMessage(mixed);
    incrementDirectMessage(mixed.toLowerCase());

    const s = useUnreadCounts();
    expect(s.directMessages[mixed.toLowerCase()]).toBe(2);
    // The mixed-case key should not also exist
    expect(s.directMessages[mixed]).toBeUndefined();
  });

  it('markDirectMessagesRead resets the counter and persists timestamp', async () => {
    const {
      incrementDirectMessage,
      markDirectMessagesRead,
      getDirectMessageLastReadAt,
      clearDirectMessageContact,
      useUnreadCounts,
    } = await import('@/src/lib/unreadStore');

    const PEER = 'cc'.repeat(32);
    clearDirectMessageContact(PEER);

    incrementDirectMessage(PEER);
    incrementDirectMessage(PEER);
    expect(useUnreadCounts().directMessages[PEER]).toBe(2);

    markDirectMessagesRead(PEER);
    const after = useUnreadCounts();
    expect(after.directMessages[PEER]).toBeUndefined();
    expect(getDirectMessageLastReadAt(PEER)).toBeGreaterThan(0);
  });

  it('clearDirectMessageContact removes both count and last-read timestamp', async () => {
    const {
      incrementDirectMessage,
      markDirectMessagesRead,
      clearDirectMessageContact,
      getDirectMessageLastReadAt,
      useUnreadCounts,
    } = await import('@/src/lib/unreadStore');

    const PEER = 'dd'.repeat(32);
    incrementDirectMessage(PEER);
    markDirectMessagesRead(PEER);
    expect(getDirectMessageLastReadAt(PEER)).toBeGreaterThan(0);

    clearDirectMessageContact(PEER);
    expect(useUnreadCounts().directMessages[PEER]).toBeUndefined();
    expect(getDirectMessageLastReadAt(PEER)).toBe(0);
  });

  it('exports DM functions for the test bridge', async () => {
    const mod = await import('@/src/lib/unreadStore');
    expect(typeof mod.incrementDirectMessage).toBe('function');
    expect(typeof mod.markDirectMessagesRead).toBe('function');
    expect(typeof mod.clearDirectMessageContact).toBe('function');
    expect(typeof mod.getDirectMessageLastReadAt).toBe('function');
    expect(typeof mod.initDirectMessageCounts).toBe('function');
  });
});
