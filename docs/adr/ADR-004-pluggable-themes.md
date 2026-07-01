# ADR-004: Pluggable Themes — folder-per-theme registry with build-time validation

**Status**: Accepted
**Date**: 2026-07-01
**Type**: Debated
**Epic**: specs/epic-pluggable-themes/
**Affects**: app/src/themes/ (new), app/src/lib/theme.ts, app/src/types/index.ts, app/src/hooks/useThemeStyles.ts, app/src/components/ThemeIcon.tsx, app/pages/_document.tsx, app/pages/profile.tsx, app/src/lib/i18n.ts, app/package.json, app/scripts/, app/tests/unit/

## Context

Adding a theme today means editing seven locations across five files (`app/src/types/index.ts:8`, `app/src/lib/theme.ts`, `app/src/lib/i18n.ts`, `app/src/hooks/useThemeStyles.ts`, `app/src/components/ThemeIcon.tsx`, `app/pages/_document.tsx`). A theme's look is split between declarative Chakra token data (`theme.ts`) and a closed `visualStyle` enum that fans out into ~7 hand-written `switch` blocks. Colors are 50 hand-picked hex values per theme with no contrast guarantee — the Minecraft illegibility bug (dark text on a dark background) came from this gap and was patched with an ad-hoc `contentSurface` boolean.

The epic (spec at `specs/epic-pluggable-themes/spec.md`) converts theme authoring into a **self-contained, drop-in-a-folder** activity, validated at build time, with a published authoring guide. Locked product decisions (D1–D4): theme text inline in each manifest; fully composable treatments; add `zod`; fonts auto-managed via a generated union plus inline SVG banners.

Hard constraints from the codebase: `output: 'export'` + webpack (`app/next.config.mjs:20`) forbids runtime filesystem reads — detection must be **build-time codegen emitting a static registry**. There is no TS runner (no tsx/ts-node); the codegen precedent is a plain Node ESM `.mjs` (`app/scripts/generate-avatar-manifest.mjs`). Chakra UI is the render engine (`app/pages/_app.tsx:40`) — the token layer must keep emitting a Chakra `ThemeOverride`. The public theme API in `app/src/lib/theme.ts:737-751` is consumed by only six files plus one test, so preserving that API surface keeps the change contained. `zod` is not currently installed; snapshot testing is not used in the project (zero `toMatchSnapshot`).

This decision was reached through a two-round Proposer↔Codex-adversary debate; the full transcript is in `specs/epic-pluggable-themes/arch-debate-*.{md,json}`.

## Decision

Introduce `app/src/themes/` as a **package-by-feature** module: one self-contained pure-data subfolder per theme, auto-detected at build time by a generator that emits a committed `registry.generated.ts`. Shared infrastructure (schema, builder, treatment library, public API) is layered n-tier domain code with a functional-core / imperative-shell grain (pure manifests + pure transforms; the generator and validation gate are the imperative shell). `app/src/lib/theme.ts` becomes a thin re-export of the new module's public API so the six existing consumers do not change import paths.

Key elements:

- **Manifest = pure data** (`ThemeManifest`, zod-inferred): identity, `order`, localized `label`/`description`, explicit 10-step color scales + semantic tokens, typography with a `FontLoad[]` declaration, and **independent per-surface treatment selectors** (card / button / nav elevations, surface pattern, icon set, banner, optional content-panel). No Chakra import, no functions — serializable.
- **Treatments are genuinely composable** (honoring D2): each surface picks a named treatment independently, resolved from a shared treatment library. The five migrated themes set them consistently (byte-identical output), but new themes may mix them; a raw-props `overrides` escape hatch remains.
- **Build-time validation fails the build** on any non-conforming theme: zod structural parse + cross-field checks (WCAG-AA contrast computed on **actual** rendered text/surface pairs, `id === folder`, unique `order`), a folder/registry drift test, and a generated-metadata freshness check — all runnable on the plain vitest path, plus a generator `--check` idempotence gate in CI.
- **Migration is byte-identical** (`toEqual` against a baseline captured and committed before any refactor).

The alternatives and the residual accepted risks below were surfaced by the debate and are carried forward as explicit implementation constraints in `specs/epic-pluggable-themes/architecture.md`.

## Rationale

The debate materially changed the design. Round 1 (Codex) found real contradictions the initial proposal shipped with; Round 1 response resolved them; Round 2 found residual weaknesses in the *newly added* mechanisms, which are now folded in as constraints:

- **`visualStyle` in the hook return** — the proposal claimed "return shape unchanged" while dropping `visualStyle`. Grep proved `visualStyle` and `isFunTheme` have **no external consumers** (`useThemeStyles.ts:346` is the only site). Resolution: drop both — the hook returns the six BoxProps/decoration fields that are actually consumed.
- **Contract drift** (`manifest.iconSet` vs `manifest.treatments.iconSet`; contentSurface auto-derived vs read directly) — resolved to single canonical paths.
- **THEME_FONTS mismatch** — the initial font inventory was wrong against `app/pages/_document.tsx:10` (DM Serif Display uses `ital@0;1`; Nunito includes weight 800). Resolution: a `FontLoad { family; weights?; ital? }` shape that reproduces the exact URL (AC14).
- **Unowned picker order** — a glob-generated registry can be idempotent yet reorder the profile picker (`profile.tsx:221` renders `Object.values(APP_THEMES)`), breaking visual parity. Resolution: a required, unique `order` field; the generator sorts by it.
- **contentSurface coherence** (Round 2) — a trusted `contentSurface`/`colorScheme` boolean can contradict the actual colors and re-admit the Minecraft-class bug. Resolution: the contrast gate is computed from **real** color values, not from booleans; `colorScheme` is descriptive metadata only.
- **Registry freshness on the test path** (Round 2) — `make test-unit`/`npm run test:unit` run vitest directly without the generator (`Makefile:107-109`), so a folder-only drift test misses metadata drift (editing an existing manifest's `order`/`fontLoad`). Resolution: the validation test recomputes the deduped `THEME_FONTS` and sorted `order` from the manifests and asserts equality with the committed registry; a generator `--check` mode gates CI.
- **`isFunTheme` coupling** (Round 2) — a consumer-side elevation allowlist would recreate the very hardcoded per-look list the epic removes. Since the value is unused, it is deleted outright.
- **Bundled elevation** (Round 2) — a single `elevation` token coupling card/button/nav/surface is a renamed closed look-package, contradicting D2. Resolution: independent per-surface selectors.

## Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| Keep the closed `visualStyle` enum, just move data into files | Preserves the ~7-switch fan-out and the "add a case in every switch" tax; fails G2 (drop-a-folder) and D2 (composable). |
| Webpack `require.context` auto-detection (no generator) | `require.context` is not guaranteed safe under `output:'export'`; splits enumeration between webpack (app) and glob (tests); no place to run validation. A committed generated registry is a single source both app and tests import. |
| Single bundled `elevation` preset + overrides only | Contradicts locked decision D2 ("fully composable treatments"); a renamed closed look-package. Rejected in favor of independent per-surface selectors. |
| Auto-derive `contentSurface` from `colorScheme: 'dark'` | Minecraft is a dark-*background*/light-*surface* theme, not general dark mode; the derivation is wrong for it and trusts a boolean over real colors. Rejected for a real-contrast gate. |
| `isFunTheme` as an explicit manifest field, or derived from an elevation allowlist | The value has zero consumers (`useThemeStyles.ts:346`); both options add a source of truth for dead output. Deleted instead. |
| vitest snapshots for AC9 parity | Project uses no snapshots; `toEqual` against a pre-captured, committed baseline is the established pattern and avoids Chakra key-order nondeterminism. |

## Consequences

**Positive**
- Adding a theme that composes existing treatments is a pure folder drop — no shared-code edits (G2).
- Non-conforming themes fail the build, including a real-contrast gate that generalizes the Minecraft fix to all themes (G3).
- The closed `visualStyle` enum and its ~7 switch blocks are eliminated; treatments compose (D2).
- `AppThemeName`, picker order, and the font `<link>` are all derived from the folders — no manual edits, correct by construction.

**Negative / Trade-offs**
- Larger module surface (schema, builder, three treatment tables, generator, validation test, per-theme manifests) around only five themes — a migration cost accepted to unlock G2/G3.
- A committed generated file (`registry.generated.ts`) is a shared write target and a merge-conflict surface across parallel theme branches.
- Manifest authors must supply a unique `order` and accurate `FontLoad` entries; both are validated, so mistakes are build failures rather than silent regressions.

**Accepted Risks** (residual after Round 2)
- **Function-free manifests cannot express token-derived banners/patterns.** All current banners/backgrounds are static strings, so this holds for the epic; a future theme needing an SVG colored from its own tokens requires a manifest-v2 or a generator escape hatch. The authoring guide must state this limit.
- **"Pluggable" has a boundary.** Composing from existing treatments is folder-only; a genuinely novel look (a new elevation/iconSet/pattern primitive) requires one edit to the treatment library — not a pure folder drop. This is the accepted scope of G2.
- **Eager import-time `extendTheme` caching** (for referential stability) means manifest-only callers still pull Chakra construction side effects — negligible for five themes, but it forgoes tree-shaking of the builder.
- **Manual `order` assignment** can collide across independent branches; this surfaces as a validation failure, not silent UI reordering.

## Evolution Triggers

Reopen this ADR when any of the following occurs:
- **User-uploaded or runtime themes** are wanted — the static-generated-imports + generated-`AppThemeName` + `value in APP_THEMES` model assumes build-time, developer-authored themes (the manifest is kept serializable to ease this later, but the loading path would change).
- **A theme needs a token-derived banner or pattern** — breaks the function-free manifest boundary (A4).
- **Novel looks proliferate** such that treatment-library edits become frequent — would justify promoting treatments themselves to a plugin mechanism rather than a fixed library.
- **A general dark-mode** (light text, no panel, dark surfaces) is introduced — the real-contrast gate already supports it, but the `colorScheme` metadata semantics and content-panel model should be revisited as first-class rather than Minecraft-special.

## Debate Summary

- Round 1 blocking concerns: 6; resolved: 6; accepted: 0.
- Round 2 blocking concerns: 7; adopted as implementation constraints: 7; left unaddressed: 0.
- Residual accepted risks (evolution-bounded, not blocking): 4 (function-free manifests, pluggable boundary, eager-cache tree-shaking, manual order collisions).

## Post-review hardening (2026-07-01)

An independent review of `spec.md` raised nine findings; all are now resolved in `spec.md` §§6.4–6.10/8
and `architecture.md` constraints 1–17. Two were verified **empirically** (probes run against the live
`theme.ts`, then removed):
- **AC9 "byte-identical"** is defined as `toEqual` on a fixed path allowlist (`colors, semanticTokens,
  fonts, fontSizes, radii, styles, config, components.<Name>.defaultProps`). Probe confirmed these
  subtrees are function-free, JSON-round-trippable, and deterministic; the merged theme's ~50 functions
  are all Chakra-default `components.*.variants|baseStyle`, outside the allowlist. (Finding #3)
- **Contrast pairs/thresholds** were calibrated against measured ratios so the gate passes all five
  current themes (min margin 4.78) yet still rejects the Minecraft-on-`appBg` dark-on-dark case
  (2.21 / 1.03), which stays exempt only via explicit `contentSurface`. (Finding #7)
The most material fix: the **plain-`.mjs` generator cannot import TS manifests** (finding #1). Resolved
with zero new dependencies — the generator emits only a folder-name scaffold; `order` sort and
`THEME_FONTS` dedup run in the emitted TypeScript at evaluation time, and all value validation runs on
the vitest path. Remaining findings (#2 font-URL determinism, #4 goal scope, #5 `status:hidden`, #6
AC5 wording, #8 zod-boundary test, #9 `id` regex) are folded into the ACs and constraints.
