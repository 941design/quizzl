# Manually Add Contact by npub

> **Status (2026-07-10): Manual npub-entry UI REMOVED.** The npub abstraction
> confused new users, so the "Add Contact" button and its `AddContactModal`
> (typed-npub input + in-app QR scanner) were removed from the Contacts page.
> A new trust relationship now begins only two ways: sharing an MLS group, or
> opening a contact-card link (`/add#c=…`, see `epic-contact-card-exchange`) —
> both seed `knownPeers`. An inbound DM is not an admission path: the walled
> garden (`isAllowedDmSender`, `app/src/lib/walledGarden.ts`) drops any DM from
> a sender not already allowed by one of those two, so it only ever surfaces a
> contact the user already shares a (past or present) group with or added by
> card — never a stranger.
> The underlying `addContactByNpub` function and the `knownPeers`-seeding trust
> model (Design Decision 1) are **retained** — the contact-card link path still
> routes through them (via `processContactInput` in
> `app/src/lib/processContactInput.ts`). Only the manual-entry surface and its
> modal-only i18n keys were deleted. The "In Scope" UI items below are
> historical.

## Problem

There is no way to add a contact today unless you already share a group with them (contacts are populated exclusively from group membership, or from inbound DMs — which are themselves only accepted from people you share a group with). A user who has someone's npub from outside the app — a business card, a website, a QR code shared over another channel — has no way to start a conversation with them until they are first added to a shared group.

## Solution

Add an "Add Contact" action, reachable from the Contacts page, that lets a user paste or scan an npub and add that person as a contact immediately — with no group membership required. Once added, the contact behaves like any other contact: they appear in the contacts list, and DMs can be sent to and received from them right away.

## Scope

### In Scope

- An "Add Contact" button on the Contacts page that opens a modal for entering an npub (typed or QR-scanned), modeled on the existing `InviteMemberModal` pattern.
- A new `addContactByNpub` function in `app/src/lib/contacts.ts` that validates the npub, decodes it to a hex pubkey, and persists the contact.
- Marking a manually-added contact as an "ever-known peer" (`knownPeers`) at the moment it is added, so their DM replies are not silently dropped by the walled-garden filter and they are not swept up by `purgeStrangerContacts`.
- Handling the case where the npub belongs to an existing archived contact — unarchive and refresh it rather than erroring.
- Rejecting: malformed npub, the user's own npub, and an npub that is already an active (non-archived) contact — each with a distinct, translated error message.
- English and German i18n for all new UI text.
- Unit tests for `addContactByNpub` covering validation, self-add rejection, duplicate handling, archived-contact re-add, and `knownPeers` seeding.

### Out of Scope

- Fetching a display name or avatar for a manually-added contact from the network (no shared group means no existing profile-lookup mechanism reaches them). They display by shortened npub until a shared group's own profile sync populates their name, exactly as any other unnamed contact does today.
- Any change to how contacts are populated from group membership, or to the "Add to Group" flow on the profile page (`epic-contact-group-context`).
- QR code scanning infrastructure — reuses the existing `NpubQrButton` / `NpubQrModal` components as-is.
- Any change to `isAllowedDmSender` / `walledGarden.ts` itself — the existing groups-OR-knownPeers rule already covers this feature once the pubkey is seeded into `knownPeers`.

## Design Decisions

1. **Manually-added contacts are trusted immediately (seeded into `knownPeers`)** — Without this, a user could send a DM to a manually-added contact, but that contact's replies would be silently dropped by `isAllowedDmSender` (`app/src/lib/walledGarden.ts:53`) because the walled garden only allows senders who share a group or are already in `knownPeers`. The whole point of this feature is a working two-way contact, so the explicit "I am manually adding this person" action is treated as an equivalent trust signal to prior group co-membership (the existing basis for `knownPeers`, per ADR-002). Uses the existing `rememberKnownPeers()` (`app/src/lib/knownPeers.ts:100`), which is already append-only and side-effect-safe.
2. **No new profile-lookup mechanism** — Building a kind-0 metadata fetch for an arbitrary pubkey with no shared group is a materially larger, separate piece of work (nothing in the app fetches profile data outside a shared group today; the existing profile-discovery epic is in-group-only). Deferred; contact displays by shortened npub in the meantime, same as any contact `contactCache` hasn't resolved yet. **[SUPERSEDED by `epic-contact-card-exchange`]** — this deferral is reversed there, but *not* via the relay kind-0 fetch ruled out here (which would violate the "never broadcast profile info" invariant in `CLAUDE.md`); instead via out-of-band signed contact cards.
3. **Re-adding an already-archived contact unarchives it** — If the entered npub matches a contact that already exists but is archived (previously hidden), `addContactByNpub` calls the existing `unarchiveContact` and refreshes `lastSeenAt` rather than surfacing a duplicate error. This reuses existing behavior (`app/src/lib/contacts.ts:125`) instead of introducing a new state.
4. **Duplicate/self rejections are validation errors, not silent no-ops** — An already-active contact or the user's own npub produce a distinct, visible error (`already_exists`, `self`) so the user understands why nothing happened, consistent with `InviteMemberModal`'s error-code pattern.
5. **UI modeled directly on `InviteMemberModal`** — Same npub `Input` + `NpubQrButton`/`NpubQrModal` + typed-error-code pattern (`app/src/components/groups/InviteMemberModal.tsx:34`), for consistency and to avoid inventing a new interaction pattern for what is functionally the same "enter or scan an npub" action.
6. **No outbound DM gate to remove** — Confirmed `ContactChat`'s `sendMessage` has no walled-garden check today; any contact (manually added or not) can already be messaged. This feature only needs to ensure *replies* are not dropped, which Design Decision 1 covers.
7. **Maintainer pubkeys are an accepted edge case** — `ContactListView` filters out maintainer pubkeys via `isMaintainerPubkey` (`pages/contacts.tsx:60`) regardless of how the contact entry was created. If a user manually adds a maintainer's own npub, `addContactByNpub` succeeds and the entry is stored, but it will not appear in the rendered list — same as it wouldn't for a group-derived maintainer contact today. Not worth a special case for this epic.

## Constrained by ADRs

- **ADR-002** (Mutual contact graph and pull-only invitations) — its `knownPeers` mechanism was designed around a *mutual* trust basis: a peer becomes ever-known only after a reciprocal group co-membership event (a Welcome the local user actively accepted). Its own "Evolution Triggers" section explicitly names *"the product introduces a concept of 'trusted contacts' managed outside of group membership"* as a future event requiring reconsideration — which is exactly this epic.
- **ADR-005** (Extend ever-known-peers trust to manually-added contacts) — records the decision this epic exercises: manually-added contacts are folded into the same `knownPeers` set as group-derived ones, on the judgment that explicit user intent ("I chose to add this specific npub") is an acceptable, if unilateral rather than mutual, trust signal for a local address book. **This is a real precedent change to the security trust model** — see the ADR for alternatives considered and accepted risks.

## Technical Approach

### `app/src/lib/contacts.ts`

Add:

```ts
export type AddContactResult =
  | { ok: true; pubkeyHex: string; reactivated: boolean }
  | { ok: false; error: 'invalid_npub' | 'self' | 'already_exists' };

export function addContactByNpub(
  npub: string,
  ownPubkeyHex: string | null | undefined,
): AddContactResult
```

- Decodes `npub` via `npubToPubkeyHex` (`app/src/lib/nostrKeys.ts:85`); returns `{ ok: false, error: 'invalid_npub' }` on `null`.
- Returns `{ ok: false, error: 'self' }` if the decoded pubkey (case-insensitive) equals `ownPubkeyHex`.
- Reads existing contact via `readStoredContacts()`. If an active (non-archived) entry exists for this pubkey, returns `{ ok: false, error: 'already_exists' }`.
- If an archived entry exists, calls `rememberKnownPeers([pubkeyHex])` first, then `unarchiveContact(pubkeyHex)`, then `rememberContact(pubkeyHex)` to bump `lastSeenAt` — same ordering rationale as the new-contact case below (avoids a window where the contact is unarchived in storage but not yet in `knownPeers`, which a concurrent purge sweep could delete). Returns `{ ok: true, pubkeyHex, reactivated: true }`.
- Otherwise calls `rememberKnownPeers([pubkeyHex])` (imported from `app/src/lib/knownPeers.ts`) before `rememberContact(pubkeyHex)` — seeding `knownPeers` first ensures no window where the contact exists in storage but would still be dropped by a concurrent purge sweep. Returns `{ ok: true, pubkeyHex, reactivated: false }`.

### `app/src/components/contacts/AddContactModal.tsx` (new)

Directly modeled on `InviteMemberModal.tsx`: npub `Input` + `NpubQrButton`/`NpubQrModal` + submit button calling `addContactByNpub`. Maps `AddContactResult.error` to translated copy the same way `InviteMemberModal`'s `getErrorMessage` does. On success, closes after a brief success state and signals the contacts page to refresh (same `contactsRevision` bump pattern already used in `pages/contacts.tsx`).

### `pages/contacts.tsx`

- Add an "Add Contact" `Button` (`data-testid="add-contact-btn"`) in the page header area, opening `AddContactModal` via `useDisclosure`.
- On the modal's success callback, bump `contactsRevision` so the newly-added contact appears in the list immediately (same mechanism already used after `rememberContactsFromGroups`).

### `app/src/lib/i18n.ts`

Add to the `contacts` section (English + German): `addContactBtn`, `addContactTitle`, `addContactNpubLabel`, `addContactNpubPlaceholder`, `addContactHelp`, `addContactSubmit`, `addContactCancel`, `addContactSuccess`, `addContactErrorInvalidNpub`, `addContactErrorSelf`, `addContactErrorAlreadyExists`, `addContactErrorGeneric`.

Also **amend** two pre-existing keys (en+de) that currently assert group membership is the only way to get a contact, which becomes misleading once the "Add Contact" button sits right above them: `contacts.description` ("People from your shared groups stay here...") and `contacts.emptyBody` ("Join a group with someone and they will appear here."). Reword both to also mention adding a contact directly by npub. Exact wording is the implementer's call.

## Stories

- **S1 — `addContactByNpub` core logic** — New function in `contacts.ts`, wired to `knownPeers` seeding and archived-contact reactivation. Covers AC-STRUCT-1, AC-STRUCT-2, AC-ERR-1 through AC-ERR-3, AC-SEC-1 through AC-SEC-3.
- **S2 — Add Contact UI** — `AddContactModal` component, contacts-page wiring, i18n. Covers AC-UX-1 through AC-UX-6, AC-INTL-1.

## Acceptance Criteria

See [`acceptance-criteria.md`](./acceptance-criteria.md).

## Relationship to Other Epics

- **epic-contact-group-context** — That epic's "Add to Group" UI already assumes `getContact()` can return non-null for any stored contact; this epic is the first feature to *populate* the contact store independently of group membership, so contacts added here become eligible for that flow immediately (add them to a group later, same as any other contact).
- **epic-walled-garden-v2 / epic-dm-walled-garden** — Reuses the existing `knownPeers` "ever-known peers" mechanism as the trust signal for a manually-added contact's inbound replies, rather than introducing a new gate or bypass.
- **epic-member-profile-discovery-and-relay-on-behalf** — Explicitly not reused/extended here (see Design Decision 2); that mechanism remains in-group-only.

## Non-Goals

- Building general-purpose stranger profile discovery (fetching kind-0 metadata for arbitrary pubkeys outside any shared group) is not this project's current direction; this epic ships without it.
- Changing the walled-garden trust model's underlying rules (`isAllowedDmSender`) — this epic only adds a new, existing-mechanism (`knownPeers`) seed point.
