# Round 1 Response — Pluggable Themes Proposal

## 1. Paradigm — label unchanged; one concession
Mixed paradigm stands. "package-by-feature" applies strictly to `app/src/themes/<id>/` subfolders (each theme self-contained, G2). Shared infra (schema, buildChakraTheme, treatments, index) is layered n-tier domain code. Epic's modification of useThemeStyles/ThemeIcon/profile/_document/i18n is expected cross-cutting migration work — large coupling footprint is a migration cost, not a paradigm failure.

## 2. Module Map — REVISED (changes)
- **iconSets.ts**: `IconSetName='line'|'filled'|'pixel'` — canonical manifest path is `treatments.iconSet`. line=current `default`, filled=current `toy`, pixel unchanged. Icon key names preserved.
- **registry.generated.ts** (GENERATED+COMMITTED): `APP_THEMES` sorted by `manifest.order` ascending (NOT filesystem order). Committed hand-authored stub in story 2 before generator (story 3); generator must be idempotent vs stub.
- **index.ts**: story 1 = pass-through to lib/theme (no registry import, no behavior change); story 2 = switches to registry + buildChakraTheme. `getChakraTheme` uses module-level `Map<AppThemeName,ThemeOverride>` cache (referential stability, A7).
- **manifests**: add required `order:number` (calm=1..flower=5); `contentSurface?:boolean` explicit (only minecraft true); `treatments.iconSet`; NO `treatments.fun` (isFunTheme derived from elevation).
- **NEW `app/scripts/capture-theme-baseline.mjs`** (story 0): calls current getChakraTheme for 5 ids pre-refactor, serializes to committed `app/tests/unit/theme-baseline.generated.ts`. Runs+commits BEFORE story 1 touches theme.ts.
- **generate-theme-registry.mjs**: emits sorted-by-order; structural checks (manifest present, id===folder).
- **themes-validation.test.ts**: schema.parse per theme + WCAG-AA contrast + id===folder + **drift test** `readdirSync(src/themes).filter(isDir)` vs `Object.keys(APP_THEMES)` — catches "added folder, forgot to regenerate" WITHOUT running generator on test path.
- **useThemeStyles**: returns exactly `{cardStyle,surfaceStyle,navStyle,buttonStyle,contentPanelStyle,bannerDecorStyle,isFunTheme}` (AC10 seven fields). `visualStyle` REMOVED (no external caller: Layout.tsx:51 reads {navStyle,surfaceStyle,bannerDecorStyle,contentPanelStyle}; index.tsx:19 reads {cardStyle} — grep-confirmed). `isFunTheme=['hardDrop','pixelBevel','floralGlow'].includes(manifest.treatments.elevation)`. ThemeVisualStyle re-export removed.
- **profile.tsx**: order via manifest.order; label/description locale-aware from manifest; filters `status:'hidden'`.
- **package.json prebuild**: `node scripts/generate-theme-registry.mjs && vitest run tests/unit/themes-validation.test.ts`.

## 3. Seam Contracts — REVISED
**ThemeManifest** adds `order:number` (required); `colorScheme` describes appBg lightness for WCAG logic and does NOT auto-derive contentSurface; `treatments.iconSet` canonical; NO fun field; `contentSurface?` explicit optional (minecraft sets true).

**FontLoad** (reproduces exact _document.tsx:10 URL):
```
type FontLoad = { family: string; weights?: number[]; ital?: boolean; subset?: string };
```
- flower: `{family:'DM Serif Display', ital:true}` → `DM+Serif+Display:ital@0;1`
- lego: `{family:'Fredoka', weights:[400,500,600,700]}` → `Fredoka:wght@400;500;600;700`
- Nunito: `{family:'Nunito', weights:[400,600,700,800]}` → `Nunito:wght@400;600;700;800`
- minecraft: `{family:'Press Start 2P'}`, `{family:'VT323'}`
URL builder: ital-only→`NAME:ital@0;1`; weights-only→`NAME:wght@...`; both→`NAME:ital,wght@0,w;1,w`; neither→`NAME`; append `&display=swap`. Prior font summary was WRONG; this table is authoritative.

**Registry**: `APP_THEMES` sorted by order. `AppThemeDefinition = ThemeManifest` (alias). chakraTheme no longer stored — computed on demand + cached.

**useThemeStyles**: seven-field contract above; visualStyle gone.

## 4. Boundary Rules — unchanged

## 5. Assumptions — REVISED
- A1: baseline captured story 0, committed before story 1; AC9 test `toEqual(baseline[id])`.
- A2 [DEFENDED]: generated .ts registry over require.context (output:export unsafe; avatar precedent; type derived from folders is the G2 goal).
- A3 [REVISED]: freshness via TWO controls — committed registry + readdirSync drift test (fails on test path without Makefile change); prebuild covers CI.
- A4 [DEFENDED+limit]: all current banners/backgrounds are static strings; function-free holds this epic; guide documents the limit (token-derived treatments = future).
- A5 [DEFENDED]: deterministic mapping; default:{} → elevation:'flat'; parity tests catch transcription error.
- A6 [REVISED]: drop treatments.fun; isFunTheme derived from elevation (single source; matches toy/pixel/floral today).
- A7 [REVISED]: module-level Map cache, eager-built ×5 at import; getChakraTheme returns stable ref (matches current prebuilt chakraTheme).

## Revised Story Ordering (supersedes spec §13)
0. Baseline capture + commit theme-baseline.generated.ts (no src change).
1. schema+builder+treatments; index=pass-through to lib/theme (no registry import). Compiles; no behavior change.
2. 5 manifests + committed registry stub; index→registry; lib/theme→re-export; types→registry import. AC9,AC12.
3. Generator replaces stub (idempotent) + prebuild + themes-validation + drift test. AC1–AC8, AC14.
4. useThemeStyles, ThemeIcon, profile, _document, i18n. AC10,AC11,AC13.
5. Authoring guide + README. AC16.
types/index.ts changes in story 2 (after stub exists), not story 1 → no compile dependency before generator. Stories 3/4 share no simultaneous write target.

## Addressed Concerns (summary)
BC1 useThemeStyles contradiction [REVISED]: visualStyle removed; not AC10 break (no external caller).
BC2 iconSet path + contract contradictions [REVISED]: canonical `treatments.iconSet`; seven-field return.
BC3 contentSurface ownership [REVISED]: explicit boolean, NOT auto-derived; colorScheme selects contrast surface; minecraft sets true (AC12 green).
BC4 THEME_FONTS [REVISED]: FontLoad ital/weights shape reproduces exact URL (DM Serif ital@0;1, Nunito 800).
BC5 registry ordering [REVISED]: required `order` field; generator sorts; picker parity preserved.
BC6 AC9 baseline [REVISED]: story 0 capture+commit before story 1.
BC7 gate insufficiency [REVISED]: committed registry + drift test on vitest path.
BC8 story-order compile coupling [REVISED]: 6-story order; pass-through index; committed stub; types change in story 2.
A1–A7 resolved as above. status:hidden filtering owned by profile.tsx (story 4). Non-pixel content panel = out of scope, documented. Italic/variable fonts resolved by FontLoad shape.
