# Feature Request Specification — Dynamic Theme Visuals

> Intended for implementation via the base plugin `/base:feature` workflow.
> Companion documents (authoritative on conflict): `proposals/dynamic-banner/04-few-chat-change-plan.md`
> (our engineering plan), `proposals/dynamic-banner/05-ink-artifact-publication-proposal.md`
> (the ink library contract), and `proposals/dynamic-banner/ink-channel-log.md`
> (the converged Q&A with ink). The ink integration contract is **fully converged**, and ink
> has now published its v0 release (`visuals-v0.1.2`, verified 2026-07-06) — see §5 (the v0
> gate) and §7 (phasing) and the `## Amendments` entry below for corrected naming.

## 1. Motivation

The pluggable-theme system (`app/src/themes/`) resolves every theme at **build time**: a theme's
banner is a **literal SVG string** (`treatments.banner`, `app/src/themes/schema.ts`), baked once and
served identically on every load. We want a theme whose decorative banner is **regenerated in the
browser on every page load** — a fresh, unique watercolour each time — while keeping the manifest pure
data, the palette static and contrast-checked, and the static-export build model untouched.

This is not a theme-authoring gap that a new static value could fill: producing a *new* image per load
requires code that runs at load time. So it is a **rendering-model capability** that must live in shared
app code, driven by manifest data — exactly the "named treatment, implementation in shared code"
pattern the theme system already uses for elevations, patterns, and icon sets.

The image generator itself is supplied by the external **ink** project (a watercolour SVG generator),
consumed as a versioned, private **git dependency** behind a thin adapter we own. The generator is
generic and makes no assumptions about few.chat; all app-specific concerns (placement, sizing to our
slot, and legibility of overlaid UI) are our responsibility.

## 2. Goals

- **G1** — Extend the theme system so **any element can be dynamic** (generated per load), declared as
  pure data in the manifest. Banner is the first element; the mechanism is generic (background, and
  later button/card fills, follow the same path). Additive — existing static treatments and themes are
  untouched.
- **G2** — A dynamic element names a **generator** (closed build-time catalog, like `iconSet`) plus a
  pinned **style token** (colour identity). Validated at build time; an unknown generator **fails the
  build**. A static fallback (`treatments.banner`) remains **required**.
- **G3** — A dynamic banner renders a **unique image on every page load**, staying **within the selected
  theme**: colour identity is fixed (pinned params), composition varies. Non-determinism is the intended
  behaviour, not a defect.
- **G4** — Legibility of overlaid UI (the nav logo, `brand.500`) is **guaranteed independent of the
  random banner content**, via a scrim on our side — not delegated to the generator.
- **G5** — A **brand-new light watercolour theme** (working name `aquarelle`) ships using the dynamic
  banner, **drop-in** like any other theme (no shared-file edits beyond the generic capability).
- **G6** — No jank on low-end mobile: generation runs **off the main thread**, there is **no layout
  shift**, and the **no-JS / first-paint** path always shows a correct static image.
- **G7** — The ink generator is consumed as a **versioned git dependency** behind a **thin adapter we
  own**. The ink-independent scaffold (G1–G4, G6) is built and tested **against a typed stub**, so it is
  not blocked on ink's packaging.

## 3. Non-goals

- **No determinism / reproducibility.** Non-determinism per load is the feature. We do not persist,
  replay, or "share this exact render" in v1 (would need ink's `blobPoints` seed fix; deferred).
- **No dark-theme dynamic banner in v1.** ink's generator hardcodes a warm off-white base (`#f4efe6`);
  a themeable `baseColor` is agreed but lands in ink's v0.x. Dynamic banners ship on **light themes**
  first (v2 expands to dark once `baseColor` is available).
- **No button/card dynamic fills in v1.** The generic schema admits them (`clip`), but v1 implements
  only the banner. Buttons/cards (clip a fill into a shape) are v2.
- **No user-uploaded or runtime generators.** Generators are a **closed, build-time catalog**;
  manifests reference one by name.
- **No visual change to any existing theme.** Purely additive and opt-in.
- **Legibility is not the generator's job.** No safe-zone feature is requested of ink; the scrim (G4)
  owns it.

## 4. Constraints (verified in the codebase)

- `output: 'export'` (`app/next.config.mjs`) → **no server, no runtime FS reads.** The dynamic render is
  **client-only, post-hydration** (`useEffect`); the prerendered HTML carries the **static** fallback.
- The banner renders today as a **CSS `background-image` data-URI** on an absolutely-positioned
  decorative `Box`, not inline DOM SVG. Path: `app/src/hooks/useThemeStyles.ts` (`navBannerDecor` builds
  `url("data:image/svg+xml,${encodeURIComponent(svg)}")`, URL-encoded, carried on the **raw `style`
  prop** because Chakra drops data-URI values through its style pipeline) → consumed at
  `app/src/components/Layout.tsx` as a `Box` at `zIndex 0`, `opacity 0.95`, behind the nav `Container`
  (`zIndex 1`). The nav **logo** (`Text`, bold, `color="brand.500"`, leftmost) overlaps the banner's
  **left region** — this is why G4 is required.
- The banner box is **fixed height 96px**, width `clamp(220px, 33vw, 420px)` → aspect **~2.29:1 to
  ~4.375:1**, painted `backgroundSize: 100% 100%` (stretch).
- `computeThemeStyles()` (`useThemeStyles.ts`) is a **pure, unit-tested** function returning the six
  style fields incl. the static `bannerDecorStyle`. It **must stay pure** and keep returning the static
  fallback; dynamic logic lives in a new client-only layer, not here.
- **Manifest is pure data**; `zod` stays build/test-only (client-bundle boundary, AC-BOUND from the
  pluggable-themes epic). The generator is referenced by **name**; its function lives in `treatments/`.
- No TypeScript runner is installed; theme codegen is a plain Node `.mjs` deriving from **folder names**
  (`app/scripts/generate-theme-registry.mjs`), with value validation on the vitest path
  (`app/tests/unit/themes-validation.test.ts`). The generator-catalog check joins that gate.

## 5. The ink contract (converged) and the v0 gate

The interface few.chat depends on (converged in `proposals/dynamic-banner/ink-channel-log.md`):

- **Call:** ink exposes `renderSVG({ params })` (direct `WatercolorSVG` API + a typed `StyleToken`).
  Correct usage each load: `const p = randomizeParams(); Object.assign(p, style, { format });
  renderSVG({ params: p })` — **seed omitted → fresh geometry each call.**
- **Style token (pinned identity):** `anchorHue` 0–359, `scheme` ∈ {monochromatic, analogous,
  analogous-accent, split-complementary, triadic, complementary}, `saturation` **20–100**, `lightness`
  **20–75**. Pinning fixes the *centre*; small bounded per-zone jitter remains (desired).
- **Return:** `{ svg, id }`. `svg` is a self-contained string (no scripts, no external refs, opaque
  base, seed-namespaced ids). We consume `svg`; `id` is an opaque handle. `derived` is not used.
- **Sizing:** arbitrary width/height supported (agreed). Our envelope: 96px tall, 220–420px wide.
- **Packaging:** published as the `@rotheric/visuals` package (git subtree split of
  `packages/visuals/` in `rotheric/ink`), **ESM-only**, `.d.ts` types, tagged `visuals-vX.Y.Z`
  (not a bare `v0` — see `## Amendments`); `baseColor` + the 96px small-canvas tuning land in
  **v0.x**.

**The v0 gate — satisfied 2026-07-06.** Phase A stories (§7) built against a typed **stub**.
Ink has now published `visuals-v0.1.2` (verified: real tag, root contains `package.json` +
built `dist/index.js`), so Phase B is unblocked. Wiring the real dependency, tuning the
theme's look, capturing the static fallback, and validating real-output performance can now
proceed.

## 6. Architecture & seams

- **Schema (`app/src/themes/schema.ts`).** Add an optional generic `treatments.dynamic` map:
  `{ banner?: DynamicElement, background?: DynamicElement }` where
  `DynamicElement = { generator: 'watercolor', style: StyleToken, clip?: 'button'|'card'|'avatar',
  render?: <partial perf knobs> }`. Every object `.strict()`. Static treatments unchanged; static
  `banner` still required.
- **Adapter seam (`app/src/themes/treatments/dynamicVisuals.ts`, NEW).** A name→function registry
  `DYNAMIC_GENERATORS = { watercolor(style, kind, render) → svgString }` that owns the
  `randomizeParams()`+override call and forces the element size/format. **This is the only module that
  imports the ink package.** Built against a stub in Phase A; swapped to `@rotheric/visuals` in Phase B
  (the import line is the seam).
- **Render hook (`app/src/hooks/useDynamicBanner.ts`, NEW).** Client-only (`useEffect`, post-hydration):
  if `treatments.dynamic?.banner` present, generate a fresh SVG (via the worker, §Perf), encode as a
  data-URI exactly as `navBannerDecor` does, and swap `bannerDecorStyle.style.backgroundImage`.
  Regenerates on mount (= per reload) and on theme change. `computeThemeStyles()` stays pure and returns
  the static fallback.
- **Layout (`app/src/components/Layout.tsx`).** Reserve the banner box; cross-fade the generated image
  over the static one; render the **legibility scrim** behind the logo.
- **Worker (`app/src/workers/banner.worker.ts`, NEW).** `renderSVG` is Worker-safe (pure, no DOM); run
  generation off-thread and `postMessage` the string back. Fallback to `requestIdleCallback` on the main
  thread if worker bundling under static export proves fussy (a build detail, not a blocker).
- **Fallback capture.** For a dynamic theme, the required static `treatments.banner` is **one frozen
  representative render** (captured once from the generator). No determinism needed.

## 7. Stories (phased)

### Phase A — ink-independent (buildable now, against a typed stub)

- **S1 — Dynamic-element schema + validation gate.** Add `treatments.dynamic` + `StyleToken` + generic
  `DynamicElement` to `schema.ts`; join the generator-catalog check to the build gate; keep static
  `banner` required; hold the pure-data / zod-boundary invariants. *(foundation)*
- **S2 — Generator adapter + registry + stub.** `treatments/dynamicVisuals.ts` with the typed
  `StyleToken`, the `randomizeParams`+override call shape, forced size/format, and a **stub generator**
  (returns a valid self-contained placeholder SVG) behind the real import seam.
- **S3 — `useDynamicBanner` hook + Layout swap.** Client-only per-load regeneration, data-URI swap,
  static fallback retained, cross-fade + reserved box (no layout shift).
- **S4 — Legibility scrim.** Guarantee `brand.500` logo contrast over any banner content, independent of
  the generated image.
- **S5 — Worker offload.** Generate off the main thread; `requestIdleCallback` fallback.
- **S6 — Tests (mocked generator).** Fallback renders; on mount the background swaps to a valid data-URI
  SVG; scrim guarantees logo contrast; adapter output is self-contained. No per-seed determinism tests.

### Phase B — unblocked (ink's v0 published as `visuals-v0.1.2`)

- **S7 — Wire the real `@rotheric/visuals` git dependency** (pinned to the `visuals-v0.1.2` tag) into the
  adapter (replace the stub); confirm ESM bundling under static export; confirm Worker consumption.
- **S8 — The `aquarelle` theme.** Brand-new light theme folder using `treatments.dynamic.banner` with
  tuned `style` params + a captured static fallback; drop-in via the registry.
- **S9 — Performance validation.** Measure generation + paint on a low-end device with real output;
  finalize the lite `render` preset; confirm no jank / no CLS; promote out of `experimental` only when
  green.

### v2 — later (gated on ink v0.x)

- **S10 — Dark themes + more elements.** Dynamic banners on dark themes via ink `baseColor`; additional
  element kinds (`background`, then `button`/`card` via `clip`).

## 8. Definition of done (v1)

Phase A merged and green against the stub; ink v0 published; Phase B merged; the `aquarelle` theme shows
a unique watercolour banner on every reload, always legible under the logo, no layout shift, correct
no-JS fallback, and measured acceptable on low-end mobile. Dark-theme and non-banner elements are
explicitly out of v1 (v2).

## Amendments

- **2026-07-06** — Ink published its v0 release: tag `visuals-v0.1.2` on `rotheric/ink` (a git subtree
  split of `packages/visuals/`, per ink's own release mechanism — not a bare `v0` tag as originally
  assumed). Verified directly via `gh api`: the tag's root contains `package.json` and a built
  `dist/index.js`. Two naming corrections follow from this: the package is **`@rotheric/visuals`**, not
  `@ink/visuals` as written throughout §5–§7 and in `acceptance-criteria.md`'s S7/AC-DEP-1 (corrected in
  place); and the version pin for S7 is the tag `visuals-v0.1.2`, not a generic `v0`. The v0 gate (§5) is
  satisfied — Phase B (S7–S9) is unblocked and being dispatched as of this amendment.
- **2026-07-05** — This epic's first `/base:feature` run is scoped to **Phase A only** (S1–S6). Phase B
  (S7–S9) and v2 remain blocked on ink's v0 tag (§5) and will be dispatched as a separate future run once
  it publishes.
- **2026-07-05** — Added AC-UX-3a (runtime generation-failure fallback): if generation fails
  post-hydration, `useDynamicBanner` keeps/reverts to the static fallback rather than showing a broken or
  blank banner, and must not throw uncaught. Decided directly (consistent with the existing G6/AC-UX-4
  no-JS fallback philosophy) rather than escalated, since the spec already established the underlying
  principle.
- **2026-07-05** — Clarified AC-PERF-1/AC-PERF-2 scope for Phase A: S6's mocked-generator test suite
  verifies the *mechanism* (reserved box dimensions unchanged; worker/idle-callback path exercised), not
  real CLS/paint-timing measurement, which is AC-PERF-3 (Phase B).
- **2026-07-06** — Added `## Manual Validation` MV-1 (acceptance-criteria.md): S3's implementation
  correctly preserves the `boxProps`/`style` split that keeps the dynamic banner's data-URI on Chakra's
  raw `style` prop (never folded into `boxProps`, where Chakra would silently drop it) — proven
  structurally by unit tests, but not renderable-in-a-real-browser-provable in this jsdom-less repo.
  Flagged as a manual/deferred check, expected to be waived for this Phase-A run (no theme declares
  `treatments.dynamic` yet) and re-raised as a hard gate before Phase B's `aquarelle` (S8) ships.
