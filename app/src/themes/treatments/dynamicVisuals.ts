// app/src/themes/treatments/dynamicVisuals.ts
//
// DYNAMIC_GENERATORS name->function registry (architecture.md Module Map:
// "dynamicVisuals (NEW)"; Seam Contracts: "DYNAMIC_GENERATORS registry";
// Boundary Rule 2: single-import-site invariant, AC-STRUCT-4).
//
// This is the ONE `treatments/*` module architecture.md's Paradigm section
// carves out as an intentional, scoped precedent-break: every other
// treatments/* file (elevation.ts, iconSets.ts, patterns.ts) is a pure,
// synchronous lookup table with only type-only Chakra imports.
// dynamicVisuals.ts is the first with (a) actual computation instead of a
// static lookup, and (b) a real runtime import of the generator — the STUB
// below in Phase A (mock MOCK-02-001), `@ink/visuals` in Phase B (S7). The
// swap from stub to the real package touches ONLY the "STUB IMPLEMENTATION
// SEAM" block below — the exported `DYNAMIC_GENERATORS` shape does not
// change (AC-DEP-1) — and no other file in app/src may import either the
// stub or the real package (AC-STRUCT-4), enforced by the resolved-import
// scanner in themes-validation.test.ts (the same parse-imports /
// runtime-vs-type-only mechanism that backs the zod boundary, targeting the
// bare `@ink/visuals` package specifier — vacuous in Phase A while the stub
// is inline, active in Phase B/S7). Consumers importing the
// `DYNAMIC_GENERATORS` registry from this file (useDynamicBanner.ts,
// banner.worker.ts) are the intended seam, not a violation.
//
// Call shape (spec.md §5, the converged ink contract, verbatim):
//   const p = randomizeParams(); Object.assign(p, style, { format });
//   renderSVG({ params: p })
// — seed omitted so each call produces fresh geometry. The `watercolor`
// entry below owns this shape end-to-end (never partially duplicated in
// useDynamicBanner.ts or banner.worker.ts — architecture.md Seam Contracts)
// and forces the format/size to few.chat's banner envelope (96px tall,
// 220-420px wide — ink-channel-log.md IQ6), regardless of any `render` knob
// a caller passes.
//
// StyleToken is DERIVED by indexing off `ThemeManifest` (never hand-
// redeclared) per S1's examiner-verified pattern (architecture.json's
// public_api entry) — this file has no zod dependency and only ever imports
// the inferred TYPE from schema.ts, never the runtime schema.
import type { ThemeManifest } from '@/src/themes/schema';

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
 * few.chat's fixed banner envelope (spec.md §6 / ink-channel-log.md IQ6):
 * height is always exactly 96 CSS px; width is pinned to the nominal target
 * (420px) within the 220-420px range `useThemeStyles.ts`'s `navBannerDecor()`
 * reserves via `clamp(220px, 33vw, 420px)`. The `watercolor` entry below
 * forces every call to this exact envelope — it is never influenced by a
 * caller's `render` knobs.
 */
const BANNER_FORMAT = { width: 420, height: 96 } as const;

// ---------------------------------------------------------------------------
// STUB IMPLEMENTATION SEAM — Phase A only (mock MOCK-02-001). Everything in
// this block stands in for the not-yet-published `@ink/visuals` git
// dependency and is replaced wholesale in Phase B (S7); the public
// `DYNAMIC_GENERATORS` registry below is what Phase B must keep stable.
// ---------------------------------------------------------------------------

/**
 * Internal randomized-composition params — this stub's stand-in for ink's
 * own `randomizeParams()`. Intentionally NOT part of `StyleToken`: these
 * fields represent the per-call composition randomness the pinned style
 * token does not (and must not) control. Never exported; callers only ever
 * observe the final SVG string via `DYNAMIC_GENERATORS.watercolor`.
 */
type StubRandomParams = {
  blobSeedX: number;
  blobSeedY: number;
  blobRadius: number;
  strokeJitter: number;
};

/** Stub stand-in for ink's `randomizeParams()` — fresh values on every call, no seed, so composition varies per invocation (AC-UX-1). */
function randomizeParams(): StubRandomParams {
  return {
    blobSeedX: Math.random(),
    blobSeedY: Math.random(),
    blobRadius: 0.35 + Math.random() * 0.3,
    strokeJitter: Math.random(),
  };
}

/** Builds an `hsl()` color string from pinned StyleToken fields — colour identity, never randomized composition, flows through here. */
function hsl(hue: number, saturation: number, lightness: number): string {
  return `hsl(${hue.toFixed(1)}, ${saturation.toFixed(1)}%, ${lightness.toFixed(1)}%)`;
}

type MergedWatercolorParams = StubRandomParams & StyleToken & { format: { width: number; height: number } };

/**
 * Builds a valid, self-contained placeholder SVG string (AC-STRUCT-6: no
 * `<script>` element, no external `href`/`url()` reference — every dynamic
 * value below is embedded as a plain numeric/color attribute value, never
 * inside an executable or resource-reference context) that varies its blob
 * geometry per call (AC-UX-1's non-determinism contract) while every colour
 * value is derived exclusively from the pinned `StyleToken` fields (never
 * from the random params) plus the forced width/height. This stands in for
 * `@ink/visuals`'s `renderSVG({ params })` until Phase B (S7).
 */
function buildPlaceholderSvg(params: MergedWatercolorParams): string {
  const { blobSeedX, blobSeedY, blobRadius, strokeJitter, anchorHue, saturation, lightness, format } = params;
  const { width, height } = format;

  const baseFill = hsl(anchorHue, saturation, lightness);
  const accentHue = (anchorHue + 40 + strokeJitter * 20) % 360;
  const accentFill = hsl(accentHue, saturation, Math.min(75, lightness + 10));

  const cx1 = blobSeedX * width;
  const cy1 = blobSeedY * height;
  const r1 = blobRadius * Math.min(width, height);
  const cx2 = width - cx1;
  const cy2 = height - cy1;
  const r2 = blobRadius * 0.7 * Math.min(width, height);

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" ` +
    `width="${width}" height="${height}">` +
    `<rect width="${width}" height="${height}" fill="${baseFill}" />` +
    `<circle cx="${cx1.toFixed(2)}" cy="${cy1.toFixed(2)}" r="${r1.toFixed(2)}" fill="${accentFill}" opacity="0.55" />` +
    `<circle cx="${cx2.toFixed(2)}" cy="${cy2.toFixed(2)}" r="${r2.toFixed(2)}" fill="${baseFill}" opacity="0.4" />` +
    `</svg>`
  );
}

// ---------------------------------------------------------------------------
// DYNAMIC_GENERATORS — the public registry (architecture.md Seam Contracts:
// "DYNAMIC_GENERATORS registry (dynamicVisuals.ts -> useDynamicBanner.ts)").
// ---------------------------------------------------------------------------

/**
 * `watercolor(style, kind, render?)` owns the full `randomizeParams()` +
 * pinned-style-override call shape (spec.md §5) and always forces the
 * result to few.chat's banner envelope. `kind` is accepted (and currently
 * unused by the stub) for forward-compatibility with v2's non-banner
 * elements (`background`, `clip`'d button/card fills) — Phase A only ever
 * passes `'banner'`. `render` is the perf-knob escape hatch (schema.ts's
 * `DynamicElement.render`); the stub ignores it, the real generator (Phase
 * B) will forward it as-is.
 */
export const DYNAMIC_GENERATORS = {
  watercolor(style: StyleToken, _kind: 'banner', _render?: Record<string, unknown>): string {
    const p = randomizeParams();
    const merged: MergedWatercolorParams = Object.assign({}, p, style, { format: BANNER_FORMAT });
    return buildPlaceholderSvg(merged);
  },
} satisfies Record<string, (style: StyleToken, kind: 'banner', render?: Record<string, unknown>) => string>;
