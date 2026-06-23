# Acceptance Criteria: Voice & Video Calls (AC-WebRTC)

**Epic:** voice-video-calls
**Spec basis:** spec.md §18–§19, architecture.md
**AC ID form:** `AC-<TAG>-<N>` — counter resets per tag.

---

## Theme 1: Transport & Wire Format

### AC-WIRE-1
`callSignaling.ts` MUST emit kind-25050 (Offer), 25051 (Answer), 25052 (ICE Candidate), 25053 (Hangup), 25054 (Reject), and 25055 (Renegotiate) inner events with the exact tag set: one `["call-id", <uuid>]` tag on every event; one `["call-type", "voice"|"video"]` tag on kind-25050 only; and at least one `["p", <hex-pubkey>]` tag. No `alt` or `expiration` tags MUST be present.

**Verify:** Unit test round-tripping each event builder; assert tag names and absence of `alt`/`expiration` fields.

### AC-WIRE-2
`callSignaling.ts` MUST NOT include the `alt` tag or the `expiration` tag on any emitted inner call event (kinds 25050–25055), matching the shipping Amethyst wire format.

**Verify:** Unit test; assert tag array contains no entry whose first element is `"alt"` or `"expiration"`.

### AC-WIRE-3
For a kind-25052 ICE Candidate event, `callSignaling.ts` MUST set content to JSON with fields `candidate`, `sdpMid`, and `sdpMLineIndex`; when parsing an incoming ICE candidate whose JSON lacks `sdpMid` or `sdpMLineIndex`, `callSignaling.ts` MUST default them to `"0"` and `0` respectively.

**Verify:** Unit test with minimal ICE JSON missing both optional fields; assert defaults are applied before passing to `RTCPeerConnection.addIceCandidate`.

### AC-WIRE-4
For a kind-25053 (Hangup) and kind-25054 (Reject) inner event, `callSignaling.ts` MUST set content to a plaintext string (MAY be empty for hangup; MUST be `"busy"` for an auto-reject triggered by an already-in-call state).

**Verify:** Unit test; assert content of auto-reject event equals `"busy"`.

### AC-WRAP-1
`callSignaling.ts` MUST wrap every outgoing inner call event as a kind-21059 outer gift-wrap: the outer event MUST be signed by a **fresh random ephemeral key** (different per message), MUST have content equal to NIP-44 encryption of the JSON-serialised signed inner event addressed to the recipient pubkey, and MUST carry exactly one `["p", <recipientHex>]` tag and no other tags.

**Verify:** Unit test using a spy on `nip44.encrypt` and `finalizeEvent`; assert outer kind=21059, outer pubkey changes per call, tag list has exactly one `p` entry.

### AC-WRAP-2
`callSignaling.ts` MUST send one separate kind-21059 outer wrap per recipient for multi-recipient events (group Offer, Hangup). A single outer wrap MUST NOT address multiple recipients.

**Verify:** Unit test with a 3-party offer; assert exactly 2 outer wraps are published (one per callee), each with a different `p` tag.

### AC-WRAP-3
On the receive path, `callSignaling.ts` MUST NIP-44-decrypt the outer kind-21059 content, parse the inner event JSON, and verify the inner event's Nostr signature via `verifyEvent`. Any inner event with an invalid signature MUST be silently dropped (not forwarded to `CallManager`).

**Verify:** Unit test feeding a forged inner event (wrong sig); assert the `onIncomingCall` / event handler is never called.

---

## Theme 2: Freshness, Dedupe & Roster Guard

### AC-FRESH-1
`callSignaling.ts` MUST discard any received inner call event whose `created_at` differs from the current wall-clock time by more than 20 seconds in either direction (stale or future).

**Verify:** Unit test injecting an event with `created_at = now - 21`; assert it is dropped without calling any handler.

### AC-FRESH-2
`callSignaling.ts` MUST maintain an in-memory seen-ids set (bounded to at most 500 entries) and MUST drop any inner event whose `id` has been seen before within the current subscription lifetime.

**Verify:** Unit test feeding the same event twice; assert the handler is called exactly once.

### AC-ROSTER-1
`callSignaling.ts` MUST reject (drop silently) any inner signaling event whose `pubkey` is not present in the current MLS roster of the call's group, obtained by calling `getGroupMembers` at receive time. An event from a pubkey not in the roster MUST NOT reach `CallManager`.

**Verify:** Unit test with a mock `getGroupMembers` returning a roster that excludes the event's pubkey; assert the handler is never invoked.

### AC-ROSTER-2
For a 1:1 call without a shared MLS group (fallback path per spec §5.3), `callSignaling.ts` MUST authorize the inner event solely on the expected peer pubkey — the absence of a group roster MUST NOT block the call, and the event MUST reach `CallManager` when the pubkey matches the expected peer.

**Verify:** Unit test with `groupId = null` and a matching peer pubkey; assert the event is forwarded.

---

## Theme 3: Call Lifecycle & State Machine

### AC-LIFE-1
`callManager.ts` MUST generate a UUID for `call-id` at call-start and MUST use the same UUID on every signaling event throughout that call session.

**Verify:** Unit test; spy on `callSignaling.sendOffer` and `callSignaling.sendIceCandidate` across the same call and assert the `call-id` value is identical.

### AC-LIFE-2
`callManager.ts` MUST transition through states `idle → ringing → active → ended` in that order for the happy path. Transitioning from `ringing` to `ended` without passing through `active` MUST be possible (caller cancels, timeout, decline). No backward transition (e.g. `active → ringing`) is allowed.

**Verify:** Unit test simulating offer-sent → answer-received → hangup-sent; assert state sequence matches the expected transitions.

### AC-LIFE-3
`callManager.ts` MUST enforce a hard cap of 5 connected participants. An attempt to start a call with more than 5 participants (including self) MUST be rejected before any Offer is sent. An attempt to admit a 6th mid-call joiner MUST send a kind-25054 Reject to the incoming Offer.

**Verify:** Unit test; assert no Offer is sent when participant count = 5, and a Reject is sent for the 6th joiner.

### AC-LIFE-4
`callManager.ts` MUST implement a ring timeout of 45 seconds. If no Answer (kind-25051) arrives from any callee within 45 seconds of the first Offer being sent, `callManager.ts` MUST transition to `ended` state and send a kind-25053 Hangup to all callees.

**Verify:** Unit test with a fake clock advanced 45 s; assert Hangup is sent and state transitions to `ended`.

### AC-LIFE-5
When a callee issues a kind-25054 Reject, `callManager.ts` on the caller side MUST update the per-participant status to `declined` and, if all callees have declined or timed out, transition to `ended` state.

**Verify:** Unit test; send Reject from all callees; assert final state = `ended`.

### AC-LIFE-6
When `callManager.ts` receives a kind-25053 Hangup from a participant in a group call, it MUST close only the `PeerSession` to that participant. The call MUST remain in `active` state if at least one other participant remains connected. When the local participant count drops to 1 (only self), the call MUST transition to `ended`.

**Verify:** Unit test with 3-party call; simulate Hangup from one peer; assert remaining PeerSession is intact and state remains `active`; then simulate Hangup from the last peer; assert state transitions to `ended`.

### AC-LIFE-7
`callManager.ts` MUST auto-reject any incoming call Offer (kind-25050 with a new `call-id`) with a kind-25054 Reject containing content `"busy"` when an active call is already in progress.

**Verify:** Unit test; set state to `active`; inject new Offer; assert a Reject with content `"busy"` is sent.

### AC-MESH-1
`callManager.ts` MUST use the lower-pubkey-initiates tiebreaker when two peers in a group call would otherwise both send offers to each other (initial callee-to-callee mesh formation): the peer whose hex pubkey is lexicographically lower MUST send the Offer; the other MUST wait for an incoming Offer.

**Verify:** Unit test with two mock peer pubkeys; assert the lower-pubkey peer's `callManager` sends an Offer and the higher-pubkey peer does not.

### AC-MESH-2
During renegotiation glare (simultaneous 25055 Renegotiate from both peers), `callManager.ts` MUST apply the higher-pubkey-wins rule: the peer with the higher hex pubkey wins; the loser MUST call `setLocalDescription({type:"rollback"})` on the affected `PeerSession` and then accept the winner's Offer, sending a kind-25051 Answer.

**Verify:** Unit test; inject simultaneous Renegotiate events from a higher and lower pubkey while this peer is the lower; assert rollback is called and an Answer is sent.

### AC-MESH-3
When a new participant joins a call mid-session (kind-25050 Offer received for a `call-id` that is already `active`), `callManager.ts` MUST have every already-connected participant unconditionally initiate a new Offer to the newly joined peer. The newly joined peer MUST remain passive toward existing members (not send offers toward them spontaneously).

**Verify:** Unit test; simulate join of 4th party into a 3-party active call; assert 3 existing participants each send an Offer to the newcomer; assert newcomer sends no spontaneous Offers.

### AC-MULTI-1
`callManager.ts` MUST wrap the kind-25051 Answer and the kind-25054 Reject events addressed additionally to the sender's own pubkey (all the sender's other devices), so that other logged-in devices of the same user receive the "answered/rejected elsewhere" signal and can stop ringing.

**Verify:** Unit test; on sending an Answer, assert that the outer wrap is also published to the self pubkey (in addition to the caller). Same for Reject.

---

## Theme 4: Media

### AC-MEDIA-1
`mediaManager.ts` MUST call `navigator.mediaDevices.getUserMedia({ audio: true, video: false })` for a voice call and `{ audio: true, video: { width, height, frameRate } }` for a video call. The call MUST NOT request media until the user takes an explicit accept or initiate action.

**Verify:** Unit test with a spy on `getUserMedia`; assert it is not called during watcher mount, and is called with the correct constraints only after `acquireMedia(video)` is invoked.

### AC-MEDIA-2
`mediaManager.ts` MUST expose `muteAudio(stream, muted)` that disables or re-enables the `MediaStreamTrack.enabled` flag on the audio track without stopping the track; and `disableVideo(stream, disabled)` that does the same for the video track.

**Verify:** Unit test with a mock `MediaStream`; call `muteAudio(stream, true)` and assert `audioTrack.enabled === false`; call with `false` and assert `true`.

### AC-MEDIA-3
`mediaManager.ts` MUST expose `releaseMedia(stream)` that stops every track in the stream by calling `track.stop()`, leaving no live capture active after the call ends.

**Verify:** Unit test; call `releaseMedia` with a mock stream having two tracks; assert `stop()` is called on each track.

### AC-MEDIA-4
`peerSession.ts` MUST add local media tracks to the `RTCPeerConnection` before generating the first SDP offer, so that media negotiation includes the local stream's tracks.

**Verify:** Unit test with a mock `RTCPeerConnection`; assert `addTrack` is called with each local track before `createOffer` is called.

### AC-MEDIA-5
`peerSession.ts` MUST buffer incoming ICE candidates (via `iceCandidateQueue`) received before the remote description is set, and drain the queue by calling `addIceCandidate` once the remote SDP is applied.

**Verify:** Unit test; inject two ICE candidates before `applyAnswer`; call `applyAnswer`; assert `addIceCandidate` is called exactly twice after the answer is applied.

---

## Theme 5: TURN / ICE Config

### AC-ICE-1
`turnConfig.ts` MUST read the TURN configuration from localStorage key `lp_turnConfig_v1`. When no user-supplied config exists, `turnConfig.ts` MUST return a default `RTCConfiguration` containing at minimum `stun:stun.l.google.com:19302`, `stun:stun1.l.google.com:19302`, and `stun:stun.cloudflare.com:3478` as STUN servers plus the shipped default TURN URL.

**Verify:** Unit test with `localStorage` empty; assert returned config includes all three STUN URIs. Unit test with a user-supplied TURN config in `lp_turnConfig_v1`; assert the user TURN replaces the default TURN but STUN defaults remain.

### AC-ICE-2
When IP-privacy mode is enabled (stored in `lp_turnConfig_v1` or a dedicated key), `turnConfig.ts` MUST return an `RTCConfiguration` with `iceTransportPolicy: "relay"`. When disabled (default), `turnConfig.ts` MUST omit `iceTransportPolicy` or set it to `"all"`.

**Verify:** Unit test; toggle the privacy flag; assert `iceTransportPolicy` value changes.

### AC-ICE-3
`peerSession.ts` MUST attempt an ICE restart (via kind-25055 Renegotiate carrying a new SDP offer with `iceRestart: true`) when the `RTCPeerConnection` `iceConnectionState` transitions to `"failed"`. The restart attempt MUST be made at most once per failure event (no infinite retry loop).

**Verify:** Unit test with a mock `RTCPeerConnection`; trigger `iceconnectionstatechange` to `"failed"`; assert one 25055 Renegotiate is sent; trigger `"failed"` again without recovery; assert no second Renegotiate is sent.

---

## Theme 6: Group Call Notice

### AC-NOTICE-1
When a call starts (first Offer is sent), `callManager.ts` MUST publish a kind-445 MLS group message via `applicationRumorDispatcher` with content `{ "type": "call_notice", "event": "started", "callId": "<uuid>", "initiator": "<callerPubkeyHex>" }`.

**Verify:** Unit test; spy on the rumor dispatcher; assert a `call_notice` rumor with `event: "started"` is published when the first Offer is dispatched.

### AC-NOTICE-2
When the last remaining participant hangs up or the call transitions to `ended`, `callManager.ts` MUST publish a kind-445 MLS group message with content `{ "type": "call_notice", "event": "ended", "callId": "<uuid>", "initiator": "<callerPubkeyHex>" }`.

**Verify:** Unit test; assert a `call_notice` rumor with `event: "ended"` is published when state transitions to `ended`.

---

## Theme 7: UI

### AC-UI-1
`IncomingCallWatcher.tsx` MUST render `null` (no DOM nodes), MUST mount in `Layout.tsx` alongside `DirectMessageNotificationsWatcher`, and MUST set up its NDK subscription only after `hydrated`, `pubkeyHex`, and `privateKeyHex` are all truthy.

**Verify:** Unit test rendering `IncomingCallWatcher` with `hydrated=false`; assert no subscription is created. Render with all three truthy; assert `subscribeCallSignaling` is called.

### AC-UI-2
`IncomingCallModal.tsx` MUST display the caller's display name (resolved from the Nostr profile), the call type (`Voice` or `Video`), and two action buttons: Accept and Decline. Clicking Accept MUST trigger the accept handler; clicking Decline MUST trigger the decline handler.

**Verify:** Unit test rendering the modal with a mocked caller; assert both buttons are present and each handler is called on click.

### AC-UI-3
`CallScreen.tsx` MUST display one tile per remote participant. Each tile MUST show the participant's display name and a mute indicator. For a video call, each tile MUST render a `<video>` element bound to the participant's `MediaStream`. For a voice-only call, tiles MUST show an avatar image in place of video.

**Verify:** Unit test rendering `CallScreen` with 2 mock participants, one with a video stream and one without; assert 2 tiles, one `<video>` element, and one avatar element are present.

### AC-UI-4
`CallScreen.tsx` MUST expose controls: mute toggle, camera on/off toggle (visible only for video calls), hang-up button. Clicking hang-up MUST call the hangup handler. Mute toggle MUST call `muteAudio`. Camera toggle MUST call `disableVideo`.

**Verify:** Unit test; simulate click on each control; assert the corresponding handler spy is called.

### AC-UI-5
All user-visible call strings MUST be defined in `app/src/lib/i18n.ts` under both `en` and `de` locales. No call-related string literal MUST appear in any call component or page file.

**Verify:** Unit test asserting that the `Copy` type has call-related keys and that both locale objects have non-empty string values for each key. `grep -rn '"Incoming call"\|"Calling"\|"Decline"\|"Accept call"' app/src/components/calls/` MUST return zero matches.

### AC-UI-6
`app/pages/settings.tsx` MUST render a "Call Settings" section containing: a text input for TURN server URL, text inputs for TURN username and credential, and an IP-privacy toggle. Changes MUST be saved to `lp_turnConfig_v1` in localStorage when the user submits/saves.

**Verify:** Manual test: open Settings, enter a TURN URL, save, reload; assert the value is pre-populated on reload. Unit test: render the section; assert the three inputs and toggle are present.

---

## Theme 8: Resilience & Network

### AC-RES-1 (Manual)
ICE restart MUST recover an active call when the local network interface changes (e.g. Wi-Fi → cellular). The call MUST remain audible/visible within 10 seconds of the network change without requiring a user action.

**Verify:** Manual test only — requires real network change on a device; automated verification is not feasible in CI.

### AC-RES-2 (Manual)
A TURN-only call path (`iceTransportPolicy: "relay"`) MUST successfully connect and carry audio/video between two peers behind symmetric NAT.

**Verify:** Manual test only — requires a TURN server and real symmetric NAT environment. Confirm by enabling IP-privacy mode and verifying the call connects with zero direct candidates.

### AC-RES-3
When a relay applies rate-limiting during the ICE candidate burst (kind-25052 publishes), `callSignaling.ts` MUST NOT fail the call. It MUST continue emitting any remaining trickle ICE candidates after the burst. Partial ICE candidate delivery MUST still result in a connected call if at least one candidate pair is viable.

**Verify:** Unit test simulating a publish failure (rejection) on 5 of 10 ICE candidates; assert the remaining 5 are still attempted and a `callManager` that receives only the successful 5 reaches `active` state.

---

## Theme 9: End-to-End Call Flows

### AC-FLOW-1
A 1:1 voice call initiated from the app MUST connect (both peers reach `active` state), carry audio, and tear down cleanly (both peers reach `ended` state) when one hangs up. This MUST be verified by an automated Playwright e2e test using two browser contexts on the same machine (loopback ICE, no external TURN required).

**Verify:** E2e test in `app/tests/e2e/`; assert signaling state and that the `CallScreen` is displayed for both peers, then dismissed after hangup.

### AC-FLOW-2
A call decline flow MUST be verifiable by an automated Playwright e2e test: caller sees the "Calling…" state; callee clicks Decline; caller sees the call end (state transitions to `ended`).

**Verify:** E2e test; assert incoming call modal appears for callee, Decline triggers state change visible to caller.

### AC-FLOW-3 (Conditional / Manual)
If Amethyst interoperability is a targeted milestone for this release, a call initiated from Nostling to an Amethyst-connected pubkey MUST connect, carry audio, and hang up cleanly. This AC is conditional: it MUST be verified manually against a live Amethyst client and is skipped in CI.

**Verify:** Manual test only. Skip if Amethyst interop is not a current release target.
