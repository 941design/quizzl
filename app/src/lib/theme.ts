// app/src/lib/theme.ts
//
// Thin re-export of `app/src/themes/index.ts` (architecture.md Module Map:
// "lib/theme (modified) | thin re-export of themes/index"). No inline theme
// object definitions remain here as of this story (S2) — all five themes
// now live as manifests under `app/src/themes/<id>/manifest.ts`, migrated
// field-for-field (AC-PARITY-1, AC-PARITY-2).
//
// Every one of this module's six existing consumers (`useMoodTheme.tsx`,
// `useThemeStyles.ts`, `ThemeIcon.tsx`, `storage.ts`, `profile.tsx`,
// `_document.tsx`) continues to import from `@/src/lib/theme` unchanged —
// AC-STRUCT-5 requires this file's public API (names + call signatures) to
// stay stable across S1-S4.
export {
  APP_THEMES,
  DEFAULT_THEME_NAME,
  isAppThemeName,
  normalizeThemeName,
  getThemeDefinition,
  getChakraTheme,
  listThemes,
} from '@/src/themes/index';
export type { AppThemeDefinition, AppThemeName } from '@/src/themes/index';
