/**
 * Unit tests for handlers/profileHandler.ts
 *
 * Covers AC-AR-14, AC-AR-20.
 *
 * Design: tests call createProfileHandler with vi.fn() spies injected as deps,
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

// ─── nostr-tools/pure mock ───────────────────────────────────────────────────
vi.mock('nostr-tools/pure', () => ({
  verifyEvent: vi.fn((_event: unknown) => true),
}));

// ─── @internet-privacy/marmot-ts mock ────────────────────────────────────────
let mockRumor: ReturnType<typeof makeProfileRumor> | null = null;
vi.mock('@internet-privacy/marmot-ts', () => ({
  deserializeApplicationData: vi.fn((_data: Uint8Array) => mockRumor),
}));

// ─── Dynamic imports (after vi.mock) ─────────────────────────────────────────
const { createProfileHandler } = await import('@/src/lib/marmot/handlers/profileHandler');
const { createDispatcher } = await import('@/src/lib/marmot/applicationRumorDispatcher');
const { PROFILE_RUMOR_KIND } = await import('@/src/lib/marmot/profileSync');

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PEER_PUBKEY = 'bb'.repeat(32);
const SELF_PUBKEY = 'aa'.repeat(32);
const AUTHOR_PUBKEY = 'cc'.repeat(32); // distinct from PEER_PUBKEY — used for relay-on-behalf tests
const GROUP_ID = 'group-profile-test';

/**
 * Build a profile rumor whose content carries an embedded SignedProfileEvent
 * signed by `authorPubkey` (which may differ from `rumorSenderPubkey`).
 * This is the relay-on-behalf wire shape: relayer sends under their own pubkey,
 * but the inner event is signed by the original author.
 * verifyEvent is mocked to return true so no real key material is needed.
 */
function makeSignedProfileRumor({
  rumorSenderPubkey = PEER_PUBKEY,
  authorPubkey = AUTHOR_PUBKEY,
  updatedAt = new Date().toISOString(),
}: {
  rumorSenderPubkey?: string;
  authorPubkey?: string;
  updatedAt?: string;
} = {}) {
  const signedEvent = {
    id: 'event-id-' + authorPubkey.slice(0, 8),
    pubkey: authorPubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: 0 as const,
    tags: [] as string[][],
    content: JSON.stringify({ nickname: 'Bob', avatar: null, updatedAt }),
    sig: 'fake-sig-' + authorPubkey.slice(0, 8),
  };
  return {
    id: 'relay-rumor-' + rumorSenderPubkey.slice(0, 8),
    pubkey: rumorSenderPubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: 0 as const,
    content: JSON.stringify(signedEvent),
    tags: [] as string[][],
  };
}

/** Build a legacy flat-profile rumor (no SignedProfileEvent envelope). */
function makeProfileRumor(overrides: Partial<{
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  content: string;
  tags: string[][];
}> = {}) {
  const validContent = JSON.stringify({
    nickname: 'Alice',
    avatar: null,
    updatedAt: new Date().toISOString(),
  });
  return {
    id: 'profile-rumor-' + 'dd'.repeat(25),
    pubkey: PEER_PUBKEY,
    created_at: Math.floor(Date.now() / 1000),
    kind: PROFILE_RUMOR_KIND,
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

function makeDeps(mergeResult = true) {
  return {
    mergeMemberProfile: vi.fn(async () => mergeResult),
    notifyProfileObserved: vi.fn(),
    recordRequestAnswered: vi.fn(async () => {}),
    writeContactEntry: vi.fn(),
    setProfileVersion: vi.fn(),
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

describe('profileHandler', () => {
  it('happy-path (merged=true): all side effects fire', async () => {
    const deps = makeDeps(true);
    const handler = createProfileHandler(deps);
    const rumor = makeProfileRumor();
    const ctx = makeCtx();

    await handler.handle(rumor, ctx);

    expect(deps.mergeMemberProfile).toHaveBeenCalledOnce();
    expect(deps.setProfileVersion).toHaveBeenCalledOnce();
    // merged=true → recordRequestAnswered fires
    expect(deps.recordRequestAnswered).toHaveBeenCalledOnce();
    expect(deps.recordRequestAnswered.mock.calls[0][0]).toBe(GROUP_ID);
    // writeContactEntry fires
    expect(deps.writeContactEntry).toHaveBeenCalledOnce();
    const [pubkey, entry] = deps.writeContactEntry.mock.calls[0];
    expect(pubkey).toBe(PEER_PUBKEY);
    expect(entry.nickname).toBe('Alice');
  });

  it('not-newer (merged=false): setProfileVersion still called, recordRequestAnswered NOT called', async () => {
    const deps = makeDeps(false);
    const handler = createProfileHandler(deps);
    const rumor = makeProfileRumor();
    const ctx = makeCtx();

    await handler.handle(rumor, ctx);

    expect(deps.mergeMemberProfile).toHaveBeenCalledOnce();
    // setProfileVersion always bumps
    expect(deps.setProfileVersion).toHaveBeenCalledOnce();
    // recordRequestAnswered only when merged
    expect(deps.recordRequestAnswered).not.toHaveBeenCalled();
  });

  it('malformed payload: does not throw, no deps called', async () => {
    const deps = makeDeps();
    const handler = createProfileHandler(deps);
    const rumor = makeProfileRumor({ content: 'not valid json at all' });
    const ctx = makeCtx();

    await expect(handler.handle(rumor, ctx)).resolves.not.toThrow();
    expect(deps.mergeMemberProfile).not.toHaveBeenCalled();
    expect(deps.setProfileVersion).not.toHaveBeenCalled();
  });

  it('duplicate-id: dispatcher LRU prevents second mergeMemberProfile call', async () => {
    const deps = makeDeps(true);
    const handler = createProfileHandler(deps);
    const dispatcher = createDispatcher([handler]);
    const group = makeFakeGroup();
    const ctx = makeCtx();

    dispatcher.subscribe(group as any, ctx);

    const rumor = makeProfileRumor({ id: 'dup-profile-id-1' });
    mockRumor = rumor;

    await group.emit();
    await group.emit();

    // LRU dedup: second emission of same id is skipped
    expect(deps.mergeMemberProfile).toHaveBeenCalledOnce();
  });

  it('notifyProfileObserved NOT called for legacy profile (no signedEvent)', async () => {
    const deps = makeDeps(true);
    const handler = createProfileHandler(deps);
    // Legacy flat profile — no signedEvent envelope
    const rumor = makeProfileRumor();
    const ctx = makeCtx();

    await handler.handle(rumor, ctx);

    // signedEvent is absent in legacy profiles → notifyProfileObserved not called
    expect(deps.notifyProfileObserved).not.toHaveBeenCalled();
  });

  it('relay-on-behalf (signedEvent.pubkey !== rumor.pubkey) is accepted, NOT dropped (AC-047 amended)', async () => {
    // AC-047 amended interpretation: the embedded sig is the trust anchor.
    // Cross-pubkey relay is legitimate — receivers key the MemberProfile under
    // the signed author (signedEvent.pubkey), not the relayer (rumor.pubkey).
    // verifyEvent is mocked to return true above, so sig verification passes.
    const deps = makeDeps(true);
    const handler = createProfileHandler(deps);
    // rumorSenderPubkey = PEER_PUBKEY (the relayer), authorPubkey = AUTHOR_PUBKEY (the original author)
    const rumor = makeSignedProfileRumor({
      rumorSenderPubkey: PEER_PUBKEY,
      authorPubkey: AUTHOR_PUBKEY,
    });
    const ctx = makeCtx();

    await handler.handle(rumor, ctx);

    // Must NOT be dropped — merge fires
    expect(deps.mergeMemberProfile).toHaveBeenCalledOnce();
    // The resulting MemberProfile should be keyed under the AUTHOR, not the relayer
    const mergedProfile = deps.mergeMemberProfile.mock.calls[0][1];
    expect(mergedProfile.pubkeyHex).toBe(AUTHOR_PUBKEY);
    // notifyProfileObserved fires because signedEvent is present
    expect(deps.notifyProfileObserved).toHaveBeenCalledOnce();
    expect(deps.notifyProfileObserved.mock.calls[0][0].targetPubkey).toBe(AUTHOR_PUBKEY);
    // Contact cache entry is keyed under the author
    expect(deps.writeContactEntry).toHaveBeenCalledOnce();
    const [contactPubkey] = deps.writeContactEntry.mock.calls[0];
    expect(contactPubkey).toBe(AUTHOR_PUBKEY);
  });
});
