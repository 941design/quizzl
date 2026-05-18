# Learning Groups via Nostr + MLS — Legacy Epic

Status: Implemented

This epic predates the `specs/epic-<slug>/spec.md` convention. It shipped as a
single feature batch in commit `dd837c3` (`feat(groups): add learning groups
via Nostr + MLS with 12-word seed backup`) and is preserved here as a record
of the seven stories that landed.

Story specs and per-story artifacts (`baseline.json`, `result.json`,
`verification.json`) live under `01-nostr-identity/` through
`07-offline-resilience-polish/`. The canonical story manifest is
`stories.json`.

## Stories shipped

| ID | Name | Title |
|----|------|-------|
| 01 | nostr-identity              | Tier 1 Auto-Identity + KeyPackage Publication |
| 02 | marmot-adapter              | marmot-ts adapter + group creation primitives |
| 03 | groups-ui                   | Groups list / detail / member-list UI |
| 04 | invite-and-join             | Welcome flow + KeyPackage discovery |
| 05 | score-sync                  | Score broadcast + leaderboard projection |
| 06 | seed-phrase-backup          | 12-word seed export + restore |
| 07 | offline-resilience-polish   | Send-queue, retry, mobile resilience |

## Why this file exists

The `base:next-epic` and `/base:orient` evidence-based classifier reads
`spec.md` as a primary signal for epic status. Without this stub the dir
classified as `UNKNOWN` even though `epic-state.json` and every story's
`result.json` report `done`. This file resolves that drift without
inventing post-hoc design fiction — see `stories.json` for the story-level
acceptance criteria as they were actually authored.

Subsequent work in this area lives under its own epic dirs:

- `specs/epic-cancel-pending-invitations/`
- `specs/epic-dm-message-recovery/`
- `specs/epic-emoji-feature/`
- `specs/epic-group-invite-links/`
- `specs/epic-group-polls/`
- `specs/epic-image-sharing/`
- `specs/epic-member-profile-discovery-and-relay-on-behalf/`
- `specs/epic-mls-fork-resolution/`
- `specs/epic-relay-backup/`
- `specs/epic-feature-spec-unified-mls-application-rumor-dispatch/`
