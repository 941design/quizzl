// app/src/themes/treatments/dynamicVisuals.ts
//
// DYNAMIC_GENERATORS name->function registry (architecture.md Module Map:
// "dynamicVisuals (Phase B, modified)"; Seam Contracts: "DYNAMIC_GENERATORS
// registry"; Boundary Rule 2: single-import-site invariant, AC-STRUCT-4).
//
// This is the ONE `treatments/*` module architecture.md's Paradigm section
// carves out as an intentional, scoped precedent-break: every other
// treatments/* file (elevation.ts, iconSets.ts, patterns.ts) is a pure,
// synchronous lookup table with only type-only Chakra imports.
// dynamicVisuals.ts is the first with (a) actual computation instead of a
// static lookup, and (b) a real runtime import of the generator — the STUB
// stood in for this in Phase A (mock MOCK-02-001, now resolved); `@rotheric/
// visuals` (pinned to git tag `visuals-v0.1.2`) is the real Phase B
// dependency. AC-DEP-1: only this file's import line and package.json's git
// dependency entry changed — the exported `DYNAMIC_GENERATORS` shape is
// byte-identical to Phase A. No other file in app/src may import the
// package directly (AC-STRUCT-4), enforced by the resolved-import scanner in
// themes-validation.test.ts (the same parse-imports / runtime-vs-type-only
// mechanism that backs the zod boundary, now targeting the bare
// `@rotheric/visuals` package specifier). Consumers importing the
// `DYNAMIC_GENERATORS` registry from this file (useDynamicBanner.ts,
// banner.worker.ts) are the intended seam, not a violation.
//
// Install note (rotheric/ink is a private repo): package.json declares
// `git+https://github.com/rotheric/ink.git#visuals-v0.1.2`, but npm always
// canonicalizes a GitHub-hosted git dependency's package-lock.json
// `resolved` field to `git+ssh://...` regardless of the scheme given in
// package.json — confirmed by regenerating the lockfile from this explicit
// https spec and observing the `resolved` string unchanged. That string is
// cosmetic, not literal: verified via a genuine cold-npm-cache `npm ci`
// with git's ssh binary forced to fail (`GIT_SSH=/bin/false`), which still
// installed `@rotheric/visuals` successfully. The real, unavoidable
// prerequisite on any build machine is GitHub read access to the private
// `rotheric/ink` repo via *some* git-reachable credential — either an SSH
// key, or (as configured on this project's dev machines today, per
// `gh auth status` showing protocol=https) an HTTPS credential/token. SSH
// access is not actually required or relied upon.
//
// Call shape (spec.md §5, the converged ink contract):
//   const p = randomizeParams(); Object.assign(p, render, style, { format });
//   renderSVG({ params: p })
// — `render` is applied BEFORE `style` so the pinned colour identity always
// wins any conflicting key a caller-supplied `render` knob also sets (see
// the `watercolor` docstring below for the full contract). Seed is omitted
// so each call produces fresh geometry. The `watercolor`
// entry below owns this shape end-to-end (never partially duplicated in
// useDynamicBanner.ts or banner.worker.ts — architecture.md Seam Contracts)
// and forces the format/size to few.chat's banner envelope (96px tall,
// 420px nominal width — ink-channel-log.md IQ6), regardless of any `render`
// knob a caller passes: the real package's `Params.width`/`Params.height`
// input fields (when both present/valid) override its named `format`
// preset lookup entirely (confirmed against the real package, S7), which is
// exactly how this forced envelope is applied below. `render` (the perf-
// knob escape hatch, schema.ts's `DynamicElement.render`) is forwarded
// as-is into the real engine's `Params` before the pinned style/forced
// envelope are applied, so a caller-supplied knob can tune composition
// (e.g. `zones`, `layerProb`) but can never override the pinned StyleToken
// identity (anchorHue/scheme/saturation/lightness) or size. Note this does
// NOT cover `Params` fields StyleToken has no equivalent for — e.g. a
// `render.baseColor` would survive the Object.assign and tint the paper
// fill, since there is no `style.baseColor` to win the conflict.
//
// StyleToken is DERIVED by indexing off `ThemeManifest` (never hand-
// redeclared) per S1's examiner-verified pattern (architecture.json's
// public_api entry) — this file has no zod dependency and only ever imports
// the inferred TYPE from schema.ts, never the runtime schema.
import type { ThemeManifest } from '@/src/themes/schema';
import { randomizeParams, renderSVG } from '@rotheric/visuals';

type DynamicTreatments = NonNullable<ThemeManifest['treatments']['dynamic']>;
type DynamicElement = NonNullable<DynamicTreatments['banner']>;

/**
 * The pinned colour identity a generator call must reflect (spec.md §5,
 * `{ anchorHue, scheme, saturation, lightness }`). Derived by indexing off
 * `ThemeManifest['treatments']['dynamic']['banner']['style']` rather than
 * hand-redeclared, so this type can never silently drift from schema.ts's
 * `StyleTokenSchema`.
 */
export type StyleToken = DynamicElement['style'];

/**
 * few.chat's DEFAULT banner size (spec.md §6 / ink-channel-log.md IQ6): 420x96,
 * used as the fallback when no caller size is supplied (the frozen static
 * fallback's own dimensions).
 *
 * Both dimensions are now DYNAMIC (see `resolveBannerDims` below): the dynamic-
 * banner theme (aquarelle) renders its watercolor as the FULL header
 * background, so `useDynamicBanner`/Layout.tsx measure the header box's real
 * width AND height and pass them through `render.width`/`render.height`, and
 * the SVG is generated at exactly that size and shown 1:1 (no stretch). The
 * previous 220-420px width clamp / fixed-96 height (the small corner-box
 * "envelope") is GONE — a full-header banner is intentionally a much wider
 * aspect than `@rotheric/visuals`'s verified 2.29:1-4.375:1 sweep range, so no
 * aspect clamp is imposed here; only the engine's own MAX_DIMENSION guard
 * (10000) applies. `@rotheric/visuals`'s `Params.width`/`.height` fields (when
 * both present and valid) override its named `format` preset lookup entirely
 * (confirmed against the real package during S7).
 */
const BANNER_FORMAT = { width: 420, height: 96 } as const;
/** The engine's own upper bound on a canvas dimension (Params.width/.height). */
const MAX_DIMENSION = 10000;

/**
 * Resolve the SVG width/height from optional caller-supplied `render.width`
 * and `render.height` (the header box's measured pixel size, threaded through
 * by `useDynamicBanner` — Layout.tsx). BOTH must be finite, positive, and
 * within `MAX_DIMENSION` to take effect (rounded); otherwise sizing falls back
 * to `BANNER_FORMAT` (420x96). Both-or-neither mirrors the engine's own
 * custom-size contract (a lone dimension is ignored).
 */
function resolveBannerDims(render?: Record<string, unknown>): { width: number; height: number } {
  const w = render?.width;
  const h = render?.height;
  const valid = (v: unknown): v is number =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= MAX_DIMENSION;
  if (valid(w) && valid(h)) {
    return { width: Math.round(w), height: Math.round(h) };
  }
  return { width: BANNER_FORMAT.width, height: BANNER_FORMAT.height };
}

// ---------------------------------------------------------------------------
// DYNAMIC_GENERATORS — the public registry (architecture.md Seam Contracts:
// "DYNAMIC_GENERATORS registry (dynamicVisuals.ts -> useDynamicBanner.ts)").
// ---------------------------------------------------------------------------

/**
 * `watercolor(style, kind, render?)` owns the full `randomizeParams()` +
 * pinned-style-override call shape (spec.md §5) and always forces the
 * result to few.chat's banner envelope. `kind` is accepted (and currently
 * unused — v1 only ever generates banners) for forward-compatibility with
 * v2's non-banner elements (`background`, `clip`'d button/card fills) — v1
 * only ever passes `'banner'`. `render` is the perf-knob escape hatch
 * (schema.ts's `DynamicElement.render`, e.g. `zones`/`layerProb`/other
 * `@rotheric/visuals` `Params` composition fields) and is forwarded as-is
 * into the real engine's params *before* the pinned `style` fields and the
 * forced envelope are applied, so a caller can tune composition but can
 * never override the pinned StyleToken identity (anchorHue/scheme/
 * saturation/lightness). WIDTH and HEIGHT, however, are now caller-influenced
 * on purpose: `render.width`/`render.height` (the header box's measured px
 * size) set the SVG size via `resolveBannerDims`, so the full-header banner
 * renders at exact size instead of a stretched fixed image. `render.baseColor`
 * similarly survives (no `style.baseColor` counterpart) and tints/transparents
 * the paper fill.
 *
 * Only `svg` is consumed from `renderSVG`'s `{ svg, id }` return contract —
 * `id` is a reproducibility handle few.chat has no use for (dynamicVisuals.ts
 * never needs to replay an exact prior render) and is intentionally dropped.
 */
export const DYNAMIC_GENERATORS = {
  watercolor(style: StyleToken, _kind: 'banner', render?: Record<string, unknown>): string {
    const p = randomizeParams();
    // `format: 'banner'` is a harmless, intentional fallback label — with
    // both `width` and `height` present, the package's own Params contract
    // has them override the named `format` preset lookup entirely, so this
    // key is never actually consulted. Kept for readability/self-description.
    // `width`/`height` are resolved from optional `render.width`/`render.height`
    // (the header box's measured size), defaulting to 420x96. Both are assigned
    // LAST so they win any conflicting key `render`/`style` also set.
    Object.assign(p, render, style, { format: 'banner', ...resolveBannerDims(render) });
    return renderSVG({ params: p }).svg;
  },
} satisfies Record<string, (style: StyleToken, kind: 'banner', render?: Record<string, unknown>) => string>;
