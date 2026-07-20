# Acceptance Criteria — Inline Invitation Cards

## Pre-join group data

**AC-DATA-1** — A pre-join helper decodes a stored Welcome (`welcomeEventJson`) and
returns the group **name**, **description**, and **adminPubkeys** without joining the
group, without burning a key package, and without any network publish. It uses
`readWelcomeMarmotGroupData` (not `readInviteGroupInfo`).

**AC-DATA-2** — When no local key package matches the Welcome (name/data cannot be
decoded), the helper returns a null/empty result rather than throwing, and callers
render a fallback label. The groups list still renders (the failed decode of one
invitation never blocks the list or other cards).

## Attribution

**AC-ATTR-1** — The "Invited by <X>" attribution resolves the **authenticated
inviter pubkey** (`inviterPubkeyHex`, the seal pubkey) to the user's **contact
display name** when the inviter is a known contact.

**AC-ATTR-2** — When the inviter is not a known contact, the attribution shows a
**short/truncated pubkey** (not a raw full pubkey, not blank).

**AC-ATTR-3** — Attribution resolution reads only locally available contact/profile
data — it performs **no public relay lookup or publish**. (Privacy invariant.)

## Inline card

**AC-CARD-1** — An unaccepted invitation renders as an **inline card in the groups
list** showing: the group name (or fallback), a status **badge** marking it an
invitation, an "Invited by <X>" line, and **Accept** + **Decline** controls.

**AC-CARD-2** — Invitation cards are pinned at the **top** of the groups list, above
all joined-group cards.

**AC-CARD-3** — The invitation card is **fully coloured / not greyed out**.

**AC-CARD-4** — Tapping the invitation **card body** (outside the Accept/Decline
buttons) navigates to the read-only preview at `/groups?invite=<invitationId>`.

**AC-CARD-5** — Tapping **Accept** on the card joins the group (existing
`acceptPendingInvitation` flow); afterwards the invitation card is gone and the group
appears as a normal joined-group card in the list.

**AC-CARD-6** — Tapping **Decline** on the card **immediately** removes the
invitation (no confirmation prompt); the group is never joined and does not appear in
the list.

## Preview

**AC-PREVIEW-1** — `/groups?invite=<invitationId>` renders a **read-only preview** of
the invited group showing: group name (or fallback), description (when present),
"Invited by <X>", and the group **admin(s)**. It is reached via query param only (no
dynamic path segment), consistent with the static-export routing rule.

**AC-PREVIEW-2** — The preview offers **Accept** and **Decline**. Accept joins the
group and returns the user to the list with the group now joined; Decline discards
the invitation and returns to the list with the invitation gone.

**AC-PREVIEW-3** — Navigating to `/groups?invite=<id>` for an invitation id that no
longer exists (already accepted/declined, or unknown) does **not** crash — it falls
back to the groups list (or a benign not-found state).

## Section removal

**AC-REMOVE-1** — The **visible "Pending Invitations" heading text and the
empty-state are removed** from the groups page. No "Pending Invitations" heading text
and no "No pending invitations" empty-state renders anywhere. Invitations instead
render as inline cards pinned at the top of the groups list. (A non-visual structural
wrapper element may retain the `pending-invitations-section` testid per AC-TESTID-1 —
that is a test-hook, not the removed visible section.)

**AC-REMOVE-2** — No dead references remain to the removed section: the old
`heading`/`empty` i18n keys are dropped, the old `PendingInvitations.tsx` render path
(heading + empty-state + row layout) is gone, and no component imports a removed
export. The `pendingInvitations.ts` store is unchanged.

**AC-TESTID-1** (testid-stability — blast-radius control) — To avoid rewriting ~27
peripheral `groups-*` e2e specs that accept an invitation only as a setup step, these
test hooks remain **stable and behave as before**:
- `accept-invitation-${id}` — the Accept control on the inline card (29 spec files
  depend on it).
- `decline-invitation-${id}` — the Decline control on the inline card.
- `pending-invitations-section` — a structural wrapper around the top-pinned
  invitation cards, present only when at least one invitation exists (19 spec files +
  `helpers/group-setup.ts` use it as a readiness gate).
No spec other than the two rewritten target specs and the one new preview spec may
require modification for the suite to pass. The shared `helpers/group-setup.ts`
invite-accept helper must keep working unchanged.

## i18n / copy

**AC-COPY-1** — All new user-facing strings (badge label, "Invited by <X>", admin
label, group-name fallback, preview chrome) are defined in `i18n.ts` for **both `en`
and `de`**, referenced via `useCopy()`. No hardcoded user-visible strings in
components.

## Regression / privacy

**AC-REG-1** — The Layout invitation-count indicator continues to reflect the number
of pending invitations (it reads the same store; behaviour unchanged).

**AC-REG-2** — No code path added or changed by this epic publishes profile or group
metadata to a public relay. Group name/description/admins are sourced only from
decrypting the recipient-addressed Welcome; attribution reads only local data.

## Tests (e2e gate = full suite `make test-e2e-all`)

**AC-TEST-1** — `groups-pull-only-invitation-accept.spec.ts` is updated: the invitee
sees an inline invitation **group card** showing the group name + badge + "Invited
by" attribution (not a bare pending row); the card is tappable to the preview;
Accept (from card or preview) joins the group and the card becomes a joined-group
card. Peers publish **through the app**, never via raw WebSocket. Filename keeps the
`groups-` prefix (relay bucket).

**AC-TEST-2** — `groups-pull-only-invitation-decline.spec.ts` is updated: the invitee
sees the inline card; Decline removes it immediately; the group is never joined.

**AC-TEST-3** — New e2e coverage exercises the **tap-to-preview** view: group name,
description, admin, and "Invited by" are shown, and Accept/Decline work from the
preview. Publishes go through the app; filename keeps the `groups-` prefix.

**AC-TEST-4** — No spec other than the two rewritten target specs and the new preview
spec is modified (per AC-TESTID-1, the accept/decline button testids and the
`pending-invitations-section` wrapper testid stay stable). The `helpers/group-setup.ts`
helper is unchanged. The full suite `make test-e2e-all` passes.
