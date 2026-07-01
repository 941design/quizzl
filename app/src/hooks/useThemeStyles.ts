// app/src/hooks/useThemeStyles.ts
//
// Reads the active theme's per-surface treatment selectors directly off the
// manifest (architecture.md's "useThemeStyles return (AC10)" seam contract)
// and looks up their concrete BoxProps in treatments/* — S1 lifted those
// Record literals verbatim from this hook's pre-refactor per-visualStyle
// switch blocks (treatments/elevation.ts / treatments/patterns.ts headers),
// so wiring them here by `treatments.card`/`.button`/`.nav`/`.surface`/
// `.contentPanel` reproduces the exact same per-theme BoxProps as before
// (spec.md §6.3, AC-UX-1).
//
// `visualStyle` and `isFunTheme` are REMOVED from the return (architecture.md
// Implementation Constraint 3 / spec.md §6.3): both were unused by any
// consumer — grep confirmed the only site was this hook itself.
//
// Boundary Rules: useThemeStyles -> lib/theme (type only), treatments/*
// (value). Never a direct edge to registry.generated.
import type React from 'react';
import type { BoxProps } from '@chakra-ui/react';
import { useAppTheme } from '@/src/hooks/useMoodTheme';
import type { AppThemeDefinition } from '@/src/lib/theme';
import {
  CARD_ELEVATION,
  BUTTON_ELEVATION,
  NAV_ELEVATION,
  CONTENT_PANEL_STYLES,
} from '@/src/themes/treatments/elevation';
import { SURFACE_PATTERNS } from '@/src/themes/treatments/patterns';

/**
 * Themed decorative image for the nav banner top-left. `boxProps` and
 * `style` are kept as SEPARATE top-level fields — never merged into a
 * single `BoxProps` — because Chakra silently drops a data-URI
 * `backgroundImage` value when it flows through Chakra's style-prop
 * pipeline; the raw CSS `style` prop must carry it instead. Hard contract
 * (architecture.md's useThemeStyles seam note).
 */
export type BannerDecor = {
  /** Chakra layout props for the decoration element */
  boxProps: BoxProps;
  /** Native style for background-image (Chakra drops data-URI values) */
  style: React.CSSProperties;
};

/** The exact six fields useThemeStyles() returns (AC10 / AC-UX-1). */
export type ThemeStyles = {
  cardStyle: BoxProps;
  surfaceStyle: BoxProps;
  navStyle: BoxProps;
  buttonStyle: BoxProps;
  contentPanelStyle: BoxProps | null;
  bannerDecorStyle: BannerDecor | null;
};

function mergeRawOverride(base: BoxProps, override: Record<string, unknown> | undefined): BoxProps {
  return override ? { ...base, ...(override as BoxProps) } : base;
}

function navBannerDecor(bannerSvg: string): BannerDecor | null {
  const svg = bannerSvg.replace(/\s+/g, ' ').trim();
  if (!svg) return null;

  return {
    boxProps: {
      position: 'absolute',
      left: '0',
      top: '50%',
      transform: 'translateY(-50%)',
      w: 'clamp(220px, 33vw, 420px)',
      h: '96px',
      pointerEvents: 'none',
      zIndex: 0,
      opacity: 0.95,
    },
    style: {
      backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(svg)}")`,
      backgroundSize: '100% 100%',
      backgroundRepeat: 'no-repeat',
    },
  };
}

/**
 * Pure computation from a theme definition to the six consumed style
 * fields — split out from `useThemeStyles()` so the per-theme output can be
 * exercised directly (against the real manifests) without a React render
 * tree / `AppThemeProvider`. This is the exact lookup path the hook uses at
 * runtime; `useThemeStyles()` below is a thin wrapper around it.
 */
export function computeThemeStyles(definition: AppThemeDefinition): ThemeStyles {
  const { treatments, contentSurface } = definition;
  const overrides = treatments.overrides;

  const cardStyle = mergeRawOverride(CARD_ELEVATION[treatments.card], overrides?.card);
  const buttonStyle = mergeRawOverride(BUTTON_ELEVATION[treatments.button], overrides?.button);
  const navStyle = mergeRawOverride(NAV_ELEVATION[treatments.nav], overrides?.nav);
  const surfaceStyle = mergeRawOverride(SURFACE_PATTERNS[treatments.surface], overrides?.surface);
  /**
   * Present only for themes that both set `contentSurface: true` AND
   * declare a `treatments.contentPanel` (today: only minecraft) — mirrors
   * the pre-refactor `activeThemeDefinition.contentSurface ? contentPanel(vs)
   * : null` ternary, whose non-empty branch was itself gated on `vs ===
   * 'pixel'` (minecraft's sole `contentSurface:true` theme).
   */
  const contentPanelStyle =
    contentSurface && treatments.contentPanel ? CONTENT_PANEL_STYLES[treatments.contentPanel] : null;
  const bannerDecorStyle = navBannerDecor(treatments.banner);

  return { cardStyle, surfaceStyle, navStyle, buttonStyle, contentPanelStyle, bannerDecorStyle };
}

export function useThemeStyles(): ThemeStyles {
  const { activeThemeDefinition } = useAppTheme();
  return computeThemeStyles(activeThemeDefinition);
}
