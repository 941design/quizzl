# few.chat Domain Rebrand & Migration

**Status:** Proposed
**Author:** domain-move execution (2026-07-01)
**Related:** `specs/domain-migration.md` (different problem — end-user data
export/import, unscheduled), `specs/storage-namespace-rebrand-migration.md`
(superseded by this epic's storage-namespace work, see Design Decisions)

## Problem

The application is still branded "Nostling" (package name, UI text, docs,
Makefile) and, underneath that, still carries "Quizzl" in its storage
namespaces and a handful of identifiers from an earlier rebrand that
deliberately stopped short of touching storage internals. Meanwhile the
product is moving to a new domain, `few.chat`, replacing the previous
941design-hosted deployment at `nostling.941design.de`. Continuing to
develop against two stale brand names, and continuing to default the
deployment tooling at the old FTP/HostEurope target with its manually
renewed Let's Encrypt certificate, creates confusion for anyone reading the
code, the docs, or operating the deployment — and leaves obsolete tooling
in the Makefile that no longer has anywhere to point.

## Solution

Rename the live application surface — source code, tests, UI copy, package
identity, storage namespaces, Makefile, and top-level project docs — from
Quizzl/Nostling to "Few" / `few.chat`. Make the Cloudflare Pages deployment
to `few.chat` the sole, default deployment path; remove the old
FTP/HostEurope deployment machinery and its TLS certificate targets
entirely, since the old site stays online exactly as already deployed and
this repository no longer needs the ability to redeploy to it. Historical
specs, ADRs, and bug reports keep their original branding as an accurate
record of past decisions — this is a rename of the living application, not
a rewrite of history.

## Scope

### In Scope

- Rename brand strings ("Nostling"/"Quizzl") to "Few" across: `app/src`,
  `app/tests` (unit + e2e), `app/pages`, `app/public`, `app/package.json`,
  root `Makefile`, root `CLAUDE.md`, and living docs under `docs/` (not
  `docs/adr/`).
- Correct domain-shaped literals to `few.chat` (not a naive token swap):
  the invite-link `FALLBACK_ORIGIN` (`inviteLinkGeneration.ts:15`) and the
  NIP-46 nostrconnect app-metadata `url` (`NostrIdentityContext.tsx:434`).
- Repoint the avatar asset references off `assets.941design.de` to a
  `few.chat/assets` path: the 649 URLs in `avatarManifest.json` and the
  `endpointBaseUrl` in `config/profile.ts` (see Design Decision 6).
- Rename the relay-backup discovery d-tag `BACKUP_D_TAG` (`relayBackup.ts`)
  from `'nostling'` to `'few'` — hard cutover, no fallback (Design
  Decision 7).
- Rename storage namespaces: IndexedDB named stores and colon-key prefixes
  currently `quizzl-*` / `quizzl:*` / `quizzl_*` → `few-*` / `few:*` /
  `few_*`. Hard cutover (no dual-read/migration shim) — see Design
  Decision 1.
- Promote `deploy-few` (Cloudflare Pages → `few.chat`) to the primary
  `make deploy` target; drop the "placeholder" framing in comments.
- Remove the FTP/HostEurope deployment targets (`deploy`, `deploy-check`,
  `deploy-dryrun`, `maintenance`, `maintenance-check`) and their config
  variables from the Makefile.
- Remove the `ssl-cert` / `ssl-cert-assets` Let's Encrypt targets —
  obsolete once the FTP deploy path is gone (Cloudflare Pages manages TLS
  for `few.chat` automatically).
- Update the Makefile `.PHONY` list and `help` text to match.

### Out of Scope

- `specs/epic-*/` directories and all per-story artifacts (`spec.md`,
  `stories.json`, `verification.json`, `result.json`, etc.) — historical
  record, untouched.
- `specs/*.md` top-level proposal specs (e.g. `domain-migration.md`) and
  `docs/adr/*.md` — untouched, except a single status-line edit on
  `storage-namespace-rebrand-migration.md` (see Design Decision 1).
- `bug-reports/`, `.serena/memories/`, `BACKLOG.json` — historical/meta
  project state, untouched.
- The end-user data export/import migration feature described in
  `specs/domain-migration.md` — separate, unscheduled epic; not
  implemented here.
- Any change to the already-deployed `nostling.941design.de` site itself —
  it stays online, unmodified, and un-redeployable from this repo going
  forward.

## Design Decisions

1. **Storage namespace hard cutover, not dual-read.** The deferred
   `storage-namespace-rebrand-migration.md` spec chose a dual-read/
   write-through strategy specifically to protect existing users' data on
   the *currently deployed* origin (`nostling.941design.de`). `few.chat` is
   a brand-new origin with zero existing users — browser storage is
   origin-scoped, so no data can be orphaned by a hard rename there. This
   decision supersedes that spec; its `Status:` line is updated to
   `Superseded by specs/epic-few-chat-rebrand/` (a single edit, not a
   rename sweep of its body).
2. **`lp_*` localStorage keys are untouched.** They never contained
   "quizzl" or "nostling" (identity, settings, contacts all live there) and
   are outside the instruction's scope; no rename needed, no risk
   introduced.
3. **Old FTP deployment path is deleted, not deprecated-in-place.** Per
   explicit product decision, the old site stays online exactly as already
   deployed (out of this repo's control from here on), but this repository
   no longer carries the ability to redeploy to it. No backward
   compatibility is required.
4. **Historical specs are not rewritten.** Rewriting `specs/epic-*/` and
   `docs/adr/` would erase the factual record of what the app was called
   when those decisions were made, for zero product benefit.
5. **Brand string: "Few" (display), `few-chat` (package/slug name).**
   Matches the existing Makefile convention (`FEW_PROJECT := few-chat`,
   `FEW_DIST := few.chat`).
6. **Avatar assets repoint to a `few.chat/assets` path, not
   `assets.few.chat`.** The 649 avatar image URLs currently point at the
   `assets.941design.de` CDN. Product decision: serve them from a path on
   the primary `few.chat` Cloudflare Pages deployment instead of a
   subdomain. **Known caveat (surface to product owner):** these images
   physically live on the 941design asset server; this code change only
   rewrites the URLs — it does NOT move the files. Avatars will 404 until
   the asset files are placed under `few.chat/assets/` out-of-band. The
   protocol-relative form is preserved (`//few.chat/assets/…`). The manifest
   generator `app/scripts/generate-avatar-manifest.mjs` is repointed to the
   same `few.chat/assets` base for both its fetch source and stored URLs, so
   the codebase carries no old-domain reference; the same out-of-band step
   that hosts the images at `few.chat/assets` (including its search
   endpoint) is what re-enables the generator.
7. **Relay-backup d-tag is a pure hard cutover — accepted data loss.**
   `BACKUP_D_TAG` addresses a kind-30078 backup event on Nostr relays by
   the user's *key*, not by origin, so unlike browser storage it is NOT
   protected by the fresh-origin argument. Renaming `'nostling'` → `'few'`
   with no fallback read means a user who published a backup from the old
   site cannot recover it on `few.chat`. Product decision: accept this
   loss (consistent with "no backwards compatibility"); do NOT add a
   fallback query. Recorded explicitly in `## Non-Goals`.

## Technical Approach

### `app/package.json`

`"name": "nostling"` → `"name": "few-chat"`; any other Nostling-referencing
field (description, etc.) updated to match.

### `app/src/**`

Sweep for `quizzl`/`nostling` (case-insensitive) across identifiers,
comments, and UI copy strings, including the storage constant modules
(`chatPersistence.ts`, `reactions/api.ts`, `pollPersistence.ts`,
`groupStorage.ts`, `inviteLinkStorage.ts`, `joinRequestStorage.ts`,
`profileRequestStorage.ts`, `mediaPersistence.ts`, `relayBackup.ts`,
`media/imageMessage.ts` — the last owns `DIRECT_MEDIA_VERSION =
'quizzl-dm-media-v1'`) and known cross-cutting identifiers such as the
`__nostlingPublishDm` test bridge in `unreadStore.ts`. Storage identifiers
`quizzl-*`/`quizzl:*`/`quizzl_*` become `few-*`/`few:*`/`few_*`.

**Domain-shaped literals (not a token swap):** a blind `nostling`→`few`
substitution would corrupt URLs. Handle these explicitly:
- `inviteLinkGeneration.ts:15` `FALLBACK_ORIGIN =
  'https://nostling.941design.de'` → `'https://few.chat'`.
- `NostrIdentityContext.tsx:434` nostrconnect `url: 'https://nostling.app'`
  → `'https://few.chat'` (and the sibling `name: 'Nostling'` → `'Few'`).

**Relay-backup d-tag:** `relayBackup.ts` `BACKUP_D_TAG = 'nostling'` →
`'few'`, no fallback (Design Decision 7).

### `app/src/data/avatarManifest.json` and `app/src/config/profile.ts`

Repoint avatar assets off the 941design CDN:
- `avatarManifest.json` — all 649 `imageUrl` values
  `//assets.941design.de/<uuid>.png` → `//few.chat/assets/<uuid>.png`.
- `profile.ts` — `endpointBaseUrl: '//assets.941design.de'` →
  `'//few.chat/assets'`.

See Design Decision 6 for the physical-hosting caveat.

### `app/tests/**`

Same sweep across unit and e2e tests/fixtures — assertions and fixture
data referencing old storage names or brand strings are updated to match
the renamed source.

### `Makefile`

- `help` banner `"Nostling"` → `"Few"`.
- `PLAYWRIGHT_BROWSERS_PATH` cache dir suffix `-nostling` → `-few`.
- Remove: `deploy`, `deploy-check`, `deploy-dryrun`, `maintenance`,
  `maintenance-check`, `ssl-cert`, `ssl-cert-assets` targets and their
  config (`FTP_HOST`, `FTP_PATH`, `SSL_DOMAIN`, `SSL_ASSETS_DOMAIN`, etc.).
- Rename `deploy-few` → `deploy`, `deploy-few-check` → `deploy-check`;
  drop the "placeholder"/"separate from the FTP site" comments.
- Update the `.PHONY` list to match the new target set.

### `CLAUDE.md`

Top heading `# nostling` → `# few-chat` (or equivalent); any other
Nostling-only prose in the project-instructions body updated.

### `docs/` (living docs only)

Sweep `docs/quiz-business-logic.md` and any other non-ADR, non-archival
doc for brand references.

### `specs/storage-namespace-rebrand-migration.md`

Single-line status edit: `Status:` → `Superseded by
specs/epic-few-chat-rebrand/`.

## Stories

- **S1 — Storage namespace rename** — Rename all `quizzl-*`/`quizzl:*`/
  `quizzl_*` IndexedDB/localStorage identifiers to `few-*`/`few:*`/`few_*`
  across all storage modules; update unit tests exercising those names.
  Covers AC-STORE-*.
- **S2 — App source, UI & domain-literal sweep** — Rename remaining
  Quizzl/Nostling identifiers, comments, and UI copy across `app/src`
  (excluding storage namespaces, covered by S1) and `app/package.json`;
  correct the domain-shaped literals (`FALLBACK_ORIGIN`, nostrconnect
  `url`/`name`) to `few.chat`/`Few`; repoint avatar asset URLs
  (`avatarManifest.json`, `profile.ts`) off `assets.941design.de` to
  `//few.chat/assets`. Covers AC-BRAND-*, AC-ASSET-*.
- **S3 — Test suite brand sweep** — Update `app/tests/unit` and
  `app/tests/e2e` fixtures/assertions referencing old brand or storage
  names so the suite passes against the renamed source. Covers AC-TEST-*.
- **S4 — Makefile & deploy target migration** — Remove FTP/HostEurope and
  SSL-cert targets, promote `deploy-few`→`deploy`, update `.PHONY`/help
  text/cache paths. Covers AC-MAKE-*.
- **S5 — Top-level docs sweep** — Update `CLAUDE.md`,
  `docs/quiz-business-logic.md`, and mark
  `storage-namespace-rebrand-migration.md` as superseded. Covers
  AC-DOCS-*.

## Acceptance Criteria

See [`acceptance-criteria.md`](./acceptance-criteria.md).

## Relationship to Other Epics

- **`specs/domain-migration.md`** (not yet an epic) — orthogonal,
  unscheduled: covers *end-user* data export/import between origins. This
  epic covers the *codebase/deployment* rename only; it does not implement
  user-facing migration tooling.
- **`specs/storage-namespace-rebrand-migration.md`** (not yet an epic) —
  superseded by this epic's S1 (storage namespace rename now targets
  `few-*` directly instead of the previously-proposed `quizzl→nostling`
  dual-read migration).

## Non-Goals

- Building the user-facing export/import data-migration feature
  (`specs/domain-migration.md`) is not this epic's goal.
- Preserving backward compatibility for users of the old
  `nostling.941design.de` origin is explicitly not a goal — the old site
  is frozen as-is and unreachable from this repo's deploy tooling going
  forward.
- Rewriting historical specs, ADRs, or bug reports to retroactively rename
  past decisions is not a goal.
- Preserving relay-published backup continuity across the rename is
  explicitly **not** a goal: `BACKUP_D_TAG` moves from `'nostling'` to
  `'few'` with no fallback query, so backups published from the old site
  are not recoverable on `few.chat`. Accepted data loss (Design Decision 7).
- **Physically migrating avatar image files** from `assets.941design.de`
  to `few.chat/assets` is not this epic's goal — this epic only rewrites
  the URLs. The files must be placed at the new location by a separate
  infra step or avatars will 404 (Design Decision 6).
