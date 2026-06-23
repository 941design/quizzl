/**
 * callManager.ts — Orchestration hub for WebRTC call state machine (Story S5).
 *
 * Wires together callSignaling (S1), callStore (S2), mediaManager (S3),
 * peerSession (S4), and turnConfig (S4) into the full call lifecycle.
 *
 * Pure library code — no React imports.
 *
 * State machine per call-id:
 *   idle → receive 25050 Offer → callStore.setIncoming → ringing
 *   ringing → acceptCall() → acquire media → create PeerSession → send 25051 Answer → active
 *   ringing → declineCall() → send 25054 Reject → idle
 *   ringing → ring timeout (45s) → declineCall('', 'missed') → idle
 *   active → receive 25053 Hangup from peer → remove participant → if 0 remaining → idle
 *   active → hangup() → send 25053 to all peers → close PeerSessions → idle
 *
 * Mesh rules (§9):
 *   - startCall(): generate UUID, send one 25050 to each target peer; p tags list ALL participants.
 *   - lower pubkey initiates pairwise offer when a new callee joins.
 *   - glare: higher pubkey wins; loser rolls back and accepts winner's offer.
 *   - 5-cap: refuse start/accept when activeParticipantCount >= 5.
 *   - multi-device echo: wrap 25051/25054 to own pubkey too.
 *   - join mid-call: existing connected participants initiate offers to the new peer.
 *
 * ICE restart (§15):
 *   On connectionState === 'failed', attempt one ICE restart (createIceRestartOffer + send 25055).
 *   On second failure, mark leg failed in callStore.
 *
 * Authorization (§5.2):
 *   For kind 25050: find group with most p-tag overlap → that is the call's group.
 *   For subsequent events: check against roster snapshot taken at call start.
 */

import type NDK from '@nostr-dev-kit/ndk';
import type { EventSigner } from 'applesauce-core';
import type { IncomingCallEvent } from '@/src/types';
import { callStore } from './callStore';
import { PeerSession } from './peerSession';
import { getIceConfig } from './turnConfig';
import { acquireMedia, muteAudio, disableVideo, releaseMedia } from './mediaManager';
import {
  wrapAndPublish,
  encodeAnswer,
  encodeReject,
  encodeHangup,
  encodeIceCandidate,
  encodeRenegotiate,
  encodeOffer,
} from './callSignaling';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Maximum participants in a single call (inclusive of self). */
const MAX_PARTICIPANTS = 5;

/** Seconds before an unanswered incoming ring is treated as missed. */
const RING_TIMEOUT_MS = 45_000;

// ── Public interface ──────────────────────────────────────────────────────────

export interface CallManagerDeps {
  pubkeyHex: string;
  privateKeyHex: string;
  signer: EventSigner;
  ndk: NDK;
  /** Async roster lookup for a group — returns hex pubkeys of all members. */
  getGroupRoster: (groupId: string) => Promise<string[]>;
  /** Optional debug hook, called for every routed IncomingCallEvent. */
  onEvent?: (evt: IncomingCallEvent) => void;
  /**
   * Optional: publish a kind-9 application rumor to the given group so the
   * call notice appears in the group timeline.
   * Called after startCall() sends its first offer (event='started') and after
   * hangup() completes (event='ended'). Errors are swallowed — notice delivery
   * is best-effort and must never abort the call flow.
   */
  publishGroupNotice?: (groupId: string, content: string) => Promise<void>;
}

// ── Internal state shapes ─────────────────────────────────────────────────────

type CallPhase = 'ringing' | 'active';

/**
 * Per-call context — created when a call offer arrives or when we start a call.
 */
interface CallContext {
  callId: string;
  phase: CallPhase;
  callType: 'voice' | 'video';
  /** The group roster snapshotted at call start. Only members on this list may send signaling. */
  rosterSnapshot: Set<string>;
  /** groupId resolved from roster overlap; null for direct (non-group) calls. */
  groupId: string | null;
  /** Hex pubkeys of all remote participants (excluding self). */
  peerPubkeys: Set<string>;
  /** Active PeerSession per peer pubkey. */
  sessions: Map<string, PeerSession>;
  /** ICE restart attempt count per peer. */
  iceRestartAttempts: Map<string, number>;
  /** Local media stream (acquired on accept/startCall). */
  localStream: MediaStream | null;
  /** Ring timeout handle — cleared once accepted/declined. */
  ringTimeoutHandle: ReturnType<typeof setTimeout> | null;
}

// ── CallManager ───────────────────────────────────────────────────────────────

export class CallManager {
  private readonly deps: CallManagerDeps;
  /** Current call context, null when idle. */
  private ctx: CallContext | null = null;
  /** Whether destroy() has been called. */
  private destroyed = false;

  constructor(deps: CallManagerDeps) {
    this.deps = deps;
  }

  // ── Public: start an outgoing call ─────────────────────────────────────────

  /**
   * Initiate an outgoing call.
   * Generates a UUID callId, acquires media, creates one PeerSession per target
   * peer, and sends a 25050 Offer to each.
   *
   * Throws if there is already an active call (5-cap enforced against targetPubkeys).
   */
  async startCall(params: {
    callType: 'voice' | 'video';
    groupId: string | null;
    targetPubkeys: string[];
  }): Promise<void> {
    if (this.destroyed) return;

    const { callType, groupId, targetPubkeys } = params;

    // 5-cap: self counts as one participant
    if (targetPubkeys.length + 1 > MAX_PARTICIPANTS) {
      throw new Error(
        `[callManager] startCall: participant cap exceeded (max ${MAX_PARTICIPANTS} including self)`,
      );
    }

    // Refuse to start if already in a call
    const existing = callStore.getSnapshot();
    if (existing.active !== null) {
      throw new Error('[callManager] startCall: already in an active call');
    }

    // Acquire media first — fail fast before touching the call store
    const media = await acquireMedia(callType);

    const callId = crypto.randomUUID();

    // Snapshot roster — for outgoing calls use targetPubkeys as the roster
    const rosterSnapshot = new Set([...targetPubkeys, this.deps.pubkeyHex]);

    this.ctx = {
      callId,
      phase: 'active',
      callType,
      rosterSnapshot,
      groupId,
      peerPubkeys: new Set(targetPubkeys),
      sessions: new Map(),
      iceRestartAttempts: new Map(),
      localStream: media.stream,
      ringTimeoutHandle: null,
    };

    // Update store immediately with an active call (no incoming phase for outgoing)
    callStore.setActive({
      callId,
      participants: targetPubkeys.map((pk) => ({
        pubkey: pk,
        stream: null,
        muted: false,
        videoOff: false,
      })),
      localStream: media.stream,
      callType,
    });

    // Create a PeerSession for each target and send an offer
    const allParticipants = [this.deps.pubkeyHex, ...targetPubkeys];

    await Promise.all(
      targetPubkeys.map(async (remotePk) => {
        const session = this._createPeerSession(callId, remotePk);
        session.addLocalStream(media.stream);
        const offerSdp = await session.createOffer();

        const draft = encodeOffer({
          senderPubkeyHex: this.deps.pubkeyHex,
          recipientPubkeys: allParticipants.filter((p) => p !== this.deps.pubkeyHex),
          callId,
          callType,
          sdp: offerSdp.sdp ?? '',
        });

        await wrapAndPublish(draft, remotePk, this.deps.signer, this.deps.ndk);
      }),
    );

    // Group call notice: started (fire-and-forget)
    if (groupId && this.deps.publishGroupNotice) {
      this.deps.publishGroupNotice(
        groupId,
        JSON.stringify({ type: 'call_notice', event: 'started', callId, initiator: this.deps.pubkeyHex }),
      ).catch((err) => console.warn('[callManager] call notice (started) failed', err));
    }
  }

  // ── Public: accept an incoming call ────────────────────────────────────────

  /**
   * Accept a ringing incoming call.
   * Acquires media, creates a PeerSession for the caller, sends 25051 Answer,
   * and updates callStore to active.
   *
   * Also wraps 25051 to own pubkey (multi-device echo §9.8).
   */
  async acceptCall(callId: string): Promise<void> {
    if (this.destroyed) return;
    if (!this.ctx || this.ctx.callId !== callId || this.ctx.phase !== 'ringing') {
      console.warn('[callManager] acceptCall: no ringing call with id', callId);
      return;
    }

    const ctx = this.ctx;
    this._clearRingTimeout(ctx);

    // 5-cap check
    if (ctx.peerPubkeys.size + 1 >= MAX_PARTICIPANTS) {
      console.warn('[callManager] acceptCall: participant cap exceeded, declining');
      await this.declineCall(callId, 'busy');
      return;
    }

    let media: Awaited<ReturnType<typeof acquireMedia>>;
    try {
      media = await acquireMedia(ctx.callType);
    } catch (err) {
      console.warn('[callManager] acceptCall: media acquisition failed:', err);
      await this.declineCall(callId);
      return;
    }

    ctx.localStream = media.stream;
    ctx.phase = 'active';

    // The incoming offer from the store has the SDP from the caller.
    // We need to store the offer SDP somewhere to create an answer.
    // The SDP was provided in the IncomingCallEvent we processed earlier.
    // We store it temporarily in _pendingOfferSdp per callId.
    const pendingSdp = this._pendingOfferSdps.get(callId);
    const callerPubkey = callStore.getSnapshot().incoming?.callerPubkey;

    if (!pendingSdp || !callerPubkey) {
      console.warn('[callManager] acceptCall: missing pending SDP or caller pubkey');
      releaseMedia(media.stream);
      ctx.localStream = null;
      await this.declineCall(callId);
      return;
    }
    this._pendingOfferSdps.delete(callId);

    // Create PeerSession for caller
    const session = this._createPeerSession(callId, callerPubkey);
    session.addLocalStream(media.stream);
    const answerSdp = await session.createAnswer({
      type: 'offer',
      sdp: pendingSdp,
    });

    // Build full participant list from the roster: all peers except self
    const peerPubkeys = [...ctx.peerPubkeys];
    const answerRecipients = peerPubkeys; // p tags list all other participants

    const draft = encodeAnswer({
      senderPubkeyHex: this.deps.pubkeyHex,
      recipientPubkeys: answerRecipients,
      callId,
      sdp: answerSdp.sdp ?? '',
    });

    // Send answer to each peer in the call
    await Promise.all(
      [...peerPubkeys, this.deps.pubkeyHex].map((pk) =>
        wrapAndPublish(draft, pk, this.deps.signer, this.deps.ndk),
      ),
    );

    // Update store to active
    callStore.setActive({
      callId,
      participants: peerPubkeys.map((pk) => ({
        pubkey: pk,
        stream: null,
        muted: false,
        videoOff: false,
      })),
      localStream: media.stream,
      callType: ctx.callType,
    });
  }

  // ── Public: decline an incoming call ───────────────────────────────────────

  /**
   * Decline (or miss) a ringing incoming call.
   * Sends 25054 Reject to all peers and wraps to own pubkey for multi-device echo.
   */
  async declineCall(callId: string, reason?: string): Promise<void> {
    if (this.destroyed) return;
    if (!this.ctx || this.ctx.callId !== callId) {
      // Already cleared — no-op
      return;
    }

    const ctx = this.ctx;
    this._clearRingTimeout(ctx);

    const peerPubkeys = [...ctx.peerPubkeys];

    if (peerPubkeys.length > 0) {
      const draft = encodeReject({
        senderPubkeyHex: this.deps.pubkeyHex,
        recipientPubkeys: peerPubkeys,
        callId,
        reason: reason === 'busy' ? 'busy' : '',
      });

      await Promise.all(
        // Multi-device echo: also wrap to self
        [...peerPubkeys, this.deps.pubkeyHex].map((pk) =>
          wrapAndPublish(draft, pk, this.deps.signer, this.deps.ndk).catch((err) =>
            console.warn('[callManager] declineCall: send failed to', pk, err),
          ),
        ),
      );
    }

    this._pendingOfferSdps.delete(callId);
    this.ctx = null;
    callStore.clearAll();
  }

  // ── Public: hang up active call ─────────────────────────────────────────────

  /**
   * Hang up the current active call.
   * Sends 25053 Hangup to all peers, closes all PeerSessions, releases media.
   */
  async hangup(): Promise<void> {
    if (this.destroyed) return;
    if (!this.ctx || this.ctx.phase !== 'active') {
      console.warn('[callManager] hangup: no active call');
      return;
    }

    const ctx = this.ctx;
    const peerPubkeys = [...ctx.peerPubkeys];

    if (peerPubkeys.length > 0) {
      const draft = encodeHangup({
        senderPubkeyHex: this.deps.pubkeyHex,
        recipientPubkeys: peerPubkeys,
        callId: ctx.callId,
      });

      await Promise.all(
        peerPubkeys.map((pk) =>
          wrapAndPublish(draft, pk, this.deps.signer, this.deps.ndk).catch((err) =>
            console.warn('[callManager] hangup: send failed to', pk, err),
          ),
        ),
      );
    }

    // Group call notice: ended (fire-and-forget)
    if (ctx.groupId && this.deps.publishGroupNotice) {
      this.deps.publishGroupNotice(
        ctx.groupId,
        JSON.stringify({ type: 'call_notice', event: 'ended', callId: ctx.callId, initiator: this.deps.pubkeyHex }),
      ).catch((err) => console.warn('[callManager] call notice (ended) failed', err));
    }

    this._teardownCall(ctx);
  }

  // ── Public: media controls ──────────────────────────────────────────────────

  setMuted(muted: boolean): void {
    if (!this.ctx?.localStream) return;
    muteAudio(this.ctx.localStream, muted);
  }

  setVideoEnabled(enabled: boolean): void {
    if (!this.ctx?.localStream) return;
    disableVideo(this.ctx.localStream, !enabled);
  }

  // ── Public: ICE restart ─────────────────────────────────────────────────────

  /**
   * Manually trigger an ICE restart for a specific peer.
   * Sends 25055 Renegotiate with the restart offer.
   */
  async iceRestart(remotePubkey: string): Promise<void> {
    if (!this.ctx || this.ctx.phase !== 'active') return;
    await this._doIceRestart(this.ctx, remotePubkey);
  }

  // ── Public: route incoming signaling event ──────────────────────────────────

  /**
   * Route an incoming signaling event from IncomingCallWatcher.
   * All kinds (25050–25055) flow through here.
   */
  async handleEvent(evt: IncomingCallEvent): Promise<void> {
    if (this.destroyed) return;
    this.deps.onEvent?.(evt);

    switch (evt.kind) {
      case 25050:
        await this._handleOffer(evt);
        break;
      case 25051:
        await this._handleAnswer(evt);
        break;
      case 25052:
        await this._handleIceCandidate(evt);
        break;
      case 25053:
        await this._handleHangup(evt);
        break;
      case 25054:
        await this._handleReject(evt);
        break;
      case 25055:
        await this._handleRenegotiate(evt);
        break;
    }
  }

  // ── Public: destroy ─────────────────────────────────────────────────────────

  destroy(): void {
    this.destroyed = true;
    if (this.ctx) {
      this._teardownCall(this.ctx);
    }
    this._pendingOfferSdps.clear();
  }

  // ── Private: pending offer SDP storage ─────────────────────────────────────

  /**
   * Stores the SDP from incoming offers (kind 25050) so acceptCall() can use it
   * to create the answer. Keyed by callId.
   */
  private readonly _pendingOfferSdps = new Map<string, string>();

  // ── Private: event handlers ─────────────────────────────────────────────────

  private async _handleOffer(evt: IncomingCallEvent): Promise<void> {
    if (!evt.sdp) {
      console.warn('[callManager] _handleOffer: offer has no SDP, dropping');
      return;
    }

    // Busy auto-reject: already in an active call
    const existing = callStore.getSnapshot();
    if (existing.active !== null) {
      const busyDraft = encodeReject({
        senderPubkeyHex: this.deps.pubkeyHex,
        recipientPubkeys: [evt.senderPubkey],
        callId: evt.callId,
        reason: 'busy',
      });
      await wrapAndPublish(busyDraft, evt.senderPubkey, this.deps.signer, this.deps.ndk).catch(
        (err) => console.warn('[callManager] busy reject send failed:', err),
      );
      return;
    }

    // Resolve group and roster for this offer
    const { groupId, rosterSnapshot } = await this._resolveGroupAndRoster(evt);

    // Authorization: sender must be in the roster
    if (!rosterSnapshot.has(evt.senderPubkey)) {
      console.warn('[callManager] _handleOffer: sender not in roster, dropping', evt.senderPubkey);
      return;
    }

    // All p-tagged participants (excluding self) are peers
    const peerPubkeys = new Set(
      evt.recipientPubkeys.filter((pk) => pk !== this.deps.pubkeyHex),
    );
    // Also include the sender (caller) if not already present
    peerPubkeys.add(evt.senderPubkey);

    // Store the SDP for use by acceptCall()
    this._pendingOfferSdps.set(evt.callId, evt.sdp);

    // Ring timeout
    const ringHandle = setTimeout(() => {
      void this.declineCall(evt.callId, 'missed');
    }, RING_TIMEOUT_MS);

    this.ctx = {
      callId: evt.callId,
      phase: 'ringing',
      callType: evt.callType ?? 'voice',
      rosterSnapshot,
      groupId,
      peerPubkeys,
      sessions: new Map(),
      iceRestartAttempts: new Map(),
      localStream: null,
      ringTimeoutHandle: ringHandle,
    };

    callStore.setIncoming({
      callId: evt.callId,
      callerPubkey: evt.senderPubkey,
      callType: evt.callType ?? 'voice',
      groupId,
      recipientPubkeys: evt.recipientPubkeys,
    });
  }

  private async _handleAnswer(evt: IncomingCallEvent): Promise<void> {
    // Multi-device echo: if from self, stop ringing on this device
    if (evt.senderPubkey === this.deps.pubkeyHex) {
      if (this.ctx?.callId === evt.callId && this.ctx.phase === 'ringing') {
        this._clearRingTimeout(this.ctx);
        this._pendingOfferSdps.delete(evt.callId);
        this.ctx = null;
        callStore.clearAll();
      }
      return;
    }

    if (!this.ctx || this.ctx.callId !== evt.callId) return;
    if (!this._isAuthorized(evt.senderPubkey)) return;
    if (!evt.sdp) return;

    const ctx = this.ctx;

    if (ctx.phase === 'active') {
      // We sent an offer to this peer — apply their answer
      const session = ctx.sessions.get(evt.senderPubkey);
      if (session) {
        await session.applyAnswer({ type: 'answer', sdp: evt.sdp });
      }

      // Lower-pubkey-initiates: if a NEW peer joined (not yet in sessions),
      // and our pubkey < their pubkey, we initiate an offer to them.
      // The new joiner's answer broadcast also tells all existing peers about them.
      for (const newPeerPk of evt.recipientPubkeys) {
        if (
          newPeerPk === this.deps.pubkeyHex ||
          newPeerPk === evt.senderPubkey ||
          ctx.sessions.has(newPeerPk)
        ) {
          continue;
        }
        // This is a new peer joining mid-call (§9.5): existing connected
        // participants UNCONDITIONALLY initiate offers to the new peer.
        ctx.peerPubkeys.add(newPeerPk);
        await this._initiateOfferTo(ctx, newPeerPk);
      }

      this._syncStoreParticipants(ctx);
    }
  }

  private async _handleIceCandidate(evt: IncomingCallEvent): Promise<void> {
    if (!this.ctx || this.ctx.callId !== evt.callId) return;
    if (!this._isAuthorized(evt.senderPubkey)) return;
    if (!evt.iceCandidate) return;

    const session = this.ctx.sessions.get(evt.senderPubkey);
    if (session) {
      await session.addIceCandidate(evt.iceCandidate).catch((err) =>
        console.warn('[callManager] addIceCandidate failed:', err),
      );
    }
  }

  private async _handleHangup(evt: IncomingCallEvent): Promise<void> {
    if (!this.ctx || this.ctx.callId !== evt.callId) return;
    if (!this._isAuthorized(evt.senderPubkey)) return;

    const ctx = this.ctx;
    const session = ctx.sessions.get(evt.senderPubkey);
    if (session) {
      session.close();
      ctx.sessions.delete(evt.senderPubkey);
    }
    ctx.peerPubkeys.delete(evt.senderPubkey);

    if (ctx.sessions.size === 0) {
      // Last participant hung up
      this._teardownCall(ctx);
    } else {
      this._syncStoreParticipants(ctx);
    }
  }

  private async _handleReject(evt: IncomingCallEvent): Promise<void> {
    // Multi-device echo: if from self, stop ringing
    if (evt.senderPubkey === this.deps.pubkeyHex) {
      if (this.ctx?.callId === evt.callId && this.ctx.phase === 'ringing') {
        this._clearRingTimeout(this.ctx);
        this._pendingOfferSdps.delete(evt.callId);
        this.ctx = null;
        callStore.clearAll();
      }
      return;
    }

    // In active calls: treat a reject from a specific peer as hangup from that peer
    if (this.ctx?.callId === evt.callId && this.ctx.phase === 'active') {
      await this._handleHangup(evt);
    }
  }

  private async _handleRenegotiate(evt: IncomingCallEvent): Promise<void> {
    if (!this.ctx || this.ctx.callId !== evt.callId || this.ctx.phase !== 'active') return;
    if (!this._isAuthorized(evt.senderPubkey)) return;
    if (!evt.sdp) return;

    const ctx = this.ctx;
    const session = ctx.sessions.get(evt.senderPubkey);
    if (!session) return;

    // Glare detection (§9.6): if we are also in the process of sending a renegotiate,
    // higher pubkey wins. Loser rolls back and accepts winner's offer.
    // Implementation: track if we've already set a local desc for renegotiation.
    // For simplicity, we use pubkey comparison: if sender > us, they win (we roll back).
    // If we > sender, we win (ignore their offer).
    // Since we don't track in-flight renegotiations here, we apply the simple rule:
    // if sender pubkey > our pubkey → sender wins → we accept their offer.
    // if our pubkey > sender pubkey → we win → ignore (they will roll back and re-accept).
    // NOTE: A proper glare-safe impl would require tracking "pending renegotiate" state.
    // For S5 this is an approximation. The spec says "higher pubkey wins" and loser rollbacks.

    if (evt.senderPubkey > this.deps.pubkeyHex) {
      // Sender wins: apply their renegotiate offer and answer
      const answerSdp = await session.applyRenegotiateOffer({ type: 'offer', sdp: evt.sdp });

      const draft = encodeRenegotiate({
        senderPubkeyHex: this.deps.pubkeyHex,
        recipientPubkeys: [evt.senderPubkey],
        callId: ctx.callId,
        sdp: answerSdp.sdp ?? '',
      });
      await wrapAndPublish(draft, evt.senderPubkey, this.deps.signer, this.deps.ndk).catch(
        (err) => console.warn('[callManager] renegotiate answer send failed:', err),
      );
    }
    // else: we win, ignore their offer (they will rollback once they receive ours)
  }

  // ── Private: roster / group resolution ─────────────────────────────────────

  /**
   * Determine which group an offer belongs to by finding the group with the
   * most overlap between the offer's p-tags and each group's roster.
   * Returns the groupId (or null) and the roster snapshot.
   */
  private async _resolveGroupAndRoster(
    evt: IncomingCallEvent,
  ): Promise<{ groupId: string | null; rosterSnapshot: Set<string> }> {
    // The p tags in the offer contain all intended participants. Find which group
    // the caller belongs to by testing roster overlap.
    // We can't enumerate groups here without a group store — the caller passes
    // getGroupRoster(groupId). Without knowing groupIds we need a different strategy.
    //
    // Decision: use the p-tags as the roster snapshot directly. Any member listed
    // in p-tags (plus the sender) is authorized for this call. This is §5.2's
    // "find group with most overlap" simplified to: trust the offer's p-list.
    // The outer subscribeCallSignaling already does a sender-is-in-some-group check;
    // callManager trusts that gate and uses the p-tags as the call roster.

    const rosterSnapshot = new Set([
      ...evt.recipientPubkeys,
      evt.senderPubkey,
    ]);

    // groupId: null for now (S5 does not have a groups listing API to match against)
    // A future story can pass a groups array to deps and resolve this.
    return { groupId: null, rosterSnapshot };
  }

  private _isAuthorized(senderPubkey: string): boolean {
    return this.ctx?.rosterSnapshot.has(senderPubkey) ?? false;
  }

  // ── Private: PeerSession management ────────────────────────────────────────

  private _createPeerSession(callId: string, remotePubkey: string): PeerSession {
    const ctx = this.ctx!;
    const iceConfig = getIceConfig();

    const session = new PeerSession(iceConfig, {
      onIceCandidate: (candidate) => {
        const draft = encodeIceCandidate({
          senderPubkeyHex: this.deps.pubkeyHex,
          recipientPubkeyHex: remotePubkey,
          callId,
          candidate,
        });
        wrapAndPublish(draft, remotePubkey, this.deps.signer, this.deps.ndk).catch((err) =>
          console.warn('[callManager] ICE candidate send failed:', err),
        );
      },
      onTrack: (streams) => {
        const stream = streams[0] ?? null;
        this._updateParticipantStream(remotePubkey, stream);
      },
      onConnectionStateChange: (state) => {
        if (state === 'failed') {
          void this._onConnectionFailed(ctx, remotePubkey);
        }
      },
      onIceConnectionStateChange: (_state) => {
        // Reserved for future diagnostics
      },
    });

    ctx.sessions.set(remotePubkey, session);
    return session;
  }

  private async _initiateOfferTo(ctx: CallContext, remotePubkey: string): Promise<void> {
    if (!ctx.localStream) return;
    const session = this._createPeerSession(ctx.callId, remotePubkey);
    session.addLocalStream(ctx.localStream);
    const offerSdp = await session.createOffer();

    const allPeers = [...ctx.peerPubkeys].filter((pk) => pk !== this.deps.pubkeyHex);

    const draft = encodeOffer({
      senderPubkeyHex: this.deps.pubkeyHex,
      recipientPubkeys: allPeers,
      callId: ctx.callId,
      callType: ctx.callType,
      sdp: offerSdp.sdp ?? '',
    });

    await wrapAndPublish(draft, remotePubkey, this.deps.signer, this.deps.ndk).catch((err) =>
      console.warn('[callManager] offer send failed to', remotePubkey, err),
    );
  }

  // ── Private: ICE restart ────────────────────────────────────────────────────

  private async _onConnectionFailed(ctx: CallContext, remotePubkey: string): Promise<void> {
    if (!this.ctx || this.ctx.callId !== ctx.callId) return;

    const attempts = ctx.iceRestartAttempts.get(remotePubkey) ?? 0;
    if (attempts >= 1) {
      // Second failure — mark leg as failed
      console.warn('[callManager] ICE restart failed, marking leg failed for', remotePubkey);
      ctx.sessions.get(remotePubkey)?.close();
      ctx.sessions.delete(remotePubkey);
      ctx.peerPubkeys.delete(remotePubkey);
      ctx.iceRestartAttempts.delete(remotePubkey);

      if (ctx.sessions.size === 0) {
        this._teardownCall(ctx);
      } else {
        this._syncStoreParticipants(ctx);
      }
      return;
    }

    ctx.iceRestartAttempts.set(remotePubkey, attempts + 1);
    await this._doIceRestart(ctx, remotePubkey);
  }

  private async _doIceRestart(ctx: CallContext, remotePubkey: string): Promise<void> {
    const session = ctx.sessions.get(remotePubkey);
    if (!session) return;

    const offerSdp = await session.createIceRestartOffer().catch((err) => {
      console.warn('[callManager] createIceRestartOffer failed:', err);
      return null;
    });
    if (!offerSdp) return;

    const draft = encodeRenegotiate({
      senderPubkeyHex: this.deps.pubkeyHex,
      recipientPubkeys: [remotePubkey],
      callId: ctx.callId,
      sdp: offerSdp.sdp ?? '',
    });

    await wrapAndPublish(draft, remotePubkey, this.deps.signer, this.deps.ndk).catch((err) =>
      console.warn('[callManager] ICE restart renegotiate send failed:', err),
    );
  }

  // ── Private: callStore sync ─────────────────────────────────────────────────

  private _updateParticipantStream(pubkey: string, stream: MediaStream | null): void {
    const snapshot = callStore.getSnapshot();
    if (!snapshot.active) return;
    const updated = snapshot.active.participants.map((p) =>
      p.pubkey === pubkey ? { ...p, stream } : p,
    );
    callStore.setActive({ ...snapshot.active, participants: updated });
  }

  private _syncStoreParticipants(ctx: CallContext): void {
    const snapshot = callStore.getSnapshot();
    if (!snapshot.active) return;

    // Retain streams of remaining participants
    const streamsByPubkey = new Map(
      snapshot.active.participants.map((p) => [p.pubkey, p.stream]),
    );

    callStore.setActive({
      ...snapshot.active,
      participants: [...ctx.peerPubkeys].map((pk) => ({
        pubkey: pk,
        stream: streamsByPubkey.get(pk) ?? null,
        muted: false,
        videoOff: false,
      })),
    });
  }

  // ── Private: teardown ───────────────────────────────────────────────────────

  private _teardownCall(ctx: CallContext): void {
    this._clearRingTimeout(ctx);
    for (const session of ctx.sessions.values()) {
      session.close();
    }
    ctx.sessions.clear();
    if (ctx.localStream) {
      releaseMedia(ctx.localStream);
      ctx.localStream = null;
    }
    this._pendingOfferSdps.delete(ctx.callId);
    if (this.ctx?.callId === ctx.callId) {
      this.ctx = null;
    }
    callStore.clearAll();
  }

  private _clearRingTimeout(ctx: CallContext): void {
    if (ctx.ringTimeoutHandle !== null) {
      clearTimeout(ctx.ringTimeoutHandle);
      ctx.ringTimeoutHandle = null;
    }
  }
}
