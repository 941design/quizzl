import { describe, expect, it } from 'vitest';
import { CARD_ELEVATION, BUTTON_ELEVATION, NAV_ELEVATION, CONTENT_PANEL_STYLES } from '@/src/themes/treatments/elevation';
import { ICON_SETS, resolveIconId } from '@/src/themes/treatments/iconSets';
import { SURFACE_PATTERNS, APP_BG_GRADIENTS } from '@/src/themes/treatments/patterns';

describe('themes/treatments/elevation', () => {
  it('resolves every ElevationName to a BoxProps object for each surface map', () => {
    const names = ['flat', 'softDrop', 'hardDrop', 'pixelBevel', 'floralGlow'] as const;
    for (const name of names) {
      expect(CARD_ELEVATION[name]).toBeTypeOf('object');
      expect(BUTTON_ELEVATION[name]).toBeTypeOf('object');
      expect(NAV_ELEVATION[name]).toBeTypeOf('object');
    }
  });

  it('flat and softDrop both resolve to an empty BoxProps (pre-refactor soft/rounded parity)', () => {
    expect(CARD_ELEVATION.flat).toEqual({});
    expect(CARD_ELEVATION.softDrop).toEqual({});
    expect(BUTTON_ELEVATION.flat).toEqual({});
    expect(NAV_ELEVATION.softDrop).toEqual({});
  });

  it('hardDrop/pixelBevel/floralGlow are non-empty and distinct from each other', () => {
    expect(Object.keys(CARD_ELEVATION.hardDrop).length).toBeGreaterThan(0);
    expect(Object.keys(CARD_ELEVATION.pixelBevel).length).toBeGreaterThan(0);
    expect(Object.keys(CARD_ELEVATION.floralGlow).length).toBeGreaterThan(0);
    expect(CARD_ELEVATION.hardDrop).not.toEqual(CARD_ELEVATION.pixelBevel);
    expect(CARD_ELEVATION.pixelBevel).not.toEqual(CARD_ELEVATION.floralGlow);
  });

  it('exposes a non-empty "panel" content-panel treatment', () => {
    expect(CONTENT_PANEL_STYLES.panel).toBeTypeOf('object');
    expect(Object.keys(CONTENT_PANEL_STYLES.panel).length).toBeGreaterThan(0);
  });
});

describe('themes/treatments/iconSets', () => {
  it('resolves a known icon name to its per-set iconify id', () => {
    expect(resolveIconId('heart', 'line')).toBe('ph:heart-bold');
    expect(resolveIconId('heart', 'filled')).toBe('ph:heart-fill');
    expect(resolveIconId('heart', 'pixel')).toBe('pixelarticons:heart');
  });

  it('every mapped icon name has all three sets defined', () => {
    for (const entry of Object.values(ICON_SETS)) {
      expect(entry.line).toBeTruthy();
      expect(entry.filled).toBeTruthy();
      expect(entry.pixel).toBeTruthy();
    }
  });

  it('returns an empty string for an unknown icon name', () => {
    expect(resolveIconId('does-not-exist', 'line')).toBe('');
  });
});

describe('themes/treatments/patterns', () => {
  it('resolves every SurfacePatternName to a BoxProps object', () => {
    const names = ['none', 'studs', 'grid', 'petals'] as const;
    for (const name of names) {
      expect(SURFACE_PATTERNS[name]).toBeTypeOf('object');
    }
  });

  it('"none" is an empty BoxProps; the others are non-empty and distinct', () => {
    expect(SURFACE_PATTERNS.none).toEqual({});
    expect(Object.keys(SURFACE_PATTERNS.studs).length).toBeGreaterThan(0);
    expect(Object.keys(SURFACE_PATTERNS.grid).length).toBeGreaterThan(0);
    expect(Object.keys(SURFACE_PATTERNS.petals).length).toBeGreaterThan(0);
    expect(SURFACE_PATTERNS.studs).not.toEqual(SURFACE_PATTERNS.grid);
  });

  it('exposes the three pre-refactor appBg gradient strings verbatim', () => {
    expect(APP_BG_GRADIENTS.lego).toContain('#ffd44c');
    expect(APP_BG_GRADIENTS.minecraft).toContain('#6b4b2a');
    expect(APP_BG_GRADIENTS.flower).toContain('#ffe7f1');
  });
});
