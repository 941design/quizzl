# AC-WebRTC interop answers — from the Amethyst source

**Status:** Answers derived directly from Amethyst's shipping source (`vitorpamplona/amethyst`,
branch `main`), cross-referenced against `amethyst-interop-questions.md`. Most of the 14
questions are now settled from code; only #13 (and part of #14) still need the maintainers.

**Where the code lives:** this working tree contains only the Amethyst *app* module. The
call-signaling logic is split across three places:

- `src/main/java/com/vitorpamplona/amethyst/service/call/` — WebRTC plumbing (local app module)
- `commons/src/commonMain/.../nipACWebRtcCalls/` — call state machine, glare, freshness (`:commons` module, fetched from GitHub)
- `quartz/src/commonMain/.../nipACWebRtcCalls/` — wire-format event classes & factory (`:quartz` module, fetched from GitHub)

---

## Headline: your prime suspect is correct — plus a second, subtler trap

Two facts from the shipping code explain "signaling works, media never connects":

1. **Amethyst ships a default TURN server; you ship STUN-only.** Almost certainly *the* bug.
2. **The ~20-second freshness window is applied to ICE candidates (kind 25052) too**, at a
   single chokepoint covering every signaling kind. Late-trickled candidates are silently dropped.

---

## A. ICE servers / TURN

**Source:** `service/call/IceServerConfig.kt`, `service/call/WebRtcCallSession.kt`

### 1 & 2 — Yes, Amethyst ships a default TURN, and it is a public community server.

Defaults from `IceServerConfig`:

- **STUN:** `stun.l.google.com:19302`, `stun1.l.google.com:19302`, `stun.cloudflare.com:3478`
- **TURN: OpenRelay** — `turn:openrelay.metered.ca:80`, `:443`, and `:443?transport=tcp`,
  username `openrelayproject`, password `openrelayproject`.

OpenRelay is a **free public/community TURN service operated by Metered**, *not* by the
Amethyst project. User-configured TURN servers *replace* the OpenRelay defaults (so credentials
can rotate without an app update); STUN is always included.

**Implication:** a stock Amethyst install always has a relay candidate. A STUN-only build has
none, so any call where at least one peer is behind a symmetric NAT/firewall can never form a
candidate pair. This is client-local config, **not** part of the wire spec — but it is a
de-facto requirement for connectivity. To interoperate out-of-the-box, ship the same OpenRelay
defaults (or any TURN).

### 3 — No relay-only mode.

`WebRtcCallSession.createPeerConnection()` sets `sdpSemantics = UNIFIED_PLAN` and
`continualGatheringPolicy = GATHER_CONTINUALLY`, but never sets `iceTransportPolicy` → it
defaults to `all`.

---

## B. Freshness window vs. trickle ICE — the second trap

**Source:** `commons/.../CallManager.kt`

### 4 — Yes, the freshness check applies to ICE candidates, and the window is 20 seconds.

- Constant: `MAX_EVENT_AGE_SECONDS = 20L` ("discard signaling events older than this").
- `isEventTooOld()` runs at the **single** entry point `onSignalingEvent()`, **above** the
  `when(event)` that dispatches to offer / answer / ICE / reject / hangup / renegotiate. So
  **every** kind — including 25052 — passes through the same 20s gate. Your spec assumption is
  confirmed exactly: **20s, and it does apply to ICE.**

A second clause also drops events whose `created_at` predates this CallManager's construction
(`createdAt < initTimestamp − 20s`), to stop relay-replayed offers from ringing after an app
restart.

### 5 — Yes, late candidates are silently dropped.

Logged as "Discarding old event", then `return`. The check is on the **inner 25052 event's
`created_at`**, not the gift-wrap's. Two ways this bites an interop partner:

- **Clock skew** between the Nostling sender and the Amethyst receiver eats directly into the
  20s budget.
- **If Nostling back-dates / randomizes the inner event's `created_at`** (the NIP-59 convention
  of obscuring timing), Amethyst treats those candidates as stale and discards them. The *offer*
  may squeak through while *trickled candidates* — arriving a second or two later plus relay
  latency — get clipped. This matches the observed symptom.

**Action:** confirm Nostling stamps the **inner** ICE event with true wall-clock `now()`, and
that device clocks are in sync.

---

## C. Wire-format edge cases — all confirmed

**Source:** `quartz/.../events/CallOfferEvent.kt`, `CallIceCandidateEvent.kt`,
`WebRtcCallFactory.kt`, `tags/CallIdTag.kt`, `tags/CallTypeTag.kt`;
`src/test/.../call/IceCandidateSerializationTest.kt`

| # | Your assumption | Verdict | Evidence |
|---|---|---|---|
| 6 | one `p` on ICE; one `p` per member on offers/answers | **Correct** | `CallIceCandidateEvent.build` → single `pTag`; `CallOfferEvent.build` → `pTagIds(members)` (one `p` per member) |
| 7 | omit `alt` and `expiration` | **Correct** | Builders add only `p`, `call-id`, and (offer) `call-type`. No `alt`, no `expiration`. |
| 8 | ICE JSON `{candidate,sdpMid,sdpMLineIndex}`, defaults `"0"`/`0` | **Correct** | `serializeCandidate` always emits all three; on receive `sdpMid` defaults `"0"`, `sdpMLineIndex` defaults `0`. Absence tolerated. |
| 9 | `call-type` on offer only | **Correct** | Only `CallOfferEvent` writes `call-type` (`voice`/`video`); answer / ICE / renegotiate / hangup / reject do not. |
| 10 | `call-id` single per-call, not per-leg | **Correct** | One UUID minted once at `initiate()`, threaded to every peer, offer, and candidate. Tag name is literally `call-id`. |

---

## D. Glare & lifecycle

**Source:** `commons/.../PeerSessionManager.kt`, `commons/.../CallManager.kt`

### 11 — Both rules match, with one clarification.

- Mesh / callee-to-callee: `shouldInitiateOffer = localPubKey < peerPubKey` → **lower pubkey
  initiates.** ✓
- Renegotiation glare: `localPubKey > peerPubKey` → local wins, else roll back local offer →
  **higher pubkey wins.** ✓

**Clarification:** the lower-pubkey rule is specifically the **callee-to-callee mesh** rule
(group calls), *not* an "initial 1-to-1 offer glare" rule. A normal 1-to-1 call has a clear
caller/callee and no pubkey tiebreak. If your "initial-offer glare" handling only fires in the
mesh case you match; if you apply it to 1-to-1 dialing, that's a divergence.

### 12 — Ring / lifecycle timeouts (`CallManager` companion constants).

| Constant | Value | Meaning |
|---|---|---|
| `CALL_TIMEOUT_MS` | **60s** | Callee-side ringing timeout |
| `PEER_INVITE_TIMEOUT_MS` | **30s** | Caller-side per-peer invite timeout |
| `CONNECTING_TIMEOUT_MS` | **30s** | Time allowed to establish the ICE connection |
| `RINGING_WATCHDOG_MS` | **65s** | Hard ceiling on any ringing state (fail-safe) |

---

## E. Interop reality check

### 13 — Has AC-WebRTC been tested against a non-Amethyst client?

**Not answerable from source — keep this one for the maintainers.**

### 14 — Reference / test vectors.

**Partially answered: yes, vectors exist in the repo.** Under
`quartz/src/commonTest/.../nipACWebRtcCalls/`:

- `CallEventsTest.kt`
- `CallTagsTest.kt`
- `NipACGiftWrapRoundTripTest.kt`
- `NipACStateMachineTest.kt`

You can diff Nostling's wire output against these directly instead of asking.

---

## What to do next

1. **Fix #1 (high confidence):** ship a TURN server. The connect failure is fully explained by
   STUN-only + no relay candidate.
2. **Fix #2 (verify):** ensure Nostling stamps **inner** 25052 events with real wall-clock
   `created_at` (not a NIP-59 back-dated time) and that device clocks are in sync — otherwise
   Amethyst drops your candidates at the 20s gate.

**Of the 14 questions, only #13 truly needs the maintainers; #14 is answerable by diffing
against the quartz tests; everything else is confirmed above.**
