// app/src/themes/treatments/patterns.ts
//
// Surface/background patterns lifted from useThemeStyles.ts's
// `surfaceOverlay()` switch (pre-refactor): `toy` -> studs, `pixel` -> grid,
// `floral` -> petals; `soft`/`rounded` both fell through to an empty
// BoxProps, which maps onto `none`.
//
// Type-only Chakra import per architecture.md Boundary Rules
// (treatments/* -> @chakra-ui/react BoxProps type only).
import type { BoxProps } from '@chakra-ui/react';

export type SurfacePatternName = 'none' | 'studs' | 'grid' | 'petals';

const STUD_PATTERN = 'radial-gradient(circle, rgba(0,0,0,0.06) 6px, transparent 6px)';
const STUD_PATTERN_SIZE = '24px 24px';

const GRID_PATTERN =
  'conic-gradient(rgba(0,0,0,0.03) 25%, transparent 25%, transparent 50%, rgba(0,0,0,0.03) 50%, rgba(0,0,0,0.03) 75%, transparent 75%)';
const GRID_PATTERN_SIZE = '16px 16px';

const PETAL_PATTERN =
  'radial-gradient(circle at 50% 35%, rgba(255,255,255,0.55) 0 22%, transparent 23%), radial-gradient(circle at 30% 60%, rgba(255,255,255,0.35) 0 16%, transparent 17%), radial-gradient(circle at 70% 60%, rgba(255,255,255,0.35) 0 16%, transparent 17%)';
const PETAL_PATTERN_SIZE = '64px 64px';

export const SURFACE_PATTERNS: Record<SurfacePatternName, BoxProps> = {
  none: {},
  studs: {
    backgroundImage: STUD_PATTERN,
    backgroundSize: STUD_PATTERN_SIZE,
    backgroundPosition: '12px 12px',
  },
  grid: {
    backgroundImage: GRID_PATTERN,
    backgroundSize: GRID_PATTERN_SIZE,
  },
  petals: {
    backgroundImage: PETAL_PATTERN,
    backgroundSize: PETAL_PATTERN_SIZE,
    backgroundPosition: '0 0',
  },
};

/**
 * The three pre-refactor per-theme `appBg` gradient strings (lego, minecraft,
 * flower — from app/src/lib/theme.ts's `legoThemeBackground` /
 * `minecraftThemeBackground` / `flowerThemeBackground`), copied verbatim.
 *
 * Manifests are pure data and may only import the `ThemeManifest` type
 * (architecture.md Boundary Rules: "manifests -> (nothing but the
 * ThemeManifest type)") — so a manifest's `colors.backgroundImage` cannot
 * literally `import` these constants; S2's manifests inline the same literal
 * string instead. These exports exist so this reference value has exactly
 * one authored home (documentation / future generator-tooling reuse), not as
 * a runtime dependency edge from any manifest.
 */
export const APP_BG_GRADIENTS = {
  lego: 'linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(180deg, #ffe36e 0%, #ffd44c 100%)',
  minecraft:
    'linear-gradient(180deg, rgba(255,255,255,0.03) 50%, rgba(0,0,0,0.03) 50%), linear-gradient(90deg, rgba(255,255,255,0.03) 50%, rgba(0,0,0,0.03) 50%), linear-gradient(180deg, #7aa35a 0%, #5a7a3d 18%, #6b4b2a 18%, #6b4b2a 100%)',
  flower:
    'radial-gradient(circle at 20% 20%, rgba(255,255,255,0.55) 0 14px, transparent 15px), radial-gradient(circle at 80% 24%, rgba(255,255,255,0.45) 0 12px, transparent 13px), radial-gradient(circle at 30% 78%, rgba(255,255,255,0.4) 0 10px, transparent 11px), linear-gradient(180deg, #ffe7f1 0%, #ffd6e7 45%, #ffecc7 100%)',
} as const;
