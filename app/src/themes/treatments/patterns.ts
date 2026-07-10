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
