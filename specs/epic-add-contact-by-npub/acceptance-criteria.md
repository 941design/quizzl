# Manually Add Contact by npub — Acceptance Criteria

## Terminology

- **manually-added contact** — a `StoredContact` entry created via `addContactByNpub`, as opposed to one created via `rememberContactsFromGroups` or the DM-inbound pipeline.
- **active contact** — a `StoredContact` entry with `archivedAt` null/absent (not hidden).
- **ever-known peer** — a pubkey present in the `knownPeers` set (`app/src/lib/knownPeers.ts`), which `isAllowedDmSender` treats as a trusted DM sender regardless of current group membership.

## Behavioral vs. Structural Observables

Each AC below asserts an externally observable outcome (a returned result shape, a persisted storage entry, a rendered UI state) — not merely that a function or file exists.

## Known TAGs

- **STRUCT** — structural assertions about the `addContactByNpub` function and its return shape.
- **ERR** — validation/rejection-path assertions.
- **SEC** — walled-garden / `knownPeers` interaction assertions.
- **UX** — contacts-page and modal behavior assertions.
- **INTL** — translation coverage assertions.

## `addContactByNpub` core logic (S1)

**AC-STRUCT-1** — Calling `addContactByNpub(npub, ownPubkeyHex)` with a valid npub that has no existing contact entry MUST return `{ ok: true, pubkeyHex, reactivated: false }` where `pubkeyHex` is the hex decoding of `npub`, AND MUST create a new entry in `readStoredContacts()` keyed by that `pubkeyHex` with `archivedAt` null.

**AC-STRUCT-2** — Calling `addContactByNpub` with a valid npub whose decoded pubkey matches an existing **archived** contact MUST return `{ ok: true, pubkeyHex, reactivated: true }`, AND the contact's `archivedAt` in `readStoredContacts()` MUST become null (unarchived), AND its `lastSeenAt` MUST be updated to the call time.

**AC-ERR-1** — Calling `addContactByNpub` with a string that is not a valid NIP-19 `npub` (fails `npubToPubkeyHex` decoding) MUST return `{ ok: false, error: 'invalid_npub' }` AND MUST NOT create or modify any entry in `readStoredContacts()`.

**AC-ERR-2** — Calling `addContactByNpub` with an npub whose decoded pubkey equals `ownPubkeyHex` (case-insensitive) MUST return `{ ok: false, error: 'self' }` AND MUST NOT create or modify any entry in `readStoredContacts()`.

**AC-ERR-3** — Calling `addContactByNpub` with an npub whose decoded pubkey matches an existing **active** (non-archived) contact MUST return `{ ok: false, error: 'already_exists' }` AND MUST NOT modify that contact's `lastSeenAt` or any other field.

**AC-SEC-1** — After a successful call to `addContactByNpub` (`ok: true`, whether reactivated or new), the decoded `pubkeyHex` MUST be present in the `knownPeers` set as read by `loadKnownPeers()` (`app/src/lib/knownPeers.ts`).

**AC-SEC-2** — After a successful call to `addContactByNpub` with `groups: []` (no shared groups) and the newly-added pubkey as the only entry in `knownPeers`, `isAllowedDmSender(pubkeyHex, [], knownPeers, ownPubkeyHex)` MUST return `true`.

**AC-SEC-3** — After a successful call to `addContactByNpub`, running `purgeStrangerContacts(getWhitelist)` — where `getWhitelist()` returns the current `groups` (still not containing the new contact) and the current `knownPeers` (containing the new contact's pubkey) — MUST NOT delete the manually-added contact's entry from either `lp_contacts_v1` or `lp_contactCache_v1`.

## Add Contact UI (S2)

**AC-UX-1** — The Contacts page (`pages/contacts.tsx`) MUST render a button with `data-testid="add-contact-btn"` that opens `AddContactModal` when clicked.

**AC-UX-2** — Submitting `AddContactModal` with a valid, not-yet-known npub MUST result in the corresponding pubkey appearing in the rendered contacts list (`listContacts`) without a full page reload.

**AC-UX-3** — Submitting `AddContactModal` with an invalid npub string MUST render an error `Alert` (`data-testid="add-contact-error"`) with copy corresponding to `contacts.addContactErrorInvalidNpub`, and MUST NOT close the modal.

**AC-UX-4** — Submitting `AddContactModal` with the current user's own npub MUST render an error `Alert` with copy corresponding to `contacts.addContactErrorSelf`.

**AC-UX-5** — Submitting `AddContactModal` with an npub belonging to an already-active contact MUST render an error `Alert` with copy corresponding to `contacts.addContactErrorAlreadyExists`.

**AC-UX-6** — Submitting `AddContactModal` with an npub belonging to an existing **archived** contact MUST result in that contact appearing in the default (non-archived, `showHidden=false`) rendered contacts list without a full page reload.

## Cross-Cutting Invariants

**AC-INTL-1** — Every new copy key introduced under the `contacts` section for this feature (`addContactBtn`, `addContactTitle`, `addContactNpubLabel`, `addContactNpubPlaceholder`, `addContactHelp`, `addContactSubmit`, `addContactCancel`, `addContactSuccess`, `addContactErrorInvalidNpub`, `addContactErrorSelf`, `addContactErrorAlreadyExists`, `addContactErrorGeneric`) MUST have both an `en` and a `de` entry in `app/src/lib/i18n.ts`.

## Manual Validation

| MV id | Behavioral intent | Owner | Blocked on |
|-------|-------------------|-------|------------|
| MV-1 | QR-scanning an npub via `NpubQrButton`/`NpubQrModal` inside `AddContactModal` correctly populates the input and allows submission, on a real device camera | human | AC-UX-1 |
