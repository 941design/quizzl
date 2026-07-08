// app/src/hooks/useDynamicBanner.ts
//
// S3 (base:dev). Decision logic and the useEffect/useState wrapper
// implemented against the integration tests in
// app/tests/unit/hooks/useDynamicBanner.test.ts.
//
// architecture.md Module Map: "useDynamicBanner (NEW) | client-only hook;
// on mount, if treatments.dynamic?.banner present, generate a fresh SVG,
// encode as data-URI, expose a swapped backgroundImage; on failure,
// keep/revert to static (AC-UX-3a)". Seam Contracts: "useDynamicBanner
// return (useDynamicBanner.ts -> Layout.tsx)". Boundary Rules 5, 6, 7.
//
// THIS FILE MUST NOT IMPORT OR MODIFY app/src/hooks/useThemeStyles.ts's
// EXPORTS BEYOND A READ-ONLY VALUE IMPORT OF computeThemeStyles — that file
// itself is never edited (Boundary Rule 5). useDynamicBanner is a SECOND,
// INDEPENDENT client-only hook Layout.tsx calls ALONGSIDE useThemeStyles().
import { useEffect, useState } from 'react';
import type { BoxProps } from '@chakra-ui/react';
import type React from 'react';
import { computeThemeStyles } from '@/src/hooks/useThemeStyles';
import { DYNAMIC_GENERATORS } from '@/src/themes/treatments/dynamicVisuals';
import type { StyleToken } from '@/src/themes/treatments/dynamicVisuals';
import { wcagRatio } from '@/src/themes/contrast';
import type { AppThemeDefinition } from '@/src/lib/theme';
// Type-only: banner.worker.ts's top-level self.addEventListener(...) is a
// real side effect that must only ever execute inside an actual Worker
// thread (instantiated below via `new URL(...)`), never pulled into the
// main-thread bundle by a runtime import of this module (architecture.json
// dependencies_forbidden).
import type { BannerWorkerResponse } from '@/src/workers/banner.worker';

/**
 * The seam type Layout.tsx (S3) and S4's shouldRenderScrim consume.
 *
 * HARD CONTRACT (architecture.md's single highest-risk silent-failure point
 * in this epic — not detectable by any test in this jsdom-less repo, so
 * this comment is load-bearing): `boxProps` and `style` MUST stay two
 * SEPARATE top-level fields, exactly mirroring useThemeStyles.ts's
 * `BannerDecor` type. NEVER fold `style.backgroundImage` into `boxProps` —
 * Chakra silently drops a data-URI `backgroundImage` value through its
 * style-prop pipeline when it is spread as a Chakra style prop; it only
 * works on the raw DOM `style` attribute. A refactor that merges these two
 * fields will pass every test in this repo (no jsdom) and break only in a
 * real browser. See result.json for the required manual/visual verification
 * note.
 */
export type ResolveDynamicBannerStyleReturn = {
  /**
   * Whether this theme DECLARES a dynamic banner (treatments.dynamic?.banner
   * is present) — reflects the manifest declaration, not whether the most
   * recent generation attempt succeeded. This is the boolean S4's
   * shouldRenderScrim(hasDynamicBanner) keys off (AC-A11Y-2), so it must
   * stay true even during the static-fallback window (AC-UX-3a).
   */
  hasDynamicBanner: boolean;
  /** Identical to useThemeStyles.ts's BannerDecor.boxProps — never mutated by the dynamic swap. */
  boxProps: BoxProps;
  /** Identical to useThemeStyles.ts's BannerDecor.style — backgroundImage is the ONLY field the dynamic swap ever changes. */
  style: React.CSSProperties;
};

/**
 * Pure decision function — ALL branch logic for the dynamic-banner swap
 * lives here (architecture.md Boundary Rule 7: no jsdom/RTL in this repo,
 * so no hook can be rendered/mounted in tests; this is what
 * useDynamicBanner.test.ts exercises directly).
 *
 * Preconditions: `definition` is a valid AppThemeDefinition (already
 * validated by validateManifest() at build time — this function does no
 * validation of its own). `generatedSvg` is either a complete, valid SVG
 * string produced by DYNAMIC_GENERATORS, or `null` meaning "no generation
 * attempted yet, or the most recent attempt failed" (AC-UX-3a) — never a
 * partial/broken string.
 *
 * Postconditions:
 * - `treatments.dynamic?.banner` absent -> returns the STATIC style
 *   unchanged (AC-UX-2's "when absent" branch); `hasDynamicBanner: false`.
 * - `treatments.dynamic?.banner` present AND `generatedSvg` is a string ->
 *   returns the SAME `{ boxProps, style }` split with `style.backgroundImage`
 *   swapped to the generated data-URI, encoded EXACTLY as
 *   useThemeStyles.ts's private `navBannerDecor()` does (whitespace-collapse
 *   + trim, then `encodeURIComponent`) — never a divergent encoding scheme
 *   (AC-UX-2, AC-UX-3).
 * - `treatments.dynamic?.banner` present AND `generatedSvg` is `null` ->
 *   returns the STATIC style unchanged — never a broken/blank value
 *   (AC-UX-3a). `hasDynamicBanner` stays `true` (declaration-based).
 * - Returns `null` only in the same degenerate case `computeThemeStyles`
 *   itself returns a `null` `bannerDecorStyle` (an empty static banner
 *   string) — mirrors the existing contract, never introduces a new one.
 */
function encodeSvgDataUri(svg: string): string {
  const collapsed = svg.replace(/\s+/g, ' ').trim();
  return `url("data:image/svg+xml,${encodeURIComponent(collapsed)}")`;
}

export function resolveDynamicBannerStyle(
  definition: AppThemeDefinition,
  generatedSvg: string | null,
): ResolveDynamicBannerStyleReturn | null {
  const { bannerDecorStyle } = computeThemeStyles(definition);
  if (bannerDecorStyle === null) return null;

  const hasDynamicBanner = Boolean(definition.treatments.dynamic?.banner);

  if (!hasDynamicBanner || generatedSvg === null) {
    return { hasDynamicBanner, boxProps: bannerDecorStyle.boxProps, style: bannerDecorStyle.style };
  }

  return {
    hasDynamicBanner: true,
    boxProps: bannerDecorStyle.boxProps,
    style: { ...bannerDecorStyle.style, backgroundImage: encodeSvgDataUri(generatedSvg) },
  };
}

/**
 * S4 (AC-A11Y-2, architecture.md Module Map: "Layout.tsx (modified) ...
 * render legibility scrim behind logo | Owned Data: scrim presence/contrast").
 *
 * Pure passthrough of the SAME declaration-based `hasDynamicBanner` boolean
 * S3 established on `ResolveDynamicBannerStyleReturn` (true whenever the
 * active theme's manifest DECLARES `treatments.dynamic.banner`, independent
 * of whether the most recent generation attempt succeeded — see that
 * field's docstring above). The scrim's presence MUST be gated on the exact
 * same semantic, not a fresh condition, so it never flickers off during the
 * AC-UX-3a static-fallback window.
 *
 * This is intentionally a one-line passthrough, not because it's a stub
 * awaiting more logic, but because the whole point of naming it is API
 * stability: it gives Layout.tsx an explicit, documented seam for "should I
 * show the scrim" instead of inlining `dynamicBanner?.hasDynamicBanner`
 * ad hoc at the render site. If a future story ever needs to narrow when
 * the scrim appears (e.g. a per-theme opt-out), this is the one place that
 * changes.
 */
export function shouldRenderScrim(hasDynamicBanner: boolean): boolean {
  return hasDynamicBanner;
}

/** Opaque black/white — the only two candidates `resolveScrimColor` picks between. */
const SCRIM_BLACK = '#000000';
const SCRIM_WHITE = '#ffffff';

/**
 * S4 (AC-A11Y-1, architecture.md Boundary Rule 9: reuse contrast.ts's
 * `wcagRatio(hexA, hexB)` primitive directly, at the existing
 * `WCAG_AA_THRESHOLD = 4.5`; `evaluateThemeContrast()` is NOT reusable here
 * since it takes a `ThemeManifest`, not arbitrary colors).
 *
 * WHY this isn't a single fixed scrim color: `brand.500` is not a fixed,
 * app-wide value — every theme (`app/src/themes/<id>/manifest.ts`) declares
 * its own 10-step `colors.brand` scale (index 5 = the 500 shade), and theme
 * authors are free to pick any hex (the pluggable-themes epic's whole
 * point). A scrim color hardcoded against one theme's brand.500 would
 * silently fail WCAG AA the moment a *different* theme (including Phase B's
 * still-undesigned `aquarelle`, the first theme that will actually declare
 * a dynamic banner) is active. This function is handed the ACTIVE theme's
 * real brand.500 hex at render time instead of a guessed constant.
 *
 * Because the scrim this backs is rendered fully opaque (no alpha), it
 * completely occludes whatever banner content sits behind it, so the only
 * free variable affecting contrast is the scrim's own color versus
 * `brand.500` — satisfying AC-A11Y-1's "regardless of the banner content
 * behind it" by construction, not by measurement.
 *
 * Picking whichever of pure black or pure white yields the higher ratio is
 * not just "usually good enough" — it is mathematically guaranteed to clear
 * the 4.5 threshold for ANY input color. For a color of relative luminance L
 * (0-1), ratio-vs-black = (L+0.05)/0.05 and ratio-vs-white = 1.05/(L+0.05).
 * Requiring BOTH to be < 4.5 simultaneously means L < 0.175 AND L > 0.1833,
 * which is impossible — so at least one of the two always reaches >= 4.5.
 * That is why this story does not need to special-case or re-verify against
 * Phase B's (still-undetermined) `aquarelle` brand.500 — the guarantee
 * holds for whatever value it turns out to be.
 */
export function resolveScrimColor(brand500Hex: string): string {
  return wcagRatio(SCRIM_BLACK, brand500Hex) >= wcagRatio(SCRIM_WHITE, brand500Hex) ? SCRIM_BLACK : SCRIM_WHITE;
}

/**
 * S5 (AC-PERF-2, architecture.md Module Map: "banner.worker (NEW) |
 * off-main-thread generation via postMessage"). The generation-request
 * shape passed to both the Worker (via postMessage) and the fallback path
 * (via generateViaFallback) — mirrors BannerWorkerRequest but declared here
 * (not imported) since useDynamicBanner.ts only ever holds a type-only
 * reference to banner.worker.ts.
 */
export type BannerGenerationParams = { style: StyleToken; kind: 'banner'; render?: Record<string, unknown> };

/**
 * Returns `requestIdleCallback` when the global exists, else a
 * `setTimeout(cb, 0)` shim — the static-export escape hatch (architecture.md
 * Boundary Rule 11) for when Worker construction/usage is unavailable or
 * throws. This repo's Vitest environment has no jsdom and no
 * requestIdleCallback global, so calling this in tests exercises the TRUE
 * fallback-of-fallback branch honestly (not a mocked stand-in) — see
 * verification.json VQ-S5-004.
 */
export function resolveIdleScheduler(): (callback: () => void) => void {
  const globalWithIdle = globalThis as { requestIdleCallback?: (callback: () => void) => void };
  if (typeof globalWithIdle.requestIdleCallback === 'function') {
    return (callback) => globalWithIdle.requestIdleCallback!(callback);
  }
  return (callback) => setTimeout(callback, 0);
}

/**
 * Calls `DYNAMIC_GENERATORS.watercolor(params.style, params.kind,
 * params.render)` inside a try/catch, returning the SVG string or `null` on
 * any throw — the exact same fail-soft contract S3's original synchronous
 * try/catch established (Boundary Rule 6), now reused by the
 * requestIdleCallback fallback path instead of running on the effect's
 * synchronous body.
 */
export function generateViaFallback(params: BannerGenerationParams): string | null {
  try {
    return DYNAMIC_GENERATORS.watercolor(params.style, params.kind, params.render);
  } catch {
    return null;
  }
}

/**
 * Defers a call to `generateViaFallback` through the given scheduler
 * (default: `resolveIdleScheduler()`), then invokes `onResult` with the
 * outcome. The `scheduler` parameter exists so tests can inject a
 * synchronous fake to assert the generator is genuinely reached through the
 * deferred path, in addition to exercising the real default scheduler.
 */
export function scheduleFallbackGeneration(
  params: BannerGenerationParams,
  onResult: (svg: string | null) => void,
  scheduler: (callback: () => void) => void = resolveIdleScheduler(),
): void {
  scheduler(() => onResult(generateViaFallback(params)));
}

/**
 * Pure mapping from the worker's postMessage response (or the hook's own
 * `{ ok: false }` stand-in for an onerror event) to the `generatedSvg` state
 * value — `ok: true` -> `svg`, `ok: false` -> `null`. Never throws.
 */
export function resolveWorkerMessageOutcome(response: BannerWorkerResponse): string | null {
  return response.ok ? response.svg : null;
}

/**
 * Client-only (post-hydration) hook. MUST be a THIN useEffect/useState
 * wrapper carrying NO independent decision branches of its own — all
 * decisions happen in resolveDynamicBannerStyle above (Boundary Rule 7).
 *
 * On mount, and whenever `definition` changes identity (theme change —
 * `APP_THEMES[id]` entries are referentially stable per theme, so this does
 * NOT re-fire on unrelated re-renders), if `treatments.dynamic?.banner` is
 * present: generation now runs OFF the synchronous effect body (S5,
 * AC-PERF-2) — either via `banner.worker.ts` (constructed with Next.js's
 * native `new Worker(new URL(...))` ESM pattern and driven by
 * `postMessage`/`onmessage`/`onerror`, mapped through
 * `resolveWorkerMessageOutcome`) or, if Worker construction/usage is
 * unavailable or throws, via `scheduleFallbackGeneration`'s deferred
 * `requestIdleCallback`/`setTimeout` path — never by calling
 * `DYNAMIC_GENERATORS.watercolor` directly on this synchronous body. Either
 * path is fail-soft (Boundary Rule 6: never throws uncaught) and stores the
 * resulting string (or `null` on failure) in state via `applyResult`, which
 * `resolveDynamicBannerStyle` then turns into the returned style. Each mount
 * starts fresh (no cross-mount caching/memoization of `generatedSvg`), so two
 * separate mounts produce two independently-random SVGs (AC-UX-3), since
 * `DYNAMIC_GENERATORS.watercolor` itself varies its output per call.
 */
/** Measured pixel size of the header box the dynamic banner fills (Layout.tsx). */
export type BannerSize = { width: number; height: number };

export function useDynamicBanner(
  definition: AppThemeDefinition,
  bannerSize?: BannerSize,
): ResolveDynamicBannerStyleReturn | null {
  const [generatedSvg, setGeneratedSvg] = useState<string | null>(null);
  // Distinguishes the two `generatedSvg === null` cases: `false` = generation
  // still pending (show an empty banner, no static placeholder → no swap on
  // load); `true` = generation genuinely failed (revert to the static
  // fallback, AC-UX-3a). Without this the pending and failed states are
  // indistinguishable and the static would flash before every dynamic banner.
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // Reset first: a fresh definition/mount must never keep a stale
    // generatedSvg from a previous definition around while the new
    // attempt is in flight (AC-UX-3a's "no broken/blank banner" story
    // also covers a theme change that removes the dynamic declaration).
    setGeneratedSvg(null);
    setFailed(false);

    const dynamicBanner = definition.treatments.dynamic?.banner;
    if (!dynamicBanner) return;

    // Wait for the header box's measured size before generating, so the SVG is
    // drawn at exactly the box size (1:1) instead of an image stretched to fit.
    // Layout.tsx measures the box on mount and re-renders with the size,
    // re-firing this effect. Until then the banner is blank (pending). Measured
    // once per load — a later window resize does not regenerate (by design).
    if (!(bannerSize && bannerSize.width > 0 && bannerSize.height > 0)) return;

    const params: BannerGenerationParams = {
      style: dynamicBanner.style,
      kind: 'banner',
      render: { ...dynamicBanner.render, width: bannerSize.width, height: bannerSize.height },
    };

    // `cancelled` guards against a stale worker/fallback result from a
    // superseded effect run (theme change, unmount) ever clobbering newer
    // state — set on cleanup, checked before every setGeneratedSvg call from
    // an async callback.
    let cancelled = false;
    let worker: Worker | undefined;

    const applyResult = (svg: string | null) => {
      if (cancelled) return;
      // `null` here means a genuine generation failure (worker `ok:false` or a
      // fallback throw) — mark failed so the static fallback shows. A non-null
      // string is the generated art.
      if (svg === null) setFailed(true);
      else setGeneratedSvg(svg);
    };

    try {
      // Guard Worker availability explicitly (SSR/build-time globals, or a
      // browser without Worker support) rather than relying solely on the
      // constructor throwing — both routes fall through to the same catch.
      if (typeof Worker === 'undefined') {
        throw new Error('Worker is not available in this environment');
      }
      worker = new Worker(new URL('../workers/banner.worker.ts', import.meta.url));
      worker.onmessage = (event: MessageEvent<BannerWorkerResponse>) => {
        applyResult(resolveWorkerMessageOutcome(event.data));
      };
      worker.onerror = () => {
        // An uncaught worker-thread error (e.g. a module-load failure) must
        // never propagate — map it to the identical ok:false outcome a
        // generator throw inside the worker already produces (AC-UX-3a
        // extended to the off-thread path, Boundary Rule 6).
        applyResult(resolveWorkerMessageOutcome({ ok: false }));
      };
      worker.postMessage(params);
    } catch {
      // Worker construction/usage is unavailable or threw — the
      // static-export escape hatch (architecture.md Boundary Rule 11).
      // Route through the scheduler so generation is never on the
      // synchronous effect/render path either way.
      scheduleFallbackGeneration(params, applyResult);
    }

    return () => {
      cancelled = true;
      worker?.terminate();
    };
    // Depend on the primitive dimensions, not the `bannerSize` object identity,
    // so a fresh object with the same size does not re-fire generation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [definition, bannerSize?.width, bannerSize?.height]);

  const resolved = resolveDynamicBannerStyle(definition, generatedSvg);
  // Pending-window suppression: when this theme DECLARES a dynamic banner but
  // generation has neither produced a result nor failed yet, blank the
  // background-image so the box renders empty instead of the static
  // placeholder. This removes the static→dynamic swap on load (the generated
  // art is the FIRST banner the user sees). On genuine failure `failed` is
  // true, so `resolved` (the static fallback) is returned unchanged — AC-UX-3a.
  if (resolved && Boolean(definition.treatments.dynamic?.banner) && generatedSvg === null && !failed) {
    return { ...resolved, style: { ...resolved.style, backgroundImage: 'none' } };
  }
  return resolved;
}
