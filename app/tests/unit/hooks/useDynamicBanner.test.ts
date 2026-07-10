// app/tests/unit/hooks/useDynamicBanner.test.ts
//
// S3 (AC-STRUCT-5, AC-UX-2, AC-UX-3, AC-UX-3a, AC-PERF-1): exercises
// `resolveDynamicBannerStyle` — the pure decision function
// `useDynamicBanner.ts` wraps — DIRECTLY, never a rendered/mounted hook.
// This repo has no jsdom/React Testing Library (confirmed absent from
// app/package.json), so no hook can be rendered in tests
// (architecture.md Boundary Rule 7); mirrors the
// computeThemeStyles()/useThemeStyles() precedent in useThemeStyles.test.ts.
//
// S6 (AC-UX-4, AC-UX-5, AC-META-1) is the Phase-A capstone closing pass —
// test-only, no production code touched. It adds explicit, traceable
// describe('AC-UX-4', ...) / describe('AC-UX-5', ...) blocks (this repo's
// 1:1 AC-to-describe-block convention) rather than relying on S3's AC-UX-2/
// AC-UX-3 blocks implicitly covering the same ground, plus a describe(
// 'AC-META-1', ...) block that makes the "no per-seed determinism test"
// requirement a live, executable negative assertion instead of only a
// comment (see that block for why a structural self-scan was chosen over a
// documentary-only note).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { computeThemeStyles } from '@/src/hooks/useThemeStyles';
import {
  resolveDynamicBannerStyle,
  shouldRenderScrim,
  resolveScrimColor,
  resolveIdleScheduler,
  generateViaFallback,
  scheduleFallbackGeneration,
  resolveWorkerMessageOutcome,
} from '@/src/hooks/useDynamicBanner';
import { wcagRatio, WCAG_AA_THRESHOLD } from '@/src/themes/contrast';
import { DYNAMIC_GENERATORS } from '@/src/themes/treatments/dynamicVisuals';
import { APP_THEMES } from '@/src/lib/theme';
import type { AppThemeDefinition } from '@/src/lib/theme';
import type { StyleToken } from '@/src/themes/treatments/dynamicVisuals';

const TEST_FILE_DIR = path.dirname(fileURLToPath(import.meta.url));
const USE_THEME_STYLES_PATH = path.resolve(TEST_FILE_DIR, '../../../src/hooks/useThemeStyles.ts');
const USE_DYNAMIC_BANNER_PATH = path.resolve(TEST_FILE_DIR, '../../../src/hooks/useDynamicBanner.ts');
const BANNER_WORKER_PATH = path.resolve(TEST_FILE_DIR, '../../../src/workers/banner.worker.ts');
/** This file's own path — used by the AC-META-1 self-scan below (it must scan itself, not just the SUT). */
const THIS_TEST_FILE_PATH = fileURLToPath(import.meta.url);
/** S2's dynamicVisuals suite — the suite's other file that calls DYNAMIC_GENERATORS.watercolor directly; scanned alongside this file for AC-META-1. */
const TREATMENTS_TEST_PATH = path.resolve(TEST_FILE_DIR, '../themes/treatments.test.ts');

const STYLE_TOKEN: StyleToken = { anchorHue: 200, scheme: 'triadic', saturation: 60, lightness: 50 };

// aquarelle is the only shipped theme and it DOES declare a
// `treatments.dynamic.banner`, so derive a static-only variant (its dynamic
// declaration stripped) to exercise the no-dynamic path.
const { dynamic: _aquarelleDynamic, ...AQUARELLE_TREATMENTS_STATIC } = APP_THEMES.aquarelle.treatments;

/** A real theme manifest with no `treatments.dynamic` declared (aquarelle, dynamic stripped). */
const STATIC_ONLY: AppThemeDefinition = {
  ...APP_THEMES.aquarelle,
  treatments: AQUARELLE_TREATMENTS_STATIC,
};

/** The same real manifest, with a `treatments.dynamic.banner` added (nothing else changed). */
function withDynamicBanner(style: StyleToken = STYLE_TOKEN): AppThemeDefinition {
  return {
    ...STATIC_ONLY,
    treatments: {
      ...STATIC_ONLY.treatments,
      dynamic: {
        banner: { generator: 'watercolor', style },
      },
    },
  };
}

/** Mirrors useThemeStyles.ts's private navBannerDecor() encoding exactly, so tests don't depend on the SUT's own encoding to verify the SUT's encoding. */
function expectedDataUri(svg: string): string {
  const collapsed = svg.replace(/\s+/g, ' ').trim();
  return `url("data:image/svg+xml,${encodeURIComponent(collapsed)}")`;
}

const SVG_A = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 96"><rect fill="hsl(1,1%,1%)" width="1" height="1"/></svg>';
const SVG_B = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 96"><circle fill="hsl(2,2%,2%)" r="9"/></svg>';

describe('AC-STRUCT-5: computeThemeStyles()/useThemeStyles.ts remain untouched', () => {
  it('useThemeStyles.ts source contains no dynamic-banner logic (no reference to the new module or its exports)', () => {
    const source = readFileSync(USE_THEME_STYLES_PATH, 'utf-8');
    expect(source).not.toMatch(/DYNAMIC_GENERATORS/);
    expect(source).not.toMatch(/useDynamicBanner/);
    expect(source).not.toMatch(/resolveDynamicBannerStyle/);
    expect(source).not.toMatch(/generatedSvg/);
    expect(source).not.toMatch(/dynamicVisuals/);
  });

  it('computeThemeStyles still returns only the static bannerDecorStyle for a theme with no dynamic banner declared, unaffected by this story', () => {
    const result = computeThemeStyles(STATIC_ONLY);
    expect(result.bannerDecorStyle).not.toBeNull();
    expect(result.bannerDecorStyle!.style.backgroundImage).toMatch(/^url\("data:image\/svg\+xml,/);
    // Six-field return shape (AC-UX-1/AC10 in useThemeStyles.test.ts) is unchanged —
    // no seventh field for dynamic state was added to computeThemeStyles's return.
    expect(Object.keys(result).sort()).toEqual(
      ['bannerDecorStyle', 'buttonStyle', 'cardStyle', 'contentPanelStyle', 'navStyle', 'surfaceStyle'].sort(),
    );
  });
});

describe('AC-UX-2: absent treatments.dynamic.banner renders the static banner unchanged; present swaps style.backgroundImage only', () => {
  it('when treatments.dynamic?.banner is absent, returns the static boxProps/style unchanged and hasDynamicBanner: false', () => {
    const staticDecor = computeThemeStyles(STATIC_ONLY).bannerDecorStyle!;
    const result = resolveDynamicBannerStyle(STATIC_ONLY, null);
    expect(result).not.toBeNull();
    expect(result!.hasDynamicBanner).toBe(false);
    expect(result!.boxProps).toEqual(staticDecor.boxProps);
    expect(result!.style).toEqual(staticDecor.style);
  });

  it('when present with a generated SVG, swaps style.backgroundImage to the generated data-URI, leaving boxProps untouched', () => {
    const def = withDynamicBanner();
    const staticDecor = computeThemeStyles(def).bannerDecorStyle!;
    const result = resolveDynamicBannerStyle(def, SVG_A);
    expect(result).not.toBeNull();
    expect(result!.hasDynamicBanner).toBe(true);
    // boxProps: split contract — unchanged from the static reservation, and
    // never carries backgroundImage (Chakra drops data-URI backgroundImage
    // through its style-prop pipeline — architecture.md's highest-risk
    // silent-failure point; this MUST land on the raw `style` field, never
    // folded into boxProps, checked here structurally by field, not by a
    // generic "contains the string somewhere" match).
    expect(result!.boxProps).toEqual(staticDecor.boxProps);
    expect(result!.boxProps).not.toHaveProperty('backgroundImage');
    // style: the ONLY field that changes is backgroundImage.
    expect(result!.style.backgroundImage).toBe(expectedDataUri(SVG_A));
    expect(result!.style.backgroundImage).not.toBe(staticDecor.style.backgroundImage);
    expect(result!.style.backgroundSize).toBe(staticDecor.style.backgroundSize);
    expect(result!.style.backgroundRepeat).toBe(staticDecor.style.backgroundRepeat);
  });

  it('encodes the generated SVG exactly as navBannerDecor does (whitespace-collapse+trim, then encodeURIComponent) — no divergent encoding scheme', () => {
    const messySvg = '\n  <svg xmlns="http://www.w3.org/2000/svg"   viewBox="0 0 1 1">\n    <rect/>\n  </svg>\n';
    const result = resolveDynamicBannerStyle(withDynamicBanner(), messySvg);
    expect(result!.style.backgroundImage).toBe(expectedDataUri(messySvg));
    // Sanity: collapsing/trimming actually changed the raw string (proves this
    // assertion isn't vacuously true because messySvg had no whitespace to collapse).
    expect(messySvg.replace(/\s+/g, ' ').trim()).not.toBe(messySvg);
  });
});

describe('AC-UX-3: on mount the background differs from the static fallback, and differs across two mounts', () => {
  it('a generated SVG produces a backgroundImage distinct from the static fallback', () => {
    const def = withDynamicBanner();
    const staticDecor = computeThemeStyles(def).bannerDecorStyle!;
    const result = resolveDynamicBannerStyle(def, SVG_A);
    expect(result!.style.backgroundImage).not.toBe(staticDecor.style.backgroundImage);
  });

  it('two distinct generated SVG strings (standing in for two separate mounts) produce two distinct backgroundImage values', () => {
    const def = withDynamicBanner();
    const mountOne = resolveDynamicBannerStyle(def, SVG_A);
    const mountTwo = resolveDynamicBannerStyle(def, SVG_B);
    expect(mountOne!.style.backgroundImage).not.toBe(mountTwo!.style.backgroundImage);
    // Both still reflect the pinned identity: same generator declaration, same boxProps.
    expect(mountOne!.boxProps).toEqual(mountTwo!.boxProps);
  });
});

describe("AC-UX-3a: generation failure (generatedSvg: null) keeps/reverts to the static banner, never a broken/blank value", () => {
  it('treatments.dynamic?.banner present but generatedSvg is null returns the static style unchanged', () => {
    const def = withDynamicBanner();
    const staticDecor = computeThemeStyles(def).bannerDecorStyle!;
    const result = resolveDynamicBannerStyle(def, null);
    expect(result).not.toBeNull();
    expect(result!.boxProps).toEqual(staticDecor.boxProps);
    expect(result!.style).toEqual(staticDecor.style);
    expect(result!.style.backgroundImage).toMatch(/^url\("data:image\/svg\+xml,/);
  });

  it('hasDynamicBanner stays true (declaration-based) even while generation has failed, so a scrim consumer keyed off it does not flicker off during the fallback window', () => {
    const def = withDynamicBanner();
    const result = resolveDynamicBannerStyle(def, null);
    expect(result!.hasDynamicBanner).toBe(true);
  });

  it('calling resolveDynamicBannerStyle with generatedSvg: null never throws', () => {
    expect(() => resolveDynamicBannerStyle(withDynamicBanner(), null)).not.toThrow();
  });

  // Real-gap closure (mutation gate, 2026-07-06): resolveDynamicBannerStyle's
  // own docstring states it "Returns null only in the same degenerate case
  // computeThemeStyles itself returns a null bannerDecorStyle (an empty
  // static banner string) — mirrors the existing contract, never introduces
  // a new one." No test in this file previously exercised that early return
  // (line ~101's `if (bannerDecorStyle === null) return null`), since no
  // real theme manifest ships an empty treatments.banner. A synthetic
  // fixture is required to reach it at all.
  it('returns null (not a broken/partial object) when the static banner string is empty/whitespace-only, regardless of generatedSvg', () => {
    const emptyBannerDef: AppThemeDefinition = {
      ...STATIC_ONLY,
      treatments: { ...STATIC_ONLY.treatments, banner: '   ' },
    };
    expect(computeThemeStyles(emptyBannerDef).bannerDecorStyle).toBeNull();
    expect(resolveDynamicBannerStyle(emptyBannerDef, null)).toBeNull();
    expect(resolveDynamicBannerStyle(emptyBannerDef, SVG_A)).toBeNull();
  });
});

describe('AC-PERF-1: reserved box dimensions are unchanged before/after the swap (mechanism only)', () => {
  it('boxProps width/height are identical whether generatedSvg is null, string, or the banner is static-only', () => {
    const def = withDynamicBanner();
    const staticOnlyResult = resolveDynamicBannerStyle(STATIC_ONLY, null);
    const nullResult = resolveDynamicBannerStyle(def, null);
    const stringResult = resolveDynamicBannerStyle(def, SVG_A);

    const dims = (r: typeof nullResult) => ({ w: r!.boxProps.w, h: r!.boxProps.h });

    expect(dims(nullResult)).toEqual(dims(stringResult));
    expect(dims(nullResult)).toEqual(dims(staticOnlyResult));
    // Pinned to the actual reserved envelope (96px tall, clamp width) so this
    // doesn't just prove reflexive equality against itself.
    expect(nullResult!.boxProps.h).toBe('96px');
    expect(nullResult!.boxProps.w).toBe('clamp(220px, 33vw, 420px)');
  });
});

describe('AC-A11Y-1: legibility scrim guarantees brand.500 logo text meets WCAG AA (>= 4.5:1), independent of any generated image', () => {
  // Every shipped theme's REAL brand.500 hex (colors.brand[5] — SCALE_STEPS
  // in buildChakraTheme.ts: 50,100,...,900), read straight from APP_THEMES —
  // not a hand-picked favorable example. (aquarelle is the only shipped theme
  // today; the arbitrary-values test below carries the breadth.)
  const realBrand500Values = Object.values(APP_THEMES).map((def) => def.colors.brand[5]);

  it('every real theme has a distinct brand.500 that this test is not vacuous', () => {
    expect(realBrand500Values.length).toBeGreaterThanOrEqual(1);
    expect(new Set(realBrand500Values).size).toBe(realBrand500Values.length);
  });

  it.each(realBrand500Values)(
    'resolveScrimColor(%s) picks a scrim color whose REAL wcagRatio (imported from contrast.ts) against that brand.500 clears WCAG_AA_THRESHOLD',
    (brand500Hex) => {
      const scrimColor = resolveScrimColor(brand500Hex);
      const ratio = wcagRatio(scrimColor, brand500Hex);
      expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_THRESHOLD);
    },
  );

  it('holds for arbitrary brand.500 values too, not just the themes that exist today (the black-or-white guarantee is unconditional)', () => {
    // A spread of colors spanning the luminance range, none of them tuned to
    // favor this function — including ones deliberately near the black/white
    // crossover band this property has to hold across.
    const arbitraryHexValues = [
      '#7f7f7f', '#123456', '#abcdef', '#336699', '#ff00ff', '#00ffcc',
      '#111111', '#eeeeee', '#8899aa', '#204060', '#c0c0c0', '#405020',
    ];
    for (const hex of arbitraryHexValues) {
      const scrimColor = resolveScrimColor(hex);
      expect(wcagRatio(scrimColor, hex)).toBeGreaterThanOrEqual(WCAG_AA_THRESHOLD);
    }
  });

  it('resolveScrimColor never depends on any generated banner SVG — it takes only a hex color, no theme/definition/image argument', () => {
    // Signature check: this function cannot possibly consult banner content
    // because it has no parameter through which to receive it.
    expect(resolveScrimColor.length).toBe(1);
  });
});

describe('AC-A11Y-2: the scrim is present whenever a dynamic banner is active, and does not regress static-only themes', () => {
  it('shouldRenderScrim(true) is true — scrim renders when the active theme declares a dynamic banner', () => {
    expect(shouldRenderScrim(true)).toBe(true);
  });

  it('shouldRenderScrim(false) is false — no scrim (no-op) for a theme that declares only a static banner', () => {
    expect(shouldRenderScrim(false)).toBe(false);
  });

  it('keys off the exact same declaration-based hasDynamicBanner resolveDynamicBannerStyle returns, including during the AC-UX-3a fallback window (generation failed, generatedSvg: null)', () => {
    const def = withDynamicBanner();
    const staticOnly = resolveDynamicBannerStyle(STATIC_ONLY, null);
    const declaredButFailed = resolveDynamicBannerStyle(def, null);
    const declaredAndGenerated = resolveDynamicBannerStyle(def, SVG_A);

    expect(shouldRenderScrim(staticOnly!.hasDynamicBanner)).toBe(false);
    // Scrim must NOT flicker off just because the most recent generation
    // attempt failed — hasDynamicBanner reflects the manifest declaration.
    expect(shouldRenderScrim(declaredButFailed!.hasDynamicBanner)).toBe(true);
    expect(shouldRenderScrim(declaredAndGenerated!.hasDynamicBanner)).toBe(true);
  });
});

// ===========================================================================
// AC-PERF-2 (S5, worker offload): "Banner generation MUST run off the main
// thread (Web Worker) when supported, returning the SVG string via
// postMessage; a requestIdleCallback (or equivalent deferred) main-thread
// path MUST exist as a fallback. Generation MUST NOT block first paint."
// Phase A scope note (acceptance-criteria.md): "verifies the mechanism only
// -- the worker/idle-callback code path is exercised in a mocked-generator
// test; real paint-timing measurement is AC-PERF-3, Phase B."
//
// This repo has no real Worker-thread mocking infrastructure (architecture.md
// Implementation Constraints) and no jsdom/RTL (Boundary Rule 7), so the
// Worker construction/message-round-trip itself cannot be exercised end to
// end here -- exactly like S3's hook, this story keeps ALL decision/mapping
// logic in exported pure functions (resolveIdleScheduler, generateViaFallback,
// scheduleFallbackGeneration, resolveWorkerMessageOutcome) so THOSE are
// directly testable, plus a structural source scan (mirroring the existing
// AC-STRUCT-5 style above) proving the mechanism is genuinely wired into the
// hook and that banner.worker.ts is a thin wrapper, not a re-implementation.
// ===========================================================================
describe('AC-PERF-2: banner generation runs off the main thread via a Worker when supported, with a requestIdleCallback (or equivalent deferred) fallback, and must not block first paint', () => {
  describe('structural mechanism presence (source scan, no jsdom/Worker-thread infra available -- see file header)', () => {
    it('useDynamicBanner.ts structurally attempts Worker construction via the native new Worker(new URL(...)) ESM pattern, wires a requestIdleCallback fallback, posts a message, and terminates the worker on cleanup', () => {
      const source = readFileSync(USE_DYNAMIC_BANNER_PATH, 'utf-8');
      expect(source).toMatch(/new Worker\(\s*new URL\(/);
      expect(source).toMatch(/requestIdleCallback/);
      expect(source).toMatch(/\.postMessage\(/);
      expect(source).toMatch(/\.terminate\(/);
    });

    it('banner.worker.ts is a thin message-passing wrapper: exactly one call to DYNAMIC_GENERATORS.watercolor, no re-implementation of randomizeParams/override composition logic, and posts its result back', () => {
      const workerSource = readFileSync(BANNER_WORKER_PATH, 'utf-8');
      const generatorCalls = workerSource.match(/DYNAMIC_GENERATORS\.watercolor\(/g) ?? [];
      expect(generatorCalls.length).toBe(1);
      expect(workerSource).not.toMatch(/randomizeParams/);
      expect(workerSource).not.toMatch(/blobSeedX|blobRadius|strokeJitter/);
      expect(workerSource).toMatch(/postMessage\(/);
    });
  });

  describe('generateViaFallback: genuinely calls the real generator (not a frozen/hardcoded stand-in -- VQ-S5-001), and is fail-soft on a throw', () => {
    it('returns a valid, self-contained SVG string from the real DYNAMIC_GENERATORS.watercolor call', () => {
      const result = generateViaFallback({ style: STYLE_TOKEN, kind: 'banner' });
      expect(result).not.toBeNull();
      expect(result).toMatch(/^<svg /);
      expect(result).not.toMatch(/<script/);
    });

    it('two successive calls produce different output, proving this reads the real per-call-random generator rather than a hardcoded placeholder that would be undetectable in this jsdom-less repo', () => {
      const first = generateViaFallback({ style: STYLE_TOKEN, kind: 'banner' });
      const second = generateViaFallback({ style: STYLE_TOKEN, kind: 'banner' });
      expect(first).not.toBe(second);
    });

    it('a throw from the generator is caught fail-soft and returns null, never propagating an uncaught error -- mirrors AC-UX-3a for this off-thread/deferred path', () => {
      const spy = vi.spyOn(DYNAMIC_GENERATORS, 'watercolor').mockImplementationOnce(() => {
        throw new Error('forced generator failure');
      });
      let result: string | null = 'not-set-by-test' as unknown as string | null;
      expect(() => {
        result = generateViaFallback({ style: STYLE_TOKEN, kind: 'banner' });
      }).not.toThrow();
      expect(result).toBeNull();
      spy.mockRestore();
    });
  });

  describe('resolveIdleScheduler / scheduleFallbackGeneration: the fallback is a genuinely deferred callback, not a same-tick pass-through mock (VQ-S5-004)', () => {
    it('this Vitest/Node environment has no requestIdleCallback global, so resolveIdleScheduler here exercises the TRUE fallback-of-fallback (setTimeout) branch honestly, not a mocked stand-in', () => {
      expect(typeof (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback).toBe('undefined');
      expect(typeof resolveIdleScheduler()).toBe('function');
    });

    it('the resolved scheduler genuinely defers past the current synchronous tick -- a same-tick pass-through mock would fail this assertion', async () => {
      let called = false;
      const scheduler = resolveIdleScheduler();
      scheduler(() => {
        called = true;
      });
      expect(called).toBe(false);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(called).toBe(true);
    });

    it('scheduleFallbackGeneration defers through the resolved scheduler and eventually calls onResult with a real generated SVG', async () => {
      const results: Array<string | null> = [];
      scheduleFallbackGeneration({ style: STYLE_TOKEN, kind: 'banner' }, (svg) => {
        results.push(svg);
      });
      expect(results).toHaveLength(0);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(results).toHaveLength(1);
      expect(results[0]).toMatch(/^<svg /);
    });

    it('accepts an injected scheduler (scheduler-agnostic, not hardcoded to one global) -- the mechanism a real requestIdleCallback-supporting browser would use', () => {
      const scheduledCallbacks: Array<() => void> = [];
      const fakeScheduler = (cb: () => void) => {
        scheduledCallbacks.push(cb);
      };
      scheduleFallbackGeneration({ style: STYLE_TOKEN, kind: 'banner' }, () => {}, fakeScheduler);
      expect(scheduledCallbacks).toHaveLength(1);
    });
  });

  describe('resolveWorkerMessageOutcome: maps the Worker message/error contract to the same fail-soft null state AC-UX-3a already established', () => {
    it('an { ok: true, svg } response resolves to that exact svg string', () => {
      expect(resolveWorkerMessageOutcome({ ok: true, svg: SVG_A })).toBe(SVG_A);
    });

    it('an { ok: false } response -- the worker\'s own failure signal, or the hook\'s onerror handler mapping to the identical shape -- resolves to null, never a partial/broken value', () => {
      expect(resolveWorkerMessageOutcome({ ok: false })).toBeNull();
    });

    it('never throws for either response shape', () => {
      expect(() => resolveWorkerMessageOutcome({ ok: true, svg: SVG_A })).not.toThrow();
      expect(() => resolveWorkerMessageOutcome({ ok: false })).not.toThrow();
    });
  });
});

// ===========================================================================
// S6 (AC-UX-4, AC-UX-5, AC-META-1) — the Phase-A capstone closing pass.
// Test-only: no production file is touched by this story. See file header.
// ===========================================================================

describe('AC-UX-4: static fallback renders when JS/dynamic generation is unavailable (no-JS path shows the CORRECT static image)', () => {
  // S3's AC-UX-2 block above already proves the "absent declaration" case
  // returns computeThemeStyles()'s own static bannerDecorStyle unchanged. That
  // is real coverage, but it checks equality against the SUT's OWN derived
  // value (computeThemeStyles(...).bannerDecorStyle), not against the theme
  // manifest's raw treatments.banner source — so a bug that corrupted BOTH
  // computeThemeStyles() and resolveDynamicBannerStyle identically would slip
  // through. This block re-asserts that case under AC-UX-4's explicit name
  // (per this suite's 1:1 AC-to-describe-block convention) AND adds the
  // no-JS-specific assertion AC-UX-4 actually calls for: decoding the
  // rendered backgroundImage all the way back and confirming it is
  // byte-identical to the theme's OWN authored treatments.banner string — the
  // "correct image", not merely "an unchanged value".
  function expectedDataUriFromRawBanner(rawBannerSvg: string): string {
    return `url("data:image/svg+xml,${encodeURIComponent(rawBannerSvg.replace(/\s+/g, ' ').trim())}")`;
  }

  it('re-asserts AC-UX-2\'s absent-declaration case under AC-UX-4\'s framing: resolveDynamicBannerStyle(definition, null) with no treatments.dynamic.banner declared renders the static fallback', () => {
    const result = resolveDynamicBannerStyle(STATIC_ONLY, null);
    expect(result).not.toBeNull();
    expect(result!.hasDynamicBanner).toBe(false);
  });

  it('the no-JS rendered image is the theme\'s OWN correct static banner — decoded straight from the manifest\'s raw treatments.banner field, independent of computeThemeStyles()\'s own derivation', () => {
    const result = resolveDynamicBannerStyle(STATIC_ONLY, null);
    expect(result!.style.backgroundImage).toBe(expectedDataUriFromRawBanner(STATIC_ONLY.treatments.banner));
  });

  it('also holds pre-hydration for a theme that DOES declare treatments.dynamic.banner: before the effect has ever run (no-JS, or JS not yet executed), generatedSvg is null and the shown image is still that theme\'s correct static banner — never blank or broken', () => {
    const def = withDynamicBanner();
    const result = resolveDynamicBannerStyle(def, null);
    expect(result!.style.backgroundImage).toBe(expectedDataUriFromRawBanner(def.treatments.banner));
  });

  it('the no-JS fallback resolves to the manifest\'s OWN static banner, not a shared/generic placeholder — proving the decode isn\'t coincidentally matching one fixture (aquarelle vs a synthetic banner variant)', () => {
    // With a single shipped theme, stand a synthetic second manifest (same
    // theme, a different static banner) next to it to prove the decode tracks
    // each manifest's own banner rather than echoing a shared constant.
    const variant: AppThemeDefinition = {
      ...APP_THEMES.aquarelle,
      treatments: {
        ...APP_THEMES.aquarelle.treatments,
        banner: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 96"><rect fill="#abcdef" width="1" height="1"/></svg>',
      },
    };
    const resultA = resolveDynamicBannerStyle(APP_THEMES.aquarelle, null);
    const resultB = resolveDynamicBannerStyle(variant, null);
    expect(resultA!.style.backgroundImage).toBe(expectedDataUriFromRawBanner(APP_THEMES.aquarelle.treatments.banner));
    expect(resultB!.style.backgroundImage).toBe(expectedDataUriFromRawBanner(variant.treatments.banner));
    // Sanity: this only proves something if the two banners actually differ.
    expect(resultA!.style.backgroundImage).not.toBe(resultB!.style.backgroundImage);
  });
});

describe('AC-UX-5: on mount, the swapped background is a valid data-URI SVG -- parses as SVG, contains a viewBox, and contains no <script>', () => {
  // S3's AC-UX-2/AC-UX-3 blocks already prove the swap happens (the
  // backgroundImage value CHANGES and differs across mounts) via exact-match
  // comparison to `expectedDataUri(SVG_A)`. That exact-match already implies
  // SVG_A's shape round-trips intact, but AC-UX-5 asks for the SPECIFIC shape
  // assertions to be explicit and named, mirroring AC-STRUCT-6's precedent in
  // treatments.test.ts (well-formed SVG root + viewBox, no <script>) — not a
  // new SVG-parser dependency (architecture.md Boundary Rule 8), plain
  // string/regex matching against the DECODED value only.
  function decodeBackgroundImage(backgroundImage: string): string {
    const match = backgroundImage.match(/^url\("data:image\/svg\+xml,(.*)"\)$/);
    expect(match, `backgroundImage did not match the expected data-URI shape: ${backgroundImage}`).not.toBeNull();
    return decodeURIComponent(match![1]);
  }

  it('the swapped backgroundImage decodes to a string that parses as SVG (starts with an <svg ...> root tag)', () => {
    const result = resolveDynamicBannerStyle(withDynamicBanner(), SVG_A);
    const decoded = decodeBackgroundImage(result!.style.backgroundImage);
    expect(decoded).toMatch(/^<svg[ >]/);
  });

  it('the decoded SVG contains a viewBox attribute', () => {
    const result = resolveDynamicBannerStyle(withDynamicBanner(), SVG_B);
    const decoded = decodeBackgroundImage(result!.style.backgroundImage);
    expect(decoded).toMatch(/\bviewBox="[^"]+"/);
  });

  it('the decoded SVG contains no <script> tag', () => {
    const result = resolveDynamicBannerStyle(withDynamicBanner(), SVG_A);
    const decoded = decodeBackgroundImage(result!.style.backgroundImage);
    expect(decoded).not.toMatch(/<script/i);
  });

  it('holds for a genuinely generated SVG from the real DYNAMIC_GENERATORS.watercolor, not just the hand-authored SVG_A/SVG_B fixtures -- proving the swap path preserves a REAL generator\'s shape rather than echoing a fixture pre-built to trivially pass the regex (VQ-S6-008)', () => {
    const generated = DYNAMIC_GENERATORS.watercolor(STYLE_TOKEN, 'banner');
    const result = resolveDynamicBannerStyle(withDynamicBanner(), generated);
    const decoded = decodeBackgroundImage(result!.style.backgroundImage);
    expect(decoded).toMatch(/^<svg[ >]/);
    expect(decoded).toMatch(/\bviewBox="[^"]+"/);
    expect(decoded).not.toMatch(/<script/i);
    // Round-trips exactly back to the real generator's own output collapsed the
    // same way navBannerDecor() collapses it -- no corruption in the swap/encode path.
    expect(decoded).toBe(generated.replace(/\s+/g, ' ').trim());
  });
});

describe('AC-META-1: no per-seed determinism test exists anywhere in this suite (non-determinism is intended -- behaviour is asserted, not pixels)', () => {
  // AC-META-1 requires a NEGATIVE assertion, which is unusual: proving an
  // absence rather than a presence. A purely documentary comment recording
  // the convention is honest but inert -- nothing stops a future edit from
  // silently violating it. A full semantic scan for "any test that pins
  // generator output" is undecidable in general (it would require
  // understanding intent, not just text). The judgment call made here is a
  // middle path: keep the convention documented in prose (below), AND make
  // the two concrete, ENUMERABLE red flags into live, executable checks that
  // scan this suite's own test files (not the SUT) --
  //   1. vitest's built-in snapshot-matcher helpers (the "toMatch" + "Snapshot"
  //      and "toMatchInline" + "Snapshot" matchers) are the single most direct
  //      route to an accidental byte-for-byte pixel test in this framework;
  //      their presence anywhere in the dynamic-banner suite is asserted to be
  //      zero. (Spelled with a break here on purpose -- see FORBIDDEN_SNAPSHOT_MARKERS
  //      below -- so this very comment doesn't trip its own scan.)
  //   2. DYNAMIC_GENERATORS.watercolor's own exported signature is checked to
  //      confirm it exposes no seed-like parameter a caller could pin -- a
  //      "per-seed" test isn't even expressible against the real API surface,
  //      which structurally forecloses the pattern AC-META-1 forbids.
  // Convention (documentary): every assertion against generator output in
  // this suite either (a) checks BEHAVIOUR/shape -- contains the pinned fill
  // colour, has a viewBox, no <script> -- or (b) checks that two
  // independently-produced outputs DIFFER (AC-UX-1, treatments.test.ts). The
  // SVG_A/SVG_B fixtures used throughout this file stand in for "some
  // generated SVG" when testing resolveDynamicBannerStyle's swap mechanics
  // (AC-UX-2/3/5) -- they are never compared against the REAL generator's own
  // output, which is the one pattern that would constitute a hidden
  // determinism/pixel test.
  //
  // The forbidden marker strings are built via concatenation below (never
  // written contiguously in this file's source) so this scan can legitimately
  // include ITSELF among the scanned files without the pattern matching its
  // own definition.
  const FORBIDDEN_SNAPSHOT_MARKERS = ['toMatch' + 'Snapshot', 'toMatchInline' + 'Snapshot'];

  const SUITE_FILES = [
    { label: 'useDynamicBanner.test.ts (this file)', path: THIS_TEST_FILE_PATH },
    { label: "treatments.test.ts (S2's dynamicVisuals suite)", path: TREATMENTS_TEST_PATH },
  ];

  it('no test file in the dynamic-banner suite uses vitest snapshot testing (the toMatch/Snapshot matcher family)', () => {
    for (const { label, path: filePath } of SUITE_FILES) {
      const source = readFileSync(filePath, 'utf-8');
      for (const marker of FORBIDDEN_SNAPSHOT_MARKERS) {
        expect(source.includes(marker), `${label} must not use snapshot testing (found "${marker}")`).toBe(false);
      }
    }
  });

  it('DYNAMIC_GENERATORS.watercolor exposes no seed-like parameter a caller could pin -- (style, kind, render?) only -- so a per-seed determinism test is not even expressible against the real API', () => {
    expect(DYNAMIC_GENERATORS.watercolor.length).toBeLessThanOrEqual(3);
  });

  it('sanity: the suite files actually exist and are non-trivial (this check would be vacuous if it silently scanned empty/missing files)', () => {
    for (const { label, path: filePath } of SUITE_FILES) {
      const source = readFileSync(filePath, 'utf-8');
      expect(source.length, `${label} unexpectedly empty/missing`).toBeGreaterThan(500);
    }
  });
});
