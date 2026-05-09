/**
 * Unit tests for handlers/pollHandler.ts
 *
 * Covers AC-AR-15, AC-AR-20.
 *
 * Design: tests call createPoll*Handler with vi.fn() spies injected as deps,
 * then call handler.handle() directly. Duplicate-id test uses the dispatcher
 * LRU layer.
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
let mockRumor: ReturnType<typeof makePollOpenRumor> | null = null;
vi.mock('@internet-privacy/marmot-ts', () => ({
  deserializeApplicationData: vi.fn((_data: Uint8Array) => mockRumor),
}));

// ─── Dynamic imports (after vi.mock) ─────────────────────────────────────────
const { createPollOpenHandler, createPollVoteHandler, createPollCloseHandler } = await import('@/src/lib/marmot/handlers/pollHandler');
const { createDispatcher } = await import('@/src/lib/marmot/applicationRumorDispatcher');
const { POLL_OPEN_KIND, POLL_VOTE_KIND, POLL_CLOSE_KIND } = await import('@/src/lib/marmot/pollSync');

// ─── Helpers ─────────────────────────────────────────────────────────────────

const CREATOR_PUBKEY = 'aa'.repeat(32);
const VOTER_PUBKEY = 'bb'.repeat(32);
const SELF_PUBKEY = 'cc'.repeat(32);
const GROUP_ID = 'group-poll-test';
const POLL_ID = 'poll-id-1';

function makePollOpenRumor(overrides: Partial<{
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  content: string;
  tags: string[][];
}> = {}) {
  const validContent = JSON.stringify({
    id: POLL_ID,
    title: 'Best color?',
    options: [{ id: 'A', label: 'Red' }, { id: 'B', label: 'Blue' }],
    pollType: 'singlechoice',
    creatorPubkey: CREATOR_PUBKEY,
  });
  return {
    id: 'poll-open-' + 'ff'.repeat(28),
    pubkey: CREATOR_PUBKEY,
    created_at: Math.floor(Date.now() / 1000),
    kind: POLL_OPEN_KIND,
    content: validContent,
    tags: [] as string[][],
    ...overrides,
  };
}

function makePollVoteRumor(pollId = POLL_ID, overrides: Partial<{
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  content: string;
}> = {}) {
  return {
    id: 'poll-vote-' + 'ee'.repeat(28),
    pubkey: VOTER_PUBKEY,
    created_at: Math.floor(Date.now() / 1000),
    kind: POLL_VOTE_KIND,
    content: JSON.stringify({ pollId, responses: ['A'] }),
    tags: [] as string[][],
    ...overrides,
  };
}

function makePollCloseRumor(pubkey = CREATOR_PUBKEY, overrides: Partial<{
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  content: string;
}> = {}) {
  return {
    id: 'poll-close-' + 'dd'.repeat(27),
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: POLL_CLOSE_KIND,
    content: JSON.stringify({
      pollId: POLL_ID,
      results: [{ optionId: 'A', label: 'Red', count: 2 }],
      totalVoters: 2,
    }),
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

/** Build a mock poll for getPoll to return. */
function makeStoredPoll(closed = false) {
  return {
    id: POLL_ID,
    groupId: GROUP_ID,
    title: 'Best color?',
    options: [{ id: 'A', label: 'Red' }, { id: 'B', label: 'Blue' }],
    pollType: 'singlechoice' as const,
    creatorPubkey: CREATOR_PUBKEY,
    createdAt: Date.now(),
    closed,
  };
}

function makeDeps(storedPoll: ReturnType<typeof makeStoredPoll> | null = null) {
  return {
    savePoll: vi.fn(async () => {}),
    saveVote: vi.fn(async () => {}),
    getPoll: vi.fn(async () => storedPoll),
    setPollVersion: vi.fn(),
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

// ---- POLL_OPEN ---------------------------------------------------------------

describe('pollHandler / POLL_OPEN', () => {
  it('happy-path: savePoll called with correct shape, setPollVersion bumped', async () => {
    const deps = makeDeps();
    const handler = createPollOpenHandler(deps);
    const rumor = makePollOpenRumor();
    const ctx = makeCtx();

    await handler.handle(rumor, ctx);

    expect(deps.savePoll).toHaveBeenCalledOnce();
    const [savedPoll] = deps.savePoll.mock.calls[0];
    expect(savedPoll.id).toBe(POLL_ID);
    expect(savedPoll.groupId).toBe(GROUP_ID);
    expect(savedPoll.title).toBe('Best color?');
    expect(savedPoll.creatorPubkey).toBe(CREATOR_PUBKEY);
    expect(savedPoll.closed).toBe(false);
    expect(savedPoll.createdAt).toBe(rumor.created_at * 1000);
    expect(deps.setPollVersion).toHaveBeenCalledOnce();
  });

  it('malformed payload: does not throw, no deps called', async () => {
    const deps = makeDeps();
    const handler = createPollOpenHandler(deps);
    const rumor = makePollOpenRumor({ content: '{ bad }' });
    const ctx = makeCtx();

    await expect(handler.handle(rumor, ctx)).resolves.not.toThrow();
    expect(deps.savePoll).not.toHaveBeenCalled();
    expect(deps.setPollVersion).not.toHaveBeenCalled();
  });

  it('duplicate-id: dispatcher LRU prevents second savePoll call', async () => {
    const deps = makeDeps();
    const handler = createPollOpenHandler(deps);
    const dispatcher = createDispatcher([handler]);
    const group = makeFakeGroup();
    const ctx = makeCtx();

    dispatcher.subscribe(group as any, ctx);

    const rumor = makePollOpenRumor({ id: 'dup-open-id-1' });
    mockRumor = rumor;

    await group.emit();
    await group.emit();

    expect(deps.savePoll).toHaveBeenCalledOnce();
  });
});

// ---- POLL_VOTE ---------------------------------------------------------------

describe('pollHandler / POLL_VOTE', () => {
  it('happy-path: saveVote called with correct shape, setPollVersion bumped', async () => {
    const storedPoll = makeStoredPoll(false);
    const deps = makeDeps(storedPoll);
    const handler = createPollVoteHandler(deps);
    const rumor = makePollVoteRumor();
    const ctx = makeCtx();

    await handler.handle(rumor, ctx);

    expect(deps.getPoll).toHaveBeenCalledOnce();
    expect(deps.saveVote).toHaveBeenCalledOnce();
    const [savedVote] = deps.saveVote.mock.calls[0];
    expect(savedVote.pollId).toBe(POLL_ID);
    expect(savedVote.voterPubkey).toBe(VOTER_PUBKEY);
    expect(savedVote.responses).toEqual(['A']);
    expect(savedVote.id).toBe(`${POLL_ID}:${VOTER_PUBKEY}`);
    expect(deps.setPollVersion).toHaveBeenCalledOnce();
  });

  it('vote against closed poll: saveVote NOT called', async () => {
    const closedPoll = makeStoredPoll(true);
    const deps = makeDeps(closedPoll);
    const handler = createPollVoteHandler(deps);
    const rumor = makePollVoteRumor();
    const ctx = makeCtx();

    await handler.handle(rumor, ctx);

    expect(deps.saveVote).not.toHaveBeenCalled();
    expect(deps.setPollVersion).not.toHaveBeenCalled();
  });

  it('vote for unknown poll: saveVote NOT called', async () => {
    const deps = makeDeps(null); // poll not found
    const handler = createPollVoteHandler(deps);
    const rumor = makePollVoteRumor('nonexistent-poll');
    const ctx = makeCtx();

    await handler.handle(rumor, ctx);

    expect(deps.saveVote).not.toHaveBeenCalled();
  });

  it('malformed payload: does not throw, no deps called', async () => {
    const deps = makeDeps();
    const handler = createPollVoteHandler(deps);
    const rumor = makePollVoteRumor(POLL_ID, { content: '{ bad }' });
    const ctx = makeCtx();

    await expect(handler.handle(rumor, ctx)).resolves.not.toThrow();
    expect(deps.saveVote).not.toHaveBeenCalled();
  });

  it('duplicate-id: dispatcher LRU prevents second saveVote call', async () => {
    const storedPoll = makeStoredPoll(false);
    const deps = makeDeps(storedPoll);
    const handler = createPollVoteHandler(deps);
    const dispatcher = createDispatcher([handler]);
    const group = makeFakeGroup();
    const ctx = makeCtx();

    dispatcher.subscribe(group as any, ctx);

    const rumor = makePollVoteRumor(POLL_ID, { id: 'dup-vote-id-1' });
    mockRumor = rumor;

    await group.emit();
    await group.emit();

    expect(deps.saveVote).toHaveBeenCalledOnce();
  });
});

// ---- POLL_CLOSE --------------------------------------------------------------

describe('pollHandler / POLL_CLOSE', () => {
  it('happy-path: creator closes poll — savePoll with closed=true, setPollVersion bumped', async () => {
    const storedPoll = makeStoredPoll(false);
    const deps = makeDeps(storedPoll);
    const handler = createPollCloseHandler(deps);
    const rumor = makePollCloseRumor(CREATOR_PUBKEY);
    const ctx = makeCtx();

    await handler.handle(rumor, ctx);

    expect(deps.savePoll).toHaveBeenCalledOnce();
    const [savedPoll] = deps.savePoll.mock.calls[0];
    expect(savedPoll.closed).toBe(true);
    expect(savedPoll.totalVoters).toBe(2);
    expect(deps.setPollVersion).toHaveBeenCalledOnce();
  });

  it('non-creator attempt to close: savePoll NOT called', async () => {
    const storedPoll = makeStoredPoll(false);
    const deps = makeDeps(storedPoll);
    const handler = createPollCloseHandler(deps);
    // rumor.pubkey is VOTER_PUBKEY, not CREATOR_PUBKEY
    const rumor = makePollCloseRumor(VOTER_PUBKEY);
    const ctx = makeCtx();

    await handler.handle(rumor, ctx);

    expect(deps.savePoll).not.toHaveBeenCalled();
    expect(deps.setPollVersion).not.toHaveBeenCalled();
  });

  it('poll not found: savePoll NOT called', async () => {
    const deps = makeDeps(null);
    const handler = createPollCloseHandler(deps);
    const rumor = makePollCloseRumor(CREATOR_PUBKEY);
    const ctx = makeCtx();

    await handler.handle(rumor, ctx);

    expect(deps.savePoll).not.toHaveBeenCalled();
  });

  it('malformed payload: does not throw, no deps called', async () => {
    const deps = makeDeps();
    const handler = createPollCloseHandler(deps);
    const rumor = makePollCloseRumor(CREATOR_PUBKEY, { content: '{ bad }' });
    const ctx = makeCtx();

    await expect(handler.handle(rumor, ctx)).resolves.not.toThrow();
    expect(deps.savePoll).not.toHaveBeenCalled();
  });

  it('duplicate-id: dispatcher LRU prevents second savePoll call', async () => {
    const storedPoll = makeStoredPoll(false);
    const deps = makeDeps(storedPoll);
    const handler = createPollCloseHandler(deps);
    const dispatcher = createDispatcher([handler]);
    const group = makeFakeGroup();
    const ctx = makeCtx();

    dispatcher.subscribe(group as any, ctx);

    const rumor = makePollCloseRumor(CREATOR_PUBKEY, { id: 'dup-close-id-1' });
    mockRumor = rumor;

    await group.emit();
    await group.emit();

    expect(deps.savePoll).toHaveBeenCalledOnce();
  });
});
