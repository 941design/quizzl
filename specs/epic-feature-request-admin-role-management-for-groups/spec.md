# Feature Request: Admin Role Management for Groups

**Status:** Proposed
**Date:** 2026-06-10
**Type:** Behavior change (group permissions)
**Affected epic context:** builds on `epic-out-of-band-leave`, `epic-group-invite-links`, `epic-cancel-pending-invitations`

---

## 1. Summary

Today, **every member of a group is an admin**. Anyone can invite, accept join
requests, cancel invitations, and (through the out-of-band leave machinery)
finalize member removals. This is a side effect of the app explicitly promoting
every invited member to admin on join.

This feature **restricts admin privileges to the group creator initially**, and
makes admin a privilege the creator (and later, other admins) can **grant** to
individual members. Granting is **one-way and irreversible** — there is no
demote. All membership-mutating actions (invite, accept join request, cancel
invitation, remove/finalize-leave) become **admin-only** going forward.

### What changes for the user

| Actor | Before | After |
|---|---|---|
| Group creator | Admin | Admin (unchanged) |
| Invited member | Auto-promoted to admin on join | Joins as a **regular member** |
| Join-request approver | Any member | **Admin only** |
| "Make admin" action | Did not exist | New per-member button (admin-only), with irreversible-action confirmation |
| Invite / invite-link / manage-links buttons | Enabled for all (all were admin) | Enabled for **admins only** |

This is **forward-only**. Existing groups where everyone is already an admin are
**not** changed — admin is non-revocable, so no demotion occurs. Only members
invited *after* this ships join as regular members. (Decision D2.)

---

## 2. Behavior specification

### 2.1 Initial admin

- On group creation, the **creator is the sole admin**. This already holds today:
  `client.groups.create()` seeds `adminPubkeys` with the creator's pubkey
  (`groups-manager.js:236`). No change required to the create path, but the
  invariant must be protected (AC-INIT-2).

### 2.2 Joining as a regular member

- A member who accepts a welcome (direct invite or via invite link + approved
  join request) joins with **no admin privilege**.
- The **promote-to-admin-on-invite** step is removed (`MarmotContext.tsx:1169–1187`).
  Inviting a member commits the MLS Add only; it no longer appends the invitee to
  `adminPubkeys`.

### 2.3 Granting admin

- In group detail view, an **admin** sees a **"Make admin"** button on each
  **confirmed, non-admin** member's row.
- Pressing it opens a **confirmation dialog** stating the grant **cannot be
  undone**. On confirm, the app commits an MLS `UpdateMetadata` proposal setting
  `adminPubkeys` to the **current admin set plus the target** (superset).
- After the commit lands and propagates, the target member can invite, accept,
  remove, and grant admin to others.
- The button is **not** shown for: the current user themselves, members who are
  already admins, or **pending** (unconfirmed) members. (AC-GRANT-3, AC-GRANT-4.)

### 2.4 Non-revocability (app-enforced invariant)

- There is **no demote / remove-admin** action in the UI.
- The proposal-building path for any `adminPubkeys` update **must reject** a new
  set that is not a **superset** of the live current set (re-read at commit time).
  This guard protects the creator and all existing admins from being dropped by a
  buggy or hostile client. (AC-GRANT-5.)
- **Caveat:** marmot-ts does **not** enforce this — `updateMetadata` does a
  wholesale replace of `adminPubkeys` with no superset constraint and no
  self-protection. Non-revocability is **our** invariant, enforced only within the
  Nostling client. A non-conforming client could still revoke. State this honestly;
  do not claim a protocol guarantee.

### 2.5 Admin-only membership actions

The following become admin-gated (the UI already reads `isAdmin`; with everyone
no longer an admin, the gate now has teeth):

- **Invite member** (`inviteByNpub`)
- **Generate / manage invite links** (Decision D3 — admin-only)
- **Accept / deny join requests** (`approveJoinRequest` / pending requests section)
- **Cancel pending invitation**
- **Finalize member removal / out-of-band leave** (the `fireAutoCommit` Remove
  commit) — already MLS-admin-gated; see §4.1.

### 2.6 Last-admin protection (Decision D1)

- The **last admin of a group cannot leave** until they have granted admin to at
  least one other member.
- When a sole/last admin presses "Leave group", the app **blocks the leave** and
  explains they must make another member an admin first.
- This prevents the bricked-group failure mode in §4.1.

### 2.7 Visibility

- The member list shows an **"Admin" badge** on admin rows so members can see who
  holds privileges (and so a regular member understands why they lack action
  buttons).

### 2.8 Pending-removal visibility (leave / removal pending)

The admin-only finalization in §2.5 lengthens the limbo window between a member
departing and their leaf actually being evicted (§4.1). This state is surfaced
transparently so a stale roster is never mistaken for a live one.

- **Leaving stays unilateral and instant — there is no approval step, ever.** A
  member who leaves emits the kind-13 intent and purges locally; they are gone from
  their own device immediately, regardless of whether any admin is online. This
  feature does **not** gate a member's own exit on admin action.
- **The roster shows a per-member pending state** for any leaf whose eviction
  commit has not yet landed: **"leave pending"** (the member self-left) or
  **"removal pending"** (an admin-side removal is queued — e.g. a cancelled
  invitation, or a future kick). Both are the same underlying limbo with different
  causes.
- **It resolves automatically.** The pending state clears when an admin's
  background `fireAutoCommit` lands. There is no manual "approve" action and none
  is added — "pending" simply means *no admin has yet been online to auto-commit
  the eviction*.
- **The label must stay honest: "departed, cleanup pending" — not "gone."** Until
  the eviction commit lands, the departed leaf's key is still cryptographically
  valid. The departed client has purged, so in practice it is not reading, but the
  copy must not imply message delivery to them has stopped (it has not, at the
  protocol level).
- **It is the observers' view.** The leaver has already left their own device; the
  pending badge exists only in *remaining* members' rosters.
- **Pending may be indefinite.** If no admin ever finalizes (abandoned sole admin,
  §4.1), the state persists indefinitely. The copy must read as "pending, possibly
  indefinitely" and never promise resolution.

The signal already exists — members enqueue observed kind-13 leave intents into the
pending-removal queue (`pendingRemovalsRef`); this is a presentation layer over
that queue. Scope note: this can ship as its own small increment after the core
admin change. It is the legibility companion to §4.1, not a precondition for it.

---

## 3. The decisions this required (resolved)

| ID | Decision | Resolution |
|---|---|---|
| D1 | What happens when the last admin is offline or wants to leave? | **Block last admin from leaving** until they grant admin to another member. |
| D2 | Does the change apply to existing all-admin groups? | **Forward-only.** No demotion, no migration. |
| D3 | Are invite links admin-only too? | **Yes**, consistent with invites. |

---

## 4. Conflicts and caveats

### 4.1 Admin-gated finalization: membership freezes, conversation does not

In MLS/Marmot, **only an admin can commit** any proposal that carries pending
proposals — verified against marmot-ts master:

```
if (!groupData.adminPubkeys.includes(actorPubkey))
  throw new Error("Not a group admin. Cannot commit proposals.");
```

There is also a **receiver-side gate**: members reject inbound non-self-update
commits whose sender is not in `adminPubkeys` (MIP-03). So admin-ness is enforced
on both the committer and every receiver. Restricting the admin set therefore
restricts who can finalize a member departure or removal.

**What this does *not* break: conversation.** A departure never freezes group
chat. The out-of-band leave flow (`epic-out-of-band-leave`) has the departing
member emit a kind-13 leave intent as an **application rumor** — not an MLS
proposal — and then purge locally. Because no MLS proposal is pending, every
remaining member's `unappliedProposals` stays empty and the group **keeps
conversing normally** throughout the limbo window. A remaining admin later
observes the kind-13 and issues the Remove commit via `fireAutoCommit`; that
single commit rotates keys atomically and the group advances one epoch without
interruption.

This is a deliberate design choice. A *standard* MLS leave (`mlsGroup.leave()`)
would instead emit a bare self-Remove **proposal**, and ts-mls **forbids
application messages while `unappliedProposals` is non-empty**
(`MarmotContext.tsx:66`). On that path the entire group would be unable to chat —
and non-admins could not even clear it, since the auto-commit fallback is itself
admin-gated — until an admin committed. The app avoids this freeze precisely by
using the kind-13 out-of-band leave. Do not "fix" leaves to use `mlsGroup.leave()`;
that would reintroduce a whole-group chat freeze on every departure.

**What admin-gated finalization actually costs** is *hygiene*, not liveness:

- **The ghost lingers.** Until an admin's `fireAutoCommit` lands, the departed
  member stays in the MLS roster — member counts are stale and the leaf is not yet
  evicted. Today this resolved in seconds because every member was an admin; under
  creator-only admin the window can be long (until an admin is next online). The
  pending-removal queue retains entries across teardown, so the removal lands
  eventually rather than being lost. §2.8 makes this window legible instead of
  showing a stale, normal-looking member.
- **Forward secrecy is delayed.** The departed leaf's key remains valid until the
  eviction commit, so post-compromise healing for that departure is deferred. The
  departed client has purged, so in practice it is not reading — but that is
  convention, not a cryptographic guarantee (see §2.8).

**The one genuine hard freeze is narrow — and it is membership, never chat.** If
no admin is ever reachable, *membership mutation* stops: no invites, removals,
metadata updates, or further admin grants. If the **sole admin vanishes**
(lost key / abandoned app), that freeze is **permanent** — yet the remaining
members can still chat indefinitely in their current epoch; they simply can never
change membership or heal keys again. **D1 (block last-admin leave) closes the
deliberate sole-admin-leave path.** It does **not** close the lost-key /
abandoned-creator path. Granting admin to a few trusted members early is the only
mitigation, and because grants are non-revocable, those grants are permanent.

The central tradeoff of the feature: tighter control (fewer admins) buys slower
membership hygiene and deferred forward-secrecy healing — **not** a loss of
conversational liveness.

### 4.2 Concurrent grants race on `adminPubkeys` (last-writer-wins)

`updateMetadata` replaces the whole `adminPubkeys` array. Two admins granting to
two different members on the same epoch will conflict at the MLS layer; one commit
wins and the other must retry. **The retry must re-read the live `adminPubkeys`
and re-merge**, or the losing grant silently clobbers the winning one (drops the
just-added admin). The existing invite path already re-reads `mlsGroup.groupData?.adminPubkeys`
at commit time (`MarmotContext.tsx:1173`) — the grant path must follow the same
discipline, and the superset guard (§2.4) must be evaluated against the **live**
set at fire time, not a stale UI snapshot.

### 4.3 Granting admin to a pending (unconfirmed) member

If admin is granted to someone who has been invited but has not yet accepted the
welcome, the metadata update would list a non-member as admin. To avoid this
ordering hazard, the "Make admin" button is restricted to **confirmed** members
(those present in `confirmedPubkeys`). (AC-GRANT-4.)

### 4.4 Forward-only discontinuity

Existing groups carry the old "everyone is admin" state and **keep it** — admin is
non-revocable and demotion is out of scope. So for a transition period, older
groups behave differently from new ones (old: all-admin; new: creator-admin). This
is expected and acceptable per D2, but it means "only admins can invite" will
*appear* to do nothing in legacy groups (because everyone is already an admin).
Surface this in the spec header for testers so they don't read it as a bug.

### 4.5 Invite links create dead-end potential if mis-scoped

Because join-request acceptance is admin-only, an invite link generated by a
non-admin would lead to join requests no one but an admin could accept. D3 keeps
link generation admin-only, which removes this hazard. No dead-end links are
possible under the chosen scope.

### 4.6 marmot-ts maturity

marmot-ts is alpha / pre-1.0 (MIPs at "Review"). The guardrail-free
`updateMetadata` is exactly the kind of surface that may gain validation later. If
upstream adds a superset/self-protection constraint, our app-side guard becomes
redundant but not harmful. Re-check on marmot-ts upgrades.

---

## 5. Acceptance criteria

### Initialization
- **AC-INIT-1** A newly created group lists exactly one admin: the creator.
- **AC-INIT-2** The create path can never produce a zero-admin group (the creator
  is always seeded into `adminPubkeys`).

### Joining
- **AC-JOIN-1** A member who accepts a direct invite joins with no admin privilege
  (`adminPubkeys` does not contain them).
- **AC-JOIN-2** A member approved via invite-link join request joins with no admin
  privilege.
- **AC-JOIN-3** Inviting a member commits the MLS Add only and does not append the
  invitee to `adminPubkeys`.

### Granting
- **AC-GRANT-1** An admin sees a "Make admin" button on each confirmed non-admin
  member row; a non-admin sees no such button on any row.
- **AC-GRANT-2** Confirming "Make admin" commits an `UpdateMetadata` setting
  `adminPubkeys` to the live current set ∪ {target}; after propagation the target
  can perform admin actions.
- **AC-GRANT-3** The "Make admin" button is never shown for the current user or for
  members already in `adminPubkeys`.
- **AC-GRANT-4** The "Make admin" button is never shown for pending (unconfirmed)
  members.
- **AC-GRANT-5** Any `adminPubkeys` update whose new set is not a superset of the
  live current set is rejected before the proposal is built (no demotion path).
- **AC-GRANT-6** The confirmation dialog states the action cannot be undone, and
  closing it without confirming performs no commit.
- **AC-GRANT-7** Two concurrent grants to different members both end up in
  `adminPubkeys` (no clobber): the losing commit retries against the live set and
  re-merges.

### Admin-gated actions
- **AC-GATE-1** A non-admin member sees the Invite, Invite-link, and Manage-links
  controls disabled/hidden, and the pending-join-requests section is not rendered.
- **AC-GATE-2** A non-admin cannot accept or deny a join request.
- **AC-GATE-3** A non-admin cannot cancel a pending invitation.

### Last-admin protection
- **AC-LAST-1** The sole admin of a group is blocked from leaving and shown an
  explanation that they must make another member admin first.
- **AC-LAST-2** Once a second admin exists, the original admin can leave normally,
  and the remaining admin can still finalize removals.

### Visibility
- **AC-VIS-1** Admin members display an "Admin" badge in the member list.

### Removal / leave liveness
- **AC-REMOVE-1** When a member leaves, an online admin finalizes the removal via
  `fireAutoCommit`; a non-admin's `fireAutoCommit` does not commit (and entries
  are retained for an admin to process later).
- **AC-REMOVE-2** The `remainingAdmins` computation in `fireAutoCommit` continues
  to filter departing pubkeys from the live `adminPubkeys` (a departing admin is
  dropped; a departing non-admin is a no-op for metadata).

### Pending-removal visibility
- **AC-PENDING-1** A member can leave with no admin online; their own exit is never
  blocked by the admin-only finalization (unilateral leave preserved).
- **AC-PENDING-2** While a member's eviction commit has not yet landed, remaining
  members see that member in a "leave pending" (self-left) or "removal pending"
  (admin-side removal queued) state in the roster.
- **AC-PENDING-3** The pending state clears automatically when an admin's
  `fireAutoCommit` lands; no manual approval action exists anywhere in the flow.
- **AC-PENDING-4** Remaining members can send and receive messages normally while
  another member is leave/removal pending (conversation is not frozen).
- **AC-PENDING-5** The pending state survives a page reload during limbo
  (reconstructed from the re-observed kind-13 leave intent on historical sync).
- **AC-PENDING-6** The pending label conveys "departed, cleanup pending" and does
  not assert the member is blocked from receiving messages.

---

## 6. Implementation pointers (non-binding)

- **Remove auto-promote:** delete the promote-to-admin block at
  `app/src/context/MarmotContext.tsx:1169–1187` (and drop the
  `admin_promotion_failed` warning plumbing it feeds). `approveJoinRequest`
  (→ `inviteByNpub`) inherits this automatically.
- **New context method:** `grantAdmin(groupId, pubkey)` on `MarmotContext`,
  mirroring `inviteByNpub`'s commit discipline: re-read live `adminPubkeys`,
  evaluate the superset guard, build `Proposals.proposeUpdateMetadata`, single
  `commit()`, bump `groupDataVersion`, `reloadGroups`, `markBackupDirty`.
- **UI:** add the "Make admin" button + confirmation modal to
  `app/src/components/groups/MemberList.tsx` (pattern already present for
  "Cancel invite"). Pass `isAdmin`, `adminPubkeys`, and a `onMakeAdmin` handler
  from `app/pages/groups.tsx`. Add the "Admin" badge there too.
- **Last-admin guard:** in `LeaveGroupButton` / `leaveGroup`, block when the
  current user is the only entry in `adminPubkeys`.
- **Pending-removal badge (§2.8):** derive a per-member pending state from the
  existing `pendingRemovalsRef` queue (kind-13 intents already populate it) and
  render it as a "leave / removal pending" badge in `MemberList.tsx`, alongside the
  existing "pending" (unconfirmed invite) badge — keep the two states visually
  distinct. No new commit path; this is presentation only.
- **i18n:** add `en` + `de` keys for: make-admin button, confirm dialog
  (title / body / confirm / cancel), admin badge, last-admin-leave-blocked
  message, and the leave/removal-pending badge label. Per `CLAUDE.md`, no
  hardcoded strings — extend the `Copy` type and both language objects in
  `app/src/lib/i18n.ts`.
- **Tests:** e2e must drive grants/invites through the app (two browser contexts),
  never raw WebSocket to strfry (per `CLAUDE.md` and `feedback_e2e_no_direct_relay`).
  Cover: invited member is non-admin; grant makes them admin; non-admin sees no
  action buttons; last-admin leave is blocked; concurrent-grant no-clobber.

---

## 7. Out of scope

- Demotion / revoking admin (contradicts the non-revocable invariant).
- Retroactive demotion of members in existing all-admin groups.
- Role tiers beyond the binary admin / member (e.g. moderators).
- **Approval-gated leave.** A member's own exit is never gated on admin approval;
  the pending state in §2.8 is informational only. A two-phase "request to leave"
  is explicitly rejected (it would break the right to exit and let a departed-but-
  not-evicted member keep reading under a misleading label).
- Recovering a group whose sole admin lost their key or abandoned the app
  (mitigation is to grant admin proactively; no recovery mechanism exists).

---

## Amendments

## Constrained by ADRs

- **ADR-003** — Accept last-writer-wins for MLS metadata mutations (no protocol-level no-clobber in marmot-ts).
- **ADR-010** — Make Remove Member a universal admin-only eviction affordance
  with no co-admin broadcast. Whatever this feature settles for "who is an
  admin," the removal capability stays universal among whoever qualifies —
  this ADR's "any admin can evict any in-tree member, marker is label-only"
  shape should not be re-litigated when scoping admin-gated actions here.

### 2026-06-11 — AC-GRANT-7 reduced to last-writer-wins (concurrent grant)

**Trigger:** During S3 implementation, the cross-vendor Codex review plus an
authoritative marmot-ts/ts-mls source investigation (marmot-researcher)
established that §4.2's premise is false. §4.2 assumed two admins granting at the
same MLS epoch produce a *synchronous* conflict — "one commit wins and the other
must retry" — so a `try/catch` around `commit()` could detect the loss and retry.

**Finding:** marmot-ts `commit()` has no relay awareness. Both concurrent
committers succeed locally and advance to their own epoch N+1. The fork is only
detected later, on the *receiving* side, inside `ingest()`: a foreign epoch-N
commit arriving after local state has advanced to N+1 fails the epoch check
(`processCommit` → `ValidationError`) and is dropped as `unreadable`. The losing
admin never learns its grant was superseded. A catch-based retry around `commit()`
therefore never fires for the realistic concurrent case, and one grant is silently
clobbered while both callers see `{ ok: true }`.

**Decision (product owner, 2026-06-11):** Accept as a known limitation rather than
build a `stateChanged`-driven re-grant subsystem. This is consistent with the
spec's existing honesty posture — §2.4 (non-revocability is a client-only
invariant, not a protocol guarantee) and §4.6 (marmot-ts is alpha).

**Effect on AC-GRANT-7:** Rewritten from "both targets MUST end up in adminPubkeys;
the losing commit retries and re-merges" to: concurrent same-epoch grants are
last-writer-wins; a losing grant may be silently dropped, and the granting admin
re-issues it after observing the target's Admin badge did not appear. The grant
path still re-reads the live adminPubkeys at fire time and re-merges the target
(preventing clobber whenever the live read already reflects the other grant), and
still performs one catch-based retry for the rare case where `commit()` DOES throw
synchronously (e.g. local unapplied proposals) — but no protocol-level no-clobber
is claimed. The narrowed testable invariant: (a) live-set re-read at fire time,
(b) single catch-based retry on a synchronous throw.

**Not done:** The `stateChanged`-driven read-check-re-grant loop (the only true
no-clobber mechanism) is explicitly out of scope. If concurrent-grant robustness
becomes a real need, that loop — tracking intended grants and re-issuing on epoch
advance when the target is absent from adminPubkeys — is the correct design, and
it should be specced as its own increment.
