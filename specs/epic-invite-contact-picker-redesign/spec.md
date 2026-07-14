# Invite Group Member From Contacts — Picker Redesign

## Problem

The "Invite Group Member from Contacts" feature (epic-invite-group-member-from-contacts,
shipped in commit f03ba03) is functionally correct but visually out of step with the rest
of the app. `InviteMemberModal` (`app/src/components/groups/InviteMemberModal.tsx`) renders
the contact picker as a native HTML `<Select>` dropdown, listing each contact as a bare text
`<option>` (nickname or truncated npub, plus a disabled-reason suffix in parentheses for
already-member/blocked contacts). Every other contact-facing surface in the app (notably
`app/pages/contacts.tsx`'s `ContactListView`) shows contacts as a scannable list of rows with
avatar + name via `ProfileSummary`. The dropdown cannot show avatars at all, and truncates to
one line of plain text per contact, making it harder to recognize a contact at a glance —
especially once someone has more than a handful of contacts.

## Solution

Replace the `<Select>` dropdown in `InviteMemberModal` with an enlarged modal body showing a
scrollable list of contact rows, each rendering avatar + name via the same `ProfileSummary`
component the contacts list uses, so the picker reads as "the contacts list, but for picking
one." Rows for already-member or blocked contacts stay visible but non-interactive, with the
same reason annotation the dropdown showed. Selecting a row single-selects it (radio-group
semantics) and drives the exact same submit flow, loading/error/success states, and
guidance/empty-state fallback that exist today. This is a visual-only change — no new
behavior, no new copy, no change to who is invitable or why.

## Scope

### In Scope

- Replace the `<Select>`/`<option>` picker in `InviteMemberModal` with a `VStack` (or
  equivalent) of clickable, avatar+name contact rows styled consistently with
  `ContactListView`'s row treatment (border, radius, hover state, muted background),
  reusing `ProfileSummary` for the avatar+name portion.
- Enlarge the modal (`ModalContent`/`size` prop) so the row list has room to breathe and
  scrolls internally when the contact count is large, instead of relying on native
  `<select>` overflow behavior.
- Preserve selection state, disabled/selectable logic, reason-suffix/badge treatment,
  guidance/empty state, and the submit/loading/error/success flow exactly as they behave
  today.
- Update `data-testid` selectors on the picker to reflect the new row-based structure, and
  update every e2e spec/helper that currently drives the old `<select>` via Playwright's
  `selectOption()` to instead click the corresponding row.

### Out of Scope

- Any change to `selectableContactsForGroup`, `submitInvite`, `resolveInviteTarget`, or
  `inviteByNpub` — the selection/eligibility/submission logic is unchanged.
- Any change to which contacts are invitable, or to the guidance-state copy/link.
- Multi-select or search/filter affordances — still a single-select picker.

## Design Decisions

1. **Reuse `ProfileSummary` for row content** — the contacts list
   (`app/pages/contacts.tsx:137`) already solves "avatar + name, with graceful fallback to
   a letter avatar and a truncated-npub name," so the picker rows render the same
   component at `size="sm"` rather than reimplementing avatar/name layout.
2. **Rows are `Box`/`Flex` elements, not `LinkBox`/`LinkOverlay`** — unlike
   `ContactListView`'s rows, picker rows must not navigate to `/profile` or `/contacts`; they
   are single-select list items whose click handler sets `selectedPubkeyHex`. Using a plain
   clickable container (not the link-box pattern) keeps that distinction structural, not
   just a missing `href`.
3. **Selection state model is unchanged** — `selectedPubkeyHex` / `isSelectionValid` /
   `hasSelectable` stay exactly as computed today (`InviteMemberModal.tsx:82-99`); only the
   rendering of `entries` changes, from `<option>` elements to row components.
4. **Disabled rows are visually distinct but still rendered** — already-member/blocked
   contacts keep the same reason-suffix text (`copy.groups.inviteReasonAlreadyMember` /
   `inviteReasonBlocked`), shown as a badge or muted inline label on the row, with the row
   itself non-clickable (matching today's `disabled` `<option>` semantics).
5. **No new i18n copy** — every string needed (reason suffixes, guidance text, submit/cancel
   labels) already exists under `copy.groups.*`; the redesign only changes markup, not text.

## Technical Approach

### `app/src/components/groups/InviteMemberModal.tsx`

- Replace the `FormControl`/`Select`/`<option>` block (lines 170-200) with a scrollable
  `VStack` of row components, one per `entries` item. Each row:
  - Renders `ProfileSummary` with the same `profile`/`fallbackName` derivation the dropdown
    used (`entry.contact.nickname || truncateNpub(pubkeyToNpub(entry.contact.pubkeyHex))`).
  - Appends the existing reason-suffix text when `entry.disabledReason` is set.
  - Is clickable (`onClick={() => setSelectedPubkeyHex(entry.contact.pubkeyHex)}`) only when
    `entry.selectable`; otherwise reduced opacity / `cursor: not-allowed`, no handler.
  - Shows a selected-state affordance (e.g. a highlighted border/background or a check icon)
    when `entry.contact.pubkeyHex === selectedPubkeyHex`.
  - Carries a stable `data-testid` keyed by pubkey, e.g.
    `invite-contact-row-${entry.contact.pubkeyHex}`, replacing the old per-`<option>` value
    attribute as the thing e2e specs target.
- Add a `data-testid="invite-contact-list"` container on the row list (parallel to
  `contacts-list` in `ContactListView`) so specs can assert on presence/count without
  depending on individual rows.
- Widen `ModalContent` (e.g. `size="lg"` or an explicit `maxW`) and cap the row list's height
  with `overflowY="auto"` so long contact lists scroll inside the modal instead of growing it
  unboundedly.
- `hasSelectable`, `isSelectionValid`, `handleInvite`, `submitInvite`, error/success/loading
  rendering: unchanged.

### `app/tests/e2e/helpers/group-setup.ts`

- The `invite-contact-select` + `selectOption()` interaction (lines ~95-102) becomes: wait
  for `invite-contact-row-${inviteeHex}` to attach, click it, then click
  `invite-submit-btn` — same wait-then-act discipline the helper's existing comment
  describes, retargeted at the row testid instead of the `<select>`.

### `app/tests/e2e/groups-invite-pending-contact-selectable.spec.ts`,
### `app/tests/e2e/groups-invite-guidance-state.spec.ts`,
### `app/tests/e2e/groups-error-cases.spec.ts`

- Replace `getByTestId('invite-contact-select')` + `selectOption(...)` with
  `getByTestId('invite-contact-row-<pubkey>')` + `.click()`, preserving each spec's existing
  assertion (disabled row does not become selected / `invite-submit-btn` stays disabled).
  `groups-invite-guidance-state.spec.ts`'s assertion that the picker is entirely absent when
  there are no selectable contacts retargets to asserting `invite-contact-list` is absent
  (parallel to today's `invite-contact-select` absence check).

## Stories

- **S1 — Row-based contact picker** — replace the `<Select>` dropdown with avatar+name rows,
  update all affected e2e specs/helpers. Covers AC-UX-1 through AC-UX-8, AC-DEP-1, AC-TEST-1.

## Acceptance Criteria

See [`acceptance-criteria.md`](./acceptance-criteria.md).

## Relationship to Other Epics

- **epic-invite-group-member-from-contacts** — this epic is a pure visual follow-up to that
  epic's shipped feature; it changes no selection/eligibility/submission behavior, only the
  picker's markup and the e2e selectors that drive it.

## Non-Goals

- Search/filter within the picker, multi-select invites, or any other picker capability
  beyond what the dropdown already offered — those are potential future epics, not part of
  this project direction change.
