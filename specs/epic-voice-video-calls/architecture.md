# Architecture: Voice/Video Calls (AC-WebRTC)

**Status:** Approved — implementation baseline

---

## Module map

```
app/src/lib/calls/
  callSignaling.ts     — send/receive kind-25050–25055 wrapped in kind-21059
  callStore.ts         — module-level external store (call state, ring queue)
  callManager.ts       — orchestrate PeerSessions; state machine per call-id
  peerSession.ts       — single RTCPeerConnection lifecycle + trickle ICE
  mediaManager.ts      — getUserMedia, track management, mute/camera toggle
  turnConfig.ts        — TURN/STUN config read/write (lp_turnConfig_v1)

app/src/components/calls/
  IncomingCallWatcher.tsx  — null-rendering global subscriber (Layout.tsx mount)
  IncomingCallModal.tsx    — Chakra UI Modal: ring, accept, decline
  CallScreen.tsx           — active call UI: video grid, controls, hang up

app/src/lib/i18n.ts        — call UI strings (en + de) added here
app/src/types/index.ts     — CallState, IncomingCall, CallParticipant types
app/pages/settings.tsx     — TURN config panel + IP-privacy toggle added here
```

---

## Signaling transport: kind-21059 outer wrap

The AC-WebRTC protocol uses kind-21059 as the **outer** wrap (ephemeral gift-wrap). This differs from the existing codebase where:
- DMs use kind-1059 outer wrap (NIP-59 3-layer: wrap → seal → unsigned rumor)
- Join requests use kind-21059 as the **inner** rumor kind, wrapped in kind-1059 outer

The call signaling path uses **2 layers** only (no seal):

```
Inner event (signed, kind 25050–25055)
  encrypted via signer.nip44.encrypt(recipientPubkeyHex, JSON.stringify(signedInnerEvent))
  → outer kind-21059 gift-wrap (ephemeral key signs the outer event)
```

### Send path
Adapt `buildGiftWrap()` from `joinRequestSender.ts`:
1. Build inner event: `{ kind: 25050–25055, pubkey, created_at, tags: [['p', recipientHex]], content }`
2. Sign inner event: `signer.signEvent(innerDraft)` → `signedInner`
3. Encrypt: `signer.nip44.encrypt(recipientPubkeyHex, JSON.stringify(signedInner))`
4. Wrap: `finalizeEvent({ kind: 21059, created_at, tags: [['p', recipientHex]], content: encrypted }, ephemeralPrivBytes)`
5. Publish: `NDKEvent(ndk, wrap).publish(relaySet)`

For multi-recipient events (ICE candidates, re-negotiation), send one wrap per recipient.

### Receive path
NDK subscription: `ndk.subscribe({ kinds: [21059], '#p': [ownPubkeyHex] })`

Unwrap (2-layer, no seal):
1. NIP-44 decrypt outer wrap: `nip44.decrypt(ownPrivBytes, giftWrap.pubkey, giftWrap.content)` → `innerJson`
2. Parse inner event: `JSON.parse(innerJson)` → `innerEvent`
3. Verify signature: `verifyEvent(innerEvent)` (rejects forgeries)
4. Freshness check: `Math.abs(Date.now()/1000 - innerEvent.created_at) < 20` (discard stale)
5. Dedupe: seen-ids Set (bounded to last 500 ids)
6. Roster gate: `getGroupMembers(mlsGroup.state)` must include `innerEvent.pubkey`

---

## IncomingCallWatcher

Follows `DirectMessageNotificationsWatcher.tsx` exactly:

```typescript
// app/src/components/calls/IncomingCallWatcher.tsx
export function IncomingCallWatcher() {
  const { hydrated, pubkeyHex, privateKeyHex } = useNostrIdentity();
  const { groups, getClient } = useMarmot();
  const groupsRef = useRef(groups);
  // keep groupsRef current without rebuilding subscription
  useEffect(() => { groupsRef.current = groups; }, [groups]);

  useEffect(() => {
    if (!hydrated || !pubkeyHex || !privateKeyHex) return;
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    (async () => {
      const { subscribeCallSignaling } = await import('@/src/lib/calls/callSignaling');
      unsubscribe = subscribeCallSignaling({
        pubkeyHex, privateKeyHex, groupsRef, getClient,
        onIncomingCall: (call) => incomingCallStore.setIncoming(call),
      });
    })();

    return () => { cancelled = true; unsubscribe?.(); };
  }, [hydrated, pubkeyHex, privateKeyHex]);

  return null;
}
```

**Mount point:** `app/src/components/Layout.tsx` alongside `<DirectMessageNotificationsWatcher />`.

---

## callStore.ts — module-level external store

Follows `pendingInvitations.ts` / `unreadStore.ts`:

```typescript
// No React imports in this file
interface CallState {
  incoming: IncomingCall | null;   // ringing
  active: ActiveCall | null;       // in-progress
}

let state: CallState = { incoming: null, active: null };
const listeners = new Set<() => void>();

function emit() { listeners.forEach(l => l()); }

export const callStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): CallState { return state; },
  setIncoming(call: IncomingCall | null) { state = { ...state, incoming: call }; emit(); },
  setActive(call: ActiveCall | null) { state = { ...state, active: call }; emit(); },
};

export function useCallStore() {
  return useSyncExternalStore(callStore.subscribe, callStore.getSnapshot, () => ({ incoming: null, active: null }));
}
```

---

## callManager.ts — state machine

One `CallManager` instance per active call. Coordinates:
- `SignalingTransport` (callSignaling.ts) for send/receive
- `PeerSession` per remote participant (full-mesh, cap 5)
- State transitions: `idle → ringing → active → ended`

Glare resolution:
- Initial offer: lower pubkey initiates
- Renegotiation: higher pubkey wins (drops own offer, adopts incoming)

Ring timeout: 45 seconds (spec §19 resolution).

---

## peerSession.ts — single RTCPeerConnection

One `PeerSession` per (callId, remotePubkey) pair.

```typescript
class PeerSession {
  private pc: RTCPeerConnection;
  private iceCandidateQueue: RTCIceCandidateInit[] = [];

  constructor(config: RTCConfiguration, onIceCandidate: (c: RTCIceCandidateInit) => void) { ... }
  async createOffer(stream: MediaStream): Promise<RTCSessionDescriptionInit> { ... }
  async applyAnswer(sdp: RTCSessionDescriptionInit): Promise<void> { ... }
  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> { ... }
  addTrack(stream: MediaStream): void { ... }
  close(): void { this.pc.close(); }
}
```

Trickle ICE: emit candidates as they arrive; buffer incoming candidates until remote description is set.

---

## mediaManager.ts

```typescript
export async function acquireMedia(video: boolean): Promise<MediaStream>
export function muteAudio(stream: MediaStream, muted: boolean): void
export function disableVideo(stream: MediaStream, disabled: boolean): void
export function releaseMedia(stream: MediaStream): void
```

IP-privacy mode (off by default, user-toggleable): use `iceTransportPolicy: 'relay'` in `RTCConfiguration` to force TURN-only.

---

## TURN config

Storage key: `lp_turnConfig_v1` (localStorage, follows lp_ prefix convention).

Default shipped config (user-overridable): a public TURN server URL + credential pair in `turnConfig.ts`. User can override in Settings → Advanced → Call Settings.

---

## Group call notice (kind-445)

When a call starts or ends, publish a kind-445 MLS group message with a structured content type `call_notice`:

```json
{ "type": "call_notice", "event": "started" | "ended", "callId": "...", "initiator": "pubkeyHex" }
```

This plugs into the `applicationRumorDispatcher` → new `callNoticeHandler` with kind `CALL_NOTICE_RUMOR_KIND`.

---

## Settings integration

`app/pages/settings.tsx` gains a new "Call Settings" section:
- TURN server URL (text input, defaults to shipped value)
- TURN username / credential (text inputs)
- IP privacy mode toggle (off by default)

All stored under `lp_turnConfig_v1`.

---

## Story order

| # | Story | Module(s) | Verify |
|---|-------|-----------|--------|
| 1 | Signaling transport | callSignaling.ts | unit: send/receive/freshness/dedupe |
| 2 | Call store + watcher | callStore.ts, IncomingCallWatcher.tsx | unit: store mutations; manual: watcher mounts |
| 3 | Media manager | mediaManager.ts | unit: mock getUserMedia |
| 4 | PeerSession | peerSession.ts | unit: mock RTCPeerConnection |
| 5 | CallManager state machine | callManager.ts | unit: offer/answer/ICE/hangup/glare |
| 6 | Incoming call modal UI | IncomingCallModal.tsx | unit: render/accept/decline |
| 7 | Active call screen | CallScreen.tsx | unit: render; manual: loopback ICE |
| 8 | Start call entry point | groups.tsx (or contacts) | manual: initiate call flow |
| 9 | Group call notice | callNoticeHandler.ts | unit: kind-445 encode/dispatch |
| 10 | Call settings panel | settings.tsx | manual: save/load TURN config |
| 11 | i18n completeness | i18n.ts | unit: en/de present and differ |
| 12 | E2E: outgoing call rings | e2e | e2e: two-user ring + decline |

Stories 1–5 are pure library code (no UI, no context) and can be reviewed independently. Stories 6–10 build on top. Story 12 (e2e) requires TURN or loopback ICE — loopback candidates work on the same machine without TURN, so basic ring/answer e2e is feasible in CI.

---

## Conventions checklist for every story

- [ ] All user-visible strings in `i18n.ts` (en + de) before first render
- [ ] Storage keys use `lp_` prefix
- [ ] No `console.error` in handler layer; use `console.warn`
- [ ] No direct relay WebSocket in tests; use app window bridge
- [ ] Handler tests use `createXxxHandler(makeDeps())` with `vi.fn()` spies
- [ ] Dynamic imports inside effects for crypto/NDK modules (SSR safety)
- [ ] Cleanup functions return `cancelled = true` + `unsubscribe?.()` from `useEffect`
