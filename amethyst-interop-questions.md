# AC-WebRTC interop questions for the Amethyst project

**Status:** Draft — ready to send to the Amethyst maintainers (GitHub Discussion/issue
on `vitorpamplona/amethyst`, or a DM to the devs).

**Context for us:** Nostling implements Amethyst's AC-WebRTC call protocol verbatim
(kinds 25050–25055 wrapped in ephemeral kind-21059 gift-wraps). Signaling works
end-to-end (ring + decline), but the RTCPeerConnection never reaches `connected`.
This document is the message we send to confirm our protocol assumptions match their
shipping implementation. See `spec.md` §7–§9 for our wire-format assumptions.

---

**Subject: AC-WebRTC interop — ICE/TURN expectations and freshness-window questions (calls never reach `connected`)**

Hi — we maintain a Marmot/MLS-based Nostr client and have implemented your **AC-WebRTC**
call protocol *verbatim* (kinds 25050–25055 inner events, NIP-44-encrypted, wrapped in
ephemeral **kind-21059** gift-wraps, two layers, no seal). Our explicit goal was
wire-compatibility so an Amethyst user addressed by pubkey could in principle interoperate.

**The signaling half works end-to-end:** a 25050 Offer reaches the callee, the
incoming-call UI rings, and a 25054 Reject tears the call back down on both sides.
**What never succeeds is media connection** — the RTCPeerConnection never reaches
`connected`. We want to confirm our assumptions match your shipping implementation
before we conclude the bug is purely on our side.

Our questions, grouped:

**A. ICE servers / TURN**
1. Does Amethyst ship a **default TURN server**, or is the user expected to configure one?
   We currently ship STUN-only (Google + Cloudflare) with TURN as an optional user
   setting, and we suspect that's why anything across NAT/firewalls fails — there's no
   relay candidate. What does a stock Amethyst install use?
2. If you ship a default TURN, is it a public/community server or one you operate? Would
   you consider that endpoint part of the de-facto interop contract, or strictly a
   client-local concern?
3. Do you set `iceTransportPolicy` to anything other than `all` by default (e.g. a
   privacy/relay-only mode)?

**B. Freshness window vs. trickle ICE**
4. Our spec notes a **~20-second freshness window** (discard inner events whose
   `created_at` is more than ~20s off wall-clock) as a replay defense, taken from your
   group implementation. Trickle ICE candidates (kind 25052) can arrive well after the
   offer, and relay propagation adds latency. **Does Amethyst apply the same freshness
   check to 25052 ICE candidates**, or only to the initial 25050/25051? If it applies to
   ICE, what window do you actually use in production — is 20s correct?
5. Relatedly: do you rely on relays **not** persisting kind-21059, and does late delivery
   of a candidate (past the window) get silently dropped? We want to rule out "valid
   candidates discarded as stale."

**C. Wire-format edge cases (confirm we match)**
6. We send **exactly one `p` tag** on ICE candidates (single target peer) and **one `p`
   per member** on offers/answers. Correct?
7. We **omit** both the `alt` and `expiration` tags, since your shipping code omits them
   even though `NIP-AC.md` mentions `alt`. Still accurate?
8. ICE content is JSON `{"candidate","sdpMid","sdpMLineIndex"}`, defaulting `sdpMid→"0"` /
   `sdpMLineIndex→0` when absent. Does Amethyst emit those fields, and does it tolerate
   their absence on receive?
9. `call-type` (`voice`|`video`) appears on the **offer only**. Confirm it's absent
   everywhere else.
10. `call-id`: is it a single per-call identifier, or per-leg? Our trickle routing keys
    on it and we want to match your semantics.

**D. Glare & lifecycle**
11. We resolve initial-offer glare by **lower-pubkey-initiates**, and renegotiation glare
    by **higher-pubkey-wins**. Do those match Amethyst's rules?
12. What's your **ring timeout** before auto-giving-up?

**E. Interop reality check**
13. Has AC-WebRTC ever been tested against a **non-Amethyst** client? If so, what was
    required to make ICE actually connect (a specific TURN server, a particular
    candidate-gathering timing)?
14. Is there a reference/test vector (a captured offer→answer→ICE exchange) we could diff
    our wire output against?

We're happy to share captured (decrypted) event payloads from a failing session if that
helps. Thanks for publishing the protocol openly — interop is the whole reason we built
on it rather than inventing our own.
