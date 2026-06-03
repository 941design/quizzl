# DM Walled Garden — Epic Architecture

## Paradigm

Modular monolith. Layer order: `types/` → `lib/` → `context/` → `components/`. Dependencies flow strictly down this chain; no reverse imports.

## Module Map

| Module | Purpose | Location | Notes |
|--------|---------|----------|-------|
| `walledGarden.ts` | Whitelist computation — pure `isAllowedDmSender` function | `app/src/lib/walledGarden.ts` | **New.** Zero IDB, NDK, React deps. |
| `directMessageNotifications.ts` | Global bell watcher — kind-4 and kind-1059 ingest → unread increment | `app/src/lib/directMessageNotifications.ts` | Modified: add whitelist gate before rememberContact/incrementDirectMessage in both handlers |
| `contacts.ts` | Contact-list writes (`rememberContact`, `rememberContactsFromGroups`) | `app/src/lib/contacts.ts` | Modified: `rememberContact()` gains central whitelist gate (DD-6) |
| `ContactChat.tsx` | Per-thread rendering; `handleHistoricalGiftWrapEvent`, `handleKind4Event`, `handleGiftWrapEvent` | `app/src/components/contacts/ContactChat.tsx` | Modified: add whitelist gate before appendMessage/upsertMessages in all three handlers; gate kind-7 dispatch |
| `chatPersistence.ts` | IDB R/W for chat messages; owns `quizzl:messages:dm:*` key space | `app/src/lib/marmot/chatPersistence.ts` | Modified: new export `purgeStrangerDmThreads(getWhitelist)` |
| `unreadStore.ts` | Module-singleton unread counters; DM counts keyed by peerPubkeyHex.toLowerCase() | `app/src/lib/unreadStore.ts` | Modified: new export `purgeStrangerDmCounters(getWhitelist)` using `clearDirectMessageContact()` internally |
| `reactions/api.ts` | Reaction aggregate persistence; owns `quizzl:reactions:dm:*` key space | `app/src/lib/reactions/api.ts` | Modified: new export `purgeStrangerDmReactions(getWhitelist)` following `clearAllReactions()` pattern |
| `contacts.ts` (purge) | Contact-list and contact-cache entries | `app/src/lib/contacts.ts` | New export `purgeStrangerContacts(getWhitelist)` that walks STORAGE_KEYS.contacts and STORAGE_KEYS.contactCache |
| `MarmotContext.tsx` | Owns MLS group state; lifecycle events for boot and membership changes | `app/src/context/MarmotContext.tsx` | Modified: wire purge sweep after group hydration + on every membership change |
| `directMessages.ts` | NIP-17/59 crypto; `shouldIngestRumor`, `unwrapAndOpen`, `publishDirectMessage` | `app/src/lib/directMessages.ts` | Unchanged (AC-SEC-9, AC-SEC-10) |

## Boundary Rules

- No direct imports across module boundaries. Cross-module access only through declared seam contracts.
- `walledGarden.ts` MUST NOT import from `context/`, `components/`, IDB, NDK, or any React module — it is a pure computation.
- `purge*` helpers in `lib/` MUST NOT import from `context/` or `components/` — they receive a `getWhitelist` function as a parameter and call it; the wiring lives in MarmotContext.
- `rememberContact()` in `contacts.ts` MUST NOT import from `context/` — it receives the whitelist state via a parameter or injected accessor decided by the architect.

## Seams

The following cross-story dependency seams are load-bearing. Later stories depend on earlier ones completing them.

### Seam 1 — `isAllowedDmSender` function signature (S1 → S2, S3)

S1 defines and exports `isAllowedDmSender(peerHex, groups, ownPubkeyHex)`. S2 and S3 import and call it. S1 must be implemented before S2 or S3 can implement their gates/purges.

### Seam 2 — `rememberContact` whitelist gate wiring (S1 → S2)

S1 also gates `rememberContact()`. S2 calls `rememberContact` from the bell watcher — after S1 lands, the gate is already there and S2 can rely on it without duplicating it.

### Seam 3 — `purge*` helper exports (S3 → MarmotContext wiring in S3)

S3 both defines and wires the purge helpers into MarmotContext. There is no inter-story seam here — S3 owns the full purge implementation. However, S3 depends on S1's `isAllowedDmSender` (Seam 1).

### Seam 4 — `dm-third-party-inbound.spec.ts` inversion (S4 → e2e gate)

S4 must delete or invert `dm-third-party-inbound.spec.ts` before the e2e gate runs. The existing spec asserts the bug as expected behaviour; leaving it intact causes Step 5.8 to fail.

## Implementation Constraints

1. **`shouldIngestRumor()` preserved** — the walled-garden gate runs before it, not instead of it (AC-SEC-10).
2. **`unwrapAndOpen()` preserved verbatim** — authentication chain must not change (AC-SEC-9).
3. **`seenMessageIds` and `seenRumorIds` must NOT be populated for stranger events** — dedup sets are reserved for accepted events so a later member re-delivery is not falsely deduped (AC-SEC-4, AC-SEC-5).
4. **Purge triggers react to group array, not a timer** — triggers are `useEffect` on `groups`/`groupDataVersion` in MarmotContext (AC-PURGE-2).
5. **IDB key namespace boundary** — purge MUST NOT touch `quizzl:messages:<groupId>` keys that lack the `dm:` discriminator (AC-PURGE-3).
6. **Pubkey normalization** — whitelist comparisons must be case-insensitive. `isAllowedDmSender` lowercases both `peerHex` and entries from `group.memberPubkeys` before comparing (AC-SEC-2).
7. **E2E stranger context** — Mallory must use USER_C identity (`seedHex: 'cc'.repeat(16)`), publish via a second `browser.newContext()` + `publishDirectMessage` (DD-8 Option α, AC-TEST-4).
8. **No group shared** between Alice and Mallory in e2e tests — Alice must NOT have Mallory in any `group.memberPubkeys` at test time.
9. **AC-TEST-5 member-allowed** requires actual MLS group creation and invite (not just a contact record in `lp_contacts_v1`).
10. **`dm-third-party-inbound.spec.ts` replacement** — its raw-WebSocket publish helper (`publishKind4ToRelay`) must be replaced by the app's `publishDirectMessage` in the new/inverted spec (DD-8 Option α).

## Story Order and Dependencies

```
S1 (walledGarden + rememberContact gate)
  ↓
S2 (ingress gates on bell watcher + ContactChat)  ← depends on S1's isAllowedDmSender
  ↓
S3 (retroactive purge + MarmotContext wiring)      ← depends on S1's isAllowedDmSender
  ↓
S4 (test surface: unit tests + e2e + inversion)   ← tests all of S1-S3; must invert existing spec
```
