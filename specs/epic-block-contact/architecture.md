# Architecture — Block Contact

## Paradigm

Modular monolith, package-by-feature (the app's existing shape). Block is a **cross-cutting
deny layer** composed at each DM enforcement seam — it is NOT a new module that owns a new
data store. The single source of truth is the existing `StoredContact.archivedAt` field
(DD-1); "blocked" is a derived view over the contacts store, never a second flag.

## Module map

| Module | Location | This epic's change | Owned data |
|---|---|---|---|
| block core / blocklist | `app/src/lib/blockedPeers.ts` (new) or alongside `contacts.ts` | `isBlockedPeer` pure predicate + `loadBlockedPeers()` reader (localStorage-only, `knownPeers.ts`-style isolation) | derives block-set from `lp_contacts_v1`; owns no new storage |
| walled garden | `app/src/lib/walledGarden.ts` | UNCHANGED body (stays pure, AC-SEC-13). May extend `WhitelistArgs` type with `blockedPeers` for sweep call sites | pure predicates only |
| contacts | `app/src/lib/contacts.ts` | remove silent-unblock in `addContactByNpub` (DD-9) | `lp_contacts_v1` |
| DM notifications | `app/src/lib/directMessageNotifications.ts` + `DirectMessageNotificationsWatcher.tsx` | compose block into the injected `isAllowedSender` seam; inject a live `blockedPeers` ref | — |
| chat view | `app/src/components/contacts/ContactChat.tsx` | defensive composite gate at 4 ingestion sites; Blocked-aware composer suppression | — |
| chat persistence | `app/src/lib/marmot/chatPersistence.ts`, `app/src/lib/unreadStore.ts` | reuse `clearMessages` + `clearDirectMessageContact` for single-peer wipe (no new sweep) | idb-keyval DM threads, unread store |
| contacts page | `app/pages/contacts.tsx` `ContactDetailView` | Blocked banner state replacing composer; direct-URL gate | — |
| profile page | `app/pages/profile.tsx` `handleArchiveToggle` | confirm dialog before block; trigger history wipe + revision bump | — |
| context | `app/src/context/MarmotContext.tsx` | expose + bump a block revision so DM surfaces observe block/unblock reactively | context value |
| i18n | `app/src/lib/i18n.ts` | en + de copy for Block/Blocked/Unblock, blocked notice, hidden-filter controls, confirm-dialog copy | — |

## Boundary rules

- No direct imports across module boundaries beyond existing patterns. Cross-module access
  only through declared seams.
- **`isAllowedDmSender` stays pure** (AC-SEC-13 / DD-8). The block predicate is a *separate*
  pure function; the composite `allow AND NOT block` is assembled at each caller, never inside
  the allow function's body.
- **DM storage keys** are always `directConversationId(peer)` (`dm:<peerHexLower>`), never
  hand-built (convention; enforced by exploration).
- **Pubkey comparisons are case-insensitive** — the block-set is lowercase-normalized on
  derivation (prior learning: StoredContact keys are lowercase only by transitive guarantee,
  not explicit normalization).

## Seams (populated by planner as stories are split)

1. **`blockedPeers` set → live DM surfaces.** Producer: block-set reader over the contacts
   store + a MarmotContext revision counter. Consumers: `DirectMessageNotificationsWatcher`
   (ref), `ContactChat` (ref), the sweep call sites (`WhitelistArgs` bag). Contract:
   `ReadonlySet<string>` of lowercase-hex pubkeys, refreshed on revision bump without
   subscription teardown.
2. **Composite gate.** `isAllowedDmSender(...) && !isBlockedPeer(peer, blockedPeers)`. Applied
   at every inbound + outbound DM gate. Deny wins over allow.
3. **Block action → history wipe + revision bump.** `handleArchiveToggle` (block branch,
   post-confirm) calls `clearMessages(directConversationId(peer))` +
   `clearDirectMessageContact(peer)`, sets `archivedAt`, and bumps the block revision.

## Implementation constraints

- **Privacy invariant (mandatory):** no code path added here may publish/sync/leak the block
  set or deleted history to any unaddressed audience. No kind-0, no kind-10000, no public
  event as a side effect of block/unblock. Block state lives only in localStorage; deleted
  history only ever existed in local idb-keyval.
- **Static export:** views stay query-param based (`/contacts?id=`), no new dynamic path
  segments (project rule).
- **i18n:** no hardcoded user-visible strings; en + de both updated via `useCopy()`.
- **Storage-failure resilience:** the block must still filter even if the history-delete write
  fails (log, do not crash — mirror `contacts.ts` silent-failure handling).
- **Testing:** unit tests are vitest, no jsdom/@testing-library; pure predicates get AC-ID'd
  describe blocks. e2e peer sends go through `window.__fewPublishDm`, never raw WebSocket; new
  block specs land in the groups/relay bucket.
