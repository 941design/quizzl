# Invite Group Member From Contacts — Picker Redesign — Acceptance Criteria

## Terminology

- **picker row** — one entry in the new contact-picker list inside `InviteMemberModal`,
  rendered for one `entries[i]` value returned by `selectableContactsForGroup`.
- **selectable row** — a picker row whose backing `entries[i].selectable === true`.
- **disabled row** — a picker row whose backing `entries[i].selectable === false` (already a
  group member, or blocked).

## Known TAGs

- **UX** — user-visible rendering/interaction assertions.
- **DEP** — dependency/integration assertions (submit flow unchanged).
- **TEST** — end-to-end test-suite assertions.

## Contact Picker Redesign (S1)

**AC-UX-1** — `InviteMemberModal` MUST render one picker row per entry in `entries` inside a
container carrying `data-testid="invite-contact-list"`, and MUST NOT render a `<select>`
element with `data-testid="invite-contact-select"` or any `<option>` elements.

**AC-UX-2** — Each picker row MUST render the contact's avatar and display name via
`ProfileSummary`, using the same `profile`/`fallbackName` derivation the modal used before
this change (`entry.contact.nickname` falling back to the truncated npub).

**AC-UX-3** — Clicking a selectable row MUST set `selectedPubkeyHex` to that row's
`entry.contact.pubkeyHex`, and the row MUST visibly indicate selected state (e.g. highlighted
border or background) while selected. `invite-submit-btn` MUST be enabled if and only if a
selectable row is currently selected (same `isSelectionValid` gating as before).

**AC-UX-4** — A disabled row (already-member) MUST display the existing
`copy.groups.inviteReasonAlreadyMember` text and MUST NOT change `selectedPubkeyHex` when
clicked.

**AC-UX-5** — A disabled row (blocked) MUST display the existing
`copy.groups.inviteReasonBlocked` text and MUST NOT change `selectedPubkeyHex` when clicked.

**AC-UX-6** — When `hasSelectable` is `false`, the modal MUST render the existing guidance
state (`data-testid="invite-guidance-state"` with the `/contacts` link) and MUST NOT render
`data-testid="invite-contact-list"`.

**AC-UX-7** — Clicking any picker row MUST NOT navigate the browser (no route change to
`/profile` or `/contacts`) — picker rows are selection controls, not links, unlike
`ContactListView`'s `LinkBox` rows.

**AC-UX-8** — `InviteMemberModal`'s `ModalContent` MUST render with an enlarged size (e.g.
`size="lg"` or an explicit `maxW` wider than the pre-redesign default), and the row-list
container (`data-testid="invite-contact-list"`) MUST render with `overflowY="auto"` and a
bounded max-height, so the row list scrolls internally rather than growing the modal
unboundedly as the number of `entries` increases.

**AC-DEP-1** — Selecting a selectable row and clicking `invite-submit-btn` MUST invoke
`submitInvite`/`inviteByNpub` with that row's `pubkeyHex`, exactly as the dropdown did, and
`data-testid="invite-error"` / `data-testid="invite-success"` MUST render on failure/success
identically to the pre-redesign modal.

## Cross-Cutting Invariants

**AC-TEST-1** — Every e2e spec or helper that previously drove the picker via
`getByTestId('invite-contact-select')` + `selectOption()` MUST be updated to drive it via the
new row `data-testid` instead, and MUST preserve its original assertion outcome (e.g. a
disabled row's target stays unselected and `invite-submit-btn` stays disabled).

## Manual Validation

| MV id | Behavioral intent | Owner | Blocked on |
|-------|-------------------|-------|------------|
| MV-1  | Open the invite-from-contacts modal in the running app with several contacts (mixed selectable/already-member/blocked) and confirm the enlarged modal + avatar/name row list reads as visually consistent with the contacts list, with no layout overflow or clipped rows. | markus | AC-UX-1 |
