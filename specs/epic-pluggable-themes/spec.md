# Feature Request Specification — Pluggable Themes

> Intended for implementation via the base plugin `/base:feature` workflow.
> Companion documents (authoritative on conflict): `docs/adr/ADR-004-pluggable-themes.md`
> (decision record) and `architecture.md` (operational directives + seam contracts).
> This spec was hardened after a two-round Proposer↔Codex architecture debate and an
> independent spec review; §§ marked "(hardened)" incorporate empirically-verified resolutions.

## 1. Motivation

Adding a theme today requires editing **seven locations across five files** (`app/src/types/index.ts`,
`app/src/lib/theme.ts`, `app/src/lib/i18n.ts`, `app/src/hooks/useThemeStyles.ts`,
`app/src/components/ThemeIcon.tsx`, `app/pages/_document.tsx`, plus tests). A theme's "look" is split
between declarative Chakra token data **and** a single closed `visualStyle` enum
(`soft|rounded|toy|pixel|floral`) that fans out into ~7 hand-written `switch` blocks (card, button,
nav, surface, content-panel, banner, icon set). Colors are 50 hand-picked hex values per theme with
no contrast guarantee — the Minecraft illegibility bug (dark text on a dark background) came from
exactly this gap and was patched with an ad-hoc `contentSurface` boolean.

We want theme authoring to be a **self-contained, drop-in-a-folder** activity, validated at build
time, with a published spec for theme developers.

## 2. Goals

- **G1** — Each theme is one self-contained subfolder under `app/src/themes/<id>/`.
- **G2** — Themes are **auto-detected at build time**. **Adding a theme that composes existing
  treatments requires no edits to shared code** (only dropping a folder). Introducing a genuinely new
  treatment *primitive* (a new elevation/iconSet/pattern implementation) is a scoped, one-file edit to
  the treatment library — see §3 non-goals and the "pluggable boundary" note. *(hardened — narrowed
  from the original unqualified promise; finding #4.)*
- **G3** — All themes are **validated during the build**; a non-conforming theme **fails the build**.
- **G4** — The five existing themes are migrated into the new structure with **byte-identical** output
  (per the parity definition in §6.8).
- **G5** — A comprehensive **authoring specification** ships for theme developers.

## 3. Non-goals

- No visual redesign of the existing themes (migration must be pixel-identical).
- No runtime/user-uploaded themes (build-time, developer-authored only — the manifest is kept
  serializable to allow this later).
- No per-request lazy font loading (keep union-load; matches current behavior).
- No migration off Chakra UI.
- **Not** every conceivable look is expressible by a folder alone: a theme may compose any existing
  named treatments freely, but a brand-new elevation/iconSet/pattern *implementation* is a treatment-
  library change. Manifests are pure data and cannot compute treatments from their own tokens
  (e.g. an SVG banner colored from `brand.500`); such needs are deferred to a future manifest revision
  and must use the raw `overrides` escape hatch or a pre-rendered asset. *(hardened; findings #4, A4.)*

## 4. Constraints (verified in the codebase)

- `output: 'export'` + webpack (`app/next.config.mjs:20`) → **no runtime filesystem reads**; detection
  must be build-time codegen emitting a static registry.
- **No TypeScript runner is installed** (no tsx/ts-node; `app/package.json`), and the codegen precedent
  is a plain Node ESM `.mjs` (`app/scripts/generate-avatar-manifest.mjs`). **A plain `.mjs` cannot
  import or evaluate `manifest.ts` files.** Therefore the generator must derive everything it emits
  from **folder names alone**; all per-manifest computation (order sort, font union) happens in the
  *emitted TypeScript* at bundler/vitest evaluation time, and all *value* validation runs on the
  TS-capable **vitest** path. *(hardened; finding #1.)*
- Chakra UI is the render engine (`ChakraProvider`, `app/pages/_app.tsx:40`); the token layer must keep
  emitting a Chakra theme (the full `extendTheme(...)` result, as `getChakraTheme` returns today).
- The public theme API in `app/src/lib/theme.ts:737-751` is consumed by only 6 files + 1 test —
  preserving that API surface keeps the change contained.
- `zod` is not installed; snapshot testing is not used anywhere (zero `toMatchSnapshot`).

## 5. Decisions already made (do not re-litigate)

- **D1** — Theme `label`/`description` live **inline in each manifest** as localized strings
  (`{ en: string; de?: string }`; `de` falls back to `en`). Documented exception to the CLAUDE.md
  "all UI text in i18n.ts" rule, scoped to theme-owned content.
- **D2** — **Fully composable treatments**: the closed `visualStyle` enum is decomposed into
  **independent per-surface selectors** (card / button / nav / surface / iconSet), each resolving to a
  named treatment in a shared library, plus a raw-props escape hatch. No single bundled "elevation."
- **D3** — **Add `zod`** as the manifest schema library (build/test scope only; never in the client
  bundle — enforced by §6.9).
- **D4** — Fonts auto-managed via a **generated union** Google Fonts `<link>` (no `_document` edit per
  theme). Banners are **inline SVG in the manifest**, with a `public/themes/<id>/` file option as an
  escape hatch.
- **D5** *(hardened)* — **Zero new build dependency beyond zod.** The generator (`.mjs`) emits only a
  folder-name-derived scaffold (import lines, the `AppThemeName` union, and wiring that calls hand-
  written helpers). `order` sorting and `THEME_FONTS` deduplication are computed by that emitted
  TypeScript at evaluation time — never by the `.mjs`. This resolves the "plain Node cannot import TS"
  problem without tsx/ts-node.

## 6. Target design

### 6.1 Folder layout
```
app/src/themes/
  schema.ts               # zod ThemeManifestSchema + type ThemeManifest = z.infer<...> + validateManifest()
  buildChakraTheme.ts     # buildThemeOverride(manifest) (pure, function-free) + getChakraTheme = extendTheme(override)
  fontUnion.ts            # buildThemeFonts(manifests) -> FontLoad[] ; buildFontLinkHref(fonts) -> string
  contrast.ts             # wcagRatio(hex,hex) + evaluateThemeContrast(manifest) -> {pass, failures[]}
  treatments/
    elevation.ts          # per-surface named prop-sets: flat|softDrop|hardDrop|pixelBevel|floralGlow
    iconSets.ts           # icon-name -> iconify id maps per iconSet: line|filled|pixel
    patterns.ts           # surface/background patterns: none|studs|grid|petals (+ appBg gradients)
  registry.generated.ts   # GENERATED (folder-name scaffold only) — APP_THEMES, AppThemeName, THEME_FONTS
  index.ts                # public API (re-exported by lib/theme.ts)
  {calm,playful,lego,minecraft,flower}/manifest.ts
```

### 6.2 The manifest (pure data — no Chakra import, no functions → serializable, zod-validatable)
`ThemeManifest` fields:
- **identity**: `id` (must equal folder name; **must match `^[a-z][a-z0-9-]*$`** — used as an object key,
  URL path, and test id; *(hardened; finding #9)*), `order` (required unique positive integer — drives
  `APP_THEMES` sort and picker order; *(hardened; finding #5/BC5)*), `label`/`description` `{ en; de? }`,
  `previewColorScheme`, `author?`, `license?`, `status?` (`stable|experimental|hidden`).
- **color**: explicit 10-step scales for `brand/success/warning/danger/neutral`, semantic tokens
  (`appBg`, `backgroundImage?`, `surfaceBg`, `surfaceMutedBg`, `surfaceRaisedBg`, `borderSubtle`,
  `borderStrong`, `textMuted`, `textStrong`, status bg/border/text, `buttonColorScheme`), and
  `colorScheme: 'light' | 'dark'` (**descriptive metadata only — never trusted by the contrast gate**,
  §6.7).
- **typography**: `fonts { heading, body, display? }`, `fontLoad: FontLoad[]`, optional `fontSizes`.
  `FontLoad = { family: string; weights?: number[]; ital?: boolean; subset?: string }` — sufficient to
  reproduce every current family exactly (ital-axis, weight-list, or weightless); see §6.5. *(hardened;
  finding #2.)*
- **shape**: `radii`, border widths.
- **treatments** (decomposed `visualStyle`, independent per surface): `card: ElevationName`,
  `button: ElevationName`, `nav: ElevationName`, `surface: SurfacePatternName`, `iconSet: IconSetName`,
  `banner: string`, `contentPanel?: ContentPanelName`, `overrides?: RawOverrides`. *(hardened; D2/BC7.)*
- **behavior**: `contentSurface?: boolean` — **explicit**; selects which surface the contrast gate
  treats as the effective text background (§6.7). Only minecraft sets `true`. Not auto-derived.

### 6.3 Removing the closed enum
- `useThemeStyles.ts` reads the manifest's per-surface treatment selectors, looks up implementations in
  `themes/treatments/*`, and merges `overrides`. Its return is the **six consumed fields**:
  `{ cardStyle, surfaceStyle, navStyle, buttonStyle, contentPanelStyle, bannerDecorStyle }`.
  `visualStyle` and `isFunTheme` are **removed** — both are currently unused (grep: the only site is
  `useThemeStyles.ts:346`; no external consumer). The `ThemeVisualStyle` re-export is deleted.
  *(hardened; finding on isFunTheme/BC6.)*
- `ThemeIcon.tsx` reads `manifest.treatments.iconSet` (canonical path); `ICON_MAP` moves to
  `treatments/iconSets.ts`; `getThemeIconId()` keeps working.

### 6.4 Build detection / generation / validation (hardened)
- **Generator** `app/scripts/generate-theme-registry.mjs` (plain Node ESM): globs `src/themes/*/` for
  folders **containing a `manifest.ts`** (so `treatments/`, `index.ts`, `schema.ts`, etc. are ignored),
  and emits `registry.generated.ts` containing: one static import per theme, the `AppThemeName` union
  built from folder names, an `_all` array, and wiring that calls the hand-written helpers
  (`buildThemeFonts`, order-sort) at evaluation time. The `.mjs` performs only **structural** checks it
  can do from the filesystem (folder has a `manifest.ts`; folder name matches `^[a-z][a-z0-9-]*$`) and
  exits non-zero on failure. It **never imports TypeScript**. A `--check` mode regenerates in memory and
  exits non-zero if the output differs from the committed file (idempotence gate for CI). *(hardened;
  findings #1, BC1.)*
- **Emitted registry** computes `APP_THEMES` by importing all manifests and sorting by `order`
  ascending, and `THEME_FONTS = buildThemeFonts(sortedManifests)`. Object key order therefore reflects
  `order`, so `Object.values(APP_THEMES)` (the picker) preserves the current sequence.
- **Validator** `app/tests/unit/themes-validation.test.ts` (vitest imports TS natively) enforces the
  *value* invariants zod + cross-field logic require:
  - `ThemeManifestSchema.parse` per manifest (zod), including the `id` regex.
  - `id === folder` for every theme.
  - `order` values are **unique positive integers** across all themes. *(finding #5/BC4.)*
  - **Contrast gate** per §6.7.
  - **Drift test**: resolve the themes dir from the test module (`fileURLToPath(import.meta.url)` /
    `__dirname`, NOT process cwd — vitest runs from `app/`); classify theme folders by presence of
    `manifest.ts`; assert that set === `Object.keys(APP_THEMES)`. *(finding on drift path; BC2.)*
  - **Metadata-freshness test**: recompute the `order`-sorted key list and `buildThemeFonts(...)` from
    the manifests and assert equality with the committed registry's `APP_THEMES` key order and
    `THEME_FONTS`. Catches edits to an existing manifest's `order`/`fontLoad` that leave the folder set
    unchanged (which the drift test alone misses). *(finding #3-adjacent / BC3.)*
  - **Font-URL parity test**: `buildFontLinkHref(THEME_FONTS)` equals the current hardcoded URL string
    exactly (§6.5). *(finding #2.)*
  - **zod-boundary test**: per §6.9.
- **Build gate**: `"prebuild": "node scripts/generate-theme-registry.mjs && vitest run tests/unit/themes-validation.test.ts"`.
  `registry.generated.ts` and the AC9 baseline (§6.8) are **committed**, so the direct vitest path
  (`make test-unit` / `npm run test:unit`, which do not run the generator — `Makefile:107-109`) still
  validates freshness via the drift + metadata tests on a fresh checkout.

### 6.5 Fonts (hardened — byte-identical URL)
`buildThemeFonts` produces a deduplicated `FontLoad[]`. `buildFontLinkHref` builds the Google Fonts
CSS2 URL with **families sorted alphabetically** (the current URL's order) and per-family axis encoding:
ital-only → `Family:ital@0;1`; weights-only → `Family:wght@w1;w2;…`; both → `Family:ital,wght@0,w1;1,w1`;
neither → `Family`; suffix `&display=swap`. It must reproduce, byte-for-byte,
`https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=Fredoka:wght@400;500;600;700&family=Nunito:wght@400;600;700;800&family=Press+Start+2P&family=VT323&display=swap`
(`app/pages/_document.tsx:10`). Asserted by the font-URL parity test (§6.4). `FontLoad.subset` and the
combined ital+multi-weight axis form (`Family:ital,wght@0,w1;0,w2;1,w1;1,w2`) are reserved: no current
family uses them, so their exact encoding is finalized (with a test) when the first such font is added.

### 6.6 zod bundle hygiene
Only the generator and tests import `schema.ts`. Client code imports registry data + `buildChakraTheme`
+ `fontUnion`/`contrast` helpers only. See §6.9 for enforcement.

### 6.7 Contrast gate (hardened — empirically calibrated; findings #6-contrast, BC5)
The gate computes WCAG contrast from **actual color hex values** (never from `colorScheme`/
`contentSurface` booleans). Threshold: **AA 4.5:1** (normal text). Pairs, per theme:

- **Always required (all themes)** — text on card/panel surfaces and status text:
  `(textStrong, surfaceBg)`, `(textMuted, surfaceBg)`, `(textStrong, surfaceMutedBg)`,
  `(textMuted, surfaceMutedBg)`, `(textStrong, surfaceRaisedBg)`, `(textMuted, surfaceRaisedBg)`,
  `(successText, successBg)`, `(warningText, warningBg)`, `(dangerText, dangerBg)`.
- **Required only when `contentSurface` is falsy** — page text rendered directly on the app background:
  `(textStrong, appBg)`, `(textMuted, appBg)`. When `contentSurface` is true, page content sits on a
  light panel (`surfaceBg`), so `appBg` pairs are exempt.

Empirical calibration (measured against the current five themes): all light themes pass every pair
(lowest margin: calm `textMuted`/`surfaceMutedBg` = 4.78). Minecraft passes all surface + status pairs
(≥5.56) and is exempt on `appBg`, where it measures 2.21 / **1.03** — exactly the original bug. A
hypothetical dark-background theme that set `contentSurface:false` would fail the `appBg` pairs and be
rejected. This gate is therefore safe for byte-identical migration **and** catches the Minecraft class.

**Limitation (verification):** the gate evaluates *semantic-token hex pairs* only; it does not inspect
`backgroundImage`. A future theme whose `backgroundImage` paints an opaque dark field behind text on an
otherwise light `appBg` could pass the token gate while rendering low-contrast text. The authoring guide
(AC16) must constrain `backgroundImage` to decorative/low-opacity use so `appBg` remains the effective
text background. (Not a concern for the current five themes, whose backgrounds are translucent patterns.)

### 6.8 AC9 parity method (hardened — empirically grounded; finding #3)
"Byte-identical" is defined as deep equality (`toEqual`) on a fixed **allowlist of paths** of the
`getChakraTheme(id)` output — the subtrees this app sets — captured before any refactor:
`colors`, `semanticTokens`, `fonts`, `fontSizes`, `radii`, `styles`, `config`, and
`components.<Name>.defaultProps` for each component the theme configures
(`Button, Tabs, Progress, Badge, Tag, Checkbox, Radio`).

These subtrees were empirically verified to be **function-free, JSON-round-trippable, and deterministic**
across builds (the ~50 functions in the merged theme all live in Chakra-default `components.*.variants`
/`baseStyle`, which are outside the allowlist and identical across old/new at a pinned Chakra version).
Story 0's `capture-theme-baseline.mjs` imports the *current* exported `getChakraTheme`, picks these
paths for all five ids, and commits `app/tests/unit/theme-baseline.generated.ts` — **before** story 1
edits `theme.ts` (no source change needed to capture). The AC9 test asserts
`expect(pick(getChakraTheme(id), ALLOWLIST)).toEqual(baseline[id])`.

`buildChakraTheme.ts` splits into `buildThemeOverride(manifest)` (pure, function-free — the object
passed to `extendTheme`) and `getChakraTheme(id) = extendTheme(buildThemeOverride(APP_THEMES[id]))`,
cached (§ index). This preserves the full extended-theme shape `ChakraProvider` consumes today.

**Full-extend guard** (verification): because the allowlist deliberately excludes the Chakra-default
subtrees, the AC9 test also asserts the merged theme still carries them — e.g.
`getChakraTheme(id).components.Button.variants` is a non-empty object — so a regression that returns the
bare override instead of the `extendTheme(...)` result is caught, not silently passed.

### 6.9 zod boundary enforcement (hardened; finding #8 + verification F8)
Manifests and **every client-bundle-reachable module** import `ThemeManifest` from `schema.ts` using
`import type` only (type-erased). An **architectural test** scans the source of all modules transitively
reachable from a client entry — every `manifest.ts`, `registry.generated.ts`, `buildChakraTheme.ts`,
**`fontUnion.ts`**, `index.ts`, `treatments/*`, plus `_document.tsx`/`useThemeStyles.ts`/`ThemeIcon.tsx` —
and asserts none has a **runtime** import that **resolves to `schema.ts`** (matched by resolved target —
`./schema`, `../schema`, or any alias — not a literal `./schema` string). `contrast.ts` and
`fontUnion.ts` must themselves be zod-free. This prevents `zod` from entering the client bundle
transitively (note `registry.generated.ts` imports `buildThemeFonts` from `fontUnion.ts`, so `fontUnion`
is client-reachable and must be scanned).

### 6.10 status:hidden semantics (hardened; finding #5)
`APP_THEMES` contains **all** themes including `status:'hidden'` (so `Object.keys(APP_THEMES)` === the
folder set; AC1/AC2/drift hold). `listThemes()` returns non-hidden themes by default (accepts an
`{ includeHidden: true }` option). The profile picker renders `listThemes()`, so hidden themes are
build-valid but not offered. A stored theme id that is hidden remains valid (present in `APP_THEMES`) and
normalizes to itself — a user who already selected it keeps it. A stored id absent from `APP_THEMES`
(removed theme) normalizes to `DEFAULT_THEME_NAME` (`isAppThemeName` = `id in APP_THEMES`, unchanged).

## 7. User stories

- **US1 — Theme author adds a theme.** As a developer, I drop a folder under `app/src/themes/` with a
  `manifest.ts` composing existing treatments, run the build, and the theme appears in the picker with
  no edits to any shared file.
- **US2 — Build rejects a broken theme.** As a maintainer, a missing/invalid field, a failing contrast
  pair, a duplicate `order`, or a bad `id` fails the build with a clear message naming the theme/field.
- **US3 — Existing themes unchanged.** After the refactor all five themes look and behave exactly as
  before (Minecraft light content panel and pixel font scale included).
- **US4 — Author self-serves from docs.** The authoring guide documents every field, the treatment
  catalog, contrast requirements, font declaration, and how to validate locally.
- **US5 — Graceful fallback.** A stored theme id that no longer exists falls back to the default.

## 8. Acceptance criteria (testable)

**Structure & auto-detection**
- **AC1** — Each of `calm, playful, lego, minecraft, flower` exists as `app/src/themes/<id>/manifest.ts`;
  `app/src/lib/theme.ts` no longer contains inline theme definitions (it re-exports `themes/index.ts`).
- **AC2** — The generator emits `registry.generated.ts` whose `APP_THEMES` keys exactly equal the set of
  theme subfolders (folders containing `manifest.ts`); `--check` mode passes (idempotent).
- **AC3** — Adding a valid sample folder and rebuilding makes it appear in the picker (unless
  `status:'hidden'`) with **no other file edits**; removing the folder removes it.

**Validation / build gate**
- **AC4** — `npm run build` (and `make build`) runs generation + the validation suite before `next build`.
- **AC5** *(hardened)* — When a theme is non-conforming, `prebuild` exits non-zero and **`next build`
  does not run**, so `app/out` is not created or updated. (The negative test asserts the build command
  aborted before `next build`; it does not rely on deletion of a pre-existing `app/out`.)
- **AC6** *(hardened)* — A manifest failing any required contrast pair (§6.7) fails the build with a
  message naming the theme and the failing `(text, surface)` pair and its ratio.
- **AC7** — A manifest whose `id` ≠ folder name, or whose `id` violates `^[a-z][a-z0-9-]*$`, fails
  validation.
- **AC8** — Drift (folder set ≠ registry keys) and metadata drift (stale `order` sort or `THEME_FONTS`)
  both fail the validation suite on the plain vitest path.
- **AC8b** *(hardened)* — Two themes with the same `order` value fail validation (uniqueness).

**Behavior parity**
- **AC9** *(hardened)* — For all five themes, `pick(getChakraTheme(id), ALLOWLIST)` deep-equals the
  committed pre-refactor baseline (§6.8), where `ALLOWLIST` = `colors, semanticTokens, fonts, fontSizes,
  radii, styles, config, components.<Name>.defaultProps`.
- **AC10** — `useThemeStyles()` returns exactly `{ cardStyle, surfaceStyle, navStyle, buttonStyle,
  contentPanelStyle, bannerDecorStyle }` with the same per-theme values as before; `Layout.tsx`/
  `index.tsx` are unchanged. (`visualStyle` and `isFunTheme` are removed as unused.)
- **AC11** — `ThemeIcon` renders the same icon ids per theme as before (line/filled/pixel sets preserved).
- **AC12** — Minecraft invariants hold: effective `contentSurface` for minecraft, falsy for the other
  four; `fontSizes.md ≥ 1.1rem`, `lg > md`, `4xl > xl`.

**Text & fonts**
- **AC13** — Theme label/description render from the manifest (en, de fallback) in the picker and
  preview; the 10 per-theme `calm…flowerDescription` keys are removed from `i18n.ts` while
  `themeHeading/themeDescription/active/currentTheme` remain.
- **AC14** *(hardened)* — `buildFontLinkHref(THEME_FONTS)` equals the current `_document.tsx` Google
  Fonts URL byte-for-byte (families alphabetical; ital/weight axes per §6.5); `_document.tsx` renders
  that built URL.

**Behavior & hygiene**
- **AC15** — `normalizeThemeName` returns `DEFAULT_THEME_NAME` for an unknown/removed id; stored-settings
  read/write and the legacy `mood` fallback keep working; a stored `hidden` id normalizes to itself.
- **AC16** — `docs/themes/authoring-guide.md` exists and documents: folder structure; the complete
  manifest field reference (required/optional, types, `id` regex, `order` uniqueness); the contrast
  requirements and exact pairs (§6.7); typography & `FontLoad`; the treatment catalog + `overrides`
  escape hatch and its limits (§3); banner/asset options; localization; `status` behavior; how to run
  validation; a fully worked sample theme; and gotchas (static export, dark themes must pass contrast or
  set `contentSurface`, and `backgroundImage` must stay decorative/low-opacity so `appBg` remains the
  effective text background — §6.7). A short `app/src/themes/README.md` points to it.
- **AC17** *(hardened)* — No client-bundle-reachable module (`manifest.ts`, `registry.generated.ts`,
  `buildChakraTheme.ts`, `fontUnion.ts`, `index.ts`, `treatments/*`, `_document.tsx`,
  `useThemeStyles.ts`, `ThemeIcon.tsx`) contains a runtime import that resolves to `schema.ts`
  (asserted by the zod-boundary test, matched by resolved target not literal path); `zod` does not
  appear in the client bundle path.

## 9. Files touched (representative)

- **New**: `app/src/themes/*` (schema, buildChakraTheme, fontUnion, contrast, treatments, index, 5
  manifests, generated registry); `app/scripts/generate-theme-registry.mjs`;
  `app/scripts/capture-theme-baseline.mjs`; `app/tests/unit/themes-validation.test.ts`;
  `app/tests/unit/theme-baseline.generated.ts` (committed); `docs/themes/authoring-guide.md`;
  `app/src/themes/README.md`.
- **Modified**: `app/src/lib/theme.ts` (thin re-export); `app/src/types/index.ts` (import `AppThemeName`
  from the registry); `app/src/hooks/useThemeStyles.ts` (treatment lookup; drop visualStyle/isFunTheme);
  `app/src/components/ThemeIcon.tsx` (iconSet-driven); `app/pages/_document.tsx` (built font URL);
  `app/pages/profile.tsx` (label/description + `listThemes()` filtering); `app/src/lib/i18n.ts` (remove
  10 keys); `app/package.json` (add `zod`, add `prebuild`); `app/tests/unit/theme.test.ts` (migrate
  invariants to registry).

## 10. Migration fidelity

Translate each of the five themes field-for-field into a manifest using the **explicit 10-step scales
and exact semantic-token hex values** from today's `theme.ts`, and the banner SVGs from
`useThemeStyles.ts:179-292`. No re-tuning; seed-derivation is offered only to future authors. Parity is
enforced by AC9 (§6.8) against a baseline captured before story 1.

## 11. Verification (end-to-end)

1. `cd app && node scripts/generate-theme-registry.mjs` → stable, complete registry; `--check` passes.
2. `npm run test:unit` (incl. `themes-validation.test.ts`: schema, contrast, drift, metadata, font-URL,
   zod-boundary, AC9 parity) passes.
3. `make build` succeeds and produces `app/out`. Add a broken theme (bad hex / failing contrast /
   duplicate order / bad id / missing field) → `prebuild` aborts and `next build` does not run → remove.
4. `make dev`, open `/profile`, switch all 5 themes → visually identical to pre-refactor; reload
   persistence works; unknown stored id falls back to `calm`; a `status:'hidden'` sample is absent from
   the picker but build-valid.
5. Drop a sample 6th theme folder → rebuild → appears with no other edits → remove.

## 12. Risks / notes (accepted)

- Function-free manifests cannot express token-derived banners/patterns (§3); deferred to a future
  manifest revision; guide documents the limit.
- The "pluggable" boundary: composing existing treatments = folder-only; a new treatment primitive is a
  one-file library edit.
- Eager import-time `extendTheme` caching (for referential stability) forgoes builder tree-shaking —
  negligible at five themes.
- Manual `order` assignment can collide across parallel branches → surfaced as a validation failure
  (AC8b), not silent reordering.

## 13. Story split for `/base:feature` (supersedes any earlier split; mirrors architecture.md)

0. **Baseline capture** — `capture-theme-baseline.mjs` + commit `theme-baseline.generated.ts`
   (imports current `getChakraTheme`; no `src/` change). Prerequisite for AC9.
1. **Scaffold** — `schema.ts` (zod), `buildChakraTheme.ts` (`buildThemeOverride` + cached
   `getChakraTheme`), `fontUnion.ts`, `contrast.ts`, `treatments/*`, `index.ts`; `index.ts` passes
   through to `lib/theme.ts` (no registry import; no behavior change).
2. **Migrate 5 themes** — manifests + committed hand-authored `registry.generated.ts` stub;
   `index → registry`; `lib/theme → re-export`; `types → registry`. AC9, AC12.
3. **Generator + gate** — `generate-theme-registry.mjs` (folder-scaffold emit + `--check`), prebuild,
   `themes-validation.test.ts` (schema, contrast, drift, metadata, font-URL, order-uniqueness,
   zod-boundary). AC1–AC8b, AC14, AC17.
4. **Consumers** — `useThemeStyles`, `ThemeIcon`, `profile.tsx` (+ `listThemes` filtering),
   `_document.tsx`, `i18n.ts`. AC10, AC11, AC13, AC15.
5. **Authoring guide** — `docs/themes/authoring-guide.md` + `README.md`. AC16.

## Amendments

### 2026-07-01 — AC-VAL-3 metadata-drift sub-clause retired (order-position)

**Trigger:** Codex cross-vendor review (S0 Stage-2) flagged that AC-VAL-3's "a manifest's `order`-sorted position differs from what the committed `registry.generated.ts` exports" sub-clause is untestable-with-teeth, and it was found to contradict §12.

**Reasoning:** Per §6.4/D5 the `.mjs` generator emits only a folder-name scaffold and cannot materialize `order`/font values; the committed `registry.generated.ts` therefore computes `APP_THEMES`/`THEME_FONTS` from the live manifests at module-evaluation time. A "recompute-from-manifests vs committed-registry" comparison thus compares a value to itself (vacuous). Independently, §12 states manual `order` reassignment is an **intended** edit ("not silent reordering"); only `order` *collisions* are a validation failure. Flagging a reorder as "drift" would contradict that design.

**Resolution:** The `order`-sorted-position sub-clause is retired. The real metadata-drift surface remains fully covered: **AC-FONT-1** (font drift — `buildFontLinkHref(THEME_FONTS)` byte-equality against the committed `_document.tsx` URL) and **AC-VAL-4** (duplicate-`order` collision). Folder drift (AC-VAL-3 clause 1) is unchanged. No US2 guarantee is weakened. `themes-validation.test.ts` (S3) implements the amended AC-VAL-3.
