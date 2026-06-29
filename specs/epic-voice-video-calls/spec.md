# Specification: Voice & Video Calls for a Marmot-based Nostr Client

**Status:** Approved for implementation (2026-06-23)
**Scope:** Browser (PWA / web) Nostr client with Marmot (MLS-on-Nostr) groups
**Protocol basis:** Amethyst AC-WebRTC (Nostr kinds 25050–25055 over ephemeral gift-wrap)
**Call size:** Up to 5 participants (full-mesh P2P)

---

## 1. Summary

This document specifies how to add 1:1 and small-group (≤5) voice and video calls to a
browser-based Nostr client whose social graph and group context are built on the
**Marmot Protocol** (MLS-on-Nostr).

The design **reuses Amethyst's existing call protocol ("AC-WebRTC") verbatim** for the
real-time signaling, and uses the **Marmot group only as the "room"** — the authenticated
roster, the membership gate, and the place a call is announced. The actual WebRTC
offer/answer/ICE traffic does **not** travel inside the MLS group channel; it travels over
the same ephemeral, gift-wrapped, peer-addressed transport Amethyst already uses.

This is not a compromise — independent analysis of both protocols converged on it:

- **Amethyst** already carries signaling as **ephemeral (kind 21059) gift-wraps** addressed
  peer-to-peer, precisely because signaling is transient and high-frequency.
- **Marmot's** group channel (kind 445) is **persisted permanently by relays**, has
  **no message-ordering contract**, and would expose a call-setup burst (30–50 ICE
  candidates in a few seconds) to relay rate limits — all for **no added confidentiality**,
  since the peers' identities are already known from the MLS roster.

So: **MLS gives us trusted identities and a room; gift-wrap carries the call.** Following
Amethyst's wire format also buys potential interoperability with Amethyst itself for free.

---

## 2. Goals and non-goals

### Goals
- G1. Place and receive **voice** (audio-only) and **video** (audio + video) calls.
- G2. Support **1:1 and group calls up to 5 participants** via full-mesh P2P.
- G3. **End-to-end encrypted** signaling and media; no central media server sees content.
- G4. Calls are **scoped to a Marmot group** (or a 1:1 derived from one): only authenticated
  group members can be invited/joined.
- G5. **Wire-compatible with Amethyst's AC-WebRTC** signaling format (kinds 25050–25055,
  gift-wrap 21059), so an Amethyst user addressed by pubkey could in principle interoperate.
- G6. Run entirely in modern browsers using the **native `RTCPeerConnection` API**.
- G7. Graceful handling of **join mid-call, leave, decline, busy, network change, and glare**.

### Non-goals
- N1. **SFU / server-side media mixing.** Mesh suffices at ≤5; out of scope.
- N2. **Calls larger than 5.** Explicitly excluded (mesh cost grows quadratically).
- N3. **Calling arbitrary pubkeys not in a shared Marmot group.** Calls are room-scoped (see §4).
- N4. **Recording, transcription, screen-share.** Future extensions; not specified here.
- N5. **PSTN / SIP interconnect.**

---

## 3. Signaling transport (decided: Amethyst-compatible gift-wrap)

Call signaling is carried as **NIP-44 ephemeral gift-wraps (kind 21059)** addressed
peer-to-peer — Amethyst's exact transport. This is the settled architecture for this spec;
the Marmot-native (MLS-derived-key) alternative was considered and rejected.

**Properties of the chosen transport:**
- Encryption: NIP-44, inner event wrapped to each peer's pubkey, with a **fresh random
  ephemeral sender key per message** (hides the real sender at the relay level).
- **Wire-compatible with Amethyst** — an Amethyst client addressed by pubkey can interoperate.
- **Decoupled from MLS epoch state:** a group membership change mid-call does not break
  in-flight signaling. The MLS group is consulted only for the roster snapshot and identity
  authorization (§5), never as the signaling channel.
- Authorization is still enforced: every inner event is signed by the sender's real key and
  verified against the MLS roster (§5.2), so non-members cannot inject signaling even though
  the transport itself is not bound to MLS keys.

The whole spec is written against this transport; there are no transport variants below.

---

## 4. Call scoping & participant model

- A call is always associated with a **Marmot group** (the "room"). A 1:1 call is just a
  call in a 2-member context; if your client models DMs as 2-person MLS groups, the same
  path applies. If a 1:1 is *not* an MLS group, fall back to addressing the single peer's
  pubkey directly (still Option-A gift-wrap) — see §5.3.
- **Eligible participants** = current members of the group's MLS roster at call start
  (§5), minus the caller. A call may target the **whole group** or a **subset** (e.g. the
  caller selects 3 of 5 members).
- **Hard cap:** a call MUST refuse to start or to admit a new joiner once **5 connected
  participants** is reached. The cap is enforced client-side (the protocol itself imposes
  no max).
- **Call type** is fixed at offer time as `voice` or `video` (matches Amethyst's
  `call-type` tag). A voice call may be upgraded to video via renegotiation (§9.4); this is
  a local media change, not a new call.

---

## 5. Identity & roster (Marmot integration)

### 5.1 Roster enumeration
At call start and after **every** epoch-advancing event (MLS Commit), the client queries the
current roster:

- **marmot-ts:** `getGroupMembers(group.state)` → leaf nodes → Nostr pubkeys.
- **MDK (WASM):** `group_leaf_map(group_id)` → `{ leafIndex → pubkey }`; `own_leaf_index(group_id)`.

The pubkey is the member's MLS `BasicCredential` identity and is **stable across epochs**
(leaf *index* may shift on member removal; pubkey does not). Always re-query after a Commit;
never cache the roster across membership changes.

### 5.2 Identity verification (critical)
Every received signaling event, after gift-wrap decryption, exposes an **inner call event
signed by the sender's real Nostr key**. The client MUST:

1. Verify the inner event signature.
2. Confirm the inner event's `pubkey` is a **current member of the call's group roster**.
3. Reject signaling from any pubkey not in the roster (defense against a relay or third
   party injecting wraps addressed to you).

This is what makes "the MLS group is the trust boundary" real: gift-wrap provides
transport privacy, the MLS roster provides authorization.

### 5.3 1:1 fallback (no MLS group)
If a 1:1 call is between two pubkeys that do **not** share an MLS group, skip the roster
check and authorize solely on the expected peer pubkey. The wire format is unchanged.

---

## 6. System architecture

```
┌──────────────────────────────────────────────────────────────┐
│  UI layer (call screen, incoming-call modal, controls, PiP)   │
├──────────────────────────────────────────────────────────────┤
│  CallManager  — orchestrates a single call session            │
│    • roster snapshot + identity gate (Marmot)                 │
│    • per-peer mesh of PeerSessions                            │
│    • call-level state machine (§8)                            │
├───────────────┬──────────────────────────┬───────────────────┤
│ PeerSession   │ PeerSession   │  ...      │  (one per remote  │
│  (RTCPeer-    │  (RTCPeer-    │           │   participant,    │
│   Connection) │   Connection) │           │   ≤4)             │
├───────────────┴──────────────────────────┴───────────────────┤
│  SignalingTransport                                           │
│    • encode/decode AC-WebRTC events (25050–25055)             │
│    • gift-wrap (21059) seal/open, NIP-44                      │
│    • freshness + dedupe (20 s window, event-id cache)         │
│    • publish to / subscribe from relays                      │
├──────────────────────────────────────────────────────────────┤
│  MediaManager (getUserMedia, tracks, devices, mute, camera)   │
│  IceConfig (STUN/TURN, locally configured)                    │
└──────────────────────────────────────────────────────────────┘
```

**Topology:** full mesh. In an N-party call each client holds **N−1** `RTCPeerConnection`s.
At the cap (5) that is 4 connections per client, 10 connections across the call.

**Browser media engine:** native `RTCPeerConnection` + `adapter.js` for cross-browser
normalization. No third-party media library required (the browser *is* the WebRTC engine).

---

## 7. Signaling protocol — event definitions (Amethyst AC-WebRTC, verbatim)

All six events are **ephemeral Nostr events** (kind range 20000–29999). They are never
published in the clear; each is wrapped (§8) before hitting a relay.

### 7.1 Kinds

| Event | Kind | Purpose |
|---|---|---|
| Call Offer | **25050** | Initiate; carries SDP offer + call type |
| Call Answer | **25051** | Accept; carries SDP answer |
| Call ICE Candidate | **25052** | Trickle ICE candidate to one peer |
| Call Hangup | **25053** | End an established call / leg |
| Call Reject | **25054** | Decline an incoming call (incl. auto-"busy") |
| Call Renegotiate | **25055** | Mid-call SDP renegotiation (e.g. add video) |

### 7.2 Tags

| Tag | Where | Form | Notes |
|---|---|---|---|
| `p` | all | `["p", <hex-pubkey>]` | Recipient(s). Group offers/answers/etc. carry **one `p` per group member**; **ICE carries exactly one `p`** (the single target peer). |
| `call-id` | all | `["call-id", <uuid>]` | Stable across the entire call session. |
| `call-type` | **offer only** | `["call-type", "voice"\|"video"]` | Absent on all other events. |

There is **no `expiration` tag** and **no `alt` tag** in the shipping Amethyst wire format.
(The Amethyst `NIP-AC.md` mentions `alt`, but the code omits it; omit it for compatibility.)

### 7.3 Content

| Event | Content format |
|---|---|
| Offer / Answer / Renegotiate | **Raw SDP string**, plaintext (e.g. `v=0\r\no=- …`). Not JSON-wrapped. |
| ICE Candidate | **JSON**: `{"candidate":"<sdp>","sdpMid":"<mid>","sdpMLineIndex":<int>}`. On parse, default `sdpMid→"0"`, `sdpMLineIndex→0` if absent. |
| Hangup / Reject | **Plaintext reason**, MAY be empty. Auto-decline-because-busy uses content `"busy"`. |

The inner content is **not** separately encrypted — confidentiality comes entirely from the
outer gift-wrap.

### 7.4 Session & connection identity
- A **call session** = one `call-id` (UUID), identical on every event of that call.
- A specific **pairwise PeerConnection** is identified implicitly by the
  **(sender pubkey, recipient pubkey)** pair under that `call-id`. There is no separate
  per-leg id. This is why **ICE is addressed to a single peer** — each candidate belongs to
  exactly one pairwise connection.

---

## 8. Transport & encryption (gift-wrap)

Each signaling event is delivered as a **NIP-59 ephemeral gift-wrap**:

1. **Inner event:** build the call event (§7), **sign it with the sender's real Nostr key**.
   (It is a signed event, not an unsigned rumor — the recipient verifies authorship after
   unwrapping, per §5.2.)
2. **Wrap:** `EphemeralGiftWrap`, **kind 21059** (the ephemeral variant of NIP-59's 1059).
   - `content` = `nip44Encrypt(innerEvent.toJSON(), recipientPubkey)`.
   - Wrap is signed by a **fresh random ephemeral key** (`new KeyPair()` per message) — hides
     the real sender at the relay level.
   - Wrap tags: exactly `["p", <recipientPubkey>]` and nothing else.
   - **No seal layer** (no kind-13). Two layers only: signed inner → 21059 wrap.
3. **Publish** the wrap to the recipient's read/inbox relays (NIP-65) and/or the group's
   relay set.

### 8.1 Freshness & replay defense (mandatory)
Because the events are ephemeral and unexpiring:
- **Discard** any received signaling event whose `created_at` is **older than 20 seconds**.
- **Dedupe** by inner event id (keep a short-lived seen-set).
- Relays SHOULD NOT persist kind 21059; do not rely on retrieval — signaling is
  fire-and-forget within the live call.

### 8.2 Relay subscription
While "available for calls," the client maintains a subscription for **kind 21059 wraps
`p`-tagged to its own pubkey**. On receipt: open wrap → verify inner signature → apply
freshness/dedupe → route to `CallManager` by `call-id` (or spawn an incoming-call flow if
the `call-id` is new and the event is an Offer).

---

## 9. Mesh negotiation rules

These rules are taken from Amethyst's group implementation; follow them for interop and to
avoid classic mesh failure modes.

### 9.1 Call setup (caller → callees)
1. Caller generates `call-id` (UUID), snapshots roster, picks call type.
2. Caller creates one `RTCPeerConnection` per target, generates a **per-peer SDP offer**, and
   sends a **25050 Offer** to each target. The inner offer event carries a `p` tag for
   **every** participant (so each callee learns the full roster), but is wrapped to that one
   target peer.
3. Each callee, on accept, replies with a **25051 Answer** (per-peer SDP).

### 9.2 Callee-to-callee mesh (the group part)
- A **group Answer is broadcast** to **every** participant (including the caller and the
  answerer's own other devices), acting as an **"I've joined"** signal.
- When callee X learns (via that broadcast) that callee Y has joined, X and Y must establish
  their own pairwise connection. **Tiebreaker for who sends the offer: lower pubkey
  initiates** (the peer with the lexicographically lower hex pubkey creates the offer; the
  other waits).

### 9.3 Glare (simultaneous offers)
- **Initial connection glare:** resolved by the lower-pubkey-initiates rule above.
- **Renegotiation glare:** **higher pubkey wins.** The loser calls
  `setLocalDescription({type:"rollback"})`, accepts the winner's offer, and answers.

### 9.4 Renegotiation (25055)
- Used for media changes on an established connection (e.g. voice→video upgrade, adding a
  track, ICE restart). Carries a new SDP offer; peer replies with a 25051 Answer.
- Apply the glare rule in §9.3.

### 9.5 Join mid-call
- A new invitee receives a 25050 Offer from the inviter and stays **passive** toward existing
  members. **Existing connected participants unconditionally initiate** offers toward the new
  peer (asymmetric rule — avoids double-offer with the invitee).
- Enforce the 5-cap before sending the invite.

### 9.6 Leave / hangup (25053)
- Leaving a group call sends a **25053 Hangup** to all remaining participants (signed once,
  wrapped per recipient) and closes all local PeerConnections to them.
- Receiving a Hangup closes only the leg to that sender; the call continues if others remain.
- When the local participant count drops to 1, the call ends locally.

### 9.7 Reject / busy (25054)
- An explicit decline sends a **25054 Reject** to the caller (and to the rejecter's own other
  devices, so they stop ringing).
- If a new Offer arrives while already in a call and the client can't/won't accept, it
  auto-replies **25054 with content `"busy"`**.

### 9.8 Multi-device
- Answer (25051) and Reject (25054) are **also wrapped to the sender's own pubkey**, so the
  user's other logged-in devices learn the call was "answered/declined elsewhere" and stop
  ringing.

---

## 10. WebRTC media layer (browser)

- **Engine:** native `RTCPeerConnection`; `adapter.js` shim for cross-browser parity.
- **SDP semantics:** Unified Plan (browser default).
- **ICE:** trickle ICE with continual gathering; emit each local candidate as a 25052 to the
  relevant peer as it is discovered.
- **Capture:** `navigator.mediaDevices.getUserMedia({ audio, video })`.
  - Voice call: `audio:true, video:false`.
  - Video call: `audio:true, video:{ width, height, frameRate constraints }`.
- **Tracks:** add local tracks to every PeerConnection; render each remote stream in its own
  `<video>`/`<audio>` tile. A `RemoteParticipant` view model tracks per-peer media state.
- **Codecs:** rely on browser defaults (Opus audio; VP8/VP9/H.264/AV1 video as negotiated).
  Optionally constrain bitrate via `RTCRtpSender.setParameters` to protect the uplink in a
  4-peer mesh (the uplink sends the local stream N−1 times).
- **Controls:** mute (disable audio track), camera on/off (disable/replace video track),
  switch camera (`getUserMedia` with a different `deviceId` + `replaceTrack`), audio output
  selection (`setSinkId` where supported).

### 10.1 Mesh resource guidance
At the 5-cap a client encodes/sends its stream up to 4× and decodes up to 4 remote streams.
To keep this viable in-browser:
- Cap captured video resolution/framerate by participant count (e.g. lower resolution at 4–5
  peers).
- Consider simulcast or per-sender bitrate caps.
- Surface a CPU/bandwidth warning rather than silently degrading.

---

## 11. ICE / STUN / TURN

- STUN/TURN are **configured locally, never exchanged in Nostr events** (matches Amethyst).
- **Default STUN:** `stun:stun.l.google.com:19302`, `stun:stun1.l.google.com:19302`,
  `stun:stun.cloudflare.com:3478`.
- **TURN:** ship a default relay but allow the user to configure their own
  (host, port, transport, username, credential). User-supplied TURN replaces the default;
  STUN defaults remain. **A TURN server is required for reliability** — a meaningful fraction
  of browser peers are behind symmetric NATs where STUN alone fails.
- Support **ICE restart** (via 25055 renegotiation) on network change.

---

## 12. UI / UX flows

### 12.1 Outgoing
1. From a group (or member) view, user taps **Voice** or **Video**.
2. (Group) optional participant picker (subset of roster, ≤5 incl. self).
3. Permission prompt for mic/cam (§13). Local preview shows.
4. "Calling…" state; Offers sent; ringback until first Answer.

### 12.2 Incoming
1. Kind-21059 wrap with a new `call-id` Offer arrives → **incoming-call modal** with caller
   identity (resolved + roster-verified), call type, and Accept / Decline.
2. Accept → permission prompt → send 25051 Answer → connected.
3. Decline → 25054 Reject. No action within ring timeout → treat as missed (local) and send
   Reject.

### 12.3 In-call
- Per-participant tiles (video) or avatars (voice) with name, speaking indicator, mute/cam
  state. Controls: mute, camera on/off, switch camera, add-video (reneg), audio output,
  hang up. Connection-quality indicator per peer.

### 12.4 Group dynamics
- Show participants joining/leaving live. Reflect "5/5 — call full" by disabling invite.
- **Picture-in-Picture** support so the call survives navigation within the app.

---

## 13. Permissions & device management

- Request mic (voice) / mic+cam (video) via `getUserMedia` **at accept/initiate time**, not
  on app load.
- Handle **denied / no-device / device-in-use** gracefully with actionable messaging; a
  permission denial aborts the call attempt cleanly (send Reject/Hangup as appropriate).
- Enumerate devices (`enumerateDevices`) for camera/mic/output selection; handle hot-plug
  (`devicechange`).
- Browser autoplay: remote audio/video elements must be attached in response to a user
  gesture (the Accept tap) to satisfy autoplay policies.

---

## 14. Security & privacy

- **Media:** DTLS-SRTP (mandatory in WebRTC) — encrypted peer-to-peer; no server sees media.
- **Signaling confidentiality:** NIP-44 inside the 21059 wrap; only the recipient pubkey is
  exposed on the wrap's `p` tag. Sender hidden behind a per-message ephemeral key.
- **Authorization:** every inner event verified against the **MLS group roster** (§5.2) —
  this is the line that prevents non-members from injecting signaling.
- **Replay:** 20-second freshness window + event-id dedupe (§8.1).
- **Metadata exposure:** relays still see *that* a wrap was addressed to pubkey X and *when*.
  The call's existence/timing is not hidden from relays the participants publish to; the
  *content, identity of caller, and media* are. Document this for users.
- **TURN trust:** a TURN relay can observe traffic timing/volume and (if not E2E) could be a
  relay point — but media stays DTLS-SRTP encrypted end to end; TURN only forwards. Prefer a
  TURN server the user/operator controls for group calls.
- **IP exposure:** ICE reveals peer IP addresses to other call participants (inherent to P2P
  WebRTC). For a roster-gated call among known group members this is acceptable; document it.
  An all-relay (TURN-only, `iceTransportPolicy:"relay"`) mode can hide IPs at a latency cost —
  offer as an optional privacy setting.

---

## 15. Failure handling & edge cases

| Case | Behavior |
|---|---|
| Callee offline / no answer | Ring timeout (e.g. 30–60 s) → caller ends, marks missed. |
| Already in a call | Auto **Reject "busy"** (§9.7). |
| ICE fails (no connectivity) | Attempt ICE restart (reneg); if still failing, drop that leg with an error; call continues with others. |
| Network change (wifi↔cellular) | ICE restart via 25055. |
| Mid-call membership change in MLS group | Re-snapshot roster; new members are *not* auto-added to an in-progress call — they must be invited (§9.5). Removed members' legs are torn down. |
| Glare | §9.3 deterministic resolution. |
| Duplicate/late signaling | Freshness + dedupe drop it (§8.1). |
| Relay rate-limiting the ICE burst | Spread publishes across the peer's inbox relays; cap candidate emission; rely on trickle continuing. |
| Browser tab backgrounded | Maintain connection; PiP keeps media alive; warn that some browsers throttle background tabs. |
| Partial mesh (A–B fail but A–C ok) | Per-leg failure is isolated; UI shows per-peer connection state. |

---

## 16. Limits & resource management

- **Hard cap 5 participants**, enforced at initiate and at join.
- Per-peer connection-state and quality surfaced individually.
- Adaptive capture (resolution/bitrate vs. participant count) per §10.1.
- One foreground call at a time per client.

---

## 17. Dependency & stack summary

| Concern | Choice |
|---|---|
| Media engine | Native browser `RTCPeerConnection` (+ `adapter.js`) |
| Signaling events | Custom AC-WebRTC encoders (kinds 25050–25055) — implement directly; ~6 small event builders/parsers |
| Gift-wrap / NIP-44 | Existing Nostr lib (`nostr-tools` / NDK) for NIP-44 + event signing; ephemeral keypair per wrap |
| Marmot roster | `marmot-ts` (`getGroupMembers`) or MDK-WASM (`group_leaf_map`) |
| Relays | Existing relay pool; add a 21059 subscription `p`-tagged to self |
| TURN/STUN | Local config; ship defaults; user-overridable TURN |

No new media-server infrastructure. The only server you may operate is a **TURN** relay for
NAT traversal reliability.

---

## 18. Testing & acceptance criteria

**Functional**
- AC1. 1:1 voice call connects, audio flows both ways, hangup tears down cleanly.
- AC2. 1:1 video call connects; mute, camera-off, switch-camera work.
- AC3. 3–5 party group call forms a full mesh; every pair has audio/video.
- AC4. Join mid-call: a 4th party joins a 3-party call and connects to all existing peers.
- AC5. Leave mid-call: one party leaves; others remain connected.
- AC6. Decline → caller sees declined; busy auto-reject works.
- AC7. Multi-device: answering on one device stops ringing on the others.
- AC8. Voice→video upgrade via renegotiation.

**Protocol / interop**
- AC9. Emitted events match the AC-WebRTC wire format byte-for-byte where specified
  (kinds, tags, content, 21059 wrap, no `alt`/`expiration`).
- AC10. (If interop targeted) a call interoperates with an Amethyst client addressed by
  pubkey.
- AC11. Signaling older than 20 s is rejected; duplicate event ids are dropped.
- AC12. Signaling from a pubkey not in the MLS roster is rejected.

**Resilience**
- AC13. ICE restart recovers a call across a network change.
- AC14. TURN-only path works behind symmetric NAT.
- AC15. Relay rate-limit during ICE burst does not fail the call.

**Suggested harness:** Playwright with two+ browser contexts driving real
`RTCPeerConnection`s against a test relay and a TURN server; unit tests for event
encode/decode and gift-wrap round-trips.

---

## 19. Decisions (signed off 2026-06-23)

Signaling transport settled (§3, Amethyst-compatible gift-wrap). All four product decisions now resolved:

1. **Group-visible call notice: YES — lifecycle only.** Post one kind-445 MLS message at
   call-start and one at call-end, so the call appears in the group timeline and non-ringing
   members can see it. No intermediate signaling events are posted to the group channel.
2. **Default TURN provider: ship a default, user-overridable.** Works out of the box; the user
   can replace with their own TURN server in advanced settings.
3. **IP-privacy mode: OFF by default, user-enableable.** Normal P2P ICE as default (lower
   latency). Users who want to hide IPs can toggle relay-only ICE in settings.
4. **Ring timeout: 45 seconds.** After 45 s with no answer, the caller auto-cancels and the
   callee's device marks the call as missed.

---

## 20. Appendix — illustrative event shapes

**Inner Call Offer (kind 25050), before wrapping — signed by caller's real key:**
```json
{
  "kind": 25050,
  "pubkey": "<caller-hex>",
  "created_at": 1750000000,
  "tags": [
    ["p", "<callee1-hex>"],
    ["p", "<callee2-hex>"],
    ["call-id", "8f3c…-uuid"],
    ["call-type", "video"]
  ],
  "content": "v=0\r\no=- 46117317 2 IN IP4 127.0.0.1\r\ns=-\r\n…(SDP offer)…",
  "id": "…",
  "sig": "…"
}
```

**Inner ICE Candidate (kind 25052) — single recipient:**
```json
{
  "kind": 25052,
  "pubkey": "<sender-hex>",
  "created_at": 1750000003,
  "tags": [
    ["p", "<one-peer-hex>"],
    ["call-id", "8f3c…-uuid"]
  ],
  "content": "{\"candidate\":\"candidate:842163049 1 udp 1677729535 …\",\"sdpMid\":\"0\",\"sdpMLineIndex\":0}",
  "id": "…",
  "sig": "…"
}
```

**Outer gift-wrap (kind 21059) as published to relays:**
```json
{
  "kind": 21059,
  "pubkey": "<random-ephemeral-hex>",
  "created_at": 1750000003,
  "tags": [ ["p", "<recipient-hex>"] ],
  "content": "<nip44-encrypted(inner event JSON)>",
  "id": "…",
  "sig": "<signed by ephemeral key>"
}
```

**Hangup (kind 25053):** same tag shape (`p` per remaining peer + `call-id`), `content` = ""
or a reason string. **Reject (kind 25054):** `content` = `"busy"` for auto-decline.
```

## Amendments

- **2026-06-29 — AC-WIRE-5 added (receive-side structural validation).** Mutation
  testing of `callSignaling.ts` surfaced that the receive path drops structurally-
  malformed inner events (unrecognised kind, missing/empty `call-id`, non-JSON ICE
  content) as real, now-tested behavior that no acceptance criterion governed.
  Added AC-WIRE-5 to ground it (resolves BACKLOG finding
  `receive-side-structural-validation-call-signaling`).
