# Acceptance Criteria: Cancel Pending Invitations

## AC-CPI-1: i18n — cancelInviteButton key (EN + DE)
- `app/src/lib/i18n.ts` exports a `Copy` type with `groups.cancelInviteButton` (string)
- `getCopy('en').groups.cancelInviteButton === "Cancel Invite"`
- `getCopy('de').groups.cancelInviteButton === "Einladung zurückziehen"`

## AC-CPI-2: i18n — cancelInviteTitle key (EN + DE)
- `getCopy('en').groups.cancelInviteTitle === "Cancel Pending Invitation"`
- `getCopy('de').groups.cancelInviteTitle === "Ausstehende Einladung zurückziehen"`

## AC-CPI-3: i18n — cancelInviteBody key (EN + DE)
- `getCopy('en').groups.cancelInviteBody` contains the string "removed from the group permanently"
- `getCopy('de').groups.cancelInviteBody` contains the string "dauerhaft aus der Gruppe entfernt"

## AC-CPI-4: i18n — cancelInviteConfirm key (EN + DE)
- `getCopy('en').groups.cancelInviteConfirm === "Confirm"`
- `getCopy('de').groups.cancelInviteConfirm === "Bestätigen"`

## AC-CPI-5: i18n — cancelInviteSuccess key (EN + DE)
- `getCopy('en').groups.cancelInviteSuccess === "Invitation cancelled"`
- `getCopy('de').groups.cancelInviteSuccess === "Einladung zurückgezogen"`

## AC-CPI-6: i18n — cancelInviteError key (EN + DE)
- `getCopy('en').groups.cancelInviteError === "Failed to cancel invitation"`
- `getCopy('de').groups.cancelInviteError === "Einladung konnte nicht zurückgezogen werden"`

## AC-CPI-7: i18n — cancelInviteRaceNotice key (EN + DE)
- `getCopy('en').groups.cancelInviteRaceNotice === "Member just came online — cancellation no longer applies"`
- `getCopy('de').groups.cancelInviteRaceNotice === "Mitglied ist gerade online — Einladung kann nicht mehr zurückgezogen werden"`

## AC-CPI-8: i18n — cancelledByAnnouncement function key (EN + DE)
- `getCopy('en').groups.cancelledByAnnouncement` is a function `(member: string, canceller: string) => string`
- `getCopy('en').groups.cancelledByAnnouncement('Alice', 'Bob') === "Alice was uninvited by Bob"`
- `getCopy('de').groups.cancelledByAnnouncement('Alice', 'Bob') === "Alice wurde von Bob ausgeladen"`

## AC-CPI-9: i18n vitest assertions for all new keys
- A vitest test in `app/tests/unit/` covering all 8 new key paths for both `en` and `de`, asserting exact string values (mirroring `manageInviteLinksModal.test.ts:103-121`)

## AC-CPI-10: MarmotContext — isPendingMember method
- `MarmotContextValue` exports `isPendingMember(groupId: string, pubkey: string): Promise<boolean>`
- Implementation re-reads `getMemberProfiles(groupId)` on each call (no stale closure over `confirmedPubkeys`)
- Returns `true` iff the pubkey appears in `getGroupMembers(groupId)` output but has no entry in the profile store for that group
- Unit test: mock returns no profile → `true`; mock returns profile → `false`

## AC-CPI-11: MarmotContext — cancelPendingInvitation happy path
- `MarmotContextValue` exports `cancelPendingInvitation(groupId: string, pubkey: string): Promise<{ ok: boolean; error?: string }>`
- Happy path: calls `isPendingMember` first; if still pending, fetches `mlsGroup` via `clientRef.current.groups.get(groupId)`, calls `mlsGroup.commit({ extraProposals: [Proposals.proposeRemoveUser(pubkey), Proposals.proposeUpdateMetadata({ adminPubkeys: currentAdmins.filter(pk => pk !== pubkey) })] })` in a single call
- After successful commit: calls `markBackupDirty(true)` and `reloadGroups()`
- After successful commit: sends kind-9 chat announcement `{ type: 'invite_cancelled', pubkey, by: selfPubkey }` via `useChatStore().sendMessage(JSON.stringify(...))`
- Unit test: mock `mlsGroup.commit` resolves → `commit` called once, `markBackupDirty(true)` called, announcement `sendMessage` called

## AC-CPI-12: MarmotContext — cancelPendingInvitation commit-throws path
- When `mlsGroup.commit` throws, `cancelPendingInvitation` returns `{ ok: false, error: <message> }`
- `sendMessage` (announcement) is NOT called when commit throws
- Unit test: mock `mlsGroup.commit` rejects → `sendMessage` not called, returns `{ ok: false }`

## AC-CPI-13: MarmotContext — cancelPendingInvitation already-not-a-member path
- When `isPendingMember` returns `false` (member already gone), `cancelPendingInvitation` returns `{ ok: true }` without calling `commit`
- This covers the concurrent-cancellation convergence path (FR-10)
- Unit test: mock `isPendingMember` → `false` → `commit` not called, returns `{ ok: true }`

## AC-CPI-14: MarmotContext — cancelPendingInvitation race-guard path
- When `isPendingMember` returns `false` at click time (profile just arrived between render and call), `cancelPendingInvitation` returns `{ ok: true, raceDetected: true }` without calling `commit`
- The groups.tsx wiring displays `copy.groups.cancelInviteRaceNotice` toast instead of success toast
- Unit test: mock `isPendingMember` → `false` → result has `raceDetected === true`

## AC-CPI-15: InviteCancelledChatAnnouncement component
- `app/src/components/InviteCancelledChatAnnouncement.tsx` renders a system-style row matching `PollChatAnnouncement.tsx` layout
- Receives props `{ memberDisplay: string; cancellerDisplay: string }` and renders `cancelledByAnnouncement(memberDisplay, cancellerDisplay)` using `useCopy()`
- No data-fetching inside the component; display strings are resolved by the caller

## AC-CPI-16: StructuredContent union and parseStructured extension
- `StructuredContent` union in `GroupChat.tsx` (or its shared type file) gains `{ type: 'invite_cancelled'; pubkey: string; by: string }`
- `parseStructured` in `GroupChat.tsx` returns the new variant when `content.type === 'invite_cancelled'`
- Unit test: `parseStructured('{"type":"invite_cancelled","pubkey":"aabb","by":"ccdd"}')` returns `{ type: 'invite_cancelled', pubkey: 'aabb', by: 'ccdd' }`

## AC-CPI-17: GroupChat render switch dispatches to InviteCancelledChatAnnouncement
- The render switch in `GroupChat.tsx` (lines 362-389) handles `type === 'invite_cancelled'`: resolves `memberDisplay` and `cancellerDisplay` from `memberProfiles` / contact-cache fallback (truncated npub if not found), renders `<InviteCancelledChatAnnouncement />`
- When another admin ingests the kind-9 announcement, the chat list shows the `InviteCancelledChatAnnouncement` row (AC-D)

## AC-CPI-18: MemberListItem — Cancel button gating
- `MemberList.tsx` / `MemberListItem` accepts a new optional prop `onCancelInvite?: (pubkey: string) => Promise<void>`
- An inline Cancel button with `data-testid="cancel-invite-{pubkey.slice(0,8)}"` is rendered only when `isPending && !isYou && onCancelInvite !== undefined`
- Active member rows (no `isPending`) render no Cancel control (AC-E)
- The current user's own row renders no Cancel control even if pending flag is set

## AC-CPI-19: Cancel confirmation modal
- Clicking the Cancel button opens a Chakra `Modal` (via `useDisclosure`) with:
  - Title from `copy.groups.cancelInviteTitle`
  - Body using `copy.groups.cancelInviteBody` naming the invitee (nickname if in memberProfiles, otherwise `npubEncode(pubkey).slice(0, 16) + '…'`)
  - Confirm button (`copy.groups.cancelInviteConfirm`) with inline loading state
  - Cancel/close button

## AC-CPI-20: groups.tsx wiring — success path
- `GroupDetailView` in `pages/groups.tsx` passes `onCancelInvite` down to `MemberList` that calls `cancelPendingInvitation(groupId, pubkey)` from context
- On `{ ok: true }`: shows a success toast using `copy.groups.cancelInviteSuccess`
- On `{ ok: true, raceDetected: true }`: shows the `copy.groups.cancelInviteRaceNotice` toast instead

## AC-CPI-21: groups.tsx wiring — error path
- On `{ ok: false }`: shows an error toast using `copy.groups.cancelInviteError`; the member row remains visible in the list (AC-G)

## AC-CPI-22: E2E — pending member disappears after cancel
- Playwright test `app/tests/e2e/groups-cancel-pending.spec.ts` using `test.describe.serial()`
- Context A (USER_A) creates a group, invites USER_B's npub (USER_B's KeyPackage is published on the relay but USER_B's browser context is never booted)
- USER_B's row appears in the member list with the pending badge (`data-testid="member-pending-{pk.slice(0,8)}"`)
- USER_A clicks the Cancel button (`data-testid="cancel-invite-{pk.slice(0,8)}"`) and confirms
- USER_B's row is absent from the member list after the action completes

## AC-CPI-23: E2E — cancellation announcement appears in chat
- In the same Playwright test session, after cancellation, the group chat contains a row rendered by `InviteCancelledChatAnnouncement` (verifiable by text content matching the cancellation announcement)

## AC-CPI-24: E2E — group remains usable after cancel
- In the same Playwright test session, USER_A can send a new chat message after cancellation (proving the MLS group is not blocked and no unapplied proposals remain)
