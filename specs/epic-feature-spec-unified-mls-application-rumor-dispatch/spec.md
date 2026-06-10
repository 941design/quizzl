# Feature Spec: Unified MLS application-rumor dispatch

## Intent

The app currently has **two independent subscriptions delivering the same MLS application rumors** — one in `MarmotContext`, one in `ChatStoreContext` — each with its own kind-dispatch table, its own persistence call, and its own deduplication strategy. The arrangement is structurally racy and has already caused at least one silent feature regression: `epic-image-sharing` shipped with attachment parsing in the `MarmotContext` path; ten days later, the `epic-emoji-feature` rewrite of `ChatStoreContext` introduced a parallel kind-9 receive branch that did not parse attachments, breaking image rendering on the recipient side without any test failing. The May-08 e2e bug report flags a related "DM duplicate bubble" symptom (B1) whose mechanism — multiple consumers of the same logical event — is the same class.

This feature collapses the two paths into a single dispatcher with a defined delivery contract. After this change there is **exactly one place** in the codebase that turns an MLS-applied rumor into application-level state, exactly one persistence write per rumor, and exactly one kind-dispatch table to keep current. UI contexts subscribe to derived state (IndexedDB rows + version counters) rather than to the raw rumor stream.

The intended outcome:

- A new rumor kind requires touching one file, not two. A future epic that adds, say, a "typing indicator" kind cannot accidentally regress a previous epic's kind by forgetting to copy logic to the second branch.
- Inbound rumors from peers are persisted exactly once per rumor id. The receive race that drops attachment fields cannot happen because there is only one persistence call.
- Own-send echoes (delivered by marmot-ts through the `MarmotGroup` event bus when the local user publishes an application message) flow through the same dispatcher as peer rumors and are deduplicated on `rumor.id`. The current heuristic of "MarmotContext filters self, ChatStoreContext does not" disappears.
- The "two duplicate message bubbles" failure mode flagged in the May-08 e2e report (B1) loses its structural cause. If the bug persists after this change, it is no longer attributable to multi-consumer races and the investigation narrows.

This is a refactor with no user-visible behaviour changes. Every existing acceptance criterion across `epic-emoji-feature`, `epic-image-sharing`, `epic-group-polls`, `epic-member-profile-discovery-and-relay-on-behalf`, and `epic-group-learning-prototype` (chat baseline) must continue to pass exactly as written.

## Background: how rumors flow today

### The two delivery channels

The marmot-ts library exposes received MLS application rumors through **two independent channels for the same data**:

1. **Callback channel** — `subscribeToGroupMessages` (`app/src/lib/marmot/welcomeSubscription.ts:185`) takes an `onApplicationMessage` callback. Internally it wires an NDK kind-445 subscription and feeds events through `EpochResolver`, which calls `mlsGroup.ingest()` and invokes the callback once per successfully-applied rumor.
2. **Event-bus channel** — `MarmotGroup` (the marmot-ts `MarmotGroup` instance) emits an `'applicationMessage'` event for every rumor that comes out of `ingest()`. This includes own-send echoes, where the local user publishes an application message and marmot-ts re-emits it locally. Consumers attach with `group.on('applicationMessage', handler)`.

Both channels fire for the same logical rumor when an inbound rumor arrives from a peer. The own-send echo only goes through the event bus.

### Where each channel is consumed

#### `MarmotContext.tsx` — callback channel consumer

Registered at line 596 inside `subscribeNewGroups()`. Filters out own messages with `if (senderPubkey === pubkeyHex) return;` (line 604). Then dispatches:

| `rumor.kind` | Action |
|---|---|
| `SCORE_RUMOR_KIND` | `mergeMemberScore` |
| `PROFILE_RUMOR_KIND` | `mergeMemberProfile`, `updateMemberScoreNickname`, `notifyProfileObserved`, `recordRequestAnswered`, `writeContactEntry`, bump `profileVersion` |
| `PROFILE_REQUEST_KIND` | `recordRequestEmitted`; if self is target, reply with profile; else delegate to `handleIncomingProfileRequest` |
| `CHAT_MESSAGE_KIND` | `appendMessage(IDB)`, bump `chatVersion`, `incrementUnread` |
| `POLL_OPEN_KIND` | `savePoll`, bump `pollVersion` |
| `POLL_VOTE_KIND` | `saveVote` (gated on poll-not-closed), bump `pollVersion` |
| `POLL_CLOSE_KIND` | mark poll closed (gated on creator), bump `pollVersion` |
| `7` (reaction) | `loadMessages` gate → `applyInboundRumor`, bump `reactionsVersion` |

#### `ChatStoreContext.tsx` — event-bus channel consumer

Registered at line 283 with `group.on('applicationMessage', handler)`. **Does not filter own messages.** Dispatches:

| `rumor.kind` | Action |
|---|---|
| `CHAT_MESSAGE_KIND` | parse attachments, `appendMessage(IDB)`, `setMessages` (in-memory React state) |
| `7` (reaction) | `messagesRef.current` gate → `applyInboundRumor` |

The header comment at `ChatStoreContext.tsx:5-10` claims its kind-7 branch "covers the own-send echo path" while MarmotContext's "covers inbound from other group members." This split is an *aspiration*: nothing in the code enforces that the event-bus channel only carries own-echoes. If marmot-ts emits `'applicationMessage'` for inbound rumors too — which it does, since both channels are downstream of the same `mlsGroup.ingest()` — then both branches fire on inbound from peers as well.

### Concrete failure modes already observed

1. **AC-41 silently regressed** when the May-06 emoji-feature commit (`3dcc481`) introduced the `ChatStoreContext` `CHAT_MESSAGE_KIND` branch without attachment parsing. `ChatStoreContext.setMessages` rendered the bubble without an image; the `MarmotContext` IDB write had attachments but the in-memory React state didn't, and `setMessages` won the race for the inbound bubble's first paint. Bug confirmed by `bug-reports/e2e-iteration-2026-05-08.md` and the uncommitted diff at `ChatStoreContext.tsx:226-243`.

2. **Two `appendMessage(IDB)` writes per inbound rumor.** Both the callback path and the event-bus path call `appendMessage(groupId, msg)`. The IndexedDB upsert is idempotent on `id`, but the two writes contain different `attachments` payloads when the dispatch tables drift. Whichever write lands second wins, and IDB-driven re-renders flicker between attachment-bearing and attachment-less variants.

3. **Two dedupe sources for kind-7 reactions.** The MarmotContext path uses `loadMessages` (IDB read) to gate. The ChatStoreContext path uses `messagesRef.current` (in-memory React state) to gate. They can disagree during the brief window between an `appendMessage` write and the `chatVersion`-driven re-read. A rumor accepted by one gate and rejected by the other produces ordering anomalies.

4. **Own-send echo handling is asymmetric.** For the local user's own kind-9 message, the optimistic UI writes via `sendMessage` (in `ChatStoreContext.sendMessage`) → IDB → `setMessages`. Then the marmot-ts bus fires the own-echo, which the `ChatStoreContext` handler processes again — re-running `appendMessage` and `setMessages` (the latter is a no-op because `id` is already present, but only because of the explicit `prev.some` guard at line 250). MarmotContext skips own-echo via the pubkey filter. This works only because `ChatStoreContext` happens to remember to dedupe on `id`. A future change that forgets the guard would re-publish UI updates twice.

5. **`incrementUnread` leaks into the dispatcher.** `MarmotContext` calls `incrementUnread(group.id)` for every inbound chat message but only on the callback path (it filters own). Whether this is correct depends on whether the user has the group focused — currently it's overcounted in some scenarios because the dispatcher doesn't know about UI focus.

## Design

### One dispatcher, one delivery channel

Pick **the event-bus channel** (`MarmotGroup.on('applicationMessage', ...)`) as the canonical source. Reasons:

- It naturally carries own-send echoes, which is necessary for the optimistic UI to converge with remote-truth state without a separate code path. The current `ChatStoreContext` already relies on this for kind-7.
- It is the marmot-ts-native event surface; the callback path is a nostling-side adapter (`subscribeToGroupMessages`) that wraps the same machinery and exists primarily to deliver the historical-sync hook. After unification, `subscribeToGroupMessages` returns nothing application-layer; it only owns relay-subscription lifecycle and history-sync signalling.
- The callback path's "skip own messages" filter is a workaround for a problem that does not exist on the bus channel: the bus delivers own-echoes, and consumers can dedupe on `rumor.id` against the optimistic record they already wrote. Centralising deduplication at one place is simpler than partitioning by source.

The bus channel is wired into one dispatcher module that owns the kind table.

### Module: `app/src/lib/marmot/applicationRumorDispatcher.ts`

```ts
// New file. No equivalent exists today.

export interface DispatcherContext {
  groupId: string;
  selfPubkeyHex: string;
  // Lazy accessors — the dispatcher should not capture stale state.
  getActiveGroupId: () => string | null;
}

export interface RumorHandler<TKind extends number = number> {
  kind: TKind;
  /**
   * Called once per rumor.id, regardless of source (own-echo or peer).
   * Implementations are responsible for their own idempotence on rumor.id —
   * the dispatcher does not deduplicate beyond ensuring at-most-one
   * synchronous invocation per kind per rumor.
   */
  handle(rumor: ApplicationRumor, ctx: DispatcherContext): Promise<void> | void;
}

export interface ApplicationRumor {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
}

export function createDispatcher(handlers: RumorHandler[]): {
  subscribe(group: MarmotGroup, ctx: DispatcherContext): () => void;
};
```

The dispatcher:

1. Maintains an LRU `Set<string>` of recently-seen `rumor.id`s, capped at 1000 entries per group, and short-circuits on a hit. This is the **only** dedup point in the system. (Today, dedup is split between `loadMessages` IDB reads and `messagesRef.current` React state.)
2. Calls each registered handler whose `kind` matches the rumor's `kind`. Multiple handlers may register for the same kind; they run in registration order, sequentially (await between each), so a handler may rely on prior handlers' state.
3. Catches per-handler errors with `console.warn` and a structured tag (`[dispatcher.<kind>]`) so one failing handler does not silence others or crash the subscription.
4. Tracks per-handler metrics for observability (count, last-error, last-duration) on a debug surface attached to `window.__nostlingTest` in development.

### Handler registration

Handlers live next to the feature they serve, registered explicitly in a single composition root:

```
app/src/lib/marmot/handlers/
  scoreHandler.ts           // SCORE_RUMOR_KIND
  profileHandler.ts         // PROFILE_RUMOR_KIND
  profileRequestHandler.ts  // PROFILE_REQUEST_KIND
  chatHandler.ts            // CHAT_MESSAGE_KIND (incl. attachment parsing)
  pollHandler.ts            // POLL_OPEN_KIND, POLL_VOTE_KIND, POLL_CLOSE_KIND
  reactionHandler.ts        // 7
```

Composition root: `app/src/lib/marmot/registerHandlers.ts` exports `buildDispatcher(deps): Dispatcher`. It receives a `deps` bag holding the React state setters (`setChatVersion`, `setProfileVersion`, etc.) and IDB write functions, and wires every handler's dependency by name. There is no implicit context capture.

`MarmotContext` calls `buildDispatcher(deps).subscribe(group, ctx)` once per group inside `subscribeNewGroups()`, and stores the `unsubscribe` returned. `ChatStoreContext` no longer registers an `applicationMessage` listener.

### Decoupling UI contexts from the dispatcher

After this change, `ChatStoreContext` exists purely to:

- Select chat messages for the active group from IDB, keyed on `chatVersion`.
- Run reaction aggregation, keyed on `reactionsVersion`.
- Provide `sendMessage`, `sendImageMessage`, `sendReaction` that write optimistically to IDB and publish via marmot-ts.

It no longer subscribes to the bus or the callback. The dispatcher owns inbound; `ChatStoreContext` owns outbound + selection. This is a firmer separation than the current "everyone subscribes to everything" pattern.

`ContactChat` (DMs) is **out of scope** for this feature. DMs use NIP-17/59 gift wraps, not MLS application rumors, and have a different ingest surface (NDK direct subscription, no MLS apply step). The DM duplicate-bubble bug (May-08 B1) may still benefit from a similar consolidation, but that is a separate, subsequent feature.

### Own-send echo handling

When the local user sends a chat message via `ChatStoreContext.sendMessage`:

1. `sendMessage` constructs the rumor, computes its `id`, writes optimistic record to IDB with `id` and `attachments`, calls `setMessages` for immediate paint.
2. `mlsGroup.sendApplicationRumor(rumor)` publishes to the relay.
3. marmot-ts emits `'applicationMessage'` for the local echo. The dispatcher's chat handler receives it.
4. Chat handler calls `appendMessage(groupId, msg)`. IDB upsert is idempotent on `id` — the existing optimistic record is updated only if the new payload is meaningfully different (the optimistic record was complete, so this is a no-op write).
5. Chat handler bumps `chatVersion`. ChatStoreContext re-reads IDB, sees the same set of messages, no UI flicker.

The same pattern holds for kind-7 (reactions), where the optimistic write goes through `applyOptimistic` / `applyOptimisticRemoval` and the echo is upserted by `applyInboundRumor`.

### Removing the callback path

`subscribeToGroupMessages` keeps its lifecycle responsibility — opening the NDK kind-445 subscription, running `EpochResolver` for fork resolution, signalling `onHistorySynced` — but loses its `onApplicationMessage` parameter. Internally the resolver still drives `mlsGroup.ingest()`; the rumor reaches consumers via the bus, not via a nostling-supplied callback.

`MarmotContext` calls `subscribeToGroupMessages(groupId, relays, mlsGroup, ndk, { onMembersChanged, onHistorySynced })` and a separate `dispatcher.subscribe(group, ctx)` for application rumors. The two are independent: even if the dispatcher unsubscribes (e.g. on context tear-down), the kind-445 ingest continues.

### Persistence write contract

After this change there is exactly one `appendMessage(groupId, msg)` per rumor:

- For inbound from peers: chat handler invokes it once.
- For own-echo: chat handler invokes it once; the optimistic write earlier in `sendMessage` is the only other write, and IDB upserts are idempotent on `id`.

The chat handler is the sole owner of the IDB chat-message write side. `ChatStoreContext.sendMessage` continues to write the optimistic record (different concern: the user's send hasn't echoed yet).

### `incrementUnread` semantics

The dispatcher does not own focus. `incrementUnread` is invoked by the chat handler unconditionally on inbound-from-peer rumors (own-echoes are detected by `rumor.pubkey === selfPubkeyHex` on the rumor itself, not on the channel source). The currently-active group's unread counter is then decremented in a UI effect that observes `chatVersion`-bumped messages and clears their unread state if the user is on that group. This is a refinement, not a behaviour change — the current code has the same intent but expresses it implicitly through which path runs.

## Acceptance criteria

### Structural

- [ ] **AR-1** A grep for `group.on('applicationMessage'` returns exactly one occurrence in `app/src/`, located in `app/src/lib/marmot/applicationRumorDispatcher.ts`.
- [ ] **AR-2** A grep for `subscribeToGroupMessages` shows it called from exactly one site (`MarmotContext.tsx`, inside `subscribeNewGroups`), and its signature no longer includes `onApplicationMessage`.
- [ ] **AR-3** A grep for `rumor.kind === ` and `rumor.kind ===` across `app/src/context/` returns zero hits. All kind dispatch lives in `app/src/lib/marmot/applicationRumorDispatcher.ts` or in handler modules under `app/src/lib/marmot/handlers/`.
- [ ] **AR-4** Each handler module exports exactly one `RumorHandler` per kind it handles. The composition root `registerHandlers.ts` is the only file that imports all handlers.
- [ ] **AR-5** The dispatcher's seen-id set evicts entries when its size exceeds 1000 per group. Unit test simulates 1100 ingests with distinct ids and asserts the first 100 ids are no longer in the set.

### Behavioural — chat (CHAT_MESSAGE_KIND)

- [ ] **AR-6** Sending a text-only chat message produces exactly one `appendMessage` IDB write per rumor.id, observed via a test-only IDB write counter. The optimistic write counts; the echo upsert is idempotent and produces no second row.
- [ ] **AR-7** An inbound chat message from a peer with `imeta` tags yields a persisted `ChatMessage` with `attachments` populated. AC-41 from `epic-image-sharing` continues to pass against the new dispatcher with its file path updated to `app/src/lib/marmot/handlers/chatHandler.ts`.
- [ ] **AR-8** An inbound chat message from a peer arriving while another group is active increments only that group's unread counter, not the active group's.
- [ ] **AR-9** All existing chat e2e tests (`groups-lifecycle.spec.ts`, `groups-image-sharing.spec.ts` where green, `groups-direct-chat-no-duplicates.spec.ts`) continue to pass.

### Behavioural — reactions (kind 7)

- [ ] **AR-10** A reaction echo from the local user (via marmot-ts bus) is processed exactly once: `applyInboundRumor` is invoked one time per rumor.id and is gated on the message id being known locally.
- [ ] **AR-11** A reaction inbound from a peer is processed exactly once. Verified by counting `applyInboundRumor` invocations per rumor.id in a test harness over a multi-tab e2e scenario.
- [ ] **AR-12** AC-38 (story-06) and AC-59 (DM-side; out of scope but should regress-test) continue to pass without change to their assertions.
- [ ] **AR-13** `groups-reactions.spec.ts` test "Bob reacts to Alice's message — Alice sees the badge (AC-40)" — currently failing per May-08 bug report B2 — passes. The dispatcher consolidation removes the structural cause.

### Behavioural — profiles, polls, scores

- [ ] **AR-14** `epic-member-profile-discovery-and-relay-on-behalf` e2e (`groups-profile-request.spec.ts`, scenarios 1, 2, 3, 4, 6) continue to pass. Scenario 5 stays `test.fixme` if the underlying B3 retry-attempts bug is not yet diagnosed; if it is, it converts to a passing test.
- [ ] **AR-15** `epic-group-polls` e2e (`groups-polls.spec.ts` and any related) continues to pass. PollOpen, PollVote, PollClose all dispatch through `pollHandler.ts`.
- [ ] **AR-16** `epic-group-learning-prototype` score-sync flows continue to pass — `mergeMemberScore` invoked once per inbound score rumor.

### Negative — what must not happen

- [ ] **AR-17** A rumor with an unknown `kind` does not crash the dispatcher and does not log an error at higher than `debug` severity. A unit test injects a rumor with `kind: 9999` and asserts the dispatcher returns cleanly with no thrown exception.
- [ ] **AR-18** A handler that throws synchronously is caught; downstream handlers for the same kind still run. Verified by a unit test with two kind-9 handlers, the first of which throws.
- [ ] **AR-19** Removing `MarmotContext`'s `if (senderPubkey === pubkeyHex) return;` filter (which the dispatcher replaces with id-based dedup) does not produce double-renders on own-send. Existing `groups-lifecycle.spec.ts` "User A sends, User A sees once" assertion remains green.

### Test-shape requirements

- [ ] **AR-20** The dispatcher and every handler ship with unit tests under `app/tests/unit/marmot/`. Coverage minimum: each kind has a happy-path test, a malformed-payload test, and a duplicate-id test.
- [ ] **AR-21** A new e2e test, `groups-dispatch-isolation.spec.ts`, asserts that an own-send chat message produces exactly one IDB row and exactly one rendered bubble across two tabs of the same user. This is the structural test for the smell that motivated this feature.

## Out of scope

- DM (NIP-17/59) receive paths in `ContactChat.tsx`. The duplicate-bubble bug (May-08 B1) is a related symptom but lives in a different ingest layer. A follow-up feature should consolidate the DM gift-wrap subscription with this dispatcher pattern after this lands.
- The `marmot-ts-rumor-sender-authentication.md` parallel feature request (sender-leaf authentication) is unaffected. This feature does not depend on it.
- `EpochResolver` internals (fork resolution, future-epoch buffering) are unchanged. The dispatcher consumes the resolver's output via the bus.
- Profile cache writes to `localStorage` (the cross-group `lp_contactCache_v1`). They continue to live inside the profile handler and are not abstracted into the dispatcher framework.

## Migration

The change is mechanical but touches core paths. Stage it:

1. **Story 1 — Introduce dispatcher.** Add `applicationRumorDispatcher.ts` with the `RumorHandler` interface, the seen-id LRU, and unit tests for AR-1 / AR-5 / AR-17 / AR-18. Nothing wires it up yet.
2. **Story 2 — Port chat and reactions.** Move the kind-9 and kind-7 logic from both contexts into `chatHandler.ts` and `reactionHandler.ts`. Wire the dispatcher in `MarmotContext`. Remove the `applicationMessage` listener from `ChatStoreContext`. Remove the kind-9 and kind-7 branches from `MarmotContext`'s `onApplicationMessage` callback. Verify AR-6 through AR-13 against the existing e2e suites.
3. **Story 3 — Port profile, profile-request, score, polls.** Remove the corresponding branches from `MarmotContext`'s callback. Verify AR-14 through AR-16.
4. **Story 4 — Drop the callback parameter.** Change `subscribeToGroupMessages` signature to remove `onApplicationMessage`. The change is internal — no public API is broken because `subscribeToGroupMessages` is only called by `MarmotContext`. Verify AR-2.
5. **Story 5 — New e2e test.** Add `groups-dispatch-isolation.spec.ts` for AR-21. This is the regression sentinel for the entire class of bug.

Each story is independently testable. Story 2 ships the bulk of the value; stories 3 and 4 are cleanup; story 5 is the durable safeguard.

## Risks

1. **EpochResolver fork-resolution timing**. The resolver currently invokes `onApplicationMessage` *inside* its apply pipeline; if the bus emits before the resolver's rollback fires (in the rare epoch-fork case), the dispatcher could process a rumor that the MLS state later un-applies. Mitigation: the resolver's rollback path is one of the things `applyInboundRumor` already tolerates via tombstone semantics; the chat handler's `appendMessage` is upsert-by-id and similarly tolerant. A test for the fork-then-rollback scenario should be in scope — propose adding it under Story 2.
2. **Order-sensitive handlers across kinds.** The current implicit ordering ("MarmotContext sees the rumor before ChatStoreContext does") is replaced by explicit registration order. Anything that *depended* on the implicit ordering is now broken. Audit during Story 2 — look for state that one path writes and the other reads in the same tick. The `chatVersion` → IDB-re-read flow is one such dependency, and the unification eliminates the dependency rather than re-encoding it.
3. **Test coverage gap for own-send echoes.** No existing unit or e2e test specifically asserts "marmot-ts emits the bus event for own-send." Story 2 must include a unit test that simulates the bus emitting an `applicationMessage` whose `pubkey === selfPubkey`, and asserts the chat handler treats it the same as a peer rumor for dedupe purposes.
4. **Hidden coupling through `incrementUnread`**. `incrementUnread(group.id)` lives at `MarmotContext.tsx:725`. After the move, the chat handler must call `incrementUnread` with the same semantics. The handler does not have the React component focus — the active-group decrement currently lives in a UI effect at the page level (`pages/groups.tsx`), which is fine, but a check that the e2e bell-on-unread spec (`notification-bell.spec.ts`) passes is worthwhile.

## Open questions

- **Q1.** Does marmot-ts always emit `'applicationMessage'` for own-send rumors, or only when the relay echoes the published event back? If the latter, an own-send while the relay is down would never trigger the bus. The optimistic write in `sendMessage` covers the user's local state, but `chatVersion` would not bump — meaning other contexts (e.g. a parallel tab) would not see the message. **Action**: confirm by reading marmot-ts source under `node_modules/@internet-privacy/marmot-ts/` or testing empirically with a relay-disconnect scenario before locking the design.
- **Q2.** The dispatcher's seen-id LRU is per-group. Should it be global so that a rumor-id collision across groups (extremely unlikely but possible) doesn't slip through? Per-group is safer for now (a future kind that intentionally repeats an id across groups would not silently drop) but the question should be answered explicitly.
- **Q3.** Should the dispatcher run handlers concurrently or sequentially? Current proposal: sequentially (await between handlers for the same kind). This preserves the implicit "PROFILE handler writes IDB, then `recordRequestAnswered` reads it" ordering. If a future feature genuinely benefits from concurrency, it can be opted into per-handler. **Default: sequential.**
- **Q4.** What does the dispatcher do when subscribed before the group's history-sync completes? Today, both paths process historical rumors as they arrive. The dispatcher should preserve this — historical rumors flow through the same kind table — but the seen-id LRU must be primed from IDB on subscribe so a returning user does not re-process every historical rumor. **Action**: confirm IDB priming is acceptable and define its scope.

## Closing note

This refactor is the kind of work that has no demo. It is invisible to the user and adds no feature. Its value is purely structural: the next time someone writes an epic that touches MLS application rumors, they will find one place to read, one place to change, and one well-defined contract to honour. The May-06 → May-08 incident — where two epics shipped green and then quietly broke each other — is the exact failure mode this prevents. If we let the parallel-paths arrangement persist, we will pay the same tax again the next time a feature epic re-shapes the receive logic, and the third time, and so on. Better to fix the structure once.
