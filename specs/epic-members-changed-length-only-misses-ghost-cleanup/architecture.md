# Architecture: Members Changed Length-Only Guard Fix

## Paradigm

Functional core + imperative shell. Pure logic (handlers, storage, guards)
lives in `app/src/lib/marmot/`. React context (`MarmotContext.tsx`) is the
imperative shell that wires lifecycle, subscriptions, and IDB side effects.
This epic follows that pattern: the guard logic is extracted to a pure
function in `app/src/lib/marmot/memberGuard.ts`; the context calls it.

## Module Map

| Module | Purpose | Location |
|--------|---------|----------|
| `memberGuard` | Pure set-equality helper for member list comparison | `app/src/lib/marmot/memberGuard.ts` (new) |
| `MarmotContext` | Subscription lifecycle, calls guard at two sites | `app/src/context/MarmotContext.tsx` (patched) |
| `membersChanged.test` | Unit tests for the pure helper | `app/tests/unit/marmot/membersChanged.test.ts` (new) |

## Boundary Rules

- No direct imports across module boundaries. Cross-module access only
  through declared seam contracts.
- `MarmotContext.tsx` imports `memberGuard.ts` via the `@/src/lib/marmot/`
  alias — same import path convention as other lib imports in that file.
- `memberGuard.ts` must have zero React and zero IDB dependencies. Its only
  input is two `string[]` arrays.

## Seams

None required. The guard function is a single synchronous function with no
async seam.

## Implementation Constraints

1. `getGroupMembers` and `stored.memberPubkeys` are both `string[]`
   (hex-encoded nostr pubkeys). The comparison is order-agnostic — a
   permutation of the same pubkeys is still the same set.
2. `setGroupDataVersion` at line 800 is unconditional and MUST NOT be
   moved inside the guard. The fix only changes the `persistGroup` /
   `reloadGroups` guard, not the version bump.
3. The guard at line 785 (startup sync) uses `mlsMembers` as the current
   side and `stored.memberPubkeys` as the stored side — identical semantics
   to line 802; same helper call applies.
4. The test file MUST live at `app/tests/unit/marmot/membersChanged.test.ts`
   and match the `tests/unit/**/*.test.ts` glob. No `.tsx` extension.
   No jsdom needed — plain node vitest.
