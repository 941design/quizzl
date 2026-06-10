# Contact Group Context

**Status**: Implemented 2026-06-10

## Problem

The contacts view and the contact profile page show no information about what groups the current user shares with a given contact. This leaves users without the context they need to understand who a contact is ("where do I know them from?") and no quick way to add a contact to a group directly from the contact surface.

Specifically:
- The contacts list shows only name and avatar — no indication of shared groups.
- The profile page offers DM and hide/archive but no way to add the contact to an existing group. Users must navigate to the Groups page and hunt for an Invite button to reach that flow.

## Solution

Add two enhancements:

1. **Common groups in the contacts list** — below each contact's name in `ContactListView`, display the names of groups both the current user and the contact belong to, in a visually subordinate (smaller-font) style.

2. **Add to group on the profile page** — on `ProfilePage`, add an "Add to Group" UI: a `Select` dropdown listing the user's groups that the contact is **not already in**, and a button that calls the existing `inviteByNpub` mechanism.

## Scope

### In Scope

- Display common group names below the contact's name in `ContactListView` (`pages/contacts.tsx`).
- Add an "Add to Group" section on `ProfilePage` (`pages/profile.tsx`) with a select dropdown (existing groups only) and a submit button.
- Wire the submit button to the existing `inviteByNpub` from `useMarmot()`.
- Disable/hide the "Add to Group" UI when all groups already contain the contact (no eligible group to add them to).
- Add i18n keys for both English and German to `app/src/lib/i18n.ts`.
- Cover the common-groups derivation logic with unit tests.

### Out of Scope

- Creating new groups from the profile page.
- Bulk-adding a contact to multiple groups at once.
- Any changes to the invite mechanism itself (reuses `inviteByNpub` as-is).
- Searching/filtering groups in the dropdown.

## Design Decisions

1. **Source of group data** — Both pages will call `useMarmot()` to get the synchronous `groups: Group[]` array already available in context. No new async loading, no new store. Refs: `app/src/context/MarmotContext.tsx:233`.

2. **Common groups = both users in memberPubkeys** — A group is "common" when `group.memberPubkeys` includes both `ownPubkeyHex` (the user) and `contact.pubkeyHex` (the contact). Comparison is case-insensitive to be consistent with existing contact filtering. Refs: `app/src/lib/contacts.ts:107`.

3. **Eligible groups for "Add to Group"** — A group is eligible if the contact's pubkeyHex does NOT appear (case-insensitive) in `group.memberPubkeys`. The user's own groups where they are already a member are the only candidates.

4. **No new component** — Common groups text is rendered inline in `ContactListView`'s card, below the `ProfileSummary`. The "Add to Group" section is rendered inline in `ProfilePage`. Neither change warrants a separate extracted component given their small scope.

5. **Invite call** — Uses `pubkeyToNpub(pubkeyHex)` to produce the npub before calling `inviteByNpub(groupId, npub)`, consistent with how `InviteMemberModal.tsx` works. Refs: `app/src/lib/nostrKeys.ts`.

6. **No profile page invite for non-contacts** — The "Add to Group" button only appears when `contact` (from `getContact`) is non-null, i.e. when the profile belongs to a known contact. Anonymous pubkeys shown via `/profile?pubkey=` without a contact entry receive no invite UI.

## Technical Approach

### `app/pages/contacts.tsx`

- Import `useMarmot` to get `groups`.
- In `ContactListView`, derive `commonGroups(contact, groups, ownPubkeyHex)` for each contact item: filter groups where both pubkeys appear in `memberPubkeys`.
- Render group names as a `<Text>` element (font size `xs`, color `textMuted`, `data-testid="contact-common-groups-{pubkeyHex}"`) below the `ProfileSummary` inside the `LinkBox` card. Show nothing (no empty element) when no common groups exist.

### `app/pages/profile.tsx`

- Import `useMarmot` to get `{ groups, inviteByNpub }`.
- Import `pubkeyToNpub` from `@/src/lib/nostrKeys`.
- Compute `eligibleGroups`: `groups.filter(g => !g.memberPubkeys.some(p => p.toLowerCase() === pubkeyHex.toLowerCase()))`.
- Render an "Add to Group" section only when `contact !== null` AND `eligibleGroups.length > 0`.
- Section contains: a `<Select>` (`data-testid="profile-add-to-group-select"`) with one `<option>` per eligible group, and a Button (`data-testid="profile-add-to-group-btn"`) that calls `inviteByNpub`.
- Manage local state: `selectedGroupId` (default: first eligible group's id), `addToGroupStatus: 'idle' | 'loading' | 'success' | 'error'`.
- On success, show a success toast/alert using Chakra `Alert`; on error, show error alert. Use i18n keys for all text.

### `app/src/lib/i18n.ts`

Add to `contacts` section:
- `commonGroups: (names: string[]) => string` — e.g. `"Groups: Alpha, Beta"` / `"Gruppen: Alpha, Beta"`

Add to `profile` section:
- `addToGroupLabel: string` — section heading
- `addToGroupSelect: string` — select label
- `addToGroupBtn: string` — button text
- `addToGroupSuccess: string` — success message
- `addToGroupError: string` — error message
- `addToGroupNoGroups: string` — (not used in UI, but kept as a safeguard)

## Stories

- **S1 — Common groups in contacts list** — Display shared group names below the contact's name in `ContactListView`. Covers AC-UX-1, AC-UX-2, AC-I18N-1.
- **S2 — Add to group on profile page** — Add "Add to Group" UI to `ProfilePage`. Covers AC-UX-3, AC-UX-4, AC-UX-5, AC-I18N-2, AC-ERR-1.

## Acceptance Criteria

See [`acceptance-criteria.md`](./acceptance-criteria.md).

## Relationship to Other Epics

- **epic-walled-garden-v2** — The invite flow reuses `inviteByNpub` which is the same mechanism gated by the walled garden rules. Adding to a group is an admin operation; users who are already members appear in common groups.

## Non-Goals

- Showing groups a contact is in that the current user is NOT in (not common groups).
- Any changes to group creation or group management flows.
- Removing a contact from a group.

## Amendments

None.
