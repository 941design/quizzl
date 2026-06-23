/**
 * Unit tests for peerSession.ts — Story S4.
 *
 * Tests:
 *   T1.  addLocalStream() calls pc.addTrack for each track.
 *   T2.  createOffer() calls pc.createOffer, pc.setLocalDescription, returns the SDP.
 *   T3.  createAnswer() calls pc.setRemoteDescription, pc.createAnswer, pc.setLocalDescription.
 *   T4.  applyAnswer() calls pc.setRemoteDescription and drains the ICE queue.
 *   T5.  addIceCandidate() queues when no remote description; drains after applyAnswer().
 *   T6a. onIceCandidate callback fires when pc.onicecandidate is triggered.
 *   T6b. onTrack callback fires when pc.ontrack is triggered.
 *   T6c. onConnectionStateChange fires when pc.onconnectionstatechange is triggered.
 *   T6d. onIceConnectionStateChange fires when pc.oniceconnectionstatechange is triggered.
 *   T7.  close() calls pc.close() and stops all local tracks.
 *   T8.  connectionState getter returns pc.connectionState.
 *   T9.  applyRenegotiateOffer() applies remote SDP and returns a local answer.
 *   T10. createIceRestartOffer() calls pc.createOffer with iceRestart:true.
 *
 * Mocking strategy:
 *   RTCPeerConnection is replaced with a class mock via vi.stubGlobal. Each fake
 *   instance tracks calls and exposes the event-handler properties so tests can
 *   trigger events synthetically.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PeerSession } from '@/src/lib/calls/peerSession';
import type { IceConfig } from '@/src/lib/calls/peerSession';

// ── Fake RTCPeerConnection ────────────────────────────────────────────────────

interface FakePc {
  // Public mock API
  createOffer: ReturnType<typeof vi.fn>;
  createAnswer: ReturnType<typeof vi.fn>;
  setLocalDescription: ReturnType<typeof vi.fn>;
  setRemoteDescription: ReturnType<typeof vi.fn>;
  addIceCandidate: ReturnType<typeof vi.fn>;
  addTrack: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;

  // Event handler slots (set by PeerSession constructor)
  onicecandidate: ((event: Partial<RTCPeerConnectionIceEvent>) => void) | null;
  ontrack: ((event: Partial<RTCTrackEvent>) => void) | null;
  onconnectionstatechange: (() => void) | null;
  oniceconnectionstatechange: (() => void) | null;

  // State
  remoteDescription: RTCSessionDescriptionInit | null;
  connectionState: RTCPeerConnectionState;
  iceConnectionState: RTCIceConnectionState;
}

const FAKE_OFFER: RTCSessionDescriptionInit = { type: 'offer', sdp: 'v=0\r\ns=offer\r\n' };
const FAKE_ANSWER: RTCSessionDescriptionInit = { type: 'answer', sdp: 'v=0\r\ns=answer\r\n' };

function makeFakePcInstance(): FakePc {
  return {
    createOffer: vi.fn().mockResolvedValue(FAKE_OFFER),
    createAnswer: vi.fn().mockResolvedValue(FAKE_ANSWER),
    setLocalDescription: vi.fn().mockResolvedValue(undefined),
    setRemoteDescription: vi.fn().mockImplementation(function (
      this: FakePc,
      sdp: RTCSessionDescriptionInit,
    ) {
      this.remoteDescription = sdp;
      return Promise.resolve();
    }),
    addIceCandidate: vi.fn().mockResolvedValue(undefined),
    addTrack: vi.fn(),
    close: vi.fn(),

    onicecandidate: null,
    ontrack: null,
    onconnectionstatechange: null,
    oniceconnectionstatechange: null,

    remoteDescription: null,
    connectionState: 'new',
    iceConnectionState: 'new',
  };
}

// Track the most recent fake instance so tests can access it.
// IMPORTANT: this must point at the actual FakeRTCPeerConnection `this` so that
// mutations like `pc.connectionState = 'connecting'` are visible to the PeerSession.
let lastFakePc: FakePc;

class FakeRTCPeerConnection implements FakePc {
  createOffer = vi.fn().mockResolvedValue(FAKE_OFFER);
  createAnswer = vi.fn().mockResolvedValue(FAKE_ANSWER);
  setLocalDescription = vi.fn().mockResolvedValue(undefined);
  addIceCandidate = vi.fn().mockResolvedValue(undefined);
  addTrack = vi.fn();
  close = vi.fn();

  onicecandidate: ((event: Partial<RTCPeerConnectionIceEvent>) => void) | null = null;
  ontrack: ((event: Partial<RTCTrackEvent>) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  oniceconnectionstatechange: (() => void) | null = null;

  remoteDescription: RTCSessionDescriptionInit | null = null;
  connectionState: RTCPeerConnectionState = 'new';
  iceConnectionState: RTCIceConnectionState = 'new';

  setRemoteDescription = vi.fn().mockImplementation((sdp: RTCSessionDescriptionInit) => {
    this.remoteDescription = sdp;
    return Promise.resolve();
  });

  constructor(_config?: RTCConfiguration) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    lastFakePc = this as unknown as FakePc;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const TEST_ICE_CONFIG: IceConfig = {
  iceServers: [{ urls: 'stun:stun.example.com:3478' }],
  iceTransportPolicy: 'all',
};

function makeCallbacks() {
  return {
    onIceCandidate: vi.fn(),
    onTrack: vi.fn(),
    onConnectionStateChange: vi.fn(),
    onIceConnectionStateChange: vi.fn(),
  };
}

function makeFakeTrack(): MediaStreamTrack {
  return { kind: 'audio', stop: vi.fn() } as unknown as MediaStreamTrack;
}

function makeFakeStream(...tracks: MediaStreamTrack[]): MediaStream {
  return {
    getTracks: () => tracks,
  } as unknown as MediaStream;
}

function makeFakeCandidate(candidateStr: string): RTCIceCandidateInit {
  return { candidate: candidateStr, sdpMid: '0', sdpMLineIndex: 0 };
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('PeerSession', () => {
  beforeEach(() => {
    vi.stubGlobal('RTCPeerConnection', FakeRTCPeerConnection);
  });

  // ── T1: addLocalStream ────────────────────────────────────────────────────

  describe('addLocalStream', () => {
    it('T1: calls pc.addTrack for each track in the stream', () => {
      const callbacks = makeCallbacks();
      const session = new PeerSession(TEST_ICE_CONFIG, callbacks);
      const pc = lastFakePc;

      const track1 = makeFakeTrack();
      const track2 = makeFakeTrack();
      const stream = makeFakeStream(track1, track2);

      session.addLocalStream(stream);

      expect(pc.addTrack).toHaveBeenCalledTimes(2);
      expect(pc.addTrack).toHaveBeenCalledWith(track1, stream);
      expect(pc.addTrack).toHaveBeenCalledWith(track2, stream);
    });

    it('T1: no-ops when stream has no tracks', () => {
      const session = new PeerSession(TEST_ICE_CONFIG, makeCallbacks());
      const pc = lastFakePc;

      session.addLocalStream(makeFakeStream());

      expect(pc.addTrack).not.toHaveBeenCalled();
    });
  });

  // ── T2: createOffer ───────────────────────────────────────────────────────

  describe('createOffer', () => {
    it('T2: calls pc.createOffer, pc.setLocalDescription, and returns the SDP', async () => {
      const session = new PeerSession(TEST_ICE_CONFIG, makeCallbacks());
      const pc = lastFakePc;

      const result = await session.createOffer();

      expect(pc.createOffer).toHaveBeenCalledOnce();
      expect(pc.setLocalDescription).toHaveBeenCalledOnce();
      expect(pc.setLocalDescription).toHaveBeenCalledWith(FAKE_OFFER);
      expect(result).toBe(FAKE_OFFER);
    });
  });

  // ── T3: createAnswer ──────────────────────────────────────────────────────

  describe('createAnswer', () => {
    it('T3: calls setRemoteDescription, createAnswer, setLocalDescription in order', async () => {
      const session = new PeerSession(TEST_ICE_CONFIG, makeCallbacks());
      const pc = lastFakePc;
      const callOrder: string[] = [];

      // Wrap the existing mock to record call order while still updating remoteDescription
      const origSetRemote = pc.setRemoteDescription;
      pc.setRemoteDescription = vi.fn().mockImplementation(
        (sdp: RTCSessionDescriptionInit) => {
          callOrder.push('setRemoteDescription');
          return origSetRemote(sdp);
        },
      );
      const origCreateAnswer = pc.createAnswer;
      pc.createAnswer = vi.fn().mockImplementation(() => {
        callOrder.push('createAnswer');
        return origCreateAnswer();
      });
      const origSetLocal = pc.setLocalDescription;
      pc.setLocalDescription = vi.fn().mockImplementation((sdp: RTCSessionDescriptionInit) => {
        callOrder.push('setLocalDescription');
        return origSetLocal(sdp);
      });

      const result = await session.createAnswer(FAKE_OFFER);

      expect(callOrder).toEqual(['setRemoteDescription', 'createAnswer', 'setLocalDescription']);
      expect(result).toBe(FAKE_ANSWER);
    });

    it('T3: returns the answer SDP from pc.createAnswer', async () => {
      const session = new PeerSession(TEST_ICE_CONFIG, makeCallbacks());
      const result = await session.createAnswer(FAKE_OFFER);
      expect(result).toEqual(FAKE_ANSWER);
    });
  });

  // ── T4: applyAnswer ───────────────────────────────────────────────────────

  describe('applyAnswer', () => {
    it('T4: calls pc.setRemoteDescription with the remote SDP', async () => {
      const session = new PeerSession(TEST_ICE_CONFIG, makeCallbacks());
      const pc = lastFakePc;

      await session.applyAnswer(FAKE_ANSWER);

      expect(pc.setRemoteDescription).toHaveBeenCalledOnce();
      expect(pc.setRemoteDescription).toHaveBeenCalledWith(FAKE_ANSWER);
    });
  });

  // ── T5: ICE candidate queuing ─────────────────────────────────────────────

  describe('addIceCandidate (queuing)', () => {
    it('T5: queues candidates when no remote description is set, then drains on applyAnswer', async () => {
      const session = new PeerSession(TEST_ICE_CONFIG, makeCallbacks());
      const pc = lastFakePc;

      const c1 = makeFakeCandidate('candidate:1');
      const c2 = makeFakeCandidate('candidate:2');

      // Remote description not yet set — should queue
      await session.addIceCandidate(c1);
      await session.addIceCandidate(c2);
      expect(pc.addIceCandidate).not.toHaveBeenCalled();

      // applyAnswer sets the remote description → queue drains
      await session.applyAnswer(FAKE_ANSWER);

      expect(pc.addIceCandidate).toHaveBeenCalledTimes(2);
      expect(pc.addIceCandidate).toHaveBeenNthCalledWith(1, c1);
      expect(pc.addIceCandidate).toHaveBeenNthCalledWith(2, c2);
    });

    it('T5: passes candidates directly when remote description is already set', async () => {
      const session = new PeerSession(TEST_ICE_CONFIG, makeCallbacks());
      const pc = lastFakePc;

      await session.applyAnswer(FAKE_ANSWER); // sets remote description
      pc.addIceCandidate.mockClear();

      const c1 = makeFakeCandidate('candidate:3');
      await session.addIceCandidate(c1);

      expect(pc.addIceCandidate).toHaveBeenCalledOnce();
      expect(pc.addIceCandidate).toHaveBeenCalledWith(c1);
    });

    it('T5: drains the queue after createAnswer too', async () => {
      const session = new PeerSession(TEST_ICE_CONFIG, makeCallbacks());
      const pc = lastFakePc;

      const c1 = makeFakeCandidate('candidate:4');
      await session.addIceCandidate(c1);
      expect(pc.addIceCandidate).not.toHaveBeenCalled();

      await session.createAnswer(FAKE_OFFER);
      expect(pc.addIceCandidate).toHaveBeenCalledOnce();
      expect(pc.addIceCandidate).toHaveBeenCalledWith(c1);
    });
  });

  // ── T6a: onIceCandidate callback ──────────────────────────────────────────

  describe('callbacks — onIceCandidate', () => {
    it('T6a: fires when pc.onicecandidate is triggered with a non-null candidate', () => {
      const callbacks = makeCallbacks();
      new PeerSession(TEST_ICE_CONFIG, callbacks);
      const pc = lastFakePc;

      const fakeCandidate = {
        toJSON: () => ({ candidate: 'candidate:99', sdpMid: '0', sdpMLineIndex: 0 }),
      };

      // Simulate the browser firing onicecandidate
      pc.onicecandidate!({ candidate: fakeCandidate } as unknown as RTCPeerConnectionIceEvent);

      expect(callbacks.onIceCandidate).toHaveBeenCalledOnce();
      expect(callbacks.onIceCandidate).toHaveBeenCalledWith(fakeCandidate.toJSON());
    });

    it('T6a: does not fire when candidate is null (end-of-candidates)', () => {
      const callbacks = makeCallbacks();
      new PeerSession(TEST_ICE_CONFIG, callbacks);
      const pc = lastFakePc;

      pc.onicecandidate!({ candidate: null } as RTCPeerConnectionIceEvent);

      expect(callbacks.onIceCandidate).not.toHaveBeenCalled();
    });
  });

  // ── T6b: onTrack callback ─────────────────────────────────────────────────

  describe('callbacks — onTrack', () => {
    it('T6b: fires with the event streams when pc.ontrack is triggered', () => {
      const callbacks = makeCallbacks();
      new PeerSession(TEST_ICE_CONFIG, callbacks);
      const pc = lastFakePc;

      const fakeStreams = [{ id: 'stream-1' }] as unknown as MediaStream[];
      pc.ontrack!({ streams: fakeStreams } as unknown as RTCTrackEvent);

      expect(callbacks.onTrack).toHaveBeenCalledOnce();
      expect(callbacks.onTrack).toHaveBeenCalledWith(fakeStreams);
    });
  });

  // ── T6c: onConnectionStateChange callback ─────────────────────────────────

  describe('callbacks — onConnectionStateChange', () => {
    it('T6c: fires with the current connectionState', () => {
      const callbacks = makeCallbacks();
      new PeerSession(TEST_ICE_CONFIG, callbacks);
      const pc = lastFakePc;

      pc.connectionState = 'connected';
      pc.onconnectionstatechange!();

      expect(callbacks.onConnectionStateChange).toHaveBeenCalledOnce();
      expect(callbacks.onConnectionStateChange).toHaveBeenCalledWith('connected');
    });
  });

  // ── T6d: onIceConnectionStateChange callback ──────────────────────────────

  describe('callbacks — onIceConnectionStateChange', () => {
    it('T6d: fires with the current iceConnectionState', () => {
      const callbacks = makeCallbacks();
      new PeerSession(TEST_ICE_CONFIG, callbacks);
      const pc = lastFakePc;

      pc.iceConnectionState = 'checking';
      pc.oniceconnectionstatechange!();

      expect(callbacks.onIceConnectionStateChange).toHaveBeenCalledOnce();
      expect(callbacks.onIceConnectionStateChange).toHaveBeenCalledWith('checking');
    });
  });

  // ── T7: close ─────────────────────────────────────────────────────────────

  describe('close', () => {
    it('T7: calls pc.close()', () => {
      const session = new PeerSession(TEST_ICE_CONFIG, makeCallbacks());
      const pc = lastFakePc;

      session.close();

      expect(pc.close).toHaveBeenCalledOnce();
    });

    it('T7: stops all local tracks that were added via addLocalStream', () => {
      const session = new PeerSession(TEST_ICE_CONFIG, makeCallbacks());

      const track1 = makeFakeTrack();
      const track2 = makeFakeTrack();
      session.addLocalStream(makeFakeStream(track1, track2));

      session.close();

      expect(track1.stop).toHaveBeenCalledOnce();
      expect(track2.stop).toHaveBeenCalledOnce();
    });

    it('T7: works with no local tracks (no tracks added)', () => {
      const session = new PeerSession(TEST_ICE_CONFIG, makeCallbacks());
      expect(() => session.close()).not.toThrow();
    });
  });

  // ── T8: connectionState getter ────────────────────────────────────────────

  describe('connectionState', () => {
    it('T8: returns pc.connectionState', () => {
      const session = new PeerSession(TEST_ICE_CONFIG, makeCallbacks());
      const pc = lastFakePc;

      pc.connectionState = 'connecting';
      expect(session.connectionState).toBe('connecting');

      pc.connectionState = 'connected';
      expect(session.connectionState).toBe('connected');
    });
  });

  // ── T9: applyRenegotiateOffer ─────────────────────────────────────────────

  describe('applyRenegotiateOffer', () => {
    it('T9: applies remote SDP, creates answer, sets local description, returns answer', async () => {
      const session = new PeerSession(TEST_ICE_CONFIG, makeCallbacks());
      const pc = lastFakePc;

      const renoffer: RTCSessionDescriptionInit = { type: 'offer', sdp: 'v=0\r\ns=renego\r\n' };
      const result = await session.applyRenegotiateOffer(renoffer);

      expect(pc.setRemoteDescription).toHaveBeenCalledWith(renoffer);
      expect(pc.createAnswer).toHaveBeenCalledOnce();
      expect(pc.setLocalDescription).toHaveBeenCalledWith(FAKE_ANSWER);
      expect(result).toBe(FAKE_ANSWER);
    });
  });

  // ── T10: createIceRestartOffer ────────────────────────────────────────────

  describe('createIceRestartOffer', () => {
    it('T10: calls pc.createOffer with iceRestart:true', async () => {
      const session = new PeerSession(TEST_ICE_CONFIG, makeCallbacks());
      const pc = lastFakePc;

      const result = await session.createIceRestartOffer();

      expect(pc.createOffer).toHaveBeenCalledWith({ iceRestart: true });
      expect(pc.setLocalDescription).toHaveBeenCalledWith(FAKE_OFFER);
      expect(result).toBe(FAKE_OFFER);
    });
  });
});
