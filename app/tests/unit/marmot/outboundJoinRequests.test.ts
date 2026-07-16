import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { OutboundJoinRequestRecord } from '@/src/lib/marmot/outboundJoinRequests';

// Mock idb-keyval — in-memory store (mirrors inviteLinkStorage.test.ts).
const store = new Map<string, unknown>();
vi.mock('idb-keyval', () => ({
  createStore: vi.fn(() => 'mock-store'),
  get: vi.fn(async (key: string) => store.get(key) ?? undefined),
  set: vi.fn(async (key: string, value: unknown) => { store.set(key, value); }),
  del: vi.fn(async (key: string) => { store.delete(key); }),
  keys: vi.fn(async () => [...store.keys()]),
  entries: vi.fn(async () => [...store.entries()]),
  clear: vi.fn(async () => { store.clear(); }),
}));

const {
  createOutboundJoinRequestStore,
  saveOutboundJoinRequest,
  loadUnexpiredOutboundJoinRequestsForAdmin,
  deleteOutboundJoinRequest,
  clearAllOutboundJoinRequests,
  OUTBOUND_JOIN_REQUEST_CAP,
  OUTBOUND_JOIN_REQUEST_TTL_MS,
} = await import('@/src/lib/marmot/outboundJoinRequests');

function makeRecord(overrides: Partial<OutboundJoinRequestRecord> = {}): OutboundJoinRequestRecord {
  return {
    nonce: 'nonce-1',
    adminPubkeyHex: 'admin-pubkey-hex',
    groupName: 'Test Group',
    sentAt: Date.now(),
    ...overrides,
  };
}

describe('outboundJoinRequests', () => {
  beforeEach(() => {
    store.clear();
  });

  describe('createOutboundJoinRequestStore', () => {
    it('returns a store reference', () => {
      expect(createOutboundJoinRequestStore()).toBe('mock-store');
    });
  });

  describe('saveOutboundJoinRequest / loadUnexpiredOutboundJoinRequestsForAdmin', () => {
    it('persists a record keyed by nonce', async () => {
      const record = makeRecord();
      await saveOutboundJoinRequest(record);
      expect(store.has(record.nonce)).toBe(true);
      expect(store.get(record.nonce)).toEqual(record);
    });

    it('returns records for the matching admin only', async () => {
      await saveOutboundJoinRequest(makeRecord({ nonce: 'n1', adminPubkeyHex: 'admin-A' }));
      await saveOutboundJoinRequest(makeRecord({ nonce: 'n2', adminPubkeyHex: 'admin-B' }));
      await saveOutboundJoinRequest(makeRecord({ nonce: 'n3', adminPubkeyHex: 'admin-A' }));

      const result = await loadUnexpiredOutboundJoinRequestsForAdmin('admin-A');
      expect(result).toHaveLength(2);
      expect(result.map((r) => r.nonce).sort()).toEqual(['n1', 'n3']);
    });

    it('returns an empty array when no record exists for the admin', async () => {
      const result = await loadUnexpiredOutboundJoinRequestsForAdmin('unknown-admin');
      expect(result).toEqual([]);
    });

    // ── AC-AUTO-6: TTL ──────────────────────────────────────────────────────

    it('excludes an expired record (older than the TTL) from correlation', async () => {
      const expired = makeRecord({
        nonce: 'expired-1',
        adminPubkeyHex: 'admin-ttl',
        sentAt: Date.now() - OUTBOUND_JOIN_REQUEST_TTL_MS - 1000,
      });
      await saveOutboundJoinRequest(expired);

      const result = await loadUnexpiredOutboundJoinRequestsForAdmin('admin-ttl');
      expect(result).toEqual([]);
    });

    it('includes a record sent just under the TTL boundary', async () => {
      const fresh = makeRecord({
        nonce: 'fresh-1',
        adminPubkeyHex: 'admin-ttl-2',
        sentAt: Date.now() - (OUTBOUND_JOIN_REQUEST_TTL_MS - 1000),
      });
      await saveOutboundJoinRequest(fresh);

      const result = await loadUnexpiredOutboundJoinRequestsForAdmin('admin-ttl-2');
      expect(result).toHaveLength(1);
      expect(result[0].nonce).toBe('fresh-1');
    });

    it('enforces a TTL floor of at least 7 days', () => {
      expect(OUTBOUND_JOIN_REQUEST_TTL_MS).toBeGreaterThanOrEqual(7 * 24 * 60 * 60 * 1000);
    });

    // ── AC-AUTO-6: 256-record global cap ────────────────────────────────────

    it('evicts the single oldest record once the store is at the 256-record cap', async () => {
      for (let i = 0; i < OUTBOUND_JOIN_REQUEST_CAP; i++) {
        await saveOutboundJoinRequest(
          makeRecord({ nonce: `n${i}`, adminPubkeyHex: `admin-${i}`, sentAt: 1000 + i }),
        );
      }
      expect(store.size).toBe(OUTBOUND_JOIN_REQUEST_CAP);

      // One more record over the cap must evict exactly the oldest (n0, sentAt: 1000).
      await saveOutboundJoinRequest(
        makeRecord({ nonce: 'n-overflow', adminPubkeyHex: 'admin-overflow', sentAt: 999_999 }),
      );

      expect(store.size).toBe(OUTBOUND_JOIN_REQUEST_CAP);
      expect(store.has('n0')).toBe(false);
      expect(store.has('n-overflow')).toBe(true);
      expect(store.has('n1')).toBe(true);
    });
  });

  describe('deleteOutboundJoinRequest', () => {
    it('removes only the specified record — sibling records survive (AC-AUTO-5)', async () => {
      await saveOutboundJoinRequest(makeRecord({ nonce: 'sibling-1', adminPubkeyHex: 'admin-X', groupName: 'Group A' }));
      await saveOutboundJoinRequest(makeRecord({ nonce: 'sibling-2', adminPubkeyHex: 'admin-X', groupName: 'Group B' }));

      await deleteOutboundJoinRequest('sibling-1');

      const remaining = await loadUnexpiredOutboundJoinRequestsForAdmin('admin-X');
      expect(remaining).toHaveLength(1);
      expect(remaining[0].nonce).toBe('sibling-2');
    });

    it('is a no-op for a non-existent nonce', async () => {
      await expect(deleteOutboundJoinRequest('nonexistent')).resolves.toBeUndefined();
    });
  });

  describe('clearAllOutboundJoinRequests', () => {
    it('drops every stored record', async () => {
      await saveOutboundJoinRequest(makeRecord({ nonce: 'a' }));
      await saveOutboundJoinRequest(makeRecord({ nonce: 'b' }));
      await clearAllOutboundJoinRequests();
      expect(store.size).toBe(0);
    });
  });
});
