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
import type NDK from '@nostr-dev-kit/ndk';
import {
  CALL_OFFER_KIND,
  CALL_ANSWER_KIND,
  CALL_ICE_KIND,
  CALL_HANGUP_KIND,
  CALL_REJECT_KIND,
  CALL_RENEGOTIATE_KIND,
  CALL_GIFT_WRAP_KIND,
  SIGNALING_FRESHNESS_WINDOW_S,
  DEDUP_SET_MAX,
  encodeOffer,
  encodeAnswer,
  encodeIceCandidate,
  encodeHangup,
  encodeReject,
  encodeRenegotiate,
  wrapAndPublish,
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

// wrapAndPublish constructs `new NDKEvent(ndk, giftWrapEvent).publish()`. Mock
// NDKEvent so the outer gift-wrap event and its publish call are observable.
// (subscribeCallSignaling does not use NDKEvent — it uses the injected fake
// ndk.subscribe — so this mock only affects the wrapAndPublish path.)
const ndkMock = vi.hoisted(() => {
  const publishedOuterEvents: Array<{ kind?: number; tags?: string[][]; content?: string }> = [];
  const publishSpy = vi.fn().mockResolvedValue(undefined);
  return { publishedOuterEvents, publishSpy };
});

vi.mock('@nostr-dev-kit/ndk', () => ({
  NDKEvent: class {
    kind?: number;
    tags?: string[][];
    content?: string;
    constructor(_ndk: unknown, event: { kind?: number; tags?: string[][]; content?: string }) {
      Object.assign(this, event);
      ndkMock.publishedOuterEvents.push(event);
    }
    publish = ndkMock.publishSpy;
  },
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
// encodeReject: encode-side defaults (AC-WIRE-4).
// Closes mutant ID 39 (NoCoverage): encodeReject with no reason must produce
// an empty-string content field via the `params.reason ?? ''` fallback.
// =============================================================================

describe('encodeReject', () => {
  it('produces empty-string content when reason is omitted (AC-WIRE-4)', () => {
    const draft = encodeReject({
      senderPubkeyHex: CALLER_PUB,
      recipientPubkeys: [LOCAL_PUB],
      callId: CALL_ID,
      // reason intentionally omitted — must default to ''
    });

    expect(draft.kind).toBe(CALL_REJECT_KIND);
    expect(draft.content).toBe('');
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

  // ===========================================================================
  // Deliver an arbitrary signed inner event end-to-end through the handler.
  // The nip44.decrypt mock returns the inner JSON; verifyEvent is mocked true.
  // ===========================================================================

  type Inner = ReturnType<typeof makeInnerEvent>;

  async function deliverInner(inner: Inner) {
    nip44.decrypt = vi.fn(() => JSON.stringify(inner)) as typeof nip44.decrypt;
    await emitEvent(sub, {
      pubkey: EPHEMERAL_PUB,
      content: 'encrypted-outer',
      created_at: inner.created_at,
    });
  }

  /** Turn an encode* draft into a signed inner event ready for the decode path. */
  function draftToInner(
    draft: { kind: number; pubkey: string; created_at: number; tags: string[][]; content: string },
    id = 'rt-inner-id',
  ): Inner {
    return { ...draft, id, sig: 'valid-sig' } as Inner;
  }

  const PEER2 = 'dddd'.repeat(16);

  // ── Bucket A: encode → decode round-trip preserves the semantic payload ──────
  // Cites AC-WIRE-1 (tag set: call-id on every event, call-type on offer only,
  // ≥1 p tag) and the per-kind content contracts.

  it('round-trips a kind-25051 Answer: sdp + full roster preserved, no callType (AC-WIRE-1)', async () => {
    const sdp = 'v=0\r\no=- 7 2 IN IP4 127.0.0.1\r\ns=answer\r\n';
    const draft = encodeAnswer({
      senderPubkeyHex: CALLER_PUB,
      recipientPubkeys: [LOCAL_PUB, PEER2],
      callId: CALL_ID,
      sdp,
    });
    await deliverInner(draftToInner(draft));

    expect(onEvent).toHaveBeenCalledOnce();
    const evt = onEvent.mock.calls[0][0] as import('@/src/types').IncomingCallEvent;
    expect(evt.kind).toBe(CALL_ANSWER_KIND);
    expect(evt.callId).toBe(CALL_ID);
    expect(evt.senderPubkey).toBe(CALLER_PUB);
    expect(evt.recipientPubkeys).toEqual([LOCAL_PUB, PEER2]);
    expect(evt.sdp).toBe(sdp);
    expect(evt.callType).toBeUndefined();
    // Payload exclusivity: a non-Hangup/Reject event carries no reason.
    expect(evt.reason).toBeUndefined();
  });

  it('round-trips a kind-25055 Renegotiate: sdp preserved, no callType (AC-WIRE-1)', async () => {
    const sdp = 'v=0\r\ns=renegotiate\r\n';
    const draft = encodeRenegotiate({
      senderPubkeyHex: CALLER_PUB,
      recipientPubkeys: [LOCAL_PUB],
      callId: CALL_ID,
      sdp,
    });
    await deliverInner(draftToInner(draft));

    const evt = onEvent.mock.calls[0][0] as import('@/src/types').IncomingCallEvent;
    expect(evt.kind).toBe(CALL_RENEGOTIATE_KIND);
    expect(evt.sdp).toBe(sdp);
    expect(evt.callType).toBeUndefined();
  });

  it('round-trips a kind-25053 Hangup with an empty reason (AC-WIRE-4)', async () => {
    const draft = encodeHangup({
      senderPubkeyHex: CALLER_PUB,
      recipientPubkeys: [LOCAL_PUB, PEER2],
      callId: CALL_ID,
      // reason omitted → ''
    });
    await deliverInner(draftToInner(draft));

    const evt = onEvent.mock.calls[0][0] as import('@/src/types').IncomingCallEvent;
    expect(evt.kind).toBe(CALL_HANGUP_KIND);
    expect(evt.reason).toBe('');
    expect(evt.recipientPubkeys).toEqual([LOCAL_PUB, PEER2]);
    expect(evt.sdp).toBeUndefined();
  });

  it('round-trips a kind-25054 Reject carrying the "busy" reason (AC-WIRE-4)', async () => {
    const draft = encodeReject({
      senderPubkeyHex: CALLER_PUB,
      recipientPubkeys: [LOCAL_PUB],
      callId: CALL_ID,
      reason: 'busy',
    });
    await deliverInner(draftToInner(draft));

    const evt = onEvent.mock.calls[0][0] as import('@/src/types').IncomingCallEvent;
    expect(evt.kind).toBe(CALL_REJECT_KIND);
    expect(evt.reason).toBe('busy');
    expect(evt.sdp).toBeUndefined();
  });

  it('round-trips a kind-25052 ICE candidate: single-target roster + parsed candidate (AC-WIRE-3)', async () => {
    const draft = encodeIceCandidate({
      senderPubkeyHex: CALLER_PUB,
      recipientPubkeyHex: LOCAL_PUB,
      callId: CALL_ID,
      candidate: {
        candidate: 'candidate:1 udp 1 192.168.0.1 5000 typ host',
        sdpMid: '1',
        sdpMLineIndex: 2,
      },
    });
    await deliverInner(draftToInner(draft));

    const evt = onEvent.mock.calls[0][0] as import('@/src/types').IncomingCallEvent;
    expect(evt.kind).toBe(CALL_ICE_KIND);
    expect(evt.callId).toBe(CALL_ID);
    // ICE carries exactly the single target peer, not a full roster.
    expect(evt.recipientPubkeys).toEqual([LOCAL_PUB]);
    expect(evt.iceCandidate).toEqual({
      candidate: 'candidate:1 udp 1 192.168.0.1 5000 typ host',
      sdpMid: '1',
      sdpMLineIndex: 2,
    });
    expect(evt.sdp).toBeUndefined();
  });

  // ── Bucket A4: parse-side ICE defaults + malformed rejection (AC-WIRE-3) ─────

  it('applies parse-side ICE defaults when sdpMid/sdpMLineIndex/candidate are absent (AC-WIRE-3)', async () => {
    const inner = makeInnerEvent({
      kind: CALL_ICE_KIND,
      tags: [['p', LOCAL_PUB], ['call-id', CALL_ID]],
      content: JSON.stringify({}), // no candidate / sdpMid / sdpMLineIndex
    });
    await deliverInner(inner);

    const evt = onEvent.mock.calls[0][0] as import('@/src/types').IncomingCallEvent;
    expect(evt.iceCandidate).toEqual({ candidate: '', sdpMid: '0', sdpMLineIndex: 0 });
  });

  it('drops a kind-25052 ICE event whose content is not valid JSON', async () => {
    const inner = makeInnerEvent({
      kind: CALL_ICE_KIND,
      tags: [['p', LOCAL_PUB], ['call-id', CALL_ID]],
      content: 'not-json{',
    });
    await deliverInner(inner);

    expect(onEvent).not.toHaveBeenCalled();
  });

  // ── Bucket B8: recipientPubkeys is exactly the p-tag set (AC-WIRE-1) ─────────

  it('parses recipientPubkeys as exactly the p tags, excluding call-id and call-type', async () => {
    const inner = makeInnerEvent({
      tags: [
        ['p', LOCAL_PUB],
        ['p', PEER2],
        ['call-id', CALL_ID],
        ['call-type', 'video'],
      ],
    });
    await deliverInner(inner);

    const evt = onEvent.mock.calls[0][0] as import('@/src/types').IncomingCallEvent;
    expect(evt.recipientPubkeys).toEqual([LOCAL_PUB, PEER2]);
  });

  // ── Bucket B9: call-type validation on offers (AC-WIRE-1) ────────────────────

  it.each([
    ['voice', 'voice'],
    ['video', 'video'],
  ] as const)('keeps a valid offer call-type %s', async (input, expected) => {
    const inner = makeInnerEvent({
      tags: [['p', LOCAL_PUB], ['call-id', CALL_ID], ['call-type', input]],
    });
    await deliverInner(inner);
    const evt = onEvent.mock.calls[0][0] as import('@/src/types').IncomingCallEvent;
    expect(evt.callType).toBe(expected);
  });

  it('ignores an invalid offer call-type, leaving callType undefined (AC-WIRE-1)', async () => {
    const inner = makeInnerEvent({
      tags: [['p', LOCAL_PUB], ['call-id', CALL_ID], ['call-type', 'bogus']],
    });
    await deliverInner(inner);
    const evt = onEvent.mock.calls[0][0] as import('@/src/types').IncomingCallEvent;
    expect(evt.callType).toBeUndefined();
  });

  it('leaves callType undefined when an offer carries no call-type tag (AC-WIRE-1)', async () => {
    const inner = makeInnerEvent({
      tags: [['p', LOCAL_PUB], ['call-id', CALL_ID]],
    });
    await deliverInner(inner);
    const evt = onEvent.mock.calls[0][0] as import('@/src/types').IncomingCallEvent;
    expect(evt.callType).toBeUndefined();
  });

  it('ignores a call-type tag on a non-offer kind — callType is offer-only (AC-WIRE-1)', async () => {
    // Even if a call-type tag leaks onto a 25051 Answer, callType must stay
    // unset: callType is part of the Offer contract only.
    const inner = makeInnerEvent({
      kind: CALL_ANSWER_KIND,
      tags: [['p', LOCAL_PUB], ['call-id', CALL_ID], ['call-type', 'video']],
      content: 'v=0\r\ns=answer\r\n',
    });
    await deliverInner(inner);
    const evt = onEvent.mock.calls[0][0] as import('@/src/types').IncomingCallEvent;
    expect(evt.kind).toBe(CALL_ANSWER_KIND);
    expect(evt.callType).toBeUndefined();
  });

  // ── Bucket B10/B11: receive-side structural validation ───────────────────────
  // No matching AC covers rejection of structurally-malformed inner events
  // (unknown kind, missing call-id); see BACKLOG spec-gap finding.

  it('drops an inner event whose kind is not a recognised call kind (no AC; see BACKLOG)', async () => {
    const inner = makeInnerEvent({
      kind: 25099,
      tags: [['p', LOCAL_PUB], ['call-id', CALL_ID]],
    });
    await deliverInner(inner);
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('drops an inner event with no call-id tag (no AC; see BACKLOG)', async () => {
    const inner = makeInnerEvent({
      tags: [['p', LOCAL_PUB], ['call-type', 'video']], // call-id missing
    });
    await deliverInner(inner);
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('drops an inner event whose call-id tag has an empty value (no AC; see BACKLOG)', async () => {
    const inner = makeInnerEvent({
      tags: [['p', LOCAL_PUB], ['call-id', '']],
    });
    await deliverInner(inner);
    expect(onEvent).not.toHaveBeenCalled();
  });

  // ── Bucket B12: freshness boundary is exactly 20s inclusive (AC-FRESH-1) ──────
  // Pin the boundary with a frozen clock so `>` cannot drift to `>=` undetected.

  it('accepts an event exactly SIGNALING_FRESHNESS_WINDOW_S seconds old (AC-FRESH-1)', async () => {
    const fixedNowMs = 1_700_000_000_000;
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(fixedNowMs);
    try {
      const inner = makeInnerEvent({
        created_at: Math.floor(fixedNowMs / 1000) - SIGNALING_FRESHNESS_WINDOW_S,
      });
      await deliverInner(inner);
      expect(onEvent).toHaveBeenCalledOnce();
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('drops an event one second beyond the freshness window (AC-FRESH-1)', async () => {
    const fixedNowMs = 1_700_000_000_000;
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(fixedNowMs);
    try {
      const inner = makeInnerEvent({
        created_at: Math.floor(fixedNowMs / 1000) - (SIGNALING_FRESHNESS_WINDOW_S + 1),
      });
      await deliverInner(inner);
      expect(onEvent).not.toHaveBeenCalled();
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('drops a future-dated event beyond the freshness window (AC-FRESH-1)', async () => {
    const fixedNowMs = 1_700_000_000_000;
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(fixedNowMs);
    try {
      const inner = makeInnerEvent({
        created_at: Math.floor(fixedNowMs / 1000) + (SIGNALING_FRESHNESS_WINDOW_S + 1),
      });
      await deliverInner(inner);
      expect(onEvent).not.toHaveBeenCalled();
    } finally {
      nowSpy.mockRestore();
    }
  });

  // ── Dedup overflow eviction (DEDUP_SET_MAX boundary) ──────────────────────────
  // Closes mutant IDs 153-157: the DEDUP_SET_MAX condition and its eviction body
  // are never exercised unless 500+ events are delivered in one test run.
  //
  // Mutant kill map:
  //   ID 153 (→ true):  always-clear — re-send of fill-0 before overflow passes (Phase 2 fails)
  //   ID 154 (→ false): never-clear — re-send of fill-0 after overflow stays deduped (Phase 4 fails)
  //   ID 155 (>):       clears one event late — same as 154 for Phase 4
  //   ID 156 (<):       clears on every small set — same as 153, Phase 2 fails
  //   ID 157 (body {}): clear is a no-op — same as 154, Phase 4 fails

  it('clears the dedup set at exactly DEDUP_SET_MAX then allows re-delivery of evicted ids', async () => {
    // Phase 1: fill the dedup set to DEDUP_SET_MAX.
    // Every event has a unique id; all must be dispatched (no premature clear).
    for (let i = 0; i < DEDUP_SET_MAX; i++) {
      const inner = makeInnerEvent({ id: `fill-${i}` });
      nip44.decrypt = vi.fn(() => JSON.stringify(inner)) as typeof nip44.decrypt;
      await emitEvent(sub, { pubkey: EPHEMERAL_PUB, content: 'enc', created_at: inner.created_at });
    }
    expect(onEvent).toHaveBeenCalledTimes(DEDUP_SET_MAX);

    // Phase 2: re-send fill-0 while the set is full — must be deduped
    // (has() check fires first; overflow clear only triggers for a NEW id).
    {
      const inner = makeInnerEvent({ id: 'fill-0' });
      nip44.decrypt = vi.fn(() => JSON.stringify(inner)) as typeof nip44.decrypt;
      await emitEvent(sub, { pubkey: EPHEMERAL_PUB, content: 'enc', created_at: inner.created_at });
    }
    expect(onEvent).toHaveBeenCalledTimes(DEDUP_SET_MAX); // dedup held — still DEDUP_SET_MAX

    // Phase 3: deliver the (DEDUP_SET_MAX + 1)th unique id — triggers `size >= DEDUP_SET_MAX`,
    // clears the set, adds the overflow id, then dispatches the event.
    {
      const inner = makeInnerEvent({ id: 'overflow-trigger' });
      nip44.decrypt = vi.fn(() => JSON.stringify(inner)) as typeof nip44.decrypt;
      await emitEvent(sub, { pubkey: EPHEMERAL_PUB, content: 'enc', created_at: inner.created_at });
    }
    expect(onEvent).toHaveBeenCalledTimes(DEDUP_SET_MAX + 1); // overflow event delivered

    // Phase 4: re-send fill-0 after the eviction — the set was cleared, so fill-0 is
    // no longer tracked; it must be re-delivered (brief post-clear dedup miss).
    {
      const inner = makeInnerEvent({ id: 'fill-0' });
      nip44.decrypt = vi.fn(() => JSON.stringify(inner)) as typeof nip44.decrypt;
      await emitEvent(sub, { pubkey: EPHEMERAL_PUB, content: 'enc', created_at: inner.created_at });
    }
    expect(onEvent).toHaveBeenCalledTimes(DEDUP_SET_MAX + 2); // fill-0 re-delivered after eviction
  });
});

// =============================================================================
// Encode output contracts: created_at is UNIX SECONDS, and the ICE tag set.
// (AC-WIRE-1 / AC-WIRE-3.)  These guard against a created_at unit drift
// (seconds vs milliseconds), which would silently break the freshness gate.
// =============================================================================

describe('encode* created_at is UNIX seconds', () => {
  const recipients = ['aaaa'.repeat(16)];
  const callId = 'fixed-call-id';
  const senderPubkeyHex = 'bbbb'.repeat(16);

  const cases: Array<[string, () => { created_at: number }]> = [
    ['encodeOffer', () => encodeOffer({ senderPubkeyHex, recipientPubkeys: recipients, callId, callType: 'video', sdp: 'v=0' })],
    ['encodeAnswer', () => encodeAnswer({ senderPubkeyHex, recipientPubkeys: recipients, callId, sdp: 'v=0' })],
    ['encodeIceCandidate', () => encodeIceCandidate({ senderPubkeyHex, recipientPubkeyHex: recipients[0], callId, candidate: { candidate: 'c' } })],
    ['encodeHangup', () => encodeHangup({ senderPubkeyHex, recipientPubkeys: recipients, callId })],
    ['encodeReject', () => encodeReject({ senderPubkeyHex, recipientPubkeys: recipients, callId, reason: 'busy' })],
    ['encodeRenegotiate', () => encodeRenegotiate({ senderPubkeyHex, recipientPubkeys: recipients, callId, sdp: 'v=0' })],
  ];

  it.each(cases)('%s stamps created_at within a few seconds of the current epoch second', (_name, build) => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const draft = build();
    // Seconds, not milliseconds: a Date.now()*1000 (or /1000 dropped) drift
    // would land ~3 orders of magnitude away and fail this window.
    expect(draft.created_at).toBeGreaterThanOrEqual(nowSeconds - 5);
    expect(draft.created_at).toBeLessThanOrEqual(nowSeconds + 5);
  });
});

describe('encodeIceCandidate tag set', () => {
  const senderPubkeyHex = 'bbbb'.repeat(16);
  const target = 'aaaa'.repeat(16);
  const callId = 'ice-call-id';

  it('carries exactly one p tag (the target) and a call-id tag (AC-WIRE-1)', () => {
    const draft = encodeIceCandidate({
      senderPubkeyHex,
      recipientPubkeyHex: target,
      callId,
      candidate: { candidate: 'c', sdpMid: '0', sdpMLineIndex: 0 },
    });
    const pTags = draft.tags.filter((t) => t[0] === 'p');
    expect(pTags).toEqual([['p', target]]);
    const callIdTag = draft.tags.find((t) => t[0] === 'call-id');
    expect(callIdTag).toEqual(['call-id', callId]);
  });

  it('fills content defaults (candidate→"", sdpMid→"0", sdpMLineIndex→0) when absent (AC-WIRE-3)', () => {
    const draft = encodeIceCandidate({
      senderPubkeyHex,
      recipientPubkeyHex: target,
      callId,
      candidate: {}, // all fields absent
    });
    expect(JSON.parse(draft.content)).toEqual({ candidate: '', sdpMid: '0', sdpMLineIndex: 0 });
  });
});

// =============================================================================
// wrapAndPublish: the gift-wrap transport (kind-21059 outer wrap).  AC-WRAP-1.
// =============================================================================

describe('wrapAndPublish', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ndkMock.publishedOuterEvents.length = 0;
  });

  it('signs the inner event, wraps it in a kind-21059 p-tagged to the recipient, and publishes once (AC-WRAP-1)', async () => {
    const recipientHex = 'aaaa'.repeat(16);
    const signedInner = { kind: CALL_OFFER_KIND, id: 'signed-inner-id', sig: 'inner-sig' };
    const signer = {
      signEvent: vi.fn().mockResolvedValue(signedInner),
      nip44: { encrypt: vi.fn().mockResolvedValue('signer-encrypted-blob') },
    };

    const draft = encodeOffer({
      senderPubkeyHex: 'bbbb'.repeat(16),
      recipientPubkeys: [recipientHex],
      callId: 'wrap-call-id',
      callType: 'video',
      sdp: 'v=0',
    });

    const fakeNdk = makeFakeNdk();
    await wrapAndPublish(
      draft,
      recipientHex,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      signer as any,
      fakeNdk as unknown as NDK,
    );

    // The sender's real key signs the inner event.
    expect(signer.signEvent).toHaveBeenCalledWith(draft);

    // Exactly one outer wrap is constructed and published.
    expect(ndkMock.publishedOuterEvents).toHaveLength(1);
    expect(ndkMock.publishSpy).toHaveBeenCalledOnce();

    const outer = ndkMock.publishedOuterEvents[0];
    expect(outer.kind).toBe(CALL_GIFT_WRAP_KIND);
    // Exactly one p tag, addressed to the recipient, and no other tags.
    expect(outer.tags).toEqual([['p', recipientHex]]);
  });

  it('outer gift-wrap created_at is epoch seconds, not milliseconds (AC-WRAP-1)', async () => {
    // Closes mutant ID 45 (Survived): wrapAndPublish uses Date.now() / 1000
    // (correct, epoch seconds). The mutant flips it to * 1000 (milliseconds,
    // ~1.78e15). The prior test only asserted kind + tags, not the timestamp.
    const recipientHex = 'aaaa'.repeat(16);
    const signedInner = { kind: CALL_OFFER_KIND, id: 'ts-inner-id', sig: 'ts-sig' };
    const signer = {
      signEvent: vi.fn().mockResolvedValue(signedInner),
      nip44: { encrypt: vi.fn().mockResolvedValue('ts-encrypted-blob') },
    };
    const draft = encodeOffer({
      senderPubkeyHex: 'bbbb'.repeat(16),
      recipientPubkeys: [recipientHex],
      callId: 'wrap-ts-call-id',
      callType: 'voice',
      sdp: 'v=0',
    });
    const nowSeconds = Math.floor(Date.now() / 1000);

    await wrapAndPublish(
      draft,
      recipientHex,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      signer as any,
      makeFakeNdk() as unknown as NDK,
    );

    const outerEvent = ndkMock.publishedOuterEvents[0] as {
      kind?: number;
      tags?: string[][];
      content?: string;
      created_at?: number;
    };
    // A * 1000 drift would place created_at ~3 orders of magnitude above the
    // current epoch second (~1.78e9 expected vs ~1.78e15 if mutated).
    expect(outerEvent.created_at).toBeGreaterThanOrEqual(nowSeconds - 5);
    expect(outerEvent.created_at).toBeLessThanOrEqual(nowSeconds + 5);
  });
});
