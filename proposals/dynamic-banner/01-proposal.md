# Proposal: Dynamic banner treatments for the theme system

**To:** few.chat theme-system maintainers
**From:** rotheric / `ink` (watercolour generator)
**Re:** Extending `treatments.banner` to support banners generated at page-load time
**Status:** Agreed — §7 decisions resolved in `02-integration-contract.md` §1. Kept as the original record; content unchanged.

---

## 1. The ask, in one sentence

Let a theme opt into a **banner that is regenerated in the browser on every page
load** — a fresh, unique decorative image each time — while keeping the manifest
pure data, the palette static and contrast-checked, and the static-export build
model untouched.

Concretely: a `calm`-style theme could ship a watercolour banner where **no two
loads ever show the same image**, without any theme becoming executable code and
without weakening the contrast gate.

## 2. What changes for users (and what doesn't)

**Changes:** A theme that opts in shows a different banner image on each reload —
generated client-side from a seed. For a watercolour theme, that means a living,
never-repeating header instead of one frozen illustration.

**Does not change:**

- The **palette stays static and contrast-checked.** Text legibility is guaranteed
  by the same build-time gate as today. Only the decorative banner varies.
- **Every existing theme keeps working, untouched.** The change is purely additive
  and opt-in; a theme that doesn't ask for it renders exactly as it does now.
- **The manifest stays pure data.** No theme gains a function, an import of app
  code, or a runtime dependency. (This is the crux — see §4.)
- **Static export is preserved.** No server, no runtime filesystem reads, no change
  to the codegen registry model.

## 3. Why this can't be done in a theme folder today

Three facts from the current system make a per-reload banner impossible to express
as a theme:

- `treatments.banner` is a **literal SVG string** baked into the manifest at build
  time. Every reload serves the same bytes.
- Manifests are **pure data — no functions**; the guide explicitly names a
  "token-derived visual… computed from your own tokens" as a *deliberate non-goal*.
- The app is a **static export** (`output: 'export'`); themes resolve at build time
  and there is "no way to read theme folders at runtime."

`colors.backgroundImage` doesn't help either — a data-URI or a SMIL/CSS animation is
still one fixed asset that replays identically each load. Producing a *new* image
requires fresh randomness, which requires code that runs at load time.

So this is not a theme-authoring gap. It is a **rendering-model** feature that must
live in shared app code. That is what this proposal is about.

## 4. The design: a dynamic banner is just another named treatment

The theme system already has a clean pattern for "a visual whose implementation
lives in shared code, selected and parameterised by manifest data": **named
treatments.** A manifest doesn't *contain* an elevation or a surface pattern — it
names one (`card: 'softDrop'`, `surface: 'petals'`) from a closed catalog, and the
implementation lives in `treatments/*.ts`. Adding a genuinely new primitive is
"a one-file library edit, not a manifest concern."

**A dynamic banner fits this model exactly.** The manifest names a generator from a
closed union and hands it flat data; the generator's code lives in shared
`treatments/`. The only new idea is that this particular treatment's output is
computed **client-side on mount** instead of baked at build time.

### Manifest surface (additive, opt-in)

`treatments.banner` (the static SVG string) **remains required and unchanged** — it
becomes the first-paint / no-JS / SSR fallback. A new optional sibling opts into
dynamic rendering:

```ts
treatments: {
  // ...existing fields...
  banner: `<svg ...>…</svg>`,          // still required — static fallback
  bannerDynamic?: {                     // NEW, optional
    generator: 'watercolor';            // closed union, like iconSet / surface
    params?: Record<string, unknown>;   // flat theme data (seed policy, palette hints)
  };
}
```

`generator` is a closed literal union validated by zod, exactly like
`ElevationName` / `SurfacePatternName` / `IconSetName`. `params` is inert data. **The
manifest still contains no functions and imports no app code** — it references a
generator by name, and the generator itself is a scoped addition to
`treatments/banners.ts` (plus the matching union member in `schema.ts`), reviewed
and shipped by you, not by theme authors.

### Rendering path

Replace the static banner render site with a small component:

- **Server / build (static export):** render `treatments.banner` — the existing
  static SVG string. This is what ships in the HTML and what search engines and
  no-JS clients see. **No hydration risk**, because the server output is
  deterministic.
- **Client, on mount (`useEffect`):** if `bannerDynamic` is present, pick a fresh
  seed and swap the fallback for a newly generated SVG. Because this happens strictly
  after hydration and client-only, there is no server/client markup mismatch.

This is progressive enhancement: the static banner is always correct; the dynamic
one is an enhancement layered on top.

### Generator contract (the library boundary)

The `watercolor` generator is a dependency-light function with a fixed signature:

```ts
generateBanner(seed: number, params?: Record<string, unknown>): string  // self-contained SVG
```

We (rotheric/`ink`) supply and maintain this generator. Its guarantees:

- **Self-contained SVG** — no external refs, no `<script>`, inline filters only.
- **Namespaced ids** per invocation — no gradient/filter id collisions when multiple
  banners or remounts coexist in one DOM.
- **Opaque backing baked in** — so `mix-blend-mode: multiply` composites against a
  known backdrop, not whatever sits behind the banner in the app.
- **Bounded complexity** — a capped blob/filter budget for the banner variant so
  per-load paint stays cheap on low-end mobile.

## 5. What we deliberately do NOT propose

**We do not make the palette dynamic.** Tempting, but rejected on mechanism: the
contrast gate guarantees legibility by measuring *static* hex tokens at build time.
Reseeding the palette per load moves colour selection to the client, which would
(a) forfeit that guarantee, (b) require shipping the contrast gate into the client
bundle, and (c) still risk a visible flash of illegible text before/without
validation. The entire theme system exists to prevent exactly that failure. So:
**dynamic banner, static chrome.** It's also the better look — stable, legible
frame around a lively decoration.

**We do not make manifests reference functions.** A manifest that imported a
generator function would dissolve the "manifests are pure data" invariant, break the
build-time codegen registry, and turn every theme into executable code — a
whole-system blast radius to save one component. The named-generator indirection
(§4) delivers the same feature while keeping every existing invariant intact.

## 6. Risks and mitigations

| Risk | Mechanism | Mitigation |
|---|---|---|
| Hydration mismatch | A random seed during prerender wouldn't match the client | Generate **client-only** in `useEffect`; server always renders the static `banner` |
| Paint cost on mobile | Watercolour SVG uses `feTurbulence`, blur, `mix-blend-mode` | Capped complexity budget in the generator; measure on a low-end device before ship |
| `mix-blend-mode` compositing wrong | Banner multiplies against the app backdrop, not its design surface | Opaque backing rect baked into every generated SVG |
| Global `id` collisions | Inlined SVG ids are global in the page DOM; remounts collide | Per-instance id namespacing in the generator |
| Layout shift (CLS) | Dynamic banner appears after hydration | Reserve the banner box; cross-fade the generated SVG into it |
| No-JS / first paint blank | Generator only runs client-side | Static `banner` remains required and renders server-side — always a correct image |
| Contrast regression | — | None: banner is not a contrast-checked token, and the palette stays static |

## 7. Decisions we need from you

These are yours to make; each changes the shape of the work.

1. **Do you accept the named-generator model (§4)** — a closed `generator` union with
   implementations in shared `treatments/`, opt-in via `bannerDynamic`, static
   `banner` retained as fallback? This is the load-bearing architectural choice.

2. **Truly-unique per load, or varied-from-a-pool?**

   | | A. Client generator (truly unique) | B. Build-time pool of N, random pick per load |
   |---|---|---|
   | Uniqueness | New every reload | Varies, repeats within N |
   | App change | New dynamic-banner component + generator in client bundle | Pick 1 of N static strings on mount |
   | Runtime risk | Hydration/paint/id caveats (all mitigated above) | Near-zero |
   | Format impact | `bannerDynamic` field + render-path change | Fits today's format almost as-is |

   Option A is what "unique on every reload" strictly requires. Option B buys most of
   the freshness at a fraction of the risk if "feels fresh" is enough. Our proposal
   above assumes **A**; we can descope to **B** if you prefer.

3. **Who owns the generator dependency?** We propose rotheric/`ink` publishes and
   maintains the `watercolor` generator as a small, dependency-light module you
   import into `treatments/banners.ts`. Alternative: we vendor the generator source
   into your tree so it ships and versions with the app. Your call on supply chain.

4. **Bundle-size ceiling.** The generator adds client JS. Tell us your acceptable
   budget and we'll fit the banner variant under it (the full renderer is larger than
   the banner needs; we'll ship a trimmed entry point).

## 8. Rollout and validation

- **Backward compatibility:** additive and opt-in. Existing manifests validate and
  render unchanged; the new field is optional.
- **Validation gate:** `bannerDynamic.generator` joins the enum-catalog check
  (unknown generator → build failure), exactly like the existing treatment unions.
  The contrast gate is untouched (banner isn't a contrast token).
- **Staging:** ship behind `status: 'experimental'` on a single watercolour theme
  first; measure paint cost and hydration behaviour on real devices before promoting.
- **Fallback proof:** disable JS and confirm the static `banner` renders — the
  no-JS path must always show a correct, legible image.

---

**Bottom line:** dynamic banners don't require bending the theme system's
principles — they fit its existing "named treatment, implementation in shared code"
model. The manifest stays pure data, the palette stays static and legible, static
export is preserved, and every current theme keeps working. The single genuine
decision is §7.1: whether you accept a client-computed treatment as a first-class
citizen of the catalog. Everything else follows from that.
