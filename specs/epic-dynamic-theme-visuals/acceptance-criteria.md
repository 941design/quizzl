# Dynamic Theme Visuals — Acceptance Criteria

## Terminology

- **dynamic element** — a manifest-declared visual generated at load time, `treatments.dynamic.<surface>`,
  shaped `{ generator, style, clip?, render? }`. Additive to the static treatment model.
- **generator** — a named entry in the closed build-time catalog (`'watercolor'` in v1), implemented in
  `app/src/themes/treatments/dynamicVisuals.ts`. Referenced by name from the manifest (pure data).
- **style token** — the pinned colour identity: `{ anchorHue, scheme, saturation, lightness }` (later
  `baseColor`). Ranges per §5: `anchorHue` 0–359, `saturation` 20–100, `lightness` 20–75, `scheme` enum.
- **static fallback** — the required `treatments.banner` SVG string; the SSR/first-paint/no-JS image.
- **adapter** — `dynamicVisuals.ts`, the sole module importing the ink package; owns the
  `randomizeParams()`+override call and forces size/format.
- **stub** — the placeholder generator used in Phase A in place of `@ink/visuals` (returns a valid
  self-contained SVG), swapped for the real dependency in Phase B.
- **v0 gate** — Phase B stories are blocked until ink publishes a consumable v0 git tag (Q4 in
  `proposals/dynamic-banner/ink-channel-log.md`).

## Known TAGs

- **STRUCT** — schema / registry / adapter / module structural assertions.
- **VAL** — build-time validation-gate assertions (generator catalog, style-token bounds).
- **UX** — user-visible behaviour (per-load uniqueness, fallback, swap, no-JS).
- **A11Y** — legibility assertions (logo contrast over any banner).
- **PERF** — off-thread generation, no layout shift, paint budget.
- **BOUND** — bundle/boundary assertions (zod out of client bundle; single ink import site).
- **DEP** — git-dependency wiring assertions (Phase B).
- **THEME** — the new `aquarelle` theme assertions (Phase B).

---

## Phase A — ink-independent

### S1 — Dynamic-element schema + validation gate

**AC-STRUCT-1** — `ThemeManifestSchema` (`app/src/themes/schema.ts`) MUST accept an optional
`treatments.dynamic` map of `{ banner?, background? }`, each a `.strict()` `DynamicElement`
(`{ generator, style, clip?, render? }`); a manifest without `treatments.dynamic` MUST validate and
render exactly as today (additive, opt-in).

**AC-STRUCT-2** — `treatments.banner` (static SVG string) MUST remain **required** on every manifest,
including those that declare a dynamic banner.

**AC-VAL-1** — An unknown `generator` value (not in the closed catalog, `'watercolor'` in v1) MUST
**fail the build** via the same validation gate that checks the other treatment unions
(`app/tests/unit/themes-validation.test.ts`).

**AC-VAL-2** — A `style` token whose `saturation` is outside **20–100**, `lightness` outside **20–75**,
`anchorHue` outside **0–359**, or `scheme` outside the enum MUST **fail validation** (bounds per the
converged ink contract).

**AC-BOUND-1** — Adding `treatments.dynamic` MUST NOT introduce a runtime `zod` import into the client
bundle; the manifest stays pure data and the generator is referenced by name only (holds the
pluggable-themes BOUND invariant).

### S2 — Generator adapter + registry + stub

**AC-STRUCT-3** — `app/src/themes/treatments/dynamicVisuals.ts` MUST export a name→function registry
`DYNAMIC_GENERATORS` with a `watercolor` entry of signature `(style, kind, render?) → string` returning
a self-contained SVG string.

**AC-STRUCT-4** — The adapter MUST be the **only** module in `app/src` that imports the ink generator
(or, in Phase A, the stub). No other file imports it directly (single-seam invariant; grep-assertable).

**AC-UX-1** — The `watercolor` entry MUST call the generator with a **fresh** randomized param set each
invocation and override the pinned `style` fields, so two successive calls return **different** `svg`
strings (non-determinism) while both reflect the pinned identity. *(In Phase A, verified against the
stub, which MUST also vary its output per call.)*

### S3 — `useDynamicBanner` hook + Layout swap

**AC-STRUCT-5** — `computeThemeStyles()` (`app/src/hooks/useThemeStyles.ts`) MUST remain pure and keep
returning the **static** `bannerDecorStyle` from `treatments.banner`; no dynamic/generation logic is
added to it.

**AC-UX-2** — `useDynamicBanner(definition)` MUST run **client-only** (post-hydration). When
`treatments.dynamic?.banner` is present it MUST generate a fresh SVG, encode it as a data-URI exactly as
`navBannerDecor` does (URL-encoded, on the raw `style` prop), and swap
`bannerDecorStyle.style.backgroundImage`. When absent, the static banner MUST render unchanged.

**AC-UX-3** — On a fresh mount the rendered banner background MUST change from the static fallback to a
generated data-URI SVG; across two mounts the generated value MUST differ (unique per load).

**AC-PERF-1** — The swap MUST NOT cause layout shift: the banner box is reserved at its fixed
dimensions, and the generated image cross-fades in. No CLS attributable to the banner.

### S4 — Legibility scrim

**AC-A11Y-1** — A scrim/backing behind the nav logo MUST guarantee the `brand.500` logo text meets WCAG
AA (≥ 4.5:1) contrast **regardless of the banner content behind it**. Asserted against the scrim +
`brand.500`, independent of any generated image (i.e. the test does not depend on the banner).

**AC-A11Y-2** — The scrim MUST be present whenever a dynamic banner is active and MUST NOT visually
regress themes that use only a static banner (no scrim required, or a no-op).

### S5 — Worker offload

**AC-PERF-2** — Banner generation MUST run off the main thread (Web Worker) when supported, returning
the SVG string via `postMessage`; a `requestIdleCallback` (or equivalent deferred) main-thread path MUST
exist as a fallback. Generation MUST NOT block first paint.

### S6 — Tests (mocked generator)

**AC-UX-4** — A test MUST assert the **static fallback** renders when JS/dynamic is unavailable (no-JS
path shows a correct image).

**AC-UX-5** — A test MUST assert that, on mount, the background swaps to a **valid data-URI SVG**
(parses as SVG; contains a `viewBox`; no `<script>`).

**AC-STRUCT-6** — A test MUST assert adapter output is **self-contained** (no `<script>`, no external
`href`/`url()` to outside resources).

**AC-META-1** — There MUST be **no per-seed determinism test** (non-determinism is intended); the suite
mocks the generator for speed and asserts *behaviour* (swap, fallback, self-containment, contrast), not
pixels.

---

## Phase B — gated on ink v0 tag

### S7 — Wire the real `@ink/visuals` git dependency

**AC-DEP-1** — The adapter MUST import the real ink package (git dependency, pinned tag), replacing the
stub, with **no change** to the adapter's exported signature or to any downstream consumer (the seam
held).

**AC-DEP-2** — The ink package MUST bundle cleanly under `output: 'export'` (ESM) and be usable from the
Web Worker; the production client bundle MUST NOT pull `sharp` or any Node-only dependency.

### S8 — The `aquarelle` theme

**AC-THEME-1** — `app/src/themes/aquarelle/manifest.ts` MUST exist as a **brand-new** light theme
(not derived from an existing one), auto-detected by the registry with **no edits to shared files**
beyond the S1 capability; it MUST declare `treatments.dynamic.banner` with a tuned `style` token and a
frozen static `banner` fallback.

**AC-THEME-2** — `aquarelle` MUST pass the existing WCAG contrast gate (its static palette) and MUST
ship as `status: 'experimental'` until AC-PERF-3 is met.

**AC-UX-6** — With `aquarelle` active, reloading the page MUST show a **visibly different** banner each
time, all recognizably the same theme (fixed colour identity), and the logo MUST remain legible
(AC-A11Y-1) on every render.

### S9 — Performance validation

**AC-PERF-3** — On a low-end mobile profile, banner generation + paint MUST stay within an agreed budget
(target: lite preset ≈ 6 paths, ~8–15 KB SVG, generation off-thread, no dropped frames on the nav), and
`aquarelle` MUST NOT be promoted from `experimental` until this is measured green.

---

## v2 (later — gated on ink v0.x)

**AC-THEME-3** *(v2)* — With ink's `baseColor` available, a **dark** theme MUST be able to declare a
dynamic banner whose base tone matches its background (no warm-off-white clash).

**AC-STRUCT-7** *(v2)* — A dynamic `background`, and a `button`/`card` element using `clip` to mask a
fill into a component shape, MUST be expressible through the same `treatments.dynamic` schema without a
schema redesign.
