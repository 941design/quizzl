# Proposal to ink — publish the watercolour generator as a generic visual-element library

**To:** ink maintainers
**From:** few.chat
**Re:** Packaging `renderSVG` as a versioned, private, consumer-agnostic library
**Status:** Answered by ink — see `ink-channel-log.md` for the resolution. §7 all answered
(subpackage + git tag, direct `WatercolorSVG` + typed `StyleToken`, arbitrary sizing,
`baseColor`). Converged simplifications: **`budget` and the `variety` scalar are withdrawn**
(IQ1/IQ2), the return contract is **`{ svg, id }`** (IQ3), and the build is **ESM-only** (IQ5).
The illustrative `StyleToken` below should read **saturation 20–100, lightness 20–75** (not
0–100), per ink's Q6 caveat.

---

## 1. The ask, in one sentence

Publish your watercolour generator as a **generic, versioned, browser-safe library**,
distributed from a **private git repository**, exposing a stable interface that makes
**no assumptions about any consumer** — so we (and anyone after us) depend on a
documented contract, not on your internals.

## 2. Why — and why not vendor or npm

We're building a brand-new, self-generating theme on top of your generator. We do **not**
want to copy your source into our tree (it drifts, no version story) or couple to your
internal `params`/`PARAM_DEFS` shape (breaks the moment you refactor). We want to depend
on a **stable, versioned, generic API**.

Distribution should keep the artifact **private** — a **private git repo** does that while
still giving us semver and updates (`"@ink/visuals": "git+ssh://…#v1.2.0"`). No public npm,
no exposure. This is the compromise we're proposing for delivery.

## 3. Keep the interface generic — the core principle

Your library should describe **generic visual elements** and a **generic style identity**,
and never a consumer's concepts. No "nav banner", no brand colours, no app-specific
dimensions, no framework. Everything specific stays on our side (§4).

Grounded in what you already have, the generic contract has three parts:

- **A style token (a generic "theme").** You already have this: your "Copy theme" button
  exports `params`-minus-seed — a portable colour identity. Formalize it as a first-class
  value: `{ anchorHue, scheme, saturation, lightness, baseColor?, … }`. Pinning it keeps
  repeated renders coherent; the consumer decides what it *means*. This **is** a generic
  theme — expose it as one.
- **An element request.** A `kind` plus a target `width`/`height`. Today your only real
  output is a **rectangular fill** (what your own UI calls masthead/hero/banner). That is
  the first generic kind. Buttons, cards, tiles, avatars — which your UI copy already
  names — are **fills the consumer clips into a shape** (§4), not renderers you must build.
- **Variety & reproducibility.** Fresh by default (omit `seed` → unique every call, which
  is our core need); an optional `seed` for reproducibility; an optional variety amount.
- **Output.** A self-contained SVG string — which you already produce cleanly (no scripts,
  no external refs, opaque base, seed-namespaced filter ids). Generic: any consumer can
  inline it, use it as a background image, or rasterize it.

Illustrative surface (yours to shape — this is a thin, generic wrapper over `renderSVG`):

```ts
type ElementKind = 'fill' | 'banner' | 'background';   // a growable set

interface StyleToken {                                  // the generic "theme"
  anchorHue: number;      // 0–359
  scheme: Scheme;         // your six harmony names
  saturation: number;     // 0–100
  lightness: number;      // 0–100
  baseColor?: string;     // the paper/backing tone — see §5.4
}

interface RenderRequest {
  kind: ElementKind;
  width: number;          // arbitrary px — see §5.3
  height: number;
  style: StyleToken;
  seed?: number;          // omit → fresh; provide → reproducible
  variety?: number;       // optional 0..1
  budget?: 'lite' | 'full';
}

interface RenderResult { svg: string; id: string; width: number; height: number; }

function render(req: RenderRequest): RenderResult;
```

This renames "params-minus-seed" to a `StyleToken`, adds arbitrary sizing, and hides
`PARAM_DEFS` behind a documented, stable surface. Everything else is your existing engine.

## 4. The compromise — what ink provides vs. what the consumer scaffolds

The dividing line is **shape and state are where app assumptions live.** Your strength is
the organic fill; anything shaped or stateful is the consumer's job.

| Concern | ink (generic) | consumer (few.chat) |
|---|---|---|
| Organic watercolour **fill** at a requested size | ✅ | |
| Composed decorative rectangles (banner / background / hero) | ✅ | |
| A portable **style token** (colour identity, replayable) | ✅ expose it | pins one per theme |
| Non-determinism per load | ✅ default (omit seed) | triggers a fresh render each load |
| Clipping a fill into a **component shape** (button, card, avatar, radius) | provides the fill | ✅ masks / clips it |
| Sizing for a specific slot | arbitrary `width`/`height` | requests the size it needs |
| **State** (hover/active/disabled), overlaid-text legibility, theming semantics | — | ✅ owns it |
| Framework, brand, product concepts | — (none) | ✅ all here |

So: **you provide fills and composed rectangles; we clip and place them.** That is how
buttons and cards get built from your output without your library knowing what a button
is. Your own UI already frames the watercolour as usable for "cards, tiles, avatars,
masthead, hero" — this formalizes exactly that, with the shaping on our side.

## 5. Concrete, bounded requests (grounded in your current source)

Publishing is modest — the source is already clean, browser-safe, and zero-dependency
(`sharp` lives only in `generate.js`, never in `svg.js`).

1. **Package it.** A `package.json` for the library (a subpackage of the repo, or a new
   private repo), with `exports['.']`, `"type": "module"`, a `"browser"` field, and a
   bundle step (esbuild / tsup / rollup) emitting ESM (+ CJS) from the UMD source. No peer
   deps.
2. **Type it.** `.d.ts` for `render` / `renderSVG`, the `PARAM_DEFS` fields,
   `encodeId` / `decodeId` / `randomizeParams`, and the `StyleToken` shape. (None exist
   today.)
3. **Generic surface.** Wrap `renderSVG` in the generic `render(req)` above — or, minimally,
   document `renderSVG` + `randomizeParams` as the stable API and export the
   params-minus-seed **style token** as a named type. Either way, the params internals
   should sit behind a documented contract.
4. **Arbitrary size + generic base colour.** Two capability gaps for a *generic* library:
   - `FORMATS` today offers only `square` (1000×1000) and `banner` (1500×500) — a generic
     sizing contract needs **arbitrary width/height** (or at least a set of aspect presets).
   - The base rect is hardcoded `#f4efe6` (`svg.js` ≈ line 364). A generic library
     shouldn't bake a paper tone — expose it as `style.baseColor`. (This same change is
     what lets us support dark themes, but the framing is generic.)
5. **Distribute privately.** Push to a **private git repo**, tag semver releases; we consume
   via `git+ssh`. Ship a short README documenting the generic interface and the
   **style-token (generic theme) vs image-id (exact render)** distinction.
6. **(Optional) Make the seed honest.** `blobPoints` (≈ line 204) draws from unseeded
   `Math.random()`, so an `id`/seed does **not** currently reproduce an image byte-for-byte
   — meaning your own "reproduce the exact image" story is aspirational today. Routing that
   one draw through the seeded rng makes it true. Optional for us (we want fresh renders);
   worth it for your `encodeId`/`decodeId` contract.

## 6. What we are explicitly NOT asking

- Not asking your library to know anything about few.chat, our framework, our brand, our
  layout, or our product. **Zero consumer assumptions** — that's the whole point.
- Not asking for button/card **renderers** — only fills we clip.
- Not asking you to go public — a **private git repo** is the agreed delivery.
- Not asking for determinism as a requirement — only as an optional fix for your own id
  feature (§5.6).

## 7. Decisions for you

1. **Where:** a subpackage of the existing repo, or a new private repo? (We consume either
   via git.)
2. **Surface:** adopt the generic `render(req)` wrapper, or expose `renderSVG` +
   `randomizeParams` directly with a documented `StyleToken` type? (Wrapper = cleaner
   long-term contract; direct = less work now.)
3. **Sizing:** can `FORMATS` become arbitrary `width`/`height`, or would you rather expose a
   small set of named aspect presets?
4. **Ownership & timeline:** who writes the types + build config, and by when? (This is the
   only real work — the engine is done.)

---

**Bottom line:** we're asking you to wrap an engine you've already built in a thin, generic,
typed, versioned skin and push it to a private git repo. Keep it assumption-free — generic
elements (fills, banners) driven by a generic style token — and we'll do all the
consumer-specific shaping, placing, and theming on our side. The boundary in §4 is the
compromise; §7.1–7.2 are the only choices that change the shape of the work.
