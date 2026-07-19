# Invite-link awaiting landing

**Status**: pre-implementation
**Source**: natural-language request; requester product decisions locked in `## Design Decisions`

## Problem

When a **returning** user (one who already has an identity and, usually, one or more
joined groups) opens a group invite link from another user, the app throws away their
normal context and shows a bare, full-screen join card — then, once they request to join,
shows *only* a success alert with nothing underneath. The group they are joining never
appears anywhere until the admin approves.

Today's flow, concretely:

1. The link is `/groups/?join=<nonce>&admin=<npub>&name=<groupName>` (built by
   `buildInviteUrl`, `app/src/lib/marmot/inviteLinkGeneration.ts:46`).
2. `GroupsPage()` (`app/pages/groups.tsx:899`) branches on the query. When
   `join`+`admin`+`name` are all present it **returns `<JoinRequestCard>` directly**
   (`groups.tsx:941`) as a *full replacement* — before any of the groups-page chrome
   (list, offline banner, backup reminder, pending-invitations) is reached. The user's
   existing groups are not shown.
3. After the user taps **Request to Join**, `JoinRequestCard` renders **only** the
   standalone `join-request-sent` success alert (`JoinRequestCard.tsx:171`). Still no
   list, and no entry for the group being joined.
4. The `OutboundJoinRequestRecord` written on a successful send
   (`app/src/lib/marmot/outboundJoinRequests.ts`, IndexedDB store
   `few-outbound-join-requests`, carrying `nonce`, `adminPubkeyHex`, `groupName`,
   `sentAt`) is **never read by any UI**. It exists solely for the auto-accept
   correlation built by `epic-group-invite-link-onboarding`.
5. If/when the admin approves, the auto-accept path in `welcomeSubscription.ts` silently
   joins the MLS group, adds it to `groups` in `MarmotContext`, and deletes the outbound
   record. The user is not told in-app; they discover the new group only by separately
   navigating back to bare `/groups`.

Net effect: a returning user who follows an invite link loses sight of their own app,
gets no persistent "your request to join X is pending" indicator, and has no in-context
place from which the awaiting group resolves into a real group once approved.

*Success signal: a returning user who opens an invite link lands on their normal groups
page, sees an info banner and a dedicated "awaiting confirmation" card for the group they
are joining, can confirm the request inline and cancel it later, and — across reloads and
navigation — keeps seeing that awaiting card until the admin approves (it becomes a real
joined group) or they cancel it.*

## Solution

Change the returning-user invite-link experience from a full-screen takeover into an
in-context overlay on the groups page, backed by the already-persistent outbound
join-request record.

1. **Land on the groups page, list intact.** When an invite link is opened by a returning
   user, render the normal groups **list view** (existing groups, offline/backup banners,
   pending-invitations section — the full page chrome), not a full-screen replacement.

2. **Info banner above the list, two states.**
   - **Invited (pre-confirm)** — driven by the `?join=&admin=&name=` query params when no
     outbound record yet exists for that nonce: an `info` banner naming the group
     ("You've been invited to join *{group}*.") with an inline **Request to join** action.
     The existing name-gate for nameless users (built by `epic-group-invite-link-onboarding`,
     `JoinRequestCard`) is preserved in this inline context.
   - **Awaiting (post-confirm)** — driven by a persisted outbound record: an `info` banner
     ("Waiting for the admin to approve your request to join *{group}*.").

3. **Awaiting group shown as a card in the list.** Each unexpired outbound join-request
   record renders as a **card in the groups list**, styled as awaiting (visually dimmed
   and carrying an "awaiting" badge), positioned among the joined-group cards. It is not
   navigable to a real group (the group is not joined yet) and carries a **Cancel**
   affordance that withdraws the local request.

4. **Persistence until resolved.** The awaiting banner + card are driven by the IndexedDB
   outbound record, so they survive reloads and navigation. They disappear only when the
   record is removed: either the admin approves (auto-accept deletes the record and the
   real joined group appears in `groups`) or the user cancels (the record is deleted
   locally). A reactive read path over the store makes both transitions update the UI
   without a manual refresh.

This introduces **no new network channel and no new event kind**. Sending a join request
still goes through the existing gift-wrapped `sendJoinRequest`. Cancel is a purely local
delete of the outbound record. The privacy invariant is unaffected — nothing here
publishes profile metadata to an unaddressed audience.

## Design Decisions

The following were locked by the requester (interactive `/feature` clarification):

### DD-1 — Land on the groups page first; confirm inline
Opening an invite link renders the groups **list view** with the invited/awaiting banner
and the awaiting card in place. The request is confirmed inline (a **Request to join**
action in the banner), not on a separate full-screen card. Rationale: the returning user
keeps their app context and immediately sees where the group will appear.

### DD-2 — Awaiting state persists until approved or cancelled
The awaiting banner and card persist across reloads and navigation, backed by the existing
IndexedDB outbound join-request record, until the admin approves (record consumed by
auto-accept → real group) or the user cancels (record deleted). Rationale: an admin can
legitimately take days to approve; the record already has a 7-day TTL, so the UI simply
surfaces state that already persists.

### DD-3 — Awaiting group displayed as a dimmed/badged card in the list
The pending group appears as an entry in the normal groups list, dimmed and badged
"awaiting", consistent with how joined groups look, rather than as a wholly separate
section. The info banner sits above the list. Rationale: the requester wants the awaiting
group to read as "a group that is almost yours", co-located with the real ones.

### DD-4 — Cancel withdraws the local record only
The Cancel affordance on the awaiting card deletes the local outbound record
(`deleteOutboundJoinRequest(nonce)`). It does **not** attempt to retract the already-sent
join-request rumor from the admin. Rationale: a join request is fire-and-forget
gift-wrapped mail; there is no retraction primitive, and inventing one is out of scope.
Consequence (documented, acceptable): if the user cancels and the admin later approves
anyway, the Welcome arrives with no matching outbound record and therefore lands on the
existing manual **Accept/Decline** pending-invitations path — the same path a direct
invite uses today. This is a safe fallback, not a regression.

### DD-5 — Returning users only; first-visit welcome screen unchanged
This feature governs the **returning-user** path. Genuine first-time visitors continue to
see the first-visit welcome screen shipped by `epic-first-visit-invite-welcome` (which
intercepts the same `/groups/?join=` route). The branch that decides welcome-screen vs
groups-page landing is not changed by this epic; only the returning-user branch is.

## Constrained by ADRs

- **ADR-011 (Proposed) (Returning-user invite links land on the groups page, not a
  full-screen card)** — codifies this epic's cross-epic supersession of
  `epic-first-visit-invite-welcome`'s returning-user scoping decision (see
  `## Supersession note (cross-epic)` below). This ADR was scaffolded by the project
  curator at wrap-up and is `Status: Proposed` pending user review.

## Scope

### In scope
- Reactive, UI-facing read path over the `few-outbound-join-requests` store (list all
  unexpired records + subscribe to changes), plus a change-notification on every
  write/delete so the auto-accept delete and the cancel delete both update the UI.
- Groups-page (`app/pages/groups.tsx`) returning-user landing change: render the list view
  with the invited/awaiting info banner instead of the full-screen `JoinRequestCard`.
- Inline **Request to join** action in the invited banner (reusing the existing
  send + name-gate logic), and URL cleanup after a successful send so a reload shows the
  awaiting state from persistence.
- Awaiting-confirmation card in the groups list (dimmed + "awaiting" badge) with a
  **Cancel** action wired to `deleteOutboundJoinRequest`.
- Info-banner copy for both states + card/badge/cancel copy, in English and German
  (`app/src/lib/i18n.ts`).
- Clearing/consuming the record on the auto-accept join path so the awaiting card
  disappears and the real group card appears reactively (verify the existing
  `deleteOutboundJoinRequest` call emits the new change-notification).
- E2E coverage of the returning-user flow: land → banner + card → confirm inline →
  awaiting card persists across reload → cancel removes it; and approval clears it and
  surfaces the real group.

### Out of scope
- The first-visit welcome screen and any change to first-time-visitor landing (owned by
  `epic-first-visit-invite-welcome`).
- The admin-side approval UI / pending-requests list (owned by
  `epic-group-invite-link-onboarding` / `epic-group-invite-links`).
- Retracting or expiring the join-request rumor at the admin (see DD-4).
- The direct-invite (non-link) pending-invitations Accept/Decline flow, except that it
  remains the documented fallback when a cancelled request is later approved (DD-4).
- Any change to the join-request wire format, event kinds, or gift-wrap channel.

## Technical Approach

### Affected files (starting references)
- `app/src/lib/marmot/outboundJoinRequests.ts` — add a UI read path
  (`loadAllUnexpiredOutboundJoinRequests()` or similar) and a lightweight change-emitter
  (subscribe/notify) invoked from `saveOutboundJoinRequest` / `deleteOutboundJoinRequest`
  so `useSyncExternalStore` consumers react. Model the emitter on the existing reactive
  precedent in `app/src/lib/pendingInvitations.ts` (localStorage + `useSyncExternalStore`),
  adapted to idb-keyval's async, event-less nature.
- `app/pages/groups.tsx` — replace the full-screen `<JoinRequestCard>` return
  (`~:941`) for the returning-user case with the list view plus the info banner; render
  awaiting cards from the reactive outbound-record hook among the group cards
  (`~:1025`). Preserve the first-visit welcome interception (DD-5) and the existing
  `?id=` detail branch.
- `app/src/components/groups/JoinRequestCard.tsx` — the request-send + name-gate logic is
  reused; either the banner hosts a compact variant of this card inline, or its send
  handler is factored so the banner's **Request to join** action can call it. The
  `already-member` case (`:113`) is preserved.
- A new awaiting-card component (or a variant of `GroupCard`) for the dimmed/badged
  awaiting entry with the Cancel action.
- `app/src/lib/i18n.ts` — new copy keys (EN + DE) for both banner states, the awaiting
  badge, and the Cancel control.
- `welcomeSubscription.ts` — verify the auto-accept `deleteOutboundJoinRequest` triggers
  the new change-notification (should be automatic if the emitter lives inside
  `deleteOutboundJoinRequest`).

### Worked example (returning user)
1. Ana (already has "Family" and "Team" groups) opens Byron's link
   `/groups/?join=ab12…&admin=npub1…&name=Book%20Club`.
2. She lands on `/groups`: her "Family" and "Team" cards are visible; above the list an
   `info` banner reads "You've been invited to join *Book Club*." with a **Request to
   join** button.
3. She taps it. `sendJoinRequest` fires (gift-wrapped), an `OutboundJoinRequestRecord`
   `{nonce: ab12…, adminPubkeyHex, groupName: "Book Club", sentAt}` is saved, the emitter
   notifies, and the URL is replaced to bare `/groups`.
4. The banner switches to "Waiting for the admin to approve your request to join *Book
   Club*." and a dimmed **Book Club** card with an "awaiting" badge and a **Cancel** link
   now appears in her list alongside Family and Team. She reloads — it's still there.
5a. Byron approves. Ana's `welcomeSubscription` auto-accepts, joins the MLS group, deletes
    the outbound record (emitter notifies), and Book Club appears as a normal joined card;
    the awaiting card and banner vanish.
5b. Or Ana taps **Cancel**. The record is deleted (emitter notifies); the awaiting card
    and banner vanish. Family and Team remain.

## Stories (indicative; final split by story-planner)

1. **i18n copy** — banner (invited + awaiting), awaiting badge, cancel control (EN + DE).
2. **Reactive outbound-record read path** — `loadAllUnexpiredOutboundJoinRequests` +
   subscribe/notify emitter wired into save/delete; a `useOutboundJoinRequests()` hook.
3. **Groups-page landing + info banner** — returning-user branch renders the list with the
   invited/awaiting banner and inline Request-to-join; URL cleanup on send; first-visit
   interception preserved.
4. **Awaiting card + Cancel** — dimmed/badged awaiting card in the list, Cancel wired to
   `deleteOutboundJoinRequest`; auto-accept clear verified reactive.
5. **E2E** — returning-user land → banner + card → confirm → persist across reload →
   cancel; and approval → real group, awaiting cleared.

## Supersession note (cross-epic)

`epic-first-visit-invite-welcome` (shipped) deliberately kept the **returning user** on the
full-screen `JoinRequestCard` when opening an invite link — its welcome screen was scoped to
genuine first-time visitors only, and returning users retained the old card. **This epic
supersedes that specific returning-user behavior**: a returning user now lands on the groups
page (list + `InviteAwaitingBanner`) instead of the full-screen card. The first-visit welcome
screen for genuine first-time visitors (`isFreshIdentity === true`) is unchanged (DD-5).

Consequence: e2e specs written under `epic-first-visit-invite-welcome` and the
`epic-group-invite-link-onboarding` join-request epics that asserted the full-screen
`join-request-card` for a returning (pre-seeded-identity) invitee are updated by this epic to
assert the new banner landing. First-visit assertions in those specs (fresh identity → welcome
screen, no card) are preserved. This supersession was authorized by the requester and is a
candidate for a short ADR at wrap-up.

## Non-Goals
- No new event kind, wire-format change, or network channel.
- No retraction of an already-sent join request at the admin (DD-4).
- No change to first-time-visitor landing (DD-5) or to the admin approval UI.
- No public broadcast of any profile metadata (privacy invariant upheld — nothing here
  publishes to an unaddressed audience).
