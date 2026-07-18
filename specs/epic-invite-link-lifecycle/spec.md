---
arch_debate: false
---

# Invite Link Lifecycle

**Status**: pre-implementation

## Problem

Group invite links in few.chat never expire and expose almost nothing about
their own lifecycle. An admin who generates a link has no way to see when it
was created, when (if ever) it stops working, or how many people have joined
through it. The only lifecycle control is a mute toggle labeled "Deactivated"
that silently drops join requests but keeps the link visually indistinguishable
from a live one.

Concretely, today's `InviteLink` record (`app/src/lib/marmot/inviteLinkStorage.ts:9-20`)
holds only `{nonce, groupId, createdAt, label, muted}`. The manage overlay
(`app/src/components/groups/ManageInviteLinksModal.tsx`) renders each link as a
label + created-date + a mute `Switch`. There is no expiry, no usage count, and
the link↔join linkage carried by the `nonce` is discarded the moment a join
request is approved (`app/src/lib/marmot/joinRequestHandler.ts:76`), so "how many
members joined via this link" is unanswerable.

The consequence for the admin: invite links accumulate indefinitely as an
unbounded, opaque list of live credentials with no self-service way to reason
about their reach or retire them cleanly, and no signal when a link's useful
life ends.

## Solution

Give invite links a real lifecycle that the admin can observe and control:

1. **Auto-expiry.** Every invite link expires one day after it is created.
   Expired links stop admitting new join requests and are visually marked as
   expired in the manage overlay. Existing links (created before this feature)
   have their one-day rule applied retroactively to their stored creation date.
2. **Lifecycle visibility.** The manage overlay shows, per link, its creation
   date, its expiry date, and how many members have joined through it.
3. **Removal by trashcan.** The mute toggle is replaced by a trashcan action
   that removes a link entirely (hard delete) — which by definition deactivates
   it, since a removed link no longer resolves any incoming join request.
4. **Expiry notification.** When a link the admin created expires, a bell
   notification appears that deep-links to the link's group page and opens the
   invite-link management overlay.

Everything stays local to the admin's device, consistent with the project's
privacy invariant — no invite-link metadata is ever broadcast.

## Scope

### In Scope

- Add an `expiresAt` timestamp to the `InviteLink` record, set to
  `createdAt + 24h` at creation.
- A one-time migration that backfills `expiresAt = createdAt + 24h` on
  pre-existing links, and marks those already-past-expiry links as
  "already notified" so the migration does not flood the bell.
- An expiry predicate (`isExpired(link, now)`) used at both the request-handling
  gate and the UI.
- Enforce expiry in the join-request handler: an expired link's incoming join
  request is dropped, exactly as a muted link's is today.
- Add a per-link `usageCount` incremented when a join request that referenced
  that link's nonce is approved.
- Redesign each row of `ManageInviteLinksModal` to show created date, expiry
  date, and usage count, with a trashcan (hard delete) replacing the mute
  toggle, and a distinct visual treatment for expired rows.
- A new bell notification category for "your invite link expired", following the
  existing `unreadStore` + `NotificationBell` counter pattern.
- A client-side expiry sweep that detects newly-expired links (created by this
  user) and raises one notification per link, once.
- A deep-link query parameter on the groups route that opens the manage-links
  overlay on mount, so the notification can land the admin directly in the
  overlay.
- English + German translations for all new user-facing strings.

### Out of Scope

- Configurable expiry durations (fixed at one day). A future epic may add a
  duration picker.
- Reactivating / extending an expired or removed link (removal is terminal;
  the admin generates a fresh link instead).
- Server-side or cross-device expiry enforcement — expiry is observed only
  while the admin's client is running.
- Notifying invitees (non-admins) about expiry; only the link's creator is
  notified.
- Tracking *which* members joined via a link (identity-level attribution) —
  only an aggregate count.
- **Invitee-side feedback on an expired link.** An invitee who opens an expired
  link still gets the join card (group name comes from the URL params), sends a
  request, and has it silently dropped at the gate — exactly as a muted link
  behaves today. Giving the invitee an "expired" signal is a known consequence
  deferred to a future epic, not a bug in this one.
- Deriving the usage count from group membership state (it is a device-local
  approval-event tally by design — Design Decision 6).

## Design Decisions

1. **Fixed one-day expiry, not configurable.** Product decision: keep the
   create-link modal unchanged and set `expiresAt = createdAt + DAY_MS` (where
   `DAY_MS = 86_400_000`) at record creation. `usageCount` defaults to 0 and
   `expiryNotified` to `false` at creation. Refs:
   `app/src/lib/marmot/inviteLinkGeneration.ts`,
   `app/src/components/groups/GenerateInviteLinkModal.tsx:99-106`.

2. **Retroactive expiry via an `isExpired` fallback, not a load-time
   migration alone.** The join-request gate resolves a link with a single
   `getInviteLink(nonce)` (`joinRequestHandler.ts`), which never passes through
   `loadInviteLinks`. So a lazy migration in `loadInviteLinks` would leave the
   gate seeing legacy records with no `expiresAt`, and `isExpired` would read
   them as never-expiring — defeating retroactive expiry. Therefore
   `isExpired(link, now)` MUST compute expiry from a fallback when `expiresAt`
   is absent: `effectiveExpiry = link.expiresAt ?? (link.createdAt + DAY_MS)`,
   `expired = now >= effectiveExpiry`. This makes retroactive expiry hold at
   every read site regardless of whether a migration has run yet. A one-shot
   `migrateInviteLinks()` still runs at startup to *persist* `expiresAt`/
   `usageCount`/`expiryNotified` onto legacy records (idempotent: it fills only
   missing fields), but correctness does not depend on its ordering.

3. **Migration suppresses the notification flood; the sweep otherwise notifies
   regardless of when expiry occurred.** The one-shot `migrateInviteLinks()`
   stamps any pre-existing link whose computed `expiresAt` is already in the
   past *at migration time* as `expiryNotified: true`, so the sweep does not
   raise a notification for links that expired before this feature existed.
   This suppression applies to the migration only. For every other link, the
   sweep notifies at the next sweep whenever the link is expired and not yet
   `expiryNotified` — including links that expired while the app was closed
   (the common case, given a 24h window and intermittent PWA usage). "Notify
   only while the client observed the transition" is explicitly NOT the rule.

4. **Legacy `muted` links are resolved by the migration.** The mute `Switch` is
   removed, but pre-existing records may carry `muted: true`. To avoid leaving
   them as invisible dead rows until natural expiry, `migrateInviteLinks()`
   treats `muted: true` as already-expired: it clamps
   `expiresAt = min(effectiveExpiry, migrationTime)` and stamps
   `expiryNotified: true`. The `muted` field is retained on the record (the
   gate still honors it) but is no longer surfaced or toggleable in the UI.

5. **Trashcan is a hard delete with a confirmation.** The trashcan calls
   `deleteInviteLink(nonce)` (`inviteLinkStorage.ts:64-70`), removing the
   record; the row disappears and its usage-count history is gone. Because the
   action is irreversible and a single icon tap on mobile is a mis-tap magnet,
   it is guarded by a lightweight confirmation ("Remove this link?"). Deactivation
   is a consequence: the gate resolves the nonce via `getInviteLink` and returns
   null when it does not resolve (`joinRequestHandler.ts:76-80`), so a deleted
   link admits no one.

6. **Usage count is approved-member events, incremented only on success.** "How
   many members have used the link" is the count of join requests referencing
   that link's nonce that the admin *approved*, incremented in the approve path
   (`approveJoinRequest`, `app/src/context/MarmotContext.tsx:1681`) **only after
   `inviteByNpub` returns `{ok:true}`** — never on failure. `incrementInviteLinkUsage(nonce)`
   is a silent no-op that cannot throw or block the approval when the nonce no
   longer resolves (link deleted or on another device). The count is an
   approval-event tally, not a live-membership figure: a member who leaves still
   counts, and a re-approval via the same live link counts again. UI copy MUST
   therefore read "joined via this link", not imply current membership. The
   count is device-local and does not survive a data-clear/reinstall; it is not
   derived from group state.

7. **Approving a pending request is always allowed, regardless of link state.**
   A join request received near expiry can sit in the pending queue and be
   approved after the link expired or was deleted. Approval is a human decision
   on a request the admin already sees, so it is not gated on link liveness —
   only the *incoming* request path (the gate) enforces expiry. The usage
   increment (Decision 6) simply no-ops when the link is gone.

8. **Notifications survive reload via a derived, acknowledged-based slice.** The
   `inviteExpiries` slice does not hold an in-memory-only counter (which a
   reload between "stamp notified" and "user opens bell" would lose forever).
   Instead the slice is *derived on init* from stored links: an unread expiry
   notification exists for each link that is expired AND `expiryNotified: true`
   AND NOT `expiryAcknowledged`. The sweep sets `expiryNotified: true`; opening
   the notification sets `expiryAcknowledged: true` (mark-read). This makes the
   badge idempotent and reload-safe. The sweep is guarded by a module-level
   in-flight latch so React StrictMode double-effects and overlapping interval
   ticks cannot double-notify; the IDB stamp is written before the in-memory
   counter is bumped so a crash errs toward "stamped but not shown" (recovered
   on next init) rather than "shown twice".

9. **Reuse the existing bell-counter pattern, do not build a generic
   notification model.** The bell is three hardcoded counter slices in
   `unreadStore.ts`. The expiry notification adds a fourth slice, per `groupId`,
   mirroring the `joinRequests` slice (init / increment / mark-read / clear + a
   `useSyncExternalStore` hook) and a fourth render block in
   `NotificationBell.tsx` (one row per group with a count). Rationale: matching
   the established pattern is lower risk than a new abstraction mid-feature.

10. **Deep-link via a new query param, opened when the detail view is ready.**
    Per the static-export constraint, the overlay is opened by reading a new
    `manageLinks=1` query param on the existing `/groups` page and calling the
    manage-links disclosure's `onOpen()` — but only once the detail view for
    that `id` group has actually rendered (MLS init is async; "on mount" is too
    early). After opening, the param is stripped from the URL (`router.replace`)
    so a refresh or modal-close does not re-open it. If the target group is gone
    (admin left/abandoned it — `clearInviteLinksForGroup` runs on leave), the
    bell entry lands on the groups list and clears that group's notification key
    instead. Refs: `app/pages/groups.tsx:543-546`, `groups.tsx:74`.

11. **Expiry sweep runs client-side on load and on a 60s interval,** from
    wherever group state is initialized. With no server, a running client is the
    only place expiry can be observed; the interval covers long-lived PWA
    sessions where a link crosses expiry without a reload.

12. **Group departure clears the expiry slice.** Leaving/abandoning a group must
    call `clearInviteExpiries(groupId)` alongside the existing
    `clearInviteLinksForGroup(groupId)`, so a dangling badge does not deep-link
    to a group the admin no longer belongs to (mirrors the `joinRequests`
    slice's `clearJoinRequestGroup` call sites).

## Technical Approach

### `app/src/lib/marmot/inviteLinkStorage.ts`

Extend the `InviteLink` interface with `expiresAt: number`, `usageCount: number`,
and internal `expiryNotified: boolean` / `expiryAcknowledged: boolean` flags. Add:
- `DAY_MS = 86_400_000` constant.
- `isExpired(link, now)` — `now >= (link.expiresAt ?? link.createdAt + DAY_MS)`.
  The nullish fallback is load-bearing (Design Decision 2): it makes expiry hold
  at the `getInviteLink` gate even for un-migrated legacy records.
- `incrementInviteLinkUsage(nonce)` — loads, `usageCount += 1`, saves; silent
  no-op (never throws) when the nonce does not resolve.
- `markInviteLinkExpiryNotified(nonce)` and `markInviteLinkExpiryAcknowledged(nonce)`.
- `migrateInviteLinks()` — one-shot, idempotent: for any record missing
  `expiresAt`, set `expiresAt = createdAt + DAY_MS`, default `usageCount` to 0
  and the flags to `false`; then stamp `expiryNotified = true` when the record
  is already past expiry at migration time OR carries `muted: true` (clamping
  `expiresAt` to `migrationTime` in the muted case). Run at startup; correctness
  does not depend on its ordering (the `isExpired` fallback covers the gate).

### `app/src/components/groups/GenerateInviteLinkModal.tsx`

At the point the record is persisted (`saveInviteLink`, lines 99-106), populate
`expiresAt = createdAt + DAY_MS`, `usageCount = 0`, and the flags `false`.

### `app/src/lib/marmot/joinRequestHandler.ts`

At the existing mute gate (lines 76-80), also drop the request when
`isExpired(inviteLink, Date.now())` — expired links behave exactly like muted
links did on the incoming path.

### `app/src/context/MarmotContext.tsx` (`approveJoinRequest`, line 1681)

When a pending request is approved, call `incrementInviteLinkUsage(request.nonce)`
**only after `inviteByNpub` returns `{ok:true}`**. Approval itself is never gated
on link liveness (Design Decision 7).

### `app/src/components/groups/ManageInviteLinksModal.tsx`

Replace the row layout: show label, created date-time, expiry date-time (or a
relative form — see below), and a "N joined via this link" count; replace the
mute `Switch` with a trashcan icon-button guarded by a confirmation that calls
`deleteInviteLink(nonce)` and drops the row from local state. Apply a distinct
style (struck/greyed + an "Expired" marker) when `isExpired(link, now)`. Because
a 24h lifetime means created and expiry often fall on the same calendar day, the
date display MUST include time-of-day or use a relative form (e.g. "expires in
3 h" / "expired 2 h ago"); both `en` and `de` need the corresponding
string/function keys. An empty overlay (zero links — now common, since links die
daily and can all be trashed) MUST render an explicit empty-state string, not a
blank body. While the modal is open, a row MUST flip to expired styling when it
crosses expiry (drive from the sweep tick or a per-minute re-render).

### `app/src/lib/unreadStore.ts`

Add an `inviteExpiries: Record<string, number>` slice (per groupId) mirroring the
`joinRequests` slice: `initInviteExpiries` (derived on init from stored links:
count links that are expired AND `expiryNotified` AND NOT `expiryAcknowledged`),
increment, `markInviteExpiriesRead` (sets `expiryAcknowledged` on the group's
links), `clearInviteExpiries(groupId)`, and a hook. Fold it into the badge total
in `useUnreadCounts()`.

### `app/src/components/NotificationBell.tsx`

Add a fourth render block for expired-invite notifications: one row per group
with a count, linking to `/groups?id=<groupId>&manageLinks=1` and calling
`markInviteExpiriesRead` on click.

### `app/pages/groups.tsx`

Read a new `manageLinks` query param; when truthy AND the detail view for `id`
has rendered its group, call `manageLinksDisclosure.onOpen()` and then strip the
param via `router.replace`. If the group is not found, fall back to the groups
list and clear that group's expiry key.

### Expiry sweep — `app/src/lib/marmot/inviteExpirySweep.ts`

Loads the stored invite links, finds those that are expired and not yet
`expiryNotified`, increments the `inviteExpiries` slice per group, and stamps
each `expiryNotified: true`. Guarded by a module-level in-flight latch (Design
Decision 8) so concurrent invocations cannot double-notify; IDB stamp precedes
the in-memory bump. Invoked on app load and on a 60s interval from wherever group
state is initialized. Signature takes an injectable `now` for testability.

### Group-leave/abandon call sites

Wherever `clearInviteLinksForGroup(groupId)` is called on leave/abandon, also
call `clearInviteExpiries(groupId)` (Design Decision 12).

## Stories

- **S1 — Link model, expiry & migration** — Extend `InviteLink` with
  `expiresAt`/`usageCount`/`expiryNotified`, add `isExpired` and storage
  helpers, set expiry at creation, and migrate existing links (retroactive
  expiry + notified-suppression). Covers AC-MODEL-*, AC-MIGRATE-*.
- **S2 — Expiry & usage enforcement in the join flow** — Drop join requests for
  expired links; increment `usageCount` on approval. Covers AC-ENFORCE-*,
  AC-USAGE-*.
- **S3 — Manage overlay redesign** — Created/expiry dates + usage count per row,
  trashcan hard-delete replacing the toggle, expired-row styling. Covers
  AC-UI-*.
- **S4 — Expiry notification & deep-link** — New bell slice + render block,
  client-side expiry sweep (once-per-link), and the `manageLinks` deep-link
  param that opens the overlay. Covers AC-NOTIFY-*, AC-DEEPLINK-*.

## Acceptance Criteria

See [`acceptance-criteria.md`](./acceptance-criteria.md).

## Relationship to Other Epics

- **epic-group-invite-links** — This epic extends the invite-link feature that
  epic introduced (storage, generate/manage modals, join-request flow).
- **epic-group-invite-link-onboarding** — Shares the join-via-link entry path;
  this epic does not change the invitee onboarding experience.
- **epic-cancel-pending-invitations** — Adjacent lifecycle control over
  pending join requests (people), whereas this epic controls the links
  themselves.

## Non-Goals

- A generic, data-driven notification model to replace the bell's hardcoded
  counter slices. Out of the project's direction for this change.
- Any server-side or relay-published record of invite-link state — links remain
  device-local per the privacy invariant.
- Configurable or extendable expiry windows.
