# Walled Garden v2 — Acceptance Criteria

## Terminology

- **current member-pubkey** — a hex pubkey that appears in
  `group.memberPubkeys` for at least one MLS group the user has
  currently joined, excluding the user's own pubkey. (Same as epic
  1's "member-pubkey.")
- **ever-known peer** — a hex pubkey that appears in the persistent
  `knownPeers` set, which is seeded from current member-pubkeys at
  every group-membership change and grows monotonically.
- **whitelist** — the union of current member-pubkeys and ever-known
  peers, excluding own pubkey. The walled-garden's allow-set.
- **stranger** — any hex pubkey that is NOT in the whitelist at the
  moment of evaluation, including the user's own pubkey (defensive
  drop). A peer can transition stranger → member-pubkey via the
  pull-only invitation flow followed by a Welcome accept.
- **pending invitation** — an inbound Welcome event held in the
  persistent `lp_pendingInvitations_v1` queue awaiting user accept
  or decline. The Welcome has been cryptographically validated
  (NIP-59 seal verified, kind-444 unwrapped) but
  `client.acceptWelcome` has NOT been called.
- **inbound DM event** — same as epic 1: kind-4 with `#p` matching
  own pubkey, or kind-1059 with `#p` matching own pubkey whose
  unwrapped rumor is a kind-14 or kind-7.
- **migration backfill** — the one-time first-boot effect that
  seeds `lp_knownPeers_v1` from current MLS group memberships and
  runs the purge sweep. Gated by `lp_knownPeersMigrated_v2`.

## Known TAGs

- **STRUCT** — module shape, signatures, file:line refs.
- **SEC** — security / walled-garden enforcement assertions.
- **EVER** — ever-known persistence semantics.
- **INVITE** — pending-invitation queue semantics.
- **PURGE** — soft-purge behavior (extended from epic 1).
- **MIGRATE** — first-boot migration semantics.
- **REACT** — reactivity to group-membership change or invitation
  accept/decline.
- **TEST** — test-suite invariants.
- **OBS** — observability / logging.

## Ever-Known Persistence (S1)

**AC-STRUCT-1** — A module at `app/src/lib/knownPeers.ts` MUST
export pure functions:

```ts
loadKnownPeers(): ReadonlySet<string>
rememberKnownPeer(peerHex: string): void
rememberKnownPeers(peerHexes: ReadonlyArray<string>): void
isKnownPeer(peerHex: string): boolean
knownPeersMigrationComplete(): boolean
markKnownPeersMigrationComplete(): void
```

The module MUST NOT import from `idb-keyval`, any NDK package,
React, `app/src/context/`, or `app/src/components/`. It MAY
import from `app/src/types/` (for shared types) and from itself
only. It MUST be synchronous.

**AC-STRUCT-2** — `walledGarden.ts`'s `isAllowedDmSender` MUST be
extended to the signature:

```ts
isAllowedDmSender(
  peerHex: string,
  groups: ReadonlyArray<Group>,
  knownPeers: ReadonlySet<string>,
  ownPubkeyHex: string | null | undefined,
): boolean
```

All five call sites updated: bell watcher
(`directMessageNotifications.ts`), historical kind-4, historical
kind-1059, live kind-4, live kind-1059, kind-7 dispatch (all in
`ContactChat.tsx`), and the four purge helpers (`contacts.ts`,
`chatPersistence.ts`, `unreadStore.ts`, `reactions/api.ts`).

**AC-EVER-1** — `rememberKnownPeer(peerHex)` MUST lowercase the
input and add to the persistent set in `localStorage` under key
`lp_knownPeers_v1`. The stored value MUST be a JSON array of
lowercased hex strings. Subsequent calls with the same peer MUST
be no-op (idempotent).

**AC-EVER-2** — `rememberKnownPeer(peerHex)` MUST refuse the user's
own pubkey. If `ownPubkeyHex` is not directly available to the
function, the architect's chosen wiring (parameter, closure,
context-bound) MUST ensure the filter applies at write time. The
AC binds the outcome: `loadKnownPeers()` MUST never return the
user's own pubkey.

**AC-EVER-3** — `rememberKnownPeer('')` MUST be a silent no-op.
`rememberKnownPeer` MUST NOT throw on any input.

**AC-EVER-4** — A `useEffect` in `MarmotContext.tsx` MUST run on
every change to `groups` or `groupDataVersion` and MUST call
`rememberKnownPeers` with the union of `group.memberPubkeys`
across every current group, excluding own pubkey. This effect
runs after the existing group-hydration and is reactive (no
timer).

**AC-EVER-5** — `knownPeers` is monotonic within a single epic 2
session: no operation in this epic removes entries from
`lp_knownPeers_v1` (with the single exception of the migration
backfill at first boot, which seeds from scratch). Leaving a
group MUST NOT remove the group's members from `knownPeers`.
Being kicked from a group MUST NOT remove the group's members
from `knownPeers`. Group deletion MUST NOT remove members from
`knownPeers`.

**AC-SEC-12** — `isAllowedDmSender` MUST return `true` if AC-SEC-1
preconditions don't apply (peerHex non-empty, not self,
groups+knownPeers not both empty) AND the lowercased peerHex
appears in either (a) any `group.memberPubkeys` of any element
of `groups`, or (b) `knownPeers`. (AC-SEC-1, AC-SEC-2 from epic 1
are preserved verbatim with the disjunction extended.)

**AC-SEC-13** — `isAllowedDmSender` MUST remain a pure function.
Adding the `knownPeers` parameter MUST NOT introduce any IDB
read, NDK call, or React state access inside the function.

**AC-SEC-14** — `rememberContact` (epic 1's central gate at
`app/src/lib/contacts.ts:84`) MUST continue to gate on
`isAllowed` per epic 1's AC-STRUCT-2. The `isAllowed` callback
threaded in by the bell watcher MUST consume the extended
`isAllowedDmSender` signature so the central gate accepts
ever-known peers as legitimate. (Defense-in-depth: even if a
caller forgets `isAllowed`, the upstream ingress gates have
already approved.)

**AC-SEC-15** — A pubkey that transitions stranger → member (via
the pull-only invitation flow followed by user accept) MUST be
added to `knownPeers` as a side-effect of MarmotContext's
membership-change effect (AC-EVER-4). Subsequent leave of the
group MUST NOT remove that peer from `knownPeers`. The next
inbound DM from them after the leave MUST be allowed by the
ingress gates.

## Pull-Only Invitations (S2)

**AC-STRUCT-3** — A module at `app/src/lib/pendingInvitations.ts`
MUST export:

```ts
type PendingInvitation = {
  id: string;
  inviterPubkeyHex: string;
  receivedAt: number;
  welcomeEventJson: string;
};
listPendingInvitations(): ReadonlyArray<PendingInvitation>
enqueuePendingInvitation(invite: PendingInvitation): void
removePendingInvitation(id: string): void
countPendingInvitations(): number
pendingInvitationsForInviter(inviterPubkeyHex: string): number
```

The module MUST NOT import from `idb-keyval`, any NDK package,
React, `app/src/context/`, or `app/src/components/`. Persistence
is `localStorage[lp_pendingInvitations_v1]` as a JSON array.

**AC-INVITE-1** — When `welcomeSubscription.ts` receives a valid
kind-1059 → kind-444 Welcome targeting the user's pubkey, it MUST
NOT call `client.acceptWelcome(welcomeEvent)`. Instead it MUST
construct a `PendingInvitation` and call
`enqueuePendingInvitation`.

**AC-INVITE-2** — The existing NIP-59 cryptographic checks
(seal verification, schnorr signature, `unwrapAndOpen`) MUST run
BEFORE enqueueing. Invalid Welcomes MUST be dropped silently
(same as epic 1's `unwrap-failed` log path). Only validated
Welcomes are enqueued. The `acceptWelcome` step is gated on user
consent; the cryptographic gate is not.

**AC-INVITE-3** — `enqueuePendingInvitation` MUST enforce two
caps:
- Hard cap: 256 total pending invitations. Beyond the cap, drop
  silently with `logger.info('dm:walled-garden-invite-drop-overflow', { count })`.
- Per-inviter cap: 8 from the same `inviterPubkeyHex`. Additional
  from the same inviter are dropped silently with
  `logger.info('dm:walled-garden-invite-drop-per-inviter', { inviter: prefix(8) })`.

**AC-INVITE-4** — The user-facing pending invitations panel MUST
display ONLY:
- Inviter pubkey, truncated (first 8 + last 8 hex chars).
- "Received N hours/days ago" relative timestamp.
- Accept button.
- Decline button.

It MUST NOT display the inviter's claimed display name, avatar,
or any other inviter-controlled metadata pre-acceptance.

**AC-INVITE-5** — Clicking "Accept" on a pending invitation MUST:
1. Read the `welcomeEventJson` from the queue entry.
2. Deserialize and call `client.acceptWelcome(parsedWelcome)`.
3. On success: remove the entry from the queue. The normal
   MarmotContext group-add flow takes over (group lands in
   `groups`, MarmotContext's effect adds members to
   `knownPeers`).
4. On MLS failure: remove the entry from the queue, surface a
   clear error toast ("This invitation is no longer valid"),
   log at `WARN` with tag `dm:walled-garden-invite-stale`.

**AC-INVITE-6** — Clicking "Decline" on a pending invitation MUST:
1. Remove the entry from the queue.
2. NOT call `client.acceptWelcome`.
3. NOT publish any event to any relay.
4. NOT log the decline beyond a single `INFO` entry
   (`dm:walled-garden-invite-decline`).

**AC-INVITE-7** — The pending invitations panel MUST render on
the `/groups/` page (above the joined-groups list) and MUST
display an empty-state when no invitations are pending.

**AC-INVITE-8** — A badge on the navigation Groups icon MUST show
`countPendingInvitations()` when greater than zero. When zero,
no badge.

**AC-INVITE-9** — Pending invitations MUST survive page reload
(persisted in `localStorage[lp_pendingInvitations_v1]`). On boot,
existing pending invitations re-render without requiring a new
Welcome to arrive.

**AC-OBS-3** — Welcome enqueue actions MUST log at `INFO` with
tag `dm:walled-garden-invite-pending` and minimum context
(inviter prefix 8, queue size). Accept actions log at `INFO` with
tag `dm:walled-garden-invite-accept`. Decline actions log at
`INFO` with tag `dm:walled-garden-invite-decline`. No log entry
MUST contain the inviter's full pubkey, the Welcome's raw bytes,
or any extracted group metadata.

## Soft Purge (S3)

**AC-PURGE-7** — All four purge helpers from epic 1
(`purgeStrangerDmThreads` in `chatPersistence.ts`,
`purgeStrangerDmCounters` in `unreadStore.ts`,
`purgeStrangerContacts` in `contacts.ts`,
`purgeStrangerDmReactions` in `reactions/api.ts`) MUST continue
to delete state for any peer where
`isAllowedDmSender(peer, groups, knownPeers, own)` returns
`false`. With the extended signature, ever-known peers are no
longer classified as strangers, so the purge MUST NOT delete
threads, contact entries, unread counters, or reaction state
for any peer in `knownPeers`. (The helper logic does not change;
the lenient behavior emerges from the data layer.)

**AC-PURGE-8** — Epic 1's AC-PURGE-1, AC-PURGE-2, AC-PURGE-3,
AC-PURGE-4, AC-PURGE-5, AC-PURGE-6, AC-PERF-1 are all
unchanged in form but now operate against the union whitelist
(current ∪ ever-known). The architect MUST verify each helper
behaves correctly with seeded ever-known peers AND current
members in the same sweep.

## Migration Backfill (S3)

**AC-MIGRATE-1** — On boot, before the purge sweep runs,
MarmotContext MUST check
`localStorage[lp_knownPeersMigrated_v2]`. If absent, the
migration backfill MUST run exactly once before the purge sweep
fires. If present and truthy, the migration is skipped.

**AC-MIGRATE-2** — Migration backfill MUST seed
`lp_knownPeers_v1` with the union of every
`group.memberPubkeys` across the user's currently joined MLS
groups at the moment of migration, excluding own pubkey. Each
entry MUST be lowercased.

**AC-MIGRATE-3** — Immediately after seeding, the migration
MUST run the existing purge sweep with the freshly seeded
`knownPeers`. Strangers (peers in IDB / localStorage state but
not in the seed) MUST be deleted from all four surfaces
(threads, unread, contacts, reactions). Ever-known peers (peers
in the seed) MUST remain intact.

**AC-MIGRATE-4** — After successful migration,
`lp_knownPeersMigrated_v2` MUST be set to a truthy value (e.g.
the string `'1'`). Subsequent boots MUST skip the migration
backfill (AC-MIGRATE-1).

**AC-MIGRATE-5** — On first navigation to `/contacts/` after a
successful migration (detected by the absence of
`lp_knownPeersMigrationNoticeAck_v1`), a UI banner MUST display
explaining the change: "We've upgraded your contact privacy.
Some old contacts may no longer be reachable unless you share
a group with them again." A dismiss button MUST set
`lp_knownPeersMigrationNoticeAck_v1` so the banner does not
re-show.

## Reactivity (cross-cutting)

**AC-REACT-4** — When a peer's status transitions stranger →
member (via the pull-only invitation flow, accept), the next
inbound DM event from that peer MUST be accepted by the
ingress gates. No client restart MUST be required.

**AC-REACT-5** — When the user leaves a group (or is kicked,
or the peer leaves), the peer's `knownPeers` entry MUST remain
in place (AC-EVER-5). The next inbound DM from that peer MUST
be accepted by the ingress gates (the peer is no longer a
current member but is ever-known). No client restart MUST be
required.

**AC-REACT-6** — Receiving a Welcome MUST surface a pending
invitation within ≤2 seconds of relay delivery (subject to
relay latency). The badge count MUST update reactively without
page reload.

## Test Surface (S4)

DD-7-equivalent decision for this epic is "full set." All ACs
in this section are active.

**AC-TEST-1** — A unit test at
`app/tests/unit/knownPeers.test.ts` MUST exercise
`loadKnownPeers`, `rememberKnownPeer`, `rememberKnownPeers`,
`isKnownPeer`, and the migration flag accessors. Cases
covered: empty initial state, add single peer, add multiple
peers (dedup), case-insensitive comparison, own pubkey
filtering (per AC-EVER-2), empty/falsy input handling,
persistence across simulated reload.

**AC-TEST-2** — A unit test at
`app/tests/unit/pendingInvitations.test.ts` MUST cover the queue
operations: enqueue, list, remove, count, the 256 total cap,
the 8-per-inviter cap, persistence across simulated reload,
malformed-storage recovery (load returns empty).

**AC-TEST-3** — Unit tests in
`app/tests/unit/walledGarden.test.ts` MUST be extended to cover
the new disjunction:
- Peer in current groups only → true.
- Peer in `knownPeers` only → true.
- Peer in both → true.
- Peer in neither (and not own, not empty) → false.
- Case-insensitive on the knownPeers branch.

**AC-TEST-4** — A unit test in
`app/tests/unit/welcomeSubscription.test.ts` (new or extended)
MUST assert that a cryptographically valid Welcome event is
enqueued (NOT auto-accepted) and that an invalid Welcome is
dropped silently without enqueue.

**AC-TEST-5** — An e2e spec at
`app/tests/e2e/groups-pull-only-invitation-accept.spec.ts` MUST:
- Sign Alice and Bob in (two `browser.newContext()`).
- Alice creates a group and invites Bob.
- Bob's `/groups/` page MUST show a pending-invitation card with
  Alice's truncated pubkey before any Welcome is auto-processed.
- Bob clicks Accept.
- Bob's `groups` array updates to include the group.
- Alice sees Bob join the group (member appears).
- Alice DMs Bob; Bob's bell increments; the message renders in
  Bob's view.

**AC-TEST-6** — An e2e spec at
`app/tests/e2e/groups-pull-only-invitation-decline.spec.ts` MUST:
- Same setup as TEST-5.
- Bob clicks Decline.
- The pending-invitation card is removed.
- Bob's `groups` array MUST remain unchanged.
- Alice's group state MUST NOT include Bob.
- An attempt by Alice to DM Bob via `publishDirectMessage` MUST
  result in Bob's bell remaining at 0 (Alice is a stranger to
  Bob — they never completed the join).

**AC-TEST-7** — An e2e spec at
`app/tests/e2e/groups-ever-known-survives-leave.spec.ts` MUST:
- Alice and Bob complete a pull-only group join (or use the
  helper if it exists post-S2).
- Alice DMs Bob; message lands.
- Alice leaves the group.
- After the membership change settles, Alice DMs Bob again.
- Bob's bell increments and the message renders. (Alice is
  no longer a current member but is ever-known.)
- Bob's contact list MUST still contain Alice.
- Bob's DM thread with Alice MUST still exist in IDB.

**AC-TEST-8** — An e2e spec at
`app/tests/e2e/groups-migration-backfill.spec.ts` MUST:
- Pre-seed Alice's `lp_contacts_v1` with two peers: Bob (will be
  in a current group at migration time) and Mallory (will not be
  in any group).
- Pre-seed `quizzl:messages:dm:<bobHex>` and
  `quizzl:messages:dm:<malloryHex>` in IDB with fake message
  arrays.
- Ensure `lp_knownPeersMigrated_v2` is absent.
- Boot Alice into a group with Bob (via the test helper from S2
  or by direct IDB seed of MLS group state).
- After hydration, assert:
  - `lp_knownPeers_v1` contains Bob (lowercased).
  - `lp_knownPeers_v1` does NOT contain Mallory.
  - `quizzl:messages:dm:<bobHex>` still exists.
  - `quizzl:messages:dm:<malloryHex>` is gone.
  - Mallory is gone from `lp_contacts_v1`.
  - `lp_knownPeersMigrated_v2` is set.
- Navigate to `/contacts/`. The migration notice banner MUST
  appear. Click dismiss. Reload. Banner MUST NOT reappear.

**AC-TEST-9** — `app/tests/e2e/groups-contacts.spec.ts:47` MUST
be updated to restore the pre-epic-1 "survive leave" assertions.
The test body MUST be modified to add Bob's explicit Accept click
on the pending invitation card (navigating to `/groups/`, finding
the invitation row for Alice, clicking Accept, then asserting the
group card is visible) before proceeding to the leave-and-survive
assertions. A passing run of this spec is the regression signal
that lenient mode is wired correctly. (Aligns with epic 1's
AC-TEST-7 pattern: the spec encoded the desired end-state
contract; epic 1 strict mode contradicted it; epic 2 lenient mode
restores it. The Accept step is required because pull-only
invitations are no longer auto-accepted.)

## Cross-Cutting Invariants

**AC-SEC-16** — There MUST NOT be a fifth or later inbound DM
path that bypasses the gates. AC-SEC-8 from epic 1 (with the
AC-SEC-6 amendment naming four ContactChat handlers) remains in
force.

**AC-SEC-17** — `unwrapAndOpen` in
`app/src/lib/directMessages.ts:230` MUST remain byte-for-byte
unchanged. (Epic 1 AC-SEC-9, preserved.)

**AC-SEC-18** — `shouldIngestRumor` in
`app/src/lib/directMessages.ts:204` MUST remain in place and
continue to be called. (Epic 1 AC-SEC-10, preserved.)

**AC-SEC-19** — The fix MUST be local-only. No new relay
subscriptions, no relay-side filtering, no calls to external
services for whitelist decisions. (Epic 1 AC-SEC-11, preserved.)

**AC-SEC-20** — The pending-invitation queue MUST NOT be
consulted by `isAllowedDmSender`. Pending inviters are not
allowed to DM the user. Only AFTER user accept does the peer
become eligible (via the resulting group join and the
membership-change effect that writes to `knownPeers`).

**AC-OBS-4** — All new log tags introduced by this epic
(`dm:walled-garden-invite-pending`,
`dm:walled-garden-invite-accept`,
`dm:walled-garden-invite-decline`,
`dm:walled-garden-invite-drop-overflow`,
`dm:walled-garden-invite-drop-per-inviter`,
`dm:walled-garden-invite-stale`) MUST log at INFO (or WARN for
`-stale`) and MUST NOT contain raw pubkeys, raw Welcome event
content, full inviter pubkeys, or any user-supplied display
metadata pre-acceptance. Pubkey-derived fields MUST be
truncated to 8 chars.

**AC-OBS-5** — Migration backfill MUST log a single INFO entry
on completion with tag `dm:walled-garden-migration-complete`
and minimum context: number of peers seeded, number of stranger
threads purged, number of stranger contacts purged. No raw
pubkeys.

## Manual Validation

- Open a fresh Nostling client as a deterministic test user with
  no existing groups and no contacts. From a separate Nostr
  client (any), have a peer publish a kind-1059 → kind-444
  Welcome to the test user's pubkey. Confirm: the test user's
  `/groups/` page shows a pending invitation; the badge appears
  on the nav. Click Accept; verify the group joins. Click
  Decline on a separate test invitation; verify the card is
  removed and no group joins.
- Pre-seed `lp_contacts_v1` with a stranger pubkey and an IDB
  DM thread for that stranger. Reload. After the migration
  notice dismisses, verify `lp_contacts_v1` no longer contains
  the stranger and the IDB thread is gone.
- Establish a group with another user via the full pull-only
  flow. Exchange a DM. Leave the group. Confirm the contact
  card remains visible, the thread is intact, and a fresh DM
  from the former-group-mate lands successfully.
- Attempt to overflow the pending-invitation queue: cause 300+
  Welcomes to arrive from various inviters; verify only ≤256
  appear in the queue, and from any single inviter ≤8 entries.
