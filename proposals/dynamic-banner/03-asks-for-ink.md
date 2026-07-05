# Asks for ink — dynamic banner

**Status:** Under review — awaiting ink's confirmation
**Owner:** few.chat (integrator). Source refs are to `tools/watercolor/svg.js` in the ink tree.

This is the concrete, prioritized list of what ink needs to change or confirm, derived
from reading the actual generator source (see `02-integration-contract.md` Addendum A).
It supersedes the aspirational generator contract in `02` §4–§5. Items are tagged
**[blocking]** (we can't ship without it), **[needed-for-scope]** (gates dark-theme
support), or **[confirm]** (no code change expected, just a yes/no).

## 1. [blocking] Make `renderSVG` deterministic given a seed

`blobPoints` (≈ line 204) uses raw, **unseeded** `Math.random()`:

```js
const fine = (Math.random() - 0.5) * jitter;   // ← should be rng(), not Math.random()
```

Every other draw already routes through the seeded `mulberry32(seed)` rng. Route this
one through it too.

- **Why it matters to us:** our per-load uniqueness comes from a fresh *seed*, and our
  tests + bug-repro require that a given seed reproduces the exact SVG.
- **Why it matters to you:** your own `encodeId`/`decodeId` "share this exact
  watercolour" feature is currently broken by this — an id can't reproduce its image.
- **Acceptance:** same `(seed, params, ranges)` → byte-identical `svg` string across
  calls.

## 2. [needed-for-scope] Make the background base color overridable

The base rect is hardcoded warm off-white (≈ line 364):

```js
out.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#f4efe6"/>`);
```

Add an optional `params.background` (hex) that overrides it, defaulting to `#f4efe6`
when absent.

- **Why:** an off-white base clashes on our dark themes. Without this, dynamic banners
  can only ship on light/warm themes.
- **Acceptance:** `renderSVG({ params: { background: '#101014' } })` paints that base;
  omitting it is unchanged.

## 3. [confirm] Delivery format

Our working assumption (pending our product owner) is to **vendor `svg.js` directly**
into our tree rather than depend on an npm package, since it's a single `Math`-only,
zero-dependency UMD file. For that we need from you:

- **License** for `svg.js` (there is no root `package.json`/LICENSE we could find — name
  the license and the copyright line you want carried).
- **The canonical version/commit** we vendor from, and how you want us to track updates
  (a tag? a CHANGELOG entry when `renderSVG` output changes for a given seed?).
- If you'd rather we consume an npm package instead, tell us and we'll switch — but that
  puts the extract-and-publish (trimmed, ≤ 15 KB gz) work on you.

## 4. [confirm] Palette anchoring

We will theme the banner by deriving values from each theme, not by passing hex:

- `params.anchorHue` (degrees) — we compute this from the theme's `brand.500`. Confirm
  it fully overrides the seed-derived hue base (per ≈ line 237) and expects 0–360.
- `params.saturation` / `params.lightness` — confirm these constrain the range (we'll
  pass ranges derived from the theme), and name their accepted units/bounds.
- Confirm `params.scheme` values and that omitting it is safe.

## 5. [confirm] Banner format & aspect

We'll use the `banner` preset (1500×500, 3:1) and paint it into a nav box that ranges
~2.3:1 to ~4.4:1, stretched to fill (`backgroundSize: 100% 100%`). Confirm:

- The 3:1 `banner` preset is the intended banner composition (zones distributed
  left-to-right with the 8% side margin).
- You're OK with mild horizontal stretch, **or** you'd prefer to expose a wider
  letterbox format (e.g. ~4:1) so the stretch is smaller. Your call on the look.

## What few.chat owns (not your problem)

- Logo legibility — handled by a scrim behind the nav logo on our side; the generator
  does **not** need a safe-zone feature (the `safeZone`/`overlayColor`/`minContrast`
  fields proposed in `02` §4 are withdrawn).
- The client-only render swap, box reservation + cross-fade (CLS), seed generation per
  load, deriving `anchorHue`/`background` from the theme, the schema field, and all
  tests + staged rollout.

## Open question back to you

Anything in `renderSVG`'s params we should be setting that we haven't mentioned (e.g.
complexity/blob-count knobs that meaningfully affect per-load paint cost on low-end
mobile)? We'll cap for performance; point us at the right levers.
