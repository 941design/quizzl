import type React from 'react';
import type { BoxProps } from '@chakra-ui/react';
import { useAppTheme } from '@/src/hooks/useMoodTheme';
import type { ThemeVisualStyle } from '@/src/lib/theme';

export type { ThemeVisualStyle };

/**
 * Stud-pattern background for the "toy" visual style.
 * Uses radial-gradient to render a repeating dot grid.
 */
const STUD_PATTERN =
  'radial-gradient(circle, rgba(0,0,0,0.06) 6px, transparent 6px)';
const STUD_PATTERN_SIZE = '24px 24px';

/**
 * Pixel-grid overlay for the "pixel" visual style.
 * Creates a subtle checkerboard via conic-gradient.
 */
const GRID_PATTERN =
  'conic-gradient(rgba(0,0,0,0.03) 25%, transparent 25%, transparent 50%, rgba(0,0,0,0.03) 50%, rgba(0,0,0,0.03) 75%, transparent 75%)';
const GRID_PATTERN_SIZE = '16px 16px';
const PETAL_PATTERN =
  'radial-gradient(circle at 50% 35%, rgba(255,255,255,0.55) 0 22%, transparent 23%), radial-gradient(circle at 30% 60%, rgba(255,255,255,0.35) 0 16%, transparent 17%), radial-gradient(circle at 70% 60%, rgba(255,255,255,0.35) 0 16%, transparent 17%)';
const PETAL_PATTERN_SIZE = '64px 64px';

function surfaceOverlay(visualStyle: ThemeVisualStyle): BoxProps {
  switch (visualStyle) {
    case 'toy':
      return {
        backgroundImage: STUD_PATTERN,
        backgroundSize: STUD_PATTERN_SIZE,
        backgroundPosition: '12px 12px',
      };
    case 'pixel':
      return {
        backgroundImage: GRID_PATTERN,
        backgroundSize: GRID_PATTERN_SIZE,
      };
    case 'floral':
      return {
        backgroundImage: PETAL_PATTERN,
        backgroundSize: PETAL_PATTERN_SIZE,
        backgroundPosition: '0 0',
      };
    default:
      return {};
  }
}

function cardOverlay(visualStyle: ThemeVisualStyle): BoxProps {
  switch (visualStyle) {
    case 'toy':
      return {
        boxShadow: '0 4px 0 0 rgba(0,0,0,0.12)',
        borderWidth: '2px',
        transition: 'transform 0.15s, box-shadow 0.15s, border-color 0.2s',
        _hover: {
          transform: 'translateY(-2px)',
          boxShadow: '0 6px 0 0 rgba(0,0,0,0.12)',
        },
      };
    case 'pixel':
      return {
        boxShadow:
          'inset -2px -2px 0 rgba(0,0,0,0.15), inset 2px 2px 0 rgba(255,255,255,0.25)',
        borderWidth: '3px',
        borderStyle: 'solid',
        transition: 'border-color 0.1s',
      };
    case 'floral':
      return {
        boxShadow: '0 14px 28px -22px rgba(155, 71, 113, 0.45)',
        borderWidth: '1px',
        borderStyle: 'solid',
        transition: 'transform 0.18s ease, box-shadow 0.18s ease, border-color 0.2s ease',
        _hover: {
          transform: 'translateY(-2px)',
          boxShadow: '0 18px 30px -22px rgba(155, 71, 113, 0.52)',
        },
      };
    default:
      return {};
  }
}

function buttonOverlay(visualStyle: ThemeVisualStyle): BoxProps {
  switch (visualStyle) {
    case 'toy':
      return {
        boxShadow: '0 3px 0 0 rgba(0,0,0,0.15)',
        fontWeight: '700',
        _hover: {
          transform: 'translateY(-1px)',
          boxShadow: '0 4px 0 0 rgba(0,0,0,0.15)',
        },
        _active: {
          transform: 'translateY(2px)',
          boxShadow: '0 1px 0 0 rgba(0,0,0,0.15)',
        },
      };
    case 'pixel':
      return {
        boxShadow:
          'inset -2px -2px 0 rgba(0,0,0,0.2), inset 2px 2px 0 rgba(255,255,255,0.2)',
        borderRadius: '2px',
        _active: {
          boxShadow:
            'inset 2px 2px 0 rgba(0,0,0,0.2), inset -2px -2px 0 rgba(255,255,255,0.2)',
        },
      };
    case 'floral':
      return {
        boxShadow: '0 10px 18px -14px rgba(155, 71, 113, 0.55)',
        borderRadius: '9999px',
        fontWeight: '700',
        _hover: {
          transform: 'translateY(-1px) scale(1.01)',
          boxShadow: '0 14px 22px -14px rgba(155, 71, 113, 0.6)',
        },
        _active: {
          transform: 'translateY(1px)',
          boxShadow: '0 6px 12px -10px rgba(155, 71, 113, 0.5)',
        },
      };
    default:
      return {};
  }
}

function navOverlay(visualStyle: ThemeVisualStyle): BoxProps {
  switch (visualStyle) {
    case 'toy':
      return {
        borderBottomWidth: '3px',
        boxShadow: '0 2px 0 0 rgba(0,0,0,0.08)',
      };
    case 'pixel':
      return {
        borderBottomWidth: '3px',
        boxShadow: 'inset 0 -2px 0 rgba(0,0,0,0.1)',
      };
    case 'floral':
      return {
        borderBottomWidth: '1px',
        boxShadow: '0 8px 24px -24px rgba(155, 71, 113, 0.55)',
        backdropFilter: 'saturate(1.1)',
      };
    default:
      return {};
  }
}

/** Base64-encoded inline SVG decorations per visual style. */
const BANNER_SVG: Record<string, string> = {
  // Teal leaf silhouette
  soft: 'PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCA2NCA2NCc+PHBhdGggZD0nTTggNTZDOCAyNCAyNCA4IDU2IDhDNTYgNDAgNDAgNTYgOCA1NlonIGZpbGw9JyMyYTlkOGEnIG9wYWNpdHk9JzAuMTgnLz48cGF0aCBkPSdNOCA1NlEzMiAzMiA1NiA4JyBzdHJva2U9JyMyYTlkOGEnIHN0cm9rZS13aWR0aD0nMS41JyBmaWxsPSdub25lJyBvcGFjaXR5PScwLjI1Jy8+PC9zdmc+',
  // Warm orange star
  rounded: 'PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCA2NCA2NCc+PHBvbHlnb24gcG9pbnRzPSczMiw0IDM4LDI0IDU4LDI0IDQyLDM2IDQ4LDU2IDMyLDQ0IDE2LDU2IDIyLDM2IDYsMjQgMjYsMjQnIGZpbGw9JyNmNzlhMGQnIG9wYWNpdHk9JzAuMTgnLz48L3N2Zz4=',
  // Red 2-stud building brick
  toy: 'PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCA2NCA1Nic+PHJlY3QgeD0nNCcgeT0nMTYnIHdpZHRoPSc1NicgaGVpZ2h0PSczNicgcng9JzMnIGZpbGw9JyNmMjNiMWYnIG9wYWNpdHk9JzAuMjInLz48Y2lyY2xlIGN4PScxOCcgY3k9JzE2JyByPSc2JyBmaWxsPScjZjIzYjFmJyBvcGFjaXR5PScwLjE4Jy8+PGNpcmNsZSBjeD0nNDYnIGN5PScxNicgcj0nNicgZmlsbD0nI2YyM2IxZicgb3BhY2l0eT0nMC4xOCcvPjwvc3ZnPg==',
  // Pixel grass/dirt block
  pixel: 'PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCA0MCAzMCc+PHJlY3QgeD0nMCcgeT0nMCcgd2lkdGg9JzEwJyBoZWlnaHQ9JzEwJyBmaWxsPScjNzU5YTJmJyBvcGFjaXR5PScwLjI4Jy8+PHJlY3QgeD0nMTAnIHk9JzAnIHdpZHRoPScxMCcgaGVpZ2h0PScxMCcgZmlsbD0nIzc1OWEyZicgb3BhY2l0eT0nMC4yJy8+PHJlY3QgeD0nMjAnIHk9JzAnIHdpZHRoPScxMCcgaGVpZ2h0PScxMCcgZmlsbD0nIzc1OWEyZicgb3BhY2l0eT0nMC4yNCcvPjxyZWN0IHg9JzMwJyB5PScwJyB3aWR0aD0nMTAnIGhlaWdodD0nMTAnIGZpbGw9JyM3NTlhMmYnIG9wYWNpdHk9JzAuMTgnLz48cmVjdCB4PScwJyB5PScxMCcgd2lkdGg9JzEwJyBoZWlnaHQ9JzEwJyBmaWxsPScjNmI0YjJhJyBvcGFjaXR5PScwLjInLz48cmVjdCB4PScxMCcgeT0nMTAnIHdpZHRoPScxMCcgaGVpZ2h0PScxMCcgZmlsbD0nIzZiNGIyYScgb3BhY2l0eT0nMC4yNCcvPjxyZWN0IHg9JzIwJyB5PScxMCcgd2lkdGg9JzEwJyBoZWlnaHQ9JzEwJyBmaWxsPScjNmI0YjJhJyBvcGFjaXR5PScwLjE4Jy8+PHJlY3QgeD0nMzAnIHk9JzEwJyB3aWR0aD0nMTAnIGhlaWdodD0nMTAnIGZpbGw9JyM2YjRiMmEnIG9wYWNpdHk9JzAuMjInLz48cmVjdCB4PScwJyB5PScyMCcgd2lkdGg9JzEwJyBoZWlnaHQ9JzEwJyBmaWxsPScjNmI0YjJhJyBvcGFjaXR5PScwLjE4Jy8+PHJlY3QgeD0nMTAnIHk9JzIwJyB3aWR0aD0nMTAnIGhlaWdodD0nMTAnIGZpbGw9JyM2YjRiMmEnIG9wYWNpdHk9JzAuMjInLz48cmVjdCB4PScyMCcgeT0nMjAnIHdpZHRoPScxMCcgaGVpZ2h0PScxMCcgZmlsbD0nIzZiNGIyYScgb3BhY2l0eT0nMC4yNCcvPjxyZWN0IHg9JzMwJyB5PScyMCcgd2lkdGg9JzEwJyBoZWlnaHQ9JzEwJyBmaWxsPScjNmI0YjJhJyBvcGFjaXR5PScwLjE4Jy8+PC9zdmc+',
  // Five-petal flower with centre
  floral: 'PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCA2NCA2NCc+PGNpcmNsZSBjeD0nMzInIGN5PScxNCcgcj0nMTAnIGZpbGw9JyNmNDY4YTgnIG9wYWNpdHk9JzAuMicvPjxjaXJjbGUgY3g9JzE3JyBjeT0nMjYnIHI9JzEwJyBmaWxsPScjZjQ2OGE4JyBvcGFjaXR5PScwLjE2Jy8+PGNpcmNsZSBjeD0nNDcnIGN5PScyNicgcj0nMTAnIGZpbGw9JyNmNDY4YTgnIG9wYWNpdHk9JzAuMTYnLz48Y2lyY2xlIGN4PScyMScgY3k9JzQyJyByPScxMCcgZmlsbD0nI2Y0NjhhOCcgb3BhY2l0eT0nMC4yJy8+PGNpcmNsZSBjeD0nNDMnIGN5PSc0Micgcj0nMTAnIGZpbGw9JyNmNDY4YTgnIG9wYWNpdHk9JzAuMicvPjxjaXJjbGUgY3g9JzMyJyBjeT0nMzAnIHI9JzYnIGZpbGw9JyNmZmJiNDcnIG9wYWNpdHk9JzAuMjgnLz48L3N2Zz4=',
};

export type BannerDecor = {
  /** Chakra layout props for the decoration element */
  boxProps: BoxProps;
  /** Native style for background-image (Chakra drops data-URI values) */
  style: React.CSSProperties;
};

function navBannerDecor(visualStyle: ThemeVisualStyle): BannerDecor | null {
  const b64 = BANNER_SVG[visualStyle];
  if (!b64) return null;

  return {
    boxProps: {
      position: 'absolute',
      left: '6px',
      top: '50%',
      transform: 'translateY(-50%)',
      w: '72px',
      h: '72px',
      pointerEvents: 'none',
      zIndex: 0,
    },
    style: {
      backgroundImage: `url("data:image/svg+xml;base64,${b64}")`,
      backgroundSize: 'contain',
      backgroundRepeat: 'no-repeat',
    },
  };
}

export function useThemeStyles() {
  const { activeThemeDefinition } = useAppTheme();
  const vs = activeThemeDefinition.visualStyle;

  return {
    visualStyle: vs,
    /** Spread onto card / panel Box elements for themed elevation */
    cardStyle: cardOverlay(vs),
    /** Spread onto large surface areas for pattern overlay */
    surfaceStyle: surfaceOverlay(vs),
    /** Extra props for primary action buttons */
    buttonStyle: buttonOverlay(vs),
    /** Extra props for the nav bar */
    navStyle: navOverlay(vs),
    /** Whether the current theme is a "fun" theme (toy or pixel) */
    isFunTheme: vs === 'toy' || vs === 'pixel' || vs === 'floral',
    /** Themed decorative image for the nav banner top-left */
    bannerDecorStyle: navBannerDecor(vs),
  };
}
