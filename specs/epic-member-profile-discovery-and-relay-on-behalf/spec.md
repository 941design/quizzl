# Member profile discovery and relay-on-behalf

## Intent

When a member joins an existing Marmot MLS group, the app must show every other member's display profile (nickname, avatar, badges) — not a hex pubkey. Today we rely on two mechanisms:

1. **MLS history replay.** When a new member subscribes to the group's relays for kind 445 events, they replay every commit and application rumor since the group's birth. Profile rumors received historically are merged into IndexedDB.
2. **Proactive republish on member-add.** Each existing member, on observing a member-count increase, republishes their own profile to the group (`MarmotContext.tsx:672–678`).

Both mechanisms have failure modes:

- **Aged history.** Relays may prune kind 445 events before a new member subscribes. The application rumor carrying an existing member's profile is gone, and historical replay yields nothing for them.
- **Offline existing members.** Proactive republish only fires while the existing member's app is online and connected. A member who has been offline for a week simply does not introduce themselves to a newcomer joining today.
- **Chatty.** Every join triggers every existing member to republish. In a group of N, every join produces O(N) profile rumors, advancing the MLS key schedule O(N) times for a piece of data that may not have changed in months.

This feature replaces proactive republish with a request/response mechanism inside the encrypted group, augmented by **relay-on-behalf**: any peer holding a cached, cryptographically signed profile for the target may rebroadcast it on the target's behalf if the target is offline. A weekly "freshness" sweep keeps cached profiles current without manual intervention.

The intended outcome:

- A newcomer who joins after profile rumors have aged out of relay history sees real names within seconds, not after waiting for every other member to come online.
- Existing members no longer talk over each other on every join. The group's chatter on the relay drops to roughly one request and one response per stale member per week, and zero for steady-state groups.
- The system tolerates offline targets: as long as one peer in the group has a cached signed profile rumor for the offline target, the newcomer can resolve them.
- Authentication is cryptographic, not based on group-member trust: profile rumors become signed Nostr kind:0 events, and the signature is verified before merge or relay.

## Background: how profile data flows today

- The user's local profile is stored in `localStorage` (`lp_userProfile_v1`), edited via `ProfileContext`.
- When the user publishes their profile to a group, `serialiseProfileUpdate` (in `app/src/lib/marmot/profileSync.ts`) emits a JSON payload (`{nickname, avatar, badgeIds, updatedAt}`). It is wrapped in an MLS application rumor of kind 0 by `buildRumor` (`MarmotContext.tsx:99`) and sent via `sendRumorSafe` → `mlsGroup.sendApplicationRumor`.
- Receivers (`MarmotContext.tsx:541`) parse the rumor's content as a `ProfilePayload`, derive a `MemberProfile`, and persist it to IndexedDB (`quizzl-member-profiles`) with last-writer-wins by `updatedAt`. The cross-group cache (`lp_contactCache_v1`, in `localStorage`) is also updated.
- The rumor itself is **not** signed at the Nostr layer. This is by MIP-03 design: "Inner events MUST remain unsigned (no `sig` field)" and "Inner events MUST use the sender's Nostr identity key in the `pubkey` field." Authentication is delegated entirely to the MLS framing — the receiver should know which group leaf (and therefore which identity pubkey) sent the application message.
- In practice, **today's marmot-ts does not surface the MLS sender leaf** to its consumer when emitting an `applicationMessage`, so the implied check `rumor.pubkey === leafCredentialPubkey` cannot be performed. The rumor's `pubkey` is sender-controlled JSON and is trusted because the sender is a group member. The same is true for every rumor kind in this app (chat, score, polls).

For first-hand profile broadcasts, this is the trust model the rest of the app already operates under. For relay-on-behalf it is fundamentally insufficient: the MLS envelope authenticates the relayer, not the original author, so a leaf-credential check would always reject a legitimate relay. Hence this feature introduces individual signing at the application layer, scoped to profile rumors. The signature lives **inside** the rumor's `content` — the outer rumor remains unsigned, preserving MIP-03 conformance — and provides the only mechanism that survives both the current marmot-ts state and any future fix.

The broader gap (sender-leaf information dropped at the marmot-ts boundary) is filed as a parallel feature request in [`marmot-ts-rumor-sender-authentication.md`](./marmot-ts-rumor-sender-authentication.md). Once that request lands, chat, score, and poll rumors gain protocol-level sender authentication uniformly; profile rumors here remain dependent on the embedded application-layer signature for the relay-on-behalf path specifically.

## Design

### Wire format

#### Profile rumor (existing kind 0, content reshaped)

The MLS application rumor itself stays exactly as MIP-03 prescribes — unsigned, with the sender's identity pubkey in `pubkey` — but its `content` field is repurposed to carry a stringified, fully signed Nostr kind:0 event:

```
+------------------------------------------------------------+
| MLS application rumor (unsigned, per MIP-03)               |
| {                                                          |
|   id, pubkey, created_at, kind: 0, tags: [],               |
|   content: <stringified SignedProfileEvent below>          |
| }                                                          |
+------------------------------------------------------------+
              │
              ▼ JSON.parse(rumor.content)
+------------------------------------------------------------+
| SignedProfileEvent (full Nostr kind:0 with sig)            |
| { id, pubkey, created_at, kind: 0, tags, content, sig }    |
|   └── content = JSON: { nickname, avatar, badgeIds,        |
|                          updatedAt }                       |
+------------------------------------------------------------+
```

```ts
type SignedProfileEvent = {
  id: string;          // sha256 of canonical serialisation
  pubkey: string;      // hex
  created_at: number;  // unix seconds
  kind: 0;
  tags: string[][];
  content: string;     // JSON: { nickname, avatar, badgeIds, updatedAt }
  sig: string;
};
```

Producer signs via the existing `signerAdapter.ts` path and stringifies the result into the outer rumor's `content`. Receivers `JSON.parse` `rumor.content`, verify the embedded `sig` using `nostr-tools`'s `verifyEvent`, and only then merge. A profile whose embedded signature does not verify is dropped silently. The outer rumor never gets a `sig` of its own — MIP-03 conformance is preserved.

This framing is what makes relay-on-behalf safe: when peer A relays B's profile, the MLS envelope authenticates A as the sender, which is fine — receivers ignore the MLS-level sender for profile rumors and rely on the embedded `SignedProfileEvent.sig` as the trust anchor. The same mechanism also hardens first-hand profile broadcasts against the spoofing gap described above, so profiles get cryptographic authenticity even before the parallel marmot-ts request lands.

Backward compatibility: if `rumor.content` parses but lacks the embedded-event shape (legacy peer on old code emitting the previous flat `ProfilePayload` JSON), accept and merge as before, but mark the resulting `MemberProfile.signedEvent` as `undefined`. Such profiles cannot be relayed on behalf — a soft-fail until the legacy peer upgrades.

#### Profile-request rumor (new kind 30)

```ts
const PROFILE_REQUEST_KIND = 30;

type ProfileRequestPayload = {
  type: 'profile_request';
  targetPubkey: string;          // single target per request
  sinceUpdatedAt?: string;       // optional ISO; "only respond if newer"
  nonce: string;                 // randomness so identical requests differ
};
```

One target per request keeps backoff and dedupe simple. Existing application rumor kinds are 0, 1, 9, 10, 11, 12 — kind 30 is clear inside the MLS namespace.

### Storage

#### `MemberProfile` extension

Add `signedEvent?: SignedProfileEvent`. Persisted alongside parsed fields by an updated `mergeMemberProfile` (`groupStorage.ts:137`).

#### New IDB store: profile request memos

```ts
type ProfileRequestMemo = {
  groupId: string;
  targetPubkey: string;
  lastRequestAt: number;          // unix ms — most recent request we OR a peer issued
  lastAnsweredAt: number | null;  // unix ms of most recent satisfying response
  attempts: number;               // resets when an answer arrives
};
```

Stored in a new IDB store `quizzl-profile-request-memos` keyed by `${groupId}:${targetPubkey}`. Cleared by `clearProfileRequestMemos`, wired into `clearAllGroupData` and `leaveGroup`.

#### Constants

```ts
PROFILE_STALENESS_MS    = 7 * 24 * 60 * 60 * 1000;
REQUEST_DEDUPE_MS       = 7 * 24 * 60 * 60 * 1000;
UNANSWERED_RETRY_MS     = 60 * 60 * 1000;
UNANSWERED_MAX_ATTEMPTS = 3;
RELAY_BACKOFF_MIN_MS    = 5_000;
RELAY_BACKOFF_MAX_MS    = 30_000;
```

### Triggers for emitting a request

- **On app start.** A `useEffect` in `MarmotContext` runs once after `ready && groups.length > 0 && pubkeyHex`. It walks every group's MLS member list; for each non-self member whose `MemberProfile` is missing or older than `PROFILE_STALENESS_MS`, it consults the dedupe memo and emits a request if allowed.
- **On group open.** `GroupDetailView` (in `pages/groups.tsx`) calls a new `requestProfilesIfStale(groupId)` exposed on the Marmot context as part of the route effect that fires when the user navigates into a group.
- **No background timers.** Lazy on entry is sufficient and avoids waking the tab pointlessly.

### Dedupe and retry

Decision predicate `shouldEmitRequest(memo, now)`:

| Memo state | Result |
|---|---|
| No memo, or last request > 7d ago | Emit (reset attempts to 1) |
| `lastAnsweredAt` within 7d | Skip (already fresh) |
| Last request < 1h ago | Skip (cooldown) |
| Last request 1h–7d ago, attempts < 3 | Emit (increment attempts) |
| Last request 1h–7d ago, attempts ≥ 3 | Skip (give up until weekly window expires) |

Peer-issued requests we observe over the wire also call `recordRequestEmitted`, so dedupe is shared across the group automatically — only the first peer to act actually sends.

When a fresh kind:0 response arrives and `mergeMemberProfile` accepts it, `recordRequestAnswered` zeroes attempts and sets `lastAnsweredAt = now`.

### Response coordination

Two response paths:

1. **Target replies immediately.** When a request arrives and `targetPubkey === selfPubkeyHex`, the target signs a fresh kind:0 profile event and emits a profile rumor with no backoff.
2. **Peer relays cached signed event after backoff.** Otherwise, the receiver loads its `MemberProfile` for the target. If a `signedEvent` is cached and the request's `sinceUpdatedAt` (if present) is older than the cached `updatedAt`, schedule a `setTimeout(pickBackoffMs())` (uniform 5–30 s) to send the cached signed event verbatim. The pending timer is keyed by `(groupId, targetPubkey)` in a module-level Map.

Cancellation: any incoming kind:0 observation for the target whose `updatedAt >= scheduledForUpdatedAt` clears the timer. A satisfying response from the target itself (or another peer who relayed first) suppresses our relay.

If multiple peers' backoffs collide, the receiver-side dedupe is by event id (identical signed events have identical ids) and LWW by `updatedAt`. The 5–30 s spread across ~25 distinct slots makes triple-collisions rare for groups of ≤10.

### On-join behaviour change

- **Removed:** the `if (currentMembers.length > prevMemberCount)` republish block in `MarmotContext.tsx:672–678`. Existing members no longer broadcast on member-add.
- **Kept:** the `onHistorySynced` introduction at lines 683–695 — newcomer publishes their own profile once after first history sync, so existing members learn who joined without needing to request.
- **Kept:** the inviter republish in `inviteByNpub` at lines 893–896 — the inviter is online by definition and the immediate publish is the simplest way to give the invitee a first impression.

## Code changes (file-by-file)

| File | Change |
|---|---|
| `app/src/lib/marmot/profileSync.ts` | Sign in `serialiseProfileUpdate`; verify in `parseProfilePayload`; thread `signedEvent` through `payloadToMemberProfile`. |
| `app/src/lib/marmot/profileRequestSync.ts` *(new)* | Pure helpers: `serialiseProfileRequest`, `parseProfileRequestPayload`, `isProfileStale`, `shouldEmitRequest`, `pickBackoffMs`; constants. |
| `app/src/lib/marmot/profileRequestRunner.ts` *(new)* | `sweepStaleProfiles`, `handleIncomingProfileRequest`, `notifyProfileObserved`. Owns the pending-relay timer map. |
| `app/src/lib/marmot/groupStorage.ts` | Add `profileRequestMemoStore` and four memo accessors; teach `mergeMemberProfile` to persist `signedEvent`; wire `clearProfileRequestMemos` into `clearAllGroupData` and `leaveGroup`. |
| `app/src/types/index.ts` | Extend `MemberProfile` with `signedEvent?`; export `SignedProfileEvent`. |
| `app/src/context/MarmotContext.tsx` | Remove proactive republish branch (672–678); add `PROFILE_REQUEST_KIND` dispatch arm; verify sig and call `notifyProfileObserved` in the kind 0 arm; add app-start sweep effect; expose `requestProfilesIfStale(groupId)`. |
| `pages/groups.tsx` | In `GroupDetailView`'s route effect, call `requestProfilesIfStale(id)` after `setGroup(found)`. |
| `app/tests/e2e/groups-profile-request.spec.ts` *(new)* | E2E coverage (see Verification). |
| `app/tests/unit/profileRequestSync.test.ts` *(new)* | Unit coverage of pure helpers. |

## Edge cases

| Case | Behaviour |
|---|---|
| Sole member of a group | Sweep filters self out; empty list → no requests. |
| Newcomer closes app before `onHistorySynced` fires | No introduction sent. Existing members request on their next sweep (within 7 d). On newcomer's next session, `onHistorySynced` fires and they introduce themselves. |
| Two newcomers concurrent | Each sweeps independently; each may request the same target. Receivers dedupe by event id. Worst case 2 redundant rumors per stale member. |
| Cached `signedEvent` itself stale | Honour `sinceUpdatedAt`. If request has no `sinceUpdatedAt`, relay anyway — stale beats nothing. The target if online outraces us with no backoff. |
| User updates own profile mid-window | `publishProfileUpdate` sends a fresh signed event; peers' dispatch arm calls `notifyProfileObserved`, cancelling pending relays for self. |
| Legacy peer sends unsigned rumor | Accepted via fallback path; merged with `signedEvent: undefined`; not relayable until the peer upgrades. |
| Forged signature | Rejected before merge; no IDB write, no contact-cache update. |

## Verification

E2E spec `app/tests/e2e/groups-profile-request.spec.ts`, modelled on `groups-profile-update-propagation.spec.ts` and `groups-member-profiles.spec.ts`.

1. **Aged-history backfill (target online).** A and B in a group with mutual profiles. Clear C's IDB profile entry for B before C joins to simulate aged history. C joins. Within ~5 s, C's MemberList shows B's nickname.
2. **Periodic refresh.** Inject `lastAnsweredAt = now − 8 d` via `page.evaluate`. Reload C. Sweep emits a fresh request; memo's `lastRequestAt` advances; B replies; `lastAnsweredAt` updates.
3. **Per-peer dedupe across two listeners.** A, B already mutual; C joins. Count outbound `PROFILE_REQUEST_KIND` rumors and inbound `PROFILE_RUMOR_KIND` rumors via instrumented `onApplicationMessage`. Expect exactly one request from C, and at most one response (B's).
4. **Relay-on-behalf when target offline.** A, B, C in a group. B disconnects (`page.context().setOffline(true)`). Clear C's cached profile of B. C navigates into the group. Within ~30 s, B's nickname appears in C's MemberList — proving A relayed B's cached signed event.
5. **Retry policy state machine.** Time-shift via injected `Date.now()` shim. Assert: no retry within 1 h; retry after 1 h; no retry within 7 d after success; give up after 3 attempts within a 7 d window.
6. **Sig verification rejects forged profile.** Construct a kind:0 with mismatched sig and inject; assert merge is rejected.

Unit tests for `profileRequestSync.ts` (`isProfileStale` boundaries, `shouldEmitRequest` truth table, `pickBackoffMs` range) and `profileSync.ts` (sign/verify round-trip, legacy fallback) under `app/tests/unit/`.

End-to-end manual sanity check: in the dev server, create a group with two browser profiles, exchange profiles, then in a third browser join and verify display name appears within seconds. Repeat with the second profile offline (close that tab) to verify relay-on-behalf.

## Risks and trade-offs

- **Wire-format migration.** Profile rumors gain an embedded signed Nostr event in `rumor.content`. The outer rumor stays unsigned, so MIP-03 conformance is intact and we do not pre-empt the marmot-ts sender-authentication fix tracked in [`marmot-ts-rumor-sender-authentication.md`](./marmot-ts-rumor-sender-authentication.md). Backward compatibility (legacy flat `ProfilePayload` accepted, just non-relayable) makes deployment safe.
- **Inconsistency with other rumor kinds.** Profile rumors get cryptographic sender authentication; chat, score, and poll rumors continue to trust MLS membership only. The asymmetry is justified — relay-on-behalf forces our hand for profiles, and profile spoofing has outsized blast radius (every message rendered under that pubkey is mis-attributed). The other rumor kinds are addressed uniformly when the marmot-ts request lands; doing them in-app one-by-one is the wrong layer.
- **Storage size.** Cached signed events add ~1–2 KB per (group, member). Typical bound: a few hundred KB across all groups. Acceptable.
- **Echo amplification under backoff collision.** Mitigation: receiver-side `id` dedupe, cancellation on observation, wide backoff range.
- **MLS epoch advance per request.** Each `sendApplicationRumor` advances the key schedule. A sweep finding N stale members emits N requests. Tolerable for typical groups (≤10 stale). If real-world traffic shows pressure, switch to multi-target requests later — keep per-target dedupe semantics by treating each entry independently.
- **Newcomer who leaves immediately.** Their introduction may not land; existing members backfill via the request mechanism on next sweep.
- **Privacy.** Request reveals "who I haven't heard from recently" within an encrypted MLS group. Not a leak — the group already knows its membership and chat history.

## Related work

- [`marmot-ts-rumor-sender-authentication.md`](./marmot-ts-rumor-sender-authentication.md) — submitted upstream feature request to expose the MLS sender leaf credential alongside `applicationMessage` events. Closes the broader spoofing gap across all rumor kinds (chat, score, polls, leave proposals at the application layer). Independent of this spec; profile relay-on-behalf still needs the embedded-signature mechanism even after that request lands, because the relayer's leaf identity legitimately differs from the original author's.

## Suggested implementation order

1. Wire-format upgrade in isolation: sign in `serialiseProfileUpdate`, verify in `parseProfilePayload`, persist `signedEvent`. Verify against existing profile-propagation tests.
2. Memo store + sweep helpers in `profileRequestSync.ts` (no new wire traffic yet).
3. Request rumor + handler: `PROFILE_REQUEST_KIND`, dispatch arm, target-side immediate response.
4. Remove proactive on-join branch (`MarmotContext.tsx:672–678`).
5. App-start and group-open sweeps.
6. Relay-on-behalf with backoff + cancellation.
7. E2E and unit tests.
