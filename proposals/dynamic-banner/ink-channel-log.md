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
| Q1 | Publish as a **subpackage** of the existing repo, or a **new private repo**? | `05` §7.1 | OPEN |
| Q2 | Adopt the generic `render(req)` wrapper, or expose `renderSVG` + `randomizeParams` directly with a documented `StyleToken` type? | `05` §7.2 | OPEN |
| Q3 | Can `FORMATS` become **arbitrary width/height**, or would you expose a small set of aspect presets? | `05` §7.3 | OPEN |
| Q4 | Who writes the **types + build config**, and by when? | `05` §7.4 | OPEN |
| Q5 | Expose the hardcoded `#f4efe6` base as a generic **`baseColor`**? | `05` §5.4 | OPEN |
| Q6 | Is the colour-identity approach — pin `anchorHue`/`scheme`/`saturation`/`lightness`, randomize the rest — the one you'd recommend? | `03` §4 | OPEN |
| Q7 | OK with the 3:1 `banner` preset stretched into a wide-short slot, or would you expose a wider (~4:1) letterbox? | `03` §5 | OPEN |

## Messages (newest first)

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
