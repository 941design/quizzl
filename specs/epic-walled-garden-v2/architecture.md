# Architecture — Walled Garden v2

## Paradigm

Modular monolith. Package-by-feature for module layout. Hexagonal seams at
external boundaries (localStorage, IDB, NDK/marmot-ts). The walled-garden
invariant is enforced by a single pure-function chokepoint (`isAllowedDmSender`)
with no side effects.

## Module Map

| Module | Type | Directory | Owned Data |
|--------|------|-----------|------------|
| `knownPeers` | Pure lib (new) | `app/src/lib/knownPeers.ts` | `lp_knownPeers_v1` (localStorage JSON array), `lp_knownPeersMigrated_v2` flag, `lp_knownPeersMigrationNoticeAck_v1` flag |
| `pendingInvitations` | Pure lib (new) | `app/src/lib/pendingInvitations.ts` | `lp_pendingInvitations_v1` (localStorage JSON array of PendingInvitation) |
| `walledGarden` | Pure lib (extended) | `app/src/lib/walledGarden.ts` | None — pure predicate only. Extended `WhitelistArgs` type gains `knownPeers` field. |
| `welcomeSubscription` | Protocol lib (modified) | `app/src/lib/marmot/welcomeSubscription.ts` | No new data ownership. Replaces auto-accept with enqueue-to-pendingInvitations. Exports `acceptPendingInvitation` / `declinePendingInvitation`. |
| `MarmotContext` | React context (modified) | `app/src/context/MarmotContext.tsx` | No new data ownership. Adds: knownPeers maintenance effect, migration backfill effect, `acceptPendingInvitation`/`declinePendingInvitation` in context value. |
| `PendingInvitations` | UI component (new) | `app/src/components/groups/PendingInvitations.tsx` | No data ownership. Reads from `pendingInvitations` module and context actions. |
| `groups.tsx` | Page (modified) | `app/pages/groups.tsx` | No data ownership. Mounts `PendingInvitations` above the joined-groups list. |
| `i18n` | Lib (modified) | `app/src/lib/i18n.ts` | New copy keys for invitation UI and migration notice. |
| Call sites | Various (modified) | See below | Pass `knownPeers` to `isAllowedDmSender`; use live-ref pattern. |

## Boundary Rules

No direct imports across module boundaries. The strict one-way hierarchy:

```
pages/ → components/ → context/ → lib/
lib/   ← never imports from context/ or components/
```

`knownPeers.ts` and `pendingInvitations.ts` are pure lib modules:
- MUST NOT import from `idb-keyval`, any NDK package, React, `app/src/context/`, or `app/src/components/`
- MAY import from `app/src/types/` for shared types
- MUST be synchronous

## Seams

### S1 seam: `knownPeers → walledGarden`
`isAllowedDmSender` gains a `knownPeers: ReadonlySet<string>` parameter.
Callers obtain the live set from `useKnownPeers()` (or MarmotContext) and
pass it at call time. The function remains pure — no localStorage read inside.

### S1 seam: `walledGarden → WhitelistArgs`
`WhitelistArgs` gains `knownPeers: ReadonlySet<string>`. All purge helpers
receive the extended args through the same `getWhitelist: () => WhitelistArgs`
closure. The closure in MarmotContext must be updated to include `loadKnownPeers()`.

### S1 seam: `MarmotContext → knownPeers`
`useEffect([groups, groupDataVersion])` calls `rememberKnownPeers(union of
every group.memberPubkeys excluding ownPubkey)` after each membership change.
Also gates the migration backfill (run once, flag-protected).

### S2 seam: `welcomeSubscription → pendingInvitations`
`subscribeToWelcomes` replaces the `joinGroupFromWelcome` call with
`enqueuePendingInvitation`. The actual `marmotClient.joinGroupFromWelcome`
call moves into a new `acceptPendingInvitation(id)` export. The
cryptographic validation (`unwrapGiftWrap`) stays BEFORE the enqueue step.

### S2 seam: `MarmotContext → welcomeSubscription`
`acceptPendingInvitation(id)` and `declinePendingInvitation(id)` are
exported from `welcomeSubscription.ts` and wired into the MarmotContext
value so UI components access them via `useMarmot()`.

### S2 seam: `PendingInvitations.tsx → MarmotContext`
Component reads `acceptPendingInvitation`/`declinePendingInvitation` from
`useMarmot()`. Reads live invitation list from `listPendingInvitations()`
and re-renders reactively (via a subscription or a context-exposed counter).

## Implementation Constraints

### Must preserve
- `walledGarden.ts` remains a pure function with no IDB, NDK, or React imports (AC-SEC-13)
- `isAllowedDmSender` remains synchronous — never async
- `unwrapAndOpen` and `shouldIngestRumor` in `directMessages.ts` are byte-for-byte unchanged (AC-SEC-17, AC-SEC-18)
- All five ContactChat.tsx call sites (269, 336, 388, 429, plus kind-7 if applicable) must pass `knownPeers` (AC-STRUCT-2)
- The `isSelf` bypass pattern in ContactChat.tsx and DirectMessageNotificationsWatcher.tsx is preserved unchanged

### Storage keys registry
All four new localStorage keys MUST be added to `STORAGE_KEYS` in
`app/src/types/index.ts` so they are cleared by `resetAllData`:
- `lp_knownPeers_v1`
- `lp_pendingInvitations_v1`
- `lp_knownPeersMigrated_v2`
- `lp_knownPeersMigrationNoticeAck_v1`

### E2E spec naming
New e2e specs must use the `groups-` prefix to match the Playwright
testMatch (`groups-*.spec.ts`) for the relay suite. Rename from spec names
in AC-TEST-5 through AC-TEST-8:
- `groups-pull-only-invitation-accept.spec.ts`
- `groups-pull-only-invitation-decline.spec.ts`
- `groups-ever-known-survives-leave.spec.ts`
- `groups-migration-backfill.spec.ts`

### Real API name
The spec uses `client.acceptWelcome` as a shorthand. The real marmot-ts API
is `marmotClient.joinGroupFromWelcome({ welcomeRumor })`. Use the real name.

### Pending-invitation count reactivity
Follow the `unreadStore.ts` singleton pattern (module-level state + emit() +
`useSyncExternalStore`) for the pending-invitation badge count. This keeps
the count live without adding a React context layer.

### groups-contacts.spec.ts modification
Per user decision: S4 adds Bob's Accept click step before the group-join
assertions (line 63-66 area). The "survive leave" assertion at ~line 84
is not modified.

## ADR Deliverable

ADR-002 at `docs/adr/ADR-002-mutual-contact-graph-and-pull-only-invitations.md`
supersedes ADR-001. Update ADR-001 `Status: Proposed` → `Status: Superseded by ADR-002`.
