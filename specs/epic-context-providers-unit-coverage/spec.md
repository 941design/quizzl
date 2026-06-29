# Feature Spec: Unit Coverage for React Context Providers

**Status:** Planned
**Source:** BACKLOG.json finding `test-gap-context-providers-no-unit-coverage` (promoted 2026-06-29)

## Goal

Give the app's React context providers direct unit-level test coverage so a
regression in their state logic is caught before it ships, instead of only
surfacing through e2e or in production.

## Background / Problem

Six of seven React contexts ship substantial state logic with **no unit-level
guard** — only `LanguageContext` is exercised indirectly (via i18n tests).
Measured coverage (via the `@vitest/coverage-v8` instrumentation added this
cycle) is ~0–10% statements per file:

| Context | LOC | Direct coverage |
|---|---|---|
| `MarmotContext.tsx` | 1689 | ~5% |
| `NostrIdentityContext.tsx` | 734 | ~4% |
| `ChatStoreContext.tsx` | 434 | 0% |
| `PollStoreContext.tsx` | 324 | 0% |
| `BackupContext.tsx` | 80 | ~3% |
| `ProfileContext.tsx` | 51 | ~10% |
| **Total** | **3375** | — |

This is epic-sized (3375 LOC, `MarmotContext` alone 1689) — a multi-story effort,
not a single fix, which is why it was deferred from the backlog.

## Key Decision (must be resolved before stories are planned)

**How are React-lifecycle contexts to be unit-tested?** The project deliberately
has **no DOM test environment and no `@testing-library/react`** — existing "hook"
and "context" coverage tests exercise *extracted pure functions* (see
`useDecryptedImage.test.ts`, which tests `fetchDecryptedMedia` rather than rendering
the hook). Two viable paths:

- **A — Adopt render-based testing.** Add `@testing-library/react` + a DOM
  environment (`happy-dom`/`jsdom`), scoped per-file via `// @vitest-environment
  happy-dom` so the existing node-environment suites (e.g. the SSR-guard tests that
  assert `typeof window === 'undefined'`) are unaffected. Test providers with
  `renderHook`/`render`.
- **B — Extract-and-test.** Refactor each context to move its state logic into
  pure modules (the established `useDecryptedImage` pattern) and unit-test those,
  leaving the provider a thin wiring shell.

This is a real architectural choice (new test dependency + paradigm vs. a
refactoring effort across 3375 LOC) and is the gate for this epic.

## Scope

### In scope
- Direct unit coverage of the six untested contexts' state logic.
- Whichever enabling change Path A or Path B requires.

### Out of scope
- Changing any context's runtime behavior.
- E2E coverage (these contexts are already exercised end-to-end).
- `LanguageContext` (already covered indirectly).

## Stories (to be split after the Key Decision is made)

Expected shape: one story per context (or per cohesive context group), largest
first (`MarmotContext`), each landing direct unit tests for that context's state
transitions and edge cases.

## Non-Goals
- Hitting a specific coverage percentage for its own sake — assert behavior, not lines.
