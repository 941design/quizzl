# Architecture — Few Chat Domain Rebrand

## Paradigm

This is a **rename/repoint epic**, not a feature build. No new modules,
seams, or abstractions are introduced. The work is a bounded set of
in-place string/identifier edits across an already-established modular
Next.js/TypeScript codebase plus the root Makefile. The architectural
constraint is **surgical scope**: touch only the live application surface,
provably leave historical/archival surfaces byte-identical.

## Change surface (grounded inventory)

Full inventory taken via `git grep -il -E "quizzl|nostling"` over `app/`,
`Makefile`, `CLAUDE.md`, `docs/` (2026-07-01):

### Storage identifiers (S1) — `app/src`
Named IDB stores + colon prefixes + localStorage key:
`quizzl-dm-media-v1`, `quizzl-groups-meta`, `quizzl-groups-state`,
`quizzl-invite-links`, `quizzl-join-requests`, `quizzl-keypackages`,
`quizzl-media-blobs`, `quizzl-media-meta`, `quizzl-member-profiles`,
`quizzl-profile-request-memos`, `quizzl:messages:`, `quizzl:messages:dm:`,
`quizzl:poll-votes:`, `quizzl:polls:`, `quizzl:reactions:dm:`,
`quizzl:reactions:group:`, `quizzl_groups_v1`.
Owning modules: `chatPersistence.ts`, `reactions/api.ts`,
`pollPersistence.ts`, `groupStorage.ts`, `inviteLinkStorage.ts`,
`joinRequestStorage.ts`, `profileRequestStorage.ts`, `mediaPersistence.ts`,
`media/imageMessage.ts`, `keyPackages.ts`, `storage.ts` (comment),
`reactions/types.ts`. Colon keys are built via template literals whose
literal prefix contains `quizzl` — so a literal-prefix rename is safe and
complete (the dynamic suffix carries no brand token).

### Brand strings + domain literals (S2) — `app/src`
- UI copy: `i18n.ts` (14 `Nostling` occurrences, en + de), `maintainer.ts`
  (`MAINTAINER_DISPLAY_NAME = 'Nostling Team'`), `blossomClient.ts`
  (`'nostling image upload'`).
- Identifiers: `unreadStore.ts` `__nostlingPublishDm` bridge + callers.
- Domain literals (value-correctness, not token swap):
  `inviteLinkGeneration.ts` `FALLBACK_ORIGIN` → `https://few.chat`;
  `NostrIdentityContext.tsx` nostrconnect `name`/`url` → `Few`/`https://few.chat`.
- Relay d-tag: `relayBackup.ts` `BACKUP_D_TAG` → `few` (hard cutover).
- Package: `app/package.json` `name` → `few-chat`.

### Avatar assets (S2, AC-ASSET) — `app/src`
`avatarManifest.json` (649 `//assets.941design.de/` URLs) and
`config/profile.ts` (`endpointBaseUrl`) → `//few.chat/assets`.

### Tests (S3) — `app/tests`
~30 unit + e2e files reference old storage names / brand strings in
fixtures and assertions (`chatPersistence-property.test.ts`,
`reactions/api.test.ts`, e2e helpers `clear-state.ts`,
`rumor-counter.ts`, etc.). These must track the renamed source or the
suite breaks.

### Makefile (S4)
Remove FTP/HostEurope targets (`deploy`, `deploy-check`, `deploy-dryrun`,
`maintenance`, `maintenance-check`) + config (`FTP_*`), SSL targets
(`ssl-cert`, `ssl-cert-assets`) + config (`SSL_*`). Rename
`deploy-few`→`deploy`, `deploy-few-check`→`deploy-check`. Fix `.PHONY`,
`help` banner (`Nostling`→`Few`), `PLAYWRIGHT_BROWSERS_PATH` suffix.

### Docs (S5)
`CLAUDE.md` (`# nostling` heading + the "non-Nostling client" prose in the
E2E section), `docs/quiz-business-logic.md` (3 `Nostling` refs). Plus a
one-line `Status:` edit on `specs/storage-namespace-rebrand-migration.md`.

## Boundary rules (hard constraints)

1. **Never edit** `specs/epic-*/`, `specs/*.md` proposal files (except the
   one `Status:` line on `storage-namespace-rebrand-migration.md`),
   `docs/adr/`, `bug-reports/`, `.serena/`, `BACKLOG.json`. These are the
   historical/archival surface; AC-STRUCT-2 proves them untouched.
2. **Never touch `lp_*` localStorage keys** (AC-STORE-4).
3. **No backward-compat shim** — no dual-read, no fallback alias, no
   redirect for any renamed identifier (AC-STRUCT-3).
4. **Domain literals get correct values**, not token swaps (AC-ASSET-1/2).

## Verification strategy

Every AC is checkable without a running browser:
- Structural: `git grep` for absence of old tokens (scoped) + presence of
  correct new values.
- Behavioral: `make test-unit` (the full unit suite) must pass green
  against renamed source+tests (AC-TEST-3); a Makefile dry parse for
  AC-MAKE-6.
- The e2e suite exercises the renamed storage end-to-end (gate).

## Implementation posture

Lead-driven direct edits (lighter path): the change surface is fully
enumerated and every AC is grep/test-verifiable, so per-story architect
spawns add no design value. Automated sed for the high-volume mechanical
renames (avatar URLs, storage prefixes) with surgical path scoping;
hand-edits for domain literals and the Makefile. Examiner/review gates
still run.
