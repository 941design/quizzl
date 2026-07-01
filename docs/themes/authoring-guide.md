# Theme Authoring Guide

This guide documents how to add a new theme to the app. It is written against the
shipped implementation under `app/src/themes/` — every field name, type, and rule
below was verified against the actual source (`schema.ts`, `contrast.ts`,
`treatments/*`, `fontUnion.ts`, `generate-theme-registry.mjs`), not against an
earlier design draft. If anything here ever disagrees with the code, the code wins;
please file a fix.

A theme is **one self-contained folder** under `app/src/themes/<id>/` containing a
single `manifest.ts` file. Adding a theme that composes existing treatments requires
**no edits to any shared file** — you drop a folder, the build picks it up.

## Table of contents

1. [Folder structure](#1-folder-structure)
2. [The `ThemeManifest` field reference](#2-the-thememanifest-field-reference)
3. [The treatment catalog and the `overrides` escape hatch](#3-the-treatment-catalog-and-the-overrides-escape-hatch)
4. [Contrast requirements](#4-contrast-requirements)
5. [Typography and `FontLoad`](#5-typography-and-fontload)
6. [Banner and asset options](#6-banner-and-asset-options)
7. [Localization](#7-localization)
8. [`status` behavior](#8-status-behavior)
9. [Running validation locally](#9-running-validation-locally)
10. [A fully worked sample theme](#10-a-fully-worked-sample-theme)
11. [Gotchas](#11-gotchas)

## 1. Folder structure

```
app/src/themes/
  schema.ts               # zod ThemeManifestSchema + ThemeManifest type + validateManifest()
  contrast.ts              # wcagRatio(hex, hex) + evaluateThemeContrast(manifest)
  fontUnion.ts              # buildThemeFonts(manifests) + buildFontLinkHref(fonts)
  buildChakraTheme.ts       # manifest -> Chakra theme-override transform
  treatments/
    elevation.ts            # named per-surface elevation prop-sets
    patterns.ts              # named surface/background patterns
    iconSets.ts               # icon-name -> iconify-id maps per icon set
  registry.generated.ts     # GENERATED — do not hand-edit
  index.ts                   # public API
  <your-theme-id>/
    manifest.ts               # <- this is the only file you author
```

To add a theme:

1. Create `app/src/themes/<id>/manifest.ts`.
2. `export const manifest: ThemeManifest = { ... }` (and `export default manifest`,
   matching the existing themes).
3. **`id` MUST equal the folder name** (`calm/manifest.ts` exports `id: 'calm'`,
   `minecraft/manifest.ts` exports `id: 'minecraft'`, etc.) — the build's drift check
   fails if they diverge.
4. Run the validation gate locally (§9) before committing.

Nothing else needs to change. The registry, the picker, the font `<link>` tag, and
the Chakra theme object are all derived automatically from the set of folders present.

## 2. The `ThemeManifest` field reference

The manifest is **pure data** — no Chakra import, no functions, fully JSON-shaped
and zod-validatable (`app/src/themes/schema.ts`, `ThemeManifestSchema`). Every
object level is `.strict()`: an unexpected or misspelled key fails validation loudly
rather than being silently ignored.

### Top-level fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | `string` | yes | MUST match `^[a-z][a-z0-9-]*$` and MUST equal the folder name. |
| `order` | `number` (positive integer) | yes | MUST be unique across all themes. Drives `APP_THEMES` key order and the picker's display order. Reassigning `order` on an existing theme is a normal, intended edit — only a **collision** (two themes sharing the same `order`) fails the build. |
| `label` | `{ en: string; de?: string }` | yes | Display name. See §7. |
| `description` | `{ en: string; de?: string }` | yes | Picker subtitle. See §7. |
| `previewColorScheme` | `'brand' \| 'success' \| 'warning' \| 'danger'` | yes | Which color scale the theme-picker preview swatch uses. |
| `author` | `string` | no | |
| `license` | `string` | no | |
| `status` | `'stable' \| 'experimental' \| 'hidden'` | no | See §8. |
| `colorScheme` | `'light' \| 'dark'` | yes | **Descriptive metadata only.** The contrast gate never reads this field — it always measures actual hex values (§4). |
| `colors` | `ThemeColors` object | yes | See below. |
| `typography` | `Typography` object | yes | See §5. |
| `shape` | `{ radii?: Record<string,string>; borderWidths?: Record<string,string> }` | no | |
| `treatments` | `Treatments` object | yes | See §3. |
| `contentSurface` | `boolean` | no | See §4. |

### `colors`

| Field | Type | Required | Notes |
|---|---|---|---|
| `brand`, `success`, `warning`, `danger`, `neutral` | 10-string tuple (hex/CSS color) | yes | Ordered `[50, 100, 200, 300, 400, 500, 600, 700, 800, 900]`. Expanded into Chakra's `Record<number, string>` scale shape at build time — author as a flat array. |
| `appBg` | `string` | yes | The app-level page background. |
| `backgroundImage` | `string` | no | CSS `background-image` value (gradient, pattern). Decorative only — see §11. |
| `surfaceBg` | `string` | yes | Card/panel surface background. |
| `surfaceMutedBg` | `string` | yes | |
| `surfaceRaisedBg` | `string` | yes | |
| `borderSubtle` | `string` | yes | |
| `borderStrong` | `string` | yes | |
| `textMuted` | `string` | yes | |
| `textStrong` | `string` | yes | |
| `successBg`, `successBorder`, `successText` | `string` | yes | |
| `warningBg`, `warningBorder`, `warningText` | `string` | yes | |
| `dangerBg`, `dangerBorder`, `dangerText` | `string` | yes | |
| `buttonColorScheme` | `'brand' \| 'success' \| 'warning' \| 'danger'` | yes | Which scale Chakra's default button variant resolves against. |

**Tokens that participate in a required contrast pair (§4) MUST be a bare 3- or
6-digit hex string** (with or without a leading `#`) — not a named CSS color, not
`rgb()`/`rgba()`, not `hsl()`. That set is `textStrong`, `textMuted`, `appBg`,
`surfaceBg`, `surfaceMutedBg`, `surfaceRaisedBg`, and the status text/bg pairs
(`successText`/`successBg`, `warningText`/`warningBg`, `dangerText`/`dangerBg`).
This isn't a style preference for those tokens: the contrast gate (§4) computes
WCAG ratios directly from hex channel values, and it treats any non-hex value in
one of these slots as a **hard failure** for every pair it participates in (a
failure, not a silent pass — see §4).

The schema itself (`schema.ts`) does not constrain any color token's format — every
`colors` field, including the scale steps (`brand`/`success`/`warning`/`danger`/
`neutral`) and the remaining semantic tokens (`borderSubtle`, `borderStrong`,
`successBorder`, `warningBorder`, `dangerBorder`), accepts any CSS color string and
will not fail the build if non-hex. **Using hex for every token anyway is a
recommended convention**, not a build-enforced rule outside the contrast-pair list
above — it keeps the palette consistent and avoids surprises if a token later
becomes contrast-checked. If you want a translucent or gradient effect, use
`colors.backgroundImage` (§6) or the `overrides` escape hatch (§3), not a non-hex
value in one of the contrast-pair-participating slots.

### `typography`

See §5 for the full `FontLoad` reference.

| Field | Type | Required |
|---|---|---|
| `fonts.heading` | `string` (CSS font stack) | yes |
| `fonts.body` | `string` (CSS font stack) | yes |
| `fonts.display` | `string` | no |
| `fontLoad` | `FontLoad[]` | yes (may be `[]`) |
| `fontSizes` | `Record<string, string>` | no |

### `treatments`

See §3 for the full catalog.

| Field | Type | Required |
|---|---|---|
| `card` | `ElevationName` | yes |
| `button` | `ElevationName` | yes |
| `nav` | `ElevationName` | yes |
| `surface` | `SurfacePatternName` | yes |
| `iconSet` | `IconSetName` | yes |
| `banner` | `string` (raw SVG markup) | yes |
| `contentPanel` | `ContentPanelName` (`'panel'`) | no |
| `overrides` | `{ card?; button?; nav?; surface?: Record<string, unknown> }` | no |

## 3. The treatment catalog and the `overrides` escape hatch

A theme's "look" is **decomposed per surface** — there is no single closed
`visualStyle` enum. Each of `treatments.card`, `treatments.button`, and
`treatments.nav` independently selects one named elevation; `treatments.surface`
independently selects one named background pattern; `treatments.iconSet`
independently selects one named icon set. You can freely mix and match — e.g. a
theme can use `pixelBevel` cards with a `petals` surface pattern, even though no
shipped theme currently does.

### Elevation names (`treatments/elevation.ts`)

`flat | softDrop | hardDrop | pixelBevel | floralGlow`

These apply to `card`, `button`, and `nav` independently. `flat` and `softDrop`
currently render identically (both resolve to an empty style set) — they are kept
as two distinct names so future themes can diverge them without a breaking rename.

### Surface pattern names (`treatments/patterns.ts`)

`none | studs | grid | petals`

Applies to `treatments.surface`. There are also three named `appBg` gradient
strings authored as reference constants in this file (`APP_BG_GRADIENTS.lego`,
`.minecraft`, `.flower`) — a manifest cannot `import` these (manifests may only
import the `ThemeManifest` type), so if you want one of these exact gradients,
copy the literal string into `colors.backgroundImage`.

### Icon set names (`treatments/iconSets.ts`)

`line | filled | pixel`

Applies to `treatments.iconSet`. Each of the 12 known icon names (`heart`, `check`,
`close`, `home`, `settings`, `clock`, `prev`, `next`, `bell`, `person`, `phone`,
`video`) maps to a concrete iconify id per set. Unknown icon names resolve to an
empty string; the icon-lookup falls back to `line` if a set is somehow missing an
entry for a known name.

### Content panel names (`treatments/elevation.ts`)

`panel` (the only value today — `treatments.contentPanel` is optional and only
meaningful when combined with `contentSurface: true`, see §4).

### The `overrides` escape hatch — and its limits

`treatments.overrides` lets you pass raw Chakra `BoxProps` per surface
(`card`, `button`, `nav`, `surface`) that get merged on top of whatever the named
treatment produces. It is intentionally permissive (unvalidated `Record<string,
unknown>`) because zod cannot meaningfully type-check arbitrary Chakra style props.

**What `overrides` is for:** small, manifest-local nudges — an extra `borderRadius`,
a one-off `boxShadow` tweak — layered on top of an existing named treatment.

**What `overrides` is NOT for**, and where the real boundary sits:

- **Composing existing treatments is folder-only.** If your theme's whole look can
  be expressed by picking existing `ElevationName`/`SurfacePatternName`/
  `IconSetName` values (plus small `overrides` nudges), you never touch shared code
  — just add your folder.
- **A genuinely new treatment primitive is a one-file library edit, not a manifest
  concern.** If you need an elevation, pattern, or icon-set behavior that doesn't
  exist yet, that is a scoped change to `treatments/elevation.ts`,
  `treatments/patterns.ts`, or `treatments/iconSets.ts` (and the matching literal
  union in `schema.ts`) — not something you can express purely from your own
  manifest's data.
- **Manifests are pure data and cannot compute treatments from their own tokens.**
  For example, an SVG banner whose fill color is derived from `colors.brand[500]`
  is not expressible — manifests have no functions. If you need a token-derived
  visual (a banner, pattern, or gradient colored from your own scale), you must
  either pre-render it as a static asset/string, or accept the `overrides` escape
  hatch's flat, non-computed nature. This is a deliberate non-goal, not a bug —
  see spec §3.

## 4. Contrast requirements

The build-time validation gate computes real WCAG contrast ratios from **actual
color hex values only** — never from `colorScheme` or `contentSurface` as a
shortcut. The threshold is **WCAG AA, normal text: 4.5:1**.

### Required pairs

**Always required, for every theme, regardless of `contentSurface`:**

| Text token | Surface token |
|---|---|
| `textStrong` | `surfaceBg` |
| `textMuted` | `surfaceBg` |
| `textStrong` | `surfaceMutedBg` |
| `textMuted` | `surfaceMutedBg` |
| `textStrong` | `surfaceRaisedBg` |
| `textMuted` | `surfaceRaisedBg` |
| `successText` | `successBg` |
| `warningText` | `warningBg` |
| `dangerText` | `dangerBg` |

**Required only when `contentSurface` is falsy** (page text rendered directly on
the app background):

| Text token | Surface token |
|---|---|
| `textStrong` | `appBg` |
| `textMuted` | `appBg` |

If `contentSurface` is `true`, page content is understood to float on a light
`surfaceBg`-backed panel instead of sitting directly on `appBg`, so the `appBg`
pairs are exempt. **Set `contentSurface: true` if your theme's `appBg` is dark or
otherwise cannot pass the `textStrong`/`textMuted` vs. `appBg` pairs** — the
shipped `minecraft` theme does exactly this (its dark brown `appBg` would fail the
`appBg` pairs outright, so page content instead renders inside a light
`treatments.contentPanel: 'panel'` box).

### Fail-loud on non-hex tokens

Every color token participating in a required pair MUST be a parseable 3- or
6-digit hex value. A named CSS color, `rgb()`/`rgba()`, or `hsl()` value is treated
as a **gate failure** for every pair it appears in — not a silent pass. This is
deliberate: an unparseable value would otherwise drive the contrast computation to
`NaN`, and `NaN < 4.5` evaluates to `false` in JavaScript, which would let an
illegible color slip through the exact check meant to catch it.

### A known limitation

The gate evaluates *semantic-token hex pairs* only — it does not inspect
`backgroundImage`. A `colors.backgroundImage` that paints an opaque dark field over
an otherwise light `appBg` could pass the token gate while still rendering
low-contrast text underneath it in practice. **Keep `backgroundImage` decorative
and low-opacity so `appBg` remains the effective text background** — see §11.

## 5. Typography and `FontLoad`

```ts
type FontLoad = {
  family: string;
  weights?: number[];
  ital?: boolean;
  subset?: string;
};
```

Each `typography.fontLoad` entry describes one Google Fonts family to load. At
build time, every theme's `fontLoad` entries are merged into a single deduplicated
union (`buildThemeFonts`, `app/src/themes/fontUnion.ts`) — if two themes both use
the same family, their `weights` are unioned and `ital` is OR'd, so a single
`<link>` tag serves every theme. **You do not edit `_document.tsx` to add a font**
— declaring `fontLoad` in your manifest is sufficient; the union and the Google
Fonts CSS2 URL are both derived automatically.

Encoding rules for the built URL (informational — you don't write the URL
yourself): families are sorted by a stable code-unit comparison (not
locale-aware); `ital`-only encodes as `Family:ital@0;1`; `weights`-only encodes as
`Family:wght@w1;w2;...`; both together encodes as
`Family:ital,wght@0,w1;1,w1;...`; neither produces a bare `Family` (system font —
no Google Fonts fetch needed, e.g. `calm` and `playful` both use `fontLoad: []`
with a system font stack).

`subset` is reserved (accepted by the schema, not yet exercised by any shipped
theme) for a future need to constrain a font's character subset.

## 6. Banner and asset options

`treatments.banner` is a **raw inline SVG string** rendered as the theme's banner
decoration (see the shipped manifests for worked examples — every one of `calm`,
`playful`, `lego`, `minecraft`, `flower` embeds its own `<svg>...</svg>` literal
here). There is no separate "asset" indirection — the manifest carries the SVG
markup itself.

`colors.backgroundImage` is an optional CSS `background-image` value (a gradient
or repeating pattern string) applied to the app background. **It must stay
decorative and low-opacity** — see §4's contrast limitation and §11. All three
shipped themes that set it (`lego`, `minecraft`, `flower`) use translucent linear/
radial gradients layered over an opaque `appBg`, never an opaque image that could
itself become the effective text background.

## 7. Localization

`label` and `description` are `{ en: string; de?: string }`, authored **inline in
the manifest** — not through `i18n.ts`'s `Copy` keys. This is a deliberate,
narrowly-scoped exception to the project-wide "all UI text goes through
`useCopy()`/`i18n.ts`" rule: theme label/description text is *owned by the theme's
own manifest*, not shared app chrome, so it travels with the theme folder instead
of living in a separate global file that would need editing for every new theme.

`en` is required. `de` is optional — when a manifest omits `de`, the picker falls
back to the `en` string for German-language users.

## 8. `status` behavior

`status` is one of `'stable' | 'experimental' | 'hidden'` (optional — omitting it
behaves like `'stable'` for display purposes).

- `APP_THEMES` (the full registry) **always contains every theme**, including
  `status: 'hidden'` ones. This keeps the folder-set/registry invariant intact —
  `Object.keys(APP_THEMES)` always equals the set of theme folders.
- `listThemes()` — the function the profile picker actually renders — **excludes**
  `status: 'hidden'` themes by default. Pass `listThemes({ includeHidden: true })`
  to get every theme regardless of status.
- A theme id that is `hidden` is still build-valid and still resolvable: a stored
  (already-selected) hidden theme id **remains valid** and normalizes to itself — a
  user who already picked it keeps it, even though it no longer appears in the
  picker for new selections.
- A stored theme id that has been **removed entirely** (no longer present in
  `APP_THEMES` at all) falls back to the default theme.

Use `status: 'hidden'` for a theme you want build-valid and reachable by direct id
but not offered in the picker (e.g. an internal/test fixture theme, or a theme
being staged before a public announcement). Use `status: 'experimental'` purely as
descriptive metadata — it does not change validation or visibility behavior.

## 9. Running validation locally

The full gate is wired into `npm run prebuild` (which runs automatically before
`npm run build` / `make build`):

```sh
cd app
npm run prebuild
# equivalent to:
#   node scripts/generate-theme-registry.mjs
#   && vitest run tests/unit/themes-validation.test.ts
```

This regenerates `registry.generated.ts` from the current set of theme folders,
then runs the full value-level validation suite: `ThemeManifestSchema.parse` per
manifest (catches missing/mistyped/extra fields), `id === folder name`, `order`
uniqueness, the contrast gate (§4), the folder/registry drift check, the metadata-
freshness check, the font-URL parity check, and the zod-boundary check.

You can also run just the validation test directly (useful once
`registry.generated.ts` is already fresh):

```sh
cd app
npx vitest run tests/unit/themes-validation.test.ts
```

### Verifying the build actually aborts on a broken theme

To confirm for yourself that a broken theme really does fail the build (rather
than just failing a test you might not be running), do this on a scratch branch or
stash your change afterward:

```sh
cd app
# 1. Break a real manifest, e.g. set an invalid id:
#    edit app/src/themes/calm/manifest.ts, change `id: 'calm'` to `id: 'Calm'`
#    (uppercase — violates the ^[a-z][a-z0-9-]*$ regex)
npm run prebuild
# -> exits non-zero. In practice this cascades into several failing
#    assertions at once (schema/id-consistency, contrast, order-uniqueness,
#    drift), because REGISTRY_APP_THEMES.calm no longer resolves once the
#    manifest's own id no longer matches its folder key — but the net effect
#    is unambiguous: a non-zero exit naming "calm"/"Calm" in the failures.
echo "exit code: $?"
npm run build
# -> `next build` never actually runs, because `prebuild` is npm's pre-hook for
#    `build` and npm aborts the `build` script when `prebuild` exits non-zero
# 3. Restore the manifest back to its original id before committing anything.
```

This exact recipe (verified against the live tree while writing this guide): editing
`calm/manifest.ts`'s `id` to `'Calm'` and running `npm run prebuild` produced 12
failing assertions across the schema, id-consistency, contrast, drift, and
enum-catalog checks, and a non-zero process exit — confirming the build genuinely
aborts rather than merely warning.

### Idempotence check (`--check` mode)

`generate-theme-registry.mjs` supports a `--check` flag that regenerates the
registry **in memory** and exits non-zero if it differs from the committed
`registry.generated.ts`, without writing anything:

```sh
cd app
node scripts/generate-theme-registry.mjs --check
```

This is the CI-safe way to confirm the committed registry file is still fresh
relative to the theme folders on disk (e.g. after you've added a theme folder and
want to check whether you forgot to regenerate and commit the registry).

## 10. A fully worked sample theme

The manifest below is a complete, realistic, **schema-valid** theme that composes
only existing treatments. It was verified against the real validation gate (§9)
before being written into this guide — every contrast pair passes the AA 4.5:1
threshold, `id` matches the `^[a-z][a-z0-9-]*$` regex, and `order` is a unique
positive integer relative to the five shipped themes (`calm`=1, `playful`=2,
`lego`=3, `minecraft`=4, `flower`=5; this sample uses 6).

```ts
// app/src/themes/sunrise/manifest.ts
import type { ThemeManifest } from '../schema';

export const manifest: ThemeManifest = {
  id: 'sunrise',
  order: 6,
  label: { en: 'Sunrise', de: 'Sonnenaufgang' },
  description: {
    en: 'Warm sunrise gradient with soft-drop cards and a petal surface pattern.',
    de: 'Warmer Sonnenaufgang-Verlauf mit weichen Karten und einem Blütenmuster.',
  },
  previewColorScheme: 'brand',
  colorScheme: 'light',
  colors: {
    brand: [
      '#fff3e0', '#ffe0b2', '#ffcc80', '#ffb74d', '#ffa726',
      '#fb8c00', '#f57c00', '#ef6c00', '#e65100', '#bf360c',
    ],
    success: [
      '#e9f7ee', '#c8ecd6', '#a4dfbc', '#7dd2a1', '#5cc78b',
      '#3fba76', '#329f63', '#268551', '#1a6a3f', '#0d472a',
    ],
    warning: [
      '#fdf0d8', '#fadfab', '#f6cd7c', '#f2ba4c', '#efa927',
      '#e39400', '#c68000', '#a86b00', '#8a5600', '#5f3a00',
    ],
    danger: [
      '#fbe4e2', '#f4bfba', '#ec9890', '#e37065', '#dc4f42',
      '#d43021', '#b7291d', '#992218', '#7a1f1f', '#4d0f0c',
    ],
    neutral: [
      '#faf7f3', '#f0ebe3', '#e0d6c9', '#cdbfab', '#b6a48c',
      '#9c8971', '#7e6d59', '#635444', '#463b30', '#2a2119',
    ],
    appBg: '#fdf3e4',
    // Decorative, low-opacity only — appBg (#fdf3e4) remains the effective
    // text background per the §4/§11 contrast limitation.
    backgroundImage:
      'radial-gradient(circle at 15% 10%, rgba(255,183,77,0.12) 0 40%, transparent 41%), ' +
      'radial-gradient(circle at 85% 90%, rgba(255,138,101,0.10) 0 45%, transparent 46%)',
    surfaceBg: '#ffffff',
    surfaceMutedBg: '#fbe8d3',
    surfaceRaisedBg: '#ffffff',
    borderSubtle: '#f0d9b8',
    borderStrong: '#e0a95f',
    textMuted: '#5c4630',   // textMuted vs surfaceBg: 8.85:1, vs appBg: 8.05:1
    textStrong: '#241708',  // textStrong vs surfaceBg: 17.48:1, vs appBg: 15.92:1
    successBg: '#e4f5e9',
    successBorder: '#a4dfbc',
    successText: '#1d5c33', // successText vs successBg: 7.05:1
    warningBg: '#fdf0d8',
    warningBorder: '#f6cd7c',
    warningText: '#7a4c00', // warningText vs warningBg: 6.51:1
    dangerBg: '#fbe4e2',
    dangerBorder: '#ec9890',
    dangerText: '#7a1f1f',  // dangerText vs dangerBg: 8.47:1
    buttonColorScheme: 'brand',
  },
  typography: {
    fonts: { heading: '"Fredoka", system-ui, sans-serif', body: 'system-ui, sans-serif' },
    fontLoad: [{ family: 'Fredoka', weights: [500, 700] }],
  },
  treatments: {
    card: 'softDrop',
    button: 'softDrop',
    nav: 'flat',
    surface: 'petals',
    iconSet: 'filled',
    banner: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 128">
      <defs>
        <linearGradient id="fade" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#fff3e0" stop-opacity="1"/>
          <stop offset="0.72" stop-color="#fff3e0" stop-opacity="0.9"/>
          <stop offset="1" stop-color="#fff3e0" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <rect width="480" height="128" fill="url(#fade)"/>
      <circle cx="120" cy="64" r="40" fill="#ffa726" fill-opacity=".35"/>
    </svg>
  `,
  },
};

export default manifest;
```

*(This exact manifest was dropped into a temporary `app/src/themes/sunrise/`
folder — its name matching the manifest's own `id: 'sunrise'`, as §1 requires —
run through `npm run prebuild`, and confirmed to pass all 63 validation
assertions — including every required contrast pair — before being written here.
The temporary folder was removed afterward and the registry regenerated back to
the five shipped themes; the sample is not part of the shipped theme set.)*

## 11. Gotchas

- **Static export, no runtime filesystem reads.** The app builds with Next's
  `output: 'export'`. Theme detection happens entirely at **build time** via the
  codegen script (§9) — there is no way to read theme folders at runtime, and no
  way to add a theme without a rebuild.
- **Dark (or otherwise low-contrast-`appBg`) themes must pass the real contrast
  gate on `appBg`, or set `contentSurface: true`.** There is no way around this:
  either your `textStrong`/`textMuted` tokens genuinely pass 4.5:1 against your
  `appBg`, or you tell the build that page content floats on a `surfaceBg` panel
  instead (§4). There is no silent third option — an `appBg` that would produce
  illegible text (the historical Minecraft bug this whole gate exists to prevent)
  fails the build.
- **`backgroundImage` must stay decorative and low-opacity.** The contrast gate
  cannot see it — it only measures semantic color tokens. If your background image
  becomes visually opaque enough to compete with text legibility, you have
  reintroduced the exact bug class this system was built to catch, and the build
  will not catch it for you. Keep `appBg` itself as the real, contrast-checked text
  background.
