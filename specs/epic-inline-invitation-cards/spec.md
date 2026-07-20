# Inline Invitation Cards

**Status**: pre-implementation (2026-07-20)

## Problem

When a user is invited to an MLS group, the invitation surfaces in a separate
"Pending Invitations" section rendered above the joined-groups list on the groups
page (`app/pages/groups.tsx`, `<PendingInvitations />`). Each row deliberately
shows **only** a truncated inviter pubkey + relative timestamp + Accept/Decline
(the old AC-INVITE-4 minimal design). The invitee therefore sees neither the
**group name** they were invited to nor a human-recognisable indication of **who
invited them**. This is confusing: the user is asked to accept or decline a group
they cannot identify.

The group name, description, and admin list are all recoverable from the invitation
(the encrypted Welcome) **before joining** — they are decrypted from an event
addressed to the invitee, so reading them is not a broadcast and does not touch the
privacy invariant. The authenticated inviter pubkey is already stored. The data to
fix the confusion is available; only the presentation withholds it.

## Solution

Replace the separate "Pending Invitations" section with **inline invitation cards**
in the groups list itself. An unaccepted invitation renders as a group card — fully
coloured, not greyed — pinned at the **top** of the groups list, above joined
groups. Each card shows:

- the **group name** (decoded from the Welcome; a fallback label when it cannot be
  decoded),
- a **status badge** marking it as an invitation,
- an **"Invited by <X>"** attribution line, where `<X>` is the inviter's **contact
  name** if the inviter is a known contact, otherwise a short/truncated pubkey,
- **Accept** and **Decline** controls.

The card body is **tappable** and opens a read-only **preview** of the invited
group (reached via the query param `/groups?invite=<invitationId>`, consistent with
the static-export routing rule). The preview shows the group name, description,
"Invited by <X>", and the group **admin(s)**, plus Accept/Decline. A full member
roster is not reliably recoverable pre-join and is out of scope.

**Accept** joins the group (existing `acceptPendingInvitation` flow); the card then
becomes a normal joined-group card. **Decline** is immediate (one tap discards the
invitation, no confirmation), matching current behaviour.

Once inline cards exist, the separate "Pending Invitations" section, its heading,
and its empty-state are removed.

## Scope

### In Scope
- New pre-join group-data helper that surfaces `{ name, description, adminPubkeys }`
  from a stored Welcome (extend/parallel `readPreJoinGroupName` in
  `app/src/lib/marmot/welcomeSubscription.ts`; use `readWelcomeMarmotGroupData`, not
  `readInviteGroupInfo`).
- Inviter → contact-name resolution using only locally available contact/profile
  data, with a truncated-pubkey fallback.
- New inline invitation card component (group name, badge, "Invited by", Accept,
  Decline, tappable to preview), pinned at the top of the groups list.
- New read-only preview view rendered inside `app/pages/groups.tsx`, selected by
  `router.query.invite`.
- Removal of the `PendingInvitations` section/heading/empty-state from the groups
  page. Deletion or repurposing of `PendingInvitations.tsx`.
- i18n additions/repurposing (en + de) for the badge label, "Invited by <X>" line,
  preview labels, admin label, and the group-name fallback label. Removal of the now
  unused heading/empty keys.
- Update of the two existing pull-only invitation e2e specs and new preview e2e
  coverage.

### Out of Scope
- Displaying a full member roster in the preview (not recoverable pre-join).
- Any change to how invitations are received, stored, gift-wrapped, or
  auto-accepted (S4 correlation path unchanged).
- Any change to the accept/decline network/MLS mechanics themselves — only the
  surfaces that call them change.
- The Layout.tsx invitation-count badge continues to work off the same store; its
  count semantics are unchanged (it counts pending invitations, which still exist as
  store entries).
- Confirmation prompt on decline (explicitly rejected — decline stays immediate).

## Design Decisions

- **Placement**: invitation cards are pinned at the top of the groups list, above
  joined groups. (User decision.)
- **Attribution**: "Invited by <contact name if known, else short pubkey>". The
  inviter pubkey used is the authenticated seal pubkey already stored on the
  `PendingInvitation` (`inviterPubkeyHex`), never the self-claimed rumor pubkey.
  (User decision + existing AC-AUTH constraint.)
- **Tap behaviour**: the card body opens a read-only preview via query param; the
  card is fully coloured, never greyed. (User decision + static-export routing
  rule.)
- **Decline**: immediate, no confirmation. (User decision — preserves current
  behaviour.)
- **Group name decode is async and may fail** (the matching local key package must
  be present). The card and preview must render a sensible fallback label when the
  name cannot be decoded, and must never block the list on the decode.
- **Privacy**: group name/description/admins come from decrypting the
  recipient-addressed Welcome — not a broadcast. Contact-name resolution reads only
  local data. No new public publish of any kind.
- **Coexistence with ADR-011 (do not disturb).** The groups page hosts a *separate*
  mechanism: the returning-user invite-link landing (`InviteAwaitingBanner` +
  `OutboundJoinRequestCard`), where the user has *requested* to join and awaits admin
  approval. Per ADR-011 those outbound "awaiting" cards are **dimmed** and co-located
  with real group cards. This epic touches only the **pull-only invitation** surface
  (someone invited *me*; accept/decline). Removing the `PendingInvitations` section
  must leave the invite-link banner + outbound-request card path fully intact. The
  resulting visual asymmetry is intentional: an outbound request you sent (awaiting,
  dimmed) reads differently from an inbound invitation you can act on now (fully
  coloured, top-pinned).

## Technical Approach

### `app/src/lib/marmot/welcomeSubscription.ts`
`readPreJoinGroupName` already decodes a Welcome via
`readWelcomeMarmotGroupData({ welcome, keyPackage, ciphersuiteImpl })`, looping over
local key packages, and returns `groupData.name`. Add a sibling (or generalise it)
that returns the richer shape `{ name, description, adminPubkeys }` from the same
decoded `MarmotGroupData`, preserving the side-effect-free / no-key-package-burn
guarantee and the null/fallback behaviour when no local key package matches.

### Contact-name resolution
Locate the existing pubkey → contact display-name mechanism (contacts/profile
context) and reuse it for the "Invited by" line and the preview attribution. Fall
back to a truncated pubkey when the inviter is unknown. No public lookup.

### `app/src/components/groups/` — inline invitation card
A distinct card variant (the joined-group `GroupCard` renders chat/unread/last-
message/member-count that do not exist pre-join). Renders group name + badge +
"Invited by <X>" + Accept + Decline, and makes the card body a link/button to
`/groups?invite=<id>`. Reactive off the same `pendingInvitations` store via
`useSyncExternalStore`.

### `app/pages/groups.tsx`
- Render the invitation cards pinned at the top of the joined-groups list (replacing
  the `<PendingInvitations />` block).
- Add a preview branch: when `router.query.invite` is set, render the read-only
  preview (group name, description, "Invited by <X>", admin(s), Accept/Decline)
  instead of the list/detail views. Follow the existing `router.query.id` detail
  pattern.
- Accept from either surface calls the existing context `acceptPendingInvitation`
  (which reloads groups + marks backup dirty); on success the preview returns to the
  list and the card becomes a joined-group card. Decline calls
  `declinePendingInvitation` and removes the card immediately.

### i18n (`app/src/lib/i18n.ts`)
Repurpose the `groups.pendingInvitations` namespace: keep `acceptBtn`/`declineBtn`
and the relative-time formatters if still used; add `badge` (e.g. "Invitation"),
`invitedBy(name)`, `adminLabel`, `unknownGroupFallback`, and any preview chrome
strings; drop `heading` and `empty` once the section is gone. Add both en and de.

## Stories

Story split is delegated to the story-planner. A natural decomposition:
1. Pre-join group-data helper + inviter contact-name resolution (lib layer).
2. Inline invitation card component + top-of-list placement + removal of the old
   section (component/page layer).
3. Preview route inside `groups.tsx` (page layer).
4. i18n + e2e test updates (may fold into the above stories per AC ownership).

## Non-Goals

- No member roster in the preview.
- No change to invitation receipt / storage / auto-accept.
- No decline confirmation.
- No public broadcast of any profile or group metadata.
- No new dynamic path segment (`[param].tsx`) — preview is query-param only.

## Amendments

- **2026-07-20 (S3, AC-PREVIEW-1 / AC-TEST-3 clarification):** The invitation
  preview shows the group description "when present". The app's create-group flow
  takes a name only (`createGroup(name)` — no description field), so an
  app-created e2e test group has no description, and the publish-through-app rule
  forbids injecting a described group by hand. The description branch is therefore
  covered by the unit-level conditional render (`invitation-preview-description`),
  and the `groups-invitation-preview.spec.ts` e2e asserts the always-present
  fields (name, admin, "Invited by") instead. No product-behaviour change — the
  preview still renders a description when a Welcome carries one.
