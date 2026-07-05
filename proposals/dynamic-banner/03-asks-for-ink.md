# Asks for ink — dynamic banner

**Status:** Superseded in part by `05` — see note.
**Owner:** few.chat (integrator). Source refs are to `tools/watercolor/svg.js` in the ink tree.

> **Superseded:** the delivery/packaging question (§3) and the generic base-colour +
> sizing asks (§2, §5) are now folded into the fuller
> `05-ink-artifact-publication-proposal.md`, which reframes them generically (ink as a
> consumer-agnostic library, delivered via a private git repo). This file remains as the
> low-level, source-cited record and for the FYIs/confirmations below.

This is the concrete, source-cited list derived from reading the actual generator source
(see `02` Addendum A).

## 1. [not an ask — FYI] Determinism is NOT required by us

**Correction to an earlier draft:** we do **not** need `renderSVG` to be deterministic.
Per-load uniqueness is the whole point — each reload should paint a fresh, unique
watercolour. We get that by calling `renderSVG` with the seed omitted (fresh geometry)
and freshly-randomized non-identity params each load. Your internal `Math.random()` use
is fine for us and needs no change.

Two FYIs, entirely your call:

- `blobPoints` (≈ line 204) draws `const fine = (Math.random() - 0.5) * jitter` from an
  **unseeded** `Math.random()`, while everything else routes through the seeded
  `mulberry32(seed)` rng. Consequence: the same `(seed, params)` does **not** reproduce
  the same image — which silently breaks your own `encodeId`/`decodeId` "share this exact
  watercolour" feature. Not our problem to solve, but you may want to.
- If *we* ever add a "pin / share this exact view" feature, we'd need that same fix. Not
  planned for v1. Flagging so it's on the radar.

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

## 4. [confirm] Colour-identity pinning approach

We read the source and derived the approach ourselves (see `04-few-chat-change-plan.md`).
Each load we call `renderSVG({ params })` with a full `randomizeParams()` object whose
**four identity fields are overridden**: `anchorHue` (0–359), `scheme` (one of the six
enum values), `saturation` (20–100), `lightness` (20–75); `format: 'banner'`. This fixes
colour character while composition varies. Just confirm:

- This is the intended way to get "unique-but-on-theme," and pinning those four is the
  right envelope — or you'd recommend pinning more/less.
- There's no cleaner API you'd rather we use than `randomizeParams()` + override.

## 5. [confirm] Banner format & aspect

Only `square` (1:1) and `banner` (3:1, 1500×500) exist. We use `banner`, painted into a
nav box ranging ~2.3:1 to ~4.4:1, stretched to fill (`backgroundSize: 100% 100%`).
Confirm you're OK with mild horizontal stretch, **or** whether you'd expose a wider
letterbox (~4:1) so the stretch is smaller. Your call on the look — not blocking.

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
