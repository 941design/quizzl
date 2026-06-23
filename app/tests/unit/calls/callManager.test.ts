/**
 * Unit tests for callManager.ts — Story S5.
 *
 * Tests:
 *   T1.  Incoming offer → callStore.incoming is set with correct fields
 *   T2.  declineCall() sends 25054 Reject and clears callStore
 *   T3.  Ring timeout (45s) → auto-decline fires (vi.useFakeTimers)
 *   T4.  5-cap: startCall with 5 remote peers throws (total 6 including self)
 *   T5.  Busy auto-reject: incoming offer while active → sends 25054 with 'busy'
 *   T6.  Multi-device echo: acceptCall() wraps 25051 also to own pubkey
 *   T7.  Join mid-call: existing peer initiates offer to newly discovered peer
 *   T8.  Hangup: sends 25053 to all peers and clears callStore
 *   T9.  ICE restart: on connectionState === 'failed', sends 25055 renegotiate
 *   T10. Multi-device echo receive: 25054 Reject from own pubkey stops ringing
 *   T11. Multi-device echo receive: 25051 Answer from own pubkey stops ringing
 *
 * Mocking strategy:
 *   - callSignaling, mediaManager, turnConfig are vi.mock'd.
 *   - PeerSession mock collects instances via a module-level array that the
 *     mock factory registers into through globalThis.__peerSessionRegistry__.
 *   - callStore is the real implementation, reset between tests.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { callStore } from '@/src/lib/calls/callStore';
import type { IncomingCallEvent } from '@/src/types';

// ── Peer-session instance registry ───────────────────────────────────────────
// The mock factory is hoisted by vitest so it cannot close over module-level
// let-bindings at the call site. We bridge via globalThis instead.

interface MockPeerSession {
  callbacks: {
    onIceCandidate: (c: RTCIceCandidateInit) => void;
    onTrack: (s: readonly MediaStream[]) => void;
    onConnectionStateChange: (s: RTCPeerConnectionState) => void;
    onIceConnectionStateChange: (s: RTCIceConnectionState) => void;
  };
  addLocalStream: Mock;
  createOffer: Mock;
  createAnswer: Mock;
  applyAnswer: Mock;
  applyRenegotiateOffer: Mock;
  createIceRestartOffer: Mock;
  addIceCandidate: Mock;
  close: Mock;
  connectionState: RTCPeerConnectionState;
}

// Each test resets this array.
const peerSessionRegistry: MockPeerSession[] = [];
(globalThis as Record<string, unknown>).__peerSessionRegistry__ = peerSessionRegistry;

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/src/lib/calls/callSignaling', () => ({
  wrapAndPublish: vi.fn().mockResolvedValue(undefined),
  encodeOffer: vi.fn().mockReturnValue({ kind: 25050, content: '', tags: [], pubkey: '', created_at: 0 }),
  encodeAnswer: vi.fn().mockReturnValue({ kind: 25051, content: '', tags: [], pubkey: '', created_at: 0 }),
  encodeIceCandidate: vi.fn().mockReturnValue({ kind: 25052, content: '', tags: [], pubkey: '', created_at: 0 }),
  encodeHangup: vi.fn().mockReturnValue({ kind: 25053, content: '', tags: [], pubkey: '', created_at: 0 }),
  encodeReject: vi.fn().mockReturnValue({ kind: 25054, content: '', tags: [], pubkey: '', created_at: 0 }),
  encodeRenegotiate: vi.fn().mockReturnValue({ kind: 25055, content: '', tags: [], pubkey: '', created_at: 0 }),
}));

vi.mock('@/src/lib/calls/mediaManager', () => {
  const stream = {
    getTracks: vi.fn().mockReturnValue([]),
    getAudioTracks: vi.fn().mockReturnValue([{ enabled: true }]),
    getVideoTracks: vi.fn().mockReturnValue([]),
  };
  // Expose the stream via globalThis so test bodies can reference it.
  (globalThis as Record<string, unknown>).__mockStream__ = stream;
  return {
    acquireMedia: vi.fn().mockResolvedValue({ stream, audioTrack: {}, videoTrack: null }),
    muteAudio: vi.fn(),
    disableVideo: vi.fn(),
    releaseMedia: vi.fn(),
  };
});

vi.mock('@/src/lib/calls/turnConfig', () => ({
  getIceConfig: vi.fn().mockReturnValue({ iceServers: [], iceTransportPolicy: 'all' }),
}));

vi.mock('@/src/lib/calls/peerSession', () => {
  class PeerSession {
    callbacks: unknown;
    addLocalStream = vi.fn();
    createOffer = vi.fn().mockResolvedValue({ type: 'offer', sdp: 'fake-offer-sdp' });
    createAnswer = vi.fn().mockResolvedValue({ type: 'answer', sdp: 'fake-answer-sdp' });
    applyAnswer = vi.fn().mockResolvedValue(undefined);
    applyRenegotiateOffer = vi.fn().mockResolvedValue({ type: 'answer', sdp: 'fake-reneg-answer' });
    createIceRestartOffer = vi.fn().mockResolvedValue({ type: 'offer', sdp: 'fake-restart-offer' });
    addIceCandidate = vi.fn().mockResolvedValue(undefined);
    close = vi.fn();
    connectionState: RTCPeerConnectionState = 'new';

    constructor(_iceConfig: unknown, cbs: unknown) {
      this.callbacks = cbs;
      const reg = (globalThis as Record<string, unknown>).__peerSessionRegistry__;
      if (Array.isArray(reg)) reg.push(this);
    }
  }
  return { PeerSession };
});

// ── Lazy imports (after mocks are declared) ───────────────────────────────────

import { CallManager } from '@/src/lib/calls/callManager';
import {
  wrapAndPublish,
  encodeReject,
  encodeHangup,
  encodeRenegotiate,
  encodeOffer,
} from '@/src/lib/calls/callSignaling';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const OWN_PUBKEY = 'a'.repeat(64);
const PEER_A = 'b'.repeat(64);
const PEER_B = 'c'.repeat(64);
const PEER_C = 'd'.repeat(64);
const CALL_ID = '11111111-1111-1111-1111-111111111111';

function makeDeps(overrides: Partial<Parameters<typeof CallManager['prototype']['handleEvent']>> = {}): ConstructorParameters<typeof CallManager>[0] {
  return {
    pubkeyHex: OWN_PUBKEY,
    privateKeyHex: '0'.repeat(64),
    signer: {
      signEvent: vi.fn(),
      getPublicKey: vi.fn().mockResolvedValue(OWN_PUBKEY),
      nip44: { encrypt: vi.fn(), decrypt: vi.fn() },
    } as unknown as import('applesauce-core').EventSigner,
    ndk: {} as import('@nostr-dev-kit/ndk').default,
    getGroupRoster: vi.fn().mockResolvedValue([OWN_PUBKEY, PEER_A, PEER_B]),
    ...(overrides as object),
  };
}

function makeOfferEvent(overrides: Partial<IncomingCallEvent> = {}): IncomingCallEvent {
  return {
    kind: 25050,
    callId: CALL_ID,
    senderPubkey: PEER_A,
    callType: 'voice',
    sdp: 'offer-sdp-content',
    recipientPubkeys: [OWN_PUBKEY, PEER_B],
    innerEventId: 'inner-id-1',
    ...overrides,
  };
}

/** Convenience accessor for the mock stream created in the mediaManager vi.mock factory. */
function getMockStream(): MediaStream {
  return (globalThis as Record<string, unknown>).__mockStream__ as MediaStream;
}

// ── Test lifecycle ────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
  callStore.clearAll();
  peerSessionRegistry.length = 0;
  vi.clearAllMocks();
  // Restore default resolved values after clearAllMocks
  (wrapAndPublish as Mock).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  callStore.clearAll();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CallManager', () => {

  // ── T1 ────────────────────────────────────────────────────────────────────

  describe('T1: Incoming offer → callStore.incoming is set', () => {
    it('sets incoming with callId, callerPubkey, callType', async () => {
      const manager = new CallManager(makeDeps());
      await manager.handleEvent(makeOfferEvent());

      const state = callStore.getSnapshot();
      expect(state.incoming).not.toBeNull();
      expect(state.incoming!.callId).toBe(CALL_ID);
      expect(state.incoming!.callerPubkey).toBe(PEER_A);
      expect(state.incoming!.callType).toBe('voice');
      expect(state.active).toBeNull();

      manager.destroy();
    });
  });

  // ── T2 ────────────────────────────────────────────────────────────────────

  describe('T2: declineCall() sends 25054 Reject and clears callStore', () => {
    it('sends reject to peers and own pubkey (multi-device echo), then clears store', async () => {
      const manager = new CallManager(makeDeps());
      await manager.handleEvent(makeOfferEvent());
      expect(callStore.getSnapshot().incoming).not.toBeNull();

      await manager.declineCall(CALL_ID);

      expect(encodeReject).toHaveBeenCalledWith(
        expect.objectContaining({ callId: CALL_ID, senderPubkeyHex: OWN_PUBKEY }),
      );
      const destinations = (wrapAndPublish as Mock).mock.calls.map((c) => c[1] as string);
      expect(destinations).toContain(OWN_PUBKEY);

      const state = callStore.getSnapshot();
      expect(state.incoming).toBeNull();
      expect(state.active).toBeNull();

      manager.destroy();
    });
  });

  // ── T3 ────────────────────────────────────────────────────────────────────

  describe('T3: Ring timeout (45s) → auto-decline', () => {
    it('auto-declines after 45 seconds', async () => {
      const manager = new CallManager(makeDeps());
      await manager.handleEvent(makeOfferEvent());
      expect(callStore.getSnapshot().incoming).not.toBeNull();

      vi.advanceTimersByTime(45_001);
      await vi.runAllTimersAsync();

      expect(encodeReject).toHaveBeenCalled();
      expect(callStore.getSnapshot().incoming).toBeNull();

      manager.destroy();
    });
  });

  // ── T4 ────────────────────────────────────────────────────────────────────

  describe('T4: 5-cap enforcement', () => {
    it('throws when target peers + self exceeds 5', async () => {
      const manager = new CallManager(makeDeps());
      const peers = Array.from({ length: 5 }, (_, i) => String(i).padEnd(64, '0'));

      await expect(
        manager.startCall({ callType: 'voice', groupId: null, targetPubkeys: peers }),
      ).rejects.toThrow(/participant cap exceeded/i);

      manager.destroy();
    });

    it('allows exactly 4 peers + self (5 total)', async () => {
      const manager = new CallManager(makeDeps());
      const peers = Array.from({ length: 4 }, (_, i) => String(i).padEnd(64, '0'));

      await expect(
        manager.startCall({ callType: 'voice', groupId: null, targetPubkeys: peers }),
      ).resolves.toBeUndefined();

      manager.destroy();
    });
  });

  // ── T5 ────────────────────────────────────────────────────────────────────

  describe('T5: Busy auto-reject when already in an active call', () => {
    it('sends 25054 with "busy" and does not enter ringing state', async () => {
      const manager = new CallManager(makeDeps());

      callStore.setActive({
        callId: 'existing-call',
        participants: [],
        localStream: null,
        callType: 'voice',
      });

      await manager.handleEvent(makeOfferEvent({ callId: 'new-call-id' }));

      expect(encodeReject).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'busy', callId: 'new-call-id' }),
      );
      // The existing active call is untouched
      expect(callStore.getSnapshot().active?.callId).toBe('existing-call');

      manager.destroy();
    });
  });

  // ── T6 ────────────────────────────────────────────────────────────────────

  describe('T6: Multi-device echo — acceptCall wraps 25051 to own pubkey', () => {
    it('includes own pubkey in the wrapAndPublish destinations', async () => {
      const manager = new CallManager(makeDeps());
      await manager.handleEvent(makeOfferEvent({ senderPubkey: PEER_A, recipientPubkeys: [OWN_PUBKEY, PEER_B] }));
      await manager.acceptCall(CALL_ID);

      const destinations = (wrapAndPublish as Mock).mock.calls.map((c) => c[1] as string);
      expect(destinations).toContain(OWN_PUBKEY);
      expect(destinations).toContain(PEER_A);

      manager.destroy();
    });
  });

  // ── T7 ────────────────────────────────────────────────────────────────────

  describe('T7: Join mid-call — existing participants initiate offers to new peer', () => {
    it('initiates offer to PEER_C when 25051 broadcast reveals PEER_C as new', async () => {
      const manager = new CallManager(makeDeps());
      // Accept a call from PEER_A
      await manager.handleEvent(makeOfferEvent({ senderPubkey: PEER_A, recipientPubkeys: [OWN_PUBKEY] }));
      await manager.acceptCall(CALL_ID);
      getMockStream(); // ensure mock stream was initialized

      vi.clearAllMocks();
      (wrapAndPublish as Mock).mockResolvedValue(undefined);

      // PEER_A broadcasts a 25051 answer listing PEER_C as a new participant
      await manager.handleEvent({
        kind: 25051,
        callId: CALL_ID,
        senderPubkey: PEER_A,
        sdp: 'peer-a-answer',
        recipientPubkeys: [OWN_PUBKEY, PEER_C],
        innerEventId: 'answer-broadcast',
      });

      // We should have initiated an offer to PEER_C
      expect(encodeOffer).toHaveBeenCalledWith(
        expect.objectContaining({ callId: CALL_ID }),
      );
      const destinations = (wrapAndPublish as Mock).mock.calls.map((c) => c[1] as string);
      expect(destinations).toContain(PEER_C);

      manager.destroy();
    });
  });

  // ── T8 ────────────────────────────────────────────────────────────────────

  describe('T8: Hangup — sends 25053 to all peers and tears down', () => {
    it('sends hangup and clears callStore', async () => {
      const manager = new CallManager(makeDeps());
      await manager.handleEvent(makeOfferEvent({ senderPubkey: PEER_A, recipientPubkeys: [OWN_PUBKEY, PEER_B] }));
      await manager.acceptCall(CALL_ID);

      vi.clearAllMocks();
      (wrapAndPublish as Mock).mockResolvedValue(undefined);

      await manager.hangup();

      expect(encodeHangup).toHaveBeenCalledWith(
        expect.objectContaining({ callId: CALL_ID }),
      );
      expect(wrapAndPublish).toHaveBeenCalled();

      const state = callStore.getSnapshot();
      expect(state.active).toBeNull();
      expect(state.incoming).toBeNull();

      manager.destroy();
    });
  });

  // ── T9 ────────────────────────────────────────────────────────────────────

  describe('T9: ICE restart on PeerSession connectionState === "failed"', () => {
    it('creates an ICE restart offer and sends 25055 renegotiate on first failure', async () => {
      const manager = new CallManager(makeDeps());
      await manager.handleEvent(makeOfferEvent({ senderPubkey: PEER_A, recipientPubkeys: [OWN_PUBKEY] }));
      await manager.acceptCall(CALL_ID);

      vi.clearAllMocks();
      (wrapAndPublish as Mock).mockResolvedValue(undefined);

      // Retrieve the PeerSession created for PEER_A and simulate connection failure
      const session = peerSessionRegistry[0] as MockPeerSession;
      expect(session).toBeDefined();
      (session.createIceRestartOffer as Mock).mockResolvedValue({ type: 'offer', sdp: 'restart-offer' });

      (session.callbacks as { onConnectionStateChange: (s: RTCPeerConnectionState) => void })
        .onConnectionStateChange('failed');

      // Allow async work to flush
      await Promise.resolve();
      await Promise.resolve();

      expect(encodeRenegotiate).toHaveBeenCalledWith(
        expect.objectContaining({ callId: CALL_ID }),
      );
      expect(wrapAndPublish).toHaveBeenCalled();

      manager.destroy();
    });
  });

  // ── T10 ───────────────────────────────────────────────────────────────────

  describe('T10: Multi-device echo receive — 25054 from self stops ringing', () => {
    it('clears incoming state when own pubkey sends a Reject', async () => {
      const manager = new CallManager(makeDeps());
      await manager.handleEvent(makeOfferEvent());
      expect(callStore.getSnapshot().incoming).not.toBeNull();

      await manager.handleEvent({
        kind: 25054,
        callId: CALL_ID,
        senderPubkey: OWN_PUBKEY,
        recipientPubkeys: [PEER_A],
        reason: '',
        innerEventId: 'self-reject',
      });

      expect(callStore.getSnapshot().incoming).toBeNull();

      manager.destroy();
    });
  });

  // ── T11 ───────────────────────────────────────────────────────────────────

  describe('T11: Multi-device echo receive — 25051 from self stops ringing', () => {
    it('clears incoming state when own pubkey sends an Answer', async () => {
      const manager = new CallManager(makeDeps());
      await manager.handleEvent(makeOfferEvent());
      expect(callStore.getSnapshot().incoming).not.toBeNull();

      await manager.handleEvent({
        kind: 25051,
        callId: CALL_ID,
        senderPubkey: OWN_PUBKEY,
        sdp: 'self-device-answered',
        recipientPubkeys: [PEER_A],
        innerEventId: 'self-answer',
      });

      expect(callStore.getSnapshot().incoming).toBeNull();

      manager.destroy();
    });
  });

});
