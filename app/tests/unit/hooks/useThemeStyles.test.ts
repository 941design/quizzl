// app/tests/unit/hooks/useThemeStyles.test.ts
//
// Locks `computeThemeStyles()` — the pure core of `useThemeStyles()` —
// against FROZEN, independently hardcoded expectations (never derived from
// `treatments/elevation.ts` / `treatments/patterns.ts`, which would make
// this a tautology that can never fail). Exercises the exact manifest-driven
// lookup path `useThemeStyles()` uses at runtime (`computeThemeStyles` takes
// a real `AppThemeDefinition`, not a mock).
//
// aquarelle is the only shipped theme: its per-surface treatments are all
// `softDrop`/`none` (which resolve to empty BoxProps) and it declares no
// content panel, so every surface style is `{}` and `contentPanelStyle` is
// null. The banner-decor split contract and the manifest-content check below
// carry the real weight of this suite.
import { describe, expect, it } from 'vitest';
import { computeThemeStyles } from '@/src/hooks/useThemeStyles';
import { APP_THEMES } from '@/src/lib/theme';
import type { AppThemeName } from '@/src/lib/theme';

const THEME_IDS: AppThemeName[] = ['aquarelle'];

// FROZEN expected per-surface BoxProps, hand-authored (never read back from
// the treatments/* Records). aquarelle uses softDrop/none everywhere, which
// map to empty BoxProps, and declares no content panel.
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
  aquarelle: { card: {}, button: {}, nav: {}, surface: {}, contentPanel: null },
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

  it.each(THEME_IDS)('%s: cardStyle/buttonStyle/navStyle/surfaceStyle match the FROZEN values', (id) => {
    const result = computeThemeStyles(APP_THEMES[id]);
    expect(result.cardStyle).toEqual(FROZEN[id].card);
    expect(result.buttonStyle).toEqual(FROZEN[id].button);
    expect(result.navStyle).toEqual(FROZEN[id].nav);
    expect(result.surfaceStyle).toEqual(FROZEN[id].surface);
  });

  it.each(THEME_IDS)('%s: contentPanelStyle matches the FROZEN value (null for the light aquarelle theme)', (id) => {
    const result = computeThemeStyles(APP_THEMES[id]);
    expect(result.contentPanelStyle).toEqual(FROZEN[id].contentPanel);
  });

  it('reflects treatments: a synthetic manifest with a raw card override changes the computed cardStyle', () => {
    // Proves computeThemeStyles genuinely reads the manifest rather than
    // returning a constant — a raw override must flow into the output.
    const withOverride = {
      ...APP_THEMES.aquarelle,
      treatments: {
        ...APP_THEMES.aquarelle.treatments,
        overrides: { card: { borderWidth: '5px' } },
      },
    };
    const result = computeThemeStyles(withOverride);
    expect(result.cardStyle).toEqual({ borderWidth: '5px' });
    expect(result.cardStyle).not.toEqual(computeThemeStyles(APP_THEMES.aquarelle).cardStyle);
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

    it.each(THEME_IDS)('%s: the encoded banner content reproduces this theme\'s manifest banner SVG, proving it reflects the real manifest', (id) => {
      const { bannerDecorStyle } = computeThemeStyles(APP_THEMES[id]);
      const decoded = decodeURIComponent(bannerDecorStyle!.style.backgroundImage as string);
      const collapsedManifestBanner = APP_THEMES[id].treatments.banner.replace(/\s+/g, ' ').trim();
      // A distinctive slice of the manifest's own banner must appear in the
      // decoded data URI — not re-deriving the SUT's encoding, checking the
      // banner content matches the manifest it came from.
      expect(decoded).toContain(collapsedManifestBanner.slice(0, 80));
    });
  });
});
