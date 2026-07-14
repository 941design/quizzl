# Architecture — Invite Group Member from Contacts

## Paradigm

Modular monolith, package-by-feature, with a pure-logic core isolated
from React/NDK/storage and thin adapters at I/O edges. Convention-enforced
via doc-comments (no DI framework/ports-and-adapters abstraction). This
matches all three most-relevant prior epics
(`epic-contact-card-exchange`, `epic-block-contact`,
`epic-direct-contact-profile-exchange`) and this epic's own shape follows
it exactly: one new pure predicate in `contacts.ts`, a thin UI reshape in
a modal component, zero changes to the MLS/relay layer.

## Module map

| Module | Purpose | Location | Owned data |
|---|---|---|---|
| Contact eligibility predicates | Pure functions partitioning contacts by group-relationship | `app/src/lib/contacts.ts` | None (reads `StoredContact`/`ContactCacheMap` via `listContacts`) |
| Invite modal UI | Contact picker, disabled-state rendering, guidance empty state, submit orchestration | `app/src/components/groups/InviteMemberModal.tsx` | Local component state only |
| Contact-card decode seam | Single down-conversion point for any npub/card input across the app | `app/src/lib/contactCard.ts` (`parseContactCard`) | None — pure parse |
| MLS add-member | Key-package fetch + MLS commit (unchanged by this epic) | `app/src/context/MarmotContext.tsx` (`inviteByNpub`) | MLS group state |
| i18n copy | User-facing strings (en/de) | `app/src/lib/i18n.ts` | None |
| E2E seeding infra | Shared "ensure contact, then invite via picker" helper | `app/tests/e2e/helpers/group-setup.ts` | Test-only |

## Boundary rules

- No direct imports across module boundaries. Cross-module access only
  through declared seam contracts (`listContacts`, `inviteByNpub`,
  `parseContactCard`).
- `contacts.ts` stays free of React/NDK/relay imports — the new
  "selectable contacts for a group" predicate must be pure
  (`(contacts: ContactListItem[], group: { memberPubkeys: string[] }) =>
  {...}`), matching `eligibleGroupsForContact`/`addableGroupsForContact`.
- `InviteMemberModal.tsx` is the only file that may change UI/JSX for this
  epic. It composes the new predicate + `listContacts` + `inviteByNpub`;
  it does not reach into `MarmotContext.tsx` internals.
- `parseContactCard` (`contactCard.ts`) remains the single decode seam for
  any npub/card input anywhere in the app (DD-1 of
  `epic-contact-card-exchange/architecture.md`). This epic's picker
  narrows the *modal's* entry point to a pubkey sourced from a stored
  contact — it does not touch, remove, or duplicate the seam itself.
  `resolveInviteTarget`/`submitInvite` in `InviteMemberModal.tsx` remain
  thin callers, reshaped to accept a pubkey directly instead of parsing
  free text.
- `inviteByNpub` stays npub/pubkey-only (DD-8 of
  `epic-contact-card-exchange/architecture.md`) — this epic does not
  change its signature, error mapping, or MLS behavior.
- Privacy invariant (CLAUDE.md): the contact dropdown is a pure local read
  (`listContacts` reads only `localStorage`); it triggers no relay fetch
  and no public event. `inviteByNpub`'s existing key-package fetch (relay
  read) and MLS commit (encrypted, group-addressed) are the only network
  operations, both pre-existing and unchanged.

## Seams

- **`contacts.ts` → `InviteMemberModal.tsx`**: new pure predicate,
  consumed by the modal to build picker options. Contract: input
  `listContacts(ownPubkeyHex, { includeArchived: true })` output +
  `group.memberPubkeys`; output a partition of
  `{ contact, selectable: boolean, disabledReason?: 'already_member' |
  'blocked' }` preserving `listContacts` order.
- **`InviteMemberModal.tsx` → `MarmotContext.inviteByNpub`**: unchanged
  contract, `(groupId: string, npub: string) => Promise<{ ok: boolean;
  error?: string }>`. The modal now derives `npub` via `pubkeyToNpub` from
  the picker-selected contact's `pubkeyHex`, instead of parsing free text.
- **`group-setup.ts` → app UI**: new shared e2e helper drives the real
  add-contact production path (`page.goto('/add#c=' + npub)`, confirmed
  to accept a bare npub) before driving the picker, replacing the direct
  `invite-npub-input` fill.

## Product-behavior note (confirmed, not a defect)

There is no self-service "add contact by npub" UI in the current app —
that manual-entry screen was removed in a prior epic. Contacts are
established only via a mutual contact-card handshake (sharing a profile
card / pairing code) or via shared-group auto-seeding. This is confirmed,
intentional current behavior (user-confirmed during this epic's
planning). The invite modal's guidance-empty-state copy must describe
this mechanism accurately rather than implying a self-service form exists
on `/contacts`. See spec.md Design Decisions 1 and 6.

## Implementation constraints

- Native Chakra `<Select>`, plain-text disabled `<option>` annotations —
  no rich/avatar rendering (no existing precedent for either avatars or
  disabled options in a Chakra `<Select>` anywhere in this codebase; both
  are new but low-risk, matching the profile-page picker's simplicity
  otherwise).
- `submitInvite`/`resolveInviteTarget` reshape must stay a thin adapter
  (DD-11) — narrow scope to pubkey-in, npub-out; do not touch
  `contactCard.ts` or other `parseContactCard` call sites.
- `app/tests/unit/cards/inviteByCard.test.ts` MUST be updated in the same
  story as the reshape (not deferred) — its 9 tests currently exercise
  free-text/card-parsing behavior that the picker removes.
- E2E: one shared seeding helper in `group-setup.ts`, consumed by all 25
  directly-affected specs + reached transitively by the 11
  `group-setup.ts` importers. No per-spec ad-hoc seeding logic.
