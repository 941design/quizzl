# Response & Integration Contract: Dynamic banner treatments

**To:** rotheric / `ink` (watercolour generator)
**From:** few.chat theme-system maintainers
**Re:** Your `dynamic-banner-proposal.md` — decision on §7 + how this integrates
**Status:** Under review — §1 decisions Agreed; **Addendum A (below) reconciles §1/§4/§5 against the ink source read on 2026-07-05 and supersedes them where they conflict.**

---

## 1. Decisions (your §7)

1. **§7.1 — Named-generator model: ACCEPTED.** `bannerDynamic` as an optional
   sibling of `banner`, `generator` a closed zod union, implementation in shared
   `treatments/`, static `banner` retained as fallback. This is the right shape and
   it holds every invariant (pure-data manifest, static contrast-checked palette,
   static export). Build against it.
2. **§7.2 — Option A (truly unique per load): CHOSEN. No descope to B.** Per-reload
   uniqueness is a hard requirement. This is a product decision, already made — do
   not plan a build-time pool.
3. **§7.3 — Supply chain: external npm dependency.** Publish the trimmed generator
   as a versioned module; we import it into `treatments/banners.ts`. Pin an exact
   version; changelog any change that alters output for a given seed.
4. **§7.4 — Bundle budget: ≤ 15 KB gzip** for the banner entry point you ship us.
   This is a hard ceiling, measured on the imported entry, not the full renderer.

---

## 2. One correction that changes your plan (read this first)

Your §4 rendering path and half your §6 risk table assume the banner is **inline
SVG markup in the page DOM**, server-rendered into the HTML. **It is not.** In the
shipped app the banner is a **CSS `background-image` data-URI** on a decorative box.

The real path (verify in source):

- `app/src/hooks/useThemeStyles.ts` → `navBannerDecor(treatments.banner)` collapses
  whitespace and emits
  `backgroundImage: url("data:image/svg+xml,${encodeURIComponent(svg)}")`, returned
  as a `BannerDecor { boxProps, style }`. Note it is **URL-encoded, not base64**, and
  it must travel on the raw `style` prop — Chakra silently drops a data-URI
  `backgroundImage` if it flows through a Chakra style prop (documented contract in
  that file). Preserve this.
- `app/src/components/Layout.tsx:89` renders it as an absolutely-positioned `Box` at
  `zIndex: 0`, `opacity: 0.95`, behind the nav `Container` (`zIndex: 1`).

What this means for your generator contract:

| Your stated guarantee (§4/§6) | Under a data-URI background | Action |
|---|---|---|
| Per-instance `id` namespacing to avoid DOM collisions | The SVG renders in an isolated replaced-element context; its ids never enter the page DOM | **Not required.** Drop it (harmless if kept). |
| No `<script>` | Scripts in a background-image data-URI are inert | **Moot.** Keep for hygiene, but it's not load-bearing. |
| `mix-blend-mode: multiply` composites against the app backdrop | A background-image **cannot** blend with page content behind it | **Impossible as described.** Any blending must be *internal* to the SVG, over your own opaque backing. |
| Opaque backing baked in | Correct and still required | **Keep.** The SVG must be fully self-composited. |

**We are keeping the data-URI background mechanism** — it isolates your SVG cleanly
and needs no new DOM-injection surface in a key-handling app. Do **not** design
around inline-SVG-in-DOM. Your generator returns an SVG string; we re-encode it
exactly as `navBannerDecor` does today.

## 3. Integration seam (where your output plugs in)

Static export means the fallback data-URI is baked into the prerendered HTML. The
dynamic swap is **client-only, post-hydration**, and must not touch the pure path
we test against:

- `computeThemeStyles()` (pure, unit-tested against real manifests) stays exactly as
  is and keeps returning the **static** `bannerDecorStyle` from `treatments.banner`.
  That is the SSR/first-paint/no-JS image. Do not move dynamic logic into it.
- We add a thin client-only layer (a `useDynamicBanner` effect) that, **when
  `bannerDynamic` is present**, generates a fresh SVG on mount and overrides
  `bannerDecorStyle.style.backgroundImage` in place. Same encode, same `style`-prop
  channel. No hydration mismatch because the override happens strictly after mount.
- We reserve the banner box and cross-fade the generated image in (CLS mitigation) —
  our side.

You do not touch React, hooks, or `Layout.tsx`. You ship one function.

## 4. Generator contract (build to this signature)

Your `(seed, params)` is close but conflates two different things. **Manifest
`params` are static author intent; seed, box geometry, and the overlay-legibility
constraint are runtime, app-supplied.** Split them:

```ts
generateBanner(
  seed: number,                       // app-supplied per load
  params: Record<string, unknown>,    // manifest bannerDynamic.params — static, inert
  context: BannerContext,             // app-supplied at call time
): string                             // self-contained SVG string

type BannerContext = {
  width: number;                      // px, the resolved box width (see §5 geometry)
  height: number;                     // px, currently 96
  safeZone: { x: number; y: number; w: number; h: number };  // must stay legible (§5)
  overlayColor: string;               // resolved logo color (theme brand.500), hex
  minContrast: number;                // 4.5 — the WCAG AA target the safe zone must clear
};
```

Hard requirements:

- **Deterministic** in `(seed, params, context)` — same inputs reproduce the same
  SVG byte-for-byte. Non-negotiable: it's how we spot-check legibility over a sample
  of seeds in tests, and how bug reports are reproducible.
- **Self-contained SVG**: no external refs, opaque self-backing, all filters inline.
  Declares a `viewBox` so it stretches cleanly (see §5).
- **Bounded paint budget** so per-load render stays cheap on low-end mobile
  (`feTurbulence`/blur capped). We measure before promoting out of experimental.
- **≤ 15 KB gzip** for the entry point we import (§1.4).

## 5. The legibility guarantee (this is the new must-have)

Your §6 marks contrast risk as *"None: banner is not a contrast-checked token."*
That was true only because the banner was static and a human eyeballed it. **The nav
logo (`Text`, bold, `color="brand.500"`) is the leftmost nav item and sits directly
over the banner's left region** (`Layout.tsx`: logo in the `Container` at `zIndex 1`,
banner box at `zIndex 0`). A never-repeating banner removes that human check.

The build-time contrast gate **cannot** cover this — the image is non-deterministic,
so there is nothing static to measure. The guarantee therefore moves into your
generator, enforced two ways:

1. **Safe-zone contract.** Within `context.safeZone`, the generated art must keep
   luminance such that `context.overlayColor` text clears `context.minContrast`
   (4.5:1). Concretely: the left region under the logo stays light/quiet — no dark
   blobs, no high-frequency turbulence — so the logo never lands on noise.
2. **Dev-mode self-assertion.** In a non-production build the generator asserts the
   safe-zone constraint for the seed it just produced and throws on violation. This
   is the mechanical substitute for the lost human eyeball; it turns "some seed is
   illegible" from a silent field bug into a caught error.

**Box geometry you're targeting** (from `navBannerDecor`): the box is
`w: clamp(220px, 33vw, 420px)`, `h: 96px`, painted with `backgroundSize: 100% 100%`
— i.e. **stretched to fill**, so effective aspect ratio ranges ~2.3:1 (narrow
viewport, 220px) to ~4.4:1 (420px). Author at a nominal `viewBox="0 0 420 96"` and
tolerate horizontal stretch across that range; keep the safe zone robust to it. If
stretch distortion is unacceptable for the watercolour look, tell us — switching that
box to `backgroundSize: contain` is a one-line change on our side, but it changes
existing themes' banner scaling, so we won't do it unless you need it.

`context.safeZone` default we'll pass: the left ~45% width × full height
(`{ x: 0, y: 0, w: round(width*0.45), h: height }`). Push back if the logo footprint
we measure differs from what you need.

## 6. Validation, gates, and tests

- **Schema:** `bannerDynamic.generator` joins the enum-catalog check exactly like the
  existing treatment unions — unknown generator → build failure. Add the matching
  literal union member in `schema.ts` (hand-synced with `treatments/`, per the
  existing duplication contract in that file). `params` stays permissive
  (`z.record`), same posture as the `overrides` escape hatch — document its limits.
- **Contrast gate:** untouched. Banner is not a palette token; the safe-zone
  guarantee (§5) lives in the generator, not the build gate.
- **Our tests:** the pure `computeThemeStyles` path keeps asserting the static
  fallback. We add (a) a fallback-render test (no-JS shows the static banner), and
  (b) a sampled legibility test — N fixed seeds through your generator, assert the
  safe-zone contract holds. Determinism (§4) is what makes (b) possible.

## 7. Ownership split

| Owner | Deliverable |
|---|---|
| rotheric / `ink` | The `generateBanner` module (npm, pinned, ≤15 KB gz), meeting §4–§5. Determinism + dev self-assertion + safe-zone guarantee are yours. |
| few.chat | `bannerDynamic` schema + union member; the `useDynamicBanner` client swap; box reservation + cross-fade; passing `seed`/`context`; the fallback + legibility tests; low-end paint measurement before promotion. |

## 8. What we need back from you

1. Confirm the split signature in §4 (`seed`, `params`, `context`) works for the
   watercolour renderer — specifically that you can honor `safeZone` + `overlayColor`
   + `minContrast` deterministically.
2. Confirm the ≤15 KB gz trimmed entry is achievable, and name the exact export.
3. Tell us whether `backgroundSize: 100% 100%` stretch is acceptable or you need
   `contain` (§5).
4. The `params` you actually want authors to set (seed policy, palette hints) so we
   can document them in the authoring guide.

## 9. Rollout

Ship behind `status: 'experimental'` on a single watercolour theme. Gate promotion to
`stable` on: paint cost measured acceptable on a low-end device, the sampled
legibility test green, and the no-JS fallback confirmed. Additive and opt-in
throughout — every existing manifest validates and renders unchanged.

---

**Bottom line:** your architecture is accepted as-is; the only substantive rework is
that you're generating an SVG for an **isolated data-URI background**, not inline DOM
SVG — which *removes* your id/script/blend concerns but *adds* one hard requirement:
a deterministic, self-asserting **safe-zone legibility guarantee** under the nav logo,
because the build gate can't check a non-deterministic image. Build to §4–§5 and it
drops in.

---

## Addendum A — Ground-truth reconciliation (ink source, read 2026-07-05)

few.chat read the actual generator (`tools/watercolor/svg.js`) via the ink project
index before hand-off. The public API is `renderSVG({ seed, params, ranges }) → { svg,
… }`, returning a serialized SVG string; the SVG path is a single UMD file with **zero
runtime dependencies** (`sharp` lives only in the separate `generate.js` rasterizer).
Good news: the output is already self-contained (no `<script>`, no external refs, an
opaque `#f4efe6` base rect, seed-namespaced filter ids). But five contract points must
be revised against reality — **this addendum wins where it conflicts with §1/§4/§5.**

1. **§4 determinism — currently BROKEN, and it's a required ink fix.**
   `blobPoints` (≈ line 204) draws `const fine = (Math.random() - 0.5) * jitter` from
   **unseeded** `Math.random()` on every blob of every render. So the same
   `(seed, params, ranges)` does *not* reproduce the same SVG. This also silently
   breaks ink's own `encodeId`/`decodeId` "share this exact image" feature. Routing
   that one draw through the seeded `rng` is the fix. Determinism remains a hard
   precondition (our repro + sampled legibility tests depend on it). See `03-asks-for-ink.md` #1.

2. **§5 legibility — moved to the few.chat side; no longer an ink requirement.**
   The generator has no safe-zone concept and won't gain one cheaply. Instead, few.chat
   renders a small scrim/gradient behind the nav logo so legibility is guaranteed
   independent of what the banner paints. The `BannerContext.safeZone`/`overlayColor`/
   `minContrast` fields in §4 are **withdrawn** — ink does not need to honor them.

3. **§5 dimensions — use the fixed 3:1 `banner` preset; no arbitrary sizing.**
   `FORMATS` (≈ line 122) offers only `square` 1000×1000 and `banner` 1500×500. The
   caller cannot request 420×96. few.chat paints the 3:1 preset into the nav box
   (`backgroundSize: 100% 100%`, so a mild horizontal stretch across our ~2.3–4.4:1
   range) — acceptable for an abstract wash. Open item for ink in `03` #5.

4. **Palette — hue-biased, not hex-matched; base color needs a param.**
   Colors are HSL/scheme-based; there is no way to pass exact brand hex. But
   `params.anchorHue` (degrees, ≈ line 237) overrides the hue, so few.chat derives it
   from each theme's `brand.500` (hex → HSL hue) and drives `params.saturation` /
   `params.lightness` ranges from the theme. The one real gap is the **hardcoded
   `#f4efe6` base** (≈ line 364) with no override — it clashes on dark themes. ink adds
   a `params.background` override (`03` #2); until then, dynamic banners ship on
   light/warm themes only (staged rollout).

5. **§1.3 supply chain — the "npm dependency" premise is void.**
   The package is `watercolor-grade-tools`, `private: true`, unpublished, with no root
   `package.json`. An external npm dependency is not currently possible. Since `svg.js`
   is a single `Math`-only, browser-safe UMD file, few.chat's **working assumption is to
   vendor that one file** into `treatments/` — auditable in-tree, no third-party runtime
   pulled into a key-handling app. **Provisional, pending few.chat product-owner
   confirmation** (the alternative is asking ink to extract and publish a trimmed
   package). §1.4's ≤15 KB gz ceiling is informational under the vendor path (the file
   is ~22–28 KB min / ~12–18 KB gz; vendoring lets us trim if needed).

The consolidated, actionable list of what ink must change is `03-asks-for-ink.md`.
