/**
 * Regression tests for the kind-1059 gift-wrap inbound path.
 * Covers three scenarios mandated by the round-2 verifier audit:
 *
 *   1. Same-peer rumor → shouldIngestRumor returns true (ingest).
 *   2. Foreign-peer rumor → shouldIngestRumor returns false (drop).
 *   3. Cross-protocol dedup → appendMessage deduplicates by inner-rumor id,
 *      so the same message arriving via both kind-4 and kind-1059 appears once.
 *
 * appendMessage dedup is exercised via chatPersistence directly (no component
 * mount required) — the real IDB default store is replaced by an in-memory Map.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    writable: false,
    configurable: true,
  });
}

// ─── Inline idb-keyval mock (default store, Map-backed) ──────────────────────
const idbStore = new Map<string, unknown>();

vi.mock('idb-keyval', () => ({
  get: vi.fn(async (key: string) => idbStore.get(key) ?? undefined),
  set: vi.fn(async (key: string, value: unknown) => { idbStore.set(key, value); }),
  del: vi.fn(async (key: string) => { idbStore.delete(key); }),
  keys: vi.fn(async () => [...idbStore.keys()]),
  delMany: vi.fn(async (ks: string[]) => { ks.forEach((k) => idbStore.delete(k)); }),
}));

const { shouldIngestRumor, CHAT_MESSAGE_KIND } = await import('@/src/lib/directMessages');
const { appendMessage, loadMessages } = await import('@/src/lib/marmot/chatPersistence');
import type { UnsignedRumor } from '@/src/lib/directMessages';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRumor(pubkey: string, id: string, overrides?: Partial<UnsignedRumor>): UnsignedRumor {
  return {
    kind: CHAT_MESSAGE_KIND,
    content: '{"type":"text","text":"hello"}',
    tags: [],
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    id,
    ...overrides,
  };
}

const PEER_PUBKEY = 'a'.repeat(64);
const FOREIGN_PUBKEY = 'b'.repeat(64);
const SELF_PUBKEY = 'c'.repeat(64);

// ---------------------------------------------------------------------------
// Test: shouldIngestRumor — pure unit, no I/O
// ---------------------------------------------------------------------------

describe('shouldIngestRumor (thread isolation guard)', () => {
  it('returns true when inner rumor pubkey matches the conversation peer', () => {
    const rumor = makeRumor(PEER_PUBKEY, 'id-001');
    expect(shouldIngestRumor(rumor, PEER_PUBKEY)).toBe(true);
  });

  it('returns false when inner rumor pubkey is a different sender (foreign peer)', () => {
    const rumor = makeRumor(FOREIGN_PUBKEY, 'id-002');
    expect(shouldIngestRumor(rumor, PEER_PUBKEY)).toBe(false);
  });

  it('returns false when inner rumor pubkey is selfPubkey (self-addressed rumor from another conversation)', () => {
    // A gift wrap for self delivered to this thread should be dropped.
    const rumor = makeRumor(SELF_PUBKEY, 'id-003');
    expect(shouldIngestRumor(rumor, PEER_PUBKEY)).toBe(false);
  });

  it('is case-sensitive (pubkey comparison is exact hex string match)', () => {
    // Nostr pubkeys are always lower-case hex; validation guarantees this.
    const rumor = makeRumor(PEER_PUBKEY.toUpperCase(), 'id-004');
    expect(shouldIngestRumor(rumor, PEER_PUBKEY)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test: cross-protocol dedup via appendMessage
// ---------------------------------------------------------------------------

describe('cross-protocol dedup (kind-4 + kind-1059 same inner-rumor id)', () => {
  const THREAD_ID = 'dm:dedup-test-thread';

  beforeEach(() => {
    // Clear the in-memory IDB store before each test so appends don't bleed across.
    idbStore.clear();
  });

  it('appendMessage deduplicates by id — same id written twice appears once', async () => {
    const msg = {
      id: 'rumor-shared-id-00000000',
      content: 'hello from both paths',
      senderPubkey: PEER_PUBKEY,
      groupId: THREAD_ID,
      createdAt: Date.now(),
    };

    // Simulate kind-4 arrival
    await appendMessage(THREAD_ID, msg);
    // Simulate kind-1059 arrival for the same inner-rumor id
    await appendMessage(THREAD_ID, msg);

    const { messages: stored } = await loadMessages(THREAD_ID);
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe('rumor-shared-id-00000000');
  });

  it('two distinct message ids both appear (dedup is id-keyed, not content-keyed)', async () => {
    const msg1 = {
      id: 'rumor-id-alpha',
      content: 'first',
      senderPubkey: PEER_PUBKEY,
      groupId: THREAD_ID,
      createdAt: Date.now() - 1000,
    };
    const msg2 = {
      id: 'rumor-id-beta',
      content: 'second',
      senderPubkey: PEER_PUBKEY,
      groupId: THREAD_ID,
      createdAt: Date.now(),
    };

    await appendMessage(THREAD_ID, msg1);
    await appendMessage(THREAD_ID, msg2);

    const { messages: stored } = await loadMessages(THREAD_ID);
    expect(stored).toHaveLength(2);
    const ids = stored.map((m) => m.id);
    expect(ids).toContain('rumor-id-alpha');
    expect(ids).toContain('rumor-id-beta');
  });
});
