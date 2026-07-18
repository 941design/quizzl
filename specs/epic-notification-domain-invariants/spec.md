# Notification Bell — Domain Invariants

**Status**: Implemented 2026-07-18 (unit + typecheck green; full e2e gate pending — owner runs `make test`)

## Problem

The notification bell (`unreadStore` + `NotificationBell.tsx`) tracks four kinds of
change events: group chat messages, join requests, invite-link expiries, and direct
messages. Across the group flow and the contact-invitation flow, these events are
handled inconsistently: some ring the bell even when the user is looking at exactly
the thing that changed, some update the on-screen UI *and* also ring the bell, and
some are silently dropped. There is no single rule that says when the bell should
ring versus when the open view should update instead.

Concretely, today every live handler increments the bell unconditionally, consulting
nothing about what the user is currently viewing:

- A group chat message rings the bell even while that group's chat is open
  (`chatHandler.ts:102` — the only mitigation is a one-shot `markAsRead` on entry,
  which does not re-fire for messages that arrive while the view stays mounted).
- A join request rings the bell *and* live-updates the pending-requests list while
  the admin is viewing that same group (`MarmotContext.tsx:1097-1102`).
- A direct message rings the bell with no suppression for the currently-open thread
  (`directMessageNotifications.ts:99,147`).
- An invite-link expiry rings the bell from a global sweep with no awareness of
  whether the group's manage-links view is open (`inviteExpirySweep.ts:67`).

*Success signal: a message, request, or DM for the entity the user is currently
looking at never lights the bell; the same event for any other entity always does.*

## Solution

Establish two generic, domain-independent invariants and make every live handler
obey them:

- **INV-1 (off-domain rings):** A change event whose target entity is **not** the
  entity currently open in a detail view MUST ring the bell (increment its unread
  count).
- **INV-2 (on-domain updates):** A change event whose target entity **is** the
  entity currently open in a detail view MUST NOT ring the bell; it updates that
  open view instead (and advances the persisted last-read so a reload does not
  re-surface it).

"Currently open in a detail view" is **per-entity** (the viewed target), not
per-route: viewing group X suppresses the bell only for X's own messages, join
requests, and expiries; an event for group Y — even though Y is also a group —
rings the bell. Viewing the DM thread with contact A suppresses only A's messages;
a DM from B rings the bell.

The mechanism is a small module-level **active-view registry** (mirroring
`unreadStore`'s module-store shape) that detail views set on mount and clear on
unmount/navigation. Each live increment site consults the registry: if the incoming
event's target matches the active view, it calls the domain's existing mark-read
path (which both suppresses the badge and advances persisted last-read) instead of
incrementing; otherwise it increments as today.

## Scope

### In Scope

- The four bell domains, each keyed by its target entity:
  - **Group chat message** → target = `groupId`; active view = group detail (`/groups?id=X`).
  - **Join request** → target = `groupId`; active view = the same group detail.
  - **Invite-link expiry** → target = `groupId`; active view = the same group detail.
  - **Direct message** → target = peer pubkey; active view = contact DM thread (`/contacts?id=<peer>`).
- A generic active-view registry consulted by all four increment sites.
- Per-domain e2e tests proving both invariants (off-domain rings, on-domain updates
  without ringing), plus unit tests for the registry and the suppression logic.
- Documentation of the two invariants where future handlers will see them.

### Out of Scope

- Changing the existing **pending-contact DM suppression** (AC-OBS-1 of the
  pending-contact-confirmation epic): DMs from a still-pending contact continue to
  neither ring the bell nor be counted, unchanged. This is a deliberate, documented
  exception that these invariants do not override.
- Changing the **pairing-code / profile-exchange echo** handling in the contact
  invitation flow. Those events are not bell domains and stay as-is.
- Cross-tab / multi-window active-view coordination. The registry is per document;
  a background tab is treated as not-currently-viewing (bell rings), which is correct.
- Push / OS-level notifications, calls (IncomingCallModal), and the maintainer
  feedback thread routing — untouched.

## Design Decisions

1. **Per-entity granularity (product decision).** Confirmed with the product owner:
   the suppression target is the exact entity on screen, not the route. This is what
   makes the invariants generic and testable — "does the event's target equal the
   active view's target?" is the single predicate.

2. **Suppress via mark-read, not a silent drop.** When an on-domain event arrives,
   the handler calls the domain's existing mark-read (`markAsRead`,
   `markDirectMessagesRead`, `markJoinRequestsRead`, `markInviteExpiriesRead`)
   rather than merely skipping the increment. This advances the persisted last-read
   timestamp / acknowledged flag so INV-2 survives a reload — otherwise
   `initUnreadCounts` / `initDirectMessageCounts` would recompute a nonzero count on
   next load for a message the user already saw.

3. **Registry is the single source of "what am I viewing."** Detail views own their
   registration: the group detail view registers `{group, id}` and clears on
   unmount; `ContactChat` registers `{dm, peer}` and clears on unmount. The
   increment sites never inspect the router directly — they ask the registry. This
   keeps the invariant enforceable from non-React modules (`chatHandler`,
   `directMessageNotifications`, `inviteExpirySweep`) that cannot read React context.

4. **Existing live-UI paths are unchanged.** The open group chat already re-renders
   on `chatVersion`; the pending-requests list already appends live; `ContactChat`
   already renders live. INV-2's "update the UI" half is already satisfied by those
   paths — this epic only removes the erroneous bell ring that accompanied them.

5. **Invite-link expiry is a time-sweep, not an inbound event.** Its "on-domain"
   case is: the sweep detects an expiry for group X while X's detail view is active.
   The suppression rule is identical (consult the registry, mark acknowledged
   instead of incrementing), but the test approach differs — expiry is exercised via
   the sweep + storage fixtures rather than a peer publish.

## Technical Approach

### New: active-view registry (`app/src/lib/activeViewStore.ts`)

A module-level store, same shape as `unreadStore.ts`: a private `activeView` value,
`setActiveView(view)` / `clearActiveView()`, and a pure predicate
`isActiveView(domain, id): boolean`. `view` is `{ domain: 'group' | 'dm', id: string }`
or `null`. Ids are normalized (lowercased hex for peers, matching the `dmKey`
convention). No React dependency in the module itself; a thin `useActiveView` hook or
effect wires it from the detail components.

### Increment sites — consult the registry

- `chatHandler.ts` (group message): the own-send guard at `:101` gains an
  active-view branch. If `isActiveView('group', ctx.groupId)` → `markAsRead(groupId)`
  (advance last-read) and skip `incrementUnread`. The active-view predicate is
  injected through the deps bag to preserve the handler's zero-context-import
  boundary rule.
- `MarmotContext.tsx` join-request handler (`:1097`): if the request's group is the
  active view → `markJoinRequestsRead` (or simply do not increment, keeping the live
  `setPendingRequests` append) instead of `incrementJoinRequest`.
- `directMessageNotifications.ts` (`:99,147`): if `isActiveView('dm', peer)` → the
  open `ContactChat` already renders + marks read on its live subscription, so skip
  `incrementDirectMessage`. (Pending-contact suppression check stays ahead of this,
  unchanged.)
- `inviteExpirySweep.ts` (`:67`): if the newly-expired link's group is the active
  view → acknowledge without incrementing.

### Detail views — register/clear

- `pages/groups.tsx` `GroupDetailView`: register `{group, id}` when the detail
  resolves; clear on unmount and when navigating back to the list.
- `src/components/contacts/ContactChat.tsx`: register `{dm, peer}` alongside its
  existing mount-time `markDirectMessagesRead` (`:861`); clear on unmount.

### Documentation

Add the two invariants as a module doc comment on `activeViewStore.ts` and a short
note in `CLAUDE.md` (or a dedicated `docs/` note) so future event handlers inherit
the rule.

## Stories

Story split is left to the planner, but the natural seams are: (S1) the active-view
registry + its wiring from detail views; (S2) group-domain increment-site suppression
(messages, join requests, expiries) + e2e; (S3) DM-domain suppression + e2e; (S4)
documentation of the invariants. The registry (S1) is the shared dependency.

## Non-Goals

- No new bell domains. This epic makes the *existing* four consistent; it does not
  add notification types.
- No change to badge visuals, counts arithmetic, or the bell dropdown layout.
- No route-level suppression. Per-entity is the confirmed granularity; a route-level
  ("silence all of /groups") design is explicitly rejected.
- No relaxation of the privacy invariant — the registry holds only local entity ids,
  never broadcasts anything.
