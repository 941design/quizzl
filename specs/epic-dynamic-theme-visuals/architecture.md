# Epic Architecture: dynamic-theme-visuals (Phase A + Phase B)

**ADR**: docs/adr/ADR-004-pluggable-themes.md (extends; no new ADR needed for Phase A or B)
**Status**: current
**Scope**: Phase A (S1–S6, shipped 2026-07-06) + Phase B (S7–S9, unblocked 2026-07-06 — ink published
`visuals-v0.1.2`, see spec.md `## Amendments`). v2 (dark themes, more elements) remains out of scope.
Phase B touches exactly the one seam Phase A reserved for it: `dynamicVisuals.ts`'s import line (swap
the stub for `@rotheric/visuals`), plus a new theme folder and a perf-validation pass — no other Phase A
module changes shape.

> Agents read this file before every story. It is directive, not narrative.
> Where this file and `spec.md` disagree, **this file wins**.

## Paradigm

**Mixed** — unchanged from `specs/epic-pluggable-themes/architecture.md`, which this epic extends
rather than supersedes: `app/src/themes/<id>/` is **package-by-feature** (each theme a self-contained
pure-data folder); shared infrastructure is **layered n-tier + functional-core/imperative-shell**
(manifests and transforms are pure/core; the generator script and the vitest validation gate are the
imperative shell). The new modules below slot into the imperative-shell layer — no new paradigm.

**One explicit precedent-break, called out because it's the first of its kind:** every existing
`treatments/*` file is a pure, synchronous lookup table with only type-only Chakra imports.
`dynamicVisuals.ts` is the first `treatments/*` module that (a) performs actual computation instead of
static lookup, and (b) carries a real runtime import (the stub generator now; the ink package in Phase
B). This is intentional and scoped to exactly one file (AC-STRUCT-4).

## Module Map

| Module | Purpose | Location | Owned Data |
|---|---|---|---|
| schema (extended) | add optional `treatments.dynamic: { banner?, background? }` map of `.strict()` `DynamicElement` | app/src/themes/schema.ts | the dynamic-element/style-token shape; validation-only, never in client bundle |
| dynamicVisuals (NEW) | `DYNAMIC_GENERATORS` name→function registry; `watercolor` entry = stub in Phase A | app/src/themes/treatments/dynamicVisuals.ts | the randomizeParams+override call shape; **the only module in `app/src` allowed a runtime import of the generator/stub** |
| useDynamicBanner (NEW) | client-only hook; on mount, if `treatments.dynamic?.banner` present, generate a fresh SVG, encode as data-URI, expose a swapped `backgroundImage`; on failure, keep/revert to static (AC-UX-3a) | app/src/hooks/useDynamicBanner.ts | dynamic banner state; must NOT modify `useThemeStyles.ts` |
| banner.worker (NEW) | off-main-thread generation via `postMessage`; `requestIdleCallback` fallback if worker bundling proves fussy | app/src/workers/banner.worker.ts | none — pure message-passing wrapper around `dynamicVisuals`'s generator call |
| Layout.tsx (modified) | reserve banner box; cross-fade generated image over static; render legibility scrim behind logo | app/src/components/Layout.tsx | scrim presence/contrast |
| useThemeStyles.ts (unmodified) | `computeThemeStyles()` stays pure, keeps returning static `bannerDecorStyle` | app/src/hooks/useThemeStyles.ts | — (explicitly NOT touched by this epic) |
| themes-validation.test.ts (extended) | new `describe('AC-...')` blocks: generator-catalog check (AC-VAL-1), style-token bounds (AC-VAL-2), zod-boundary extension (AC-BOUND-1), single-import-site scanner for `dynamicVisuals.ts` (AC-STRUCT-4) | app/tests/unit/themes-validation.test.ts | — |
| useDynamicBanner.test.ts (NEW) | unit tests for the hook's pure decision function (see Boundary Rules — no jsdom/RTL in this repo) | app/tests/unit/hooks/useDynamicBanner.test.ts | — |
| dynamicVisuals (Phase B, modified) | swap the stub import for the real `@rotheric/visuals` package pinned to the `visuals-v0.1.2` git tag; `DYNAMIC_GENERATORS.watercolor`'s signature and call shape are unchanged (the seam held) | app/src/themes/treatments/dynamicVisuals.ts | same as Phase A row — only the import line and package.json's git dependency entry change |
| aquarelle theme (S8, NEW) | brand-new light theme folder declaring `treatments.dynamic.banner` with a tuned `StyleToken` and a frozen static fallback captured from one real generator run; drop-in via the existing theme registry, no shared-file edits beyond what S1 already added | app/src/themes/aquarelle/manifest.ts (+ any co-located static-fallback asset, following existing per-theme folder precedent) | this theme's own palette/style-token pin; ships `status: 'experimental'` until S9 clears AC-PERF-3 |
| perf validation (S9, no new module) | measure real generation+paint cost on a low-end profile, finalize the `render` lite-preset knob values, flip `aquarelle`'s `status` from `'experimental'` once green | touches `aquarelle/manifest.ts` (`status` field, `render` knob values) — no new files | — |

## Seam Contracts

### DynamicElement (schema.ts → dynamicVisuals.ts, useDynamicBanner.ts)

| Field | Type | Optional |
|---|---|---|
| generator | `'watercolor'` (closed enum, inline-declared per existing convention — see Boundary Rules) | no |
| style | `StyleToken` — `{ anchorHue: 0-359, scheme: enum, saturation: 20-100, lightness: 20-75 }`, `.strict()` | no |
| clip | `'button'\|'card'\|'avatar'` | yes (unused in Phase A; schema must admit it for v2 without redesign) |
| render | partial perf knobs — likely `z.record(z.string(), z.unknown())` escape hatch per `RawOverridesSchema` precedent, unless story-planning nails the exact field set | yes |

**Invariants** (enforced in `themes-validation.test.ts`, not zod alone): unknown `generator` fails the
build (AC-VAL-1); `style` bounds violations fail validation (AC-VAL-2); a manifest without
`treatments.dynamic` validates and renders exactly as today (AC-STRUCT-1); `treatments.banner` stays
required even when `treatments.dynamic.banner` is present (AC-STRUCT-2).

**Produced by**: S1 (schema) | **Consumed by**: S2 (adapter), S3 (hook).

### DYNAMIC_GENERATORS registry (dynamicVisuals.ts → useDynamicBanner.ts)

| Field | Type | Notes |
|---|---|---|
| `watercolor` | `(style: StyleToken, kind: 'banner', render?) => string` | calls `randomizeParams()` + overrides pinned `style` fields; forces size/format; returns self-contained SVG string (no `<script>`, no external refs) |

**Invariant**: two successive calls return different `svg` strings while both reflect the pinned style
identity (AC-UX-1). In Phase A this is verified against the stub; in Phase B (S7) the same invariant
must hold against the real `@rotheric/visuals` `renderSVG` call — AC-UX-1 is not re-tested from scratch,
but S7 must confirm the real package satisfies the same contract the stub was standing in for.

**Produced by**: S2 (stub) / S7 (real) | **Consumed by**: S3.

### useDynamicBanner return (useDynamicBanner.ts → Layout.tsx)

Following the `computeThemeStyles()` precedent (a pure function separable from the `useEffect`
plumbing, because this repo has no jsdom/RTL — see Boundary Rules): export a pure decision function
(e.g. `resolveDynamicBannerStyle(definition, generatedSvg | null)`) that the hook wraps. The hook itself
does the `useEffect`/worker-message orchestration and calls the pure function to compute the swapped
`style.backgroundImage`, exactly mirroring `navBannerDecor()`'s two-field split (`boxProps` vs raw
`style`) — folding the swapped value into `boxProps` will silently break in the browser (Chakra drops
data-URI `backgroundImage` through its style pipeline) without failing any test, since jsdom isn't even
in play here — so this must be caught by review/manual check, not assumed caught by a unit test.

**Produced by**: S3 | **Consumed by**: Layout.tsx (S3), scrim (S4).

## Boundary Rules

1. **zod stays build/test-only.** `schema.ts` remains the only module with a runtime `zod` import.
   Enforced today by a resolved-import scanner in `themes-validation.test.ts:443-731` (not ESLint — no
   ESLint config exists anywhere under `app/`). This scanner's pattern (parse imports, classify runtime
   vs. type-only, resolve specifiers against an absolute target path) is the **exact reusable mechanism**
   for the next rule.
2. **Single-import-site invariant (AC-STRUCT-4).** `dynamicVisuals.ts` is the only module in `app/src`
   that imports the generator (the stub in Phase A, `@rotheric/visuals` pinned to `visuals-v0.1.2` in
   Phase B). Enforce with a sibling test using the same resolved-import-scanner pattern as rule 1,
   targeting `dynamicVisuals.ts`'s import specifier instead of `schema.ts`. S7 re-runs this scanner
   against the real import, not just the stub.
3. **Generator/style-token enum declared inline, not imported.** Per this file's own established
   convention (`ElevationNameSchema` etc. are independently declared in `schema.ts`, "kept in sync by
   hand" — see schema.ts header comment), the new `generator: z.enum(['watercolor'])` follows the same
   pattern: declared inline in `schema.ts`, pinned against `DYNAMIC_GENERATORS`'s keys by a
   `themes-validation.test.ts` describe block mirroring the existing enum-catalog-schema-treatment-sync
   test (lines 732–765).
4. **Codegen stays structural-only.** `generate-theme-registry.mjs` never gains generator-catalog logic
   — it never imports/evaluates TS. AC-VAL-1's generator-catalog check lives in the vitest suite
   (`themes-validation.test.ts`), joining the value-level validation gate, not the `.mjs` codegen script.
   This resolves an ambiguity in spec.md §4's "joins the build gate" language.
5. **`computeThemeStyles()` / `useThemeStyles.ts` stay untouched.** All dynamic logic lives in the new
   `useDynamicBanner.ts` — a second, independent client-only hook that `Layout.tsx` calls alongside
   `useThemeStyles()`. Do not add dynamic branches inside `computeThemeStyles()`.
6. **Runtime generation failure is fail-soft; build-time validation is fail-loud.** Mirrors the existing
   `validateManifest()` (throws, build-time) vs. `resolveIconId()` (silent fallback, runtime) split.
   `useDynamicBanner`'s failure path (AC-UX-3a) must never throw uncaught; it keeps/reverts to the static
   `bannerDecorStyle`.
7. **No jsdom / no React Testing Library in this repo** (confirmed: absent from `app/package.json`).
   No hook can be rendered or mounted in tests. `useDynamicBanner.ts` MUST be structured as a thin
   `useEffect`/`useState` wrapper around an exported plain function holding all actual decision logic
   (mirrors `computeThemeStyles()` being separately testable from `useThemeStyles()`) — that plain
   function is what S6's tests exercise, never the hook via a render.
8. **No SVG parser in this test suite.** AC-STRUCT-6/AC-UX-5 assertions (self-containment, valid
   data-URI SVG) follow the existing lightweight string/regex-matching style already used for the static
   banner's encoded data, not a new parsing dependency.
9. **Contrast checks reuse `contrast.ts`'s `wcagRatio(hexA, hexB)`** (pure, zero imports) for the
   scrim-vs-`brand.500` check (AC-A11Y-1/2), at the existing `WCAG_AA_THRESHOLD = 4.5`.
   `evaluateThemeContrast()` itself is NOT directly reusable (it takes a `ThemeManifest`, not arbitrary
   colors) — use the underlying `wcagRatio` primitive directly.
10. **No i18n work needed.** Phase A introduces zero new user-facing strings (purely decorative); the
    project convention exempts purely-decorative elements from translation requirements.
11. **Worker bundling is genuinely greenfield** (zero existing `new Worker(...)` usage in this repo).
    Use Next.js 14's built-in `new Worker(new URL('../workers/banner.worker.ts', import.meta.url))`
    pattern — no worker-loader plugin exists or is needed. If bundling under `output: 'export'` proves
    fussy, fall back to `requestIdleCallback` per spec.md §6 (already anticipated as a non-blocking build
    detail, not a story-planning gap).

## Implementation Constraints

- `.strict()` at every new zod object level (StyleToken, DynamicElement, the `dynamic` map itself) — no
  exceptions, per existing schema.ts convention.
- New files (`dynamicVisuals.ts`, `useDynamicBanner.ts`, `banner.worker.ts`) carry a header docblock
  citing this architecture.md's Module Map entry and Boundary Rule, matching house style
  (`schema.ts:1-19`, `useThemeStyles.ts:1-17` precedent).
- Test `describe` blocks are named `AC-<ID>: <description>`, one per acceptance criterion, added to
  `themes-validation.test.ts` (structural/validation ACs) or the new `useDynamicBanner.test.ts` (hook
  behavior ACs) — mirroring the existing 1:1 describe-to-AC convention.
- S6's Web-Worker-path test coverage is scoped to the `requestIdleCallback`/fallback mechanism only (no
  real Worker-thread mocking infrastructure exists in this repo); real off-thread execution is a
  Phase B / manual-verification concern per the AC-PERF-1/2 amendment already in acceptance-criteria.md.
- **Why S6's tests read source files directly (`readFileSync`) rather than only importing modules.**
  AC-STRUCT-5 (useThemeStyles.ts untouched), AC-PERF-2 (Worker/idle-callback code path present), and
  AC-META-1 (no snapshot-matcher anywhere in the suite) are *structural* invariants about what code
  exists/doesn't exist — not runtime behavior a pure-function call can observe. In a repo with no
  jsdom/RTL, source-content scanning (the same resolved-import-scanner-adjacent technique S1/S2 already
  established for the zod/single-import-site boundaries) is the only mechanical way to assert these;
  the alternative is trusting an unenforced convention. This is an intentional, narrow pattern — it
  should not be read as a precedent for testing runtime *behavior* by reading source text instead of
  calling a function.

## Story Order

**Phase A** (shipped): S1 → S2 → S3 → S4 → S5 → S6, as ordered in spec.md §7. S1 (schema) gates
everything; S2 (adapter+stub) gates S3; S4 (scrim) and S5 (worker offload) can proceed once S3 lands and
have no dependency on each other; S6 (tests) is last, covering all of S1–S5's behavioral surface.

**Phase B**: S7 → S8 → S9, strictly sequential — no parallel opportunity. S7 (wire the real package)
must land before S8 can capture a real static-fallback render or tune a real style token; S9's
measurement is meaningless without S8's actual theme to measure. Implemented one story at a time per
the same "sequential by design" rule Phase A followed (feature.md "Design priorities and non-goals").

## Open Questions / Accepted Risks

- The exact `render` perf-knob field set is left as a `z.record` escape hatch (Implementation
  Constraints) rather than fully typed — S1's story may tighten this if the story-planner determines the
  full knob set is already implied by spec.md's "lite preset" numbers (§ink-channel-log.md IQ1). **S9 is
  where this finally gets resolved**: the lite preset's concrete knob values are only knowable once real
  perf measurement (S9) is in hand.
- Worker bundling under `output: 'export'` is unverified in this exact repo (no precedent); S5 carried the
  spec's own acknowledged fallback risk in Phase A (against the stub). **S7 must re-confirm this holds
  against the real `@rotheric/visuals` package** — a Worker-safe pure function per ink's README is a
  stated property of the package, but the stub's Worker-safety doesn't prove the real package's.
- **New Phase B risk**: `@rotheric/visuals`'s `main`/`browser`/`module` fields all resolve to
  `./dist/index.js`, and the package ships no `prepare`/`postinstall` (per ink's README) — so no build
  step runs on install. Confirm this resolves cleanly through Next.js's static-export bundler on first
  wire-up (S7); if it doesn't, the failure mode is a bundler resolution error, not a silent behavioral
  regression, so it will surface immediately rather than needing a dedicated test.
