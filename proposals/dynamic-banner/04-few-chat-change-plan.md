# few.chat change plan — dynamic (per-load) banner images

**Status:** Draft — engineering plan for our side, grounded in the ink source (sessions
read 2026-07-05). This is the "what we change here" picture.
**Owner:** few.chat

## TL;DR

Non-determinism is the feature: each page load renders a **unique** watercolour that
stays **within the selected theme**. We achieve that by calling ink's `renderSVG` with
a fresh (unseeded) call each load, while **pinning four colour-identity params** from
the theme so only composition varies, never colour character.

**We can ship v1 with the ink generator exactly as it is today — zero ink code
changes** — on a *light* theme (its base tone is a fixed warm off-white). The only ink
dependency, a themeable base colour for *dark* themes, is a later scope expansion, not a
v1 blocker. Everything else is our-side code: a schema field, a generator adapter, a
client-only render hook, a legibility scrim, and tests.

## The mechanism (verified against `tools/watercolor/svg.js`)

- `renderSVG({ params })` returns a **self-contained SVG string** (no scripts, no
  external refs, opaque base, seed-namespaced filter ids) — zero runtime deps.
- **Omitting `seed` auto-randomizes each call** → per-load uniqueness for free.
- **Colour identity is pinned by 4 params**; everything else (blob positions, layers,
  texture) varies per call. Pinning these four fixes hue family + saturation/lightness
  band; only a small, bounded, *desirable* per-zone wobble (≤ ±7° hue) remains.
- **Partial `params` breaks** (missing fields → `NaN` geometry). The correct call fills
  all fields first, then overrides the identity four:

```js
const p = randomizeParams();                 // all 17 fields, fresh via Math.random()
Object.assign(p, renderKnobs, identity, { format: 'banner' });   // identity wins
const { svg } = renderSVG({ params: p });     // seed omitted → geometry also fresh
```

- **Stateless & leak-free** — safe to call thousands of times a session; no module
  state, no cross-call dependency.
- **Web-Worker-safe** — no DOM/window/document; pure `Math`/`Array`/`JSON`/`btoa`. We can
  generate off the main thread and `postMessage` the string back.

### The theme-identity envelope (what a theme author pins)

| Param | Type / range | Role |
|---|---|---|
| `anchorHue` | number 0–359 | the theme's hue |
| `scheme` | `monochromatic` \| `analogous` \| `analogous-accent` \| `split-complementary` \| `triadic` \| `complementary` | harmony |
| `saturation` | number 20–100 | saturation band |
| `lightness` | number 20–75 | lightness band |

Optional perf/look knobs (see Performance): `zones`, `layerProb`, `splatter`, `halo`,
`grain`, `bleed`, `smoothness`, `darkening`. `format` is forced to `banner` by our
adapter, not author-set.

## Change list (by file)

### 1. Schema — `app/src/themes/schema.ts`
Add an optional `bannerDynamic` to `TreatmentsSchema` (sibling of the still-required
static `banner`):

```ts
bannerDynamic: z.object({
  generator: z.enum(['watercolor']),          // closed catalog union, like iconSet
  identity: z.object({
    anchorHue:  z.number().min(0).max(359),
    scheme:     z.enum(['monochromatic','analogous','analogous-accent',
                        'split-complementary','triadic','complementary']),
    saturation: z.number().min(20).max(100),
    lightness:  z.number().min(20).max(75),
  }).strict(),
  render: z.object({ /* zones, layerProb, splatter, halo, grain, bleed,
                        smoothness, darkening */ }).partial().strict().optional(),
}).strict().optional()
```
- `treatments.banner` (static SVG string) **stays required** — it's the fallback.
- The `generator` enum joins the existing catalog check → unknown generator fails the
  build, exactly like the other treatment unions. Zod stays build/test-only; the
  generator function is referenced by name and lives in `treatments/`, so this holds the
  "manifest is pure data" invariant.

### 2. Generator adapter — `app/src/themes/treatments/banners.ts` (NEW)
Wraps the vendored/imported ink module behind a name → function registry:

```ts
import { renderSVG, randomizeParams } from '<watercolor module>';
export const BANNER_GENERATORS = {
  watercolor: (identity, render = {}) => {
    const p = randomizeParams();
    Object.assign(p, render, identity, { format: 'banner' });  // identity wins, banner forced
    return renderSVG({ params: p }).svg;                       // fresh each call
  },
} as const;
```
Delivery of the ink module (vendor the single file vs. npm dependency) is the open
product-owner decision — the adapter's import line is the only thing that changes.

### 3. Client render hook — `app/src/hooks/useDynamicBanner.ts` (NEW)
- `computeThemeStyles()` (the pure, unit-tested path) **stays unchanged**, still
  returning the **static** `bannerDecorStyle` from `treatments.banner`. That is the
  SSR/first-paint/no-JS image.
- `useDynamicBanner(definition)` runs client-only (`useEffect`, post-hydration): if
  `treatments.bannerDynamic` is present, generate a fresh SVG, encode it as a data-URI
  the same way `navBannerDecor` does (`url("data:image/svg+xml,${encodeURIComponent}")`,
  on the raw `style` prop — Chakra drops data-URI values through its style pipeline),
  and swap `bannerDecorStyle.style.backgroundImage`. Regenerates on mount (= per reload)
  and on theme change (`definition.id`). No hydration mismatch — the swap is strictly
  post-mount.

### 4. Layout render site — `app/src/components/Layout.tsx`
- **Reserve** the banner box (already fixed `h: 96px`, `w: clamp(220px,33vw,420px)`) and
  **cross-fade** the generated image in over the static one (CLS control).
- **Legibility scrim:** a small gradient/opaque patch behind the nav logo
  (`Text color="brand.500"`, leftmost). This guarantees logo contrast **independent of
  what the banner paints** — essential now that banner content is random. Legibility is
  ours, not the generator's (no safe-zone feature needed from ink).

### 5. Web Worker — `app/src/workers/banner.worker.ts` (NEW, recommended)
Generation is ~50–150 ms in the lite config — enough to jank the main thread. Since
`renderSVG` is Worker-safe, run it in a worker and `postMessage` the string back;
fall back to `requestIdleCallback` on the main thread if worker bundling under static
export proves fussy. (Validate `new Worker(new URL(...), import.meta.url)` bundles under
`output: 'export'` — a build detail, not a blocker.)

### 6. Static fallback capture — the theme's `treatments.banner`
For a dynamic theme, freeze **one representative render** (run the generator once, paste
the SVG string) as the required static `banner`. No-JS/first-paint then shows an
on-theme watercolour. No determinism needed — it's a one-time captured sample.

### 7. Validation gate + tests
- `themes-validation` / registry generator: add the `generator` enum-catalog check.
- Tests (mock the generator in unit tests for speed; one integration test uses the real
  module): (a) static fallback renders; (b) on mount the background swaps to a valid
  data-URI SVG (assert it changed); (c) the scrim guarantees `brand.500` logo contrast,
  independent of banner content; (d) the adapter output is self-contained (no `<script>`,
  has `viewBox`). **No per-seed determinism tests** — non-determinism is intended.

## Performance plan

CPU scales with `zones × layers`; paint is dominated by `feTurbulence`(×3) +
`feDisplacementMap` + per-layer blur. Default to a **lite banner config** in the theme
for mobile:

```js
{ zones:2, layerProb:0, splatter:0, halo:0, grain:0.004, bleed:5, smoothness:6, darkening:1 }
// ≈ 6 <path> elements, ~8–15 KB SVG, ~50–150 ms generation
```
Generate in the worker/idle callback and cross-fade — the static fallback covers the
gap. Measure gen + paint on a low-end device before promoting out of `experimental`.

## Scope & rollout

- **v1:** one **light** watercolour theme, `status: 'experimental'`, generator as-is.
- **v2 (dark themes):** needs the single ink change — a `params.background` override for
  the hardcoded `#f4efe6` base (tracked in `03-asks-for-ink.md`). Everything else already
  works.

## The only external dependency

`params.background` in the ink generator — needed **only** to extend to dark themes.
v1 needs nothing from ink beyond a delivery decision (vendor vs npm).
