# few.chat Domain Rebrand & Migration — Acceptance Criteria

## Known TAGs

- **STORE** — storage namespace rename (S1).
- **BRAND** — app source/UI/package brand sweep (S2).
- **ASSET** — avatar asset domain repoint + domain-literal correctness (S2).
- **TEST** — test suite brand sweep (S3).
- **MAKE** — Makefile/deploy target migration (S4).
- **DOCS** — top-level docs sweep (S5).

## Terminology

- **live application surface** — `app/` (all subdirectories), root
  `Makefile`, root `CLAUDE.md`, and living docs directly under `docs/`
  (non-recursive) excluding `docs/adr/`. `docs/research/` is treated as
  archival (out of scope), consistent with `docs/adr/`; it currently
  holds no brand tokens, so the distinction is moot in practice but stated
  for future-proofing.
- **historical/archival surface** — `specs/epic-*/`, top-level `specs/*.md`
  proposal files, `docs/adr/`, `bug-reports/`, `.serena/memories/`,
  `BACKLOG.json`. Excluded from every AC below except AC-DOCS-2, which
  targets exactly one file in this surface by name.
- **old brand tokens** — the case-insensitive strings `quizzl` and
  `nostling` (and their capitalized/title-case forms, e.g. `Quizzl`,
  `Nostling`).

## Storage Namespace Rename (S1)

**AC-STORE-1** — No IndexedDB named-store identifier under `app/src`
contains the substring `quizzl` (case-insensitive). Every store previously
named `quizzl-groups-state`, `quizzl-keypackages`, `quizzl-groups-meta`,
`quizzl-member-profiles`, `quizzl-media-blobs`, `quizzl-media-meta`,
`quizzl-invite-links`, `quizzl-join-requests`, `quizzl-profile-request-memos`
is renamed to its `few-*` equivalent.

**AC-STORE-2** — No idb-keyval default-store colon-key prefix under
`app/src` contains the substring `quizzl`. Every prefix previously
`quizzl:messages:*`, `quizzl:polls:*`, `quizzl:poll-votes:*`,
`quizzl:reactions:group:*`, `quizzl:reactions:dm:*` is renamed to its
`few:*` equivalent.

**AC-STORE-3** — No `localStorage` key under `app/src` matching
`quizzl_*` (e.g. `quizzl_groups_v1`) remains; each is renamed to its
`few_*` equivalent.

**AC-STORE-4** — Every `lp_*`-prefixed localStorage key (identity,
settings, contacts, and related) is byte-identical to its pre-rename name
— MUST NOT be touched by this epic.

**AC-STORE-5** — A fresh boot of the app (empty origin) creates and reads
only `few-*`/`few:*`/`few_*` storage identifiers; no code path reads or
writes a `quizzl-*`/`quizzl:*`/`quizzl_*` identifier.

## App Source & UI Brand Sweep (S2)

**AC-BRAND-1** — `app/package.json` `"name"` field equals `"few-chat"`.

**AC-BRAND-2** — No file under `app/src` (excluding storage identifiers
covered by AC-STORE-1..3) contains an old brand token in an identifier,
comment, or user-visible UI string.

**AC-BRAND-3** — The `__nostlingPublishDm` test bridge (or equivalent
identifier) in `app/src/**/unreadStore.ts` is renamed to a `few`-branded
equivalent, and every caller/reference is updated to the new name.

**AC-BRAND-4** — No file under `app/pages` or `app/public` contains an old
brand token in a URL, title, meta tag, or manifest field.

**AC-BRAND-5** — `relayBackup.ts`'s `BACKUP_D_TAG` constant equals `'few'`
(hard cutover, no fallback query under `'nostling'`).

## Avatar Assets & Domain Literals (S2)

**AC-ASSET-1** — `inviteLinkGeneration.ts`'s `FALLBACK_ORIGIN` equals
exactly `'https://few.chat'` — not `https://few.941design.de` or any
token-swapped variant.

**AC-ASSET-2** — The NIP-46 nostrconnect metadata in
`NostrIdentityContext.tsx` sets `url` to exactly `'https://few.chat'` and
`name` to `'Few'`.

**AC-ASSET-3** — No `imageUrl` in `app/src/data/avatarManifest.json`
contains `assets.941design.de`; every avatar URL matches
`//few.chat/assets/<uuid>.png` (protocol-relative form preserved).

**AC-ASSET-4** — `config/profile.ts`'s `AVATAR_BROWSER_CONFIG.endpointBaseUrl`
equals `'//few.chat/assets'`.

## Test Suite Brand Sweep (S3)

**AC-TEST-1** — No file under `app/tests/unit` contains an old brand
token, whether in an identifier, assertion string, or fixture value.

**AC-TEST-2** — No file under `app/tests/e2e` (including
`app/tests/e2e/helpers`) contains an old brand token, whether in an
identifier, assertion string, or fixture value.

**AC-TEST-3** — The full unit test suite passes against the renamed
source (S1 + S2) with zero failures attributable to a stale brand or
storage-name reference.

## Makefile & Deploy Target Migration (S4)

**AC-MAKE-1** — The root `Makefile` contains no target named `deploy-few`
or `deploy-few-check`; `deploy` and `deploy-check` build and validate the
Cloudflare Pages deployment to `few.chat` (the former `deploy-few`/
`deploy-few-check` bodies, renamed in place).

**AC-MAKE-2** — The root `Makefile` contains no target named
`deploy-dryrun`, `maintenance`, `maintenance-check`, `ssl-cert`, or
`ssl-cert-assets`, and no `FTP_HOST`/`FTP_PATH`/`SSL_DOMAIN`/
`SSL_ASSETS_DOMAIN` (or equivalent FTP/SSL config) variable definitions.

**AC-MAKE-3** — The `.PHONY` declaration in the root `Makefile` lists
exactly the targets that exist in the file after this epic — no stale
entries for removed targets, no missing entries for renamed ones.

**AC-MAKE-4** — `make help` output contains no old brand token; the
banner line reads `Few` (or an equivalent `few`-branded string) in place
of `Nostling`.

**AC-MAKE-5** — The `PLAYWRIGHT_BROWSERS_PATH` value in the root
`Makefile` contains no old brand token.

**AC-MAKE-6** — Running `make deploy-check` (dry, no network credentials
required) does not reference any FTP/HostEurope host, path, or SSL
certificate path.

## Top-Level Docs Sweep (S5)

**AC-DOCS-1** — Root `CLAUDE.md` contains no old brand token.

**AC-DOCS-2** — `specs/storage-namespace-rebrand-migration.md`'s
`Status:` line reads `Superseded by specs/epic-few-chat-rebrand/`; no
other line in that file is modified.

**AC-DOCS-3** — Every file directly under `docs/` (non-recursive into
`docs/adr/`) contains no old brand token.

## Cross-Cutting Invariants

**AC-STRUCT-1** — `git grep -il` for the case-insensitive pattern
`quizzl|nostling` restricted to `app/`, `Makefile`, and `CLAUDE.md`
returns zero matches after this epic completes.

**AC-STRUCT-2** — `git grep -il` for the same pattern restricted to
`specs/epic-*/`, `specs/domain-migration.md`,
`specs/storage-namespace-rebrand-migration.md` (excluding its `Status:`
line), `docs/adr/`, `bug-reports/`, `.serena/memories/`, and
`BACKLOG.json` returns the exact same match set as before this epic —
historical surfaces are provably untouched.

**AC-STRUCT-3** — No new backward-compatibility shim (dual-read,
fallback alias, redirect) for any renamed storage identifier, Makefile
target, or brand string is introduced anywhere in the diff.

## Manual Validation

None. Every AC in this file is checkable via `git grep`, a build, or the
unit test suite — no third-party UI flow or visual regression is
involved.
