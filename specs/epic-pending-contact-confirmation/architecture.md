# Architecture — Pending Contact Confirmation for Contact-Card Pairing

## Paradigm

Modular monolith, package-by-feature (existing project convention). No new
module boundary is introduced by this epic — it extends three existing
modules (`contacts.ts`, `pairingAck.ts`, `unreadStore.ts`) and one existing
UI surface (`contacts.tsx` / `ContactChat.tsx`), following the pure-predicate
hexagonal-seam discipline already established by `blockedPeers.ts`
(storage-free predicate functions, composed only at call sites, never
folded into `isAllowedDmSender`).

## Module map

| Module | Purpose (this epic) | Directory | Owned data |
|---|---|---|---|
| `contacts.ts` | `StoredContact.pendingConfirmationSince` field, `confirmContact()`, pending-admission primitive, `selectableContactsForGroup` precedence extension, the shared pending predicate | `app/src/lib/contacts.ts` | `lp_contacts_v1` (localStorage) |
| `pairingAck.ts` | Swaps `handlePairingAck`'s Step 9 admission call to the new pending-admission primitive | `app/src/lib/pairing/pairingAck.ts` | none (orchestration only) |
| `directMessageNotifications.ts` | Bell-bump gate on the pending predicate | `app/src/lib/directMessageNotifications.ts` | none (reads via predicate) |
| `unreadStore.ts` | Bell reconciliation on confirm, reusing `initDirectMessageCounts` | `app/src/lib/unreadStore.ts` | in-memory unread state + `lp_dmLastRead_v1`-style keys |
| `contacts.tsx` / `ContactDetailView` | Three-way branch (blocked / pending / normal), new reactive revision counter, pending badge + confirm action, contacts-list badge | `app/pages/contacts.tsx` | none (reads via `getContact`) |
| `i18n.ts` | New `Copy` keys (en/de) for pending badge, confirm prompt, confirm action | `app/src/lib/i18n.ts` | n/a |

## Boundary rules

- No direct imports across module boundaries beyond what already exists.
  Cross-module access only through declared seam contracts (below).
- The new pending predicate (AC-STRUCT-3) is exported from exactly one
  place in `contacts.ts` and imported everywhere it's needed — never
  re-derived inline at a call site.
- The pending predicate MUST NOT call, or be folded into,
  `isAllowedDmSender` / `isBlockedPeer` / `isAllowedDmSenderComposite`
  (`blockedPeers.ts`) — documented ADR-008 exception (spec.md Design
  Decision 5). It is a second, orthogonal gate applied only at the
  render/bell layer, never at the ingestion layer.
- `rememberKnownPeers` and the existing `shouldIngestRumor` /
  `shouldIngestDmFromSender` ingestion gates in `ContactChat.tsx` are not
  modified by this epic.

## Seams

- **`contacts.ts` → `pairingAck.ts`**: the pending-admission primitive
  (new export from `contacts.ts`) replaces `rememberContact` at
  `pairingAck.ts:439` for brand-new senders only; re-pairing of an existing
  sender continues to preserve `pendingConfirmationSince` exactly as
  `archivedAt` is already preserved.
- **`contacts.ts` → `directMessageNotifications.ts`**: the shared pending
  predicate is imported and checked before both `incrementDirectMessage`
  calls (`directMessageNotifications.ts:94`, `:138`).
- **`contacts.ts` → `contacts.tsx`**: `ContactListItem.isPendingConfirmation`
  (new derived field, mirrors `isArchived`) drives both the contacts-list
  badge and `ContactDetailView`'s three-way branch; `confirmContact` is
  called from the new confirm-prompt component.
- **`unreadStore.ts` → `contacts.tsx` / confirm action**: the confirm
  action's completion triggers `initDirectMessageCounts([peer],
  ownPubkeyHex)` (existing batch API, called with a one-element array) to
  reconcile the bell, reading persisted history via
  `directConversationId(peerHex)` + `chatPersistence.ts#loadMessages`.
- **New reactive counter**: `contacts.tsx` needs a
  `pendingConfirmationRevision`-equivalent to `blockedPeersRevision` so
  `ContactDetailView`'s `contact` derivation re-runs reactively when
  `confirmContact` fires in the same session (no existing precedent for
  this counter — S1/S2 must introduce it; a story-planner decision on
  exactly where it lives, e.g. a small local `useState` bump in
  `contacts.tsx` vs. a `MarmotContext`-hosted counter like
  `blockedPeersRevision`, is left to the implementing architect).

## Implementation constraints

- Every new/changed function in `contacts.ts` must preserve the module's
  existing case-insensitive-key-matching discipline (`addContactByNpub`'s
  `matchingKeys` pattern, `contacts.ts:399`) — stored keys are not
  guaranteed lowercase (see prior learning
  `storedcontact-keys-lowercase-only-via-transitive` in `exploration.json`).
- No change to `isAllowedDmSender`'s purity/signature (AC-SEC-13, inherited
  project invariant) and no change to `knownPeers`/`rememberKnownPeers`.
- All new user-visible strings go through `i18n.ts` with both `en` and `de`
  entries (project convention, CLAUDE.md).
- Unit tests follow this repo's no-jsdom, hand-rolled-localStorage-mock,
  pure-function-call convention (see `exploration.json`'s
  testing-and-conventions findings) — no `renderHook`/`@testing-library`.
- e2e coverage extends the existing two-browser-context
  `dm-pairing-*.spec.ts` pattern (`bootIdentity`, `getShareCardLink`,
  `waitForAdmission` helpers), driving every action through the real app
  UI, never raw WebSocket (project CLAUDE.md e2e rule).
