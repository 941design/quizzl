# UI documentation gallery (`make screenshots`)

Turns the running app into a **browsable, self-contained HTML gallery** — one
screenshot per screen at four viewport sizes, each annotated with a plain-language
description and the product **invariants** it is evidence for, grouped by user flow.
Use it for visual inspection and as living UI documentation.

## Run it

```bash
make screenshots
```

This brings up the strfry relay + blossom mock (populated group/DM/contact states
are driven through the app's real publish paths, never hand-signed events), boots
`next dev` on a random port, runs the Playwright capture, tears everything down, and
writes:

```
app/screenshots-out/index.html   ← open this in a browser (works off disk, file://)
app/screenshots-out/shots/*.png
app/screenshots-out/manifest.json
```

The output is gitignored and regenerated on each run. It is **not** part of the e2e
gate (`make test`) — separate Playwright config, separate target.

## How it's put together

| File | Role |
|------|------|
| `screens.config.ts` | The manifest: flows → screens, each with title, description, invariants, and either a `route` (simple) or a `builder` key (populated). **Edit this to add/adjust screens.** |
| `capture.ts` | Playwright driver. Seeds a deterministic identity/nickname/theme/language, walks the manifest, drives populated scenarios (reusing the e2e helpers), photographs each screen at every viewport, writes `manifest.json`. |
| `../../playwright.screenshots.config.ts` | Isolated config (own testDir/testMatch) so capture never joins the e2e run. |
| `../../scripts/run-screenshots.mjs` | Boots the relay-wired dev server, runs the capture, then the gallery build. |
| `../../scripts/build-gallery.mjs` | Renders `manifest.json` → `index.html` (flow sidebar + viewport toggle). |

## Adding a screen

- **Simple screen** (renders from a seeded single user): add an entry with a `route`
  and a `waitFor` testid. No code change needed.
- **Populated screen** (needs a second user / relay state): add an entry with a
  `builder` key, then drive it inside the matching scenario `test()` in `capture.ts`
  and call `captureScreen(page, screen)` once the state is on screen.

Capture is **best-effort per screen**: a screen (or an entire populated scenario)
that fails is recorded with `status: "failed"` and the run continues, so one flaky
relay state never blanks the gallery. Failures show as a red placeholder card.

## Viewports

Defined in `screens.config.ts` (`VIEWPORTS`): Mobile 375, Tablet 768, Laptop 1280,
Desktop 1440. The gallery's top-bar toggle swaps every screenshot at once.
