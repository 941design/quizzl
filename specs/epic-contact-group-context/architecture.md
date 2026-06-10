# Architecture — Contact Group Context

## Paradigm

Modular monolith, package-by-feature. Next.js pages-router static export. UI in `app/pages/`, domain logic in `app/src/lib/`, shared React context in `app/src/context/`.

## Module map

| Module | Purpose | Location | Owned data |
|---|---|---|---|
| contacts-lib | Contact storage + derivation helpers | `app/src/lib/contacts.ts` | `commonGroups()` (new pure helper) |
| contacts-page | Contacts list + detail views | `app/pages/contacts.tsx` | rendering |
| profile-page | Contact profile view | `app/pages/profile.tsx` | rendering, add-to-group state |
| i18n | UI copy | `app/src/lib/i18n.ts` | new `contacts.commonGroups`, `profile.addToGroup*` keys |
| marmot-context | Group data + invite (read-only consumer) | `app/src/context/MarmotContext.tsx` | unchanged — consumed via `useMarmot()` |

## Boundary rules

- No direct imports across module boundaries except through existing public surfaces (`useMarmot()`, `useCopy()`, `pubkeyToNpub()`).
- `commonGroups()` is a pure function (no React, no storage) so it is unit-testable in isolation.
- Casing: all pubkey comparisons against `group.memberPubkeys` are case-insensitive (`.toLowerCase()`), consistent with `MarmotContext.tsx:511`.

## Seams

- `useMarmot().groups: Group[]` — synchronous read; no async loading needed.
- `useMarmot().inviteByNpub(groupId, npub)` — returns `{ ok, error?, warning? }`.

## Implementation constraints

- No new npm dependencies (AC-STRUCT-2).
- Chakra `<Select>` used for the group dropdown (existing pattern: `AvatarBrowserModal.tsx:117`).
- Every interactive/display element carries a `data-testid`.
- Both `en` and `de` i18n entries added simultaneously (TS type enforces).
