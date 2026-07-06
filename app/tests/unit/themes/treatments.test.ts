import { describe, expect, it } from 'vitest';
import { CARD_ELEVATION, BUTTON_ELEVATION, NAV_ELEVATION, CONTENT_PANEL_STYLES } from '@/src/themes/treatments/elevation';
import { ICON_SETS, resolveIconId } from '@/src/themes/treatments/iconSets';
import { SURFACE_PATTERNS, APP_BG_GRADIENTS } from '@/src/themes/treatments/patterns';
import { DYNAMIC_GENERATORS, type StyleToken } from '@/src/themes/treatments/dynamicVisuals';

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

// S2 (dynamic-theme-visuals epic): AC-STRUCT-3 (registry shape), AC-UX-1
// (per-call non-determinism while the pinned style identity holds), and
// AC-STRUCT-6 (self-contained output) for the generator adapter + stub.
describe('themes/treatments/dynamicVisuals', () => {
  const STYLE: StyleToken = { anchorHue: 200, scheme: 'triadic', saturation: 60, lightness: 50 };

  function expectedFill(style: StyleToken): string {
    return `hsl(${style.anchorHue.toFixed(1)}, ${style.saturation.toFixed(1)}%, ${style.lightness.toFixed(1)}%)`;
  }

  it('AC-STRUCT-3: DYNAMIC_GENERATORS.watercolor exists with signature (style, kind, render?) => string and returns a non-empty string', () => {
    expect(DYNAMIC_GENERATORS.watercolor).toBeTypeOf('function');
    // Optional params still count toward JS's runtime `.length` unless
    // defaulted, so this only pins a lower bound (style + kind required).
    expect(DYNAMIC_GENERATORS.watercolor.length).toBeGreaterThanOrEqual(2);
    const result = DYNAMIC_GENERATORS.watercolor(STYLE, 'banner');
    expect(result).toBeTypeOf('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('AC-STRUCT-3: accepts an optional render knob object without throwing', () => {
    expect(() => DYNAMIC_GENERATORS.watercolor(STYLE, 'banner', { zones: 2, layerProb: 0 })).not.toThrow();
  });

  it('the forced size/format envelope (96px tall, 420px nominal width per spec.md §6/ink-channel-log.md IQ6) is NOT overridable by a caller-supplied render knob (post-impl VQ-S2-014)', () => {
    const withoutRender = DYNAMIC_GENERATORS.watercolor(STYLE, 'banner');
    const withConflictingRender = DYNAMIC_GENERATORS.watercolor(STYLE, 'banner', { width: 50, height: 50, format: { width: 9999, height: 1 } });
    const dims = (svg: string) => svg.match(/viewBox="0 0 (\d+) (\d+)"/)?.slice(1, 3);
    expect(dims(withoutRender)).toEqual(['420', '96']);
    expect(dims(withConflictingRender)).toEqual(['420', '96']);
  });

  it('AC-UX-1: two successive calls with the same pinned style return DIFFERENT svg strings (genuine non-determinism, not just distinct object identity)', () => {
    const first = DYNAMIC_GENERATORS.watercolor(STYLE, 'banner');
    const second = DYNAMIC_GENERATORS.watercolor(STYLE, 'banner');
    // Strings compare by VALUE in JS — this proves the two renders actually
    // differ in content, not merely that two separate string objects exist.
    expect(first).not.toBe(second);
  });

  it('AC-UX-1: both successive calls still reflect the pinned style identity (same base fill colour derived from anchorHue/saturation/lightness)', () => {
    const fill = expectedFill(STYLE);
    const first = DYNAMIC_GENERATORS.watercolor(STYLE, 'banner');
    const second = DYNAMIC_GENERATORS.watercolor(STYLE, 'banner');
    expect(first).toContain(fill);
    expect(second).toContain(fill);
  });

  it('AC-UX-1: a different pinned style produces a different base fill colour (identity is genuinely pinned, not ignored)', () => {
    const otherStyle: StyleToken = { anchorHue: 10, scheme: 'monochromatic', saturation: 30, lightness: 25 };
    const a = DYNAMIC_GENERATORS.watercolor(STYLE, 'banner');
    const b = DYNAMIC_GENERATORS.watercolor(otherStyle, 'banner');
    expect(a).toContain(expectedFill(STYLE));
    expect(b).toContain(expectedFill(otherStyle));
    expect(a).not.toContain(expectedFill(otherStyle));
  });

  it('AC-STRUCT-6: output never contains a <script> element, across several randomized calls', () => {
    for (let i = 0; i < 5; i++) {
      expect(DYNAMIC_GENERATORS.watercolor(STYLE, 'banner')).not.toMatch(/<script/i);
    }
  });

  it('AC-STRUCT-6: output never references an external href/url(), across several randomized calls', () => {
    for (let i = 0; i < 5; i++) {
      const svg = DYNAMIC_GENERATORS.watercolor(STYLE, 'banner');
      expect(svg).not.toMatch(/\bhref\s*=/i);
      expect(svg).not.toMatch(/url\(\s*['"]?(https?:|\/\/)/i);
    }
  });

  it('AC-STRUCT-6: output is a well-formed, self-contained SVG root element with a viewBox', () => {
    const svg = DYNAMIC_GENERATORS.watercolor(STYLE, 'banner');
    expect(svg).toMatch(/^<svg[^>]*viewBox="0 0 \d+ \d+"[^>]*>/);
    expect(svg.trim().endsWith('</svg>')).toBe(true);
  });
});
