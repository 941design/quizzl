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

/** Inline SVG decorations per visual style, authored as wide compositions with built-in fade. */
const BANNER_SVG: Record<string, string> = {
  soft: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 128">
      <defs>
        <linearGradient id="fade" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#ffffff" stop-opacity="1"/>
          <stop offset="0.72" stop-color="#ffffff" stop-opacity="0.9"/>
          <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
        </linearGradient>
        <linearGradient id="leafFill" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#87d7ca" stop-opacity="0.42"/>
          <stop offset="1" stop-color="#2a9d8a" stop-opacity="0.16"/>
        </linearGradient>
      </defs>
      <rect width="480" height="128" fill="url(#fade)"/>
      <path d="M24 108c0-44 24-78 76-92 26 30 39 62 39 92H24Z" fill="url(#leafFill)"/>
      <path d="M88 104c16-38 48-64 103-76-16 36-48 63-96 81" fill="#66c3b2" fill-opacity=".18"/>
      <path d="M34 106c50-10 93-39 131-87" stroke="#2a9d8a" stroke-width="4" stroke-linecap="round" stroke-opacity=".2" fill="none"/>
      <circle cx="188" cy="38" r="14" fill="#7cd0c1" fill-opacity=".18"/>
      <circle cx="226" cy="76" r="10" fill="#7cd0c1" fill-opacity=".14"/>
    </svg>
  `,
  rounded: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 128">
      <defs>
        <linearGradient id="fade" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#fff6ec" stop-opacity="1"/>
          <stop offset="0.72" stop-color="#fff6ec" stop-opacity=".92"/>
          <stop offset="1" stop-color="#fff6ec" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <rect width="480" height="128" fill="url(#fade)"/>
      <g fill="#f79a0d" fill-opacity=".18">
        <path d="M62 18 78 52l38 4-29 24 9 36-34-18-33 18 9-36L9 56l38-4 15-34Z"/>
        <circle cx="140" cy="46" r="18"/>
        <circle cx="180" cy="78" r="12" fill-opacity=".12"/>
        <path d="M118 102c18-18 43-30 74-35" stroke="#f79a0d" stroke-opacity=".18" stroke-width="6" stroke-linecap="round" fill="none"/>
      </g>
    </svg>
  `,
  toy: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 128">
      <defs>
        <linearGradient id="fade" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#fff4ef" stop-opacity="1"/>
          <stop offset="0.72" stop-color="#fff4ef" stop-opacity=".92"/>
          <stop offset="1" stop-color="#fff4ef" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <rect width="480" height="128" fill="url(#fade)"/>
      <g transform="translate(18 20)">
        <rect x="0" y="24" width="122" height="56" rx="12" fill="#f23b1f" fill-opacity=".24"/>
        <circle cx="26" cy="24" r="14" fill="#f23b1f" fill-opacity=".19"/>
        <circle cx="60" cy="24" r="14" fill="#f23b1f" fill-opacity=".19"/>
        <circle cx="94" cy="24" r="14" fill="#f23b1f" fill-opacity=".19"/>
        <rect x="78" y="0" width="82" height="42" rx="10" fill="#ffcf3c" fill-opacity=".18"/>
        <circle cx="102" cy="0" r="12" fill="#ffcf3c" fill-opacity=".15"/>
        <circle cx="136" cy="0" r="12" fill="#ffcf3c" fill-opacity=".15"/>
        <rect x="156" y="44" width="92" height="36" rx="10" fill="#2a6ef0" fill-opacity=".16"/>
        <circle cx="182" cy="44" r="11" fill="#2a6ef0" fill-opacity=".14"/>
        <circle cx="222" cy="44" r="11" fill="#2a6ef0" fill-opacity=".14"/>
      </g>
    </svg>
  `,
  pixel: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 128" shape-rendering="crispEdges">
      <defs>
        <linearGradient id="fade" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#edf4e8" stop-opacity="1"/>
          <stop offset="0.72" stop-color="#edf4e8" stop-opacity=".92"/>
          <stop offset="1" stop-color="#edf4e8" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <rect width="480" height="128" fill="url(#fade)"/>
      <g transform="translate(14 28)">
        <rect x="0" y="0" width="24" height="24" fill="#759a2f" fill-opacity=".32"/>
        <rect x="24" y="0" width="24" height="24" fill="#759a2f" fill-opacity=".24"/>
        <rect x="48" y="0" width="24" height="24" fill="#759a2f" fill-opacity=".3"/>
        <rect x="72" y="0" width="24" height="24" fill="#759a2f" fill-opacity=".22"/>
        <rect x="0" y="24" width="24" height="24" fill="#6b4b2a" fill-opacity=".24"/>
        <rect x="24" y="24" width="24" height="24" fill="#6b4b2a" fill-opacity=".3"/>
        <rect x="48" y="24" width="24" height="24" fill="#6b4b2a" fill-opacity=".22"/>
        <rect x="72" y="24" width="24" height="24" fill="#6b4b2a" fill-opacity=".28"/>
        <rect x="112" y="12" width="20" height="20" fill="#8bb64a" fill-opacity=".26"/>
        <rect x="132" y="32" width="20" height="20" fill="#8bb64a" fill-opacity=".18"/>
        <rect x="168" y="8" width="16" height="16" fill="#759a2f" fill-opacity=".18"/>
        <rect x="192" y="36" width="16" height="16" fill="#6b4b2a" fill-opacity=".18"/>
      </g>
    </svg>
  `,
  floral: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 128">
      <defs>
        <linearGradient id="fade" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#fff4f8" stop-opacity="1"/>
          <stop offset="0.72" stop-color="#fff4f8" stop-opacity=".92"/>
          <stop offset="1" stop-color="#fff4f8" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <rect width="480" height="128" fill="url(#fade)"/>
      <g transform="translate(24 10)">
        <circle cx="56" cy="26" r="20" fill="#f468a8" fill-opacity=".2"/>
        <circle cx="28" cy="48" r="20" fill="#f468a8" fill-opacity=".16"/>
        <circle cx="84" cy="48" r="20" fill="#f468a8" fill-opacity=".16"/>
        <circle cx="40" cy="78" r="20" fill="#f468a8" fill-opacity=".2"/>
        <circle cx="72" cy="78" r="20" fill="#f468a8" fill-opacity=".2"/>
        <circle cx="56" cy="54" r="12" fill="#ffbb47" fill-opacity=".26"/>
        <path d="M112 98c20-18 41-27 76-31" stroke="#d75792" stroke-width="5" stroke-linecap="round" stroke-opacity=".14" fill="none"/>
        <circle cx="150" cy="36" r="12" fill="#f7a2c8" fill-opacity=".16"/>
        <circle cx="190" cy="68" r="10" fill="#f7a2c8" fill-opacity=".12"/>
      </g>
    </svg>
  `,
};

export type BannerDecor = {
  /** Chakra layout props for the decoration element */
  boxProps: BoxProps;
  /** Native style for background-image (Chakra drops data-URI values) */
  style: React.CSSProperties;
};

function navBannerDecor(visualStyle: ThemeVisualStyle): BannerDecor | null {
  const svg = BANNER_SVG[visualStyle]?.replace(/\s+/g, ' ').trim();
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
