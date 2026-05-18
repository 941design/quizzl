# BACKLOG migration report

Generated 2026-05-18 by `plugins/base/skills/backlog/scripts/migrate-v3.sh`.

The v2 `BACKLOG.md` contained rows under `## Epics` that did not fit v3's
`specs/epic-<slug>/` shape. Best-effort interpretation made the calls below.
Edit `BACKLOG.json` directly (via `scripts/*.sh`) to override; this report is
informational and is not consulted by any /base: surface.

## Demoted to findings (3)

These rows pointed at a path that was not a v3-shape epic dir but were
interpretable as work-we-know-about. They have been demoted into
`findings[]` and can be promoted via `/base:feature backlog:<slug>` or
closed via `/base:backlog resolve <slug>`.

- BACKLOG.md:17 — `specs/out-of-band-leave.md` → finding `specs-out-band-leave-md-documented` (v2 status: `PROPOSED`)
- BACKLOG.md:18 — `docs/event-sourced-receive-engine-spec.md` → finding `docs-event-sourced-receive-engine-spec` (v2 status: `PROPOSED`)
- BACKLOG.md:19 — `e2e infrastructure / Playwright browser cache normalization` → finding `e2e-infrastructure-playwright-browser-cache` (v2 status: `TODO`)
