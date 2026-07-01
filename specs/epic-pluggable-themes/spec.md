# Feature Request Specification — Pluggable Themes

> Intended for implementation via the base plugin `/base:feature` workflow.

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
- **G2** — Themes are **auto-detected at build time**; adding one is dropping a folder, with **no edits
  to shared code**.
- **G3** — All themes are **validated during the build**; a non-conforming theme **fails the build**.
- **G4** — The five existing themes are migrated into the new structure with **byte-identical** output.
- **G5** — A comprehensive **authoring specification** ships for theme developers.

## 3. Non-goals

- No visual redesign of the existing themes (migration must be pixel-identical).
- No runtime/user-uploaded themes (build-time, developer-authored only — though the manifest is kept
  serializable to allow this later).
- No per-request lazy font loading (keep union-load; matches current behavior).
- No migration off Chakra UI.

## 4. Constraints (verified in the codebase)

- `output: 'export'` + webpack (`app/next.config.mjs:20`) → **no runtime filesystem reads**; detection
  must be build-time codegen emitting a static registry.
- No TS runner installed (no tsx/ts-node); **vitest is present** and imports TS natively. Codegen
  precedent is plain `.mjs` run via `node` (`app/scripts/generate-avatar-manifest.mjs`).
- Chakra UI is the render engine (`ChakraProvider`, `app/pages/_app.tsx:40`); the token layer must keep
  emitting a Chakra theme object.
- The public theme API in `app/src/lib/theme.ts` is consumed by only 6 files + 1 test — preserving that
  API surface keeps the change contained.

## 5. Decisions already made (do not re-litigate)

- **D1** — Theme `label`/`description` live **inline in each manifest** as localized strings
  (`{ en: string; de?: string }`; `de` falls back to `en`). Deliberate, documented exception to the
  CLAUDE.md "all UI text in i18n.ts" rule, scoped to theme-owned content.
- **D2** — **Fully composable treatments**: decompose the closed `visualStyle` enum into independent,
  data-selected manifest fields backed by a reusable treatment library, plus a raw-props escape hatch.
- **D3** — **Add `zod`** as the manifest schema library; validation gate wired into the build.
- **D4** — Fonts auto-managed via a **generated union** Google Fonts `<link>` (no `_document` edit per
  theme). Banners kept as **inline SVG in the manifest** for parity, with a `public/themes/<id>/`
  file option documented as an escape hatch.

## 6. Target design

### 6.1 Folder layout
```
app/src/themes/
  schema.ts               # zod ThemeManifestSchema + type ThemeManifest = z.infer<...> + validateManifest()
  buildChakraTheme.ts     # manifest (pure data) -> Chakra ThemeOverride (replaces createTheme)
  treatments/
    elevation.ts          # named card/button/nav/surface prop-sets: flat|softDrop|hardDrop|pixelBevel|floralGlow
    iconSets.ts           # icon-name -> iconify id maps per iconSet: line|filled|pixel
    patterns.ts           # surface/background patterns: none|studs|grid|petals (+ appBg gradients)
  registry.generated.ts   # GENERATED — imports each manifest; exports APP_THEMES, AppThemeName union, THEME_FONTS
  index.ts                # public API (re-exported by lib/theme.ts): getThemeDefinition, getChakraTheme,
                          #   isAppThemeName, normalizeThemeName, DEFAULT_THEME_NAME, listThemes
  calm/manifest.ts
  playful/manifest.ts
  lego/manifest.ts
  minecraft/manifest.ts
  flower/manifest.ts
```

### 6.2 The manifest (pure data — no Chakra import, no functions → serializable, zod-validatable)
`ThemeManifest` (schema in `themes/schema.ts`; TS type inferred from the zod schema):
- **identity**: `id` (must equal folder name), `label`/`description` `{ en; de? }`, `previewColorScheme`,
  `author?`, `license?`, `status?` (`stable|experimental|hidden`).
- **color**: explicit 10-step scales for `brand/success/warning/danger/neutral` (explicit preserves exact
  migration; seed-derivation is an *optional* convenience for new themes), semantic tokens (`appBg`,
  `surface*`, `border*`, `text*`, status bg/border/text), and `colorScheme: 'light' | 'dark'`.
- **typography**: `fonts { heading, body, display? }`, `fontLoad: [{ family, weights[], subset? }]`
  (drives the generated Google Fonts link), optional `fontSizes`, optional per-role
  letter-spacing/line-height/transform.
- **shape**: `radii`, border widths.
- **treatments** (decomposed `visualStyle`): `elevation`, `iconSet`, `surfacePattern`, `banner`
  (inline SVG string; or a `public/themes/<id>/…` path), `motion`, plus optional `overrides` (raw Chakra
  props for card/button/nav/surface — the escape hatch).
- **behavior**: `contentSurface?` — **auto-derived** from `colorScheme === 'dark'` unless explicitly set.

### 6.3 Removing the closed enum
- `useThemeStyles.ts` no longer switches on one enum: it reads the manifest's treatment selections, looks
  up implementations in `themes/treatments/*`, merges `overrides`. Return shape (`cardStyle`,
  `surfaceStyle`, `navStyle`, `buttonStyle`, `contentPanelStyle`, `bannerDecorStyle`, `isFunTheme`) is
  **unchanged** so `Layout.tsx` / `index.tsx` call sites don't change.
- `ThemeIcon.tsx` reads `manifest.iconSet`; `ICON_MAP` moves to `treatments/iconSets.ts`;
  `getThemeIconId()` keeps working.

### 6.4 Build detection / generation / validation
- **Generator** `app/scripts/generate-theme-registry.mjs` (plain Node ESM): globs
  `src/themes/*/manifest.ts`, verifies structural completeness, emits `registry.generated.ts` (static
  imports → `APP_THEMES`, `AppThemeName` union from folder names, `THEME_FONTS` union). Exit non-zero on
  a structurally broken folder.
- **Validator** `app/tests/unit/themes-validation.test.ts` (vitest): imports every manifest via the
  generated registry; runs `ThemeManifestSchema.parse` (zod, rich errors); plus cross-field checks zod
  can't do — **WCAG-AA contrast** on key text/surface pairs, `id === folder`, dark-appBg ⇒ content legible
  (panel or passing contrast); plus a drift test asserting the registry matches the folder set.
- **Build gate**: add `"prebuild": "node scripts/generate-theme-registry.mjs && vitest run tests/unit/themes-validation.test.ts"` in `app/package.json`. Since `make build` → `npm run build` → `next build`,
  prebuild runs on every path (make or bare `npm run build`).

### 6.5 Fonts
Generator computes the union of all `fontLoad` entries → `THEME_FONTS`; `app/pages/_document.tsx` renders
the Google Fonts `<link>` from it instead of the hardcoded URL.

### 6.6 zod bundle hygiene
Only the generator and tests import `schema.ts`. Client code imports registry data + `buildChakraTheme`
only, so zod stays out of the client bundle.

## 7. User stories

- **US1 — Theme author adds a theme.** As a developer, I drop a new folder under `app/src/themes/` with a
  `manifest.ts` (and optional banner asset), run the build, and the theme appears in the picker with no
  edits to any shared file.
- **US2 — Build rejects a broken theme.** As a maintainer, if a manifest is missing a field, has an
  invalid value, or fails contrast, the build fails with a clear, specific error naming the theme and
  field.
- **US3 — Existing themes unchanged.** As an end user, after the refactor all five themes look and behave
  exactly as before, including the Minecraft light content panel and pixel font scale.
- **US4 — Author self-serves from docs.** As a theme author, the authoring guide tells me every field,
  the treatment catalog, contrast rules, and how to validate locally — I need not read the framework code.
- **US5 — Graceful fallback.** As an end user with a stored theme id that no longer exists, the app falls
  back to the default theme without error.

## 8. Acceptance criteria (testable)

**Structure & auto-detection**
- **AC1** — Each of `calm, playful, lego, minecraft, flower` exists as `app/src/themes/<id>/manifest.ts`;
  `app/src/lib/theme.ts` no longer contains inline theme definitions.
- **AC2** — Running the generator produces `registry.generated.ts` whose `APP_THEMES` keys exactly equal
  the set of theme subfolders; re-running is idempotent (no diff).
- **AC3** — Adding a valid sample folder and rebuilding makes it appear in the profile picker with **no
  other file edits**; removing the folder removes it.

**Validation / build gate**
- **AC4** — `npm run build` (and `make build`) runs generation + validation before `next build`.
- **AC5** — A manifest with a missing/invalid field fails the build via a zod error naming the theme and
  path; the build does not produce `app/out`.
- **AC6** — A manifest whose key text/surface pair fails WCAG-AA contrast fails the build with a contrast
  error (unless it declares/derives `contentSurface` and passes on the panel surface).
- **AC7** — A theme folder whose `manifest.id` ≠ folder name fails validation.
- **AC8** — A registry that has drifted from the folder set fails the drift test.

**Behavior parity**
- **AC9** — For all five themes, the generated Chakra theme (`getChakraTheme(id)`) is byte-identical to the
  pre-refactor output (colors, semantic tokens, fonts, fontSizes, radii, background image).
- **AC10** — `useThemeStyles()` returns the same `cardStyle/surfaceStyle/navStyle/buttonStyle/
  contentPanelStyle/bannerDecorStyle/isFunTheme` values per theme as before; `Layout.tsx`/`index.tsx`
  are unchanged.
- **AC11** — `ThemeIcon` renders the same icon ids per theme as before (pixel/filled/line sets preserved).
- **AC12** — The Minecraft invariants hold: `contentSurface` effective for minecraft, falsy for the other
  four; `fontSizes.md ≥ 1.1rem`, `lg > md`, `4xl > xl`.

**Text & fonts**
- **AC13** — Theme label/description render from the manifest (en, with de fallback) in the picker and
  preview; the corresponding `calm…flowerDescription` keys are removed from `i18n.ts` while
  `themeHeading/themeDescription/active/currentTheme` remain.
- **AC14** — `_document.tsx` emits a Google Fonts link derived from the generated `THEME_FONTS` union that
  covers every font declared by every theme; no theme's font is missing.

**Fallback & storage**
- **AC15** — `normalizeThemeName` returns `DEFAULT_THEME_NAME` for an unknown/removed id; stored-settings
  read/write and the legacy `mood` fallback keep working.

**Docs**
- **AC16** — `docs/themes/authoring-guide.md` exists and documents: folder structure; the complete manifest
  field reference (required/optional, types); color + contrast requirements; typography & `fontLoad`;
  the treatments catalog + escape hatch; banner/asset options; localization; how to run validation; a
  fully worked sample theme; and gotchas (static export, dark themes must pass contrast or set
  `contentSurface`). A short `app/src/themes/README.md` points to it.

## 9. Files touched (representative)

- **New**: `app/src/themes/*` (schema, buildChakraTheme, treatments, index, 5 manifests, generated
  registry); `app/scripts/generate-theme-registry.mjs`; `app/tests/unit/themes-validation.test.ts`;
  `docs/themes/authoring-guide.md`; `app/src/themes/README.md`.
- **Modified**: `app/src/lib/theme.ts` (→ thin re-export of `themes/index.ts`);
  `app/src/types/index.ts` (import `AppThemeName` from the registry); `app/src/hooks/useThemeStyles.ts`
  (treatment lookup); `app/src/components/ThemeIcon.tsx` (iconSet-driven); `app/pages/_document.tsx`
  (generated fonts); `app/pages/profile.tsx` (label/description from manifest); `app/src/lib/i18n.ts`
  (remove 10 theme label/description keys per language); `app/package.json` (add `zod`, add `prebuild`);
  `app/tests/unit/theme.test.ts` (migrate invariants to registry).

## 10. Migration fidelity

Translate each of the five themes field-for-field into a manifest using the **explicit 10-step scales and
exact semantic-token hex values** from today's `theme.ts`. No re-tuning during migration; seed-derivation
is offered only to future authors.

To de-risk AC9, capture a snapshot of each theme's current `getChakraTheme(id)` output **before** any
refactor, then assert equality after migration.

## 11. Verification (end-to-end)

1. `cd app && node scripts/generate-theme-registry.mjs` → `git diff` shows a stable, complete registry.
2. `npm run test:unit` (incl. `themes-validation.test.ts`) passes.
3. `make build` succeeds and produces `app/out`. Temporarily add a broken theme (bad hex / failing
   contrast / missing field) → `make build` fails at prebuild with a clear error → remove it.
4. `make dev`, open `/profile`, switch all 5 themes → visually identical to pre-refactor; reload
   persistence works; unknown stored id falls back to `calm`.
5. Drop a sample 6th theme folder → rebuild → appears in the picker with no other edits → remove it.

## 12. Risks / notes

- **Bare `next build` bypass** closed by the `prebuild` npm hook.
- **Generated-file drift** caught by the registry-matches-folders test (AC8).
- **contentSurface** derives from `colorScheme: 'dark'`; the Minecraft invariant is preserved via the
  migrated manifest + validation.
- **Cross-platform**: generator is pure Node, no native bindings; unaffected by the mac/linux
  `node_modules` platform stamp.
- **zod** must not leak into the client bundle (schema imported only by generator/tests).

## 13. Suggested story split for `/base:feature`

1. **Scaffold + schema + builder**: `themes/schema.ts` (zod), `buildChakraTheme.ts`, `treatments/*`,
   `index.ts` public API, `lib/theme.ts` re-export. (No behavior change yet.)
2. **Migrate 5 themes** into manifests; prove byte-identical output (AC9–AC12).
3. **Generator + build gate + validation test** (AC1–AC8, AC14).
4. **Consumers**: `useThemeStyles`, `ThemeIcon`, `profile.tsx`, `_document.tsx`, `i18n.ts` cleanup
   (AC10, AC11, AC13).
5. **Authoring guide** `docs/themes/authoring-guide.md` + README (AC16).
