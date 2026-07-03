# Architecture — Manually Add Contact by npub

## Paradigm

Modular monolith. Package-by-feature for module layout. Hexagonal seams at external boundaries. (Matches `specs/epic-walled-garden-v2/architecture.md` and `specs/epic-contact-group-context/architecture.md`.)

Strict import hierarchy — enforced boundary:

```
pages/  →  components/  →  context/  →  lib/
```

`lib/` never imports from `context/` or `components/`. `lib/ → lib/` imports are allowed (and already used: `contacts.ts` imports `walledGarden.ts`).

## Module map

| Module | Purpose | Location | Owned data |
|---|---|---|---|
| `contacts` | Contact storage + derivation. **This epic adds `addContactByNpub`.** | `app/src/lib/contacts.ts` | `localStorage['lp_contacts_v1']` (`StoredContact` map) |
| `knownPeers` | Ever-known-peers trust set. **This epic adds a new call site (`rememberKnownPeers`), no code change to the module itself.** | `app/src/lib/knownPeers.ts` | `localStorage['lp_knownPeers_v1']` |
| `walledGarden` | Pure DM-sender whitelist predicate. **Unmodified** — reused, not changed. | `app/src/lib/walledGarden.ts` | none (pure) |
| `nostrKeys` | npub↔hex encode/decode. **Unmodified** — `npubToPubkeyHex` reused. | `app/src/lib/nostrKeys.ts` | none (pure) |
| `AddContactModal` | **New component.** npub input + QR scan + submit, modeled on `InviteMemberModal`. | `app/src/components/contacts/AddContactModal.tsx` | local React state only |
| `contacts page` | **Modified.** Adds "Add Contact" button + modal wiring, `contactsRevision` bump on success. | `app/pages/contacts.tsx` | local React state only |
| `i18n` | **Modified.** New `contacts.*` copy keys (en+de); reword 2 existing keys. | `app/src/lib/i18n.ts` | none |

## Boundary rules

- No direct imports across module boundaries except through declared public exports. `addContactByNpub` calls `rememberKnownPeers` via the `knownPeers.ts` public export — lib→lib, same pattern as the existing `contacts.ts → walledGarden.ts` import. No circular-import risk (nothing in `lib/` imports from `context/`).
- `walledGarden.ts`'s `isAllowedDmSender` signature and purity (ADR-002 AC-SEC-13) MUST NOT change. This epic seeds `knownPeers` so the existing predicate returns `true`; it does not alter the predicate.
- `AddContactModal` reuses `NpubQrButton` / `NpubQrModal` as-is (no changes to QR infrastructure).

## Seams

- **`addContactByNpub(npub, ownPubkeyHex) → AddContactResult`** — the single new seam between the UI (S2) and storage/trust logic (S1). S2 depends only on this function's return-shape contract (`{ ok: true, pubkeyHex, reactivated } | { ok: false, error }`), not on its internals. This lets S1 be fully unit-tested independently of the modal (which has no test precedent in this repo).

## Implementation constraints

- **knownPeers-seeding order (both success branches):** `rememberKnownPeers([pubkeyHex])` MUST be called before any write to the contacts store (`rememberContact` / `unarchiveContact`), to eliminate a window where the contact exists in storage but not in `knownPeers` — a concurrent `purgeStrangerContacts` sweep (e.g. from a second tab sharing `localStorage`) would delete it otherwise. (Spec Design Decision 1; validator HIGH finding.)
- **Unit tests (S1 only):** Vitest, `app/tests/unit/`. `addContactByNpub` tests follow `contacts.test.ts` localStorage-mock convention; a `<feature>.i18n.test.ts` file asserts exact en+de values for the new keys. S2 (`AddContactModal`) has no component-test precedent (zero `.test.tsx` in repo) and gets no unit test — matching spec scope.
- **No new e2e spec by default.** Feature is local-only (npub → localStorage, no relay/group). CLAUDE.md's e2e gate is the full 48-test suite regardless; adding a 49th spec would change that baseline and needs sign-off. Regression coverage comes from the existing suite.
- **JSDoc:** `addContactByNpub` follows the JSDoc style of the existing `contacts.ts` derivation functions (documents case-insensitivity, ordering, and side effects).
