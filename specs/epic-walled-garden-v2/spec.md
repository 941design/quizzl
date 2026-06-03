# Walled Garden v2 — Mutual Contact Graph + Pull-Only Invitations

**Status**: Implemented 2026-06-03

> **Severity context.** This epic completes the walled-garden invariant
> started in `specs/epic-dm-walled-garden/` (commit `16e4a41`, not
> deployed). Epic 1 shipped a strict gate — _only current_ MLS group
> members may DM, with everything else purged on leave. This epic
> softens the leave-time loss while closing the only attack vector
> that softening would otherwise open: forced group membership via
> auto-accepted Welcomes. **Production redeploys only after this epic
> ships.** Maintenance page remains up; no time pressure.

## Problem

Epic 1's strict mode (DD-4 strict, DD-5 strict in
`specs/epic-dm-walled-garden/spec.md`) treats leaving a group as a
total reset with that group's members:

- DM threads are deleted from IDB
- Unread counters are cleared
- Reaction aggregates are dropped
- Contact-list and contact-cache entries are removed
- Future inbound DMs from former members are blocked

This is correct for security but creates two product problems:

1. **Loss of legitimate contact history.** Users routinely cycle through
   groups (study cohorts end, classes finish, projects close). Under
   strict mode, every cycle erases their connection record with peers
   they may want to remain in touch with. The strict purge can't tell
   "stranger that never belonged" from "former group-mate I still talk
   to."

2. **No path to durable contact persistence.** Even if the user values
   the connection, the strict contract gives them no way to mark
   "this peer was legitimately my contact" — the system treats
   `(stranger | left-the-group)` as one bucket.

The originating bug report's intent was "real strangers cannot reach
you." Strict mode is over-broad — it also walls off ex-members the
user has a legitimate trust relationship with.

Meanwhile, epic 1's gates assume the MLS membership signal itself is
trustworthy. The current `welcomeSubscription.ts` handler (see
`app/src/lib/marmot/welcomeSubscription.ts`) processes inbound
kind-1059 → kind-444 Welcome events automatically. Once a Welcome
arrives that targets the user's pubkey, `client.acceptWelcome(...)`
fires without user consent. This means **any attacker can publish a
Welcome and force their pubkey into the recipient's
`group.memberPubkeys`**, instantly becoming whitelisted under any
DD-4 lenient contract. Under strict mode this attack is recoverable
(the recipient can leave the group), but under any "past membership
qualifies" contract it becomes a permanent compromise of the
recipient's whitelist.

**Therefore the two changes are coupled: softening DD-4 is only safe
when Welcomes require explicit user consent.** This epic ships both.

## Solution

Three pillars:

1. **Ever-known peers — persistent past-membership layer.**
   A new module `app/src/lib/knownPeers.ts` owns a persistent set of
   pubkeys the user has at any point shared an MLS group with. The
   set is seeded from current group members on every membership
   change and grows monotonically. `isAllowedDmSender` is extended to
   accept the set: a peer is allowed if they appear in any current
   `group.memberPubkeys` **or** in `knownPeers`.

2. **Pull-only invitations — consent-gated Welcome processing.**
   Inbound Welcome events are no longer auto-accepted. Instead they
   are serialized into a persistent pending-invitation queue
   (`lp_pendingInvitations_v1`) and surfaced as a UI affordance.
   `client.acceptWelcome` fires only after the user clicks "Accept."
   Declined invitations are silently dropped.

3. **Soft purge — preserves ever-known state, deletes only true
   strangers.**
   The purge sweeps from epic 1 (`purgeStrangerDmThreads`,
   `purgeStrangerDmCounters`, `purgeStrangerContacts`,
   `purgeStrangerDmReactions`) continue to use `isAllowedDmSender`.
   With the extended signature, ever-known peers are no longer
   classified as strangers, so the purge naturally preserves their
   threads, contacts, unread, and reactions. No purge-helper logic
   change required — the lenient behavior emerges from the data
   layer.

The walled-garden invariant in its final form:

> A peer may DM the user if and only if they appear in any of the
> user's current MLS groups' `memberPubkeys`, **or** they appear in
> the persistent `knownPeers` set. Membership in `knownPeers` can be
> obtained only by being a current member at some point in the past,
> and current membership requires the user's explicit consent to a
> Welcome via the pending-invitations UI.

This closes the originating bug (`bug-reports/dm-walled-garden-stranger-bypass.md`)
without the strict-mode collateral damage, and is robust against
force-add attacks because the only path into `knownPeers` is via
user consent.

## Scope

### In Scope

- New module `app/src/lib/knownPeers.ts` — persistent set, accessor
  API, monotonic growth semantics.
- New module `app/src/lib/pendingInvitations.ts` — persistent queue
  of pending Welcomes, accept/decline operations.
- Modification of `app/src/lib/walledGarden.ts` — extended signature
  `isAllowedDmSender(peerHex, groups, knownPeers, ownPubkeyHex)`.
- Modification of every gate caller to pass `knownPeers`:
  - `app/src/lib/directMessageNotifications.ts` (bell watcher)
  - `app/src/components/contacts/ContactChat.tsx` (per-thread)
  - `app/src/components/DirectMessageNotificationsWatcher.tsx`
- Modification of `app/src/lib/marmot/welcomeSubscription.ts` to
  queue Welcomes instead of auto-accepting.
- New page or panel for pending invitations (UI: `/groups/`
  badge + dedicated list).
- Modification of `app/src/context/MarmotContext.tsx` to:
  - Maintain `knownPeers` reactively (add new current members on
    every group-membership change event).
  - Expose pending-invitation accept/decline actions.
  - Run a one-time migration backfill on first boot after upgrade.
- One-time migration that seeds `knownPeers` from current MLS
  membership at upgrade time. A `lp_knownPeersMigrated_v2` flag
  prevents re-running.
- Test surface: unit tests for both new modules, e2e tests for the
  invitation flow and for ever-known persistence, amendment or
  removal of the now-incorrect e2e fixtures (see DD-12).
- ADR-002 superseding ADR-001 in `docs/adr/`.

### Out of Scope

- **Block-contact action.** Removing a peer from `knownPeers` is not
  implemented in this epic. The ever-known set grows monotonically;
  the only way a peer leaves is by being purged at migration time.
  Block is its own epic (see "Relationship to other epics").
- **Pending-invitation expiry / TTL.** Welcomes sit in the queue
  indefinitely. Stale Welcomes that fail to commit at the protocol
  layer surface an error message; they are not auto-expired.
- **Inviter notification on decline.** Declines are silent — no
  event published. The inviter sees no join and infers.
- **Multi-device synchronization** of the ever-known set or
  pending invitations. Each device maintains its own.
- **Replay attack resistance** of accepted invitations across
  re-installs. If a user wipes local state, their `knownPeers` is
  re-derived from current group memberships and historical context
  is lost. Backup/restore of `knownPeers` is its own concern.
- **Migrating users who installed epic 1.** The strategy decided
  with the user is to NOT deploy epic 1 standalone; therefore the
  upgrade target is pre-walled-garden state. Migration logic
  assumes that baseline.

## Design Decisions

### DD-1 — Where does `knownPeers` persist?

Options:

- **Option A — `localStorage` (`lp_knownPeers_v1`).** Synchronous
  read. Simple. Storage limit (~5MB) supports millions of peers.
  Compatible with the existing `lp_contacts_v1` and
  `lp_unreadLastReadDM_v1` conventions.
- **Option B — IDB (idb-keyval, `quizzl:knownPeers`).** Async read.
  Consistent with chat persistence layer. Larger storage ceiling
  (gigabytes).

**Recommendation: Option A.** `isAllowedDmSender` is invoked from
hot paths (every inbound DM event, every gate check inside the bell
watcher subscription's tight loop, every purge iteration). An async
gate would push every caller through a Promise boundary or require
a live in-memory cache that re-syncs with IDB. localStorage gives a
clean synchronous read, and the data shape (a Set of hex strings)
is small even for power users (10K members × 64-char hex = 640KB).
This matches the rationale in epic 1's
`app/src/lib/walledGarden.ts:1` ("zero IDB" non-functional
constraint).

### DD-2 — When are peers added to `knownPeers`?

The set is populated reactively on every group-membership change
event observable to MarmotContext. The same `useEffect` on
`[groups, groupDataVersion]` that drives the purge sweep (see
epic 1's wiring in `app/src/context/MarmotContext.tsx`) calls
`rememberKnownPeer(peer)` for every pubkey in every group's
`memberPubkeys` except the user's own. Adds are idempotent
(`Set.add`). No timer; events drive the update.

**Recommendation: accept.** Mirrors the existing purge-trigger
contract from epic 1's AC-PURGE-2.

### DD-3 — Can a peer ever be removed from `knownPeers`?

Options:

- **Option A — Monotonic (no removal).** Once added, always present.
  Simplest. Documented "haunted contact" UX where the user has no
  in-app way to revoke a known peer.
- **Option B — Removable via explicit "block" action.** A new
  block-contact UI flow removes the peer from `knownPeers`, adds
  them to a parallel `lp_blockedPeers_v1` set consulted by
  `isAllowedDmSender`, and triggers a purge of their thread + state.
- **Option C — Removable via "forget" action.** Same as B but
  without a persistent block list. Peer can be re-added later by
  re-joining a shared group (with their consent via pull-only).

**Recommendation: Option A for this epic.** The user's stated
invariants are "past or present membership qualifies for mutual
contact" — that is by construction monotonic. Block is independently
valuable (e.g., abusive ex-group-mate) but is its own UX surface
with its own design space (does block hide the contact from the UI?
does it publish anything? does it affect group membership going
forward?). Captured as a future epic. <!-- DECISION REQUIRED: confirm Option A scope -->

### DD-4 — When are Welcomes accepted?

Options:

- **Option A — Auto-accept on receipt (current behavior).** No
  user gate. Force-add attack is open.
- **Option B — Held in pending queue; user must accept.**
  Welcomes serialized into `lp_pendingInvitations_v1`. UI surface
  shows pending list. `client.acceptWelcome` fires only after
  user-explicit accept.

**Recommendation: Option B.** This is the load-bearing change.
Without it, lenient DD-4 admits a permanent compromise vector
(see Problem statement). With it, the only path into
`memberPubkeys` (and therefore into `knownPeers`) is user
consent. <!-- DECISION REQUIRED -->

### DD-5 — What is the pending-invitation lifecycle?

A Welcome event arriving at the kind-1059 subscription with kind-444
inner is intercepted by `welcomeSubscription.ts` (modified). Steps:

1. The full Welcome event (including the wrap, the seal proof, and
   the kind-444 rumor) is serialized into the pending queue.
2. The queue entry includes: inviter pubkey, group ID (if
   extractable pre-acceptance), group name (if extractable),
   received-at timestamp, raw Welcome blob.
3. The queue is persisted to `localStorage` (key:
   `lp_pendingInvitations_v1`) so pending invitations survive
   reload.
4. A UI badge appears on the /groups/ tab indicating count.
5. User navigates to the pending-invitations panel (could be a
   dedicated `/groups/invitations/` route or a section on
   `/groups/`).
6. User clicks "Accept" → `client.acceptWelcome(welcomeEvent)`
   fires → on success, the queue entry is removed and the user
   joins the group (which triggers MarmotContext's normal
   group-add flow and `rememberKnownPeer` for every member).
7. User clicks "Decline" → the queue entry is removed; no
   `acceptWelcome` call; no group join; no `knownPeers`
   addition; no event published.
8. If `acceptWelcome` rejects (e.g., stale ratchet state), surface
   a clear error: "This invitation is no longer valid." Remove
   the entry from pending.

**Recommendation: accept.** Wraps the simplest possible state
machine around the existing MLS primitive.

### DD-6 — Where does the pending-invitations UI live?

Options:

- **Option α — Badge + dedicated `/groups/invitations/` route.**
  Stable URL, dedicated surface. Two visible affordances (badge in
  nav, full page).
- **Option β — Inline section on `/groups/`.** "Pending invitations"
  appears as a list at the top of the groups page. Single surface.
- **Option γ — Pop-up modal on first-receipt.** Interrupts the
  user immediately when a Welcome arrives.

**Recommendation: Option β.** Single page reduces navigation
overhead. The pending list is a peer of the joined-groups list and
the empty-state on the same page. Inline keeps the user's mental
model "everything group-related lives at /groups/." A badge on the
nav-rail indicator (e.g. the existing groups icon) shows count.
Pop-ups (Option γ) are explicitly rejected — async events should
not interrupt the user.
<!-- DECISION REQUIRED: confirm β -->

### DD-7 — How does the migration backfill behave at first boot?

At the first boot after this epic ships, the existing user state is
pre-walled-garden (per the strategic decision not to deploy epic 1
standalone). The user has:

- A populated `lp_contacts_v1` (every peer who has ever DM'd them,
  including strangers — this is the bug epic 1 was designed to fix)
- DM threads in IDB with possibly-stranger peers
- A populated `groups` array (legitimate MLS memberships)
- No `lp_knownPeers_v1` (does not exist yet)

The migration's job is to seed `lp_knownPeers_v1` and run the
purge sweep so the post-upgrade state is consistent.

Options:

- **Option A — Strict backfill.** Seed `knownPeers` from current
  MLS group memberships only. Anyone in `lp_contacts_v1` not in a
  current group is treated as a stranger and purged. Aligned with
  the security intent; harsh on users who have legitimate ex-group
  contacts.
- **Option B — Lenient backfill.** Seed `knownPeers` from the
  union of (a) current group members and (b) all entries in
  `lp_contacts_v1`. Preserves historical contacts; admits any
  stranger that exploited the pre-walled-garden bug as a
  permanently whitelisted peer.

**Recommendation: Option A.** The security intent dominates. The
one-time UX cost is bounded (users can re-establish contact via a
fresh group invitation). A user-facing notice at first boot
explains the change: "We've upgraded your contact privacy. Some
old contacts may no longer be able to message you unless you
share a group again." <!-- DECISION REQUIRED: confirm Option A or
escalate to Option B -->

The migration runs in the existing boot-purge effect in
MarmotContext, gated by the `lp_knownPeersMigrated_v2` flag.

### DD-8 — How are pending-invitation spam attacks mitigated?

A relay can deliver arbitrary kind-1059 events targeting the user's
pubkey. If every one becomes a pending invitation, the queue can be
spammed.

Mitigations layered in this epic:

- **Display only minimal information.** The pending-invitation card
  shows: inviter pubkey (truncated), invitation timestamp. It does
  NOT show inviter-controlled fields (display name, avatar, group
  name claimed by the inviter) until the user accepts and joins
  the group. Prevents social-engineering pre-acceptance.
- **Cap queue size.** Hard cap of 256 pending invitations per
  user. Beyond the cap, new Welcomes are dropped silently (logged
  at INFO with `dm:walled-garden-invite-drop-overflow`).
- **Per-inviter rate-limit.** No more than 8 pending entries from
  the same inviter pubkey. Additional from the same inviter are
  dropped.

These limits are first-order; a future epic could add a richer
abuse-detection surface. <!-- DECISION REQUIRED: confirm cap
values -->

### DD-9 — Should declined Welcomes publish a "decline" event?

Options:

- **Option A — Silent decline.** No event. The inviter infers
  decline from absence of join.
- **Option B — Custom "I-declined" event** (new kind, signed by
  decliner). The inviter receives an explicit signal.

**Recommendation: Option A.** Decline-leak is its own privacy
concern — surfacing "user X actively refused to join your group"
gives the inviter information the user may want to withhold (e.g.,
to suggest mere unavailability rather than active rejection). The
default of silence is conservative.

### DD-10 — What is the `walledGarden.ts` signature change?

Current (epic 1):
```ts
isAllowedDmSender(
  peerHex: string,
  groups: ReadonlyArray<Group>,
  ownPubkeyHex: string | null | undefined,
): boolean
```

Proposed (epic 2):
```ts
isAllowedDmSender(
  peerHex: string,
  groups: ReadonlyArray<Group>,
  knownPeers: ReadonlySet<string>,
  ownPubkeyHex: string | null | undefined,
): boolean
```

The function returns `true` if AC-SEC-1 preconditions don't apply
**and** (peer is in current `groups`' `memberPubkeys`, OR peer is
in `knownPeers`). All call sites pass the additional argument from
the same context that already provides `groups` and `ownPubkeyHex`.

The signature is breaking. All call sites must be updated; the type
system will catch any miss. Lowercasing semantics are preserved
(both `groups`-derived and `knownPeers`-derived entries are
compared case-insensitively; `knownPeers` is stored lowercased on
write).

### DD-11 — How does ever-known interact with self-DMs?

Self-DM is dropped on every ingress path (epic 1's DD-10). This
remains. The user's own pubkey is never added to `knownPeers`
(filtered at `rememberKnownPeer` write time and at
`isAllowedDmSender` read time, as in epic 1). Defensive.

### DD-12 — What happens to the e2e fixtures from epic 1?

Three e2e specs in epic 1 directly encode strict-mode assertions:

- `app/tests/e2e/dm-walled-garden-stranger-blocked.spec.ts` —
  Mallory is a never-shared-a-group stranger. Still correct under
  lenient mode (Mallory is not in `knownPeers`, so blocked).
  **Keep as-is.**

- `app/tests/e2e/dm-walled-garden-group-member-allowed.spec.ts` —
  Alice and Bob share a current group. Still correct (Bob is in
  current membership). **Keep as-is.**

- `app/tests/e2e/dm-walled-garden-retroactive-purge.spec.ts` — pre-
  seeds a stranger DM thread; asserts purge removes it. Still
  correct (Mallory is not in `knownPeers`). **Keep as-is.**

And the strict-mode-encoding e2e in the broader suite:

- `app/tests/e2e/groups-contacts.spec.ts:47` — asserts that after
  Alice leaves the group, Bob's contact "survives leave." Under
  epic 1 this test fails (purge removes Bob). Under epic 2 lenient
  mode, the test would pass naturally because Bob is in
  `knownPeers`. **Restore to passing by epic 2's S4 work.**

No tests need to be deleted by this epic. All four are aligned
with the lenient + pull-only end state.

## Migration

The migration is the most error-prone part of this epic. Explicit
contract:

1. On first boot after upgrade, the `MarmotContext` boot effect
   checks `localStorage['lp_knownPeersMigrated_v2']`. If absent or
   falsy, run migration. Otherwise skip.

2. Migration steps (atomic per the existing purge effect):
   a. Compute the seed set: every pubkey in any current
      `group.memberPubkeys`, excluding own.
   b. Write the seed set to `localStorage['lp_knownPeers_v1']` as
      a JSON array of hex strings, all lowercase.
   c. Run the purge sweep (`purgeStrangerDmThreads`,
      `purgeStrangerDmCounters`, `purgeStrangerContacts`,
      `purgeStrangerDmReactions`) — with the newly seeded
      `knownPeers`, this removes IDB threads, contact entries,
      unread counters, and reactions for any peer not in
      `knownPeers`. (Same machinery as epic 1's purge; the
      semantics change because `isAllowedDmSender` now consults
      `knownPeers`.)
   d. Set `localStorage['lp_knownPeersMigrated_v2'] = '1'`.

3. The user is shown a one-time notice (UI banner / toast on next
   visit to /contacts/): "We've upgraded your contact privacy.
   Old contacts you don't currently share a group with have been
   removed. [Got it]"

4. The notice acknowledgement is persisted
   (`lp_knownPeersMigrationNoticeAck_v1`) so it does not re-show.

5. If migration fails partway through (e.g., the user closes the
   tab during the purge), the migration flag is NOT set, so the
   next boot will retry. The purge is idempotent.

## Technical Approach

### `app/src/lib/knownPeers.ts` (new)

```ts
const KNOWN_PEERS_KEY = 'lp_knownPeers_v1';
const KNOWN_PEERS_MIGRATED_KEY = 'lp_knownPeersMigrated_v2';

export function loadKnownPeers(): ReadonlySet<string>;
export function rememberKnownPeer(peerHex: string): void;
export function rememberKnownPeers(peerHexes: ReadonlyArray<string>): void;
export function isKnownPeer(peerHex: string): boolean;
export function knownPeersMigrationComplete(): boolean;
export function markKnownPeersMigrationComplete(): void;
```

Semantics:
- `loadKnownPeers()` reads `localStorage[KNOWN_PEERS_KEY]`, parses
  the JSON array, returns a `Set<string>` of lowercased pubkeys.
  Returns empty set on missing/malformed.
- `rememberKnownPeer(peerHex)` adds the lowercased hex to the set
  and persists. Idempotent. Refuses empty input. Filters own
  pubkey (caller must pass `ownPubkeyHex` separately and check, or
  the function takes ownPubkey to enforce — TBD by architect; the
  AC binds the outcome).
- `rememberKnownPeers([peers])` bulk-add, single write.

Pure module. Synchronous. Zero IDB, zero NDK, zero React. Matches
the `walledGarden.ts` purity boundary.

### `app/src/lib/walledGarden.ts` (modified)

Signature change per DD-10. Implementation: after the AC-SEC-1
preconditions, the function checks either source:

```ts
for (const group of groups) {
  for (const memberPubkey of group.memberPubkeys) {
    if (memberPubkey.toLowerCase() === peerLower) return true;
  }
}
if (knownPeers.has(peerLower)) return true;
return false;
```

Order: groups first, then knownPeers. Both branches are fast (O(N)
over groups, O(1) over the Set), so order is for readability not
performance. The function remains pure — no IDB read inside, the
caller passes `knownPeers` already loaded.

### `app/src/lib/pendingInvitations.ts` (new)

```ts
const PENDING_INVITES_KEY = 'lp_pendingInvitations_v1';

export type PendingInvitation = {
  id: string;                  // hash of the Welcome event id
  inviterPubkeyHex: string;
  receivedAt: number;          // Unix ms
  welcomeEventJson: string;    // raw serialized event for replay into acceptWelcome
};

export function listPendingInvitations(): ReadonlyArray<PendingInvitation>;
export function enqueuePendingInvitation(invite: PendingInvitation): void;
export function removePendingInvitation(id: string): void;
export function countPendingInvitations(): number;
export function pendingInvitationsForInviter(inviterPubkeyHex: string): number;
```

Semantics:
- `enqueuePendingInvitation` enforces DD-8 caps (256 total, 8 per
  inviter). Drops silently with INFO log on overflow.
- `removePendingInvitation` is used by both accept (after
  `acceptWelcome` resolves) and decline paths.
- Storage shape: `localStorage[PENDING_INVITES_KEY]` is a JSON
  array of `PendingInvitation` objects.

### `app/src/lib/marmot/welcomeSubscription.ts` (modified)

The current handler that receives a Welcome and calls
`client.acceptWelcome(...)` is replaced with a handler that:

1. Validates the Welcome can be unwrapped (uses the existing seal
   verification — does NOT skip the cryptographic checks; only the
   commit step is gated).
2. Extracts the inviter pubkey from the seal.
3. Constructs a `PendingInvitation` record.
4. Calls `enqueuePendingInvitation(record)`.

The `acceptWelcome` call moves to a new exported function that the
UI invokes when the user clicks Accept:

```ts
export async function acceptPendingInvitation(id: string): Promise<void>
export async function declinePendingInvitation(id: string): Promise<void>
```

`acceptPendingInvitation` looks up the record, calls
`client.acceptWelcome(parsedWelcome)`, and on success removes the
record. On MLS failure (stale ratchet), removes the record and
throws a clear error.

`declinePendingInvitation` just removes the record. No
side-effects, no network publish (per DD-9).

### `app/src/components/DirectMessageNotificationsWatcher.tsx` (modified)

The live-ref pattern introduced in epic 1's gate-remediation pass
is extended with a `knownPeersRef`:

```ts
const knownPeers = useKnownPeers(); // new hook (cheap; reads localStorage on subscribe)
const knownPeersRef = useRef(knownPeers);
useEffect(() => { knownPeersRef.current = knownPeers; }, [knownPeers]);

// ...
isAllowedSender: (peer) =>
  isAllowedDmSender(peer, groupsRef.current, knownPeersRef.current, ownPubkey),
```

`useKnownPeers` is a thin `useSyncExternalStore` adapter (or a
context-bound value if MarmotContext exposes it — architect's
call). The set changes whenever `rememberKnownPeer` writes, and
the watcher's gate always sees the latest snapshot.

### `app/src/components/contacts/ContactChat.tsx` (modified)

Every existing `isAllowedDmSender(peer, groupsRef.current,
pubkeyHex)` call site is updated to pass `knownPeersRef.current`
as the third argument. Same live-ref pattern. Four call sites
(historical kind-4, historical kind-1059, live kind-4, live
kind-1059, plus the kind-7 dispatch — five total per epic 1's
AC-SEC-6 amendment).

### `app/src/context/MarmotContext.tsx` (modified)

Three changes:

1. **Effect: maintain `knownPeers` from group membership.** A new
   `useEffect` on `[groups, groupDataVersion]` calls
   `rememberKnownPeers(union of every group.memberPubkeys excluding
   ownPubkey)`. Runs after group hydration on boot and on every
   change. Idempotent additions.

2. **Effect: migration backfill.** Gated by
   `!knownPeersMigrationComplete()`. Runs after the first non-null
   group list. Same effect order as epic 1's boot purge — purge
   sweep runs AFTER `rememberKnownPeers` so the newly seeded set is
   used to classify strangers correctly. Sets the migration flag.

3. **Hook expose: `useKnownPeers()`.** Subscribers (the bell
   watcher, ContactChat) read the current ever-known set. Could
   be context-bound or live-store-bound; architect chooses.

4. **Expose `acceptPendingInvitation` / `declinePendingInvitation`
   from context.** UI components read these from `useMarmot()`.

### `app/src/components/groups/PendingInvitations.tsx` (new)

The UI component for the pending-invitations list. Renders one
card per invitation. Each card shows:
- Inviter pubkey, truncated (first 8 + last 8 chars).
- Received-at timestamp (relative).
- "Accept" button → calls `acceptPendingInvitation(id)`. On
  success, removes the card; on failure, surfaces the error.
- "Decline" button → calls `declinePendingInvitation(id)`. Removes
  the card.

Renders an empty-state when no pending invitations exist.

### `app/src/pages/groups.tsx` (modified)

The `/groups/` route mounts `<PendingInvitations />` above the
existing joined-groups list. A badge on the navigation Groups
icon shows `countPendingInvitations()` (or no badge when zero).

### `app/src/lib/i18n.ts` (modified)

New copy strings for both English and German:
- `pendingInvitations.heading`
- `pendingInvitations.acceptBtn`
- `pendingInvitations.declineBtn`
- `pendingInvitations.empty`
- `pendingInvitations.acceptError`
- `migrationNotice.body`
- `migrationNotice.dismissBtn`

Per the project's i18n convention (see `CLAUDE.md`), all new
user-facing strings go through `useCopy()`; nothing is hardcoded
in components.

### Test surface — see Stories S4 and `acceptance-criteria.md`

## Stories

A four-story split. The planner (`base:story-planner`) may refine
but should not collapse below this count without surfacing the
trade-off.

- **S1 — Ever-known peers + extended `walledGarden.ts`.** New
  `app/src/lib/knownPeers.ts` module. Signature change to
  `isAllowedDmSender`. All call sites updated (bell watcher,
  ContactChat, purge helpers). MarmotContext effect adds current
  members to `knownPeers` on every group-membership change.
  Covers AC-STRUCT-1, AC-STRUCT-2, AC-EVER-1 through AC-EVER-5,
  AC-SEC-12 through AC-SEC-15.

- **S2 — Pull-only invitations: queue, UI, accept/decline.**
  New `app/src/lib/pendingInvitations.ts` module. Modification of
  `welcomeSubscription.ts` to queue instead of auto-accept. New
  `acceptPendingInvitation` / `declinePendingInvitation` exports.
  New `PendingInvitations.tsx` component. Modification of
  `/groups/` page to mount it. Badge on the nav icon. Covers
  AC-INVITE-1 through AC-INVITE-9, AC-STRUCT-3, AC-OBS-3.

- **S3 — Migration backfill + soft purge confirmation.**
  MarmotContext migration effect that seeds `knownPeers` from
  current group members and runs the existing purge sweep. The
  purge helpers themselves require no logic changes (they consult
  the extended `isAllowedDmSender`), but verification is needed
  that the lenient behavior emerges correctly. One-time UI notice
  on first /contacts/ visit post-migration. Covers AC-MIGRATE-1
  through AC-MIGRATE-5, AC-PURGE-7 (soft purge semantics).

- **S4 — Test surface.** Unit tests for `knownPeers.ts`,
  `pendingInvitations.ts`, updated `walledGarden.ts`,
  updated `welcomeSubscription.ts`. E2E specs:
  `pull-only-invitation-accept.spec.ts`,
  `pull-only-invitation-decline.spec.ts`,
  `ever-known-survives-leave.spec.ts`,
  `migration-backfill.spec.ts`. Revert
  `groups-contacts.spec.ts:47` to the "survive leave" assertion
  (now correct under lenient mode). Covers AC-TEST-1 through
  AC-TEST-9.

## Non-Goals

- Inferring `knownPeers` from sources other than MLS group
  membership (no NIP-02 follow lists, no manual allowlist UI, no
  pre-MLS contact import beyond the migration's
  current-membership seed).
- Block / forget actions on `knownPeers` entries. The ever-known
  set is monotonic in this epic.
- Multi-device synchronization of `knownPeers` or pending
  invitations across the user's devices. Each device maintains
  its own.
- Backup / export / import of `knownPeers`. Reinstalling the app
  loses everything except what can be re-derived from current
  MLS group memberships.
- Replacing strict mode with a UX flag that lets users toggle
  between strict and lenient. Lenient is the durable contract.
- Pending-invitation TTL / auto-expire. Stale Welcomes surface as
  errors on accept, not on receipt.
- Inviter notification on decline.
- Restoring the live deploy. That is the operational follow-on
  (`make deploy` after this epic ships).

## Amendments

- **2026-06-03 — DD-12 test-file scope was understated.** The spec (DD-12) named four specific e2e test files (three walled-garden specs + one groups-contacts line) and asserted all four needed no deletion. In practice S4 discovered that stale relay gift-wrap state in the broader e2e suite caused failures across 9+ test files, not the four listed, because many specs use an auto-join pattern that stopped working once pull-only invitations were introduced. The accept-click wiring required in AC-TEST-9 propagated to every spec that performed a group join without an explicit Accept step. The AC text (AC-TEST-9) correctly captured the fix pattern; the DD-12 prose count of affected files was a planning underestimate, not an AC gap.

## Relationship to Other Epics

- **`specs/epic-dm-walled-garden/` (epic 1).** This epic builds on
  epic 1's infrastructure. The `walledGarden.ts` module, the
  ingress gates, the purge helpers, and the MarmotContext wiring
  are all retained and extended. ADR-002 (this epic) supersedes
  ADR-001 (epic 1). The combined commit is what reaches
  production; epic 1 is never deployed standalone.

- **Future: "Block contact" epic.** Adds explicit block / forget
  actions on `knownPeers` entries. Independent of this epic's
  scope but anticipated.

- **Future: "Multi-device sync" epic.** Synchronizes
  `knownPeers` and pending-invitations across the user's
  installations (per-device, currently). May require an NIP-44
  encrypted store on the relay.

- **`specs/marmot-application-rumor-dispatch.md`** — the
  dual-listener consolidation. Unchanged. The Welcome subscription
  modified by S2 is on the existing dispatch path; the
  consolidation epic, when it lands, will need to preserve the
  queue-before-accept semantics introduced here.

- **`specs/epic-member-profile-discovery-and-relay-on-behalf/`** —
  consults `group.memberPubkeys`. Profile discovery for
  ever-known peers who are NOT in current groups is undefined
  today; the current implementation only fetches profiles for
  current members. This may surface as a gap (the user's
  `/contacts/` page shows ever-known peers without nicknames or
  avatars). Captured as a follow-on.

## Acceptance Criteria

See [`acceptance-criteria.md`](./acceptance-criteria.md).

## ADR

This epic will produce **ADR-002** at
`docs/adr/ADR-002-mutual-contact-graph-and-pull-only-invitations.md`
which supersedes ADR-001. The ADR records:

- **Decision:** Whitelist = current MLS group members ∪ ever-known
  peers. Welcomes require explicit user consent.
- **Affects:** `app/src/lib/walledGarden.ts`,
  `app/src/lib/knownPeers.ts`, `app/src/lib/pendingInvitations.ts`,
  `app/src/lib/marmot/welcomeSubscription.ts`,
  `app/src/context/MarmotContext.tsx`,
  `app/src/components/contacts/ContactChat.tsx`,
  `app/src/components/DirectMessageNotificationsWatcher.tsx`,
  `app/src/components/groups/PendingInvitations.tsx`,
  `app/src/pages/groups.tsx`.
- **Supersedes:** ADR-001 (Walled garden gated on current MLS
  group membership).

ADR-001 is updated to `Status: Superseded by ADR-002` as part of S1.
