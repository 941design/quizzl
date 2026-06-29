# Acceptance Criteria — Unit Coverage for Custom Hooks

> Planned epic. ACs are high-level until the **Key Decision** (test approach,
> shared with the context-providers epic — see spec.md) is resolved and stories
> are split.

## AC-DECISION-1 — Test approach chosen (consistent with context-providers epic)
- A decision is recorded (Path A: `@testing-library/react` + `happy-dom`, scoped
  per-file; or Path B: extract pure logic) before story planning, and matches the
  approach chosen for the context-providers epic. If Path A, the DOM environment
  MUST be opt-in per test file so existing node-environment suites keep passing.

## AC-COV-1 — Each remaining untested hook is covered
- `useThemeStyles`, `useDirectReactions`, `useMoodTheme`, and `useOnlineStatus`
  each gain unit tests asserting their observable behavior:
  - `useOnlineStatus`: online/offline transitions and `lastOnlineAt` updates.
  - `useMoodTheme`/`useAppTheme`: hydration from settings, `setTheme` persistence,
    `mood` mirroring `themeName`, throw-outside-provider.
  - `useDirectReactions`: empty when no peer, load+aggregate, recompute on store
    event and on messages change, cleanup unsubscribes.
  - `useThemeStyles`: returns the correct style bag per theme visual style.

## AC-SCOPE-1 — Deleted hooks excluded
- No tests are added for `useSelectedTopics`, `useStudyTimer`, or `useTopicProgress`
  (removed with the learning platform).

## AC-GREEN-1 — Suite stays green
- `make test-unit` passes with the new tests and no pre-existing suite regresses.
