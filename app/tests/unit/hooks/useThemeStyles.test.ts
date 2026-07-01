// app/tests/unit/hooks/useThemeStyles.test.ts
//
// S4 (AC-UX-1 / AC10): locks `computeThemeStyles()` — the pure core of
// `useThemeStyles()` — against FROZEN, independently hardcoded pre-refactor
// expectations (never derived from `treatments/elevation.ts` /
// `treatments/patterns.ts`, which would make this a tautology that can
// never fail; mirrors the FROZEN-map pattern the deleted
// `compatBridge.test.ts` used). Exercises the exact manifest-driven lookup
// path `useThemeStyles()` uses at runtime (`computeThemeStyles` takes a real
// `AppThemeDefinition`, not a mock), satisfying VQ-S4-007's "real rendered
// style objects rather than mocking the hook itself".
import { describe, expect, it } from 'vitest';
import { computeThemeStyles } from '@/src/hooks/useThemeStyles';
import { APP_THEMES } from '@/src/lib/theme';
import type { AppThemeName } from '@/src/lib/theme';

const THEME_IDS: AppThemeName[] = ['calm', 'playful', 'lego', 'minecraft', 'flower'];

const STUD_PATTERN = 'radial-gradient(circle, rgba(0,0,0,0.06) 6px, transparent 6px)';
const GRID_PATTERN =
  'conic-gradient(rgba(0,0,0,0.03) 25%, transparent 25%, transparent 50%, rgba(0,0,0,0.03) 50%, rgba(0,0,0,0.03) 75%, transparent 75%)';
const PETAL_PATTERN =
  'radial-gradient(circle at 50% 35%, rgba(255,255,255,0.55) 0 22%, transparent 23%), radial-gradient(circle at 30% 60%, rgba(255,255,255,0.35) 0 16%, transparent 17%), radial-gradient(circle at 70% 60%, rgba(255,255,255,0.35) 0 16%, transparent 17%)';

// FROZEN pre-refactor per-theme BoxProps, hand-copied from useThemeStyles.ts's
// pre-S4 cardOverlay/buttonOverlay/navOverlay/surfaceOverlay/contentPanel
// switch blocks (git history), keyed by theme id via the old
// soft/rounded/toy/pixel/floral visualStyle mapping (calm=soft,
// playful=rounded, lego=toy, minecraft=pixel, flower=floral).
const FROZEN: Record<
  AppThemeName,
  {
    card: Record<string, unknown>;
    button: Record<string, unknown>;
    nav: Record<string, unknown>;
    surface: Record<string, unknown>;
    contentPanel: Record<string, unknown> | null;
  }
> = {
  calm: { card: {}, button: {}, nav: {}, surface: {}, contentPanel: null },
  playful: { card: {}, button: {}, nav: {}, surface: {}, contentPanel: null },
  lego: {
    card: {
      boxShadow: '0 4px 0 0 rgba(0,0,0,0.12)',
      borderWidth: '2px',
      transition: 'transform 0.15s, box-shadow 0.15s, border-color 0.2s',
      _hover: { transform: 'translateY(-2px)', boxShadow: '0 6px 0 0 rgba(0,0,0,0.12)' },
    },
    button: {
      boxShadow: '0 3px 0 0 rgba(0,0,0,0.15)',
      fontWeight: '700',
      _hover: { transform: 'translateY(-1px)', boxShadow: '0 4px 0 0 rgba(0,0,0,0.15)' },
      _active: { transform: 'translateY(2px)', boxShadow: '0 1px 0 0 rgba(0,0,0,0.15)' },
    },
    nav: { borderBottomWidth: '3px', boxShadow: '0 2px 0 0 rgba(0,0,0,0.08)' },
    surface: { backgroundImage: STUD_PATTERN, backgroundSize: '24px 24px', backgroundPosition: '12px 12px' },
    contentPanel: null,
  },
  minecraft: {
    card: {
      boxShadow: 'inset -2px -2px 0 rgba(0,0,0,0.15), inset 2px 2px 0 rgba(255,255,255,0.25)',
      borderWidth: '3px',
      borderStyle: 'solid',
      transition: 'border-color 0.1s',
    },
    button: {
      boxShadow: 'inset -2px -2px 0 rgba(0,0,0,0.2), inset 2px 2px 0 rgba(255,255,255,0.2)',
      borderRadius: '2px',
      _active: { boxShadow: 'inset 2px 2px 0 rgba(0,0,0,0.2), inset -2px -2px 0 rgba(255,255,255,0.2)' },
    },
    nav: { borderBottomWidth: '3px', boxShadow: 'inset 0 -2px 0 rgba(0,0,0,0.1)' },
    surface: { backgroundImage: GRID_PATTERN, backgroundSize: '16px 16px' },
    contentPanel: {
      bg: 'surfaceBg',
      borderWidth: '3px',
      borderStyle: 'solid',
      borderColor: 'borderStrong',
      borderRadius: 'md',
      boxShadow: 'inset -3px -3px 0 rgba(0,0,0,0.18), inset 3px 3px 0 rgba(255,255,255,0.45)',
      px: { base: 4, md: 8 },
      py: { base: 5, md: 8 },
    },
  },
  flower: {
    card: {
      boxShadow: '0 14px 28px -22px rgba(155, 71, 113, 0.45)',
      borderWidth: '1px',
      borderStyle: 'solid',
      transition: 'transform 0.18s ease, box-shadow 0.18s ease, border-color 0.2s ease',
      _hover: { transform: 'translateY(-2px)', boxShadow: '0 18px 30px -22px rgba(155, 71, 113, 0.52)' },
    },
    button: {
      boxShadow: '0 10px 18px -14px rgba(155, 71, 113, 0.55)',
      borderRadius: '9999px',
      fontWeight: '700',
      _hover: { transform: 'translateY(-1px) scale(1.01)', boxShadow: '0 14px 22px -14px rgba(155, 71, 113, 0.6)' },
      _active: { transform: 'translateY(1px)', boxShadow: '0 6px 12px -10px rgba(155, 71, 113, 0.5)' },
    },
    nav: {
      borderBottomWidth: '1px',
      boxShadow: '0 8px 24px -24px rgba(155, 71, 113, 0.55)',
      backdropFilter: 'saturate(1.1)',
    },
    surface: { backgroundImage: PETAL_PATTERN, backgroundSize: '64px 64px', backgroundPosition: '0 0' },
    contentPanel: null,
  },
};

// A hex color unique to each theme's original BANNER_SVG (pre-refactor
// useThemeStyles.ts), used to prove the banner content genuinely varies per
// theme without re-deriving the SUT's own encoding logic.
const BANNER_FINGERPRINT: Record<AppThemeName, string> = {
  calm: '#87d7ca',
  playful: '#f79a0d',
  lego: '#f23b1f',
  minecraft: '#759a2f',
  flower: '#f468a8',
};

describe('computeThemeStyles (AC-UX-1 / AC10): byte-identical per-theme BoxProps', () => {
  it.each(THEME_IDS)('%s: returns exactly the six ThemeStyles fields, no visualStyle/isFunTheme', (id) => {
    const result = computeThemeStyles(APP_THEMES[id]);
    expect(Object.keys(result).sort()).toEqual(
      ['bannerDecorStyle', 'buttonStyle', 'cardStyle', 'contentPanelStyle', 'navStyle', 'surfaceStyle'].sort()
    );
    expect(result).not.toHaveProperty('visualStyle');
    expect(result).not.toHaveProperty('isFunTheme');
  });

  it.each(THEME_IDS)('%s: cardStyle/buttonStyle/navStyle/surfaceStyle match the FROZEN pre-refactor values', (id) => {
    const result = computeThemeStyles(APP_THEMES[id]);
    expect(result.cardStyle).toEqual(FROZEN[id].card);
    expect(result.buttonStyle).toEqual(FROZEN[id].button);
    expect(result.navStyle).toEqual(FROZEN[id].nav);
    expect(result.surfaceStyle).toEqual(FROZEN[id].surface);
  });

  it.each(THEME_IDS)('%s: contentPanelStyle matches the FROZEN value (non-null only for minecraft)', (id) => {
    const result = computeThemeStyles(APP_THEMES[id]);
    expect(result.contentPanelStyle).toEqual(FROZEN[id].contentPanel);
  });

  it('genuinely varies per theme: lego and minecraft cardStyle are non-empty and distinct from each other and from calm', () => {
    const lego = computeThemeStyles(APP_THEMES.lego);
    const minecraft = computeThemeStyles(APP_THEMES.minecraft);
    const calm = computeThemeStyles(APP_THEMES.calm);
    expect(Object.keys(lego.cardStyle).length).toBeGreaterThan(0);
    expect(Object.keys(minecraft.cardStyle).length).toBeGreaterThan(0);
    expect(lego.cardStyle).not.toEqual(minecraft.cardStyle);
    expect(lego.cardStyle).not.toEqual(calm.cardStyle);
  });

  describe('bannerDecorStyle: boxProps/style split hard contract', () => {
    it.each(THEME_IDS)('%s: boxProps is the fixed decoration-position object and never carries backgroundImage', (id) => {
      const { bannerDecorStyle } = computeThemeStyles(APP_THEMES[id]);
      expect(bannerDecorStyle).not.toBeNull();
      expect(bannerDecorStyle!.boxProps).toEqual({
        position: 'absolute',
        left: '0',
        top: '50%',
        transform: 'translateY(-50%)',
        w: 'clamp(220px, 33vw, 420px)',
        h: '96px',
        pointerEvents: 'none',
        zIndex: 0,
        opacity: 0.95,
      });
      expect(bannerDecorStyle!.boxProps).not.toHaveProperty('backgroundImage');
    });

    it.each(THEME_IDS)('%s: style carries the data-URI backgroundImage, distinct top-level object from boxProps', (id) => {
      const { bannerDecorStyle } = computeThemeStyles(APP_THEMES[id]);
      expect(bannerDecorStyle!.style.backgroundImage).toMatch(/^url\("data:image\/svg\+xml,/);
      expect(bannerDecorStyle!.style.backgroundSize).toBe('100% 100%');
      expect(bannerDecorStyle!.style.backgroundRepeat).toBe('no-repeat');
      // Split contract: boxProps and style are two separate top-level keys,
      // never merged into one BoxProps (Chakra drops data-URI
      // backgroundImage when merged — architecture.md hard contract).
      expect(bannerDecorStyle).toHaveProperty('boxProps');
      expect(bannerDecorStyle).toHaveProperty('style');
      expect((bannerDecorStyle!.boxProps as Record<string, unknown>).style).toBeUndefined();
    });

    it.each(THEME_IDS)('%s: the encoded banner content contains this theme\'s unique fingerprint color, proving real per-theme variance', (id) => {
      const { bannerDecorStyle } = computeThemeStyles(APP_THEMES[id]);
      const decoded = decodeURIComponent(bannerDecorStyle!.style.backgroundImage as string);
      expect(decoded).toContain(BANNER_FINGERPRINT[id]);
      for (const otherId of THEME_IDS) {
        if (otherId === id) continue;
        expect(decoded).not.toContain(BANNER_FINGERPRINT[otherId]);
      }
    });
  });
});
