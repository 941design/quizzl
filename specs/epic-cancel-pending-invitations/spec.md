# Cancel Pending Invitations

## Goal

Allow any group member to cancel a pending invitation — i.e. permanently remove a member who was added to the MLS group by `inviteByNpub` but whose device has not yet shown signs of having processed the Welcome event. The cancellation must be effective for the entire group (network-binding via an MLS Remove commit), not just hidden locally.

## Background

### Today's invite flow

`InviteMemberModal` → `MarmotContext.inviteByNpub` does **not** have a "pending" phase. In one step it:

1. Fetches the invitee's KeyPackage from relays (kind 443 / 30443).
2. Calls `mlsGroup.inviteByKeyPackageEvent(...)` — this commits the new member into the MLS group and publishes the Welcome (kind 1059 wrapping kind 444) for the invitee.
3. Commits a `proposeUpdateMetadata` to add the invitee's pubkey to `adminPubkeys`.
4. Refreshes the local member list and re-publishes the inviter's profile rumor.

From the MLS protocol's perspective, the invitee is a **member** the moment step 2 commits — even though the invitee's device may not come online to process the Welcome for hours, days, or ever.

### What "pending" means in this spec

An invited member is **pending** if their pubkey is in the group's MLS member list **and** no profile rumor has ever been received from that pubkey in this group.

Joining clients always publish a profile rumor as part of the `welcomeSubscription` join flow (this is also why `inviteByNpub` re-sends the inviter's profile after committing — see the `// Ensure the inviter also re-sends...` comment in `MarmotContext.tsx`). Therefore "no profile rumor received yet" is a reliable proxy for "the invitee's device has not processed the Welcome and announced itself".

Once a profile rumor from that pubkey is ingested, the member becomes **active** and is no longer cancellable through this feature. Removing an active member is forced removal / kick — explicitly out of scope here and listed as deferred in `specs/out-of-band-leave.md`.

### Why MLS Remove is acceptable here (and the architectural constraint it respects)

The codebase has a documented rule: **never send a bare MLS Remove proposal**, because RFC-9420 / ts-mls require an admin commit before group sending resumes, and an uncommitted proposal blocks chat/polls/scores indefinitely (`leaveGroup` was deliberately downgraded to a soft-leave for exactly this reason — see the `// Soft-leave: purge local state only.` comment in `MarmotContext.tsx` and the design notes in `specs/out-of-band-leave.md`).

The cancel flow specified here **does not violate that rule**. It performs an MLS Remove **commit** (Remove proposal + commit in one atomic call via `mlsGroup.commit({ extraProposals: [proposeRemove(leafIndex)] })`), the same mechanism described in Flow 2 step 5 of `out-of-band-leave.md`. Because the group state advances to a new epoch with no unapplied proposals, sending is never blocked.

### Why all members can cancel

`inviteByNpub` already promotes every invitee to admin via the `proposeUpdateMetadata` commit (see line ~860 in `MarmotContext.tsx`). Therefore "any group admin can cancel" is operationally equivalent to "any group member can cancel". This is the same access model used by the auto-remove leave-intent handler in `out-of-band-leave.md`.

## Key Decisions

### 1. Pending signal: absence of a profile rumor

A member is pending if `memberProfiles[groupId][pubkey]` has no entry derived from a received profile rumor. The existing `clearMemberProfiles` and profile ingestion plumbing in `MarmotContext` is reused — no new persistence schema. A pending member transitions to active the moment the first profile rumor from their pubkey is processed; the Cancel button disappears reactively.

### 2. Cancel = MLS Remove commit + admin-list cleanup, in one transaction

When a group member confirms the cancel:

1. Build a `Proposals.proposeRemoveUser(inviteePubkeyHex)`. (marmot-ts 0.5.x exports `proposeRemoveUser(pubkey: string)` — see `app/node_modules/@internet-privacy/marmot-ts/dist/client/group/proposals/remove-member.d.ts`. It takes the hex pubkey, not a leaf index, and returns `ProposalAction<ProposalRemove[]>`.)
2. Build a `Proposals.proposeUpdateMetadata({ adminPubkeys: currentAdmins.filter(pk !== invitee) })`. The current admin list comes from `mlsGroup.groupData?.adminPubkeys` — same as `inviteByNpub`.
3. Call `mlsGroup.commit({ extraProposals: [removeProposalAction, updateMetadataProposalAction] })` — single commit, single epoch advance. The architect must verify that the array-valued `ProposalAction<ProposalRemove[]>` is accepted by the `commit({ extraProposals })` overload during the integration step; if a small adapter/spread is required, that's an implementation detail, not a design change.
4. Publish a structured kind-9 chat announcement `{ type: "invite_cancelled", pubkey: <invitee>, by: <canceller> }` to the group via `ChatStoreContext.sendMessage(JSON.stringify(...))` (mirrors the existing `PollStoreContext` poll_open / poll_close pattern at `PollStoreContext.tsx:204` / `:297`).
5. Refresh local group state via the existing `onMembersChanged` path; mark backup dirty.

### 3. UI placement: inline on the existing member-row, no new section

The pending-detection plumbing **already exists**:

- `MemberList.tsx:43` already computes `isPending` per row.
- `MemberList.tsx:130-138` already renders a localized "Pending" badge (`copy.groups.memberPending`, EN: "Pending", DE: "Ausstehend").
- `confirmedPubkeys` is derived in `groups.tsx:68-120` from `getMemberProfiles()` and re-runs whenever `profileVersion` or `groupDataVersion` changes — so badge visibility already reacts correctly to the first profile rumor arriving.

The new UI work is therefore narrow: add an inline **Cancel** button to the same row, gated on `isPending && !isYou`. Active rows continue to show no Cancel control. `MemberList` has no context access today; the Cancel handler must be passed down as a callback prop from the page (`pages/groups.tsx`), which is also where `confirmedPubkeys` lives.

Clicking Cancel opens a confirmation modal: _"Cancel pending invitation for {nickname-or-truncated-npub}? They will be removed from the group permanently."_ Confirming triggers the commit flow in Decision 2, with an inline loading state on the row and an error toast on failure.

### 4. Concurrent cancels are tolerated by EpochResolver

If two members click Cancel at the same time, both attempt the commit. The existing `EpochResolver` deterministically picks one winning commit; the loser's commit is rolled back and retried by ts-mls' standard reconciliation path. The retry sees the invitee already removed (no longer in the member list) and becomes a no-op — the UI reactively hides the row in both cases. No new locking is introduced.

### 5. No notification to the cancelled invitee

The invitee never processed the Welcome, so there is no symmetric channel to notify them. They retain whatever `KeyPackage` they had on relays; if they later try to "join" via the same Welcome event their client may have eventually fetched, MLS validation will fail because they are no longer in the ratchet tree. No additional code is needed to enforce this — RFC-9420 handles it.

### 6. Chat announcement on cancellation

A kind-9 application message with structured content `{ type: "invite_cancelled", pubkey: <invitee>, by: <canceller> }` is sent to the group, rendered by a new `InviteCancelledChatAnnouncement` component in the same style as `PollChatAnnouncement` and the planned `LeaveChatAnnouncement` (see `out-of-band-leave.md` § "Modified Components" / "New Components"). Both EN and DE strings.

## Out of Scope

- **Forced removal of active members (kick)**: listed as deferred in `specs/out-of-band-leave.md` § "Open Questions". This spec does not introduce a generic kick.
- **Bulk cancellation**: each pending invitation is cancelled one at a time.
- **Pre-commit invite queueing**: `inviteByNpub` continues to commit immediately. We do not introduce a "queued invite" state on the inviter side.
- **Resending an invitation after cancellation**: a cancelled invitee can be re-invited via the existing `InviteMemberModal` flow. No special "resend" UX.
- **Notifying the cancelled invitee out-of-band**.
- **Cancellation history / audit trail**: the kind-9 chat announcement is the only durable record.

## Functional Requirements

| ID | Requirement |
|----|-------------|
| FR-1 | The member-list row for a pubkey with no recorded profile rumor in the current group displays a localized "pending" badge. (Already implemented at `MemberList.tsx:130-138` — verify, do not duplicate.) |
| FR-2 | The same row displays an inline Cancel control; rows for members with a recorded profile rumor do not. The control is also hidden on the current user's own row. |
| FR-3 | Clicking Cancel opens a confirmation modal naming the invitee (nickname if known, otherwise truncated npub) and warning that removal is permanent. |
| FR-4 | Confirming cancellation issues `mlsGroup.commit({ extraProposals: [Proposals.proposeRemoveUser(inviteePubkey), Proposals.proposeUpdateMetadata({ adminPubkeys: currentAdmins.filter(pk !== invitee) })] })` in a single call. |
| FR-5 | After the commit succeeds, the canceller's client publishes a kind-9 application message `{ type: "invite_cancelled", pubkey, by }` to the group. |
| FR-6 | After the commit succeeds, the canceller's local member list refreshes from MLS state; the cancelled invitee no longer appears; backup is marked dirty. |
| FR-7 | Other admins receiving the new MLS epoch see the cancelled invitee disappear from their member list via the existing `onMembersChanged` path. |
| FR-8 | Other admins render an `InviteCancelledChatAnnouncement` (_"{Member} was uninvited by {Canceller}"_, both EN/DE) in the group chat for the new kind-9 structured message. |
| FR-9 | If the commit throws, the row stays visible, an error toast is shown, and the local state is unchanged. |
| FR-10 | If two admins cancel the same pending member concurrently, exactly one commit lands; the other is rolled back without surfacing an error to the user (idempotent: the second attempt sees the invitee already removed and silently no-ops). |
| FR-11 | All new user-visible strings are added to both `en` and `de` in `app/src/lib/i18n.ts`; no hardcoded strings in components. |

## Acceptance Criteria

The story planner derives the canonical, story-mappable AC list in `acceptance-criteria.md`. The criteria below are the testable observations the planner must cover:

- **AC-A**: Given a freshly invited member whose device has not come online (no profile rumor recorded), when another group admin opens the group detail view, the member's row shows the existing "Pending" badge AND a new inline Cancel button.
- **AC-B**: Given the same pending row, when the admin clicks Cancel and confirms, then `mlsGroup.commit` is called once with `extraProposals` containing a `Proposals.proposeRemoveUser(inviteePubkeyHex)` action and a `Proposals.proposeUpdateMetadata({ adminPubkeys: ... without invitee })` action.
- **AC-C**: Given a successful commit, when the canceller's client refreshes group state, the invitee is absent from the member list, `markBackupDirty(true)` has been called, and a kind-9 application message with `{ type: "invite_cancelled", pubkey, by }` has been sent to the group.
- **AC-D**: Given a second admin observing the new MLS epoch, when their client ingests the commit and the kind-9 announcement, the invitee is removed from their member list and an `InviteCancelledChatAnnouncement` chat row is rendered.
- **AC-E**: Given a member whose profile rumor has been received, when the member-list is rendered, that member's row shows neither the "pending" badge nor the Cancel control.
- **AC-F**: Given two admins cancelling the same pending member concurrently, exactly one MLS commit is accepted by the group; the losing client converges to the same final state without surfacing a user-visible error.
- **AC-G**: Given a commit failure (simulated by mocking `mlsGroup.commit` to throw), the row remains visible, the error toast renders, and no kind-9 announcement is sent.
- **AC-H**: Given an end-to-end Playwright run with two browser contexts, when context A invites an npub that is not online, then context A cancels the pending invitation, the invitee disappears from context A's member list and the chat shows the cancellation announcement; the group remains able to send new chat messages.
- **AC-I**: All new user-visible strings appear in both `en` and `de` translation maps and are referenced via `useCopy()`.

## Dependencies and Constraints

- Reuses `Proposals.proposeRemove`, `Proposals.proposeUpdateMetadata`, and `getGroupMembers` from `@internet-privacy/marmot-ts` — already in use in `MarmotContext.tsx`.
- Reuses the existing chat announcement rendering pattern (`PollChatAnnouncement`).
- Must not introduce any code path that issues a bare MLS Remove proposal without a commit in the same call.
- Must respect the static-export constraint (no path-segment dynamic routes; the feature lives entirely under the existing `/groups?id=...` page).
- Must add EN + DE translations via `app/src/lib/i18n.ts`.

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Invitee processes Welcome and publishes profile *between* render and click | The local Cancel handler re-checks pending status; if no longer pending, it short-circuits with a small inline notice ("Member just came online — cancellation no longer applies"). No commit is attempted. |
| Cancellation succeeds but the kind-9 announcement publish fails | Logged; no UI error. Other admins still see the member disappear via the MLS commit; they just won't see a chat row. |
| Canceller is the inviter | Allowed. No special-case. |
| Group has only the canceller and the pending invitee | Allowed. After commit, the canceller is alone. |
| Pending invitee's pubkey is no longer in `getGroupMembers` (already removed by another commit) | The `proposeRemoveUser` / `commit` call throws (typical marmot-ts behavior when the target is not a current member). The handler treats this specific failure mode as success and just refreshes UI; the EpochResolver's roll-back-and-replay will independently converge state. |
| Browser offline at click time | The commit still constructs locally but the publish to relays fails. Surface as an error toast; do not optimistically remove the member. |
| Profile rumor arrives mid-flight (after commit, before refresh) | Harmless. The member is gone from MLS; the now-orphan profile entry is cleared by the existing `onMembersChanged` reconciliation. |

## Implementation Hints

- The existing `inviteByNpub` flow (`MarmotContext.tsx` ~796–907) is the closest reference for: leaf-index handling, `extraProposals` batching, post-commit `markBackupDirty` and `reloadGroups`, and the `serialiseProfileUpdate` post-commit publish pattern.
- The leave-intent flow described in `specs/out-of-band-leave.md` Flow 2 is the closest reference for: structured kind-9 chat announcements, debounce considerations (not needed here — single-action), and `EpochResolver` interaction.
- The pending-status derivation should live alongside the existing member-profile state in `MarmotContext` so consumers can read it via context selector (e.g., `isPendingMember(groupId, pubkey)`), avoiding component-level prop drilling.
- The E2E test should follow the pattern in `specs/epic-group-invite-links/S9-e2e-invite-link-flow` (two browser contexts, serial test, IndexedDB cleanup).
