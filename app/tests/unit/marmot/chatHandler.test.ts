/**
 * Unit tests for handlers/chatHandler.ts
 *
 * Covers AC-AR-7, AC-AR-8, AC-AR-20.
 *
 * Design: tests call createChatHandler with vi.fn() spies injected as deps,
 * then call handler.handle() directly. The dispatcher LRU dedup layer is
 * tested separately in applicationRumorDispatcher.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── idb-keyval mock (Map-backed) ───────────────────────────────────────────
const idbStore = new Map<string, unknown>();
vi.mock('idb-keyval', () => ({
  get: vi.fn(async (key: string) => idbStore.get(key) ?? undefined),
  set: vi.fn(async (key: string, value: unknown) => { idbStore.set(key, value); }),
  del: vi.fn(async (key: string) => { idbStore.delete(key); }),
  keys: vi.fn(async () => [...idbStore.keys()]),
  delMany: vi.fn(async (ks: string[]) => { ks.forEach((k) => idbStore.delete(k)); }),
}));

// ─── @internet-privacy/marmot-ts mock ────────────────────────────────────────
vi.mock('@internet-privacy/marmot-ts', () => ({
  parseMediaImetaTag: vi.fn(() => null),
}));

// ─── Dynamic imports (after vi.mock) ─────────────────────────────────────────
const { createChatHandler } = await import('@/src/lib/marmot/handlers/chatHandler');

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SELF_PUBKEY = 'aa'.repeat(32);
const PEER_PUBKEY = 'bb'.repeat(32);
const GROUP_ID = 'group-test-1';

function makeRumor(overrides: Partial<{
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  content: string;
  tags: string[][];
}> = {}) {
  return {
    id: 'rumor-id-' + 'cc'.repeat(28),
    pubkey: PEER_PUBKEY,
    created_at: Math.floor(Date.now() / 1000),
    kind: 9,
    content: 'hello world',
    tags: [] as string[][],
    ...overrides,
  };
}

function makeCtx(overrides: Partial<{
  groupId: string;
  selfPubkeyHex: string;
  getActiveGroupId: () => string | null;
}> = {}) {
  return {
    groupId: GROUP_ID,
    selfPubkeyHex: SELF_PUBKEY,
    getActiveGroupId: () => GROUP_ID,
    ...overrides,
  };
}

function makeDeps() {
  return {
    appendMessage: vi.fn(async () => {}),
    incrementUnread: vi.fn(),
    setChatVersion: vi.fn(),
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  idbStore.clear();
  vi.clearAllMocks();
});

describe('chatHandler', () => {
  it('happy-path text message: calls appendMessage with correct shape', async () => {
    const deps = makeDeps();
    const handler = createChatHandler(deps);
    const rumor = makeRumor({ content: 'hello from peer', tags: [] });
    const ctx = makeCtx();

    await handler.handle(rumor, ctx);

    expect(deps.appendMessage).toHaveBeenCalledOnce();
    const [groupId, msg] = deps.appendMessage.mock.calls[0];
    expect(groupId).toBe(GROUP_ID);
    expect(msg.id).toBe(rumor.id);
    expect(msg.content).toBe('hello from peer');
    expect(msg.senderPubkey).toBe(PEER_PUBKEY);
    expect(msg.groupId).toBe(GROUP_ID);
    expect(msg.createdAt).toBe(rumor.created_at * 1000);
  });

  it('AC-AR-7: imeta tag parse — attachments populated from tags', async () => {
    // Mock parseMediaImetaTag to return a proper attachment
    const { parseMediaImetaTag } = await import('@internet-privacy/marmot-ts');
    vi.mocked(parseMediaImetaTag).mockImplementation((tag: string[]) => {
      // Parse the url and m fields from the imeta tag entries
      const fields: Record<string, string> = {};
      for (let i = 1; i < tag.length; i++) {
        const [key, ...rest] = tag[i].split(' ');
        if (key && rest.length > 0) fields[key] = rest.join(' ');
      }
      if (!fields['url']) return null;
      return { url: fields['url'], type: fields['m'] ?? 'application/octet-stream' } as any;
    });

    const deps = makeDeps();
    const handler = createChatHandler(deps);
    // Image message with imeta tag
    const imageContent = JSON.stringify({ type: 'image', version: 1, caption: 'test' });
    const rumor = makeRumor({
      content: imageContent,
      tags: [['imeta', 'url https://img.example/a.jpg', 'm image/jpeg']],
    });
    const ctx = makeCtx();

    await handler.handle(rumor, ctx);

    expect(deps.appendMessage).toHaveBeenCalledOnce();
    const [, msg] = deps.appendMessage.mock.calls[0];
    expect(msg.attachments).toBeDefined();
    // The attachment was parsed — should have full set to the parsed attachment
    expect(msg.attachments?.full).toBeDefined();
    expect(msg.attachments?.full?.url).toBe('https://img.example/a.jpg');
    expect((msg.attachments?.full as any)?.type).toBe('image/jpeg');
  });

  it('malformed payload: non-string content does not throw', async () => {
    const deps = makeDeps();
    const handler = createChatHandler(deps);
    // Force non-string content through type cast
    const rumor = makeRumor({ content: 42 as unknown as string });
    const ctx = makeCtx();

    await expect(handler.handle(rumor, ctx)).resolves.not.toThrow();
    // appendMessage still called with empty string content
    expect(deps.appendMessage).toHaveBeenCalledOnce();
    const [, msg] = deps.appendMessage.mock.calls[0];
    expect(msg.content).toBe('');
  });

  it('duplicate-id: appendMessage called twice (dedup is dispatcher responsibility)', async () => {
    const deps = makeDeps();
    const handler = createChatHandler(deps);
    const rumor = makeRumor({ id: 'dup-id-1' });
    const ctx = makeCtx();

    await handler.handle(rumor, ctx);
    await handler.handle(rumor, ctx);

    // Handler itself does not dedup — dispatcher LRU does
    expect(deps.appendMessage).toHaveBeenCalledTimes(2);
  });

  it('AC-AR-8: own-send skip — incrementUnread NOT called when pubkey === selfPubkeyHex', async () => {
    const deps = makeDeps();
    const handler = createChatHandler(deps);
    const rumor = makeRumor({ pubkey: SELF_PUBKEY }); // own-send
    const ctx = makeCtx({ selfPubkeyHex: SELF_PUBKEY });

    await handler.handle(rumor, ctx);

    expect(deps.incrementUnread).not.toHaveBeenCalled();
    // appendMessage and setChatVersion still called for the IDB write
    expect(deps.appendMessage).toHaveBeenCalledOnce();
    expect(deps.setChatVersion).toHaveBeenCalledOnce();
  });

  it('AC-AR-8: peer in background group — incrementUnread called with groupId', async () => {
    const deps = makeDeps();
    const handler = createChatHandler(deps);
    const rumor = makeRumor({ pubkey: PEER_PUBKEY }); // different pubkey
    // Active group is G2, rumor is for G1
    const ctx = makeCtx({
      groupId: 'G1',
      selfPubkeyHex: SELF_PUBKEY,
      getActiveGroupId: () => 'G2',
    });

    await handler.handle(rumor, ctx);

    expect(deps.incrementUnread).toHaveBeenCalledOnce();
    expect(deps.incrementUnread).toHaveBeenCalledWith('G1');
    expect(deps.incrementUnread).not.toHaveBeenCalledWith('G2');
  });

  it('setChatVersion called on every successful handle', async () => {
    const deps = makeDeps();
    const handler = createChatHandler(deps);
    const ctx = makeCtx();

    await handler.handle(makeRumor({ id: 'r1' }), ctx);
    await handler.handle(makeRumor({ id: 'r2' }), ctx);

    expect(deps.setChatVersion).toHaveBeenCalledTimes(2);
  });
});
