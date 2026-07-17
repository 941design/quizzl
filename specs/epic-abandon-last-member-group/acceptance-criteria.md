# Abandon Last-Member Group — Acceptance Criteria

## Known TAGs

- **ELIG** — the `isLastMember` / `isSoleAdmin` eligibility predicates.
- **SELECT** — the `selectLeaveModalState` decision function.
- **STRUCT** — module location and export structure.
- **UX** — user-visible modal behavior in `LeaveGroupButton`.
- **COPY** — translation completeness.
- **SEND** — kind-13 / kind-9 send suppression on the abandon path.
- **PURGE** — local-state cleanup on leave.
- **FLOW** — assembled end-to-end abandon flow.
- **BOUND** — module import-boundary invariants.

## Terminology

- **own pubkey** — the caller's hex pubkey, `ownPubkeyHex` in the component,
  `selfPubkeyHex` in `MarmotContext.leaveGroup()`.
- **last member** — the state in which a group's `memberPubkeys` contains
  exactly one entry and that entry is the own pubkey.
- **abandon path** — the code path taken when last member holds: the abandon
  modal, and `leaveGroup()` with both sends suppressed.
- **sole-admin block** — the pre-existing non-dismissible notice rendered when
  `isSoleAdmin` holds, carrying testid `last-admin-blocked-notice`.
- **solo group** — a group whose MLS member list contains only the caller.

## Leave-eligibility predicates (S1)

**AC-ELIG-1** — `isLastMember(['alice'], 'alice')` MUST return `true`.

**AC-ELIG-2** — `isLastMember` MUST return `false` when `memberPubkeys` contains
more than one entry, including when the own pubkey is among them:
`isLastMember(['alice', 'bob'], 'alice')` MUST return `false`.

**AC-ELIG-3** — `isLastMember` MUST return `false` when the single member is not
the own pubkey: `isLastMember(['bob'], 'alice')` MUST return `false`.

**AC-ELIG-4** — `isLastMember` MUST match case-insensitively in both directions:
`isLastMember(['ALICE'], 'alice')` and `isLastMember(['alice'], 'ALICE')` MUST
both return `true`.

**AC-ELIG-5** — `isLastMember` MUST return `false` for each absent-input case:
`memberPubkeys` `undefined`, `memberPubkeys` `[]`, `ownPubkeyHex` `null`, and
`ownPubkeyHex` `undefined`.

**AC-ELIG-6** — Every pre-existing `isSoleAdmin` assertion from
`app/tests/unit/leaveGroupLastAdmin.test.ts` MUST still pass unmodified, except
for its import path, in the renamed `app/tests/unit/leaveEligibility.test.ts`.
`isSoleAdmin`'s return value MUST NOT change for any input.

**AC-STRUCT-1** — `isLastMember`, `isSoleAdmin`, and `selectLeaveModalState`
MUST all be exported from `app/src/lib/marmot/leaveEligibility.ts`, and
`app/src/components/groups/LeaveGroupButton.tsx` MUST NOT export any of them.

## Modal-state decision (S1)

**AC-SELECT-1** — `selectLeaveModalState(['alice'], ['alice'], 'alice')` MUST
return `'abandon'`. This is the epic's load-bearing ordering assertion: the input
satisfies both `isLastMember` and `isSoleAdmin`, so an admin-first implementation
returns `'blocked'` and fails here. It fails on today's code, where the function
does not exist.

**AC-SELECT-2** — `selectLeaveModalState(['alice', 'bob'], ['alice'], 'alice')`
MUST return `'blocked'`.

**AC-SELECT-3** — `selectLeaveModalState(['alice', 'bob'], ['bob'], 'alice')`
MUST return `'confirm'`.

**AC-SELECT-4** — `selectLeaveModalState` MUST NOT return `'abandon'` when
`memberPubkeys` is `undefined`, for any `adminPubkeys` and `ownPubkeyHex`. This
pins the fail-closed contract of Design Decision 6: an unreadable live member
list must never open the destructive path.

## Abandon confirmation modal (S2)

**AC-UX-1** — `LeaveGroupButton` MUST render the `'abandon'` state as an element
carrying testid `abandon-group-notice` showing `copy.groups.abandonGroupBody`,
and an enabled confirm control carrying testid `abandon-group-confirm-btn`. It
MUST render `'blocked'` and `'confirm'` exactly as today
(`last-admin-blocked-notice` / `leave-group-confirm-btn` respectively).
*Verified by AC-FLOW-1* — this is a render assertion, and the unit bucket bans
jsdom, so it has no unit-test vehicle by project convention.

**AC-UX-2** — `LeaveGroupButton` MUST derive the member list it passes to
`selectLeaveModalState` from live MLS state read on modal open via the context's
`getLiveMemberPubkeys`, MUST NOT accept a `memberPubkeys` prop, and MUST pass
`undefined` when that read cannot resolve a member list. *The fail-closed
consequence is unit-asserted by AC-SELECT-4; the wiring itself is a
review-checklist item, per AC-STRUCT-2.*

**AC-UX-4** — `getLiveMemberPubkeys(groupId)` MUST resolve to `undefined` — not
`[]` — when the group cannot be read. `[]` is a member list and would assert
"this group has no members"; `undefined` is the absence of an answer, and only
the latter is unambiguously fail-closed.

**AC-UX-3** — While the `leaveGroup` call triggered by `abandon-group-confirm-btn`
is in flight, that control MUST carry the same `isLoading` treatment the existing
normal-leave confirm uses (`LeaveGroupButton.tsx:119-126`). *Review-checklist item,
per AC-STRUCT-2 — not machine-checked.*

Two earlier drafts of this AC both overclaimed. The first asserted `leaveGroup` is
called "exactly once", which neither bucket observes (the unit bucket cannot mount
the component; e2e cannot count context calls). The second asserted a
disabled-while-pending state "verified by AC-FLOW-1", which AC-FLOW-1 does not
assert — and adding it there would race: the purge can finish in milliseconds and
navigation unmounts the button, so a `toBeDisabled()` check would flake against
detachment. The stakes do not justify a flaky gate: a double-activation re-purges
already-empty stores and re-navigates, and the identical `isLoading` pattern on the
normal-leave confirm has never carried an AC either.

**AC-COPY-1** — `abandonGroupTitle`, `abandonGroupBody`, and
`abandonGroupConfirm` MUST each be declared on the `Copy` type and defined with
a non-empty string in both the `en` and the `de` language object in
`app/src/lib/i18n.ts`.

## Send suppression on the abandon path (S3)

**AC-SEND-1** — When `leaveGroup(groupId)` is called on a solo group, no kind-13
leave-intent rumor and no kind-9 announcement rumor MUST be sent.

**AC-SEND-2** — When `leaveGroup(groupId)` is called on a group with two or more
members, the kind-13 leave-intent and the kind-9 announcement MUST still be
sent, unchanged from current behavior.

## Purge hygiene (S3)

**AC-PURGE-1** — `leaveGroup(groupId)` MUST clear the group's pending join
requests and its invite links, on both the abandon path and the normal leave
path. Both leak today: `clearPendingJoinRequestsForGroup`
(`app/src/lib/marmot/joinRequestStorage.ts:72`) has no production caller, and no
per-group invite-link clear exists at all.

**AC-PURGE-2** — `clearInviteLinksForGroup(groupId)` MUST be exported from
`app/src/lib/marmot/inviteLinkStorage.ts` and MUST delete exactly the links whose
`groupId` matches, leaving other groups' links intact.

## Assembled abandon flow (S4)

**AC-FLOW-1** — A user who creates a group and invites nobody MUST be able to
open the leave modal, activate `abandon-group-confirm-btn`, and arrive at the
group list with the abandoned group absent from it.

The URL assertion MUST be anchored to `/^\/groups\/?$/` — rejecting both the
bare `/\/groups/` substring form and `/groups?id=…` (never navigated away).
`next.config.mjs:22` sets `trailingSlash: true`, so `router.push('/groups')`
(`LeaveGroupButton.tsx:63`) resolves to `/groups/`. The anchored regex MUST be
matched against the URL's **`pathname + search`**, NOT via
`expect(page).toHaveURL(/^\/groups\/?$/)` — Playwright's `toHaveURL(regex)` tests
the regex against the full absolute URL (`http://host/groups/`), so a leading
`^/` anchor can never match there. Match `new URL(page.url()).pathname +
search` against the anchored regex instead (the convention `groups-invite-link`
and `groups-dispatch-isolation` already use). Arrival MUST be gated on a rendered
readiness marker (`groups-empty-state` or `groups-list`), not a fixed wait.

**AC-FLOW-2** — After an abandon completes, reloading the group list MUST NOT
show the abandoned group. This discriminates a purge from a render-state removal.

**AC-FLOW-3** — The spec file MUST be named `groups-abandon-*.spec.ts` so
`playwright.config.ts:36-41` routes it into the relay bucket. The test is
single-user (no second `browser.newContext()`) but still requires the relay:
group creation publishes a KeyPackage. A name outside that glob lands it in the
non-relay bucket, where it would fail for want of infrastructure.

## Cross-Cutting Invariants

**AC-STRUCT-2** — A correct-but-unwired implementation MUST NOT pass this AC set.
AC-ELIG-* and AC-SELECT-* are satisfiable by pure functions nothing calls; the
enforcement that the feature is actually reachable is **AC-FLOW-1**, which drives
a real solo group through the real component and cannot pass unless the live-state
read, the decision function, and the modal are all wired together. This AC is a
review-checklist entry naming that dependency, not an independently machine-checkable
assertion.

**AC-STRUCT-3** — `leaveGroupImpl`'s last-member determination MUST be derived
from the live MLS group state it fetches (`getGroupMembers(mlsGroup.state)`), not
from React state or a value passed in by the caller.

**AC-STRUCT-4** — `app/src/components/groups/LeaveGroupButton.tsx` MUST NOT
reference `@internet-privacy/marmot-ts`, statically or dynamically. The package
is imported in exactly one module today (`MarmotContext`) and always via
`await import(...)`; the live member read reaches the component through the
context, not through a new import site. Machine-checkable via the source-scan
pattern (`fs.readFileSync` + regex, per project convention):
`grep -c "@internet-privacy/marmot-ts" app/src/components/groups/LeaveGroupButton.tsx`
MUST return `0`. This discriminates: the check passes on today's code, and fails
on the most likely wrong implementation of AC-UX-2 (a static
`import { getGroupMembers }` added to the component).

**AC-STRUCT-5** — No `data-testid` in
`app/src/components/groups/LeaveGroupButton.tsx` MUST sit on a `<Modal>` element.
Chakra's `Modal` is a portal wrapper rendering no DOM node, so such a testid is
silently dropped and unqueryable. The pre-existing
`data-testid="leave-group-modal"` on `<Modal>` (line 102) is dead — a repo-wide
grep confirms no spec queries it — and MUST be moved to `<ModalContent>` or
removed. Machine-checkable by source-scan: no line matching `<Modal\b`
(excluding `<ModalContent`, `<ModalOverlay`, etc.) may contain `data-testid`.
This is an adjacent cleanup, not new behavior: its purpose is to stop the broken
pattern being mirrored by the abandon modal.

**AC-BOUND-1** — `app/src/lib/marmot/leaveGroupImpl.ts` MUST have zero imports
from `app/src/context/`; it MUST be a pure Deps-injected implementation,
mirroring the `grantAdminImpl.ts` boundary (spec.md's Technical Approach cites
this exact rule — `grantAdminImpl.ts:1-8` — as why `sendRumorSafe` and
`buildRumor` must be injected as `Deps` fields rather than exported from
`MarmotContext` and imported back). Machine-checkable by source-scan:
`grep -nE "from ['\"](@/src/context|\.\./\.\./context|\.\./context)"
app/src/lib/marmot/leaveGroupImpl.ts` MUST return zero matches. This
discriminates: the check passes on the sibling epic's `grantAdminImpl.ts`
today, and fails on the most likely wrong implementation of the
`sendRumorSafe`/`buildRumor` dependency — exporting them from `MarmotContext`
and importing them back into `leaveGroupImpl.ts`, which is architecture.md's
Boundary Rule 3 violated in practice.

## Manual Validation

| MV id | Behavioral intent | Owner | Blocked on |
|---|---|---|---|
| MV-1 | The German abandon copy reads naturally to a native speaker and fits the modal without overflow at mobile width. Automated ACs assert the key exists and is non-empty; neither can judge the wording. | markus@rotheric.com | S2 complete |
