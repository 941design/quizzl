import { describe, expect, it } from 'vitest';
import { CARD_ELEVATION, BUTTON_ELEVATION, NAV_ELEVATION, CONTENT_PANEL_STYLES } from '@/src/themes/treatments/elevation';
import { ICON_SETS, resolveIconId } from '@/src/themes/treatments/iconSets';
import { SURFACE_PATTERNS, APP_BG_GRADIENTS } from '@/src/themes/treatments/patterns';
import { DYNAMIC_GENERATORS, type StyleToken } from '@/src/themes/treatments/dynamicVisuals';
import { manifest as aquarelleManifest } from '@/src/themes/aquarelle/manifest';

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
// Re-verified by S7 (Phase B) against the real `@rotheric/visuals` package
// (architecture.md Seam Contracts: "the same invariant must hold against the
// real @rotheric/visuals renderSVG call").
//
// AC-UX-1's "reflects the pinned style identity" checks below were rewritten
// for S7 (VQ-S7-009 / VQ-S7-004): the Phase A stub emitted a literal
// `hsl(hue, sat%, light%)` string using the pinned values verbatim, so an
// exact-substring match worked. The real package's engine draws each zone's
// fill from `hsla(hue sat% light% / alpha)` (CSS Color 4 space-separated
// syntax, not the stub's comma syntax) with the hue/saturation/lightness
// JITTERED per zone around the pinned values (scheme-dependent offsets,
// composition randomness) — confirmed empirically against the real package
// during S7 (worst observed offset across 6 schemes x 8 anchors x 5 trials
// was ~33 degrees, for `analogous`). An exact-string match against the real
// package would either be flaky (fails the moment the engine's internal
// jitter/offset formula changes, even though the identity invariant still
// holds) or wrong (never matches at all). The rewritten checks instead
// extract every zone's hue via regex (Boundary Rule 8: lightweight
// string/regex matching, no SVG parser) and assert the CLOSEST one is within
// a generous tolerance of the pinned `anchorHue` — this is a real assertion
// against the actual package's output (not a mock), robust to composition
// jitter, and still fails if the pinned style stops flowing through at all.
describe('themes/treatments/dynamicVisuals', () => {
  const STYLE: StyleToken = { anchorHue: 200, scheme: 'triadic', saturation: 60, lightness: 50 };

  /** Generous tolerance for "reflects the pinned identity" (see header comment above): the
   * real package's per-zone hue is jittered around `anchorHue` by a scheme-dependent offset;
   * the worst offset observed empirically across all 6 schemes was ~33 degrees. 45 leaves
   * comfortable margin against flakiness while still being far smaller than the ~170-degree
   * gap between the two anchorHue values this suite's fixtures use (200 vs 10). */
  const HUE_IDENTITY_TOLERANCE_DEG = 45;

  /** Extracts every zone fill hue from an `hsla(hue sat% light% / alpha)` real-package SVG
   * string. Regex-only (Boundary Rule 8), mirroring the existing lightweight string-matching
   * convention used elsewhere in this file (no SVG parser). */
  function extractHues(svg: string): number[] {
    return [...svg.matchAll(/hsla\(([\d.]+)\s/g)].map((m) => parseFloat(m[1]));
  }

  /** Smallest circular (mod-360) distance from any extracted hue to `anchorHue`. */
  function closestHueDistance(hues: number[], anchorHue: number): number {
    return Math.min(
      ...hues.map((h) => {
        const d = Math.abs(h - anchorHue);
        return Math.min(d, 360 - d);
      })
    );
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

  it('width AND height are dynamic (full-header banner) — absent -> default 420x96, both measured dims honored, a lone dimension ignored, out-of-range falls back, a conflicting `format` ignored', () => {
    const dims = (svg: string) => svg.match(/viewBox="0 0 (\d+) (\d+)"/)?.slice(1, 3);
    // No caller size -> default 420x96 (the frozen static fallback's own size).
    expect(dims(DYNAMIC_GENERATORS.watercolor(STYLE, 'banner'))).toEqual(['420', '96']);
    // Both measured dims honored exactly (e.g. a full-width header 1280x64);
    // a conflicting `format` is ignored.
    expect(dims(DYNAMIC_GENERATORS.watercolor(STYLE, 'banner', { width: 1280, height: 64, format: { width: 9, height: 9 } }))).toEqual(['1280', '64']);
    // A lone dimension (width without height, or vice versa) is ignored -> default.
    expect(dims(DYNAMIC_GENERATORS.watercolor(STYLE, 'banner', { width: 330 }))).toEqual(['420', '96']);
    // Out-of-range (non-positive / above MAX_DIMENSION) falls back to default.
    expect(dims(DYNAMIC_GENERATORS.watercolor(STYLE, 'banner', { width: 99999, height: 64 }))).toEqual(['420', '96']);
  });

  it('AC-UX-1: two successive calls with the same pinned style return DIFFERENT svg strings (genuine non-determinism, not just distinct object identity)', () => {
    const first = DYNAMIC_GENERATORS.watercolor(STYLE, 'banner');
    const second = DYNAMIC_GENERATORS.watercolor(STYLE, 'banner');
    // Strings compare by VALUE in JS — this proves the two renders actually
    // differ in content, not merely that two separate string objects exist.
    expect(first).not.toBe(second);
  });

  it('AC-UX-1: both successive calls still reflect the pinned style identity (at least one zone hue within tolerance of the pinned anchorHue)', () => {
    const first = DYNAMIC_GENERATORS.watercolor(STYLE, 'banner');
    const second = DYNAMIC_GENERATORS.watercolor(STYLE, 'banner');
    expect(closestHueDistance(extractHues(first), STYLE.anchorHue)).toBeLessThanOrEqual(HUE_IDENTITY_TOLERANCE_DEG);
    expect(closestHueDistance(extractHues(second), STYLE.anchorHue)).toBeLessThanOrEqual(HUE_IDENTITY_TOLERANCE_DEG);
  });

  it('AC-UX-1: a different pinned style produces a recognizably different colour identity (identity is genuinely pinned, not ignored)', () => {
    const otherStyle: StyleToken = { anchorHue: 10, scheme: 'monochromatic', saturation: 30, lightness: 25 };
    // Sanity: the two anchorHues must be far enough apart (well beyond 2x the tolerance) that
    // satisfying one style's tolerance band says nothing about the other's.
    expect(closestHueDistance([otherStyle.anchorHue], STYLE.anchorHue)).toBeGreaterThan(2 * HUE_IDENTITY_TOLERANCE_DEG);

    const a = DYNAMIC_GENERATORS.watercolor(STYLE, 'banner');
    const b = DYNAMIC_GENERATORS.watercolor(otherStyle, 'banner');
    // Each render's OWN closest hue must sit near its OWN pinned anchor -- this is the actual
    // "identity is pinned, not ignored" invariant. (A full-render "no hue anywhere near the
    // other anchor" cross-check was considered and rejected: a real render emits dozens of
    // jittered zone hues, so with two anchors this far apart it is still statistically
    // plausible for one incidental zone hue to land within tolerance of the OTHER anchor by
    // chance -- confirmed empirically during S7 -- making a strict cross-check flaky, not
    // meaningful.)
    expect(closestHueDistance(extractHues(a), STYLE.anchorHue)).toBeLessThanOrEqual(HUE_IDENTITY_TOLERANCE_DEG);
    expect(closestHueDistance(extractHues(b), otherStyle.anchorHue)).toBeLessThanOrEqual(HUE_IDENTITY_TOLERANCE_DEG);
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

// S9 (dynamic-theme-visuals epic, Phase B): AC-PERF-3 regression guard
// (VQ-S9-004). AC-PERF-3 itself ("on a low-end mobile profile, banner
// generation + paint MUST stay within an agreed budget") is a real-device/
// real-browser measurement concern, not something a jsdom-less unit test can
// exercise directly — see specs/epic-dynamic-theme-visuals/
// S9-performance-validation/result.json for that measurement's methodology
// and honest limitations. This block is NARROWER and MECHANICAL: it reads
// aquarelle's ACTUAL manifest-declared `render` lite-preset knobs (never a
// hardcoded copy, so a future edit to the manifest is exactly what this
// tests) and asserts real (non-mocked) `DYNAMIC_GENERATORS.watercolor` calls
// at those knobs stay inside the tuned <path>-count/byte-size band. This is
// a regression guard against the knob values silently drifting back toward
// S8's original oversized/unbounded output — it does not substitute for the
// real-device measurement itself.
describe('S9 regression guard (AC-PERF-3): aquarelle lite-preset render knobs', () => {
  const dynamicBanner = aquarelleManifest.treatments.dynamic?.banner;
  // Fails loudly (not silently skips) if a future edit ever removes
  // aquarelle's treatments.dynamic.banner declaration entirely — this guard
  // has nothing to check without it.
  if (!dynamicBanner) {
    throw new Error('aquarelle manifest no longer declares treatments.dynamic.banner — this regression guard is stale');
  }
  const { style, render } = dynamicBanner;

  // The live full-header fill preset (zones:5 + halo:8) emits a DETERMINISTIC
  // 20 <path> elements: zones*layers = 15 wash paths + one halo path per zone
  // (5) = 20, zero <circle> (splatter:0). Measured empirically at 26.8-28.7 KB
  // over 40 real draws at both the 420x96 default and a 1280-wide header; this
  // band leaves comfortable margin for the engine's continuous-parameter
  // jitter (spreadH/spreadV/zoneSize/grain/bleed/accent, all unpinned).
  const DYN_PATHS = 20;
  const DYN_MIN_BYTES = 20_000;
  const DYN_MAX_BYTES = 34_000;
  // The FROZEN static fallback is the legacy S8 zones:2 capture (6 paths,
  // ~8.5 KB), intentionally NOT regenerated to the fuller live preset — it is
  // preserved captured provenance. On a (rare) generation failure the header
  // therefore shows the legacy sparse art stretched to full width.
  const STATIC_PATHS = 6;
  const STATIC_MIN_BYTES = 6_000;
  const STATIC_MAX_BYTES = 15_360;

  it('render knobs fix <path> count at exactly 20 (zones*layers + one halo path per zone) across repeated real draws, with zero <circle> elements', () => {
    for (let i = 0; i < 10; i++) {
      const svg = DYNAMIC_GENERATORS.watercolor(style, 'banner', render);
      expect((svg.match(/<path /g) ?? []).length, `draw ${i}`).toBe(DYN_PATHS);
      expect((svg.match(/<circle /g) ?? []).length, `draw ${i}`).toBe(0);
    }
  });

  it('render knobs keep real output inside the tuned ~20-34 KB size band across repeated real draws', () => {
    for (let i = 0; i < 10; i++) {
      const svg = DYNAMIC_GENERATORS.watercolor(style, 'banner', render);
      expect(svg.length, `draw ${i}: ${svg.length} bytes`).toBeGreaterThanOrEqual(DYN_MIN_BYTES);
      expect(svg.length, `draw ${i}: ${svg.length} bytes`).toBeLessThanOrEqual(DYN_MAX_BYTES);
    }
  });

  it("aquarelle's frozen static treatments.banner fallback is the LEGACY zones:2 capture (6 paths, ~8.5 KB) — intentionally preserved and NOT regenerated to the fuller live preset, so it diverges from the dynamic knobs by design (the failure-only fallback shows the legacy art)", () => {
    const staticBanner = aquarelleManifest.treatments.banner;
    expect((staticBanner.match(/<path /g) ?? []).length).toBe(STATIC_PATHS);
    expect((staticBanner.match(/<circle /g) ?? []).length).toBe(0);
    expect(staticBanner.length).toBeGreaterThanOrEqual(STATIC_MIN_BYTES);
    expect(staticBanner.length).toBeLessThanOrEqual(STATIC_MAX_BYTES);
  });
});
