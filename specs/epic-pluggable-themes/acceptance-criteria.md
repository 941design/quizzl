# Pluggable Themes — Acceptance Criteria

## Terminology

- **manifest** — a `ThemeManifest` object, defined in `app/src/themes/<id>/manifest.ts`, the sole per-theme data source. Validated against `ThemeManifestSchema` in `app/src/themes/schema.ts`.
- **treatment** — a named, reusable per-surface style implementation (`ElevationName`, `SurfacePatternName`, `IconSetName`) resolved from `app/src/themes/treatments/*`.
- **registry** — `app/src/themes/registry.generated.ts`, the generated-and-committed module exporting `APP_THEMES`, `AppThemeName`, and `THEME_FONTS`.
- **contrast gate** — the WCAG contrast validation implemented in `app/src/themes/contrast.ts` and enforced by `app/tests/unit/themes-validation.test.ts`.
- **drift** — a mismatch between the set of folders under `app/src/themes/` that contain a `manifest.ts` and the registry's `APP_THEMES` keys.
- **metadata drift** *(amended 2026-07-01)* — a change to a manifest's `fontLoad` fields (recomputed as `THEME_FONTS` across all manifests) that alters the built Google-Fonts URL relative to the committed `_document.tsx` baseline. Caught by AC-FONT-1's byte-equality assertion. (The former `order`-sorted-position sub-definition is retired — see AC-VAL-3 and spec.md ## Amendments; `order` reassignment is an intended edit per §12, and only collisions fail, per AC-VAL-4.)
- **parity baseline** — `app/tests/unit/theme-baseline.generated.ts`, the pre-refactor snapshot of `getChakraTheme(id)`'s ALLOWLIST subtrees, produced by `app/scripts/capture-theme-baseline.mjs` against the unmodified `app/src/lib/theme.ts`, before story S1 touches it.
- **ALLOWLIST** — the fixed path set `colors, semanticTokens, fonts, fontSizes, radii, styles, config, components.<Name>.defaultProps` for `Name ∈ {Button, Tabs, Progress, Badge, Tag, Checkbox, Radio}` (spec §6.8).

## Known TAGs

- **STRUCT** — folder/file/module structural assertions (auto-detection, registry shape, API surface).
- **DEP** — build-pipeline / dependency-gate assertions (`prebuild` wiring, non-zero exit on failure).
- **VAL** — manifest-value validation assertions (contrast, `id` regex, drift, `order` uniqueness).
- **PARITY** — behavior-parity assertions against the pre-refactor baseline.
- **UX** — user-visible behavior assertions (hook return shape, icons, labels, fallback).
- **FONT** — font-union / font-URL assertions.
- **BOUND** — module/bundle-boundary assertions (keeping `zod` out of the client bundle).
- **DOC** — documentation-deliverable assertions.

## Baseline Capture (S0)

**AC-STRUCT-1** — `app/scripts/capture-theme-baseline.mjs` MUST produce and commit `app/tests/unit/theme-baseline.generated.ts`, containing, for each of `calm, playful, lego, minecraft, flower`, the ALLOWLIST subtrees of the pre-refactor `getChakraTheme(id)` output, captured by importing the currently-exported `getChakraTheme` with no edit to `app/src/lib/theme.ts`.

## Migrate 5 Themes (S2)

**AC-PARITY-1** *(spec AC9)* — For each of `calm, playful, lego, minecraft, flower`, `pick(getChakraTheme(id), ALLOWLIST)` MUST deep-equal (`toEqual`) the corresponding entry in `app/tests/unit/theme-baseline.generated.ts`. Additionally, `getChakraTheme(id).components.Button.variants` MUST be a non-empty object for every theme (full-extend guard — catches a regression that returns the bare override instead of the `extendTheme(...)` result).

**AC-PARITY-2** *(spec AC12)* — The effective `contentSurface` read by the contrast gate and `useThemeStyles` MUST be truthy for the `minecraft` manifest and falsy for `calm, playful, lego, flower`; `getChakraTheme('minecraft').fontSizes.md` MUST be `>= 1.1rem`, `fontSizes.lg` MUST be `> fontSizes.md`, and `fontSizes['4xl']` MUST be `> fontSizes.xl`.

## Generator & Validation Gate (S3)

**AC-STRUCT-2** *(spec AC1)* — Each of `calm, playful, lego, minecraft, flower` MUST exist as `app/src/themes/<id>/manifest.ts`; `app/src/lib/theme.ts` MUST NOT contain inline theme object definitions and MUST re-export the public API from `app/src/themes/index.ts`.

**AC-STRUCT-3** *(spec AC2)* — `app/scripts/generate-theme-registry.mjs` MUST emit `app/src/themes/registry.generated.ts` whose `APP_THEMES` keys exactly equal the set of `app/src/themes/*` subfolders that contain a `manifest.ts`; running the generator in `--check` mode against the committed output MUST exit zero (idempotent).

**AC-STRUCT-4** *(spec AC3)* — Adding a new folder `app/src/themes/<new-id>/manifest.ts` with a schema-conforming manifest (`status` not `'hidden'`) and rebuilding MUST make `<new-id>` appear in the theme picker on `/profile` with no edit to any file outside `app/src/themes/<new-id>/`; removing that folder and rebuilding MUST remove `<new-id>` from `APP_THEMES` and the picker.

**AC-DEP-1** *(spec AC4)* — `npm run build` (and `make build`) MUST run `node scripts/generate-theme-registry.mjs` followed by `vitest run tests/unit/themes-validation.test.ts` before invoking `next build`, wired via the `prebuild` script in `app/package.json`.

**AC-DEP-2** *(spec AC5, hardened)* — When `prebuild` fails because a manifest is non-conforming, the build command MUST exit non-zero and MUST NOT invoke `next build`. The negative-path test MUST assert that the build was aborted before `next build` ran; it MUST NOT rely on deletion of a pre-existing `app/out`.

**AC-VAL-1** *(spec AC6, hardened)* — When a manifest fails a required contrast pair (§6.7 pair table, computed from actual color hex values, never from `colorScheme`/`contentSurface`), `themes-validation.test.ts` MUST fail and MUST report a message naming the theme id, the failing `(text, surface)` token pair, and its computed contrast ratio.

**AC-VAL-2** *(spec AC7)* — A manifest whose `id` does not equal its folder's basename, or whose `id` does not match `^[a-z][a-z0-9-]*$`, MUST fail `ThemeManifestSchema.parse` or the `id === folder` assertion in `themes-validation.test.ts`.

**AC-VAL-3** *(spec AC8; amended — see spec.md ## Amendments 2026-07-01)* — `themes-validation.test.ts` MUST fail when the set of theme folders containing `manifest.ts` differs from `Object.keys(APP_THEMES)` (folder drift). It MUST also fail, independently, when `THEME_FONTS` recomputed from all manifests changes the built Google-Fonts URL relative to the committed baseline (font-metadata drift — asserted via AC-FONT-1's `buildFontLinkHref(THEME_FONTS)` byte-equality against the committed `_document.tsx` URL, since the two share the same `THEME_FONTS` source). The originally-worded "`order`-sorted position differs from the committed registry" sub-clause is **retired**: the committed `registry.generated.ts` computes `APP_THEMES`/`THEME_FONTS` from the live manifests at module-evaluation time (per §6.4/D5, the `.mjs` emits only a folder-name scaffold and cannot materialize `order`/font values), so a "recompute vs committed" order comparison is vacuous (both sides derive from the same manifests); and per §12 a manual `order` reassignment is an intended edit, **not** drift — only `order` *collisions* are a validation failure (AC-VAL-4). Order-collision detection (AC-VAL-4) and font drift (AC-FONT-1) together cover the real metadata-drift surface; no user-facing guarantee (US2) is weakened by retiring the vacuous order-position sub-clause.

**AC-VAL-4** *(spec AC8b, hardened)* — Two manifests declaring the same `order` value MUST fail `themes-validation.test.ts` with a uniqueness violation.

**AC-FONT-1** *(spec AC14, hardened)* — `buildFontLinkHref(THEME_FONTS)` MUST equal, byte-for-byte, `https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=Fredoka:wght@400;500;600;700&family=Nunito:wght@400;600;700;800&family=Press+Start+2P&family=VT323&display=swap`; `app/pages/_document.tsx` MUST render its font `<link>` `href` from this built value, not a hardcoded string.

**AC-BOUND-1** *(spec AC17, hardened)* — No client-bundle-reachable module (any theme's `manifest.ts`, `registry.generated.ts`, `buildChakraTheme.ts`, `fontUnion.ts`, `index.ts`, any `treatments/*` file, `_document.tsx`, `useThemeStyles.ts`, `ThemeIcon.tsx`) MUST contain a runtime import that resolves to `app/src/themes/schema.ts` (matched by resolved import target, not literal path string). The architectural test in `themes-validation.test.ts` MUST fail when one is found, and `zod` MUST NOT appear in the `next build` client bundle output.

## Consumers (S4)

**AC-UX-1** *(spec AC10)* — `useThemeStyles()` MUST return exactly the fields `{ cardStyle, surfaceStyle, navStyle, buttonStyle, contentPanelStyle, bannerDecorStyle }` (no `visualStyle`, no `isFunTheme`) with the same per-theme values as the pre-refactor implementation; `app/src/components/Layout.tsx` and `app/pages/index.tsx` MUST remain unchanged.

**AC-UX-2** *(spec AC11)* — `ThemeIcon` MUST render the same iconify id per theme as the pre-refactor `ICON_MAP` (line/filled/pixel sets preserved) for every currently-mapped icon name; `getThemeIconId()` MUST resolve icon ids via `manifest.treatments.iconSet` against `app/src/themes/treatments/iconSets.ts`.

**AC-UX-3** *(spec AC13)* — The theme picker and preview on `/profile` MUST render `label`/`description` from each manifest's `{ en; de? }` fields (with `de` falling back to `en`) instead of from `i18n.ts`; the 10 keys `calm…flowerDescription` (both `en` and `de` variants) MUST be removed from `app/src/lib/i18n.ts`, while `themeHeading`, `themeDescription`, `active`, and `currentTheme` MUST remain.

**AC-UX-4** *(spec AC15)* — `normalizeThemeName` MUST return `DEFAULT_THEME_NAME` for any stored theme id absent from `APP_THEMES`; a stored id present in `APP_THEMES` with `status:'hidden'` MUST normalize to itself; `readSettings`/`writeSettings` in `app/src/lib/storage.ts` and the legacy `mood` field fallback MUST continue to round-trip correctly.

## Authoring Guide (S5)

**AC-DOC-1** *(spec AC16)* — `docs/themes/authoring-guide.md` MUST exist and MUST document: the folder structure; the complete `ThemeManifest` field reference (required vs. optional, types, the `id` regex, `order` uniqueness); the exact contrast pairs and threshold (§6.7); typography and `FontLoad`; the treatment catalog and the `overrides` escape hatch with its stated limits (§3); banner/asset options; localization; `status` behavior; how to run validation locally; one fully worked sample theme; and the gotchas list (static export; dark themes must pass contrast or set `contentSurface`; `backgroundImage` must stay decorative/low-opacity so `appBg` remains the effective text background). `app/src/themes/README.md` MUST exist and MUST link to `docs/themes/authoring-guide.md`.

## Cross-Cutting Invariants

**AC-STRUCT-5** — The public API exported from `app/src/lib/theme.ts` — `isAppThemeName`, `normalizeThemeName`, `getThemeDefinition`, `getChakraTheme`, `DEFAULT_THEME_NAME`, and the `AppThemeName` type — MUST keep its pre-refactor names and call signatures across S1–S4, so that none of its 6 existing consumer files (`useMoodTheme.tsx`, `useThemeStyles.ts`, `ThemeIcon.tsx`, `storage.ts`, `profile.tsx`, `_document.tsx`) requires a call-site signature change beyond the treatment-lookup and label changes already named in AC-UX-1..AC-UX-3.

## Manual Validation

Spec §11 item 4 ("open `/profile`, switch all 5 themes → visually identical to pre-refactor") bundles several checks. The persistence-reload, unknown-id-fallback, and hidden-sample-absent-from-picker sub-checks are already covered by automated ACs (AC-UX-4, AC-STRUCT-4) and are not re-listed here. What remains genuinely non-automatable is actual pixel/glyph-level rendering — something AC-PARITY-1's Chakra-theme-object equality check and AC-UX-1/AC-UX-2's style-object equality checks cannot observe (real font glyph rendering, image/SVG loading, on-screen spacing).

| MV id | Behavioral intent | Owner | Blocked on |
|-------|-------------------|-------|------------|
| MV-1 | A human runs `make dev`, opens `/profile`, and switches through all 5 themes (`calm, playful, lego, minecraft, flower`), confirming each renders visually identical to the pre-refactor app — colors, fonts, banners, icons, spacing, and the Minecraft light content panel — with no regression the automated equality checks cannot observe. | Implementing developer, before the epic transitions to done (post-S4) | AC-PARITY-1, AC-PARITY-2, AC-UX-1, AC-UX-2, AC-FONT-1 |
