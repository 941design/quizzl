/**
 * Unit tests for handlers/scoreHandler.ts
 *
 * Covers AC-AR-16, AC-AR-20.
 *
 * Design: tests call createScoreHandler with vi.fn() spies injected as deps,
 * then call handler.handle() directly. The duplicate-id test uses the
 * dispatcher LRU layer (createDispatcher) to confirm dedup prevents the
 * second call.
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
// Tests inject rumor objects by setting mockRumor before emitting via dispatcher.
let mockRumor: ReturnType<typeof makeScoreRumor> | null = null;
vi.mock('@internet-privacy/marmot-ts', () => ({
  deserializeApplicationData: vi.fn((_data: Uint8Array) => mockRumor),
}));

// ─── Dynamic imports (after vi.mock) ─────────────────────────────────────────
const { createScoreHandler } = await import('@/src/lib/marmot/handlers/scoreHandler');
const { createDispatcher } = await import('@/src/lib/marmot/applicationRumorDispatcher');
const { SCORE_RUMOR_KIND } = await import('@/src/lib/marmot/scoreSync');

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PEER_PUBKEY = 'bb'.repeat(32);
const SELF_PUBKEY = 'aa'.repeat(32);
const GROUP_ID = 'group-score-test';

function makeScoreRumor(overrides: Partial<{
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  content: string;
  tags: string[][];
}> = {}) {
  const validContent = JSON.stringify({
    topicSlug: 'math',
    quizPoints: 42,
    maxPoints: 100,
    completedTasks: 3,
    totalTasks: 10,
    lastStudiedAt: new Date().toISOString(),
    sequenceNumber: 1,
  });
  return {
    id: 'score-rumor-' + 'cc'.repeat(26),
    pubkey: PEER_PUBKEY,
    created_at: Math.floor(Date.now() / 1000),
    kind: SCORE_RUMOR_KIND,
    content: validContent,
    tags: [] as string[][],
    ...overrides,
  };
}

function makeCtx() {
  return {
    groupId: GROUP_ID,
    selfPubkeyHex: SELF_PUBKEY,
    getActiveGroupId: () => GROUP_ID,
  };
}

function makeDeps() {
  return {
    mergeMemberScore: vi.fn(async () => {}),
  };
}

function makeFakeGroup() {
  let listener: ((data: Uint8Array) => void) | null = null;
  return {
    on: vi.fn((_event: string, fn: (data: Uint8Array) => void) => { listener = fn; }),
    off: vi.fn(),
    async emit() { if (listener) await listener(new Uint8Array()); },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  idbStore.clear();
  vi.clearAllMocks();
  mockRumor = null;
});

describe('scoreHandler', () => {
  it('happy-path: calls mergeMemberScore with correct groupId, pubkey, nickname prefix, and scoreUpdate', async () => {
    const deps = makeDeps();
    const handler = createScoreHandler(deps);
    const rumor = makeScoreRumor();
    const ctx = makeCtx();

    await handler.handle(rumor, ctx);

    expect(deps.mergeMemberScore).toHaveBeenCalledOnce();
    const [groupId, pubkey, nickname, update] = deps.mergeMemberScore.mock.calls[0];
    expect(groupId).toBe(GROUP_ID);
    expect(pubkey).toBe(PEER_PUBKEY);
    // nickname is first 8 chars of pubkey
    expect(nickname).toBe(PEER_PUBKEY.slice(0, 8));
    expect(update.topicSlug).toBe('math');
    expect(update.quizPoints).toBe(42);
    expect(update.sequenceNumber).toBe(1);
  });

  it('malformed payload: does not throw, does not call mergeMemberScore', async () => {
    const deps = makeDeps();
    const handler = createScoreHandler(deps);
    const rumor = makeScoreRumor({ content: '{ not valid score }' });
    const ctx = makeCtx();

    await expect(handler.handle(rumor, ctx)).resolves.not.toThrow();
    expect(deps.mergeMemberScore).not.toHaveBeenCalled();
  });

  it('duplicate-id: dispatcher LRU prevents second mergeMemberScore call', async () => {
    const deps = makeDeps();
    const handler = createScoreHandler(deps);
    const dispatcher = createDispatcher([handler]);
    const group = makeFakeGroup();
    const ctx = makeCtx();

    dispatcher.subscribe(group as any, ctx);

    const rumor = makeScoreRumor({ id: 'dup-score-id-1' });
    mockRumor = rumor;

    await group.emit();
    await group.emit();

    // LRU dedup: second emission of same id is skipped
    expect(deps.mergeMemberScore).toHaveBeenCalledOnce();
  });
});
