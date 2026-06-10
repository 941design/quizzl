# Contact Group Context — Acceptance Criteria

## Known TAGs

- **UX** — user-visible behavior assertions.
- **I18N** — internationalisation assertions (both languages present and typed).
- **ERR** — error-handling assertions.
- **STRUCT** — structural assertions about code shape.

## Terminology

- **common groups** — groups whose `memberPubkeys` array contains both `ownPubkeyHex` and the contact's `pubkeyHex` (case-insensitive comparison).
- **eligible groups** — groups whose `memberPubkeys` does NOT contain the contact's `pubkeyHex` (case-insensitive).
- **addable groups** — the subset of eligible groups where the current user (`ownPubkeyHex`) appears in the group's MLS `adminPubkeys` (case-insensitive). Only an admin can successfully invite, so only addable groups are offered in the "Add to Group" dropdown.
- **`ContactListView`** — the list view rendered at `/contacts` (no `?id=` param) in `pages/contacts.tsx`.
- **`ProfilePage`** — the page at `/profile?pubkey=<hex>` in `pages/profile.tsx`.

## Common groups in contacts list (S1)

**AC-UX-1** — When `ContactListView` renders a contact that shares at least one group with the current user, a `[data-testid="contact-common-groups-<pubkeyHex>"]` element MUST be present in the DOM and MUST contain the names of all common groups as a non-empty string.

**AC-UX-2** — When `ContactListView` renders a contact that shares no groups with the current user, no `[data-testid^="contact-common-groups-"]` element for that contact MUST appear in the DOM.

**AC-I18N-1** — `Copy.contacts` in `app/src/lib/i18n.ts` MUST include a `commonGroups` key typed as `(names: string[]) => string` in both the `en` and `de` language objects.

## Add to group on profile page (S2)

**AC-UX-3** — When `ProfilePage` is displayed for a known contact and at least one addable group exists, a `[data-testid="profile-add-to-group-select"]` element MUST be present in the DOM and MUST list exactly the addable groups (eligible groups where the current user is an admin) as selectable options.

**AC-UX-4** — When `ProfilePage` is displayed for a known contact and NO addable group exists (the contact is already in all of the user's groups, the user has no groups, or the user is not an admin of any eligible group), the `[data-testid="profile-add-to-group-select"]` element MUST NOT be present in the DOM.

**AC-UX-5** — When the user selects an addable group from the dropdown and clicks `[data-testid="profile-add-to-group-btn"]`, `inviteByNpub` MUST be called with the selected group's id and the contact's npub (derived via `pubkeyToNpub`).

**AC-I18N-2** — `Copy.profile` in `app/src/lib/i18n.ts` MUST include the keys `addToGroupLabel`, `addToGroupSelect`, `addToGroupBtn`, `addToGroupSuccess`, and `addToGroupError`, all typed as `string`, in both the `en` and `de` language objects.

**AC-ERR-1** — When `inviteByNpub` returns `{ ok: false }`, `ProfilePage` MUST display a `[data-testid="profile-add-to-group-error"]` alert containing `copy.profile.addToGroupError`.

## Cross-Cutting Invariants

**AC-STRUCT-1** — The `commonGroups` derivation (filtering groups by presence of both pubkeys in `memberPubkeys`) MUST be covered by at least one unit test in `app/tests/unit/`.

**AC-STRUCT-2** — No new external dependencies (npm packages) MUST be introduced by this epic. The implementation MUST use only Chakra UI components, existing hooks (`useMarmot`, `useCopy`), and existing utilities (`pubkeyToNpub`).

**AC-STRUCT-3** — The `addableGroupsForContact(groups, contactPubkeyHex, adminGroupIds)` derivation (eligible groups intersected with the admin-group-id set, case-insensitive on membership) MUST be covered by at least one unit test in `app/tests/unit/`. The test MUST assert that a group where the user is NOT an admin is excluded even when the contact is not a member.

## Manual Validation

None.
