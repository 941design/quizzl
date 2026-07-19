# Feature Specification Request: Invite Group Member from Contacts (replace npub entry with a contact picker)

> **Status:** request / pre-spec. Hand to `/base:feature` to produce the
> implementation spec + acceptance criteria.
>
> **Requester decisions are locked** (see §1.1). The single most important one:
> the free-text **npub input and QR scan are removed** from the group invite
> flow. You can only invite people who are already in your **contacts**, chosen
> from a dropdown. Search "DECISION:" for the specific locked choices.

## 1. Intent

Today, adding a member to a group (admin-only) means pasting or scanning an
**npub**. The admin opens `InviteMemberModal`
(`app/src/components/groups/InviteMemberModal.tsx`) from the group detail page
(`app/pages/groups.tsx:400`), types an `npub1…` (or scans a QR that fills the
same field), and submits. The raw string is decoded
(`resolveInviteTarget` → `parseContactCard` → canonical npub) and handed to
`useMarmot().inviteByNpub(groupId, npub)`
(`app/src/context/MarmotContext.tsx:1477`), which fetches the target's published
key package from relays and performs the MLS add-member.

This is a poor experience: the admin must already possess the invitee's npub as
a string, paste it correctly, and gets no help recognising *who* they are
inviting. Meanwhile the app already has a first-class **contacts** model
(`app/src/lib/contacts.ts`) — people you've met through shared groups or added
explicitly, each with a nickname and avatar.

This feature replaces the npub text entry with a **contact picker**: the admin
selects a person from a dropdown of their contacts, and the app invites that
person into the group. The underlying MLS add-member call is unchanged — only
the way the admin *selects the target* changes.

There is an almost-exact mirror of this already in the codebase: on another
person's **profile page** (`app/pages/profile.tsx:557`), an admin can pick a
*group* from a dropdown to add *that contact* into. This feature is the inverse
entry point — from a *group*, pick a *contact* — and reuses the same underlying
`inviteByNpub` call and the same contact-eligibility helpers
(`eligibleGroupsForContact`, `addableGroupsForContact`, `contacts.ts:215`/`240`).

### 1.1 Locked product decisions (from the requester)

1. **DECISION — Replace, don't augment.** The npub free-text `Input`
   (`invite-npub-input`) and the QR-scan button are **removed** from the group
   invite flow. There is no "invite by npub instead" fallback. Inviting a
   non-contact directly from a group is no longer possible; the person must
   first be a contact.
2. **DECISION — Pick from contacts, single-select.** The invite UI presents a
   **dropdown of the admin's contacts**. Exactly **one** contact is selected per
   invite action — same one-target-per-invite cardinality as today's npub flow.
   No multi-select / batch invite.
3. **DECISION — Show all, disable the un-addable.** The dropdown lists **every**
   contact (not a pre-filtered subset). Contacts who **cannot** be invited are
   shown **disabled / greyed out with a reason**:
   - **already a member** of this group → disabled, reason "already in group";
   - **blocked** (archived contact, `archivedAt != null`) → disabled, reason
     "blocked".
   Only addable contacts are selectable.
4. **DECISION — Pending invites stay selectable (allow re-invite).** A contact
   who was previously invited but has not yet joined is **not** specially
   disabled — they remain selectable so the admin can re-send. Redundant invites
   are accepted as harmless. (See §4 — the app does not maintain reliable
   per-contact "pending" state anyway; "member" is the only reliable
   already-in-group signal.)
5. **DECISION — Key-package availability is NOT pre-checked.** The dropdown does
   **not** query relays up front to determine whether each contact has a
   published key package. A contact with no key package is still selectable; the
   existing **submit-time** error path fires (`no_key_package` →
   "This user has not set up their Few identity yet."), exactly as it does today
   for the npub flow. No per-contact relay fan-out on modal open.
6. **DECISION — Empty / nothing-selectable state shows guidance.** When the admin
   has **no selectable contact** (no contacts at all, or every contact is already
   a member / blocked), the modal shows a **guidance message** — "No contacts
   available to invite" with a **link to the contacts page** — instead of an
   unusable empty dropdown. The submit button is disabled in this state.
7. **DECISION — Admin-only is unchanged.** Inviting remains gated to group
   admins (`isAdmin`, `groups.tsx:306`; enforced again at the MLS `commit()`
   layer). This feature does not change who may invite.
8. **DECISION — Underlying add-member call is unchanged.** The feature still
   calls `useMarmot().inviteByNpub(groupId, npub)` with the selected contact's
   npub (derived from their stored `pubkeyHex` via `pubkeyToNpub`). No change to
   `MarmotContext.inviteByNpub`, key-package fetching, or the MLS commit.

### 1.2 Outcome (behaviour)

- An admin opens a group and taps "Invite Member".
- Instead of a text box, they see a **dropdown of their contacts** labelled by
  nickname (falling back to a truncated npub when a contact has no cached
  nickname — the common case for a freshly added contact; see §6). People
  already in the group or blocked appear but are greyed out with a reason;
  everyone else is selectable. (Avatar rendering depends on the picker control
  chosen — a native `<Select>` shows text only; see OQ5.)
- The admin picks one contact and taps "Invite". The app invites that person
  into the group via the existing MLS add-member call.
- If the picked contact turns out to have no key package, the same
  "hasn't set up their Few identity yet" error appears as today.
- If the admin has nobody they *can* invite, the modal tells them so and links
  to contacts.

### 1.3 Non-goals (this iteration)

- **No batch / multi-invite.** One contact per invite action (DECISION 2).
- **No key-package pre-check or "addable" badge.** Availability is discovered at
  submit time only (DECISION 5). No up-front relay queries per contact.
- **No new way to invite non-contacts.** Removing npub entry is intentional
  (DECISION 1); inviting a stranger first requires adding them as a contact
  (which itself still has its own by-npub/QR path on the contacts/add screens —
  see §7). This feature does not add a "quick add + invite" shortcut.
- **No change to the invite-link mechanism.** The separate group **invite-link**
  feature (`groups-invite-link.spec.ts`, the shareable join link) is untouched.
- **No change to admin gating, MLS add-member, or key-package publishing.**
- **No contact search box / typeahead** beyond native dropdown behaviour, unless
  the spec author finds the contact list length warrants it (default: native
  `<Select>`, ordered by the existing `listContacts` recency-then-name order).

---

## 2. Behaviour changes & consequences (read first)

| Before this change | After this change |
|---|---|
| Invite by pasting/scanning an npub string. | Invite by picking a contact from a dropdown. |
| Any valid npub could be invited, including a total stranger. | Only existing **contacts** can be invited from the group. |
| No recognition help — you invite a raw key. | You see nickname + avatar; you invite a *person*. |
| QR scan available inside the invite modal. | QR scan removed from the invite modal (still available where you *add contacts*). |
| Empty/blank input → validation error on submit. | Nothing selectable → guidance message + link to contacts, submit disabled. |
| Already-a-member / blocked people were not distinguished (you'd just get an error or a redundant invite). | Already-members and blocked contacts are shown **disabled with a reason**. |

The one real capability loss: **you can no longer invite someone who is not yet
a contact directly from the group screen.** DECISION 1 accepts this. The
mitigation is that adding a contact is a low-friction, already-existing action
(§7), and most invite targets are people you've already met (contacts are
auto-seeded from shared groups anyway, `rememberContactsFromGroups`,
`contacts.ts:98`).

---

## 3. Terminology

- **Contact** — a person in the local contacts store (`StoredContact`,
  `contacts.ts:9`), keyed by `pubkeyHex`, with display data (nickname, avatar)
  in the separate contact cache (`ContactCacheMap`, `contacts.ts:25`). The
  merged read shape is `ContactListItem` (`contacts.ts:16`), produced by
  `listContacts(ownPubkeyHex, …)` (`contacts.ts:139`).
- **Addable contact (for this group)** — a contact who is **not** already a
  member of this group **and not** blocked (`archivedAt == null`). This is the
  only selectable set. Mirror the existing eligibility helper
  `eligibleGroupsForContact` (`contacts.ts:215`) — the inverse ("eligible
  contacts for this group") is the natural home for this predicate.
- **Member set** — `group.memberPubkeys` (`groups.tsx:303`,439`) — the single
  source of truth for "already in group".
- **Blocked contact** — a contact with `archivedAt != null` (see the sibling
  Block-Contact spec, `specs/block-contact-spec-request.md`).

---

## 4. Determining the dropdown contents

For the current group, build the contact list as follows:

1. **Source list.** `listContacts(ownPubkeyHex, { includeArchived: true })` —
   note `includeArchived: true`, because DECISION 3 requires blocked contacts to
   be **shown** (disabled), not hidden. (Contrast the contacts page, which
   defaults to hiding archived.)
2. **Per-contact state** (drives selectable vs disabled + reason):
   - `isMember` = the contact's pubkey is in `group.memberPubkeys`, compared
     **case-insensitively** (lowercase both sides). Stored contact keys are NOT
     case-normalised — `rememberContactsFromGroups` indexes by whatever case
     `memberPubkeys` supplied, and `eligibleGroupsForContact` (`contacts.ts:215`)
     already lowercases both sides for exactly this reason. An exact-match
     `.includes()` would wrongly show an already-member contact as selectable
     whenever cases diverge, defeating DECISION 3. → disabled, reason
     "already in group".
   - `isBlocked = contact.isArchived` → disabled, reason "blocked".
   - otherwise **selectable**.
3. **Pending invites are ignored** (DECISION 4). The app has no reliable
   per-contact "invited but not joined" flag exposed here (`memberPubkeys`
   reflects committed membership; pending-invite tracking lives in a different
   surface — `PendingRequestsSection`, `groups.tsx:430` — and is not per-contact
   keyed for this dropdown). Do not attempt to derive pending state; treat any
   non-member, non-blocked contact as selectable.
4. **Ordering.** Preserve the `listContacts` order. Note that `listContacts`
   **already sinks archived (blocked) contacts to the bottom** before applying
   recency-then-name (`contacts.ts:164–169`), so with `includeArchived: true`
   the blocked/disabled contacts already sort last for free — do not re-sort
   against this. The optional "float *all* selectable above *all* disabled"
   enhancement would additionally need to push already-members down; not
   required.
5. **Empty/none-selectable predicate.** If, after the above, **no** contact is
   selectable, render the guidance state (DECISION 6) rather than the dropdown.
   "No contacts at all" and "all contacts disabled" collapse to the same
   guidance state.

**Key-package availability is deliberately NOT part of this computation**
(DECISION 5). Whether a selectable contact actually has a fetchable key package
is discovered only when `inviteByNpub` runs at submit time.

---

## 5. Submit path (unchanged underneath)

On "Invite" with a selected contact:

1. Convert the selected contact's `pubkeyHex` → npub via `pubkeyToNpub`
   (already used at `profile.tsx:636`).
2. Call `useMarmot().inviteByNpub(groupId, npub)` — **the same call** the npub
   flow and the profile-page dropdown use.
3. Map the returned status code to copy exactly as today
   (`InviteMemberModal.getErrorMessage`, lines 105–118). Note the **actual**
   mapping is only four explicit cases plus a default: `invalid_npub`,
   `no_key_package`, `offline`, `timeout`, and **everything else → generic**.
   `inviteByNpub` can also return `group_not_found` and `'Not initialized'`
   (`MarmotContext.tsx:1480`) — both fall through to the generic message. Do not
   spec a dedicated `group_not_found` case that the code doesn't have. Keep the
   `invalid_npub` mapping for defensiveness even though it's now effectively
   unreachable (we build the npub ourselves from a stored pubkey).
4. On success, close/reset the picker and surface the existing success copy.

Because the target is now always a well-formed pubkey from the store,
`invalid_npub` becomes effectively unreachable — but keep its mapping for
defensiveness; do not remove the error copy.

---

## 6. UI / component changes

**Primary edit surface:** `app/src/components/groups/InviteMemberModal.tsx`.

Remove:
- the npub text `Input` (`invite-npub-input`, lines ~182–192) and its state;
- the QR-scan button and its wiring **inside this modal** (`NpubQrButton` /
  `NpubQrModal` usage here only);
- `resolveInviteTarget` / `submitInvite`'s string-parsing seam **as the invite
  entry** — the contact picker supplies a pubkey directly, so the
  `parseContactCard`/npub-decode step is no longer needed on this path. (`submitInvite`
  MAY be reshaped to accept a pubkey/npub from the picker; do not over-refactor.)

Add:
- a **contact dropdown** (Chakra `<Select>` mirroring the profile-page group
  picker, `profile.tsx:704`), listing contacts per §4, with disabled `<option>`s
  carrying an inline reason for member/blocked;
- the **guidance empty state** (message + link to `/contacts`) when nothing is
  selectable;
- the **Invite** button, disabled until a selectable contact is chosen and while
  a submit is in flight.

**Option label + value.** Each option's **value** must be the contact's
`pubkeyHex` (stable, unique, and what e2e selects on — not the display name).
The **label** is `nickname || truncateNpub(npub)` — `listContacts` returns
`nickname: ''` when the contact cache has no entry (`contacts.ts:157`), which is
precisely the state of a freshly added contact (the §7 escape-hatch flow, and
most e2e invitees). Rendering the raw empty string would produce blank options.
Reuse the exact fallback the profile page already uses:
`contact?.nickname || truncateNpub(npub)` (`profile.tsx:620`), disabled options
carrying the inline reason suffix.

**Do NOT delete the shared QR components** (`NpubQrButton`, `NpubQrModal`,
`NpubQrScanner`) — they are also used by `settings.tsx` and `profile.tsx`
(verified: grep shows usage in both). Only the *usage inside the invite modal*
is removed.

**Trigger site** (`groups.tsx:398`): the `invite-member-btn` and modal wiring
stay; only the modal's internals change. Admin gating unchanged.

**Testids:** keep `invite-member-btn` and `invite-submit-btn` (referenced by
e2e) to minimise churn. `invite-npub-input` is removed; introduce a stable
testid for the dropdown (e.g. `invite-contact-select`) and, if helpful for
tests, per-option identifiers. The spec author should enumerate the new testids
and update the specs that used `invite-npub-input` (see §9).

---

## 7. Interaction with adding contacts (the escape hatch)

Because a non-contact can no longer be invited from the group, the path to
invite a brand-new person becomes two steps: **add them as a contact, then
invite**. The add-contact-by-npub/QR capability still exists on its own screens
(`app/pages/add.tsx`, contacts add flow, `addContactByNpub`, `contacts.ts:323`)
and is untouched by this feature. The guidance empty state (DECISION 6) links to
contacts so this path is discoverable. The spec author should confirm the
contacts/add screen is reachable from that link and reads sensibly as the "so
that's where I add someone new" destination.

---

## 8. Privacy invariant (mandatory)

Per `CLAUDE.md`: profile metadata must never be broadcast to public relays, and
reading others' profiles must not induce any public broadcast of our own data.

This feature is **read-local + targeted-encrypted only**:

- The dropdown is built entirely from **local** contacts storage (nickname /
  avatar already cached locally). Rendering it publishes nothing.
- Selecting a contact and inviting performs the **existing** MLS add-member flow
  (encrypted, addressed to group members) plus the existing relay **read** of
  the invitee's key package. No new outbound event, and specifically **no
  kind-0 / no public profile broadcast**, is introduced.
- Confirm that displaying a contact's cached nickname/avatar in the dropdown
  reads only local storage and triggers no profile *fetch-and-rebroadcast*.

Before implementation, confirm no code path added here publishes or leaks
profile metadata to an unaddressed audience.

---

## 9. Existing tests to update (E2E must publish *through the app*)

Per the project e2e rule (`CLAUDE.md`; memory `feedback_e2e_no_direct_relay`),
peer actions go through the app's publish helpers, never raw WebSocket.

**The blast radius is large — plan for it up front.** `grep -rln
invite-npub-input app/tests/e2e/` returns **26 files: 25 specs plus the shared
helper `app/tests/e2e/helpers/group-setup.ts`**. The helper drives
`invite-npub-input` inline (around `group-setup.ts:82`) and is imported by **11
further specs** that never touch the testid directly (e.g. `dm-block-contact`,
`groups-dm-reactions`, `groups-calls-*`, `dm-self-heal`). **Removing the npub
input breaks all of them at once** — so `group-setup.ts` is the *primary* e2e
edit surface, not an afterthought.

**Contact-seeding is a cross-cutting problem, not a per-test one.** Every one of
these ~30 flows now needs the invitee to be an **existing contact** of the
inviter *before* the invite. And auto-seeding cannot be relied on: in the
canonical `group-setup.ts` flow, Alice invites Bob **before any shared group
exists**, so `rememberContactsFromGroups` (`contacts.ts:105`) has not yet run —
Bob is not a contact at invite time. Therefore:

- **DD (test infra).** Add **one shared helper** — "ensure X is a contact of Y,
  then invite X via the picker" — routed through `group-setup.ts`, and make every
  affected spec use it. Do **not** make a per-spec ad-hoc decision about seeding
  (unmanageable at ~30 specs). The helper decides once how the invitee becomes a
  contact (via the app's add-contact flow), so the whole bucket flips together.

The specs that reference `invite-npub-input` **directly** (25), each needing the
same picker + seeding change:

`dm-walled-garden-group-member-allowed`, `groups-admin`, `groups-cancel-pending`,
`groups-contacts`, `groups-dispatch-isolation`, `groups-error-cases`,
`groups-ever-known-survives-leave`, `groups-forward-secrecy`,
`groups-image-sharing`, `groups-lazy-updates`, `groups-leave-intent`,
`groups-lifecycle`, `groups-member-profiles`, `groups-message-edit-delete`,
`groups-migration-backfill`, `groups-poll-after-leave`, `groups-polls`,
`groups-profile-reactive`, `groups-profile-request`,
`groups-profile-update-propagation`, `groups-pull-only-invitation-accept`,
`groups-pull-only-invitation-decline`, `groups-reactions`, `groups-rename`,
`groups-transitive-invite`. Plus the 11 that break transitively via
`group-setup.ts`.

Two specs need bespoke attention beyond the mechanical swap:

| Spec | Why it's special | Change needed |
|---|---|---|
| `groups-error-cases.spec.ts` | Has "Invite without KeyPackage shows error" (`:21`) **and** "Invalid npub format shows error" (`:45`). | The **no-key-package** error still applies at submit time — re-express via the picker (the target IS selectable; the error fires on submit, DECISION 5). The **invalid-npub** test is now **unreachable** (no free-text input) — **replace** it with a new-behaviour test (already-member disabled, or blocked disabled), do not silently drop coverage. |
| `groups-member-profiles.spec.ts` | Drives the npub input in **two** tests: "Invited member profile replaces npub…" (`:82`) and "A creates group and invites B" (`:138`). | Both go through the shared helper. |

**New coverage required** (no equivalent exists today — note also that the
mirror profile-page dropdown has **zero** e2e coverage, only a unit test
`app/tests/unit/contacts-groups.test.ts`):

- **AC — Pick a contact and invite.** A has B as a contact. A opens the group,
  opens the invite modal, selects B from the dropdown, invites. B receives and
  joins (via the app). B now appears in the member list.
- **AC — Already-member contact is disabled.** After B joins, re-opening the
  invite dropdown shows B disabled with the "already in group" reason and B is
  not selectable.
- **AC — Blocked contact is disabled.** A blocks contact C. In the invite
  dropdown, C is shown disabled with the "blocked" reason and not selectable.
- **AC — No-key-package error still fires.** Selecting a contact who has no
  published key package yields the existing "hasn't set up their Few identity
  yet" error at submit time (no pre-check, so the contact WAS selectable).
- **AC — Empty / none-selectable guidance.** An admin whose contacts are all
  members (or who has no contacts) sees the guidance message + contacts link,
  and the submit button is disabled.
- **AC — npub entry is gone.** The invite modal no longer renders a free-text
  npub input or a QR-scan button (`invite-npub-input` absent).
- **AC — Admin-only unchanged.** A non-admin member cannot open the invite
  action (button gated), same as today.
- **AC — Pending contact stays selectable.** A contact previously invited but
  not yet joined remains selectable (re-invite allowed) — i.e. not disabled as
  "pending" (DECISION 4).

The definitive gate is the **full 60-test suite** (`make test-e2e-all`), per
`CLAUDE.md`. New invite specs live in the **groups/relay** bucket (Docker).

**Unit tests:** add a pure-function test for the new "eligible/selectable
contacts for this group" predicate (mirror `contacts-groups.test.ts`, which
covers `addableGroupsForContact`), covering member / blocked / selectable
partitioning and the none-selectable case.

---

## 10. i18n (en + de, no hardcoded strings)

Per `CLAUDE.md`, all user-facing text lives in `app/src/lib/i18n.ts` with both
`en` and `de`. Reuse where a good key exists; add where not.

Retire from the invite path (may be left defined if referenced elsewhere, but
no longer shown on this path): `inviteTitle` ("Invite by Npub"),
`inviteNpubLabel`, `inviteNpubPlaceholder`, `inviteHelp`, and the modal's
`scanQr` usage.

Add / adapt:
- `inviteTitle` → retitle to something like "Invite a contact" (de: "Kontakt
  einladen").
- **Contact-picker label** (e.g. "Choose a contact" / de: "Kontakt auswählen").
- **Disabled-reason suffixes**: "already in group" (de: "bereits in der Gruppe")
  and "blocked" (de: "blockiert") — as inline option annotations.
- **Empty-state guidance**: "No contacts available to invite." + a link label to
  the contacts page (de equivalents).
- Keep the existing submit / success / error keys (`inviteSubmit`,
  `inviteSuccess`, `inviteErrorNoKeyPackage`, `inviteErrorOffline`,
  `inviteErrorTimeout`, `inviteErrorGeneric`) — they still apply.

The profile-page dropdown already has a parallel key family
(`profile.addToGroupLabel/Select/Btn/Success/Error`, `i18n.ts:343`) — use it as
a **style/wording template**, but do not overload profile keys for the group
modal; add group-scoped keys.

---

## 11. Affected files (map for the implementer)

| Concern | File(s) |
|---|---|
| Invite modal UI (remove npub/QR, add contact picker + empty state) | `app/src/components/groups/InviteMemberModal.tsx` |
| Selectable-contacts predicate (new; mirror `eligibleGroupsForContact`) | `app/src/lib/contacts.ts` |
| Contacts read (with `includeArchived: true`) | `app/src/lib/contacts.ts` (`listContacts`) |
| Member source / admin gating (unchanged, read-only) | `app/pages/groups.tsx` (`memberPubkeys`, `isAdmin`) |
| Underlying MLS add-member (unchanged) | `app/src/context/MarmotContext.tsx:1477` (`inviteByNpub`) |
| npub encoding for the selected contact | `pubkeyToNpub` (as used at `profile.tsx:636`) |
| Copy | `app/src/lib/i18n.ts` (en + de) |
| E2E infra (primary) | `app/tests/e2e/helpers/group-setup.ts` (drives the npub input; imported by 11 specs) — add the shared "ensure contact, then invite via picker" helper here |
| E2E specs (26 files touch `invite-npub-input`) | See §9 for the full list; all groups/relay-bucket specs plus `dm-*` importers of `group-setup.ts` |
| Unit test — new predicate | `app/tests/unit/contacts-groups.test.ts` (or a sibling) for the new "selectable contacts for a group" predicate |
| Unit test — **existing, will break** | `app/tests/unit/cards/inviteByCard.test.ts` tests `resolveInviteTarget` / `submitInvite` — the exact seam §6 reshapes. Reconcile it (and the S5 "single decode seam" doc-comments those functions carry) with the reshape; do not let it surface as a surprise red test. |

---

## 12. Open questions for the spec author

1. **How do e2e peers become contacts?** Each updated invite spec now needs the
   invitee to be a contact of the inviter *before* the invite. Decide per spec:
   rely on shared-group auto-seeding (may not apply on a first invite), or add
   the contact through the app's add flow first. This is the biggest test-shape
   decision.
2. **Fate of the `invalid_npub` test** (`groups-error-cases.spec.ts:45`). With
   free-text gone, its scenario is unreachable. Replace with a
   disabled-member/disabled-blocked test (recommended) rather than deleting
   coverage.
3. **Predicate home + name.** Add "selectable/eligible contacts for a group" to
   `contacts.ts` as the inverse of `eligibleGroupsForContact`, or compute inline
   in the modal? Prefer a pure, unit-testable helper in `contacts.ts` for parity
   with the existing group-eligibility family.
4. **Dropdown ordering.** Keep `listContacts` order as-is, or float selectable
   contacts above disabled ones? Default: keep as-is; enhancement optional.
5. **Disabled-option rendering in Chakra `<Select>`.** Native `<option disabled>`
   cannot show rich avatars; confirm whether the plain-text "Name (already in
   group)" annotation is acceptable, or whether a richer custom menu is wanted.
   Default: plain-text annotated `<option disabled>`, matching the existing
   profile-page `<Select>` simplicity.
6. **`submitInvite` / `resolveInviteTarget` reshape.** These currently exist to
   parse a free-text string. With a picker supplying a pubkey, decide whether to
   simplify them or keep a thin adapter. Avoid scope creep into unrelated
   contact-card parsing used elsewhere. **Two things must be reconciled, not just
   the code:** (a) `app/tests/unit/cards/inviteByCard.test.ts` tests these exact
   functions and will go red; (b) they carry load-bearing doc-comments from the
   contact-card-exchange epic ("the SINGLE decode seam", DD-1/DD-8). If the
   reshape narrows or removes the seam, update those architecture claims in the
   same change so the docs don't lie. This is the one latent scope risk in the
   feature — fence it explicitly.
