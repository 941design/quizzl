// app/src/themes/index.ts
//
// The real public API for the themes module, wired to `registry.generated.ts`
// (architecture.md Module Map: "index | public API (re-exported by
// lib/theme.ts) | ... | none — imports/re-exports + cached getChakraTheme").
// `app/src/lib/theme.ts` is a thin re-export of this file.
//
// --- S2->S4 COMPAT BRIDGE TORN DOWN (S4) ------------------------------------
//
// S2 introduced a transitional `AppThemeDefinition = ThemeManifest &
// { visualStyle; labelKey; descriptionKey; backgroundImage? }` here, because
// `useThemeStyles.ts`, `ThemeIcon.tsx`, and `profile.tsx` still read those
// four derived fields at the time. S4 migrated all three consumers to read
// `manifest.treatments`/`manifest.contentSurface`/`manifest.label`/
// `manifest.description`/`manifest.colors.backgroundImage` directly, so the
// bridge (the four deprecated fields, `toCompatDefinition`,
// `ELEVATION_TO_VISUAL_STYLE`, and the `ThemeVisualStyle` re-export) is
// removed here. `AppThemeDefinition` is now the literal alias
// architecture.md's Registry seam contract always described as the epic end
// state.
import {
  APP_THEMES,
  type AppThemeName,
} from './registry.generated';
import { getChakraTheme as getCachedChakraTheme, type ChakraTheme } from './buildChakraTheme';
import type { ThemeManifest } from './schema';

export type { AppThemeName };
export { APP_THEMES };

/**
 * The public theme-definition type. A pure alias — no compat fields — per
 * architecture.md's Registry seam contract: "`AppThemeDefinition =
 * ThemeManifest` (alias)."
 */
export type AppThemeDefinition = ThemeManifest;

export const DEFAULT_THEME_NAME: AppThemeName = 'calm';

export function isAppThemeName(value: string): value is AppThemeName {
  return value in APP_THEMES;
}

export function normalizeThemeName(value: string | null | undefined): AppThemeName {
  return value && isAppThemeName(value) ? value : DEFAULT_THEME_NAME;
}

export function getThemeDefinition(themeName: AppThemeName): AppThemeDefinition {
  return APP_THEMES[themeName];
}

/**
 * `true` unless the given manifest is explicitly `status: 'hidden'`.
 * Exported separately from `listThemes` (rather than inlined) so it can be
 * exercised directly against a fixture manifest — none of the five migrated
 * themes currently sets `status: 'hidden'`, so a test that only ever calls
 * `listThemes()` against the real registry could never observe the
 * filtering branch. Architecture.md Implementation Constraint 14.
 */
export function isThemeVisible(theme: ThemeManifest): boolean {
  return theme.status !== 'hidden';
}

/**
 * Returns the themes eligible for display (excludes `status: 'hidden'` by
 * default). `APP_THEMES` itself always contains ALL themes — including
 * hidden ones — so the folder-set/drift invariants (AC1/AC2) hold; this is
 * the display-time filter `profile.tsx`'s picker consumes. Pass
 * `{ includeHidden: true }` to get every theme regardless of status.
 * (architecture.md Implementation Constraint 14 / spec.md §6.10.)
 */
export function listThemes(options: { includeHidden?: boolean } = {}): AppThemeDefinition[] {
  const all = Object.values(APP_THEMES) as AppThemeDefinition[];
  return options.includeHidden ? all : all.filter(isThemeVisible);
}

/**
 * Public API: `getChakraTheme(id: AppThemeName)`. Bridges
 * `id -> registry manifest -> buildChakraTheme.ts's manifest-keyed
 * getChakraTheme(manifest)` (aliased to `getCachedChakraTheme` above to
 * avoid a name collision with this function). Referential stability is
 * inherited from `buildChakraTheme.ts`'s `manifest.id`-keyed cache — calling
 * this repeatedly for the same `id` returns the exact same `ChakraTheme`
 * object (architecture.md Implementation Constraint 9).
 */
export function getChakraTheme(themeName: AppThemeName): ChakraTheme {
  return getCachedChakraTheme(APP_THEMES[themeName]);
}
