# Invite Rescind and Member Removal — Acceptance Criteria

## Terminology

- **marker** — the pending-direct-invite record persisted by the new store `app/src/lib/marmot/pendingDirectInviteStorage.ts`, keyed `${groupId}:${pubkey}`.
- **in-tree** — a pubkey present in the MLS group's current member/leaf set (`getGroupMembers`), regardless of whether a signed profile has arrived for it yet.
- **confirmedPubkeys** — the `Set<string>` computed by the `groups.tsx` member-loading effect (`:298-343`): every in-tree pubkey with a non-`provisional` profile, plus the viewer's own pubkey.
- **isPending** — `!confirmedPubkeys.has(pubkey) && !isYou`, the existing per-row derivation at `MemberList.tsx:100`.
- **raceDetected short-circuit** — either exit path in `cancelPendingInvitationImpl` (`cancelInvitationImpl.ts:56-63`, `:80-83`) that returns `{ok:true, raceDetected:true}` without performing an MLS commit, because a concurrent co-admin already removed the pubkey.
- **own signed profile** — an inbound profile payload whose `signedEvent` field is present and whose `signedEvent.pubkey` equals the subject pubkey — as opposed to a relay-on-behalf rumor carrying no signed envelope, where only `rumor.pubkey` is available.
- **shared removal helper** — `cancelPendingInvitationImpl` (`cancelInvitationImpl.ts:50-126`), exposed via the `MarmotContext` wrapper `cancelPendingInvitation`, invoked identically by both the Cancel-Invite and Remove-Member confirm actions.

## Known TAGs

- **MARKER** — pending-direct-invite marker write/clear lifecycle.
- **LABEL** — per-row affordance label selection on the member list.
- **REMOVE** — shared removal execution and confirm-dialog framing.
- **PURGE** — per-member profile purge on removal.
- **UNIV** — universal Remove Member availability (closes the stuck-unremovable hole).
- **LOCALE** — i18n key completeness for the new copy.
- **SCEN** — the eight required end-to-end scenarios (spec §5), each observed through the app.
- **INV** — cross-cutting, order-sensitive invariants spanning the marker/purge/removal flow.

## Marker Lifecycle

**AC-MARKER-1** — Submitting a direct invite via either `InviteMemberModal`'s `submitInvite` path or `profile.tsx`'s `handleAddToGroup` MUST persist a marker record for `${groupId}:${pubkey}` (via the new store's save function) before `inviteByNpub` is called.

**AC-MARKER-2** — When the marker-write call throws (e.g. simulated IDB quota/transient failure), the direct-invite flow MUST log the failure (a warning/error log call) and MUST still proceed to call `inviteByNpub` — a marker-write failure MUST NOT prevent the invite from being sent.

**AC-MARKER-3** — When `inviteByNpub` resolves `{ok: false}`, the marker written for that `groupId:pubkey` in the same flow MUST be cleared (deleted) before the direct-invite flow returns.

**AC-MARKER-4** — Calling `approveJoinRequestImpl` for a pubkey MUST NOT result in a marker record existing for that `groupId:pubkey`, either before or after the call — the approve path's own `inviteByNpub` call (`MarmotContext.tsx:515`) MUST NOT be wrapped by the marker-write.

**AC-MARKER-5** — When the profile handler processes an inbound profile payload carrying an own signed profile for a marked pubkey, the marker for that `groupId:pubkey` MUST be cleared regardless of whether `mergeMemberProfile` returns `true` or `false` for that payload.

**AC-MARKER-6** — When the profile handler processes an inbound payload for a marked pubkey that lacks a signed envelope (rumor-only, relay-on-behalf), the marker MUST NOT be cleared on the basis of `rumor.pubkey` alone.

**AC-MARKER-7** — After a removal (Cancel Invite or Remove Member) resolves via the shared removal helper's ordinary committing path and the pubkey is confirmed no longer in the tree, the marker for that `groupId:pubkey` MUST be cleared.

**AC-MARKER-8** — After a removal attempt resolves via either raceDetected short-circuit (a concurrent co-admin already removed the pubkey), the marker for that `groupId:pubkey` MUST still be cleared — gated on "pubkey confirmed no longer in tree," not on "this client performed the commit."

**AC-MARKER-9** — Both `clearAllGroupData` (account reset) and `leaveGroupImpl`'s per-group leave fan-out MUST each independently clear pending-direct-invite markers: `clearAllGroupData` MUST clear every marker across all groups, and `leaveGroupImpl` MUST clear every marker scoped to the group being left — dropping either call site MUST leave stale markers reachable through the other's code path.

**AC-MARKER-10** — A marker written by a direct invite and not yet cleared MUST still cause that pubkey's row to render "Cancel Invite" after the member list is reloaded (persistence survives reload, not just in-memory state).

## Label Selection

**AC-LABEL-1** — The `groups.tsx` member-loading effect MUST call the marker-read context method (`getPendingDirectInvites(groupId)`) exactly once per load, producing a `Set<string>` passed to `MemberList` as a prop — no per-row invocation of a marker-read or an `isPendingMember`-style async call MUST occur during a single member-list render pass, regardless of the number of member rows.

**AC-LABEL-2** — A member row MUST render "Cancel Invite" if and only if both: (a) its pubkey is present in the loaded marker `Set`, and (b) its pubkey is absent from `confirmedPubkeys` (still `isPending`). A row satisfying only one of the two conditions MUST NOT render "Cancel Invite".

**AC-LABEL-3** — For every in-tree, not-self, admin-visible row where AC-LABEL-2's conjunction is false, the row MUST render "Remove Member".

**AC-LABEL-4** — No single member row may render both "Cancel Invite" and "Remove Member" at the same time.

**AC-LABEL-5** — When the viewer is not an admin of the group, no member row MUST render either "Cancel Invite" or "Remove Member".

**AC-LABEL-6** — The viewer's own row MUST render neither affordance, regardless of its marker or confirmed state.

## Removal Execution

**AC-REMOVE-1** — Confirming "Cancel Invite" and confirming "Remove Member" MUST both invoke the shared removal helper (`cancelPendingInvitationImpl` via the `MarmotContext.cancelPendingInvitation` wrapper) — not two distinct MLS remove code paths.

**AC-REMOVE-2** — The rendered Cancel-Invite confirm dialog's body text MUST differ from the rendered Remove-Member confirm dialog's body text (distinct `en` strings for `copy.groups.cancelInviteBody` vs. the new `copy.groups.removeMemberBody`), even though both trigger the same underlying removal call.

**AC-REMOVE-3** — Confirming Cancel Invite on a pending direct invitee MUST result in that pubkey being absent from the group's member list after the removal resolves.

**AC-REMOVE-4** — Confirming Remove Member on a confirmed member MUST result in that pubkey being absent from the group's member list as rendered by both the acting admin's client and a second admin's client.

## Per-Member Profile Purge

**AC-PURGE-1** — `groupStorage.ts`'s `deleteMemberProfile(groupId, pubkey)` MUST remove only the stored profile entry for that specific `pubkey` within that `groupId`, leaving every other member's stored profile entry in that group unchanged.

**AC-PURGE-2** — After a removal that results in `pubkey` no longer being a tree member via the shared removal helper's ordinary committing path, `deleteMemberProfile(groupId, pubkey)` MUST have been called.

**AC-PURGE-3** — After a removal attempt that resolves via either raceDetected short-circuit, `deleteMemberProfile(groupId, pubkey)` MUST still have been called — gated on "pubkey confirmed no longer in tree," not on "this client performed the commit" (mirrors AC-MARKER-8's gate on the same condition).

**AC-PURGE-4** — When a removal attempt fails such that `pubkey` remains a tree member, `deleteMemberProfile(groupId, pubkey)` MUST NOT be called.

**AC-PURGE-5** — After a confirmed member's profile entry has been purged following removal, directly re-inviting that same pubkey MUST cause its member-list row to render "Cancel Invite" (pending), not "Remove Member" (confirmed).

## Universal Remove Member

**AC-UNIV-1** — When admin A directly invites a pubkey (the marker exists only on admin A's device) and admin B — a co-admin holding no local marker for that pubkey — views the same pending row, admin B's row MUST render "Remove Member" (a functioning control, not a disabled or absent one), and confirming it MUST evict the pubkey from the group.

**AC-UNIV-2** — For every in-tree member row (pending or confirmed) viewed by an admin other than the row's own subject, the row MUST render a functioning removal affordance ("Cancel Invite" or "Remove Member") — no combination of join-request-nickname-absence, catching-up-approval state, or missing marker may leave a row with no removal control available to that admin.

## i18n

**AC-LOCALE-1** — `i18n.ts`'s `Copy` type and both the `en` and `de` copy objects MUST define non-empty `removeMemberButton`, `removeMemberTitle`, `removeMemberBody`, `removeMemberConfirm`, `removeMemberSuccess`, and `removeMemberError` string values, each with `en` text distinct from its `de` text.

**AC-LOCALE-2** — A vitest test in `app/tests/unit/` MUST assert every `removeMember*` key from AC-LOCALE-1 resolves to its exact expected string for both `getCopy('en')` and `getCopy('de')`.

## End-to-End Scenarios (spec §5)

All scenarios below run in the relay bucket (`app/tests/e2e/groups-*.spec.ts`, Docker strfry), publish through the app (never raw WebSocket), and are part of the `make test-e2e-all` gate.

**AC-SCEN-1** — With the invitee's browser context closed before the admin approves their join request (masking-trap precaution), the approved member's row MUST render "Remove Member" — never "Cancel Invite" — at every point observed before and after their profile round-trips.

**AC-SCEN-2** — For a join request carrying no nickname (`joinRequestStorage`'s optional `nickname` omitted), the approved member's row MUST render "Remove Member", never "Cancel Invite" (the provisional-inference regression guard).

**AC-SCEN-3** — Driving a direct invite through both `InviteMemberModal` and the profile-page `handleAddToGroup` path, the invitee's row MUST render "Cancel Invite" while pending, then MUST render "Remove Member" after the invitee accepts and their own signed profile arrives — without requiring a page reload to observe the transition.

**AC-SCEN-4** — Clicking "Cancel Invite" and confirming MUST remove the pending invitee's row from the member list.

**AC-SCEN-5** — Removing a confirmed member via "Remove Member" MUST make that member's row disappear from both the acting admin's member list and a second admin's member list.

**AC-SCEN-6** — After a direct invite, reloading the admin's page MUST still render "Cancel Invite" for the pending invitee's row.

**AC-SCEN-7** — A co-admin with no local marker for admin A's pending invitee MUST see "Remove Member" on that row and MUST be able to evict the invitee via it.

**AC-SCEN-8** — Removing a confirmed member and then directly re-inviting the same pubkey MUST render "Cancel Invite" on that row (not "Remove Member"), proving the per-member purge ran.

## Cross-Cutting Invariants

**AC-INV-1** — For the pending-direct-invite lifecycle of a single marked pubkey — generator: the space of orderings of {the invitee's own signed profile arriving, an admin invoking Cancel Invite, an admin invoking Remove Member, a concurrent co-admin's Remove committing first (raceDetected)}, taken one at a time or racing pairwise — no ordering may leave a persisted marker on a row whose pubkey is simultaneously confirmed (in `confirmedPubkeys`) as a live member; a run in which the marker and "confirmed" status coexist for that pubkey fails the property.
Spans modules: PendingInviteStore, ProfileHandler, RemovalImpl, MemberProfileStore, GroupsPage.

**AC-INV-2** — For any removal attempt against a marked or unmarked in-tree pubkey — generator: the space of {ordinary committing removal, raceDetected via already-not-pending, raceDetected via empty leaf indexes} crossed with {marker present, marker absent}, in any order relative to a concurrent co-admin's own removal attempt on the same pubkey — the per-member profile purge and the marker clear MUST both have run by the time the pubkey is confirmed no longer in the tree, in every member of that generator's space; a run where the pubkey is gone from the tree but its profile entry or marker still exists fails the property.
Spans modules: RemovalImpl, MemberProfileStore, PendingInviteStore, GroupsPage.

**AC-INV-3** — For any in-tree member row rendered to an admin — generator: the space of {marker present or absent for the viewing admin, row pending or confirmed, viewing admin is or is not the inviter who holds the marker} — the row MUST always render a functioning removal affordance ("Cancel Invite" or "Remove Member"); no member of that space may produce a row with neither control rendered or a rendered-but-non-functional control, because the marker governs only the *label*, never the removal *capability*.
Spans modules: PendingInviteStore, RemovalImpl, GroupsPage.

**AC-INV-4** — For a marker written immediately before an `inviteByNpub` call that then fails — generator: the space of {the failure-triggered marker-clear succeeding, the failure-triggered marker-clear itself throwing/being skipped} crossed with {the pubkey never having entered the tree, having entered the tree via an unrelated concurrent invite} — no member of that space may cause the row for that pubkey to render "Cancel Invite" when the pubkey is absent from the tree; the `isPending && marker` conjunction (AC-LABEL-2) MUST mask an orphaned marker in every case, even when the marker-clear itself did not run.
Spans modules: PendingInviteStore, GroupsPage.

## Manual Validation

| MV id | Behavioral intent | Owner | Blocked on |
|-------|-------------------|-------|------------|
| MV-1 | The `de` copy for `removeMemberTitle`/`removeMemberBody`/`removeMemberConfirm` reads as natural German to a native speaker (not a mechanical word-for-word translation of the `cancelInvite*` set) | admin | AC-LOCALE-1 |
