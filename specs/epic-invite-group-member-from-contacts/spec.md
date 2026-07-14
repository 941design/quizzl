# Invite Group Member from Contacts

## Problem

Today, adding a member to a group (admin-only) means pasting or scanning an
**npub**. The admin opens `InviteMemberModal`
(`app/src/components/groups/InviteMemberModal.tsx`) from the group detail
page (`app/pages/groups.tsx:400`), types an `npub1…` (or scans a QR that
fills the same field), and submits. The raw string is decoded
(`resolveInviteTarget` → `parseContactCard` → canonical npub) and handed to
`useMarmot().inviteByNpub(groupId, npub)`
(`app/src/context/MarmotContext.tsx:1477`), which fetches the target's
published key package from relays and performs the MLS add-member.

This is a poor experience: the admin must already possess the invitee's npub
as a string, paste it correctly, and gets no help recognising *who* they are
inviting. Meanwhile the app already has a first-class **contacts** model
(`app/src/lib/contacts.ts`) — people the admin has met through shared groups
or added explicitly, each with a nickname and cached avatar.

## Solution

Replace the npub text entry with a **contact picker**: the admin selects a
person from a dropdown of their contacts, and the app invites that person
into the group. The underlying MLS add-member call is unchanged — only the
way the admin *selects the target* changes. This mirrors the existing
inverse flow on the profile page (`app/pages/profile.tsx:557`), where an
admin picks a *group* to add a *contact* into — same underlying
`inviteByNpub` call, same contact-eligibility pattern family
(`eligibleGroupsForContact` / `addableGroupsForContact`,
`contacts.ts:215`/`240`).

## Scope

### In Scope

- Remove the npub free-text `Input` and QR-scan button from
  `InviteMemberModal` (this modal only — the shared QR components stay for
  `settings.tsx` / `profile.tsx`).
- Add a contact-dropdown picker listing every contact, disabling
  already-members and blocked contacts with an inline reason.
- Add the "no selectable contact" guidance state, linking to `/contacts`.
- Add a new "selectable contacts for a group" pure predicate in
  `contacts.ts`, mirroring `eligibleGroupsForContact`.
- Confirm the guidance-state copy accurately describes how contacts are
  actually added today (sharing a profile card — a mutual handshake, per
  `epic-contact-card-exchange`/`epic-contact-pairing-code` — not a
  self-service "add by npub" form; `/contacts` itself is a read-only
  list). This is confirmed, intentional product behavior, not a gap to
  fix in this epic.
- Reconcile `app/tests/unit/cards/inviteByCard.test.ts` and the DD-1/DD-8
  "single decode seam" doc-comments on `resolveInviteTarget`/`submitInvite`
  with however those functions are reshaped for a pubkey-sourced picker —
  in the same change, not as follow-up debt.
- Update the ~26 e2e specs (+ 11 transitive importers of
  `group-setup.ts`) that currently drive `invite-npub-input`, via one
  shared "ensure contact, then invite via picker" helper in
  `group-setup.ts`.
- New i18n keys (en + de) for the picker, disabled-reasons, and empty-state
  guidance.

### Out of Scope

- Any change to `MarmotContext.inviteByNpub`, key-package fetching, or the
  MLS commit itself.
- Any change to admin gating (`isAdmin`) or its enforcement at the MLS
  `commit()` layer.
- The group invite-link (shareable join link) feature — untouched.
- The contacts/add-by-npub/QR flow itself — untouched, just linked to.

## Design Decisions

1. **Replace, don't augment the npub entry point.** The npub free-text input
   and QR scan are removed from the group invite flow with no fallback.
   Inviting a non-contact directly from a group is no longer possible; the
   person must first become a contact. Mitigation: most invite targets are
   already contacts (contacts auto-seed from shared groups,
   `rememberContactsFromGroups`, `contacts.ts:98`); for a genuine stranger,
   the mitigation is the app's existing contact-card mutual-handshake flow
   (sharing a profile card / pairing code), **not** a self-service
   "add by npub" form — that manual-entry UI was already removed in a
   prior epic and is confirmed, intentional current behavior. The
   guidance-empty-state copy (Decision 6) must describe this accurately.
2. **Single-select, one contact per invite.** Same one-target-per-invite
   cardinality as today's npub flow. No batch/multi-invite.
3. **Show every contact; disable the un-addable, with a reason.** The
   dropdown lists **all** contacts, including blocked ones
   (`listContacts(ownPubkeyHex, { includeArchived: true })`). A contact is
   disabled when: already a member of this group (`isMember`, matched
   **case-insensitively** against `group.memberPubkeys` — stored contact
   keys are not case-normalised, so an exact-match `.includes()` would
   wrongly show an already-member contact as selectable), or blocked
   (`contact.isArchived`). Everyone else is selectable.
4. **CORRECTED during implementation (e2e verification, not a design
   choice).** The original intent — "a previously invited, not-yet-joined
   contact stays selectable so the admin can re-send" — turned out to
   contradict actual runtime behavior: `group.memberPubkeys` updates
   immediately when `inviteByNpub` succeeds (`MarmotContext.tsx`'s
   `inviteByKeyPackageEvent` commit + `getGroupMembers` refresh happen
   synchronously, before the invitee ever accepts), not only once the
   invitee joins. The app *does* distinguish "invited, not yet confirmed"
   from "confirmed" for the member-list's Pending badge
   (`groups.tsx`'s local `confirmedPubkeys`, derived from per-member
   profile-message receipt), but that signal is page-local React state,
   never exposed to `contacts.ts`'s pure predicate or the invite modal.
   **Confirmed with the user (2026-07-14): ship without the re-invite
   guarantee.** A contact who has already been sent an invite for this
   group is treated exactly like any other already-member contact —
   disabled, "already in group" — for as long as they remain pending.
   There is currently no re-invite path through the picker while a
   contact is pending. Wiring the real pending/confirmed signal through
   to restore re-invite is out of scope for this epic; filed as a
   follow-up finding.
5. **No up-front key-package check.** The dropdown does not query relays to
   determine key-package availability before rendering. A contact with no
   key package is selectable; the existing submit-time `no_key_package`
   error path fires exactly as it does today.
6. **Guidance state when nothing is selectable.** When no contact is
   selectable (no contacts, or all are members/blocked), render a guidance
   message with a link to `/contacts`, instead of a dropdown with no usable
   options. Submit is disabled. **The guidance copy must not imply
   `/contacts` has a self-service "add by npub" action — it does not, and
   this is intentional, confirmed product behavior, not a gap.**
   `/contacts` is a read-only list; new contacts are established only via
   sharing a contact card (a mutual handshake initiated by either party —
   see `epic-contact-card-exchange` / `epic-contact-pairing-code`), never
   by one-sided npub entry. The copy should say something like "No
   contacts available to invite. Add contacts by sharing your profile
   card." (see i18n note below), and the link still lands on `/contacts`,
   which is where a user goes to find their own share-card action
   (`profile.tsx`'s share-card flow — confirm during implementation
   whether `/contacts` itself surfaces a link onward to `/profile`'s share
   action, or whether the guidance link should go straight to `/profile`;
   default to `/contacts` per the locked decision unless implementation
   reveals `/profile` is clearly the more useful landing page).
7. **Admin-only gating is unchanged**, enforced both at the UI (`isAdmin`)
   and again at the MLS `commit()` layer.
8. **The underlying add-member call is unchanged.** The feature still calls
   `useMarmot().inviteByNpub(groupId, npub)`, where `npub` is derived from
   the selected contact's stored `pubkeyHex` via `pubkeyToNpub` (as already
   used at `profile.tsx:636`).
9. **Native `<Select>`, plain-text disabled-option annotations.** Mirrors
   the existing profile-page group picker (`profile.tsx:704`) exactly —
   text-only, no rich avatar rendering in the dropdown. (This narrows the
   originally circulated "nickname + avatar" framing down to
   nickname-only, matching what a native `<Select>` can actually render —
   see spec-request §2/§6 reconciliation.)
10. **Option value = `pubkeyHex`, label = `nickname || truncateNpub(npub)`.**
    Reuses the exact fallback the profile page already uses
    (`contact?.nickname || truncateNpub(npub)`, `profile.tsx:620`) — a
    freshly added contact has `nickname: ''` in the contact cache
    (`contacts.ts:157`), which is precisely the common case for e2e
    invitees and any stranger just added via the escape hatch.
11. **`submitInvite`/`resolveInviteTarget` reshape stays minimal.** These
    functions exist today to parse a free-text string; a picker supplies a
    pubkey directly. Keep a thin adapter rather than deleting the seam —
    avoid scope creep into unrelated contact-card parsing used elsewhere.
    Whatever shape they end up in, `inviteByCard.test.ts` and the DD-1/DD-8
    "single decode seam" doc-comments on these functions MUST be updated in
    the same change so the docs don't lie about a narrowed/removed seam.

## Constrained by ADRs

- **ADR-008** — Block is a deny layer AND-ed at every peer-signal channel,
  keyed on `archivedAt`. This spec's "blocked contact" definition
  (`archivedAt != null`) is consistent with, not a deviation from, ADR-008.

## Technical Approach

### `app/src/components/groups/InviteMemberModal.tsx`

Remove the npub text `Input` (`invite-npub-input`) and its state, the
QR-scan button and its wiring (`NpubQrButton`/`NpubQrModal` usage local to
this modal only — do not touch the shared components), and the
free-text-parsing entry seam. Add:
- a contact `<Select>` (testid `invite-contact-select`) built per the
  selection algorithm below, with disabled `<option>`s carrying an inline
  reason suffix;
- the guidance empty state (message + link to `/contacts`) shown instead of
  the dropdown when nothing is selectable;
- the "Invite" button (`invite-submit-btn`, testid preserved), disabled
  until a selectable contact is chosen and while a submit is in flight.

Selection algorithm, for the current group:
1. Source list: `listContacts(ownPubkeyHex, { includeArchived: true })`.
2. Per contact: `isMember` (case-insensitive match against
   `group.memberPubkeys`) → disabled, "already in group"; else
   `isBlocked = contact.isArchived` → disabled, "blocked"; else selectable.
   **Corrected during implementation:** `group.memberPubkeys` updates
   immediately when an invite succeeds (not only once the invitee joins),
   so a just-invited, still-pending contact is already-member for the
   purposes of this check and is disabled exactly like any other
   already-member contact. There is no separate "pending" classification
   at this layer (Design Decision 4).
3. Ordering: preserve `listContacts` order as-is (it already sinks archived
   contacts to the bottom before recency-then-name sort).
4. If no contact is selectable after the above, render the guidance state.

Submit path (unchanged underneath): convert the selected contact's
`pubkeyHex` → npub via `pubkeyToNpub`; call
`useMarmot().inviteByNpub(groupId, npub)`; map the returned status via the
existing four explicit cases (`invalid_npub`, `no_key_package`, `offline`,
`timeout`) plus a generic default covering everything else including
`group_not_found` and `'Not initialized'`. `invalid_npub` is now
effectively unreachable (the npub is built from a stored pubkey) but the
mapping stays for defensiveness. On success, close/reset and show the
existing success copy.

**Do not delete** `NpubQrButton`, `NpubQrModal`, `NpubQrScanner` — they
remain in use by `settings.tsx` and `profile.tsx`.

### `app/src/lib/contacts.ts`

Add a new pure predicate — "selectable contacts for a group" (inverse of
`eligibleGroupsForContact`, `contacts.ts:215`) — that partitions
`listContacts(ownPubkeyHex, { includeArchived: true })` into
selectable/disabled-with-reason per the algorithm above. Unit-testable in
isolation, mirroring `contacts-groups.test.ts` (which covers
`addableGroupsForContact`).

### `app/src/lib/i18n.ts`

Retire from the invite path (may remain defined if referenced elsewhere,
but no longer shown here): `inviteNpubLabel`, `inviteNpubPlaceholder`,
`inviteHelp`, and this modal's `scanQr` usage. Retitle `inviteTitle` to
"Invite a contact" / de: "Kontakt einladen". Add: a contact-picker label
("Choose a contact" / "Kontakt auswählen"), disabled-reason suffixes
("already in group" / "bereits in der Gruppe"; "blocked" / "blockiert"),
and empty-state guidance copy + contacts-page link label (en + de). Keep
the existing submit/success/error keys unchanged. Add group-scoped keys
distinct from the parallel `profile.addToGroup*` family — do not overload
the profile keys for this modal.

**Empty-state guidance copy — confirmed product wording.** The message
must describe the *actual* mechanism (contacts are added by sharing a
profile card, a mutual handshake) and must NOT imply `/contacts` has a
self-service "add by npub" button. E.g. en: "No contacts available to
invite. Add contacts by sharing your profile card from the Contacts
page." / de: "Keine Kontakte zum Einladen verfügbar. Füge Kontakte
hinzu, indem du deine Profilkarte über die Kontakte-Seite teilst." Exact
wording may be refined by the implementer; the constraint is accuracy
about the mechanism, not exact phrasing.

### `app/tests/e2e/helpers/group-setup.ts`

This is the primary e2e edit surface (drives `invite-npub-input` today,
imported by 11 specs that never touch the testid directly). Add one shared
helper — "ensure the invitee is a contact of the inviter, then invite via
the picker" — routed through here, replacing the inline npub-input drive.
Auto-seeding via shared groups cannot be relied on (in the canonical flow,
the invite happens *before* any shared group exists), so the helper
explicitly adds the contact via the app's add-contact flow first.

### `app/tests/unit/cards/inviteByCard.test.ts`

Update in the same change as the `submitInvite`/`resolveInviteTarget`
reshape (Design Decision 11) — this file tests those exact functions and
will otherwise go red.

## Stories

- **S1 — Contact-selectable predicate** — new pure "selectable contacts for
  a group" helper in `contacts.ts` + unit test. Covers AC-STRUCT-1,
  AC-ERR-1..4 (member/blocked/selectable/none-selectable partitioning).
- **S2 — Invite modal: contact picker + guidance state** — remove npub/QR
  from `InviteMemberModal`, add the `<Select>` picker and empty-state
  guidance, reshape `submitInvite`/`resolveInviteTarget`, update
  `inviteByCard.test.ts` and its doc-comments, add i18n keys. Covers
  AC-UX-1..7, AC-DEP-1.
- **S3 — E2E infra: shared contact-seeding + picker helper** — add the
  shared helper to `group-setup.ts`; update the 25 directly-affected specs
  plus the two bespoke specs (`groups-error-cases`,
  `groups-member-profiles`); add the new AC-UX coverage specs. Covers
  AC-E2E-1..8.

## Acceptance Criteria

See [`acceptance-criteria.md`](./acceptance-criteria.md).

## Relationship to Other Epics

- **epic-block-contact** — this spec's "blocked" disabled-reason is
  `contact.isArchived`, the same signal `epic-block-contact` establishes.
- **epic-contact-card-exchange** — `resolveInviteTarget`/`submitInvite`
  and their "single decode seam" doc-comments originate there (DD-1/DD-8);
  this epic narrows that seam's entry point for the group-invite path only.
- **epic-group-invite-links** — separate, unaffected shareable-link
  mechanism.
- **epic-contact-pairing-code** — (shipped, `status: done`) established
  the mutual-handshake mechanism that is the *actual* current path to add
  a stranger as a contact; this epic's guidance-empty-state copy points
  users at that mechanism rather than a nonexistent self-service form.

## Non-Goals

- No batch/multi-invite in this iteration.
- No key-package pre-check or "addable" badge — availability is discovered
  only at submit time.
- No new way to invite a non-contact directly from a group — the two-step
  "add as contact, then invite" path is the intended (and only) route to
  invite a stranger.
- No contact search box / typeahead beyond native `<Select>` behaviour.
- No change to the invite-link mechanism, admin gating, MLS add-member, or
  key-package publishing.

## Amendments

- **2026-07-14 (curator, resolving finding
  `resolveinvitetarget-s-pubkeyhex-validation-has-no`).** Added
  AC-STRUCT-5 to `acceptance-criteria.md` to pin `resolveInviteTarget`'s
  hex-shape validation as anchored to the full input string (not merely
  containing a valid 64-hex run). The implementation (DD-11's reshaped
  `resolveInviteTarget`, `InviteMemberModal.tsx:52`) already used the
  anchored regex `^[0-9a-fA-F]{64}$`, and
  `app/tests/unit/cards/inviteByCard.test.ts` already asserted the
  boundary case ("rejects a 64-hex substring padded with extra leading
  or trailing characters") — this amendment closes the gap between that
  already-shipped behavior/test and the AC document, per the finding's
  motivation: "epic-invite-group-member-from-contacts (AC-STRUCT-3)
  documents resolveInviteTarget's input contract as pubkey-sourced
  re-encoding but does not specify that the 64-hex regex must anchor to
  the full string."
