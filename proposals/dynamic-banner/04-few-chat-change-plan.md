# few.chat change plan — dynamic (per-load) theme elements

**Status:** Draft — engineering plan for our side, grounded in the ink source (sessions
read 2026-07-05). This is the "what we change here" picture.
**Owner:** few.chat

## TL;DR

Non-determinism is the feature: each page load renders **unique** visuals that stay
**within the selected theme**. We extend the pluggable-theme system so that **any element
can be dynamic** (generated per load), not just the banner — a generic capability. The
first element we implement is the banner; the abstraction is generic (background, and
later button/card fills, follow the same path).

Each dynamic element calls ink's generator with a fresh (unseeded) call each load, while
**pinning four colour-identity params** so only composition varies, never colour
character. **We ship v1 with the ink generator exactly as it is today — zero ink code
changes** — on a **brand-new light watercolour theme** (working name `aquarelle`), dropped
into the theme folder like any other theme. Delivery of the ink module is a **git
dependency on ink's private repo** (see `05-ink-artifact-publication-proposal.md`); the
themeable base colour for *dark* themes is a later scope expansion, not a v1 blocker.
Everything else is our-side code: a generic dynamic-element schema, a generator adapter,
a client-only render hook, a legibility scrim, the new theme, and tests.

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

### 1. Schema — `app/src/themes/schema.ts` (generic dynamic elements)
Add an optional **`dynamic`** map to `TreatmentsSchema` — a generic binding of *any*
surface to a generator, not a banner-specific field. Banner is the first key we implement;
`background`, and later `button`/`card`, use the identical shape.

```ts
const DynamicElementSchema = z.object({
  generator: z.enum(['watercolor']),          // closed catalog union, like iconSet
  style: z.object({                            // the generic "style token" (colour identity)
    anchorHue:  z.number().min(0).max(359),
    scheme:     z.enum(['monochromatic','analogous','analogous-accent',
                        'split-complementary','triadic','complementary']),
    saturation: z.number().min(20).max(100),
    lightness:  z.number().min(20).max(75),
  }).strict(),
  clip:   z.enum(['button','card','avatar']).optional(),  // consumer-side shape to mask a fill into
  render: z.object({ /* zones, layerProb, splatter, halo, grain, bleed,
                        smoothness, darkening */ }).partial().strict().optional(),
}).strict();

// in TreatmentsSchema:
dynamic: z.object({
  banner:     DynamicElementSchema.optional(),
  background: DynamicElementSchema.optional(),
  // button / card added when we implement clip-into-shape
}).strict().optional()
```
- Every static treatment (incl. the required static `banner` fallback) is **unchanged**.
  `dynamic` is purely additive and opt-in.
- The `generator` enum joins the existing catalog check → unknown generator fails the
  build, like the other treatment unions. Zod stays build/test-only; the generator is
  referenced by name and lives in `treatments/`, holding the "manifest is pure data"
  invariant.
- `clip` is where the §4-boundary of `05` lands on our side: for a shaped element we take
  ink's generic **fill** and mask it into the component shape ourselves.

### 2. Generator adapter — `app/src/themes/treatments/dynamicVisuals.ts` (NEW)
Wraps the ink module behind a name → function registry, translating our `style` token
into ink's params and forcing the element kind we need:

```ts
import { renderSVG, randomizeParams } from '@ink/visuals';   // git dependency, see 05
export const DYNAMIC_GENERATORS = {
  watercolor: (style, kind, render = {}) => {
    const p = randomizeParams();
    Object.assign(p, render, style, { format: kind === 'banner' ? 'banner' : 'square' });
    return renderSVG({ params: p }).svg;                      // seed omitted → fresh each call
  },
} as const;
```
**Delivery is decided:** a **git dependency on ink's private repo** (`05`). The adapter's
import line is the seam; if ink ships the generic `render(req)` wrapper (`05` §3) we call
that instead of `renderSVG`+`randomizeParams`, and this adapter shrinks to a pass-through.

### 3. Client render hook — `app/src/hooks/useDynamicBanner.ts` (NEW)
- `computeThemeStyles()` (the pure, unit-tested path) **stays unchanged**, still
  returning the **static** `bannerDecorStyle` from `treatments.banner`. That is the
  SSR/first-paint/no-JS image.
- `useDynamicBanner(definition)` runs client-only (`useEffect`, post-hydration): if
  `treatments.dynamic?.banner` is present, generate a fresh SVG, encode it as a data-URI
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

### 8. The new theme — `app/src/themes/aquarelle/manifest.ts` (NEW, working name)
A **brand-new** theme (not derived from `calm` or any existing one), authored as pure
data and dropped into the themes folder like any other — the pluggable system picks it up
with no shared-file edits. It sets a light palette and declares
`treatments.dynamic.banner = { generator: 'watercolor', style: {…}, render: {…lite…} }`,
plus a frozen static `banner` fallback (§6). This theme is the proof that the generic
dynamic-element extension is genuinely drop-in.

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

- **v1:** the brand-new light `aquarelle` theme with a dynamic banner,
  `status: 'experimental'`, generator as-is, consumed as a git dependency on ink's
  private repo.
- **v2:** dark themes (needs ink's generic `baseColor`, `05` §5.4) and additional dynamic
  element kinds (`background`, then `button`/`card` via `clip`).

## External dependencies

- **v1:** a published ink artifact to depend on — the subject of
  `05-ink-artifact-publication-proposal.md`. Nothing else.
- **v2:** ink's generic `baseColor` (dark themes) and arbitrary sizing (non-banner
  elements), both folded into `05` §5.
