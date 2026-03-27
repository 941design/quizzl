# Deterministic MLS Fork Resolution & Message Buffering

## Context

Quizzl uses marmot-ts (MLS over Nostr) for E2E encrypted groups. Any member can commit (invite, key update). Nostr relays provide no delivery ordering, causing three failure modes:

1. **Competing commits**: Two members commit on the same epoch, forking the ratchet tree
2. **Future-epoch messages**: Messages arrive before the commit that created their epoch
3. **Stale-epoch messages**: Messages encrypted under epoch N arrive after N+1

**Current state**: ts-mls defaults to `retainKeysForEpochs: 4` (handles stale-epoch partially). The ingest loop in `welcomeSubscription.ts` only handles `processed/applicationMessage` — all other result types (`unreadable`, `skipped`, `rejected`) are silently ignored. No fork detection or resolution exists.

**Goal**: All members converge on the same group state without a central coordinator. Lowest Nostr event ID wins among competing commits ("blockchain-style" deterministic rule).

## Implementation

### New file: `app/src/lib/marmot/epochResolver.ts`

A class `EpochResolver` that wraps `mlsGroup.ingest()` with fork resolution and message buffering.

**Core data structure:**
```typescript
type EpochSnapshot = {
  epoch: number;                // pre-commit epoch
  stateBytes: Uint8Array;       // serializeClientState() output
  commitEventId: string;        // event ID of the commit we processed
  commitCreatedAt: number;      // created_at of that commit
  takenAt: number;              // when snapshot was taken
  replayQueue: NostrEvent[];    // events processed since snapshot (for replay on rollback)
};
```

**Public API:**
- `constructor(mlsGroup, callbacks, config?)` — config: `graceWindowMs` (default 3000), `maxBufferSize` (default 50)
- `ingestEvent(event: NostrEvent): Promise<void>` — main entry point, replaces direct `ingest()` calls
- `dispose(): void` — cleanup timers and buffers

**Internal flow for `ingestEvent`:**

1. Acquire processing lock (serializes concurrent calls — prevents interleaved `ingest()`)
2. Read current epoch via `getEpoch(mlsGroup.state)`
3. If no active snapshot for this epoch, take one via `serializeClientState(mlsGroup.state)`
4. Call `mlsGroup.ingest([event])`, iterate results:
   - **`processed` + `applicationMessage`**: dispatch callback immediately, add event to `snapshot.replayQueue` if grace window active
   - **`processed` + `newState`** (commit detected):
     - If grace window active AND this commit targets the same pre-commit epoch:
       - Compare: if new commit is "lower" → **rollback** (see below)
       - If existing commit is lower → discard new commit (it lost)
     - Otherwise: record commit in snapshot, start/reset grace timer, flush future buffer
   - **`unreadable`**: add to `futureBuffer` (likely future-epoch)
   - **`skipped`/`rejected`**: log and drop
5. Release processing lock

**Rollback (`rollbackAndReplay`):**

1. `deserializeClientState(snapshot.stateBytes)` → restored state
2. `mlsGroup.state = restoredState` (setter exists on MarmotGroup)
3. Build replay list: `[winningCommitEvent, ...snapshot.replayQueue]` (excludes losing commit)
4. Call `mlsGroup.ingest(replayList)` in one batch — marmot-ts's internal `sortGroupCommits()` handles ordering (sorts by `created_at` then `event.id` lexicographically, matching our deterministic rule)
5. Process all yielded results (dispatch app messages, etc.)
6. Take fresh snapshot for the new epoch
7. `mlsGroup.save()` to persist corrected state

**Future buffer flush (`flushFutureBuffer`):**

After any epoch advance (commit processed):
1. Try `mlsGroup.ingest(futureBuffer)`
2. Events yielding `processed` → dispatch + remove from buffer
3. Events still `unreadable` → stay in buffer
4. Cap buffer at `maxBufferSize`, evict oldest by `created_at`

**Deterministic comparison:**
```typescript
function commitIsLower(a: {created_at: number; id: string}, b: {created_at: number; id: string}): boolean {
  if (a.created_at !== b.created_at) return a.created_at < b.created_at;
  return a.id < b.id; // lexicographic — matches marmot-ts sortGroupCommits
}
```

**Grace window expiry:**
- Clear snapshot (no more rollback for this epoch)
- Call `mlsGroup.save()` to persist finalized state

### Modified file: `app/src/lib/marmot/welcomeSubscription.ts`

**Changes to `subscribeToGroupMessages` (line 156-280):**

1. Import and instantiate `EpochResolver` with the existing callbacks (`onApplicationMessage`, `onMembersChanged`)
2. Replace the body of `ingestNdkEvent` (line 180-219) to delegate to `resolver.ingestEvent(nostrEvent)` instead of calling `mlsGroup.ingest()` directly
3. Add `resolver.dispose()` to the returned cleanup function (line 277-279)

The `onMembersChanged` callback moves inside the resolver — it fires after each successful ingest cycle (same behavior as current code that calls `getGroupMembers(mlsGroup.state)` after every ingest).

**Historical sync (line 228-266):** No change to the sort-and-process-one-at-a-time approach. The resolver's processing lock ensures sequential ingestion. During historical replay, competing commits from the past are resolved correctly because events are sorted by `created_at` (and the resolver applies the same deterministic rule if two arrive for the same epoch).

### Existing functions to reuse

| Function | From | Purpose |
|---|---|---|
| `serializeClientState()` | `@internet-privacy/marmot-ts` | Snapshot MLS state before commit |
| `deserializeClientState()` | `@internet-privacy/marmot-ts` | Restore state on rollback |
| `getEpoch()` | `@internet-privacy/marmot-ts` | Read current epoch |
| `getGroupMembers()` | `@internet-privacy/marmot-ts` | Refresh member list after ingest |
| `deserializeApplicationData()` | `@internet-privacy/marmot-ts` | Decode app message from bytes |
| `mlsGroup.ingest()` | MarmotGroup | Process events (async generator) |
| `mlsGroup.save()` | MarmotGroup | Persist state to IndexedDB |
| `mlsGroup.state` (getter/setter) | MarmotGroup | Read/write MLS ClientState |

### Key facts from API research

- `ClientState` = `GroupState & PublicGroupState` — does NOT include `clientConfig`. Serialization round-trip is complete; no config preservation needed.
- `retainKeysForEpochs` defaults to 4 (ts-mls). `MarmotClientOptions` doesn't accept `clientConfig`, so we can't change it. 4 is adequate.
- marmot-ts's `sortGroupCommits()` sorts by `(created_at, event.id)` lexicographically — our deterministic rule matches this exactly.
- `IngestResult` types: `processed`, `skipped` (with reason), `rejected`, `unreadable`
- `mlsGroup.state` setter exists (sets state + marks `dirty = true`)

## Verification

1. **Unit tests** (`app/tests/unit/marmot/epochResolver.test.ts`):
   - Single commit processes normally (no overhead for app messages)
   - Two competing commits: lower event ID wins after rollback
   - Future-epoch event buffered and retried after commit
   - Grace window expiry finalizes commit
   - Processing lock serializes concurrent calls
   - Buffer capped at maxBufferSize

2. **Manual E2E test**:
   - Open app in two browser tabs (two different identities)
   - Both join the same group
   - Simultaneously invite a third member from both tabs
   - Verify: both tabs converge on the same member list
   - Verify: chat messages from before/during the commit race are not lost

3. **Regression**:
   - Run existing Playwright E2E tests (`make e2e` or equivalent)
   - Verify group creation, invitation, chat, and score sync still work
