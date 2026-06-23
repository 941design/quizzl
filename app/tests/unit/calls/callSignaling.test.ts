/**
 * Unit tests for callSignaling.ts — Story S1, signaling codec + gift-wrap transport.
 *
 * Tests:
 *   T1. encodeOffer() produces correct kind/tags/content structure.
 *   T2. encodeIceCandidate() produces JSON content with correct defaults
 *       (sdpMid→"0", sdpMLineIndex→0 when absent).
 *   T3. Freshness: an event 21 seconds old is rejected.
 *   T4. Dedupe: duplicate event-id on second call is rejected.
 *   T5. Roster gate: isAuthorized returning false drops the event; true passes it through.
 *   T6. Signature verification: tampered inner event is rejected.
 *
 * Mocking strategy:
 *   - NDK is replaced with a fake subscription infrastructure (mirrors the pattern in
 *     directMessageNotifications.test.ts) — no real NDK instance required.
 *   - nostr-tools/nip44 is mocked to return deterministic encrypt/decrypt output.
 *   - nostr-tools/pure verifyEvent is mocked so tests control whether signatures pass.
 *   - nostr-tools/utils hexToBytes is mocked to return fixed bytes.
 *   - finalizeEvent is mocked to return a predictable event.
 *
 * Deterministic test keypairs (fixed seed for repeatability):
 *   - CALLER_PRIV / CALLER_PUB  — the sending side
 *   - LOCAL_PRIV / LOCAL_PUB    — the receiving side
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CALL_OFFER_KIND,
  CALL_ICE_KIND,
  CALL_GIFT_WRAP_KIND,
  SIGNALING_FRESHNESS_WINDOW_S,
  encodeOffer,
  encodeIceCandidate,
  subscribeCallSignaling,
} from '@/src/lib/calls/callSignaling';

// ── Test keypairs (fixed hex strings — not cryptographically meaningful here) ──

const CALLER_PUB = 'aaaa'.repeat(16);
const LOCAL_PUB  = 'bbbb'.repeat(16);
const LOCAL_PRIV = 'cccc'.repeat(16);
const CALL_ID    = '11111111-aaaa-bbbb-cccc-dddddddddddd';
const EPHEMERAL_PUB = 'eeee'.repeat(16);

// ── Fake NDK infrastructure (mirrors directMessageNotifications.test.ts) ──────

type FakeHandler = (ev: object) => void | Promise<void>;

type FakeSub = {
  filter: object;
  handlers: FakeHandler[];
  stop: ReturnType<typeof vi.fn>;
  on: (event: string, handler: FakeHandler) => void;
};

type FakeNdk = {
  subs: FakeSub[];
  subscribe: (filter: object) => FakeSub;
};

function makeFakeNdk(): FakeNdk {
  const subs: FakeSub[] = [];
  return {
    subs,
    subscribe(filter: object) {
      const sub: FakeSub = {
        filter,
        handlers: [],
        stop: vi.fn(),
        on(_event: string, handler: FakeHandler) {
          this.handlers.push(handler);
        },
      };
      subs.push(sub);
      return sub;
    },
  };
}

async function emitEvent(sub: FakeSub, event: object) {
  await Promise.all(
    sub.handlers.map(async (h) => {
      const r = h(event);
      if (r instanceof Promise) await r;
    }),
  );
}

// ── Shared inner-event factory ────────────────────────────────────────────────

function makeInnerEvent(overrides: Partial<{
  kind: number;
  id: string;
  pubkey: string;
  tags: string[][];
  content: string;
  created_at: number;
  sig: string;
}> = {}) {
  return {
    kind: CALL_OFFER_KIND,
    id: 'inner-event-id-001',
    pubkey: CALLER_PUB,
    tags: [
      ['p', LOCAL_PUB],
      ['call-id', CALL_ID],
      ['call-type', 'video'],
    ],
    content: 'v=0\r\no=- 1 IN IP4 127.0.0.1\r\ns=-\r\n',
    created_at: Math.floor(Date.now() / 1000),
    sig: 'valid-sig',
    ...overrides,
  };
}

// ── Mock setup ────────────────────────────────────────────────────────────────

// We mock the dynamic imports inside subscribeCallSignaling's handler.
// The mocks are module-level so they persist across tests unless reset.
vi.mock('nostr-tools/nip44', () => ({
  v2: {
    utils: {
      getConversationKey: vi.fn(() => new Uint8Array(32)),
    },
    decrypt: vi.fn(),
    encrypt: vi.fn(() => 'encrypted-content'),
  },
}));

vi.mock('nostr-tools/pure', () => ({
  verifyEvent: vi.fn(() => true),
  finalizeEvent: vi.fn((draft: object, _priv: Uint8Array) => ({
    ...draft,
    id: 'outer-event-id',
    pubkey: EPHEMERAL_PUB,
    sig: 'outer-sig',
  })),
  getPublicKey: vi.fn(() => EPHEMERAL_PUB),
}));

vi.mock('nostr-tools/utils', () => ({
  hexToBytes: vi.fn(() => new Uint8Array(32)),
}));

// ── Helpers for accessing the mocked modules ──────────────────────────────────

async function getNip44Mock() {
  return (await import('nostr-tools/nip44')).v2;
}
async function getPureMock() {
  return await import('nostr-tools/pure');
}

// =============================================================================
// T1: encodeOffer() produces correct kind/tags/content
// =============================================================================

describe('encodeOffer', () => {
  it('produces kind 25050 with correct p tags, call-id, call-type, and SDP content', () => {
    const sdp = 'v=0\r\no=- 46117317 2 IN IP4 127.0.0.1\r\ns=-\r\n';
    const draft = encodeOffer({
      senderPubkeyHex: CALLER_PUB,
      recipientPubkeys: [LOCAL_PUB],
      callId: CALL_ID,
      callType: 'video',
      sdp,
    });

    expect(draft.kind).toBe(25050);
    expect(draft.pubkey).toBe(CALLER_PUB);
    expect(draft.content).toBe(sdp);

    const pTags = draft.tags.filter((t) => t[0] === 'p').map((t) => t[1]);
    expect(pTags).toEqual([LOCAL_PUB]);

    const callIdTag = draft.tags.find((t) => t[0] === 'call-id');
    expect(callIdTag).toBeDefined();
    expect(callIdTag![1]).toBe(CALL_ID);

    const callTypeTag = draft.tags.find((t) => t[0] === 'call-type');
    expect(callTypeTag).toBeDefined();
    expect(callTypeTag![1]).toBe('video');
  });

  it('supports multiple recipients in a group offer', () => {
    const PEER2 = 'dddd'.repeat(16);
    const draft = encodeOffer({
      senderPubkeyHex: CALLER_PUB,
      recipientPubkeys: [LOCAL_PUB, PEER2],
      callId: CALL_ID,
      callType: 'voice',
      sdp: 'v=0',
    });

    const pTags = draft.tags.filter((t) => t[0] === 'p').map((t) => t[1]);
    expect(pTags).toEqual([LOCAL_PUB, PEER2]);
    expect(draft.tags.find((t) => t[0] === 'call-type')![1]).toBe('voice');
    // No alt tag, no expiration tag (spec §7.2)
    expect(draft.tags.find((t) => t[0] === 'alt')).toBeUndefined();
    expect(draft.tags.find((t) => t[0] === 'expiration')).toBeUndefined();
  });
});

// =============================================================================
// T2: encodeIceCandidate() content defaults
// =============================================================================

describe('encodeIceCandidate', () => {
  it('produces kind 25052 with JSON content including all fields', () => {
    const draft = encodeIceCandidate({
      senderPubkeyHex: CALLER_PUB,
      recipientPubkeyHex: LOCAL_PUB,
      callId: CALL_ID,
      candidate: {
        candidate: 'candidate:1234 udp 1234 192.168.0.1 12345 typ host',
        sdpMid: '0',
        sdpMLineIndex: 0,
      },
    });

    expect(draft.kind).toBe(CALL_ICE_KIND);
    expect(draft.tags.filter((t) => t[0] === 'p')).toHaveLength(1);
    expect(draft.tags.find((t) => t[0] === 'p')![1]).toBe(LOCAL_PUB);

    const payload = JSON.parse(draft.content);
    expect(payload.candidate).toBe('candidate:1234 udp 1234 192.168.0.1 12345 typ host');
    expect(payload.sdpMid).toBe('0');
    expect(payload.sdpMLineIndex).toBe(0);
  });

  it('fills in defaults for missing sdpMid and sdpMLineIndex', () => {
    const draft = encodeIceCandidate({
      senderPubkeyHex: CALLER_PUB,
      recipientPubkeyHex: LOCAL_PUB,
      callId: CALL_ID,
      candidate: {
        candidate: 'candidate:999 tcp 999 10.0.0.1 9 typ relay',
        // sdpMid and sdpMLineIndex intentionally absent
      },
    });

    const payload = JSON.parse(draft.content);
    expect(payload.sdpMid).toBe('0');
    expect(payload.sdpMLineIndex).toBe(0);
  });
});

// =============================================================================
// Tests T3–T6: subscribeCallSignaling handler behaviour
// =============================================================================

describe('subscribeCallSignaling', () => {
  let ndk: FakeNdk;
  let onEvent: ReturnType<typeof vi.fn>;
  let isAuthorized: ReturnType<typeof vi.fn>;
  let nip44: Awaited<ReturnType<typeof getNip44Mock>>;
  let pure: Awaited<ReturnType<typeof getPureMock>>;
  let sub: FakeSub;
  let unsubscribe: () => void;

  /**
   * Default inner event JSON (fresh + authorized + valid sig).
   * The nip44.decrypt mock returns this string.
   */
  function setInnerEvent(overrides: Parameters<typeof makeInnerEvent>[0] = {}) {
    const inner = makeInnerEvent(overrides);
    nip44.decrypt = vi.fn(() => JSON.stringify(inner)) as typeof nip44.decrypt;
    return inner;
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    ndk = makeFakeNdk();
    onEvent = vi.fn();
    isAuthorized = vi.fn().mockResolvedValue(true);
    nip44 = await getNip44Mock();
    pure = await getPureMock();

    // Default: valid fresh inner event
    setInnerEvent();
    // Default: signature passes
    (pure.verifyEvent as ReturnType<typeof vi.fn>).mockReturnValue(true);

    unsubscribe = subscribeCallSignaling({
      ndk: ndk as unknown as NDK,
      pubkeyHex: LOCAL_PUB,
      privateKeyHex: LOCAL_PRIV,
      isAuthorized,
      onEvent,
    });

    // subscribeCallSignaling opens one subscription
    expect(ndk.subs).toHaveLength(1);
    sub = ndk.subs[0];
  });

  afterEach(() => {
    unsubscribe();
  });

  // ── T3: Freshness ─────────────────────────────────────────────────────────

  it('T3: discards an inner event that is older than 20 seconds', async () => {
    const staleTs = Math.floor(Date.now() / 1000) - (SIGNALING_FRESHNESS_WINDOW_S + 1);
    setInnerEvent({ created_at: staleTs });

    await emitEvent(sub, {
      pubkey: EPHEMERAL_PUB,
      content: 'encrypted-outer',
      created_at: staleTs,
    });

    expect(onEvent).not.toHaveBeenCalled();
  });

  it('T3: accepts an inner event that is clearly within the freshness window (1 s old)', async () => {
    const recentTs = Math.floor(Date.now() / 1000) - 1;
    setInnerEvent({ created_at: recentTs });

    await emitEvent(sub, {
      pubkey: EPHEMERAL_PUB,
      content: 'encrypted-outer',
      created_at: recentTs,
    });

    // 1 second old is well within the 20 s window → should pass
    expect(onEvent).toHaveBeenCalledOnce();
  });

  // ── T4: Deduplication ────────────────────────────────────────────────────

  it('T4: passes the first delivery of an event but drops the duplicate', async () => {
    const inner = setInnerEvent({ id: 'unique-id-001' });
    const wrapEvent = {
      pubkey: EPHEMERAL_PUB,
      content: 'encrypted-outer',
      created_at: inner.created_at,
    };

    await emitEvent(sub, wrapEvent);
    expect(onEvent).toHaveBeenCalledOnce();

    await emitEvent(sub, wrapEvent);
    expect(onEvent).toHaveBeenCalledOnce(); // still once — second delivery dropped
  });

  it('T4: treats two events with different ids independently', async () => {
    const inner1 = makeInnerEvent({ id: 'id-A' });
    const inner2 = makeInnerEvent({ id: 'id-B' });

    nip44.decrypt = vi.fn()
      .mockReturnValueOnce(JSON.stringify(inner1))
      .mockReturnValueOnce(JSON.stringify(inner2)) as typeof nip44.decrypt;

    const wrap = { pubkey: EPHEMERAL_PUB, content: 'enc', created_at: inner1.created_at };
    await emitEvent(sub, wrap);
    await emitEvent(sub, wrap);

    expect(onEvent).toHaveBeenCalledTimes(2);
  });

  // ── T5: Roster gate ──────────────────────────────────────────────────────

  it('T5: drops the event when isAuthorized returns false', async () => {
    isAuthorized.mockResolvedValue(false);
    setInnerEvent();

    await emitEvent(sub, {
      pubkey: EPHEMERAL_PUB,
      content: 'encrypted-outer',
      created_at: Math.floor(Date.now() / 1000),
    });

    expect(onEvent).not.toHaveBeenCalled();
  });

  it('T5: passes the event when isAuthorized returns true', async () => {
    isAuthorized.mockResolvedValue(true);
    setInnerEvent();

    await emitEvent(sub, {
      pubkey: EPHEMERAL_PUB,
      content: 'encrypted-outer',
      created_at: Math.floor(Date.now() / 1000),
    });

    expect(onEvent).toHaveBeenCalledOnce();
    expect(isAuthorized).toHaveBeenCalledWith(CALLER_PUB, CALL_ID);
  });

  // ── T6: Signature verification ────────────────────────────────────────────

  it('T6: drops an event whose inner signature is invalid', async () => {
    setInnerEvent();
    (pure.verifyEvent as ReturnType<typeof vi.fn>).mockReturnValue(false);

    await emitEvent(sub, {
      pubkey: EPHEMERAL_PUB,
      content: 'encrypted-outer',
      created_at: Math.floor(Date.now() / 1000),
    });

    expect(onEvent).not.toHaveBeenCalled();
  });

  it('T6: drops an event when nip44 decrypt throws (tampered ciphertext)', async () => {
    nip44.decrypt = vi.fn().mockImplementation(() => {
      throw new Error('bad MAC');
    }) as typeof nip44.decrypt;

    await emitEvent(sub, {
      pubkey: EPHEMERAL_PUB,
      content: 'tampered',
      created_at: Math.floor(Date.now() / 1000),
    });

    expect(onEvent).not.toHaveBeenCalled();
  });

  // ── Happy-path: subscription filter ────────────────────────────────────────

  it('subscribes with kinds=[21059] and #p=[ownPubkeyHex]', () => {
    expect(sub.filter).toMatchObject({
      kinds: [CALL_GIFT_WRAP_KIND],
      '#p': [LOCAL_PUB],
    });
  });

  // ── Happy-path: parsed event shape ─────────────────────────────────────────

  it('delivers a correctly parsed IncomingCallEvent to onEvent', async () => {
    const sdp = 'v=0\r\ns=-\r\n';
    setInnerEvent({ content: sdp, tags: [
      ['p', LOCAL_PUB],
      ['call-id', CALL_ID],
      ['call-type', 'voice'],
    ]});

    await emitEvent(sub, {
      pubkey: EPHEMERAL_PUB,
      content: 'encrypted-outer',
      created_at: Math.floor(Date.now() / 1000),
    });

    expect(onEvent).toHaveBeenCalledOnce();
    const evt = onEvent.mock.calls[0][0] as import('@/src/types').IncomingCallEvent;
    expect(evt.kind).toBe(25050);
    expect(evt.callId).toBe(CALL_ID);
    expect(evt.senderPubkey).toBe(CALLER_PUB);
    expect(evt.callType).toBe('voice');
    expect(evt.sdp).toBe(sdp);
    expect(evt.recipientPubkeys).toContain(LOCAL_PUB);
    expect(evt.innerEventId).toBe('inner-event-id-001');
  });

  // ── unsubscribe ─────────────────────────────────────────────────────────────

  it('calls sub.stop() when the returned unsubscribe function is invoked', () => {
    unsubscribe();
    expect(sub.stop).toHaveBeenCalledOnce();
  });
});
