# Members Changed: Length-Only Guard Misses Ghost Cleanup — Acceptance Criteria

## Terminology

- **length-neutral swap** — an MLS commit that removes one member and adds another in the same operation, leaving `currentMembers.length === stored.memberPubkeys.length` but changing the identity set.
- **stored** — the `GroupData` object retrieved from the in-memory `groups` array via `groups.find(g => g.id === group.id)`.
- **persistGroup** — the `saveGroup` alias imported at line 21 of `MarmotContext.tsx`; writes the updated `GroupData` to IDB.
- **reloadGroups** — the context function that re-reads group state from IDB and updates React state.

## Fix Guard Logic (S1)

**AC-BUG-1** — `MarmotContext.tsx` line 785 (startup sync) MUST call `persistGroup` and `reloadGroups` when `mlsMembers` and `stored.memberPubkeys` have equal length but differ in at least one element.

**AC-BUG-2** — `MarmotContext.tsx` line 802 (`onMembersChanged` callback) MUST call `persistGroup` and `reloadGroups` when `currentMembers` and `stored.memberPubkeys` have equal length but differ in at least one element.

**AC-BUG-3** — Both guards MUST NOT call `persistGroup` or `reloadGroups` when `currentMembers` (or `mlsMembers`) is set-equal to `stored.memberPubkeys` (same elements, regardless of order).

**AC-BUG-4** — The `setGroupDataVersion` increment at line 800 MUST remain unconditional — it MUST fire for every `onMembersChanged` invocation regardless of whether the member set changed. The fix MUST NOT introduce a conditional around it.

## Unit Test Coverage (S1)

**AC-TEST-1** — A vitest unit test MUST exist that exercises the length-neutral swap scenario: `stored.memberPubkeys = ["alice", "bob"]`, `currentMembers = ["alice", "carol"]`. The test MUST assert that the persist path is triggered (either by spying on `persistGroup` or by testing an extracted helper function that implements the comparison).

**AC-TEST-2** — The same test file MUST include a case where `currentMembers` equals `stored.memberPubkeys` (same set) and asserts that the persist path is NOT triggered.

## Cross-Cutting Invariants

**AC-INV-1** — No other call site in `MarmotContext.tsx` that reads or writes `memberPubkeys` MUST be modified by this epic. The fix is scoped to the two guards identified in the spec.

**AC-INV-2** — `make test-unit` MUST pass with zero new failures after the fix is applied.
