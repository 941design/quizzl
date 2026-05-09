# Architecture: Unified MLS Application-Rumor Dispatch

## Paradigm

Functional core + imperative shell, with package-by-feature layout under `app/src/lib/marmot/`.

Pure parse/serialise modules (`scoreSync.ts`, `profileSync.ts`, `pollSync.ts`, `profileRequestSync.ts`) form the functional core — zero side effects, no IDB access. All IDB writes and React state mutations are imperative shell operations invoked from React context providers or handler modules.

This epic adds a new handler layer between the functional core and the imperative shell: `handlers/` modules each hold one kind's side-effect logic but receive their IDB and state-setter dependencies by injection (no implicit capture), keeping them unit-testable in isolation.

## Module Map

### New — created by this epic

| Module | Purpose | Directory | Owned Data |
|---|---|---|---|
| `applicationRumorDispatcher.ts` | Single `group.on('applicationMessage')` subscriber; routes to registered handlers; owns LRU seen-id dedup (max 1000 per group) | `app/src/lib/marmot/` | Per-group `Set<string>` of seen rumor IDs |
| `handlers/chatHandler.ts` | `CHAT_MESSAGE_KIND` (kind 9): `appendMessage` + `incrementUnread` + `setChatVersion` | `app/src/lib/marmot/handlers/` | — |
| `handlers/reactionHandler.ts` | Kind 7: `loadMessages` existence gate + `applyInboundRumor` + `setReactionsVersion`; introduces `REACTION_RUMOR_KIND = 7` constant | `app/src/lib/marmot/handlers/` | — |
| `handlers/profileHandler.ts` | `PROFILE_RUMOR_KIND` (kind 0): `mergeMemberProfile` + `updateMemberScoreNickname` + `notifyProfileObserved` + `writeContactEntry` + `setProfileVersion` | `app/src/lib/marmot/handlers/` | — |
| `handlers/profileRequestHandler.ts` | `PROFILE_REQUEST_KIND` (kind 30): `recordRequestEmitted`; self-target → `sendRumorSafe`; other → `handleIncomingProfileRequest` | `app/src/lib/marmot/handlers/` | — |
| `handlers/scoreHandler.ts` | `SCORE_RUMOR_KIND` (kind 1): `mergeMemberScore` | `app/src/lib/marmot/handlers/` | — |
| `handlers/pollHandler.ts` | `POLL_OPEN_KIND` (10) / `POLL_VOTE_KIND` (11) / `POLL_CLOSE_KIND` (12): `savePoll`, `saveVote`, `getPoll` + `setPollVersion` | `app/src/lib/marmot/handlers/` | — |
| `registerHandlers.ts` | Composition root; receives a `deps` bag; wires all handlers; exports `buildDispatcher(deps)` | `app/src/lib/marmot/` | — |

### Modified — touched by this epic

| Module | Change | Directory |
|---|---|---|
| `MarmotContext.tsx` | Removes the `onApplicationMessage` callback passed to `subscribeToGroupMessages`; removes the inline kind-dispatch if-else-if block (lines 601-813); calls `buildDispatcher(deps).subscribe(group, ctx)` once per group; stores returned unsubscribe | `app/src/context/` |
| `ChatStoreContext.tsx` | Removes `group.on('applicationMessage', handler)` registration (lines 283-288) and associated handler (lines 224-278); demoted to selection-only + outbound (sendMessage, sendImageMessage, sendReaction) | `app/src/context/` |
| `welcomeSubscription.ts` | Removes `onApplicationMessage` from `EpochResolverCallbacks` and from the `subscribeToGroupMessages` signature; keeps `onHistorySynced` and `onMembersChanged`; internal `EpochResolver` still calls `ingest()` — bus fires downstream | `app/src/lib/marmot/` |

### Unchanged — exists but not touched

| Module | Role | Directory |
|---|---|---|
| `epochResolver.ts` | Fork resolution, future-epoch buffering; drives `mlsGroup.ingest()` which triggers the marmot-ts bus | `app/src/lib/marmot/` |
| `chatPersistence.ts` | `appendMessage`, `loadMessages` — IDB write contract | `app/src/lib/marmot/` |
| `groupStorage.ts` | `mergeMemberScore`, `mergeMemberProfile`, `updateMemberScoreNickname` | `app/src/lib/marmot/` |
| `pollPersistence.ts` | `savePoll`, `saveVote`, `getPoll` | `app/src/lib/marmot/` |
| `reactions/api.ts` | `applyInboundRumor` | `app/src/lib/reactions/` |
| `unreadStore.ts` | `incrementUnread` | `app/src/lib/` |
| `scoreSync.ts`, `profileSync.ts`, `pollSync.ts`, `profileRequestSync.ts` | Pure parse modules | `app/src/lib/marmot/` |

## Boundary Rules

- No direct imports across module boundaries. Cross-module access only through declared seam contracts.
- Handlers in `handlers/` MUST NOT import from `app/src/context/` — they receive all dependencies via the `deps` bag injected at `buildDispatcher` time.
- `applicationRumorDispatcher.ts` MUST NOT import React or any React context. It owns only the subscription lifecycle and LRU state.
- `registerHandlers.ts` is the ONLY file that imports all handler modules. No other module may import from `handlers/` except `registerHandlers.ts`.
- `ChatStoreContext.tsx` MUST NOT register a `group.on('applicationMessage', ...)` listener after Story 2 ships. This is the structural invariant AR-1 enforces.
- All kind constants remain co-located with the module that owns their parse logic. No shared `kinds.ts` constants file.
- `REACTION_RUMOR_KIND = 7` is introduced in `handlers/reactionHandler.ts` only (no named constant exists in the codebase today).

## Seams

*The planner populates cross-story seam contracts here after Mode 2 story split.*

## Implementation Constraints

### Q1: marmot-ts own-send emit behaviour (confirmed by source read)

`sendApplicationRumor` in `marmot-group.js` does NOT emit `'applicationMessage'` for own-send rumors. The private `#sentEventIds` Set causes own-send relay echoes to be yielded as `{kind:'skipped', reason:'self-echo'}` — `emit('applicationMessage')` is never reached. The ChatStoreContext comment at line 254 claiming "own-send echo path" is **incorrect** for the installed marmot-ts version.

**Implication**: The dispatcher processes ONLY peer inbound rumors. Own-send display is handled optimistically by `sendMessage`'s local state write. The spec's §Own-send echo handling is correct in its final effect (idempotent appendMessage, chatVersion bump) but the trigger mechanism is relay-echo-from-peer, not local-bus-emit. No code change is required for this — it is an explanation, not a correction.

### Dynamic imports for SSR safety

All marmot-ts and IDB imports inside subscription callbacks MUST use `await import(...)` or be guarded by `typeof window !== 'undefined'`. Handlers registered via `buildDispatcher` may use top-level imports from IDB modules (they are already in the imperative shell, not SSR paths) but should follow the pattern established in `chatPersistence.ts` and `groupStorage.ts`.

### Handler error isolation

Each handler's `handle()` is wrapped in a `try/catch` by the dispatcher. Per-handler errors are logged with `console.warn('[dispatcher.<kind>]', err)` and do not abort downstream handlers. Handlers MUST NOT swallow errors silently — a thrown error is the correct signal for "this invocation failed"; the dispatcher catches it.

### Sequential handler invocation

Multiple handlers for the same `kind` run sequentially (one awaited after the other), in registration order. A handler may rely on IDB state written by a prior handler for the same kind.

### Seen-id LRU

The dispatcher maintains one `Map<string, Set<string>>` keyed by `groupId`. Each per-group `Set<string>` is capped at 1000 entries. Eviction strategy: when size exceeds 1000, delete the first N entries (`for (const [id] of set) { set.delete(id); if (set.size <= 1000) break; }`). This is the ONLY deduplication point in the system for application rumors. AR-5 requires a unit test simulating 1100 distinct-id ingests and asserting the first 100 are no longer in the set.

### Version counter handoff

After this refactor, version counters (`setChatVersion`, `setProfileVersion`, etc.) remain owned by `MarmotContext`. Handlers receive these setters in the `deps` bag. This preserves the existing cross-context notification channel without introducing new React coupling.

### profileRequestHandler: sendRumor dependency

`profileRequestHandler` must reply with a profile rumor when the local user is the target. It needs a `sendRumor` function capturing the current `mlsGroup` instance. This is injected at `dispatcher.subscribe(group, ctx)` time — the handler receives it as a `deps` field (e.g. `deps.sendRumor: (groupId: string, content: string) => Promise<void>`) wired in `registerHandlers.ts`. The `mlsGroup` object is available in `MarmotContext.subscribeNewGroups()` at subscription time.

### IDB write counter for AR-6

`window.__quizzlTest.onChatIdbWrite` callback does not currently exist. Story 2 (or Story 1) must add this hook to `chatPersistence.appendMessage` guarded by `process.env.NODE_ENV !== 'production' && typeof window !== 'undefined'`. Alternatively, AR-6's unit test can use the Map-mock idb-keyval and count `set(key, value)` calls directly — the e2e variant uses `readIdbRecord` to count rows.

### CHAT_MESSAGE_KIND kind-7 literal → named constant

`REACTION_RUMOR_KIND = 7` is introduced in `handlers/reactionHandler.ts`. Both `MarmotContext.tsx` (line 781) and `ChatStoreContext.tsx` (line 251) use literal `7` today. After Story 2, the only usage of `7` for routing is inside `reactionHandler.ts`.
