/**
 * Unit tests for directMessageNotifications.ts — story-02, AC-15 through AC-19, AC-21.
 *
 * Tests the bell watcher's two-subscription model (kind-4 + kind-1059) and the
 * kind-1059 handler's silent-skip, dedup, and attribution logic.
 *
 * AC-15: subscribeDirectMessageNotifications opens two subscriptions.
 * AC-16: kind-1059 event whose rumor has kind===14, pubkey!==own, created_at>lastRead
 *        → rememberContact + incrementDirectMessage exactly once.
 * AC-17: kind-1059 event whose unwrap throws → no side effects, no unhandled rejection.
 * AC-18: kind-1059 event whose rumor has kind!==14 → no side effects.
 * AC-19: kind-1059 event re-delivered with different outer id but same inner rumor id
 *        → incrementDirectMessage called exactly once (seenRumorIds dedup).
 * AC-21: unit test file exists and covers AC-15 through AC-19.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Fake NDK subscription infrastructure ──────────────────────────────────────

type FakeSub = {
  id: string;
  filter: object;
  handlers: Array<(ev: object) => void>;
  stop: () => void;
  /** Mirrors NDKSubscription.on() — registers an event handler. */
  on: (event: string, handler: (ev: object) => void) => void;
};

type FakeNdk = {
  subscribe: (filter: object) => FakeSub;
};

function makeFakeNdk(): FakeNdk & { subs: FakeSub[] } {
  const subs: FakeSub[] = [];
  const ndk = {
    subs,
    subscribe: (filter: object) => {
      const sub: FakeSub = {
        id: `sub-${subs.length}`,
        filter,
        handlers: [],
        stop: vi.fn(),
        // Mirrors NDKSubscription.on — handlers are stored in `handlers` array
        // and emitted by emitEvent(). The `on` method also registers handlers.
        on(event: string, handler: (ev: object) => void) {
          this.handlers.push(handler);
        },
      };
      subs.push(sub);
      return sub;
    },
  } as FakeNdk & { subs: FakeSub[] };
  return ndk;
}

/**
 * Emit an event through a fake subscription's handlers.
 * Awaits async handlers so callers can assert on post-handler state synchronously.
 */
async function emitEvent(sub: FakeSub, event: object) {
  await Promise.all(sub.handlers.map(async (handler) => {
    const result = handler(event);
    if (result instanceof Promise) await result;
  }));
}

// ── Shared test keypair (from architecture.md) ────────────────────────────────

const OWN_PRIV = 'bceef655b5a034911f1c3718ce056531b45ef03b4c7b1f15629e867294011a7d';
const OWN_PUB = 'a'.repeat(64); // not a real pubkey — used as-is for filtering
const PEER_PUB = 'b'.repeat(64);

// ── Mock targets ───────────────────────────────────────────────────────────────

// Capture the logger returned by createLogger('dm') in the SUT module scope
let capturedLoggerInfo: ReturnType<typeof vi.fn>;

vi.mock('@/src/lib/directMessages', async () => {
  const mod = await vi.importActual<typeof import('@/src/lib/directMessages')>('@/src/lib/directMessages');
  return {
    ...mod,
    unwrapAndOpen: vi.fn<() => Promise<import('@/src/lib/directMessages').UnsignedRumor>>(),
    // shouldIngestRumor is intentionally NOT mocked — the bell watcher must accept
    // DMs from any peer (it has no peer-pubkey to filter against). A previous version
    // mocked it to true by default, hiding a bug where shouldIngestRumor(rumor, '')
    // was being called and rejecting every rumor in production.
  };
});

vi.mock('@/src/lib/unreadStore', () => ({
  getDirectMessageLastReadAt: vi.fn(() => 0),  // 0 = never read, so any event bumps bell
  incrementDirectMessage: vi.fn(),
}));

vi.mock('@/src/lib/contacts', () => ({
  rememberContact: vi.fn(),
}));

vi.mock('@/src/lib/logger', () => {
  const infoSpy = vi.fn();
  capturedLoggerInfo = infoSpy;
  return {
    createLogger: () => ({ info: infoSpy, debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

const { unwrapAndOpen } = await import('@/src/lib/directMessages');
const { incrementDirectMessage } = await import('@/src/lib/unreadStore');
const { rememberContact } = await import('@/src/lib/contacts');

// ── Import SUT after mocks ─────────────────────────────────────────────────────

const { subscribeDirectMessageNotifications } = await import('@/src/lib/directMessageNotifications');

// ── Test suite ─────────────────────────────────────────────────────────────────

describe('subscribeDirectMessageNotifications', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(unwrapAndOpen).mockReset();
    vi.mocked(incrementDirectMessage).mockReset();
    vi.mocked(rememberContact).mockReset();
    if (capturedLoggerInfo) capturedLoggerInfo.mockClear();
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  // ── AC-15 ────────────────────────────────────────────────────────────────────

  it('AC-15: opens two subscriptions with different filter objects', () => {
    const ndk = makeFakeNdk();

    subscribeDirectMessageNotifications({ ndk: ndk as unknown as any, ownPubkeyHex: OWN_PUB, privateKeyHex: OWN_PRIV });

    // Two subscriptions must have been created
    expect(ndk.subs).toHaveLength(2);

    // Subscription 1 must filter for kind-4 + '#p': [ownPubkey]
    const kind4Sub = ndk.subs.find(
      (s) => JSON.stringify(s.filter).includes('"kinds":[4]'),
    );
    expect(kind4Sub).toBeDefined();
    expect(kind4Sub!.filter).toMatchObject({ kinds: [4], '#p': [OWN_PUB] });

    // Subscription 2 must filter for kind-1059 + '#p': [ownPubkey]
    const kind1059Sub = ndk.subs.find(
      (s) => JSON.stringify(s.filter).includes('"kinds":[1059]'),
    );
    expect(kind1059Sub).toBeDefined();
    expect(kind1059Sub!.filter).toMatchObject({ kinds: [1059], '#p': [OWN_PUB] });
  });

  // ── AC-16 ────────────────────────────────────────────────────────────────────

  it('AC-16: kind-1059 event with kind===14, pubkey!==own, created_at>lastRead calls rememberContact and incrementDirectMessage exactly once', async () => {
    vi.mocked(unwrapAndOpen).mockResolvedValue({
      id: 'rumor-id-abc',
      pubkey: PEER_PUB,          // not own
      kind: 14,                   // NIP-17 chat message
      content: 'hello',
      tags: [['p', OWN_PUB]],
      created_at: 1_700_000_000,  // far in the future vs lastRead=0
    });

    const ndk = makeFakeNdk();
    subscribeDirectMessageNotifications({ ndk: ndk as unknown as any, ownPubkeyHex: OWN_PUB, privateKeyHex: OWN_PRIV });

    const kind1059Sub = ndk.subs.find(
      (s) => JSON.stringify(s.filter).includes('"kinds":[1059]'),
    )!;

    await emitEvent(kind1059Sub, {
      id: 'wrap-id-outer',
      kind: 1059,
      pubkey: 'ephemeral-key',
      created_at: { getTime: () => 1_700_000_000 * 1000 },
    });

    expect(rememberContact).toHaveBeenCalledTimes(1);
    expect(rememberContact).toHaveBeenCalledWith(PEER_PUB);
    expect(incrementDirectMessage).toHaveBeenCalledTimes(1);
    expect(incrementDirectMessage).toHaveBeenCalledWith(PEER_PUB);
  });

  // ── AC-17 ────────────────────────────────────────────────────────────────────

  it('AC-17: kind-1059 event whose unwrap throws does not call rememberContact/incrementDirectMessage; no unhandled rejection', async () => {
    vi.mocked(unwrapAndOpen).mockRejectedValue(new Error('decrypt failed'));

    const ndk = makeFakeNdk();
    subscribeDirectMessageNotifications({ ndk: ndk as unknown as any, ownPubkeyHex: OWN_PUB, privateKeyHex: OWN_PRIV });

    const kind1059Sub = ndk.subs.find(
      (s) => JSON.stringify(s.filter).includes('"kinds":[1059]'),
    )!;

    // Must not throw — the handler must catch all errors internally
    await expect(
      emitEvent(kind1059Sub, {
        id: 'malformed-wrap',
        kind: 1059,
        pubkey: 'attacker-key',
      }),
    ).resolves.not.toThrow();

    expect(rememberContact).not.toHaveBeenCalled();
    expect(incrementDirectMessage).not.toHaveBeenCalled();
  });

  // ── AC-18 ────────────────────────────────────────────────────────────────────

  it('AC-18: kind-1059 event whose rumor has kind!==14 does not call rememberContact or incrementDirectMessage', async () => {
    // Simulate a kind-7 reaction rumor (from emoji epic story-07)
    vi.mocked(unwrapAndOpen).mockResolvedValue({
      id: 'reaction-rumor-id',
      pubkey: PEER_PUB,
      kind: 7,      // not kind-14
      content: '+',
      tags: [],
      created_at: 1_700_000_000,
    });

    const ndk = makeFakeNdk();
    subscribeDirectMessageNotifications({ ndk: ndk as unknown as any, ownPubkeyHex: OWN_PUB, privateKeyHex: OWN_PRIV });

    const kind1059Sub = ndk.subs.find(
      (s) => JSON.stringify(s.filter).includes('"kinds":[1059]'),
    )!;

    await emitEvent(kind1059Sub, {
      id: 'reaction-wrap',
      kind: 1059,
      pubkey: 'any-key',
    });

    expect(rememberContact).not.toHaveBeenCalled();
    expect(incrementDirectMessage).not.toHaveBeenCalled();
  });

  it('AC-18 variant: kind-444 welcome rumor is silently skipped', async () => {
    vi.mocked(unwrapAndOpen).mockResolvedValue({
      id: 'welcome-rumor-id',
      pubkey: PEER_PUB,
      kind: 444,
      content: '',
      tags: [],
      created_at: 1_700_000_000,
    });

    const ndk = makeFakeNdk();
    subscribeDirectMessageNotifications({ ndk: ndk as unknown as any, ownPubkeyHex: OWN_PUB, privateKeyHex: OWN_PRIV });

    const kind1059Sub = ndk.subs.find(
      (s) => JSON.stringify(s.filter).includes('"kinds":[1059]'),
    )!;

    await emitEvent(kind1059Sub, { id: 'welcome-wrap', kind: 1059, pubkey: 'any-key' });

    expect(rememberContact).not.toHaveBeenCalled();
    expect(incrementDirectMessage).not.toHaveBeenCalled();
  });

  it('AC-18 variant: kind-21059 join-request rumor is silently skipped', async () => {
    vi.mocked(unwrapAndOpen).mockResolvedValue({
      id: 'join-request-rumor-id',
      pubkey: PEER_PUB,
      kind: 21059,
      content: '',
      tags: [],
      created_at: 1_700_000_000,
    });

    const ndk = makeFakeNdk();
    subscribeDirectMessageNotifications({ ndk: ndk as unknown as any, ownPubkeyHex: OWN_PUB, privateKeyHex: OWN_PRIV });

    const kind1059Sub = ndk.subs.find(
      (s) => JSON.stringify(s.filter).includes('"kinds":[1059]'),
    )!;

    await emitEvent(kind1059Sub, { id: 'join-wrap', kind: 1059, pubkey: 'any-key' });

    expect(rememberContact).not.toHaveBeenCalled();
    expect(incrementDirectMessage).not.toHaveBeenCalled();
  });

  // ── AC-19 ────────────────────────────────────────────────────────────────────

  it('AC-19: kind-1059 event re-delivered with different outer id but same inner rumor id increments bell exactly once (seenRumorIds dedup)', async () => {
    vi.mocked(unwrapAndOpen).mockResolvedValue({
      id: 'stable-rumor-id',   // same inner id
      pubkey: PEER_PUB,
      kind: 14,
      content: 'hello again',
      tags: [['p', OWN_PUB]],
      created_at: 1_700_000_000,
    });

    const ndk = makeFakeNdk();
    subscribeDirectMessageNotifications({ ndk: ndk as unknown as any, ownPubkeyHex: OWN_PUB, privateKeyHex: OWN_PRIV });

    const kind1059Sub = ndk.subs.find(
      (s) => JSON.stringify(s.filter).includes('"kinds":[1059]'),
    )!;

    // First delivery — outer id "wrap-v1"
    await emitEvent(kind1059Sub, { id: 'wrap-v1', kind: 1059, pubkey: 'ephemeral-1' });
    expect(incrementDirectMessage).toHaveBeenCalledTimes(1);

    // Second delivery — same rumor id, different outer id (relay redelivery)
    await emitEvent(kind1059Sub, { id: 'wrap-v2', kind: 1059, pubkey: 'ephemeral-2' });
    expect(incrementDirectMessage).toHaveBeenCalledTimes(1); // still 1 — deduped by rumor id
  });

  // ── AC-30 / AC-31 logging ────────────────────────────────────────────────────

  it('AC-30: info-level logger is called when unwrap throws', async () => {
    vi.mocked(unwrapAndOpen).mockRejectedValue(new Error('decrypt failed'));

    const ndk = makeFakeNdk();
    subscribeDirectMessageNotifications({ ndk: ndk as unknown as any, ownPubkeyHex: OWN_PUB, privateKeyHex: OWN_PRIV });

    const kind1059Sub = ndk.subs.find(
      (s) => JSON.stringify(s.filter).includes('"kinds":[1059]'),
    )!;

    await emitEvent(kind1059Sub, { id: 'wrap-malformed', kind: 1059, pubkey: 'attacker-key' });

    expect(capturedLoggerInfo).toHaveBeenCalledWith(
      'dm:unwrap-failed',
      expect.objectContaining({ eventId: 'wrap-malformed' }),
    );
  });

  it('AC-31: no console.warn or console.error from any silent-skip path', async () => {
    // unwrap throws
    vi.mocked(unwrapAndOpen).mockRejectedValue(new Error('bad'));
    const ndk1 = makeFakeNdk();
    subscribeDirectMessageNotifications({ ndk: ndk1 as unknown as any, ownPubkeyHex: OWN_PUB, privateKeyHex: OWN_PRIV });
    const sub1 = ndk1.subs.find((s) => JSON.stringify(s.filter).includes('1059'))!;
    await emitEvent(sub1, { id: 'wrap-1', kind: 1059, pubkey: 'x' });

    // rumor kind!==14
    vi.mocked(unwrapAndOpen).mockResolvedValue({
      id: 'r2', pubkey: PEER_PUB, kind: 7, content: '+', tags: [], created_at: 1,
    });
    const ndk2 = makeFakeNdk();
    subscribeDirectMessageNotifications({ ndk: ndk2 as unknown as any, ownPubkeyHex: OWN_PUB, privateKeyHex: OWN_PRIV });
    const sub2 = ndk2.subs.find((s) => JSON.stringify(s.filter).includes('1059'))!;
    await emitEvent(sub2, { id: 'wrap-2', kind: 1059, pubkey: 'x' });

    // self-authored rumor (own pubkey)
    vi.mocked(unwrapAndOpen).mockResolvedValue({
      id: 'r3', pubkey: OWN_PUB, kind: 14, content: 'self', tags: [], created_at: 1,
    });
    const ndk3 = makeFakeNdk();
    subscribeDirectMessageNotifications({ ndk: ndk3 as unknown as any, ownPubkeyHex: OWN_PUB, privateKeyHex: OWN_PRIV });
    const sub3 = ndk3.subs.find((s) => JSON.stringify(s.filter).includes('1059'))!;
    await emitEvent(sub3, { id: 'wrap-3', kind: 1059, pubkey: 'x' });

    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  // ── Bug-1 regression (multi-peer bell) ────────────────────────────────────────
  // Earlier code passed shouldIngestRumor(rumor, '') which always returned false
  // for any real rumor pubkey, silently disabling the bell for all NIP-17 DMs.
  // The unit test mocked shouldIngestRumor=true by default, hiding the bug.
  // This test runs with no shouldIngestRumor mock and confirms the bell still fires
  // for arbitrary peer pubkeys that we have no prior knowledge of.

  it('bug-1 regression: bell fires for an unknown peer pubkey (no shouldIngestRumor mock)', async () => {
    const UNKNOWN_PEER = 'c'.repeat(64);
    vi.mocked(unwrapAndOpen).mockResolvedValue({
      id: 'rumor-from-unknown-peer',
      pubkey: UNKNOWN_PEER,
      kind: 14,
      content: 'first message',
      tags: [['p', OWN_PUB]],
      created_at: 1_700_000_000,
    });

    const ndk = makeFakeNdk();
    subscribeDirectMessageNotifications({ ndk: ndk as unknown as any, ownPubkeyHex: OWN_PUB, privateKeyHex: OWN_PRIV });

    const kind1059Sub = ndk.subs.find(
      (s) => JSON.stringify(s.filter).includes('"kinds":[1059]'),
    )!;

    await emitEvent(kind1059Sub, { id: 'wrap-unknown-peer', kind: 1059, pubkey: 'ephemeral' });

    expect(rememberContact).toHaveBeenCalledTimes(1);
    expect(rememberContact).toHaveBeenCalledWith(UNKNOWN_PEER);
    expect(incrementDirectMessage).toHaveBeenCalledTimes(1);
    expect(incrementDirectMessage).toHaveBeenCalledWith(UNKNOWN_PEER);
  });

  it('bug-1 regression: rumor pubkey casing differences do not break self-detection', async () => {
    // Self-authored rumor whose pubkey casing differs from ownPubkeyHex.
    // The bell handler must lowercase before comparing, otherwise self-DMs would
    // ring the bell.
    vi.mocked(unwrapAndOpen).mockResolvedValue({
      id: 'self-rumor',
      pubkey: OWN_PUB.toUpperCase(),
      kind: 14,
      content: 'self note',
      tags: [],
      created_at: 1_700_000_000,
    });

    const ndk = makeFakeNdk();
    subscribeDirectMessageNotifications({ ndk: ndk as unknown as any, ownPubkeyHex: OWN_PUB, privateKeyHex: OWN_PRIV });

    const kind1059Sub = ndk.subs.find(
      (s) => JSON.stringify(s.filter).includes('"kinds":[1059]'),
    )!;

    await emitEvent(kind1059Sub, { id: 'wrap-self', kind: 1059, pubkey: 'ephemeral' });

    expect(incrementDirectMessage).not.toHaveBeenCalled();
  });
});