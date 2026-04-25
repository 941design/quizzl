import { describe, it, expect, beforeEach, vi } from 'vitest';

// Inline idb-keyval mock — Map-backed, keyed per named store
const stores = new Map<string, Map<string, unknown>>();

function getOrCreateStore(storeName: string): Map<string, unknown> {
  if (!stores.has(storeName)) stores.set(storeName, new Map());
  return stores.get(storeName)!;
}

// Each createStore call returns an opaque token (the store name string).
// The get/set/del/keys/clear functions dispatch on that token.
vi.mock('idb-keyval', () => ({
  createStore: vi.fn((dbName: string, storeName: string) => `${dbName}::${storeName}`),
  get: vi.fn(async (key: string, store: string) => getOrCreateStore(store).get(key) ?? undefined),
  set: vi.fn(async (key: string, value: unknown, store: string) => {
    getOrCreateStore(store).set(key, value);
  }),
  del: vi.fn(async (key: string, store: string) => {
    getOrCreateStore(store).delete(key);
  }),
  keys: vi.fn(async (store: string) => Array.from(getOrCreateStore(store).keys())),
  clear: vi.fn(async (store: string) => {
    getOrCreateStore(store).clear();
  }),
}));

const {
  setBlob,
  getBlob,
  deleteBlob,
  addMessageRef,
  removeMessageRef,
  getMessageRefs,
  clearGroupMedia,
} = await import('@/src/lib/marmot/mediaPersistence');

function makeEntry(type = 'image/webp') {
  return { bytes: new Uint8Array([1, 2, 3]), type };
}

describe('mediaPersistence', () => {
  beforeEach(() => {
    stores.clear();
  });

  describe('setBlob / getBlob', () => {
    it('round-trips bytes and type', async () => {
      const entry = makeEntry();
      await setBlob('g1', 'sha1', entry);
      const result = await getBlob('g1', 'sha1');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('image/webp');
      expect(Array.from(result!.bytes)).toEqual([1, 2, 3]);
    });

    it('returns null for unknown key', async () => {
      const result = await getBlob('g1', 'missing');
      expect(result).toBeNull();
    });

    it('keys are scoped per group — g1 and g2 are separate', async () => {
      await setBlob('g1', 'sha1', makeEntry());
      const g2result = await getBlob('g2', 'sha1');
      expect(g2result).toBeNull();
    });
  });

  describe('deleteBlob', () => {
    it('getBlob returns null after deleteBlob', async () => {
      await setBlob('g1', 'sha1', makeEntry());
      await deleteBlob('g1', 'sha1');
      const result = await getBlob('g1', 'sha1');
      expect(result).toBeNull();
    });
  });

  describe('addMessageRef / getMessageRefs', () => {
    it('round-trips a single messageId', async () => {
      await addMessageRef('g1', 'sha1', 'msg-1');
      const refs = await getMessageRefs('g1', 'sha1');
      expect(refs).toContain('msg-1');
    });

    it('accumulates multiple messageIds', async () => {
      await addMessageRef('g1', 'sha1', 'msg-1');
      await addMessageRef('g1', 'sha1', 'msg-2');
      const refs = await getMessageRefs('g1', 'sha1');
      expect(refs).toContain('msg-1');
      expect(refs).toContain('msg-2');
    });

    it('does not duplicate the same messageId', async () => {
      await addMessageRef('g1', 'sha1', 'msg-1');
      await addMessageRef('g1', 'sha1', 'msg-1');
      const refs = await getMessageRefs('g1', 'sha1');
      expect(refs.filter((r) => r === 'msg-1')).toHaveLength(1);
    });

    it('returns empty array for unknown key', async () => {
      const refs = await getMessageRefs('g1', 'missing');
      expect(refs).toEqual([]);
    });
  });

  describe('removeMessageRef', () => {
    it('removes a specific messageId', async () => {
      await addMessageRef('g1', 'sha1', 'msg-1');
      await addMessageRef('g1', 'sha1', 'msg-2');
      await removeMessageRef('g1', 'sha1', 'msg-1');
      const refs = await getMessageRefs('g1', 'sha1');
      expect(refs).not.toContain('msg-1');
      expect(refs).toContain('msg-2');
    });
  });

  describe('clearGroupMedia', () => {
    it('removes all blobs for groupId after clearGroupMedia', async () => {
      await setBlob('g1', 'sha1', makeEntry());
      await setBlob('g1', 'sha2', makeEntry());
      await addMessageRef('g1', 'sha1', 'msg-1');
      await clearGroupMedia('g1');
      expect(await getBlob('g1', 'sha1')).toBeNull();
      expect(await getBlob('g1', 'sha2')).toBeNull();
    });

    it('does not remove blobs for other groups', async () => {
      await setBlob('g1', 'sha1', makeEntry());
      await setBlob('g2', 'sha1', makeEntry());
      await clearGroupMedia('g1');
      expect(await getBlob('g2', 'sha1')).not.toBeNull();
    });

    it('clears meta refs alongside blobs', async () => {
      await setBlob('g1', 'sha1', makeEntry());
      await addMessageRef('g1', 'sha1', 'msg-1');
      await clearGroupMedia('g1');
      const refs = await getMessageRefs('g1', 'sha1');
      expect(refs).toEqual([]);
    });
  });
});
