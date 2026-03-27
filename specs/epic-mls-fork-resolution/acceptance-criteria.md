# Acceptance Criteria — Deterministic MLS Fork Resolution & Message Buffering

## Core Epoch Resolver

### AC-1: Deterministic commit comparison
`commitIsLower(a, b)` returns `true` when `a.created_at < b.created_at`, and when timestamps are equal, returns `true` when `a.id < b.id` (lexicographic). This matches the ordering used by marmot-ts `sortGroupCommits()`.

### AC-2: Single commit processing
When `EpochResolver.ingestEvent()` receives an event that yields a `processed`/`applicationMessage` result, the `onApplicationMessage` callback is invoked with the deserialized rumor. No rollback or buffering occurs.

### AC-3: Snapshot capture before first commit per epoch
When `ingestEvent()` processes the first event for a given epoch, `serializeClientState(mlsGroup.state)` is called and stored as an `EpochSnapshot` before `mlsGroup.ingest()` executes.

### AC-4: Competing commit — lower wins via rollback
When two commits target the same pre-commit epoch and the second commit has a lower `(created_at, id)` tuple, `EpochResolver` rolls back to the snapshot via `deserializeClientState(snapshot.stateBytes)`, re-injects `defaultMarmotClientConfig` into the restored `ClientState` (since `clientConfig` is NOT preserved by serialization), sets `mlsGroup.state` to the patched state, then replays the winning commit event followed by any application messages from `replayQueue` (excluding the losing commit), and dispatches all resulting application messages.

### AC-5: Competing commit — higher is discarded
When two commits target the same pre-commit epoch and the second commit has a higher `(created_at, id)` tuple, the second commit is discarded. The existing state and snapshot are unchanged.

### AC-6: Future-epoch event buffering
When `mlsGroup.ingest()` yields an `unreadable` result for an event (after marmot-ts has already exhausted its internal 5-retry loop), that event is added to the `futureBuffer`. After any epoch-advancing commit is processed, all buffered events are retried via `mlsGroup.ingest()`. Events that become `processed` are dispatched and removed; events still `unreadable` remain in the buffer.

### AC-7: Buffer size cap
When `futureBuffer` exceeds `maxBufferSize` (default 50), the oldest events by `created_at` are evicted until the buffer is within the limit.

### AC-8: Grace window expiry finalizes state
When `graceWindowMs` (default 3000) elapses after a commit with no competing commit arriving, the snapshot for that epoch is cleared and `mlsGroup.save()` is called to persist the finalized state.

### AC-9: Processing lock serializes concurrent calls
Concurrent calls to `ingestEvent()` are serialized — the second call waits until the first completes before calling `mlsGroup.ingest()`. No interleaved ingest operations occur.

### AC-10: Members-changed callback after ingest
After each `ingestEvent()` cycle that processes at least one event, `getGroupMembers(mlsGroup.state)` is called and the result is passed to the `onMembersChanged` callback (if provided).

### AC-11: Dispose cleans up
`EpochResolver.dispose()` clears all grace window timers and empties the future buffer. No further callbacks fire after dispose.

## Integration into welcomeSubscription.ts

### AC-12: EpochResolver replaces direct ingest
In `subscribeToGroupMessages`, the body of `ingestNdkEvent` delegates to `resolver.ingestEvent(nostrEvent)` instead of calling `mlsGroup.ingest()` directly.

### AC-13: Cleanup disposes resolver
The unsubscribe function returned by `subscribeToGroupMessages` calls `resolver.dispose()` in addition to `sub.stop()`.

### AC-14: Historical sync unchanged
Historical event fetching, sorting, and sequential processing remain unchanged. The resolver's processing lock ensures correct sequential ingestion during historical replay.

### AC-15: Existing tests pass
All existing unit tests (179 tests across 12 files) and E2E tests continue to pass after integration.
