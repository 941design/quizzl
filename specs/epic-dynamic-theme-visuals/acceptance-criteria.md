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
(or, in Phase A, the stub). No other file imports it directly (single-seam invariant), verified via the
same resolved-import scanner pattern already used for the zod boundary in
`app/tests/unit/themes-validation.test.ts:443-731` (parse imports, classify runtime vs type-only, resolve
specifiers against `dynamicVisuals.ts`'s absolute path) — not a literal text grep, which would false-
positive/negative on aliased or re-exported specifiers.

**AC-UX-1** — The `watercolor` entry MUST call the generator with a **fresh** randomized param set each
invocation and override the pinned `style` fields, so two successive calls return **different** `svg`
strings (non-determinism) while both reflect the pinned identity. *(In Phase A, verified against the
stub, which MUST also vary its output per call.)*

*(Phase A verification for AC-STRUCT-3 and AC-UX-1, and AC-STRUCT-6 below: `app/tests/unit/themes/treatments.test.ts`,
the established per-module test location for `treatments/*` (precedent: its existing
`describe('themes/treatments/elevation'|'iconSets'|'patterns')` blocks) — add a sibling
`describe('themes/treatments/dynamicVisuals')` block there, not `themes-validation.test.ts` (which
architecture.md's Module Map scopes to the schema/validation-gate ACs: AC-VAL-1, AC-VAL-2, AC-BOUND-1,
AC-STRUCT-4).)*

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

**AC-UX-3a** — If generation fails post-hydration (the generator throws synchronously, or the Worker
emits an error and no fallback path succeeds), `useDynamicBanner` MUST keep (or revert to) the static
`bannerDecorStyle` background — never leave a broken or blank banner. This failure MUST NOT throw an
uncaught error that could crash the nav.

*(Phase A verification for AC-UX-2, AC-UX-3, and AC-UX-3a: this repo has no jsdom/React Testing Library
(confirmed absent from `app/package.json`), so none of the three is exercised via a rendered/mounted
hook. All three are tested against `useDynamicBanner`'s exported pure decision function — e.g.
`resolveDynamicBannerStyle(definition, generatedSvg | null)` per architecture.md's seam contract — in
`app/tests/unit/hooks/useDynamicBanner.test.ts`, mirroring the `computeThemeStyles()` precedent in
`useThemeStyles.test.ts`. Passing two distinct generated strings exercises the swap and per-mount
difference (AC-UX-2, AC-UX-3); passing `generatedSvg = null` exercises the static/failure path
(AC-UX-3a). The hook's own `try`/`catch` around the generator call — which guarantees `generatedSvg` is
only ever set to a valid string or left `null`, never a partial/broken value — is a review-level
guarantee per architecture.md Boundary Rule 7, not independently unit-testable in this repo.)*

**AC-PERF-1** — The swap MUST NOT cause layout shift: the banner box is reserved at its fixed
dimensions, and the generated image cross-fades in. No CLS attributable to the banner. *(Phase A
verifies the mechanism only — reserved box dimensions unchanged before/after the swap in a mocked-generator
test; real CLS measurement is AC-PERF-3, Phase B.)*

### S4 — Legibility scrim

**AC-A11Y-1** — A scrim/backing behind the nav logo MUST guarantee the `brand.500` logo text meets WCAG
AA (≥ 4.5:1) contrast **regardless of the banner content behind it**. Asserted against the scrim +
`brand.500`, independent of any generated image (i.e. the test does not depend on the banner).

**AC-A11Y-2** — The scrim MUST be present whenever a dynamic banner is active and MUST NOT visually
regress themes that use only a static banner (no scrim required, or a no-op).

*(Phase A verification: this repo has no jsdom/React Testing Library and `Layout.tsx` has no existing
test file (confirmed: no test references it), so "presence" is not verified by rendering/mounting
`Layout.tsx`. It MUST instead be verified against an exported pure decision function — e.g.
`shouldRenderScrim(hasDynamicBanner: boolean): boolean` — mirroring the pure-decision-function convention
already established for `computeThemeStyles()`/`resolveDynamicBannerStyle()`, tested directly in
`app/tests/unit/hooks/useDynamicBanner.test.ts` or a sibling scrim test file at story-planner's
discretion in Mode 2.)*

### S5 — Worker offload

**AC-PERF-2** — Banner generation MUST run off the main thread (Web Worker) when supported, returning
the SVG string via `postMessage`; a `requestIdleCallback` (or equivalent deferred) main-thread path MUST
exist as a fallback. Generation MUST NOT block first paint. *(Phase A verifies the mechanism only — the
worker/idle-callback code path is exercised in a mocked-generator test; real paint-timing measurement is
AC-PERF-3, Phase B.)*

### S6 — Tests (mocked generator)

**AC-UX-4** — A test MUST assert the **static fallback** renders when JS/dynamic is unavailable (no-JS
path shows a correct image).

**AC-UX-5** — A test MUST assert that, on mount, the background swaps to a **valid data-URI SVG**
(parses as SVG; contains a `viewBox`; no `<script>`).

*(AC-UX-4 and AC-UX-5 Phase A verification: same pure-decision-function boundary and file
(`app/tests/unit/hooks/useDynamicBanner.test.ts`) referenced in AC-UX-2/AC-UX-3/AC-UX-3a's note above —
not a rendered mount. "On mount"/"renders" describes the resulting product behavior; the test calls the
exported pure function directly with the relevant `generatedSvg` value.)*

**AC-STRUCT-6** — A test MUST assert adapter output is **self-contained** (no `<script>`, no external
`href`/`url()` to outside resources).

**AC-META-1** — There MUST be **no per-seed determinism test** (non-determinism is intended); the suite
mocks the generator for speed and asserts *behaviour* (swap, fallback, self-containment, contrast), not
pixels.

*(S6's test suite also covers AC-UX-3a, AC-PERF-1, and AC-PERF-2 per their scope notes above.)*

---

## Manual Validation

**MV-1** — The `boxProps`/`style` split in `useDynamicBanner.ts`'s `resolveDynamicBannerStyle` return
(mirroring `navBannerDecor()`'s existing split, where `style.backgroundImage` is carried on the raw
`style` prop, never folded into `boxProps`, because Chakra silently drops a data-URI `backgroundImage`
value through its style pipeline) is proven **structurally** by unit tests (S3, AC-UX-2/AC-UX-3 blocks)
but this repo has no jsdom/browser DOM, so no automated test can prove Chakra actually **renders** the
swapped background in a real browser rather than silently dropping it. Requires a real-browser visual
check: load the app with a theme that declares `treatments.dynamic.banner`, confirm the nav banner shows
a generated image (not blank/missing) post-hydration, and that DevTools' computed style shows
`background-image` resolving on the rendered DOM node. *No Phase A theme declares `treatments.dynamic`
yet (that's Phase B's `aquarelle`, S8) — this MV item is not checkable until a dynamic-declaring theme
exists, so it is expected to be waived for this Phase-A run and re-raised as a hard gate before S8 ships.*

**MV-2** — S5's Worker/fallback path routes every async result (Worker message, Worker `onerror`, or the
`requestIdleCallback`/`setTimeout` fallback's completion) through a `cancelled`-flag guard plus
`worker?.terminate()`, meant to stop a stale result from a superseded effect run (theme change or
unmount) from ever calling `setGeneratedSvg`, and to avoid leaking a live Worker thread across
re-renders. Verified structurally by source read; not verifiable by a mounted-component test in this
jsdom-less repo. *Requires a real-browser check: rapidly toggle between a dynamic-banner theme and a
different theme while generation is mid-flight, and confirm via DevTools that no stale SVG is ever
applied and no Worker threads accumulate. Not checkable until a dynamic-declaring theme exists
(Phase B, S8) — expected to be waived for this Phase-A run.*

**MV-3** — Worker bundling under `output: 'export'` (architecture.md's acknowledged risk, Boundary Rule
11) was confirmed via a single `make build` run in this session: the worker's `self.addEventListener`
side effect lands in its own emitted chunk, not the main `_app` bundle. *This is a build-time
observation, not a standing regression test — re-confirm `make build` stays green on CI or future
Next.js version bumps. A real-browser load (Phase B) would additionally confirm the worker executes
off-thread, not just that it bundles correctly.*

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
