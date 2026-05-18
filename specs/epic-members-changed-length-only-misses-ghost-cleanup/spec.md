# Members Changed: Length-Only Guard Misses Ghost Cleanup

Source: BACKLOG.json finding promoted 2026-05-18

## Problem

`MarmotContext.tsx` guards the `persistGroup` / `reloadGroups` call with a
member-count comparison in two places:

- **Line 785** — initial startup sync: `mlsMembers.length !== stored.memberPubkeys.length`
- **Line 802** — the live `onMembersChanged` callback: `currentMembers.length !== stored.memberPubkeys.length`

When an MLS commit simultaneously removes one member and adds another (same
net count), both guards evaluate to `false` and the persisted member list is
never updated. The departed member remains visible in the UI and the newly
added member remains invisible — a silent correctness failure that cannot be
detected from member counts alone.

The most likely real-world trigger is a ghost-cleanup commit: a pass that
removes a ghost entry (an MLS leaf that has no corresponding valid profile)
and materialises the actual member in the same tree operation. The same
flaw affects any coordinated leave+join, e.g. a re-key commit that drops an
old leaf and adds the re-keyed leaf. AC-MEMBERS-1 of the out-of-band leave
epic exercises the leave side of this path but does not guard against the
same-count failure mode.

## Solution

Replace the length-only guard at both call sites with a set-equality test
that compares actual pubkey identities. When the identity set differs (even
at the same cardinality), call `persistGroup` and `reloadGroups` as today.
The `setGroupDataVersion` bump at line 800 is already unconditional and
remains unchanged — it fires for every MLS commit regardless of member delta.

## Scope

### In Scope

- Fix the length-only guard at `MarmotContext.tsx:785` (startup sync).
- Fix the length-only guard at `MarmotContext.tsx:802` (onMembersChanged callback).
- Unit test (vitest) asserting that a swap-length-equal set change triggers the persist path.

### Out of Scope

- Ghost-cleanup logic itself (no ghost-cleanup pass exists yet; this fix ensures the guard is ready when one is introduced).
- Any change to `persistGroup`, `reloadGroups`, or the group data model.
- Changes to `setGroupDataVersion` semantics (already unconditional).

## Design Decisions

1. **Set equality, not sorted-array equality** — Two `Set` objects are the idiomatic comparison for unordered pubkey collections in TypeScript. Constructing two `Set`s and checking length + every-member-present is O(n) with no sort overhead. Refs: `app/src/context/MarmotContext.tsx:785`, `:802`.

2. **Extract to a pure helper in `app/src/lib/marmot/memberGuard.ts`** — Codebase exploration found that `MarmotContext.tsx` is too React-lifecycle-heavy to unit-test directly (the only existing test of context-exported logic — `autoCommitLeave.test.ts` — requires 12+ `vi.mock(...)` calls before `await import('@/src/context/MarmotContext')` succeeds). Extracting the comparison to a pure function in `app/src/lib/marmot/memberGuard.ts` mirrors the existing `groupStorage.ts` pattern: zero React dependencies, zero IDB dependencies, testable with no mocks. The "inline is fine" reading was rejected when the test-mock-blast-radius cost became visible during exploration.

3. **Guard semantics unchanged for no-member-change case** — When the sets are equal, `persistGroup` and `reloadGroups` are still skipped. The `setGroupDataVersion` bump (line 800) fires unconditionally regardless of the member guard outcome; that is correct and remains unchanged.

## Technical Approach

### `app/src/lib/marmot/memberGuard.ts` (new)

Pure helper. Synchronous, no side effects, no React/IDB dependencies.

```ts
/**
 * Returns true when `stored` and `current` differ as sets of pubkeys.
 * Order-independent; same identities in any order returns false.
 */
export function membersChanged(stored: string[], current: string[]): boolean {
  if (stored.length !== current.length) return true;
  const storedSet = new Set(stored);
  return !current.every((k) => storedSet.has(k));
}
```

### `app/src/context/MarmotContext.tsx`

Both call sites follow the same pattern — replace:

```ts
if (stored && members.length !== stored.memberPubkeys.length) {
```

with:

```ts
if (stored && membersChanged(stored.memberPubkeys, members)) {
```

A single new import line at the top of the file: `import { membersChanged } from '@/src/lib/marmot/memberGuard';`.

### `app/src/context/MarmotContext.test.ts` (or co-located vitest file)

A unit test that:
1. Constructs a `stored` group with `memberPubkeys: ["alice", "bob"]`.
2. Calls the guarded block with `currentMembers = ["alice", "carol"]` (same count, different set).
3. Asserts `persistGroup` was called.
4. Calls the guarded block again with `currentMembers = ["alice", "bob"]` (equal set).
5. Asserts `persistGroup` was NOT called a second time.

If the context is hard to unit-test in isolation, a targeted vitest covering
the set-equality helper function directly satisfies the AC.

## Stories

- **S1 — fix-length-only-guards** — Replace length-only guards with set-equality checks at both call sites and add a unit test. Covers AC-BUG-1, AC-BUG-2, AC-TEST-1.

## Acceptance Criteria

See [`acceptance-criteria.md`](./acceptance-criteria.md).

## Relationship to Other Epics

- **epic-out-of-band-leave** — AC-MEMBERS-1 of that epic verifies the `onMembersChanged` callback fires on a leave commit; this epic ensures the same callback also fires on count-neutral member swaps.

## Non-Goals

- Implementing a ghost-cleanup pass (no spec exists for that operation).
- Changing the semantics of `groupDataVersion` or how consumers read it.

## Amendments

- **2026-05-18** — Reconciled DD-2 and Technical Approach with `architecture.md`. Original DD-2 said "inline helper, not extracted utility"; that was authored before exploration. Exploration found that `MarmotContext.tsx` requires 12+ `vi.mock` calls to import in tests, while `app/src/lib/marmot/*.ts` files have zero React/IDB deps and need no mocks. DD-2 was rewritten to mandate extraction to `app/src/lib/marmot/memberGuard.ts`; Technical Approach now sketches the helper file and the import line. No AC text changed — the ACs were always observable behaviors, agnostic to inline-vs-extracted.
