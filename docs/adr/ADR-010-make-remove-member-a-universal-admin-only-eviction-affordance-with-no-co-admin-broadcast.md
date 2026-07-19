# ADR-010: Make Remove Member a universal admin-only eviction affordance with no co-admin broadcast

**Status**: Proposed  <!-- or: Proposed (when scaffolded via the `proposed` flag or set manually) -->
**Date**: 2026-07-19
**Type**: Lightweight
**Affects**: specs/epic-invite-rescind-and-member-removal, specs/epic-cancel-pending-invitations, specs/epic-feature-request-admin-role-management-for-groups
**Supersedes**: none
**Superseded by**: none

## Context

`epic-invite-rescind-and-member-removal` set out to fix a mislabeled
"Cancel Invite" button that was shown for two different populations
(approved join-requesters still catching up on their profile round-trip,
and directly-invited people who have not yet accepted). Distinguishing
those populations requires a per-admin, local "did I send this direct
invite" marker (persisted in `pendingDirectInviteStorage.ts`, keyed
`groupId:pubkey`).

The marker cannot be reliably synced to co-admins without a new MLS
message type — the epic's first review pass floated broadcasting it to
co-admins so every admin would see the same "Cancel Invite" framing.
That would have introduced a new authorization/metadata-mutation
surface beyond what ADR-003 (LWW for MLS metadata) and ADR-006
(group-member-attested authorization) already cover.

The epic resolved this by making member eviction itself universal
instead: **any admin can remove any in-tree member (pending or
confirmed) via one shared MLS Remove path
(`cancelPendingInvitationImpl`)**, at all times. The marker then only
selects which *label* a given admin sees on that row ("Cancel Invite"
vs "Remove Member") — never whether the removal capability exists. A
co-admin without the marker sees "Remove Member" instead of "Cancel
Invite" on the same pending row, but can still evict them.

This is a decision about the group-membership/admin surface, not just
this one epic: `epic-cancel-pending-invitations` (the epic that
originally added the invite-then-remove machinery this reuses) and the
proposed `epic-feature-request-admin-role-management-for-groups`
(which would restrict who counts as "admin" at all, and explicitly
lists cancel-invitation as one of the admin-gated actions) both operate
on the same "any admin can evict any in-tree member" primitive. Future
work on that surface should build on the universal-eviction model
rather than reintroduce a co-admin-sync mechanism to solve a labeling
problem.

## Decision

Group member eviction is a single, universal, admin-only capability:
any admin can remove any other in-tree member (pending direct invitee
or confirmed member) at any time, via one shared MLS Remove path. A
per-admin local marker (no broadcast, no new MLS message type) governs
**only** which button label and confirm-dialog copy that admin sees on
a given row — "Cancel Invite" (rescind framing) when the marker says
*this admin* sent a still-pending direct invite, "Remove Member"
(eviction framing) otherwise. The marker is cosmetic: losing it, never
having it (co-admin), or a stale value never blocks or unblocks the
underlying removal — it only changes the label.

## Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| Broadcast the pending-direct-invite marker to co-admins (original review-1 direction) | Requires a new MLS application-message type and a new authorization/metadata-mutation model beyond ADR-003/ADR-006, just to keep a button *label* consistent across admins — the underlying removal capability didn't need it. Also leaves a stuck-unremovable gap for any admin without the marker until the broadcast lands. |
| Infer "pending" purely from profile-arrival state (no explicit marker) | Can't distinguish "approved join-requester still catching up" from "directly invited, not yet accepted" — both look identical (in-tree, no confirmed profile) — so the wrong population would get the rescind label (the original defect). |

## Consequences

**Positive**: No stuck-unremovable state — every admin has a working
eviction affordance for every in-tree member, regardless of who sent
the invite or whether any marker exists or synced. No new MLS message
type or authorization model introduced; the change is additive to the
existing remove path.

**Negative**: Co-admins without the marker see a slightly less precise
label ("Remove Member" instead of "Cancel Invite") on a row that, from
the inviting admin's perspective, is really a pending invite. This is
an accepted cosmetic inconsistency, not a functional gap.

**Accepted Risks**: If a future epic (e.g. admin-role-management)
narrows who counts as "admin," this ADR's "any admin" clause narrows
with it automatically — the decision is about the *shape* of the
removal capability (universal among admins, label-only marker), not
about who qualifies as admin.

## Evolution Triggers

- If a future epic needs cross-admin-consistent labeling badly enough
  to justify a new synced-state MLS message type, revisit whether the
  marker should stop being local-only — reopen this ADR rather than
  patching around it.
- If `epic-feature-request-admin-role-management-for-groups` ships and
  changes who can call the shared removal path, confirm this ADR's
  "any admin" language is updated to match rather than left stale.

## References

- Origin: curator-promoted via `base:project-curator` after
  `epic-invite-rescind-and-member-removal` shipped (2026-07-19)
- Related ADRs: ADR-003, ADR-006
- Related specs: specs/epic-invite-rescind-and-member-removal, specs/epic-cancel-pending-invitations, specs/epic-feature-request-admin-role-management-for-groups
