// app/src/themes/registry.generated.ts
//
// GENERATED FILE — DO NOT EDIT BY HAND.
// Produced by app/scripts/generate-theme-registry.mjs from the set of
// app/src/themes/*/ folders containing a manifest.ts (architecture.md
// Module Map + Implementation Constraint 8). Re-run
// `node scripts/generate-theme-registry.mjs` after adding or removing a
// theme folder — the `prebuild` npm script does this automatically before
// every build (app/package.json).
//
// This file performs only the structural scaffold: one static import per
// theme, the `AppThemeName` union derived from folder names, an `_all`
// array, and wiring that calls the hand-written helpers (`buildThemeFonts`,
// order-sort) AT EVALUATION TIME. `APP_THEMES`/`THEME_FONTS` are therefore
// computed here in this emitted TS, not by the generator script itself — the
// generator never imports or evaluates TypeScript (Implementation
// Constraint 8).
//
// Boundary Rules: registry.generated -> manifests (static import), schema
// (TYPE ONLY), fontUnion (`buildThemeFonts` value import). No edge to
// buildChakraTheme.ts — the registry carries data only.
import { manifest as aquarelleManifest } from './aquarelle/manifest';
import type { ThemeManifest } from './schema';
import { buildThemeFonts, type FontLoad } from './fontUnion';

/**
 * The `AppThemeName` union, derived mechanically from the theme folder
 * names present under app/src/themes/ at generation time.
 */
export type AppThemeName = 'aquarelle';

/**
 * One entry per theme folder, in generator-scan (alphabetical folder-name)
 * order — NOT order-sorted; see `_sorted` below.
 */
const _all: ThemeManifest[] = [
  aquarelleManifest,
];

/**
 * `order`-ascending sort, computed here at eval time (not by the generator
 * — Implementation Constraint 8).
 */
const _sorted: ThemeManifest[] = [..._all].sort((a, b) => a.order - b.order);

/**
 * `Record<AppThemeName, ThemeManifest>`, keyed by each manifest's own
 * `id`, insertion-ordered by `order` ascending. Contains ALL themes,
 * including any `status: 'hidden'` entry — filtering for display is
 * `listThemes()` (architecture.md Implementation Constraint 14).
 */
export const APP_THEMES: Record<AppThemeName, ThemeManifest> = Object.fromEntries(
  _sorted.map((m) => [m.id, m])
) as Record<AppThemeName, ThemeManifest>;

/**
 * The deduplicated `FontLoad[]` union across all manifests, computed from
 * the `order`-sorted manifest list via `fontUnion.ts`'s `buildThemeFonts`
 * (Implementation Constraint 8). Consumed directly by `_document.tsx`.
 */
export const THEME_FONTS: FontLoad[] = buildThemeFonts(_sorted);
