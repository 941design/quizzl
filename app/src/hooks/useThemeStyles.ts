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
  };
}
