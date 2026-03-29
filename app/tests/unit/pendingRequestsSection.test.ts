import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the modules we'll test through
vi.mock('idb-keyval', () => ({
  createStore: vi.fn(),
  get: vi.fn(async () => undefined),
  set: vi.fn(async () => undefined),
  del: vi.fn(async () => undefined),
  entries: vi.fn(async () => []),
}));

// We test the approve/deny logic at the storage level since the component
// relies on MarmotContext which is difficult to unit test.

describe('pendingRequests approve/deny logic', () => {
  const mockRequest = {
    pubkeyHex: 'abc123',
    nonce: 'nonce-1',
    groupId: 'group-1',
    receivedAt: Date.now(),
    nickname: 'Alice',
    eventId: 'event-1',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletePendingJoinRequest calls del with eventId', async () => {
    const { del } = await import('idb-keyval');
    const { deletePendingJoinRequest } = await import('@/src/lib/marmot/joinRequestStorage');

    await deletePendingJoinRequest('event-1');
    expect(del).toHaveBeenCalledWith('event-1', undefined);
  });

  it('clearPendingJoinRequestsForGroup removes all for that group', async () => {
    const { entries, del } = await import('idb-keyval');
    (entries as any).mockResolvedValueOnce([
      ['event-1', { ...mockRequest }],
      ['event-2', { ...mockRequest, eventId: 'event-2', pubkeyHex: 'def456' }],
      ['event-3', { ...mockRequest, eventId: 'event-3', groupId: 'other-group' }],
    ]);

    const { clearPendingJoinRequestsForGroup } = await import('@/src/lib/marmot/joinRequestStorage');
    await clearPendingJoinRequestsForGroup('group-1');

    // Should delete event-1 and event-2 (group-1), not event-3 (other-group)
    expect(del).toHaveBeenCalledTimes(2);
    expect(del).toHaveBeenCalledWith('event-1', undefined);
    expect(del).toHaveBeenCalledWith('event-2', undefined);
  });

  it('loadPendingJoinRequests filters by groupId', async () => {
    const { entries } = await import('idb-keyval');
    (entries as any).mockResolvedValueOnce([
      ['event-1', { ...mockRequest }],
      ['event-2', { ...mockRequest, eventId: 'event-2', groupId: 'other-group' }],
    ]);

    const { loadPendingJoinRequests } = await import('@/src/lib/marmot/joinRequestStorage');
    const result = await loadPendingJoinRequests('group-1');

    expect(result).toHaveLength(1);
    expect(result[0].eventId).toBe('event-1');
  });

  it('pubkeyToNpub converts hex pubkey for invite', async () => {
    const { pubkeyToNpub } = await import('@/src/lib/nostrKeys');
    const npub = pubkeyToNpub('0000000000000000000000000000000000000000000000000000000000000001');
    expect(npub).toMatch(/^npub1/);
  });

  it('PendingJoinRequest type has required fields', async () => {
    // Type check: ensure the interface matches AC-8 requirements
    const request: import('@/src/lib/marmot/joinRequestStorage').PendingJoinRequest = {
      pubkeyHex: 'abc',
      nonce: 'n',
      groupId: 'g',
      receivedAt: 0,
      eventId: 'e',
    };
    expect(request.pubkeyHex).toBe('abc');
    expect(request.nickname).toBeUndefined();
  });

  it('markJoinRequestsRead is exported from unreadStore', async () => {
    const mod = await import('@/src/lib/unreadStore');
    expect(typeof mod.markJoinRequestsRead).toBe('function');
    // Approve/deny both call markJoinRequestsRead to decrement the bell —
    // counter arithmetic is verified in unreadStore.test.ts
  });

  it('truncateNpub shortens long npub strings', async () => {
    const { truncateNpub } = await import('@/src/lib/nostrKeys');
    const long = 'npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq';
    const truncated = truncateNpub(long);
    expect(truncated).toContain('...');
    expect(truncated.length).toBeLessThan(long.length);
  });
});
