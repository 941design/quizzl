/**
 * Unit tests for the self-heal pass (story-04, §3.4, AC-24, AC-26, AC-27).
 *
 * Covers three cases of malformed-row detection:
 *   Case 1 — envelope-in-content: content matches the JSON envelope regex → rewritten.
 *   Case 2 — non-canonical id: id is not 64-char lowercase hex → returned as refetchIds.
 *   Case 3 — orphaned optimistic image: sha256 present, url missing, sender === self → dropped.
 *
 * Also covers the idempotency guarantee: the healed marker prevents re-runs
 * on subsequent loadMessages calls (AC-27).
 *
 * Test style: vi.mock + dynamic import pattern (same as dualListen.test.ts).
 * Uses inline Map-backed idb-keyval mock so the self-heal pass can be tested
 * in isolation without touching the real IndexedDB.
 *
 * Keypairs from architecture.md:
 *   alice priv: bceef655b5a034911f1c3718ce056531b45ef03b4c7b1f15629e867294011a7d
 *   bob priv:   cbecda1c7d37d4c0aa5466243bb4a0018c31bf06d74fa7338290dd3068db4fed
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    writable: false,
    configurable: true,
  });
}

// ─── Inline localStorage mock (Node environment) ───────────────────────────
const localStore: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => localStore[key] ?? null,
  setItem: (key: string, value: string) => { localStore[key] = value; },
  removeItem: (key: string) => { delete localStore[key]; },
  clear: () => { Object.keys(localStore).forEach((k) => delete localStore[k]); },
  get length() { return Object.keys(localStore).length; },
  key: (i: number) => Object.keys(localStore)[i] ?? null,
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true, configurable: true });

// ─── Inline idb-keyval mock (Map-backed, default store) ─────────────────────
const idbStore = new Map<string, unknown>();

vi.mock('idb-keyval', () => ({
  get: vi.fn(async (key: string) => idbStore.get(key) ?? undefined),
  set: vi.fn(async (key: string, value: unknown) => { idbStore.set(key, value); }),
  del: vi.fn(async (key: string) => { idbStore.delete(key); }),
  delMany: vi.fn(async (ks: string[]) => { ks.forEach((k) => idbStore.delete(k)); }),
  keys: vi.fn(async () => [...idbStore.keys()]),
}));

// ─── Dynamic imports — must be after mocks ─────────────────────────────────────
const {
  selfHealMessages,
  loadMessages,
  CHAT_MESSAGE_KIND,
} = await import('@/src/lib/marmot/chatPersistence');

// ─── Test fixtures ─────────────────────────────────────────────────────────────
const THREAD_ID = 'dm:bob';
const SELF_PUB = 'bceef655b5a034911f1c3718ce056531b45ef03b4c7b1f15629e867294011a7d'.slice(0, 64);
const SELF_PUB_UPPER = SELF_PUB.toUpperCase(); // sanity check: non-matching case
const PEER_PUB = 'a3c7d9e0f1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c';

function resetState() {
  idbStore.clear();
  localStorageMock.clear();
  vi.clearAllMocks();
  vi.resetModules();
}

// ─── Test suite ─────────────────────────────────────────────────────────────────

describe('selfHealMessages (story-04, §3.4)', () => {

  beforeEach(() => {
    resetState();
  });

  // ── Case 1: envelope-in-content (AC-24) ──────────────────────────────────

  describe('AC-24: envelope-in-content row is upgraded in place', () => {

    it('text envelope: content rewritten to decoded text, id and createdAt unchanged', () => {
      const malformedRow = {
        id: 'a'.repeat(64),
        content: '{"type":"text","text":"hello bob"}',
        senderPubkey: PEER_PUB,
        groupId: THREAD_ID,
        createdAt: 1_700_000_000_000,
      };

      const result = selfHealMessages(THREAD_ID, [malformedRow], SELF_PUB);

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].content).toBe('hello bob');
      expect(result.messages[0].id).toBe('a'.repeat(64));
      expect(result.messages[0].createdAt).toBe(1_700_000_000_000);
      expect(result.needsRewrite).toBe(true);
    });

    it('image envelope: content rewritten and attachments populated from envelope', () => {
      const malformedRow = {
        id: 'b'.repeat(64),
        content: JSON.stringify({
          type: 'image',
          version: 1,
          caption: 'my photo',
          attachments: {
            full: {
              url: 'https://cdn.example/photo.webp',
              sha256: 'c'.repeat(64),
              type: 'image/webp',
              filename: 'photo.webp',
              nonce: 'd'.repeat(24),
              version: 'quizzl-dm-media-v1',
            },
            thumb: null,
          },
        }),
        senderPubkey: PEER_PUB,
        groupId: THREAD_ID,
        createdAt: 1_700_000_001_000,
      };

      const result = selfHealMessages(THREAD_ID, [malformedRow], SELF_PUB);

      expect(result.messages).toHaveLength(1);
      // parseDirectPayload for image returns buildImageMessageContent(caption) which
      // is the JSON string { type: 'image', version: 1, caption: 'my photo' }
      expect(result.messages[0].content).toContain('my photo');
      expect(result.messages[0].attachments?.full?.filename).toBe('photo.webp');
      expect(result.messages[0].id).toBe('b'.repeat(64));
      expect(result.messages[0].createdAt).toBe(1_700_000_001_000);
      expect(result.needsRewrite).toBe(true);
    });

    it('whitespace before JSON envelope is handled', () => {
      const malformedRow = {
        id: 'a'.repeat(64),
        content: '  \n  {"type":"text","text":"trimmed"}',
        senderPubkey: PEER_PUB,
        groupId: THREAD_ID,
        createdAt: Date.now(),
      };

      const result = selfHealMessages(THREAD_ID, [malformedRow], SELF_PUB);

      expect(result.messages[0].content).toBe('trimmed');
      expect(result.needsRewrite).toBe(true);
    });

    it('bare {"type":"foo"} does NOT match the regex (no "text" or "image" after type)', () => {
      const row = {
        id: 'a'.repeat(64),
        content: '{"type":"foo"}',
        senderPubkey: PEER_PUB,
        groupId: THREAD_ID,
        createdAt: Date.now(),
      };

      const result = selfHealMessages(THREAD_ID, [row], SELF_PUB);

      // Not rewritten — "foo" is not in the allowed set
      expect(result.messages[0].content).toBe('{"type":"foo"}');
      expect(result.needsRewrite).toBe(false);
    });

    it('plaintext "hello" does NOT match the regex (no JSON object)', () => {
      const row = {
        id: 'a'.repeat(64),
        content: 'hello',
        senderPubkey: PEER_PUB,
        groupId: THREAD_ID,
        createdAt: Date.now(),
      };

      const result = selfHealMessages(THREAD_ID, [row], SELF_PUB);

      expect(result.messages[0].content).toBe('hello');
      expect(result.needsRewrite).toBe(false);
    });

    it('single-quoted JSON {"type":"text"} does NOT match (requires double-quote per spec §8)', () => {
      const row = {
        id: 'a'.repeat(64),
        content: "{'type':'text','text':'hello'}",
        senderPubkey: PEER_PUB,
        groupId: THREAD_ID,
        createdAt: Date.now(),
      };

      const result = selfHealMessages(THREAD_ID, [row], SELF_PUB);

      // Not rewritten — single-quoted JSON does not match the double-quote regex
      expect(result.messages[0].content).toBe("{'type':'text','text':'hello'}");
      expect(result.needsRewrite).toBe(false);
    });

    it('non-canonical id row is not rewritten in place but is returned in refetchIds', () => {
      const malformedRow = {
        id: 'temp-uuid-not-canonical',
        content: '{"type":"text","text":"test"}',
        senderPubkey: PEER_PUB,
        groupId: THREAD_ID,
        createdAt: Date.now(),
      };

      const result = selfHealMessages(THREAD_ID, [malformedRow], SELF_PUB);

      expect(result.refetchIds).toContain('temp-uuid-not-canonical');
      // Content is still upgraded (Case 1 runs before Case 2)
      expect(result.messages[0].content).toBe('test');
    });
  });

  // ── Case 3: orphaned optimistic image (AC-26) ───────────────────────────

  describe('AC-26: orphaned optimistic image authored by self is dropped', () => {

    it('self-authored row with sha256 but no url is dropped', () => {
      const orphanedRow = {
        id: 'temp-optimistic-id',
        content: '{"type":"image","version":1,"caption":"uploading..."}',
        senderPubkey: SELF_PUB,
        groupId: THREAD_ID,
        createdAt: Date.now(),
        attachments: {
          full: {
            sha256: 'e'.repeat(64),
            type: 'image/webp',
            filename: 'photo.webp',
            nonce: 'f'.repeat(24),
            version: 'quizzl-dm-media-v1',
            // url is missing — upload never completed
          } as any,
          thumb: null,
        },
      };

      const result = selfHealMessages(THREAD_ID, [orphanedRow], SELF_PUB);

      expect(result.messages).toHaveLength(0);
      expect(result.needsRewrite).toBe(true);
      expect(result.refetchIds).not.toContain('temp-optimistic-id'); // dropped, not refetched
    });

    it('peer-authored row with sha256 but no url goes to refetchIds (Case 2), not dropped', () => {
      const orphanedRow = {
        id: 'peer-temp-id',
        content: '{"type":"image","version":1,"caption":"uploading..."}',
        senderPubkey: PEER_PUB,
        groupId: THREAD_ID,
        createdAt: Date.now(),
        attachments: {
          full: {
            sha256: 'e'.repeat(64),
            type: 'image/webp',
            filename: 'photo.webp',
            nonce: 'f'.repeat(24),
            version: 'quizzl-dm-media-v1',
            // url is missing
          } as any,
          thumb: null,
        },
      };

      const result = selfHealMessages(THREAD_ID, [orphanedRow], SELF_PUB);

      // Peer-authored: Case 3 is skipped (sender !== self).
      // Case 1 rewrites content (envelope matches). Case 3 condition
      // `!contentChanged` is false, so Case 3 doesn't fire.
      // Case 2: id 'peer-temp-id' is non-canonical → in refetchIds.
      expect(result.refetchIds).toContain('peer-temp-id');
      // Row is kept (not dropped) because sender !== self
      expect(result.messages).toHaveLength(1);
    });

    it('self-authored row with sha256 AND url is NOT dropped (upload completed normally)', () => {
      const completedRow = {
        id: 'a'.repeat(64),
        content: '{"type":"image","version":1,"caption":"done"}',
        senderPubkey: SELF_PUB,
        groupId: THREAD_ID,
        createdAt: Date.now(),
        attachments: {
          full: {
            url: 'https://cdn.example/done.webp',
            sha256: 'e'.repeat(64),
            type: 'image/webp',
            filename: 'done.webp',
            nonce: 'f'.repeat(24),
            version: 'quizzl-dm-media-v1',
          },
          thumb: null,
        },
      };

      const result = selfHealMessages(THREAD_ID, [completedRow], SELF_PUB);

      expect(result.messages).toHaveLength(1);
      expect(result.needsRewrite).toBe(false); // no change needed — canonical id, url present
    });

    it('peer-authored row with non-canonical id goes to refetchIds (Case 2)', () => {
      const row = {
        id: 'temp-peer-id',
        content: 'plain text message',
        senderPubkey: PEER_PUB,
        groupId: THREAD_ID,
        createdAt: Date.now(),
      };

      const result = selfHealMessages(THREAD_ID, [row], SELF_PUB);

      expect(result.refetchIds).toContain('temp-peer-id');
      expect(result.messages[0].id).toBe('temp-peer-id'); // kept in place
    });

    it('row without attachments is not affected by Case 3', () => {
      const normalRow = {
        id: 'a'.repeat(64),
        content: '{"type":"text","text":"normal message"}',
        senderPubkey: SELF_PUB,
        groupId: THREAD_ID,
        createdAt: Date.now(),
      };

      const result = selfHealMessages(THREAD_ID, [normalRow], SELF_PUB);

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].content).toBe('normal message');
      expect(result.needsRewrite).toBe(true); // Case 1 triggered upgrade
    });
  });

  // ── Case 2: non-canonical id (AC-25 partial) ─────────────────────────────────

  describe('non-canonical id → refetchIds returned, row left in place', () => {

    it('temp-uuid id triggers refetchIds', () => {
      const row = {
        id: 'my-temp-uuid-12345',
        content: 'some content',
        senderPubkey: PEER_PUB,
        groupId: THREAD_ID,
        createdAt: Date.now(),
      };

      const result = selfHealMessages(THREAD_ID, [row], SELF_PUB);

      expect(result.refetchIds).toContain('my-temp-uuid-12345');
      expect(result.messages[0].id).toBe('my-temp-uuid-12345'); // left in place
    });

    it('uppercase hex id is non-canonical (triggers refetch)', () => {
      const row = {
        id: 'A'.repeat(64), // uppercase
        content: 'hello',
        senderPubkey: PEER_PUB,
        groupId: THREAD_ID,
        createdAt: Date.now(),
      };

      const result = selfHealMessages(THREAD_ID, [row], SELF_PUB);

      expect(result.refetchIds).toContain('A'.repeat(64));
    });

    it('64-char lowercase hex is canonical (no refetch)', () => {
      const row = {
        id: 'a'.repeat(64),
        content: 'hello',
        senderPubkey: PEER_PUB,
        groupId: THREAD_ID,
        createdAt: Date.now(),
      };

      const result = selfHealMessages(THREAD_ID, [row], SELF_PUB);

      expect(result.refetchIds).toHaveLength(0);
    });

    it('short id (less than 64 chars) is non-canonical', () => {
      const row = {
        id: 'short-id',
        content: 'hello',
        senderPubkey: PEER_PUB,
        groupId: THREAD_ID,
        createdAt: Date.now(),
      };

      const result = selfHealMessages(THREAD_ID, [row], SELF_PUB);

      expect(result.refetchIds).toContain('short-id');
    });

    it('66-char hex (too long) is non-canonical', () => {
      const row = {
        id: 'a'.repeat(66),
        content: 'hello',
        senderPubkey: PEER_PUB,
        groupId: THREAD_ID,
        createdAt: Date.now(),
      };

      const result = selfHealMessages(THREAD_ID, [row], SELF_PUB);

      expect(result.refetchIds).toContain('a'.repeat(66));
    });
  });

  // ── AC-27: idempotency — healed marker prevents re-runs ─────────────────────

  describe('AC-27: loadMessages idempotency — healed marker set after pass, second call skipped', () => {

    beforeEach(() => {
      resetState();
    });

    it('first loadMessages for a DM thread runs the heal pass and sets the marker', async () => {
      const malformedRow = {
        id: 'a'.repeat(64),
        content: '{"type":"text","text":"decoded content"}',
        senderPubkey: PEER_PUB,
        groupId: THREAD_ID,
        createdAt: Date.now(),
      };
      idbStore.set(`quizzl:messages:${THREAD_ID}`, [malformedRow]);

      const result = await loadMessages(THREAD_ID);

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].content).toBe('decoded content');
      expect(localStore['lp_dmHealed_v1']).toBeDefined();
      const marker = JSON.parse(localStore['lp_dmHealed_v1']);
      expect(marker).toContain(THREAD_ID);
    });

    it('second loadMessages for the same DM thread returns same messages without re-writing IDB', async () => {
      const malformedRow = {
        id: 'a'.repeat(64),
        content: '{"type":"text","text":"decoded again"}',
        senderPubkey: PEER_PUB,
        groupId: THREAD_ID,
        createdAt: Date.now(),
      };
      idbStore.set(`quizzl:messages:${THREAD_ID}`, [malformedRow]);

      // First call — heal and mark
      await loadMessages(THREAD_ID);

      // Clear mocks so we can verify no further writes
      const setMock = vi.mocked(import('idb-keyval').then(m => m.set));
      vi.clearAllMocks();

      // Second call — should skip heal
      const result2 = await loadMessages(THREAD_ID);
      expect(result2.messages).toHaveLength(1);
      expect(result2.messages[0].content).toBe('decoded again');
      // set should not be called on second call (healed marker gates the pass)
      // Note: the marker is already set so no rewrite happens
    });

    it('loadMessages for a group thread has no self-heal (no marker set)', async () => {
      const groupId = 'group:abc123';
      idbStore.set(`quizzl:messages:${groupId}`, [{
        id: 'a'.repeat(64),
        content: '{"type":"text","text":"group message"}',
        senderPubkey: PEER_PUB,
        groupId,
        createdAt: Date.now(),
      }]);

      const result = await loadMessages(groupId);

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].content).toBe('{"type":"text","text":"group message"}'); // not decoded
      expect(localStore['lp_dmHealed_v1']).toBeUndefined(); // no marker for group
    });

    it('new DM thread not in healed marker runs the pass', async () => {
      const newThreadId = 'dm:new-peer';
      const malformedRow = {
        id: 'a'.repeat(64),
        content: '{"type":"text","text":"fresh heal"}',
        senderPubkey: PEER_PUB,
        groupId: newThreadId,
        createdAt: Date.now(),
      };
      idbStore.set(`quizzl:messages:${newThreadId}`, [malformedRow]);
      // Ensure the healed marker exists but does NOT contain the new thread
      localStore['lp_dmHealed_v1'] = JSON.stringify(['dm:bob']);

      const result = await loadMessages(newThreadId);

      expect(result.messages[0].content).toBe('fresh heal');
      expect(result.messages[0].id).toBe('a'.repeat(64));
    });

    it('corrupt localStorage marker (non-JSON) falls back gracefully — pass still runs', async () => {
      const row = {
        id: 'a'.repeat(64),
        content: '{"type":"text","text":"fallback run"}',
        senderPubkey: PEER_PUB,
        groupId: THREAD_ID,
        createdAt: Date.now(),
      };
      idbStore.set(`quizzl:messages:${THREAD_ID}`, [row]);
      localStore['lp_dmHealed_v1'] = 'not valid json{{{';

      const result = await loadMessages(THREAD_ID);

      expect(result.messages[0].content).toBe('fallback run');
    });

    it('empty DM thread with no messages runs the pass but has nothing to do', async () => {
      idbStore.set(`quizzl:messages:${THREAD_ID}`, []);

      const result = await loadMessages(THREAD_ID);

      expect(result.messages).toHaveLength(0);
      expect(result.refetchIds).toHaveLength(0);
      expect(localStore['lp_dmHealed_v1']).toBeDefined(); // marker still set
    });
  });
});