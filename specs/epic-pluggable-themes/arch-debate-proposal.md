# Architectural Proposal — Pluggable Themes (epic-pluggable-themes)

## 1. Paradigm

**Recommendation: Mixed — layered/n-tier at the application level; package-by-feature + functional core / imperative shell inside `app/src/themes/`.**

The existing system is layered/n-tier with a functional-core grain. Evidence: `app/src/types/index.ts:8` is a pure type layer; `app/src/lib/theme.ts:86-204` is a pure domain transform (`createTheme`) with no React/side effects; `app/src/lib/storage.ts:61-76` is persistence importing inward; `app/src/hooks/useMoodTheme.tsx:14-45` is application-state (useState + useEffect + writeSettings); `app/pages/_app.tsx:40` is the shell (ChakraProvider root). Functional-core grain at `app/src/lib/theme.ts:677-753` (APP_THEMES static record + pure accessors).

`app/src/themes/` must be **package-by-feature** internally because G2 (drop a folder, no shared-code edits) requires each theme self-contained. Within that shell: manifests = pure data (functional core), `buildChakraTheme.ts` = pure transform (core), `treatments/*` = constant lookup tables (core), the generator = imperative shell (fs read/write), the vitest gate = imperative shell, `AppThemeProvider` = imperative shell (unchanged). Layered-inside-themes would recreate the problem (shared layers every theme depends on). The two paradigms compose because `themes/index.ts` slots into the existing layered stack where `lib/theme.ts` sits today.

## 2. Module Map

### New modules
- **`app/src/themes/schema.ts`** — sole source of `ThemeManifest` shape + zod errors naming theme/field (AC5–7). Owns `ThemeManifestSchema`, inferred `ThemeManifest`, `validateManifest()`. NEVER imported by client/runtime — generator + test only.
- **`app/src/themes/buildChakraTheme.ts`** — replaces `createTheme()` (theme.ts:86-204). `ThemeManifest → Chakra ThemeOverride`; calls `extendTheme()`; lifts `createScale()` (theme.ts:71). No zod.
- **`app/src/themes/treatments/elevation.ts`** — named elevation prop-sets replacing cardOverlay/buttonOverlay/navOverlay (useThemeStyles.ts:51-176). `ElevationTreatment: Record<ElevationName, {card;button;nav;surface: BoxProps}>`, `ElevationName='flat'|'softDrop'|'hardDrop'|'pixelBevel'|'floralGlow'`.
- **`app/src/themes/treatments/iconSets.ts`** — replaces ICON_MAP (ThemeIcon.tsx:12-73). `IconSetName='line'|'filled'|'pixel'` (pixel→pixel, toy→filled, default→line).
- **`app/src/themes/treatments/patterns.ts`** — replaces STUD/GRID/PETAL + surfaceOverlay (useThemeStyles.ts:12-49). `SurfacePatternName='none'|'studs'|'grid'|'petals'` + AppBg gradient strings (lego/minecraft/flower backgrounds from theme.ts:677-733).
- **`app/src/themes/registry.generated.ts`** (GENERATED, committed) — sole folder→module wiring. Static imports per manifest; exports `APP_THEMES: Record<AppThemeName, ThemeManifest>`, `AppThemeName` union from folder names, `THEME_FONTS: FontLoad[]` (deduped union). Idempotent (AC2).
- **`app/src/themes/index.ts`** — public API. Exports `getThemeDefinition/getChakraTheme/isAppThemeName/normalizeThemeName/DEFAULT_THEME_NAME/listThemes` with signatures preserved from theme.ts:737-751. Re-exports `AppThemeName/AppThemeDefinition/ThemeManifest`.
- **`app/src/themes/{calm,playful,lego,minecraft,flower}/manifest.ts`** — one pure-data file/theme, values lifted field-for-field from theme.ts:677-733 + banner SVG from useThemeStyles.ts:179-292. No Chakra import, no functions.
- **`app/scripts/generate-theme-registry.mjs`** — Node ESM; globs `src/themes/*/manifest.ts`; structural checks (manifest present, id===folder); emits registry; `process.exitCode=1` on break. Scaffold from generate-avatar-manifest.mjs.
- **`app/tests/unit/themes-validation.test.ts`** — vitest; imports manifests via registry; `ThemeManifestSchema.parse` + cross-field checks (WCAG-AA contrast, id===folder, dark-appBg legibility, minecraft font ordering); drift test (registry keys == folder set); `toEqual` not snapshots.

### Modified modules
- **`app/src/lib/theme.ts`** → thin re-export of `themes/index.ts` (6 consumers unchanged).
- **`app/src/types/index.ts:8`** → `AppThemeName` imported from registry (or via lib/theme re-export).
- **`app/src/hooks/useThemeStyles.ts`** → switch fns replaced by treatment lookups; BANNER_SVG → `manifest.treatments.banner`; contentPanel gate moves to `manifest.contentSurface`; return shape unchanged (AC10).
- **`app/src/components/ThemeIcon.tsx`** → ICON_MAP → treatments/iconSets.ts; reads `manifest.treatments.iconSet`.
- **`app/pages/_document.tsx:9-13`** → hardcoded Google Fonts URL → URL built from `THEME_FONTS`.
- **`app/pages/profile.tsx:221-264`** → labelKey/descriptionKey → `manifest.label`/`manifest.description`.
- **`app/src/lib/i18n.ts`** → remove 10 per-theme keys (en ~545-557, de ~1001-1013); keep themeHeading/themeDescription/active/currentTheme.
- **`app/package.json`** → add `zod` dep; add `prebuild` script.

## 3. Seam Contracts

**ThemeManifest** (schema.ts → all downstream): id (===folder, AC7), label/description `{en; de?}`, previewColorScheme, author?/license?/status?, colorScheme 'light'|'dark', colors (5× Scale10 + semantic tokens appBg/backgroundImage?/surface*/border*/text*/status*/buttonColorScheme), typography {fonts{heading,body,display?}, fontLoad: FontLoad[], fontSizes?}, shape?{radii?,borderWidths?}, treatments{elevation:ElevationName, iconSet:IconSetName, surfacePattern:SurfacePatternName, banner:string, motion?, overrides?:RawOverrides, fun?:boolean}, contentSurface? (auto = colorScheme==='dark' if absent). Cross-field invariants enforced in the test, not zod.

**Registry** (registry.generated.ts → index + consumers): `AppThemeName` union, `APP_THEMES: Record<AppThemeName, ThemeManifest>`, `THEME_FONTS: FontLoad[]`. Old `AppThemeDefinition` (theme.ts:51) carried `chakraTheme` (prebuilt) + labelKey/descriptionKey — both disappear; `AppThemeDefinition = ThemeManifest`; chakraTheme replaced by `getChakraTheme(id)=buildChakraTheme(APP_THEMES[id])` on demand. useMoodTheme reads `getChakraTheme(name)` + `manifest.contentSurface`; useAppTheme() public surface unchanged.

**useThemeStyles return** (AC10, byte-compatible): cardStyle, surfaceStyle, navStyle, buttonStyle, contentPanelStyle: BoxProps|null, bannerDecorStyle: {boxProps; style}|null, isFunTheme. `visualStyle` (returned today at :330) is dropped. BannerDecor boxProps/style split is a hard contract — Chakra drops data-URI backgroundImage (:295-296).

**THEME_FONTS** (registry → _document): FontLoad[]; _document builds the CSS2 URL. Current URL covers DM Serif Display(400), Fredoka(400;600), Nunito(400;500;600;700), Press Start 2P(400), VT323(400) — manifests' fontLoad must collectively cover these.

**Treatment selectors**: elevation.ts `ElevationTreatment[name]→{card,button,nav,surface}` (flat/softDrop=all {} for calm/playful; hardDrop=toy props; pixelBevel=pixel props; floralGlow=floral props). iconSets.ts `IconSetMap[name][iconName]`. patterns.ts `SurfacePattern[name]` + resolution: useThemeStyles reads manifest.treatments.* → looks up tables.

## 4. Boundary Rules

Permitted: manifests import nothing (type-only ThemeManifest); schema.ts→zod + BoxProps type; treatments→BoxProps type; buildChakraTheme→chakra + treatments; registry→manifests + ThemeManifest type; index→registry + buildChakraTheme; lib/theme→index (re-export); types→registry; useMoodTheme→lib/theme; useThemeStyles→lib/theme + treatments; ThemeIcon→treatments/iconSets + lib/theme; _document→registry (THEME_FONTS only); profile/storage→lib/theme; generator→node fs/path/url only; test→index + schema.

Forbidden edges: any client module→schema.ts (zod out of bundle); manifest→@chakra-ui/react (serializable); manifest→buildChakraTheme/treatments; registry→buildChakraTheme; treatments→schema; buildChakraTheme→schema; index→schema; any non-test→schema (absolute); useThemeStyles→registry directly (must go via lib/theme); any module→deleted lib/theme internals. Sole permitted direct cross-boundary import besides lib/theme: _document→THEME_FONTS (build constant).

## 5. Assumptions

- **A1 — AC9 byte-identical serialization unproven.** extendTheme merges Chakra defaults; deep-equal (toEqual) should tolerate key-order but pre-refactor snapshot capture (spec §10) is essential. If referential stability needed for provider, pre-build+cache in index.ts.
- **A2 — generated .ts registry vs webpack require.context.** Codegen chosen (require.context not guaranteed safe under output:export; consistent with avatar precedent). Cost: generator must run before tsc/next build resolves the import; commit the generated file.
- **A3 — prebuild hook sufficient as gate.** make build→npm run build→prebuild works (Makefile:93), but make test-unit runs vitest directly (Makefile:109) without generator — stale/missing registry breaks the test on fresh checkout. May need a Makefile target running generator before tests.
- **A4 — manifests function-free can express current treatments.** True today (all treatments are per-theme static constants/SVG strings). Breaks if a future theme needs a pattern computed from its own tokens; overrides is hardcoded BoxProps only. Out of scope; guide must call out the limit.
- **A5 — decomposing visualStyle reproduces exact output.** Switches today are NON-uniform: contentPanel fires only for pixel; icon map is 3-way; nav/card/button 3-way. Each elevation name must map to exact BoxProps incl. the {} cases (calm/playful). Holds if transcribed exactly.
- **A6 — isFunTheme derivation.** Today `vs in {toy,pixel,floral}`. Proposal adds explicit `treatments.fun?:boolean` (lego/minecraft/flower=true). Risk: validator may reject a derived-UI flag on the manifest; fallback derives from elevation set in useThemeStyles.
- **A7 — on-demand extendTheme timing.** Today eager ×5 at import; on-demand defers to first render. Static export → no hydration mismatch, but cold-render cost; cache in index.ts Map or pre-build all five.
