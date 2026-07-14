# Invite Group Member from Contacts — Acceptance Criteria

## Terminology

- **contact picker** — the `<Select>` (testid `invite-contact-select`) in
  `InviteMemberModal.tsx` that replaces the removed npub free-text `Input`.
- **picker path** — the invite flow driven entirely through the contact
  picker, as opposed to the removed npub free-text/QR-scan path.
- **selectable contact** — a `ContactListItem` (from `listContacts`,
  `app/src/lib/contacts.ts`) for which the new "selectable contacts for a
  group" predicate returns `selectable: true`.
- **already-member** — a contact whose `pubkeyHex` matches, case-
  insensitively, an entry in the current group's `memberPubkeys`.
- **blocked** — a contact with `isArchived === true` (`archivedAt != null`),
  per ADR-008.
- **guidance state** — the empty-state message plus `/contacts` link
  rendered by `InviteMemberModal.tsx` in place of the contact picker when no
  contact is selectable.
- **pending contact** — a contact previously invited to the current group
  who has not yet joined. `group.memberPubkeys` updates synchronously when
  `inviteByNpub` succeeds (the MLS commit itself adds them), before the
  invitee accepts — so a pending contact IS `already_member` for the
  purposes of AC-ERR-1, and is treated identically to any other
  already-member contact: disabled, "already in group" (DD-4, corrected
  post-implementation via live e2e testing).

## Behavioral vs. Structural Observables

When authoring acceptance criteria, the **Observable** of each AC must assert
*externally-visible behavior* — not merely the existence or shape of a
path/file/type/field/schema/log line.

**Litmus test:** *Could a stub / placeholder / no-op satisfy this Observable?*

If yes and the underlying requirement is behavioral (the feature computes,
transforms, decides, persists, or otherwise *does* something observable) →
the Observable is a **structural proxy** and must be rewritten.

| Structural proxy Observable | Behavioral Observable |
|---|---|
| "artifact path is a non-empty string" | "the file at `path` contains a `status` field with value `done`" |
| "the model constructs an object with a `data` field" | "the model constructs a valid structured response" |
| "schema file is valid JSON" | "the schema validates a state object with `status: done`" |

**Carve-out:** Genuinely structural requirements (a schema, a constants
module, a glue re-export) may have structural Observables — apply the litmus
to distinguish behavioral requirements from structural ones. The AC-STRUCT
entries below are deliberately structural (module-boundary and doc-comment
accuracy assertions); every AC-UX/AC-ERR/AC-E2E/AC-DEP entry asserts
observable runtime behavior (rendered DOM state, a function call's actual
arguments, or a network-call count), per the litmus.

## Known TAGs

- **STRUCT** — structural assertions about files, exports, imports, and
  doc-comment accuracy.
- **ERR** — partitioning/classification assertions on the new predicate's
  output (member/blocked/selectable/none-selectable).
- **UX** — user-visible behavior assertions in `InviteMemberModal.tsx`.
- **DEP** — dependency/integration assertions (behavior that must remain
  unchanged in a component this epic does not modify).
- **TEST** — unit-test-coverage-shape assertions.
- **E2E** — end-to-end test-infrastructure assertions.
- **SEC** — privacy/security-boundary assertions.

## Contact-Selectable Predicate (S1)

**AC-STRUCT-1** — `app/src/lib/contacts.ts` MUST export a new pure function
(implementer-named, mirroring the naming convention of
`eligibleGroupsForContact`/`addableGroupsForContact`) that accepts a
`ContactListItem[]` (the `listContacts(ownPubkeyHex, { includeArchived: true
})` output) and a group's `memberPubkeys: string[]`, and returns one
partition entry per input contact of the exact shape `{ contact:
ContactListItem, selectable: boolean, disabledReason?: 'already_member' |
'blocked' }`, preserving the input array's order (architecture.md seam
contract). The function's module MUST NOT import from `react`,
`@nostr-dev-kit/ndk`, or any module under `app/src/context/`.

**AC-ERR-1** — For an input contact whose `pubkeyHex` matches, case-
insensitively, an entry in `group.memberPubkeys`, the predicate MUST return
`{ selectable: false, disabledReason: 'already_member' }` for that contact,
regardless of that contact's `isArchived` value.

**AC-ERR-2** — For an input contact that does NOT satisfy AC-ERR-1 and has
`isArchived === true`, the predicate MUST return `{ selectable: false,
disabledReason: 'blocked' }`.

**AC-ERR-3** — For an input contact that satisfies neither AC-ERR-1 nor
AC-ERR-2, the predicate MUST return `{ selectable: true, disabledReason:
undefined }`.

**AC-ERR-4** — When every entry in the predicate's output has `selectable:
false` (including the empty-input case, where the output array itself is
empty), `InviteMemberModal.tsx` MUST use that all-disabled/empty condition
— and no separately re-derived check — to decide when to render the
guidance state (AC-UX-6).

**AC-TEST-1** — A unit test file colocated with `contacts.ts`'s existing
predicate tests (mirroring `app/tests/unit/contacts-groups.test.ts`'s shape)
MUST contain discrete test cases for: (a) empty contact-array input, (b) an
input where every contact is selectable, (c) an input where every contact is
disabled, (d) case-insensitive `memberPubkeys` matching (AC-ERR-1), (e) a
contact that is both an already-member AND `isArchived`, asserting
`disabledReason: 'already_member'` wins per AC-ERR-1's precedence, (f)
order-preservation of the returned partition against input order.

## Invite Modal: Contact Picker + Guidance State (S2)

**AC-UX-1** — Given at least one selectable contact, selecting it in
`invite-contact-select` and clicking `invite-submit-btn` MUST call
`useMarmot().inviteByNpub(groupId, npub)` with `npub === pubkeyToNpub(<the
selected contact's pubkeyHex>)`; on a `{ ok: true }` result the modal MUST
show `invite-success` and, after the existing auto-close delay, close.

**AC-UX-2** — For a contact satisfying AC-ERR-1 (already-member),
`invite-contact-select` MUST render that contact's `<option>` with the
`disabled` attribute set and a visible reason suffix (sourced from a new
`i18n.ts` key, not a hardcoded string) that is textually distinct from
AC-UX-3's blocked-reason suffix.

**AC-UX-3** — For a contact satisfying AC-ERR-2 (blocked), `invite-contact-
select` MUST render that contact's `<option>` with the `disabled` attribute
set and a visible reason suffix (sourced from a new `i18n.ts` key) distinct
from AC-UX-2's already-member-reason suffix.

**AC-UX-4** — **CORRECTED post-implementation (e2e verification, 2026-07-14
— see spec.md DD-4).** `group.memberPubkeys` updates immediately when
`inviteByNpub` succeeds, before the invitee joins — confirmed against
`MarmotContext.tsx`'s implementation and live e2e behavior. A contact
previously invited to this group is therefore `already_member` per
AC-ERR-1 the moment the invite succeeds, and MUST render as a disabled
`<option>` with the "already in group" reason (AC-UX-2), identically to
any other already-member contact. There is no separate "pending, still
selectable" state; user-confirmed 2026-07-14 to ship without a picker
re-invite path for a pending contact.

**AC-UX-5** — Selecting a selectable contact whose stored `pubkeyHex` has no
published key package on relays, then clicking `invite-submit-btn`, MUST
surface `invite-error` displaying `copy.groups.inviteErrorNoKeyPackage` —
the existing `getErrorMessage('no_key_package')` mapping MUST fire via the
picker path exactly as it fires today via the npub path.

**AC-UX-6** — When the AC-STRUCT-1 predicate's output contains zero
`selectable: true` entries, `InviteMemberModal.tsx` MUST render a guidance
message (a new `i18n.ts` key) in place of `invite-contact-select`, MUST
disable or omit `invite-submit-btn`, and MUST render a link targeting
`/contacts`. The guidance message's `en` string MUST contain a substring
naming the actual contact-establishment mechanism ("profile card" or
"share") and MUST NOT contain the substring "npub"; the `de` string MUST
contain "Profilkarte" (or equivalent share-mechanism wording) and MUST NOT
contain "npub" — i.e. neither locale's guidance copy may imply `/contacts`
itself exposes a self-service add-by-npub input (DD-6).

**AC-UX-7** — `InviteMemberModal.tsx`'s rendered output MUST NOT contain an
element with `data-testid="invite-npub-input"` nor an element with
`data-testid="invite-scan-qr-btn"`, in either the populated-picker state or
the guidance state — a DOM query for either testid scoped to
`[data-testid="invite-member-modal-content"]` MUST return zero elements.

**AC-DEP-1** — Admin gating for `InviteMemberModal` MUST remain unchanged by
this epic: the `isAdmin` check re-derived live from
`mlsGroup.groupData.adminPubkeys` (per `groups.tsx`) MUST continue to gate
visibility/access to `invite-member-btn` exactly as before this epic, and
`useMarmot().inviteByNpub`'s MLS `commit()`-layer admin enforcement MUST
continue to reject a non-admin's invite attempt with no change to
`MarmotContext.tsx`.

## E2E Infra: Shared Contact-Seeding + Picker Helper (S3)

**AC-E2E-1** — `app/tests/e2e/helpers/group-setup.ts` MUST export one shared
helper function that, given an inviter page and an invitee's npub, first
drives the production add-contact path (`page.goto('/add#c=' + npub)`) on
the inviter's page, then drives the picker (selecting the seeded contact in
`invite-contact-select` and clicking `invite-submit-btn`) — replacing
`createGroupAndInvite`'s current direct `invite-npub-input` fill.

**AC-E2E-2** — After this epic, zero files under `app/tests/e2e/` MUST
contain the string `invite-npub-input` (`grep -rl 'invite-npub-input'
app/tests/e2e` MUST return no matches) — `invite-contact-select` is the sole
invite-selection surface driven by any e2e spec.

**AC-E2E-3** — Every e2e spec that imports `group-setup.ts` for SEEDING
purposes (i.e. to reach a shared group/contact state as a precondition,
rather than to assert on the picker itself) MUST have zero direct
references to `invite-contact-select` or `invite-npub-input` — the seeding
+ picker interaction MUST be encapsulated entirely inside the
`group-setup.ts` helper, with no per-spec ad-hoc seeding logic. The sole
exception is the picker-behavior-testing specs themselves
(`groups-error-cases.spec.ts`, `groups-invite-guidance-state.spec.ts`,
`groups-invite-pending-contact-selectable.spec.ts`), which correctly
reference `invite-contact-select` directly because they assert on picker
behavior (AC-E2E-4/5/7/8) rather than merely using it as a seeding step.

**AC-E2E-4** — `groups-error-cases.spec.ts`'s "Invite without KeyPackage
shows error" test MUST first seed the fixed unpublished-KeyPackage keypair
as a contact (via the AC-E2E-1 helper or an equivalent explicit `/add#c=`
step), then select it via `invite-contact-select` and click
`invite-submit-btn`; the test MUST continue to assert `invite-error` becomes
visible (AC-UX-5's mapping, reached via the picker path).

**AC-E2E-5** — `groups-error-cases.spec.ts`'s "Invalid npub format shows
error" test MUST be deleted in the same commit as AC-UX-7 (it drives the
removed `invite-npub-input` testid and has no reachable UI surface under the
picker) AND replaced, in that same commit, by a new test in the same file
asserting a disabled contact (already-member or blocked, per AC-UX-2/
AC-UX-3) cannot be selected or submitted via `invite-contact-select` — the
deletion MUST NOT be a silent drop with no replacement test.

**AC-E2E-6** — `groups-member-profiles.spec.ts`'s "Invited member profile
replaces npub and shows avatar after join" test and "A creates group and
invites B" test MUST each seed the invitee as a contact (via the AC-E2E-1
helper or an equivalent explicit `/add#c=` step) before driving
`invite-contact-select`, since neither test has a pre-existing shared group
between the two parties at the point the invite happens.

**AC-E2E-7** — A new e2e test MUST assert the guidance state (AC-UX-6)
end-to-end: for a user with zero selectable contacts for a given group,
opening `InviteMemberModal` MUST show the guidance message and the
`/contacts` link, and MUST NOT show `invite-contact-select`.

**AC-E2E-8** — **CORRECTED post-implementation, inverted from its original
form (see AC-UX-4).** A new e2e test MUST assert that a still-pending
invited contact is correctly treated as already-member end-to-end: after
Alice invites Bob to a group and Bob has not yet accepted, re-opening
`invite-contact-select` MUST show Bob's `<option>` as disabled with the
"already in group" reason, MUST prevent selecting/submitting Bob a second
time (mirrors AC-E2E-5's disabled-contact-cannot-submit assertion), and
MUST NOT surface an error (this is expected disabled-state behavior, not
a failure path).

## Cross-Cutting Invariants

**AC-SEC-1** — Opening `InviteMemberModal` and populating `invite-contact-
select` (i.e. calling `listContacts(ownPubkeyHex, { includeArchived: true
})` and the AC-STRUCT-1 predicate) MUST trigger zero relay/NDK network
calls — verified by a spy/mock on the relay/NDK layer recording zero calls
during modal open, consistent with CLAUDE.md's privacy invariant and
architecture.md's "pure local read" seam. `useMarmot().inviteByNpub`'s
existing key-package fetch and MLS commit remain the only network
operations, unchanged and only triggered on submit.

**AC-STRUCT-2** — `app/tests/unit/cards/inviteByCard.test.ts` MUST be
updated in the same change as the `submitInvite`/`resolveInviteTarget`
reshape (DD-11) such that every test remaining in the file passes against
the reshaped functions' actual signatures. Any of the file's existing 9
tests that exercises an input surface no longer reachable in production
(free-text/card parsing through `resolveInviteTarget`/`submitInvite`) MUST
be explicitly removed or rewritten in that same commit — none MUST be left
silently skipped, commented out, or passing against dead code.

**AC-STRUCT-3** — The doc-comments on `resolveInviteTarget` and
`submitInvite` in `InviteMemberModal.tsx` (which currently describe them as
"the single down-conversion point for the group invite input" citing the
DD-1/DD-8 "single decode seam") MUST be updated to accurately describe the
reshaped functions' actual input contract (pubkey-sourced, not free-text/
card-parsing). If retained, "single decode seam" language MUST correctly
attribute that seam to `parseContactCard` (`app/src/lib/contactCard.ts`)
rather than implying `resolveInviteTarget`/`submitInvite` themselves parse
free-text/card input after the reshape.

**AC-DEP-2** — `app/src/lib/i18n.ts` MUST define, in both the `en` and `de`
`Copy` objects, new keys for: the contact-picker label, the already-member
disabled-reason suffix, the blocked disabled-reason suffix, and the
guidance message + `/contacts`-link label — every new key present in one
locale MUST be present in the other (no locale-only key added by this
epic).

**AC-STRUCT-4** — `app/src/lib/contacts.ts` MUST contain zero import
statements from `react`, `@nostr-dev-kit/ndk`, or any module under
`app/src/context/` after the AC-STRUCT-1 predicate is added (module-
boundary invariant, architecture.md "Boundary rules").

**AC-STRUCT-5** — `resolveInviteTarget`'s pubkeyHex validation MUST anchor
its hex-shape check to the full input string (`^[0-9a-fA-F]{64}$`),
rejecting a string that merely *contains* a valid 64-hex run padded with
extra leading or trailing characters as `{ ok: false, error:
'invalid_npub' }` — not just a too-short/non-hex string. Proven by
`app/tests/unit/cards/inviteByCard.test.ts`'s "rejects a 64-hex substring
padded with extra leading or trailing characters" test (added 2026-07-14,
resolving finding `resolveinvitetarget-s-pubkeyhex-validation-has-no`).

## Manual Validation

None. Every AC above is automatable: the predicate ACs (AC-STRUCT-1,
AC-ERR-1..4, AC-TEST-1) via vitest unit tests with literal `ContactListItem`
fixtures, mirroring `contacts-groups.test.ts`'s convention; the modal ACs
(AC-UX-1..7, AC-DEP-1) via Playwright DOM queries against
`invite-contact-select`/`invite-submit-btn`/`invite-error`/
`invite-success` and direct `i18n.ts` string assertions for AC-UX-6's copy
substrings; the e2e-infra ACs (AC-E2E-1..8) via the Playwright suite itself
plus a `grep -rl` check for AC-E2E-2; the cross-cutting ACs via a relay/NDK
call-count spy (AC-SEC-1), direct test-file/doc-comment inspection
(AC-STRUCT-2, AC-STRUCT-3), `i18n.ts` object assertions per locale
(AC-DEP-2), and an import-statement grep against `contacts.ts`
(AC-STRUCT-4).
