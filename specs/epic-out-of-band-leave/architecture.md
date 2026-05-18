# Epic Architecture: Out-of-Band Group Leave

## Paradigm

Modular monolith, package-by-layer within `app/src/` (`context/`, `lib/marmot/`, `components/`, `hooks/`). Within `lib/marmot/` the dominant seam is **hexagonal** — pure-function modules (`handlers/*.ts`, `cancelInvitationImpl.ts`, `pollSync.ts`, `epochResolver.ts`) have **zero React imports**, **zero `app/src/context/` imports**, and **zero direct IDB calls**. All side-effects flow through dep bags injected at composition time. `registerHandlers.ts` is the composition root.

## Module map

Modules this epic touches or creates. Status — `NEW` = file created by this epic; `MODIFIED` = existing file edited; `TOUCH-FREE` = surfaces here for awareness but should not be touched per AR-3.

| Module | Path | Status | Owned data | Epic change |
|---|---|---|---|---|
| `lib/marmot/leaveSync.ts` | `app/src/lib/marmot/leaveSync.ts` | NEW (S1) | none (pure serialization) | `LEAVE_INTENT_KIND = 13`, `LeaveIntentPayload`, `serialiseLeaveIntent`, `parseLeaveIntent`. |
| `lib/marmot/handlers/leaveHandler.ts` | `app/src/lib/marmot/handlers/leaveHandler.ts` | NEW (S2) | none — pure dispatch + injected callback | `createLeaveIntentHandler(deps): RumorHandler`. Mirrors `pollHandler.ts` exactly. |
| `lib/marmot/registerHandlers.ts` | `app/src/lib/marmot/registerHandlers.ts` | MODIFIED (S2) | `HandlerDeps` interface; returns `Dispatcher` | Add `enqueueLeave` to `HandlerDeps`; append `createLeaveIntentHandler({ enqueueLeave: deps.enqueueLeave })` to handlers[]. |
| `context/MarmotContext.tsx` | `app/src/context/MarmotContext.tsx` | MODIFIED (S3, S4, S5) | `clientRef` (MarmotClient), `groupSubsRef`, all version counters; NEW per-epic: `pendingRemovalsRef`, `debounceTimersRef` | S3 rewrites `leaveGroup`; S4 adds the two new `useRef` maps and the `enqueueLeave` closure; S5 implements timer-fire auto-commit. |
| `context/ChatStoreContext.tsx` | `app/src/context/ChatStoreContext.tsx` | TOUCH-FREE | message state, send path, reactions | Per AR-3 (`grep 'rumor.kind ===' app/src/context/` returns 0): no kind-switching lives here post-consolidation. Leave intent rendering flows through the existing `chatHandler → appendMessage → chatVersion bump → re-read` chain. |
| `lib/marmot/parseStructured.ts` | `app/src/lib/marmot/parseStructured.ts` | MODIFIED (S6) | `StructuredContent` union + `parseStructured` function | Add `\| { type: 'leave_intent'; pubkey: string }` to the union and a guard branch in `parseStructured`. |
| `components/chat/ChatBox.tsx` | `app/src/components/chat/ChatBox.tsx` | MODIFIED (S6) | none | Add render branch for `structured?.type === 'leave_intent'` in `renderStructuredMessage`. |
| `components/groups/LeaveChatAnnouncement.tsx` | `app/src/components/groups/LeaveChatAnnouncement.tsx` | NEW (S6) | none (presentational) | Mirrors `PollChatAnnouncement` / `InviteCancelledChatAnnouncement` styling. Gray sidebar. `data-testid="leave-chat-announcement"`. |
| `lib/i18n.ts` | `app/src/lib/i18n.ts` | MODIFIED (S6) | translation catalog (`Copy` type, en object, de object) | Add `groups.leftGroup: (member: string) => string` to the `Copy` type and both en + de objects. |

## Boundary rules

These rules are inherited from the codebase as established invariants. Stories MUST NOT regress them.

1. **AR-1 — Single `applicationMessage` listener.** Exactly one call site of `group.on('applicationMessage'` may exist in the codebase. The single site is `app/src/lib/marmot/applicationRumorDispatcher.ts:106`. No story may introduce a second listener.
2. **AR-3 — No kind-switching in `app/src/context/`.** `grep -rn 'rumor.kind ===' app/src/context/` must continue to return zero hits after every story. All kind dispatch lives in handlers under `app/src/lib/marmot/handlers/`, wired via `buildDispatcher()` in `registerHandlers.ts`.
3. **Handler purity.** Files under `app/src/lib/marmot/handlers/` MUST NOT import from `app/src/context/`. They receive deps via factory closure at registration time. Pattern: `createPollOpenHandler(deps): RumorHandler`. S2's `createLeaveIntentHandler` follows this exactly.
4. **`MarmotContext` as composition root.** `MarmotContext` supplies closures that bind `mlsGroup`, `sendRumorSafe`, `clientRef`, version-bumpers. Handlers never reach back into `MarmotContext` directly.
5. **Static export.** No dynamic path segments. Query parameters only for client-side dynamic data. `output: 'export'` is enforced by `app/next.config.mjs`; `trailingSlash: true`. The leave flow's `router.push('/groups')` resolves to a real `/groups/index.html`.
6. **Multi-platform dev.** Build, test, and dev commands MUST go through `make` so the platform-stamp check runs first. Platform stamps live at `app/node_modules/.platform_$(uname -s)-$(uname -m)`.
7. **Translation contract.** All user-visible strings come from `useCopy()` against `app/src/lib/i18n.ts`. Both `en` and `de` entries are required for every new key. Parametric strings use function values: `(name: string) => string`.

## Seams

| Seam | Contract | Epic impact |
|---|---|---|
| `handler-to-context` | Handler receives typed deps bag at creation time (closure). `handle(rumor, ctx) => Promise<void> \| void`. No React hooks. No context imports. | S2's `createLeaveIntentHandler` receives `{ enqueueLeave: (groupId, pubkey) => void }`. The handler only enqueues — never touches `mlsGroup`, never commits. |
| `dispatcher-to-mls` | `Dispatcher.subscribe(group, ctx)` calls `group.on('applicationMessage', listener)` once and returns an unsubscribe. Single call site at `applicationRumorDispatcher.ts:106`. | S2 extends `buildDispatcher()` only. Adding a new `group.on('applicationMessage')` anywhere else violates AR-1. |
| `context-to-mls-state` | `MlsGroup` references live in `clientRef` (`MarmotClient`). The active `mlsGroup` for a group is captured as a `const` inside the `subscribeNewGroups` for-loop closure (`MarmotContext.tsx:577-640`). No long-lived "active mlsGroup" ref exists outside that scope. | S5's timer callback must re-fetch via `clientRef.current?.groups.get(groupId)` at fire time — the per-group subscription closure may have torn down between enqueue and fire. Pattern source: `cancelInvitationImpl.ts`. |
| `ChatStoreContext-to-MarmotContext` (post-consolidation) | `ChatStoreContext` does NOT listen on `group.on('applicationMessage')`. It reads from IDB via `chatVersion` bumps. The consolidated path: `MarmotContext → buildDispatcher → chatHandler → appendMessage(IDB) → setChatVersion → ChatStoreContext re-reads IDB`. | The kind-9 leave-intent announcement follows the same path. S6's only edits are to `parseStructured.ts` (union extension) and `ChatBox.tsx` (render branch). No new listener anywhere. |

## Implementation constraints

(Derived from spec + exploration.)

1. **Single commit for Remove + adminPubkeys update.** S5 issues exactly one `mlsGroup.commit({ extraProposals: [...removeProposals, Proposals.proposeUpdateMetadata({ adminPubkeys: remainingAdmins })] })`. Both proposals land in the same epoch transition. Reference: `cancelInvitationImpl.ts:73-98`.
2. **Plain-object Remove proposals.** Use `{ proposalType: PROPOSAL_TYPE_REMOVE, remove: { removed: leafIndex } }`. Do NOT use `proposeRemoveUser()` or a `Proposals.Remove(...)` factory — API-nesting bug, see `cancelInvitationImpl.ts:72-78`.
3. **`useRef` for queue and timers.** `pendingRemovalsRef` (`Map<groupId, PendingRemoval[]>`) and `debounceTimersRef` (`Map<groupId, NodeJS.Timeout>`) MUST be `useRef`, not `useState` — they must not trigger re-renders. Clear timers in the existing `groupSubsRef` cleanup at `MarmotContext.tsx:720-727`.
4. **Send order in `leaveGroup`.** kind-13 send BEFORE kind-9 fire-and-forget BEFORE local-state purge. Reversing this order purges the MLS key material before the encrypted rumor is sealed.
5. **Stale-leaf guard.** `getPubkeyLeafNodeIndexes(state, pubkey)` may return `[]` if another admin already committed the Remove. Treat this as race-detected (drop from queue, skip commit). Reference: `cancelInvitationImpl.ts:80-83`.
6. **Historical sync ingestion.** Kind-13 messages re-delivered through historical sync on cold start arrive within a single await chain and will all hit the debounce window. The 5s debounce absorbs the burst into one commit. No first-sync gate needed.
7. **`sendRumorSafe` is module-scope inside `MarmotContext.tsx`.** S3 and S5 both call it from inside `MarmotContext`, which is fine. Do NOT extract the auto-commit logic to a separate file without first moving `sendRumorSafe` to a shared module.
8. **Test invocation through make.** Unit: `make test-unit`. Groups e2e (requires docker strfry): `make test-e2e-groups`. Fast e2e: `make test-e2e-fast`. Typecheck: `cd app && npx tsc --noEmit` (no make wrapper).
