# Acceptance Criteria: Admin Role Management for Groups

<!--
  Decisions encoded here:

  1. AC-GRANT-5 scope: The superset guard is APP-ENFORCED ONLY (Nostling client).
     marmot-ts performs a wholesale replace of adminPubkeys with no protocol-level
     constraint. The AC text explicitly limits scope to the application commit path.

  2. AC-PENDING-6 label semantics: The AC tests copy content, not just badge
     presence. The label MUST NOT assert that message delivery has stopped —
     forward secrecy is delayed, not guaranteed.

  3. AC-REMOVE-1 non-admin no-op: A non-admin's fireAutoCommit call MUST NOT
     issue a commit; it MUST retain entries in the pending queue for a future
     admin pass. This is distinct from an error — it is a guarded no-op.

  4. AC-JOIN-3 boundary: Inviting a member (inviteByNpub) commits the MLS Add
     only. adminPubkeys MUST NOT be mutated as a side-effect of invite.

  5. Concurrent-grant (AC-GRANT-7) was AMENDED 2026-06-11 to last-writer-wins
     (marmot-ts commit() does not throw on same-epoch conflict; the fork is
     resolved asynchronously on the receiving side). The narrowed testable
     invariant is live-set re-read at fire time + single catch-based retry on a
     synchronous throw. See spec ## Amendments and the AC-GRANT-7 body.

  6. [ADDED] ACs:
     - AC-I18N-1: all new copy keys have both en and de entries in i18n.ts.
     - AC-I18N-2: no hardcoded user-visible strings in new/modified components.
     - AC-DEAD-1: auto-promote block and its dead-code cascade are fully removed.
     - AC-BOUND-1: grantAdminImpl.ts has zero imports from app/src/context/.
     - AC-BOUND-2: MemberList.tsx has zero useMarmot() or useContext calls after
       this epic's changes land.
     These were absent from spec Section 5 but are load-bearing invariants stated
     in architecture.md and exploration.json boundary rules. They are implementation
     verifiables, not product features, so they are grouped separately.

  7. Reconciliation result (Mode 1 drift check): grantAdminImpl.ts is listed as
     a new file in architecture.md (marked "(new)"). ACs referencing its behavior
     (AC-GRANT-2, AC-GRANT-5) are correct and intentional — this epic creates it.
     No absent-artifact adjudication required.
-->

## Initialization

**AC-INIT-1**: A newly created group MUST list exactly one admin — the creator's pubkey — in `adminPubkeys`, with no other entries present.

**AC-INIT-2**: The group-create path MUST NOT produce a zero-admin group; the creator's pubkey MUST always be seeded into `adminPubkeys` at creation time.

## Joining

**AC-JOIN-1**: A member who accepts a direct invite MUST join with no admin privilege; their pubkey MUST NOT appear in `adminPubkeys` after the welcome is processed.

**AC-JOIN-2**: A member approved via an invite-link join request MUST join with no admin privilege; their pubkey MUST NOT appear in `adminPubkeys` after approval.

**AC-JOIN-3**: `inviteByNpub` MUST commit the MLS Add only and MUST NOT append the invitee's pubkey to `adminPubkeys` as a side-effect of the invite operation.

## Granting Admin

**AC-GRANT-1**: An admin MUST see a "Make admin" button on each confirmed non-admin member row; a non-admin MUST NOT see a "Make admin" button on any member row.

**AC-GRANT-2**: After the "Make admin" confirmation is accepted, the app MUST commit an `UpdateMetadata` proposal setting `adminPubkeys` to the live current set ∪ {target pubkey}; after the commit propagates, the target member MUST be able to perform admin actions (invite, accept join requests, grant admin).

**AC-GRANT-3**: The "Make admin" button MUST NOT be shown for the current user's own row or for any member whose pubkey is already in `adminPubkeys`.

**AC-GRANT-4**: The "Make admin" button MUST NOT be shown for pending (unconfirmed, not yet in `confirmedPubkeys`) members.

**AC-GRANT-5**: Within the Nostling application commit path, any `adminPubkeys` update whose new set is not a superset of the live current `adminPubkeys` (re-read at commit time from `mlsGroup.groupData?.adminPubkeys`) MUST be rejected before the proposal is built; no demotion path exists in the client. (This is an app-enforced invariant; marmot-ts does not enforce it at the protocol level.)

**AC-GRANT-6**: The confirmation dialog for "Make admin" MUST state that the action cannot be undone; dismissing the dialog without confirming MUST NOT trigger any MLS commit or `adminPubkeys` mutation.

**AC-GRANT-7** *(amended 2026-06-11 — see spec `## Amendments`)*: Concurrent same-epoch grants are **last-writer-wins** at the MLS layer and are NOT guaranteed no-clobber. Two admins granting to different members at the same epoch each commit successfully and locally advance to their own epoch N+1 (marmot-ts `commit()` has no relay awareness and does not throw on the conflict — the fork is only detected later, on the receiving side, where the losing commit is dropped as unreadable). The grant path therefore re-reads the live `adminPubkeys` at commit time and re-merges the target (which prevents clobber whenever the live read already reflects the other grant, and handles the rare case where `commit()` DOES throw synchronously — e.g. local unapplied proposals — via a single catch-based retry), but it MUST NOT claim protocol-level no-clobber. When a grant is silently superseded by a concurrent grant, the granting admin re-issues it after observing the target's Admin badge did not appear. This is consistent with the §2.4 (non-revocability is a client-only invariant) and §4.6 (marmot-ts alpha) honesty posture.

The testable invariant is narrowed to: (a) `grantAdmin` re-reads the live `adminPubkeys` at fire time and merges the target into that live set (never a stale UI snapshot); and (b) when `commit()` throws synchronously, exactly one catch-based retry re-reads the live set and re-merges before giving up.

## Admin-Gated Actions

**AC-GATE-1**: A non-admin member MUST NOT see the Invite, Invite-link, and Manage-links controls in an enabled/visible state; the pending-join-requests section MUST NOT be rendered for a non-admin.

**AC-GATE-2**: A non-admin MUST NOT be able to accept or deny a join request; the accept/deny action path MUST be unavailable (not merely hidden behind a disabled button).

**AC-GATE-3**: A non-admin MUST NOT be able to cancel a pending invitation; the cancel action MUST be unavailable to non-admins.

## Last-Admin Protection

**AC-LAST-1**: When the current user is the sole admin of a group and presses "Leave group", the leave MUST be blocked and the UI MUST display an explanation that the user must make another member an admin before leaving; no leave flow proceeds.

**AC-LAST-2**: Once a second admin exists in `adminPubkeys`, the original admin MUST be able to leave normally; the remaining admin MUST be able to finalize pending removals via `fireAutoCommit` after the original admin leaves.

## Visibility

**AC-VIS-1**: Each member whose pubkey appears in `adminPubkeys` MUST display an "Admin" badge in the member list, visually distinct from the pending-invite and pending-removal badges.

## Removal / Leave Liveness

**AC-REMOVE-1**: When a member leaves, an online admin's `fireAutoCommit` MUST commit the eviction; a non-admin's `fireAutoCommit` MUST NOT issue a commit and MUST retain the pending-removal entries in the queue so a future admin pass can process them.

**AC-REMOVE-2**: The `remainingAdmins` computation in `fireAutoCommit` MUST filter the departing member's pubkey from the live `adminPubkeys`; a departing admin MUST be excluded from the post-commit admin set; a departing non-admin MUST produce no change to `adminPubkeys`.

## Pending-Removal Visibility

**AC-PENDING-1**: A member MUST be able to leave with no admin online; their own exit MUST complete immediately (kind-13 intent emitted, local purge) and MUST NOT be blocked by admin-only finalization.

**AC-PENDING-2**: While a member's eviction commit has not yet landed, remaining members MUST see that member in a visually distinct "leave pending" state (self-left) or "removal pending" state (admin-side removal queued) in the roster, separate from the normal confirmed-member display.

**AC-PENDING-3**: The pending-removal state MUST clear automatically when an admin's `fireAutoCommit` lands; no manual approval action exists or is added to the flow.

**AC-PENDING-4**: Remaining members MUST be able to send and receive messages normally while another member is in a leave/removal-pending state; no message freeze occurs during the limbo window.

**AC-PENDING-5** *(verification moved to Manual Validation MV-4, 2026-06-12)*: The pending-removal state MUST survive a page reload during limbo; on reload and historical sync the kind-13 leave intent MUST be re-observed and the pending badge MUST be re-rendered. **Verification note:** the production logic (S6 reads `getPendingRemovals` on each `groupDataVersion` tick; the queue repopulates from re-observed kind-13 on historical sync) is verified by the S6 integration examiner. An automated e2e test was NOT shipped: badge *persistence* requires no admin online to finalize (an online admin's `fireAutoCommit` clears it), while observing+reloading requires an online viewer — impossible in a 2-user group where the only non-admin is the leaver. A faithful test needs a 3rd member (offline admin + online non-admin observer), deliberately avoided for e2e reliability. See MV-4.

**AC-PENDING-6**: The pending-removal label MUST convey "departed, cleanup pending" and MUST NOT assert or imply that message delivery to the departed member has stopped; the copy MUST not use language that promises resolution on a fixed timeline (e.g., it MUST NOT say "will be removed soon" or equivalent).

## Internationalisation

**AC-I18N-1** [ADDED]: Every new Copy key (`makeAdminButton`, `makeAdminTitle`, `makeAdminBody`, `makeAdminConfirm`, `adminBadge`, `lastAdminLeaveBlocked`, `leavePendingBadge`, `removalPendingBadge`) MUST have both an `en` entry and a `de` entry in `app/src/lib/i18n.ts`, and MUST be declared in the `Copy` type.

**AC-I18N-2** [ADDED]: No user-visible string introduced by this epic MUST be hardcoded in any component file; all new strings MUST be referenced via `useCopy()` keys defined in `i18n.ts`.

## Dead-Code Removal

**AC-DEAD-1** [ADDED]: The auto-promote block at `MarmotContext.tsx:1169–1187`, the `adminPromotionFailed` warning return path, the `inviteWarningAdminPromotion` i18n key (both `en` and `de`), and the warning display in `InviteMemberModal.tsx:73–80` MUST all be deleted; no reference to `adminPromotionFailed` or `inviteWarningAdminPromotion` MUST remain in the codebase.

## Architectural Boundary

**AC-BOUND-1** [ADDED]: `app/src/lib/marmot/grantAdminImpl.ts` MUST have zero imports from `app/src/context/`; it MUST be a pure Deps-injected implementation, mirroring the `cancelInvitationImpl.ts` boundary.

**AC-BOUND-2** [ADDED]: After this epic's changes land, `app/src/components/groups/MemberList.tsx` MUST contain zero calls to `useMarmot()` or `useContext`; all data MUST arrive via props only.

---

## Manual Validation

The following behaviors cannot be fully verified by automated tests alone and require manual or load-based verification:

**MV-1 (relates to AC-GRANT-7 — concurrent grant under real relay load):**
AC-GRANT-7 was amended (2026-06-11) to last-writer-wins; protocol-level no-clobber is NOT claimed. The unit-test gate now covers (a) live-set re-read at fire time and (b) the single catch-based retry on a synchronous `commit()` throw. The residual manual check is to confirm the *observable failure mode* is acceptable: two admin sessions simultaneously grant admin to two different members on a real strfry relay; confirm that if one grant is silently superseded, the granting admin can simply re-issue it (the target's Admin badge will be absent, signalling the need). This is a confidence check on the degraded-path UX, not a no-clobber guarantee.

**MV-2 (relates to AC-PENDING-6 — forward-secrecy delay, informational only):**
Until the eviction commit lands, the departed leaf's key remains cryptographically valid. The spec explicitly states this is a hygiene cost, not a liveness cost, and no automated test can assert "delivery has not stopped at the protocol level" without a full MLS interop harness. Testers should manually confirm the pending label wording does not imply delivery has stopped, and that post-commit forward-secrecy is restored. No automated check gates this.

**MV-3 (relates to AC-PENDING-5 — indefinite pending state):**
If no admin is ever online after a member departs, the pending state persists indefinitely. Automated tests cannot simulate an abandoned sole-admin scenario. Manual verification: confirm the "leave pending" badge remains visible across multiple sessions when `fireAutoCommit` is never triggered.

**MV-4 (AC-PENDING-5 — pending badge survives a page reload):**
Moved to manual validation 2026-06-12 (product-owner decision). The automated e2e test was removed because it has a 2-user catch-22: the badge only *persists* when no admin is online to finalize the removal, but observing the badge and reloading requires an online viewer — and the only non-admin in a 2-user group is the leaver. A faithful automated test needs a 3rd member (offline admin + online non-admin observer), deliberately avoided for e2e reliability. The production logic is verified by the S6 integration examiner. **Manual check:** in a group with ≥2 members besides the admin, take the admin offline, have one member leave, confirm a remaining non-admin member sees the "Departed, cleanup pending" badge, reload that member's page, and confirm the badge re-appears (reconstructed from the re-observed kind-13 on historical sync).
