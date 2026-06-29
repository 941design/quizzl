# Feature Spec: Unit Coverage for Custom Hooks

**Status:** Planned
**Source:** BACKLOG.json finding `test-gap-hooks-no-unit-coverage` (promoted 2026-06-29)

## Goal

Give the app's still-existing untested custom hooks direct unit-level coverage so
regressions in their logic are caught before they ship.

## Background / Problem

The original finding named seven untested hooks. **Three no longer exist** —
`useSelectedTopics`, `useStudyTimer`, and `useTopicProgress` were removed with the
learning platform (`fd06674 refactor: remove learning platform`). Of the rest,
`useDecryptedImage` and `useImageSend` are already covered. That leaves **four
untested hooks** still in `app/src/hooks/`:

| Hook | LOC | Nature |
|---|---|---|
| `useThemeStyles.ts` | 350 | mostly pure style-mapping over the active theme |
| `useDirectReactions.ts` | 107 | DM reactions read-side: subscribe + recompute |
| `useMoodTheme.tsx` | 71 | theme context (provider + `useAppTheme`/`useMoodTheme`) |
| `useOnlineStatus.ts` | 44 | online/offline tracking via window events |

`useDirectReactions` carries the most behavioral risk (the DM reactions re-open
path); the theming hooks are lower-risk but still unguarded.

## Key Decision (shared with the context-providers epic)

**How are React-lifecycle hooks to be unit-tested?** The project has no DOM test
environment and no `@testing-library/react`; existing hook tests exercise
*extracted pure functions* (see `useDecryptedImage.test.ts`). `useOnlineStatus`,
`useMoodTheme`, and parts of `useDirectReactions` are React-lifecycle-bound and
need either:

- **A — `@testing-library/react` + `happy-dom`** (per-file opt-in environment) to
  drive the hooks with `renderHook`; or
- **B — extract** the testable logic into pure modules and test those.

`useThemeStyles` is largely pure style computation and could be covered under
either path (extract the `surfaceOverlay`-style helpers, or render once per theme).
This decision is the gate; it is the same one the context-providers epic faces, so
the two epics should resolve it consistently.

## Scope

### In scope
- Unit coverage for the four untested hooks listed above.
- Whichever enabling change Path A or Path B requires.

### Out of scope
- Re-introducing tests for the three deleted hooks.
- `useDecryptedImage` / `useImageSend` (already covered).
- Changing any hook's runtime behavior.

## Stories (to be split after the Key Decision is made)

Expected shape: group by approach — pure-logic hooks (`useThemeStyles`, the
non-React parts of `useDirectReactions`) first, then the lifecycle-bound ones once
the test-infra path is chosen.

## Non-Goals
- A coverage-percentage target for its own sake — assert behavior, not lines.
