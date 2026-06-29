# Acceptance Criteria — Unit Coverage for React Context Providers

> Planned epic. ACs are high-level until the **Key Decision** (test approach,
> see spec.md) is resolved and stories are split.

## AC-DECISION-1 — Test approach chosen
- A decision is recorded (Path A: `@testing-library/react` + `happy-dom`, scoped
  per-file; or Path B: extract state logic into pure modules) before story
  planning. If Path A, the DOM environment MUST be opt-in per test file so the
  existing node-environment suites (incl. the SSR-guard tests) keep passing.

## AC-COV-1 — Each targeted context has behavioral unit tests
- `MarmotContext`, `NostrIdentityContext`, `ChatStoreContext`, `PollStoreContext`,
  `BackupContext`, and `ProfileContext` each gain unit tests asserting their
  state transitions and edge cases (not just that they render).

## AC-COV-2 — Tests assert behavior, not implementation
- Tests exercise observable state outputs / emitted values, not internal variable
  names, so they survive refactors.

## AC-GREEN-1 — Suite stays green
- `make test-unit` passes with the new tests, and no pre-existing suite regresses
  (specifically the SSR-guard / node-environment tests).
