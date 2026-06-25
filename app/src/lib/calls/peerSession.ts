/**
 * PeerSession — manages one RTCPeerConnection for a (callId, remotePubkey) pair (Story S4).
 *
 * Responsibilities:
 *   - Wrap RTCPeerConnection lifecycle (offer, answer, renegotiation, ICE, close).
 *   - Buffer incoming ICE candidates until a remote description is set, then drain.
 *   - Surface connection-state and ICE-state changes via injected callbacks.
 *
 * Pure library code — no React, no context imports.
 */

import type { IceConfig } from './turnConfig';

// ── Public types ──────────────────────────────────────────────────────────────

export type { IceConfig };

export interface PeerSessionCallbacks {
  /** Called for each non-null local ICE candidate. The caller should relay this to the remote peer. */
  onIceCandidate: (candidate: RTCIceCandidateInit) => void;
  /** Called when the remote peer adds a track (media arrives). */
  onTrack: (streams: readonly MediaStream[]) => void;
  /** Called whenever RTCPeerConnection.connectionState changes. */
  onConnectionStateChange: (state: RTCPeerConnectionState) => void;
  /** Called whenever RTCPeerConnection.iceConnectionState changes. */
  onIceConnectionStateChange: (state: RTCIceConnectionState) => void;
}

// ── PeerSession ───────────────────────────────────────────────────────────────

export class PeerSession {
  private readonly pc: RTCPeerConnection;
  /** ICE candidates buffered while remoteDescription is not yet set. */
  private readonly iceCandidateQueue: RTCIceCandidateInit[] = [];

  constructor(iceConfig: IceConfig, callbacks: PeerSessionCallbacks) {
    this.pc = new RTCPeerConnection({
      iceServers: iceConfig.iceServers,
      iceTransportPolicy: iceConfig.iceTransportPolicy,
    });

    // Wire ICE candidate handler — buffer until remote description is set.
    this.pc.onicecandidate = (event: RTCPeerConnectionIceEvent) => {
      if (event.candidate) {
        callbacks.onIceCandidate(event.candidate.toJSON());
      }
    };

    // Wire track handler.
    this.pc.ontrack = (event: RTCTrackEvent) => {
      callbacks.onTrack(event.streams);
    };

    // Wire connection state changes.
    this.pc.onconnectionstatechange = () => {
      callbacks.onConnectionStateChange(this.pc.connectionState);
    };

    // Wire ICE connection state changes.
    this.pc.oniceconnectionstatechange = () => {
      callbacks.onIceConnectionStateChange(this.pc.iceConnectionState);
    };
  }

  // ── Local media ─────────────────────────────────────────────────────────────

  /**
   * Add all tracks from a local MediaStream to the peer connection.
   * Must be called before createOffer() so the SDP includes the media lines.
   *
   * The tracks belong to a MediaStream shared across every PeerSession in the
   * call; their lifecycle is owned by CallManager via mediaManager.releaseMedia().
   * This session never stops them — see close().
   */
  addLocalStream(stream: MediaStream): void {
    for (const track of stream.getTracks()) {
      this.pc.addTrack(track, stream);
    }
  }

  // ── Offer / Answer ───────────────────────────────────────────────────────────

  /**
   * Create and set a local SDP offer (caller side).
   * Returns the offer SDP for relaying to the remote peer via signaling.
   */
  async createOffer(): Promise<RTCSessionDescriptionInit> {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    return offer;
  }

  /**
   * Apply a remote SDP offer and produce a local answer (callee side).
   * Drains the ICE candidate queue after setting the remote description.
   */
  async createAnswer(remoteSdp: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
    await this.pc.setRemoteDescription(remoteSdp);
    await this.drainIceCandidateQueue();
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    return answer;
  }

  /**
   * Apply a remote SDP answer (after we sent an offer).
   * Drains the ICE candidate queue.
   */
  async applyAnswer(remoteSdp: RTCSessionDescriptionInit): Promise<void> {
    await this.pc.setRemoteDescription(remoteSdp);
    await this.drainIceCandidateQueue();
  }

  /**
   * Apply a renegotiation offer from the remote side (kind 25055) and return an answer.
   * Drains the ICE candidate queue after setting the remote description.
   */
  async applyRenegotiateOffer(remoteSdp: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
    await this.pc.setRemoteDescription(remoteSdp);
    await this.drainIceCandidateQueue();
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    return answer;
  }

  // ── ICE ──────────────────────────────────────────────────────────────────────

  /**
   * Add a remote ICE candidate. If the remote description has not been set yet,
   * the candidate is queued and applied when the remote description is available.
   */
  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.pc.remoteDescription) {
      this.iceCandidateQueue.push(candidate);
      return;
    }
    await this.pc.addIceCandidate(candidate);
  }

  /**
   * Create a new offer with the iceRestart flag set. Used to recover from ICE
   * failures without tearing down the entire call.
   */
  async createIceRestartOffer(): Promise<RTCSessionDescriptionInit> {
    const offer = await this.pc.createOffer({ iceRestart: true });
    await this.pc.setLocalDescription(offer);
    return offer;
  }

  // ── Drain queue ──────────────────────────────────────────────────────────────

  private async drainIceCandidateQueue(): Promise<void> {
    const queued = this.iceCandidateQueue.splice(0);
    for (const candidate of queued) {
      await this.pc.addIceCandidate(candidate);
    }
  }

  // ── Close ────────────────────────────────────────────────────────────────────

  /**
   * Close the peer connection only.
   *
   * Does NOT stop the local media tracks: the same MediaStream is shared across
   * every PeerSession in the call, so stopping its tracks here would kill the
   * local mic/camera for all other legs when one peer leaves a 3+ party call.
   * The shared stream is released exactly once by CallManager at call teardown
   * (mediaManager.releaseMedia). Closing the RTCPeerConnection releases this
   * leg's RTP senders without touching the underlying tracks.
   */
  close(): void {
    this.pc.close();
  }

  // ── State accessors ──────────────────────────────────────────────────────────

  /**
   * Current RTCPeerConnection connection state.
   */
  get connectionState(): RTCPeerConnectionState {
    return this.pc.connectionState;
  }
}
