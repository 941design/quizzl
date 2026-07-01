// app/src/themes/treatments/elevation.ts
//
// Independent per-surface named elevation prop-sets (architecture.md Module
// Map / Implementation Constraint 2). Each of a manifest's `treatments.card`,
// `treatments.button`, `treatments.nav` selects one `ElevationName`
// independently — this is NOT a single bundled "elevation" (Round 2 BC7/D2).
//
// Lifted unchanged from the per-surface switch blocks in
// app/src/hooks/useThemeStyles.ts (cardOverlay/buttonOverlay/navOverlay,
// lines ~51-176 pre-refactor): `toy` -> hardDrop, `pixel` -> pixelBevel,
// `floral` -> floralGlow. The pre-refactor `soft`/`rounded` visual styles
// both resolved to an empty BoxProps ({}); they map onto two distinct new
// names — `flat` (calm) and `softDrop` (playful) — reserved as genuinely
// distinct treatments for future themes even though today they render
// identically to each other (byte-identical parity is unaffected: both
// still produce {}).
//
// Type-only Chakra import per architecture.md Boundary Rules
// (treatments/* -> @chakra-ui/react BoxProps type only).
import type { BoxProps } from '@chakra-ui/react';

export type ElevationName = 'flat' | 'softDrop' | 'hardDrop' | 'pixelBevel' | 'floralGlow';

const EMPTY: BoxProps = {};

export const CARD_ELEVATION: Record<ElevationName, BoxProps> = {
  flat: EMPTY,
  softDrop: EMPTY,
  hardDrop: {
    boxShadow: '0 4px 0 0 rgba(0,0,0,0.12)',
    borderWidth: '2px',
    transition: 'transform 0.15s, box-shadow 0.15s, border-color 0.2s',
    _hover: {
      transform: 'translateY(-2px)',
      boxShadow: '0 6px 0 0 rgba(0,0,0,0.12)',
    },
  },
  pixelBevel: {
    boxShadow: 'inset -2px -2px 0 rgba(0,0,0,0.15), inset 2px 2px 0 rgba(255,255,255,0.25)',
    borderWidth: '3px',
    borderStyle: 'solid',
    transition: 'border-color 0.1s',
  },
  floralGlow: {
    boxShadow: '0 14px 28px -22px rgba(155, 71, 113, 0.45)',
    borderWidth: '1px',
    borderStyle: 'solid',
    transition: 'transform 0.18s ease, box-shadow 0.18s ease, border-color 0.2s ease',
    _hover: {
      transform: 'translateY(-2px)',
      boxShadow: '0 18px 30px -22px rgba(155, 71, 113, 0.52)',
    },
  },
};

export const BUTTON_ELEVATION: Record<ElevationName, BoxProps> = {
  flat: EMPTY,
  softDrop: EMPTY,
  hardDrop: {
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
  },
  pixelBevel: {
    boxShadow: 'inset -2px -2px 0 rgba(0,0,0,0.2), inset 2px 2px 0 rgba(255,255,255,0.2)',
    borderRadius: '2px',
    _active: {
      boxShadow: 'inset 2px 2px 0 rgba(0,0,0,0.2), inset -2px -2px 0 rgba(255,255,255,0.2)',
    },
  },
  floralGlow: {
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
  },
};

export const NAV_ELEVATION: Record<ElevationName, BoxProps> = {
  flat: EMPTY,
  softDrop: EMPTY,
  hardDrop: {
    borderBottomWidth: '3px',
    boxShadow: '0 2px 0 0 rgba(0,0,0,0.08)',
  },
  pixelBevel: {
    borderBottomWidth: '3px',
    boxShadow: 'inset 0 -2px 0 rgba(0,0,0,0.1)',
  },
  floralGlow: {
    borderBottomWidth: '1px',
    boxShadow: '0 8px 24px -24px rgba(155, 71, 113, 0.55)',
    backdropFilter: 'saturate(1.1)',
  },
};

/**
 * The "GUI panel" content-surface treatment (a light panel floated above a
 * dark themed background so light-surface-tuned text tokens stay legible —
 * see architecture.md's `contentSurface` field and useThemeStyles.ts's old
 * `contentPanel()`, whose only non-empty case was `pixel`/minecraft). Only
 * one named variant exists today; more may be added as new themes need
 * distinct panel treatments.
 */
export type ContentPanelName = 'panel';

export const CONTENT_PANEL_STYLES: Record<ContentPanelName, BoxProps> = {
  panel: {
    bg: 'surfaceBg',
    borderWidth: '3px',
    borderStyle: 'solid',
    borderColor: 'borderStrong',
    borderRadius: 'md',
    boxShadow: 'inset -3px -3px 0 rgba(0,0,0,0.18), inset 3px 3px 0 rgba(255,255,255,0.45)',
    px: { base: 4, md: 8 },
    py: { base: 5, md: 8 },
  },
};
