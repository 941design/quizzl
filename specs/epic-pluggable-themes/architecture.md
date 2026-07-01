# Epic Architecture: pluggable-themes

**ADR**: docs/adr/ADR-004-pluggable-themes.md
**Status**: current
**Last updated**: 2026-07-01 (hardened after independent spec review — findings #1–#9 resolved)

> Agents read this file before every story. It is directive, not narrative.
> Where this file and `spec.md` disagree, **this file wins** (it incorporates the debate outcome).

## Paradigm

**Mixed.** `app/src/themes/<id>/` is **package-by-feature** (each theme a self-contained pure-data folder). The shared infrastructure (`schema`, `buildChakraTheme`, `treatments/*`, `index`) is **layered n-tier + functional-core/imperative-shell**: manifests and transforms are pure (core); the generator script and the vitest validation gate are the imperative shell. `themes/index.ts` occupies the domain-layer slot `lib/theme.ts` holds today.

## Module Map

| Module | Purpose | Location | Owned Data |
|---|---|---|---|
| schema | zod `ThemeManifestSchema` + inferred `ThemeManifest` + `validateManifest()` | app/src/themes/schema.ts | the manifest shape; validation-only (never in client bundle) |
| buildChakraTheme | `buildThemeOverride(manifest)` (pure, function-free) + cached `getChakraTheme = extendTheme(override)`; lifts `createScale()` (theme.ts:71) | app/src/themes/buildChakraTheme.ts | the manifest→Chakra transform |
| fontUnion | `buildThemeFonts(manifests)→FontLoad[]` + `buildFontLinkHref(fonts)→string` | app/src/themes/fontUnion.ts | font dedup + Google Fonts URL construction |
| contrast | `wcagRatio(hex,hex)` + `evaluateThemeContrast(manifest)` | app/src/themes/contrast.ts | contrast math + the pair rules |
| treatments/elevation | independent per-surface named prop-sets | app/src/themes/treatments/elevation.ts | per-elevation BoxProps constants |
| treatments/iconSets | icon-name→iconify-id maps per icon set | app/src/themes/treatments/iconSets.ts | all icon bindings (`line`/`filled`/`pixel`) |
| treatments/patterns | surface pattern + appBg gradient strings | app/src/themes/treatments/patterns.ts | pattern/background CSS |
| registry.generated | GENERATED+COMMITTED **folder-name scaffold only** | app/src/themes/registry.generated.ts | import lines + `AppThemeName` union + `_all` array; `APP_THEMES`/`THEME_FONTS` are computed **in this emitted TS at eval time** via the hand-written helpers (order-sort + `buildThemeFonts`), NOT by the generator |
| index | public API (re-exported by lib/theme.ts) | app/src/themes/index.ts | none — imports/re-exports + cached `getChakraTheme` |
| manifests | one pure-data theme per folder | app/src/themes/{calm,playful,lego,minecraft,flower}/manifest.ts | that theme's identity/colors/typography/treatments/banner |
| generator | **emits folder-name scaffold only**; structural checks (folder has `manifest.ts`, name matches `^[a-z][a-z0-9-]*$`); `--check` idempotence mode; **never imports TS** | app/scripts/generate-theme-registry.mjs | codegen logic |
| baseline capture | serializes pre-refactor `getChakraTheme` output | app/scripts/capture-theme-baseline.mjs → app/tests/unit/theme-baseline.generated.ts | the AC9 parity baseline |
| validation test | schema + contrast + drift + freshness gates | app/tests/unit/themes-validation.test.ts | — |
| lib/theme (modified) | thin re-export of themes/index | app/src/lib/theme.ts | — |

## Seam Contracts

### ThemeManifest (schema.ts → all downstream)
| Field | Type | Optional |
|---|---|---|
| id | string — `^[a-z][a-z0-9-]*$`, === folder basename | no |
| order | number (unique positive int across themes) | no |
| label / description | `{ en: string; de?: string }` | no |
| previewColorScheme | `'brand'\|'success'\|'warning'\|'danger'` | no |
| author / license | string | yes |
| status | `'stable'\|'experimental'\|'hidden'` | yes (default stable) |
| colorScheme | `'light'\|'dark'` — **descriptive metadata only; never trusted by the contrast gate** | no |
| colors | 5× `Scale10` + semantic tokens (appBg, backgroundImage?, surface*, border*, text*, status*, buttonColorScheme) | no |
| typography | `{ fonts{heading,body,display?}; fontLoad: FontLoad[]; fontSizes? }` | no |
| shape | `{ radii?; borderWidths? }` | yes |
| treatments | see below — **independent per-surface selectors** | no |
| contentSurface | boolean — explicit; selects which surface the contrast gate tests; NOT auto-derived | yes |

**Invariants** (enforced in the validation test, not zod): `id === folder`; `order` unique; effective text/surface contrast ≥ WCAG-AA computed from real colors; every `fontLoad` family resolvable.
**Produced by**: story 1 (schema) | **Consumed by**: every downstream module.

### treatments (composable — honors D2; NOT a single bundled `elevation`)
| Field | Type | Notes |
|---|---|---|
| card | ElevationName | independent per surface |
| button | ElevationName | independent per surface |
| nav | ElevationName | independent per surface |
| surface | SurfacePatternName | `'none'\|'studs'\|'grid'\|'petals'` |
| iconSet | IconSetName | `'line'\|'filled'\|'pixel'` (line=old default, filled=old toy) |
| banner | string | inline SVG or `public/themes/<id>/…` path |
| contentPanel | ContentPanelName? | selects the content-panel treatment when `contentSurface` |
| overrides | RawOverrides? | raw Chakra props escape hatch (card/button/nav/surface) |

`ElevationName = 'flat'\|'softDrop'\|'hardDrop'\|'pixelBevel'\|'floralGlow'`. The five migrated themes set card/button/nav to the **same** name (they are correlated today), giving byte-identical output; new themes may mix.

### FontLoad (typography.fontLoad → THEME_FONTS → _document)
```
type FontLoad = { family: string; weights?: number[]; ital?: boolean; subset?: string };
```
URL builder: **families sorted alphabetically**; ital-only → `NAME:ital@0;1`; weights-only → `NAME:wght@w1;w2`; both → `NAME:ital,wght@0,w1;1,w1`; neither → `NAME`; append `&display=swap`. A parity test asserts it reproduces `app/pages/_document.tsx:10` byte-for-byte: DM Serif Display `ital@0;1`, Fredoka `wght@400;500;600;700`, Nunito `wght@400;600;700;800`, Press Start 2P, VT323.
**Produced by**: generator (deduped union) | **Consumed by**: `_document.tsx`.

### Registry (registry.generated.ts → index + consumers)
`AppThemeName` union (from folder names); `APP_THEMES: Record<AppThemeName, ThemeManifest>` **sorted by `order` ascending** (calm=1 … flower=5); `THEME_FONTS: FontLoad[]` (deduped). `AppThemeDefinition = ThemeManifest` (alias). No stored `chakraTheme` — computed on demand and cached.
**Produced by**: story 2 committed stub, then story 3 generator | **Consumed by**: index, types, _document, profile, storage, tests.

### useThemeStyles return (AC10 — six fields; `visualStyle` and `isFunTheme` removed as unused)
`{ cardStyle, surfaceStyle, navStyle, buttonStyle, contentPanelStyle: BoxProps|null, bannerDecorStyle: {boxProps; style}|null }`. `bannerDecorStyle`'s `boxProps`/`style` split is a hard contract (Chakra drops data-URI backgroundImage — `useThemeStyles.ts:295-296`).
**Consumed by**: Layout.tsx:51 (navStyle, surfaceStyle, bannerDecorStyle, contentPanelStyle), index.tsx:19 (cardStyle).

## Boundary Rules

**Allowed dependency edges:**
- manifests → (nothing but the `ThemeManifest` *type*)
- schema → zod, `@chakra-ui/react` (BoxProps type only)
- treatments/* → `@chakra-ui/react` (BoxProps type only)
- buildChakraTheme → `@chakra-ui/react`, treatments/*
- fontUnion → (nothing; pure — no `@chakra-ui/react`, no schema runtime import)
- contrast → (nothing; pure math + the pair rules)
- registry.generated → manifests (static import), schema (**type only**), fontUnion (`buildThemeFonts`)
- index → registry.generated, buildChakraTheme
- lib/theme → index (re-export)
- types → registry.generated (AppThemeName type)
- useThemeStyles → lib/theme, treatments/*
- ThemeIcon → treatments/iconSets, lib/theme
- _document → registry.generated (`THEME_FONTS`), fontUnion (`buildFontLinkHref`)
- profile / storage → lib/theme
- generator → `node:fs/promises`, `node:path`, `node:url` only
- themes-validation.test → index, schema, fontUnion, contrast

**Forbidden:**
- Any client/runtime module → `schema.ts` (zod must stay out of the client bundle — validation & tests only).
- Any `manifest.ts` → `@chakra-ui/react`, `buildChakraTheme`, or `treatments/*` (manifests are serializable pure data).
- `registry.generated.ts` → `buildChakraTheme` (registry carries data only).
- `useThemeStyles` → `registry.generated` directly (must go via `lib/theme` → `index`).
- Any module → deleted `lib/theme.ts` internals (`createTheme`, `ThemeBuildInput`, `ThemeVisualStyle`).

## Implementation Constraints

Integration-architect / dev subagents must comply with ALL of these (they encode the debate outcome):

1. **Real-contrast gate (empirically calibrated).** The validator computes WCAG contrast from **actual color hex values** (never trust `colorScheme`/`contentSurface` as a shortcut). Threshold **AA 4.5:1**. Pairs:
   - **Always (all themes):** `(textStrong|textMuted, surfaceBg)`, `(textStrong|textMuted, surfaceMutedBg)`, `(textStrong|textMuted, surfaceRaisedBg)`, and status text `(successText, successBg)`, `(warningText, warningBg)`, `(dangerText, dangerBg)`.
   - **Only when `contentSurface` is falsy:** `(textStrong, appBg)`, `(textMuted, appBg)`.
   Failure message names the theme + failing `(text, surface)` pair + ratio. Verified against the current five: all light themes pass every pair (min margin calm `textMuted`/`surfaceMutedBg` = 4.78); minecraft passes all surface/status pairs (≥5.56) and is exempt on `appBg` where it measures 2.21 / **1.03** (the original bug). A dark-bg theme with `contentSurface:false` would fail `appBg` and be rejected — so the gate is byte-identical-safe AND catches the Minecraft class. (Findings #6-contrast, BC5)
2. **Independent per-surface treatments.** `treatments.card/button/nav` are independent `ElevationName`s; `surface` is a `SurfacePatternName`; `iconSet` an `IconSetName`. No single bundled "elevation." Migrated themes set them consistently for byte-identical output. (Round 2 BC7 / D2)
3. **Drop `visualStyle` and `isFunTheme`** from the hook return — both are unused (`useThemeStyles.ts:346` is the only site). Return the six consumed fields. Delete the `ThemeVisualStyle` re-export. (Round 2 BC/A6)
4. **AC9 baseline first, allowlist parity (empirically grounded).** "Byte-identical" = deep-equal (`toEqual`) on a fixed path allowlist of `getChakraTheme(id)`: `colors, semanticTokens, fonts, fontSizes, radii, styles, config, components.<Name>.defaultProps` (Name ∈ Button, Tabs, Progress, Badge, Tag, Checkbox, Radio). These subtrees are empirically function-free / JSON-round-trippable / deterministic (the merged theme's ~50 functions all live in Chakra-default `components.*.variants|baseStyle`, outside the allowlist). Story 0 runs `capture-theme-baseline.mjs` (imports the *current* exported `getChakraTheme`, picks the allowlist, no `theme.ts` change) and commits `theme-baseline.generated.ts` **before** story 1 edits `theme.ts`. Story 2 asserts `expect(pick(getChakraTheme(id), ALLOWLIST)).toEqual(baseline[id])`. `buildChakraTheme` splits into pure `buildThemeOverride(manifest)` + cached `getChakraTheme = extendTheme(override)`. **Full-extend guard:** because the allowlist deliberately excludes Chakra-default subtrees, add one assertion that the merged theme still carries them (e.g. `getChakraTheme(id).components.Button.variants` is a non-empty object) — this catches a regression that returns the bare override instead of the `extendTheme(...)` result. (Finding #3, A1; verification paradigm-risk)
5. **`order` invariants.** Required unique positive integers; gaps allowed. The validator fails on duplicates. Generator sorts `APP_THEMES` by `order`; the five themes are calm=1, playful=2, lego=3, minecraft=4, flower=5 (matches theme.ts:677-733 → preserves picker parity). (Round 2 BC4/BC5)
6. **Drift test correctness.** Resolve the themes directory from the test module (`fileURLToPath(import.meta.url)` / `__dirname`), NOT process cwd (vitest runs from `app/`). Classify a theme folder by the presence of `manifest.ts` so `treatments/`, `index.ts`, `schema.ts`, `registry.generated.ts`, `README.md` are excluded. Assert folder set === `Object.keys(APP_THEMES)`. (Round 2 BC2)
7. **Metadata-freshness gate on the vitest path.** The validation test recomputes the deduped `THEME_FONTS` and the `order`-sorted key list from the manifests and asserts equality with the committed `registry.generated.ts` exports. This catches edits to an existing manifest's `order`/`fontLoad` that the folder-drift test misses. (Round 2 BC3)
8. **Generator emits folder-name scaffold only; `--check` idempotence.** The `.mjs` generator globs folders **containing `manifest.ts`** (excludes `treatments/`, `index.ts`, `schema.ts`, `registry.generated.ts`, `README.md`), and emits: one static import per theme, the `AppThemeName` union from folder names, an `_all` array, and wiring that calls the hand-written helpers. It **never imports/evaluates TypeScript**. `order`-sort and `THEME_FONTS` dedup happen in the *emitted TS* at bundler/vitest eval (`APP_THEMES = Object.fromEntries(_all.sort(byOrder).map(m => [m.id, m]))`; `THEME_FONTS = buildThemeFonts(_sorted)`). `--check` regenerates in memory and exits non-zero on any diff vs the committed file (AC2 idempotence + stub/generator convergence). This is the resolution to the "plain Node can't import TS" hole. (Findings #1, BC1)
9. **Referential stability.** `getChakraTheme` uses a module-level `Map<AppThemeName, ThemeOverride>` populated eagerly at import (five `extendTheme` builds), returning a stable reference per theme — matches today's prebuilt `chakraTheme` and avoids ChakraProvider re-render churn (`_app.tsx:40`). (A7)
10. **Canonical paths, single source of truth.** Icon set is always `manifest.treatments.iconSet`. `contentSurface` is an explicit optional boolean (minecraft = true). `label`/`description` come from the manifest (locale-aware, `de` falls back to `en`); the 10 per-theme i18n keys are removed; `themeHeading/themeDescription/active/currentTheme` stay. Profile filters `status: 'hidden'` before rendering. (Round 1 BC2/BC3)
11. **Build gate wiring.** `prebuild` = `node scripts/generate-theme-registry.mjs && vitest run tests/unit/themes-validation.test.ts`. `registry.generated.ts` and `theme-baseline.generated.ts` are committed so fresh checkouts and the direct vitest path (`Makefile:107-109`) work without regeneration.
12. **Font URL byte-identical + ordering test.** `buildFontLinkHref(THEME_FONTS)` sorts families alphabetically and encodes axes per family (ital-only `Family:ital@0;1`; weights `Family:wght@…`; both `Family:ital,wght@0,w;1,w`; neither `Family`; suffix `&display=swap`). A parity test asserts it equals the current `_document.tsx:10` URL byte-for-byte: `…family=DM+Serif+Display:ital@0;1&family=Fredoka:wght@400;500;600;700&family=Nunito:wght@400;600;700;800&family=Press+Start+2P&family=VT323&display=swap`. `FontLoad = {family; weights?; ital?; subset?}`. (Finding #2)
13. **`id` naming.** `id` matches `^[a-z][a-z0-9-]*$` and equals the folder name; zod enforces the regex, the validation test enforces `id === folder`. Generator import aliases sanitize `-` (e.g. bracketed/underscored local names). (Finding #9)
14. **`status:hidden` semantics.** `APP_THEMES` includes ALL themes (keys === folder set — drift/AC2 hold). `listThemes()` excludes hidden by default (`{includeHidden:true}` to include). Profile renders `listThemes()`. A stored hidden id stays valid (in `APP_THEMES`) and normalizes to itself; a removed id normalizes to `DEFAULT_THEME_NAME`. (Finding #5)
15. **`order` uniqueness.** Required unique positive integers across themes; gaps allowed; validator fails on duplicates. (Findings #5, BC4)
16. **zod boundary enforced by test.** Manifests + **every client-bundle-reachable module** use `import type` only from `schema.ts`. The architectural test scans the source of all modules transitively reachable from a client entry — `manifest.ts` (all), `registry.generated.ts`, `buildChakraTheme.ts`, `fontUnion.ts`, `index.ts`, `treatments/*` (and `_document.tsx`, `useThemeStyles.ts`, `ThemeIcon.tsx`) — and asserts none has a **runtime** import that resolves to `schema.ts`. Match by resolved target (`./schema`, `../schema`, or any alias), **not** a literal `./schema` string. Keeps `zod` out of the client bundle. (Finding #8; verification F8 + BC)
17. **AC5 wording.** The negative test asserts `prebuild` exited non-zero and `next build` did not run (so `app/out` is not created/updated); it does NOT rely on deletion of a pre-existing `app/out` (`make build` does not clean it — `Makefile:92`). (Finding #6)

## Story Order (supersedes spec §13)

0. Baseline capture + commit `theme-baseline.generated.ts` (no `src/` change).
1. schema + builder + treatments; `themes/index.ts` passes through to `lib/theme.ts` (no registry import; no behavior change).
2. 5 manifests + committed hand-authored `registry.generated.ts` stub; `index → registry`; `lib/theme → re-export`; `types → registry`. AC9, AC12.
3. Generator replaces stub (idempotent, `--check`) + prebuild + validation test (drift + freshness + contrast). AC1–AC8, AC14.
4. useThemeStyles, ThemeIcon, profile, _document, i18n. AC10, AC11, AC13.
5. Authoring guide + README. AC16.

`types/index.ts` changes in story 2 (after the stub exists), never before the generator; stories 3 and 4 share no simultaneous write target.

## Open Questions / Accepted Risks

Verifiers should watch for these; they are bounded, not blocking:
- **Function-free manifests can't express token-derived banners/patterns** — fine for the five current themes (static strings); a future token-colored asset needs a manifest-v2 or generator escape hatch. Authoring guide must state this.
- **"Pluggable" boundary** — composing existing treatments = folder-only; a genuinely new elevation/iconSet/pattern is one treatment-library edit, not a pure folder drop.
- **Eager import-time `extendTheme`** forgoes builder tree-shaking (negligible at five themes).
- **Manual `order`** can collide across parallel branches → validation failure (surfaced, not silent).
