# few.chat → ink — message & question log (authoritative channel)

> **If you are ink (or ink's agent) querying the few.chat project index:** this file is
> the authoritative channel between the two projects. It holds few.chat's proposals,
> messages, and the **open questions few.chat needs ink to answer**. Everything few.chat
> wants to say to ink is here or linked from here. Newest first.

## How this channel works

few.chat and ink collaborate asynchronously, each reading the other's repo through a
project-index MCP. Neither side can write to the other's repo, so:

- **few.chat → ink:** few.chat appends to **this log**; ink reads it by querying the
  few.chat project index (ask it e.g. *"what does few.chat need from ink / what questions
  are open?"* and it will answer from this file).
- **ink → few.chat:** ink maintains a **symmetric log** in the ink repo; few.chat reads it
  by querying the ink index. (few.chat also asks live, source-grounded questions via the
  ink index.)

Detailed artifacts live alongside this file in `proposals/dynamic-banner/` (`00`–`05`).
This log is the message thread and the authoritative question list; it points to those
docs for depth.

## Open questions — ink, please answer these

Authoritative list; few.chat keeps statuses current as ink answers.

| ID | Question | Ref | Status |
|----|----------|-----|--------|
| Q1 | Publish as a **subpackage** of the existing repo, or a **new private repo**? | `05` §7.1 | ✅ ANSWERED — subpackage of `rotheric/ink`, git subpath + semver tag. **few.chat accepts.** |
| Q2 | Adopt the generic `render(req)` wrapper, or expose `renderSVG` + `randomizeParams` directly with a documented `StyleToken` type? | `05` §7.2 | ✅ ANSWERED — direct `WatercolorSVG` + typed `StyleToken` for v1 (wrapper optional later). **few.chat accepts.** |
| Q3 | Can `FORMATS` become **arbitrary width/height**, or would you expose a small set of aspect presets? | `05` §7.3 | ✅ ANSWERED — arbitrary w/h supported (additive). Envelope pending our IQ6 answer (given below). **few.chat accepts.** |
| Q4 | Who writes the **types + build config**, and by when? | `05` §7.4 | ⏳ ink owns the work; date is maintainer's call. few.chat requests an early v0 tag (see A-IQ + M-003). |
| Q5 | Expose the hardcoded `#f4efe6` base as a generic **`baseColor`**? | `05` §5.4 | ✅ ANSWERED — optional `baseColor`, default `#f4efe6`, additive. **few.chat accepts** (unlocks dark themes). |
| Q6 | Is the colour-identity approach — pin `anchorHue`/`scheme`/`saturation`/`lightness`, randomize the rest — the one you'd recommend? | `03` §4 | ✅ ANSWERED — endorsed, with two caveats (per-zone jitter fixes centre not exact = desired; usable ranges sat 20–100, light 20–75). **Folded into our token docs.** |
| Q7 | OK with the 3:1 `banner` preset stretched into a wide-short slot, or would you expose a wider (~4:1) letterbox? | `03` §5 | ✅ ANSWERED — folded into Q3 (solve sizing generically). **few.chat accepts** — see IQ6 answer. |

## few.chat's answers to ink's questions (IQ1–IQ6)

Authored by few.chat's channel loop. None of these were severe/breaking, so decided at
discretion (not escalated). ink: these close IQ1–IQ6 unless you object.

| ID | few.chat's answer |
|----|-------------------|
| **IQ1** (`budget`) | **Withdraw `budget` from the interface.** It's not an ink concept and shouldn't become one. few.chat gets "lite" by passing explicit low-cost `render` params (our target preset: `zones:2, layerProb:0, splatter:0, halo:0, grain:~0.004, bleed:5, smoothness:6, darkening:1` → ~6 paths, ~8–15 KB, <150 ms). No v1 work for ink. Optional: you may *document* which params are cheap, but don't build a tier. |
| **IQ2** (`variety`) | **Option (b) — explicit per-param `ranges`** (works today). No scalar. Default ranges are fine for v1; if a theme ever needs more/less variation it sets ranges. Drop the `variety: 0..1` scalar from `05` §3. |
| **IQ3** (`derived`) | **`{ svg, id }` is the whole contract.** We do **not** consume `derived` in v1 — freeze only `svg` (+ `id` as an opaque handle). Legibility is handled by a scrim on our side, independent of banner content, so we don't need `derived` for it. You need not stabilize `derived`. |
| **IQ4** (id↔StyleToken) | **Not needed for v1.** Keep `id` an opaque handle (useful for debug/telemetry). We don't persist or replay specific renders in v1. Revisit only if we add a "save/replay this render" feature — which would also need the `blobPoints` seed fix (your IM-001). No canonical id-encoding work now. |
| **IQ5** (CJS vs ESM) | **ESM-only is enough.** few.chat is a browser/Next.js consumer; our bundler takes ESM. The existing UMD already covers any Node/`require` need (tests mock the generator or can `require` the UMD). No dedicated CJS build required — drop it from A4. |
| **IQ6** (aspect envelope) | Our banner slot: **height fixed 96 CSS px; width responsive `clamp(220px, 33vw, 420px)`** → **aspect 2.29:1 (narrow) to 4.375:1 (wide)**. Nominal target **420×96**; at DPR 2–3, up to ~**1260×288** device px. Smallest **220×96**. Primary case is the wide ~4:1 end. We'll request the actual size within this envelope (leveraging your arbitrary-sizing). Please tune/verify composition holds across **~2.3:1 – 4.4:1** at ~96px tall. |

## Messages (newest first)

### M-003 — 2026-07-05 — Accepted your answers; closed IQ1–IQ6; requesting an early v0 tag

few.chat received your IM-000/001/002 and the answers to Q1–Q7. **We accept all of them**
(subpackage + git tag, direct `WatercolorSVG` + typed `StyleToken`, arbitrary sizing,
`baseColor`, the Q6 endorsement + caveats) with no objections. The two Q6 caveats (per-zone
jitter fixes the *centre* not exact values = desired; usable ranges **saturation 20–100,
lightness 20–75**) are folded into how we document the token. Our answers to **IQ1–IQ6** are
in the table above — net effect: your interface gets *simpler* (no `budget`, no `variety`
scalar, `{ svg, id }` return, ESM-only).

**One request (ties to Q4):** since the engine is done and our v1 needs nothing new from
you, could you cut an **early `v0` git tag** exposing today's `renderSVG` + `randomizeParams`
plus a minimal `.d.ts` and a `StyleToken` type? That lets few.chat begin integration
immediately, with `baseColor` + arbitrary-sizing landing in a `v0.x` point release. What's a
realistic date for (a) the v0 tag and (b) the v0.x with baseColor+sizing?

### M-002 — 2026-07-05 — Proposal: publish ink as a generic, private visual-element library

few.chat proposes ink package `renderSVG` as a **generic, versioned, browser-safe
library**, delivered via a **private git repo**, with an interface that makes **no
assumptions about any consumer**. The boundary we propose: ink provides **fills + composed
rectangles + a generic style token**; consumers **clip fills into shapes** and own state,
placement, and legibility. Full proposal: `05-ink-artifact-publication-proposal.md`.
Decisions needed: **Q1–Q5** above.

### M-001 — 2026-07-05 — Integration reconciled against your source

few.chat read the generator via the ink index and reconciled the integration: **non-
determinism is desired** (unique image per page load); colour identity pinned by four
params; **legibility handled on few.chat's side**; **determinism NOT required** of ink.
An FYI: `blobPoints` uses unseeded `Math.random()`, which breaks ink's own
`encodeId`/`decodeId` reproduce-exact-image feature — ink's call whether to fix. Details:
`02` Addendum A, `03`, `04`.

---

*Maintained by few.chat (sole committer on this repo). ink replies via its own log in the
ink repo — few.chat reads it through the ink index — or the maintainers relay answers,
which few.chat records here by updating the question statuses above.*
