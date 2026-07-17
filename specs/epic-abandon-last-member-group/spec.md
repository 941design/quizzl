# Abandon Last-Member Group

**Status**: Implemented 2026-07-17

## Problem

A user who is alone in a group cannot get rid of it. The group sits in their
group list forever.

`LeaveGroupButton` guards leaving with `isSoleAdmin()`
(`app/src/components/groups/LeaveGroupButton.tsx:24`): when the caller is the
only admin, the confirm-leave path is replaced by a blocked notice reading
*"You are the only admin. Grant admin to another member before leaving."*

That guard is correct when other members exist — an admin walking out would
strand them in a group where nobody can commit removals, approve join
requests, or promote a new admin. But it fires on a case where its own
rationale does not apply: the user who is the **only member**. There is nobody
to strand, and the remedy the notice suggests is impossible — there is no other
member to grant admin to. The user is told to perform an action that cannot be
performed, and the group becomes permanently undeletable.

This is reachable through ordinary use: create a group and never invite anyone;
or be the last person remaining after everyone else has left.

## Solution

Recognise last-member as its own case, distinct from sole-admin, and let the
user abandon the group.

When the caller is the only member of a group, leaving is unconditionally safe:
no MLS Remove proposal is needed (nobody is blocked by an unapplied proposal),
no admin succession is needed (nobody remains to be governed), and no departure
needs announcing (nobody remains to hear it). Leaving collapses to what
`leaveGroup()` already does — purge local state and navigate away — with the
sends skipped as dead weight.

Because the group ceases to exist for everyone when its last member leaves, the
confirmation is framed as **abandoning**, not leaving, and states the
irreversibility plainly.

### Why member count is the whole rule

The condition is `memberPubkeys.length === 1`. Two properties make that
sufficient on its own — but they do not hold for the same reason, and the
difference matters:

- **It implies zero pending invitees — structurally.** An invitee enters the MLS
  ratchet tree at invite time, via the Add commit, not at accept time.
  `memberPubkeys` is `getGroupMembers(mlsGroup.state)`
  (`app/src/context/MarmotContext.tsx:1539`), the MLS member list, so a pending
  invitee already counts toward the length. This is not incidental: the codebase
  *defines* a pending member as one who is in `getGroupMembers` but has no
  profile (`isPendingMemberImpl`, `app/src/lib/marmot/cancelInvitationImpl.ts:36`).
  A group with an outstanding invitation has `length >= 2` and never reaches the
  abandon path.
- **It implies sole-admin — by discipline, not structure.** `adminPubkeys` is
  app-level `groupData` metadata, not derived from the ratchet tree. It stays a
  subset of the member list only because every Remove commit pairs the removal
  with a metadata filter (`cancelInvitationImpl.ts:68-93`;
  `MarmotContext.tsx:223-229`). If that discipline ever slipped — a lone member
  with a ghost left in `adminPubkeys` — `isSoleAdmin` would return `false`. The
  failure is benign: `selectLeaveModalState` tests last-member first, so the
  abandon path is reached on member count alone and never depends on this
  property holding. It justifies the ordering (Design Decision 2); it does not
  gate correctness.

The first property is what makes a separate "are invitations pending?" check
unnecessary: the scenario it would guard against — an invitee accepting into a
group whose admin has vanished — cannot occur, because the invitation's
existence takes the group out of the abandon path by construction.

## Scope

### In Scope

- An `isLastMember()` predicate and a `selectLeaveModalState()` decision
  function, the latter testing last-member before the existing `isSoleAdmin()`
  guard.
- A third modal state in `LeaveGroupButton`: an abandon confirmation with its
  own copy, distinct from both the normal leave modal and the sole-admin
  blocked notice, decided from live MLS state.
- `en` + `de` copy for the abandon modal.
- Extracting `leaveGroupImpl` from `MarmotContext` so leave behavior is testable
  under this project's conventions.
- Skipping the kind-13 leave-intent and kind-9 announcement sends in
  `leaveGroup()` when the caller is the group's last member.
- Clearing pending join requests and invite links in the purge, and adding the
  `clearInviteLinksForGroup` needed to do it.
- Unit coverage for the predicates, the decision function, and the impl; e2e
  coverage for the abandon flow.

### Out of Scope

- Changing sole-admin behavior when other members remain. The block stays as-is;
  granting admin before leaving is still the required path there.
- Admin succession (auto-promoting a member when the last admin leaves). A
  group with `length >= 2` and one departing admin is a different problem with a
  different answer.
- Removing the departing member's ghost leaf. There is no remaining member to
  observe it, and no admin to commit the removal.
- Blocking abandon on outstanding invite links (see Design Decision 4). The
  links are cleared locally, but their existence does not gate the flow.
- **The sole-admin-plus-pending-invitee case.** A solo creator whose one
  invitee never accepts has `length === 2`, so they get the sole-admin block and
  its advice — "grant admin to another member" — where the only other member is
  a pending invitee who cannot be granted anything. The escape exists (cancel the
  invitation, then abandon) but is undocumented and two steps. This is the same
  class of defect as the one this epic fixes, at a different member count; it is
  not fixed here because the fix is different (guide the user to cancel, or offer
  it inline) and the ask was scoped to the last-member case.

## Constrained by ADRs

- **ADR-003** (Proposed, project-wide) — accepts last-writer-wins for MLS
  metadata mutations; `updateMetadata` has no compare-and-set and silently
  overwrites. This is the ADR-level statement of why `adminPubkeys` is a subset
  of the member list *by discipline, not structure* (see Solution), and why the
  abandon path must not depend on that property holding.

## Design Decisions

1. **The condition is `memberPubkeys.length === 1`, verified against own
   pubkey.** Length alone is sufficient in a well-formed group — the sole leaf of
   *my* group state is me. The predicate additionally requires that the single
   member match `ownPubkeyHex`, so a corrupt or mis-scoped group state fails
   closed to the existing blocked path rather than opening the destructive one.
   Comparison is case-insensitive, matching `isSoleAdmin()`
   (`app/src/components/groups/LeaveGroupButton.tsx:29`).

2. **Last-member is tested before sole-admin.** A last member is always also a
   sole admin, so the checks overlap and order decides the outcome. Testing
   sole-admin first would let the existing block swallow the new case and the
   feature would silently not exist. This ordering is the load-bearing detail of
   the change and is pinned by its own AC.

3. **The whole modal decision moves to `app/src/lib/marmot/leaveEligibility.ts`,
   not just the predicates.** The module exports `isLastMember`, `isSoleAdmin`
   (moved), and `selectLeaveModalState(memberPubkeys, adminPubkeys, ownPubkeyHex)
   → 'abandon' | 'blocked' | 'confirm'`. The component reduces to rendering the
   returned state.

   Exporting only the two predicates and leaving the selection as inline booleans
   in the component would put the epic's load-bearing rule — the ordering in
   Design Decision 2 — somewhere the test conventions cannot reach it. This
   project bans jsdom and `@testing-library` (`app/tests/unit/**` tests pure
   extractions only), so an inline `const blocked = !lastMember && …` is
   unassertable: every predicate test could pass while the ordering is inverted
   and the feature silently does not exist. Extraction is what gives AC-SELECT-1
   a test vehicle. Precedent: `cancelInvitationImpl.ts`, `grantAdminImpl.ts`.

4. **An outstanding invite link does not block abandoning.** A link is not
   membership; redeeming one produces a join *request* an admin must approve, so
   with no admin left the request is never approved and no group is ever created
   for the requester. The link fails closed.

   The tradeoff this accepts, stated rather than hidden: the *requester* is not
   protected, only the group. Someone redeeming a link into an abandoned group
   waits indefinitely with no feedback, exactly as they would for an inattentive
   admin. Distinguishing "abandoned" from "slow" would require an on-relay
   signal this epic explicitly does not add (see Non-Goals).

5. **The abandon path skips the kind-13 and kind-9 sends.** Both are addressed to
   the group; with no other member, no consumer exists — the only kind-13 reader
   is the admin-side auto-remove queue. `leaveGroup()` already treats both sends
   as best-effort and proceeds to purge on failure
   (`app/src/context/MarmotContext.tsx:1590`), so skipping them changes nothing
   observable for a remaining member — there is none. It removes two
   guaranteed-pointless relay round-trips, including `sendRumorSafe`'s retry loop.

   Caveat, accepted: "no consumer" is true per-identity, not per-device. A second
   device holding a restored backup of the same solo group is a same-identity MLS
   clone that could have decrypted the kind-13. Skipping the send removes that
   incidental cleanup signal, so the group lingers on device B until its next
   restore. Acceptable — the kind-13 was never a device-sync mechanism, and
   relying on it as one would be the actual bug.

6. **The abandon decision is made from live MLS state, re-derived at modal open.**
   This is a correction to an earlier draft of this spec, which gated only the
   *sends* on live state and claimed that protected the purge. It does not: the
   purge in `leaveGroup()` runs unconditionally
   (`app/src/context/MarmotContext.tsx:1607`), and the destructive choice —
   abandon versus block — is made in the component, from React-state
   `group.memberPubkeys`.

   A stale-overlay window is real. `inviteByNpub` adds the invitee's leaf at
   `MarmotContext.tsx:1531` but persists the refreshed member list only at 1541;
   a crash between them, or a fresh session before the subscribe-time resync
   (1233-1259) lands, leaves stored `memberPubkeys = [self]` while the tree holds
   two leaves. On props alone the user would be shown "you are the last member",
   the sole-admin block would be bypassed, and a real member would be stranded —
   the exact harm that block exists to prevent.

   So `LeaveGroupButton` re-derives members via the context's existing `getGroup`
   on open and decides from that. **It fails closed:** if live state cannot be
   read, `selectLeaveModalState` receives no member list, `isLastMember` returns
   `false` per AC-ELIG-5, and the user gets the pre-existing block — never the
   destructive path.

   **What this closes, and what it does not.** It closes overlay-vs-local-state
   staleness — the reachable single-device window described above. It does not
   close local-vs-network staleness, which is only reachable via the same
   multi-device case Design Decision 5 already concedes: a restored-backup clone
   of this identity commits an Add that this device has not yet ingested when the
   modal opens. That residual is acceptable on its own terms, not merely tolerated:
   single-device, the only member is the only possible committer, so nothing can
   move the tree under an open modal; and in the clone scenario an abandon strands
   nobody, because device B's copy stays intact with B as admin, so a later invitee
   still lands in a functioning group. The opposite race — a peer leaving while
   `'confirm'` is displayed — fails safe because `leaveGroupImpl` re-derives at
   execution time (AC-STRUCT-3).

7. **The two live reads are independent re-derivations, and their fail-closed
   defaults are deliberately opposite.** The flow reads live state twice: once in
   the component on modal open (to pick the modal), once inside `leaveGroupImpl`
   at execution (to decide send-skip, AC-STRUCT-3). These are two reads at two
   times, not one snapshot threaded through. Piping the modal-open read into
   `leaveGroupImpl` as a parameter would look equivalent on the single-device happy
   path and would violate AC-STRUCT-3 — it is what makes the "peer leaves while the
   confirm modal is displayed" race fail safe.

   The two sites fail closed in **opposite directions**, because their stakes are
   opposite, and a later "harmonization" would silently break one of them:

   | Site | Read fails | Default | Why that direction is safe |
   |---|---|---|---|
   | Modal (`selectLeaveModalState`) | members `undefined` | `isLastMember → false` ⇒ `'blocked'`/`'confirm'` | Never opens the destructive path on an unknown membership. |
   | Impl (`leaveGroupImpl`) | no `mlsGroup` | `lastMember → false` ⇒ **send anyway** | Worst case is a redundant send into an empty group. Defaulting to *skip* would silence a real departure if a peer existed. |

   Both defaults are `false`; they are safe for different reasons. Do not "unify"
   them into a shared helper that picks one direction.

8. **The purge clears pending join requests and invite links.** Both are
   currently leaked: `clearPendingJoinRequestsForGroup` exists
   (`app/src/lib/marmot/joinRequestStorage.ts:72`) with no production caller, and
   `inviteLinkStorage` has no per-group clear at all — only `deleteInviteLink`
   (also uncalled) and `clearAllInviteLinks`. `leaveGroup()`'s purge touches
   neither, so today every leave orphans them in IndexedDB permanently.

   This is a pre-existing gap, but abandon is the case that makes it acute: a
   solo admin is precisely the user most likely to hold outstanding links and
   requests, and after abandoning there is no group left through which to reach
   them. Fixing it in the shared purge sequence fixes it for normal leave too.

   Clearing the links is load-bearing, not merely tidy. `handleJoinRequest`
   resolves the incoming nonce against stored links and drops the request when
   none is found (`app/src/lib/marmot/joinRequestHandler.ts:76-77`). Clearing the
   links therefore makes post-abandon join requests for that group discard at the
   door; leaving them behind means every later redemption of a dead link
   accumulates an orphaned pending request against a group that no longer exists.

   Widening this to the normal-leave path is safe — every consumer was checked.
   `ManageInviteLinksModal` is per-group and unreachable once the group is gone;
   `relayBackup.ts:150` reads `loadAllInviteLinks`, and the purge already calls
   `markBackupDirty`, so the backup is re-uploaded consistently without the
   group's links; and a non-admin holds no links for the group at all, since link
   creation is admin-gated (`app/pages/groups.tsx:407`), making the clear a no-op
   for them.

   **Residual, named rather than fixed.** The existing purge
   (`MarmotContext.tsx:1607-1618`) is a flat sequence of unguarded `await`s across
   independent IDB stores — only the two *sends* are wrapped, because sends are the
   only steps expected to fail. Appending the two new clears inherits that: an IDB
   error mid-sequence throws, and the later steps — including the leak-fixing calls
   this epic adds — never run. So the leak closes on every normal path and stays
   open on the partial-purge path. This is pre-existing and out of scope (making
   the purge fault-tolerant is its own change with its own idempotency questions),
   but it is the one place where "append two more awaits" does not fully close what
   the epic charters. Recorded so it is a known residual rather than a silent gap.

## Technical Approach

### `app/src/lib/marmot/leaveEligibility.ts` (new)

Pure, unit-tested. Owns the whole modal decision, not just the predicates
(Design Decision 3).

```ts
export type LeaveModalState = 'abandon' | 'blocked' | 'confirm';

/** True when ownPubkeyHex is the group's only member. Case-insensitive. */
export function isLastMember(
  memberPubkeys: string[] | undefined,
  ownPubkeyHex: string | null | undefined,
): boolean {
  if (!ownPubkeyHex || !memberPubkeys || memberPubkeys.length !== 1) return false;
  return memberPubkeys[0].toLowerCase() === ownPubkeyHex.toLowerCase();
}

/** True when ownPubkeyHex is the only member in adminPubkeys. Case-insensitive. */
export function isSoleAdmin(/* moved verbatim from LeaveGroupButton.tsx */) { … }

/**
 * The epic's load-bearing rule. Last-member is tested FIRST: a last member is
 * always also a sole admin, so admin-first ordering swallows the abandon case
 * entirely (Design Decision 2). Absent/unreadable memberPubkeys fails closed to
 * 'blocked' or 'confirm' — never to 'abandon'.
 */
export function selectLeaveModalState(
  memberPubkeys: string[] | undefined,
  adminPubkeys: string[] | undefined,
  ownPubkeyHex: string | null | undefined,
): LeaveModalState {
  if (isLastMember(memberPubkeys, ownPubkeyHex)) return 'abandon';
  if (isSoleAdmin(adminPubkeys, ownPubkeyHex)) return 'blocked';
  return 'confirm';
}
```

### `app/src/components/groups/LeaveGroupButton.tsx`

Reduces to rendering the state `selectLeaveModalState` returns. On open it
re-derives the authoritative member list from live MLS state (Design Decision 6)
rather than trusting a prop:

```tsx
async function handleOpen() {
  // Fails closed: undefined members ⇒ selectLeaveModalState can never
  // return 'abandon' (AC-SELECT-4).
  setLiveMembers(await getLiveMemberPubkeys(groupId));
  onOpen();
}

const modalState = selectLeaveModalState(liveMembers, adminPubkeys, ownPubkeyHex);
```

The component MUST NOT import `@internet-privacy/marmot-ts` to do this. The
actual layering rule — an earlier draft of this spec stated it wrongly, claiming
the package was imported in exactly one module and never statically:

- **`app/src/lib/marmot/` imports it freely**, statically for types and pure
  values (`applicationRumorDispatcher.ts:40`, `groupStorage.ts:12`,
  `NdkNetworkAdapter.ts:16`, `epochResolver.ts:16`, `welcomeSubscription.ts:23`).
  That layer *is* the marmot integration boundary; importing marmot-ts is its job.
- **`MarmotContext.tsx` imports it only dynamically** — every one of its ten
  import sites is `await import(...)` (644, 702, 926, 1238, 1536, 1716, 1741,
  1795, 1825, 1871); there is no static import in that file.
- **Components do not import it at all** — with one pre-existing exception,
  `IncomingCallWatcher.tsx:104`, which dynamic-imports `getGroupMembers` to read
  live members for call routing. That is a violation, not a sanctioned precedent;
  do not cite it to justify a second one.

`getLiveMemberPubkeys` exists so this epic adds no new component import site.
AC-STRUCT-4's check is narrow by design — it greps only `LeaveGroupButton.tsx`,
which has zero references today — so it holds regardless of the layering
subtleties above.

**Testid placement — do not mirror the existing modal.** Chakra's `<Modal>` is a
portal wrapper that renders no DOM node of its own; a `data-testid` on it is
silently dropped, with no runtime warning, and a Playwright `getByTestId` against
it times out while the modal is genuinely open. This component already has that
bug — `data-testid="leave-group-modal"` sits on `<Modal>` (line 88) and has never
been caught because no spec queries it. The abandon modal's testids
(`abandon-group-notice`, `abandon-group-confirm-btn`) therefore go on the `Text`
and `Button` — components that render real DOM — exactly as the existing
`last-admin-blocked-notice` and `leave-group-confirm-btn` already do. Do not copy
the `<Modal>`-level testid as a pattern. Fixing the pre-existing dead testid by
moving it to `<ModalContent>` is in scope as an adjacent cleanup (AC-STRUCT-5).

### `app/src/context/MarmotContext.tsx`

Expose the live read the button needs, keeping the marmot-ts dependency inside
the context where every other use of it already lives:

```ts
/** Live MLS member list for a group, or undefined when it cannot be read. */
getLiveMemberPubkeys: (groupId: string) => Promise<string[] | undefined>;
```

It wraps the existing `getGroup` (line 1655, already null-safe and
throw-catching) and the same dynamic `getGroupMembers` import used at 1536.
Returning `undefined` rather than `[]` on failure is deliberate: `[]` is a
member list, `undefined` is the absence of one, and only the latter is
unambiguously fail-closed.

`'abandon'` renders the new modal — the same destructive-confirm shape as the
normal leave modal (cancel + loading-state confirm calling `handleLeave`), with
abandon copy and testids `abandon-group-notice` / `abandon-group-confirm-btn`.
`'blocked'` and `'confirm'` render exactly as today.

No `memberPubkeys` prop is added: live state is the only source for this
decision, so a prop would be a second, staler path to the same answer.

### `app/pages/groups.tsx`

Unchanged. The call site at line 422 already passes everything needed.

### `app/src/context/MarmotContext.tsx` → `app/src/lib/marmot/leaveGroupImpl.ts` (new)

`leaveGroup` (line 1574) becomes a thin context wrapper over an injected-deps
`leaveGroupImpl`, matching `cancelInvitationImpl.ts` / `grantAdminImpl.ts`. This
is what gives AC-SEND-1/2 and the purge ACs a unit-test vehicle; as a context
callback the behavior is unreachable under this project's test conventions.

Follow `grantAdminImpl` rather than `cancelInvitationImpl` where they differ:
it takes **zero** top-level `marmot-ts` imports (everything Deps-injected), which
is why `grantAdminImpl.test.ts` needs no `vi.mock('@internet-privacy/marmot-ts')`
at all. Its live-re-read discipline (`getGroup` re-fetched on every attempt,
`grantAdminImpl.ts:50-53, 74-76`) is the same discipline AC-STRUCT-3 requires here.

**One dep has no precedent.** `sendRumorSafe` and `buildRumor` are module-level
*private* functions inside `MarmotContext.tsx` (lines 93-117 and 120-130) — not
marmot-ts exports. Both precedent impls only ever inject marmot-ts-shaped things,
so hoisting a context-private helper into a `Deps` field is new here. Inject them
rather than exporting them from the context and importing them back: an impl that
imports from `app/src/context/` would violate the zero-context-imports boundary
`grantAdminImpl.ts:1-8` states explicitly (AC-BOUND-1 in its own epic).

Behavior changes inside the extracted impl:

```ts
// Live state — not props, not React state (DD-6).
const lastMember = mlsGroup
  ? isLastMember(deps.getGroupMembers(mlsGroup.state), selfPubkeyHex)
  : false;

if (mlsGroup && selfPubkeyHex && !lastMember) {
  // existing kind-13 leave-intent + kind-9 announcement sends
}

// purge sequence — unconditional, as today, plus (DD-7):
await deps.clearPendingJoinRequestsForGroup(groupId);
await deps.clearInviteLinksForGroup(groupId);
```

### `app/src/lib/marmot/inviteLinkStorage.ts`

Add `clearInviteLinksForGroup(groupId)`. The module has `loadInviteLinks(groupId)`
and `deleteInviteLink(nonce)` but no per-group clear, which is why the purge
cannot currently reach them.

### `app/src/lib/i18n.ts`

Three keys on `Copy['groups']`, in `en` and `de`:

| key | en | de |
|---|---|---|
| `abandonGroupTitle` | `Abandon Group?` | `Gruppe auflösen?` |
| `abandonGroupBody` | `You are the last member. Leaving deletes this group permanently. It cannot be recovered.` | `Du bist das letzte Mitglied. Wenn du die Gruppe verlässt, wird sie endgültig gelöscht und kann nicht wiederhergestellt werden.` |
| `abandonGroupConfirm` | `Abandon Group` | `Gruppe auflösen` |

### `app/tests/unit/leaveGroupLastAdmin.test.ts` → `leaveEligibility.test.ts`

Import moves to the new module; existing `isSoleAdmin` cases stay as-is (the
predicate's behavior does not change, only its location). Renamed because the
file now covers the module's three exports, not just the last-admin guard.

## Stories

- **S1 — leave-eligibility module** — Create `leaveEligibility.ts` with
  `isLastMember`, `selectLeaveModalState`, and `isSoleAdmin` moved in; repoint
  and rename the existing unit test. Covers AC-ELIG-1, AC-ELIG-2, AC-ELIG-3,
  AC-ELIG-4, AC-ELIG-5, AC-ELIG-6, AC-SELECT-1, AC-SELECT-2, AC-SELECT-3,
  AC-SELECT-4, AC-STRUCT-1.
- **S2 — abandon confirmation modal** — `LeaveGroupButton` renders the state
  `selectLeaveModalState` returns; new `getLiveMemberPubkeys` on `MarmotContext`
  for fail-closed live-state re-derivation on open; `en`/`de` copy; move the dead
  `<Modal>`-level testid to `<ModalContent>`. Covers AC-UX-1, AC-UX-2, AC-UX-3,
  AC-UX-4, AC-COPY-1, AC-STRUCT-4, AC-STRUCT-5.
- **S3 — leaveGroupImpl extraction, send skip, purge hygiene** — Extract
  `leaveGroupImpl` with injected deps; gate the kind-13/kind-9 sends on live
  last-member state; add `clearInviteLinksForGroup` and wire both it and
  `clearPendingJoinRequestsForGroup` into the purge. Covers AC-SEND-1, AC-SEND-2,
  AC-PURGE-1, AC-PURGE-2, AC-STRUCT-3, AC-BOUND-1.
- **S4 — e2e abandon flow** — `groups-abandon-last-member.spec.ts` in the
  groups/relay bucket: single-user, create-group-invite-nobody, abandon, assert
  gone after reload. Covers AC-FLOW-1, AC-FLOW-2, AC-FLOW-3.

AC-STRUCT-2 is deliberately unowned by any story: it is a cross-cutting
review-checklist entry asserting that the AC set as a whole is not satisfiable by
an unwired implementation, and names AC-FLOW-1 as the enforcement. It is not
independently machine-checkable and has no implementation work of its own.

## Acceptance Criteria

See [`acceptance-criteria.md`](./acceptance-criteria.md).

## Relationship to Other Epics

- **`epic-out-of-band-leave` (DONE)** — built the kind-13 leave-intent + admin
  auto-remove protocol that `leaveGroup()` drives today, and explicitly scoped
  out *"removing the ghost leaf from groups whose only remaining members are
  non-admins"*. This epic addresses the adjacent gap that epic left open: the
  group with no remaining members at all. It consumes that epic's send path and
  adds one bypass; it does not modify the protocol.
- **`epic-feature-request-admin-role-management-for-groups`** — owns `grantAdmin`,
  the escape hatch the sole-admin block tells users to take. That block and its
  advice remain correct for every group this epic does not touch (`length >= 2`).
- **`epic-cancel-pending-invitations` (DONE)** — established that a pending
  invitee occupies an MLS leaf before accepting, which is what makes the
  invitee-stranding scenario unreachable at `length === 1` (see Solution).

## Non-Goals

- **No group deletion protocol.** Abandoning is a local purge. There is no MLS
  or Nostr "group deleted" event, because there is no recipient for one — and by
  extension no way for a link-holder to learn a group was abandoned rather than
  merely unattended (Design Decision 4).
- **No undo.** The purge is irreversible by design, which is what the abandon
  copy tells the user. A trash/restore affordance is not the product direction.
- **No relaxation of the sole-admin block for populated groups.** An admin
  leaving members behind must still hand over admin first.

## Amendments

- **2026-07-17** — Tightened `AC-FLOW-1` (URL-assertion mechanism). Source: S4 e2e implementation. Rationale: the original AC text prescribed `/^\/groups\/?$/` without specifying HOW to match it; `expect(page).toHaveURL(/^\/groups\/?$/)` is unimplementable because Playwright matches the regex against the full absolute URL, so the `^/` anchor never matches. Amended to require matching the anchored regex against `pathname + search` (the convention two existing specs already use). The AC's intent — reject `/groups/?id=…` as a false arrival — is unchanged.
- **2026-07-17** — Status → Implemented. All four stories completed, reviewed (Opus Stage-1), and verified. S3 review surfaced and fixed one real defect (F1: unguarded `getGroupMembers` throw could skip the purge, reintroducing the undeletable-group failure). MV-1 (German copy) signed off by the user. Pre-ship gates (mutation, full e2e, final cross-vendor Codex) deferred due to host file-descriptor exhaustion, not code — user-authorized ship; the feature's own e2e passed 3/3 and the epic + dependent unit tests are green. Deferred gates recorded in `epic-state.json#gate_runs`.
