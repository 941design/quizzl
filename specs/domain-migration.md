# Feature Request — Domain Migration (`nostling.941design.de` → `few.chat`)

**Status:** Proposed (not scheduled)
**Author:** domain-move planning (2026-07-01)
**Related:** `specs/storage-namespace-rebrand-migration.md` (different problem — same-origin
key rename), `specs/relay-backup.md` / `app/src/lib/backup/relayBackup.ts` (reusable
serialization leaves), `specs/epic-mls-fork-resolution/` (does **not** cover this case — see §6)

---

## 1. Why this exists

We are moving the app to a new domain (`few.chat`). Deployment is trivial; **moving the
users is not.** Every browser stores all of a user's data — identity key, group state,
chat history — in `localStorage` and `IndexedDB`, both of which are **scoped to the
origin** (the exact hostname). `nostling.941design.de` and `few.chat` are different
origins, so **nothing carries over automatically.** On the new domain a returning user
looks, to the browser, like a brand-new user with an empty slate. There is no server-side
account to fall back on — this app deliberately keeps everything client-side.

"Move the identity and history" therefore means physically copying data out of one
domain's browser storage and into the other's. This feature builds that copy as a
**manual export/import**: the user downloads a backup file on the old domain and uploads
it on the new one.

### The reassuring half (framing)

A user's **network identity is domain-independent.** Their `npub`, and everything
addressed to it on relays (contacts, DM history, profile), belong to their *key*, not to
the domain. Anyone who still has their key can log in on `few.chat` and network-side data
re-syncs on its own. The export/import exists to rescue the two things a fresh login
*cannot* recover:

1. **The key itself**, for users who never backed it up (it only lives in the old
   origin's `localStorage`).
2. **MLS group state**, which is purely local and cannot be rebuilt from relays — without
   it a user cannot decrypt their ongoing groups.

Because we must also assume **relays have expired old messages**, the backup is treated as
the **authoritative copy** of history, not a convenience — so it captures *everything*
local, not just the non-recoverable tier.

---

## 2. Locked product decisions

| Decision | Choice |
|---|---|
| Transfer mechanism | Manual **export → download file → upload → import**. |
| File encryption | **None** — plaintext file. |
| Backup contents | **Everything** local (identity, MLS state, DMs, group history, polls, reactions, media, contacts, settings). Assume relays expired history. |
| Deploys | **Two long-lived branches**: export-only build → old domain; import-only build → `few.chat`. Shared logic lives on `main`; branches differ only by a build-time role constant. |
| Old domain after export | Becomes **read-only for MLS group sends** (history stays readable; DMs stay fully functional). Enforces single-active-device to avoid group forks (§6). |

---

## 3. What must transfer (storage inventory)

Drive the **localStorage** dump by enumerating `Object.keys(localStorage)` — **not** an
allowlist. `STORAGE_KEYS` (`app/src/types/index.ts:33-47`) is *not* exhaustive (it omits
`lp_dmHealed_v1`, `lp_unreadLastRead_v1`, `lp_unreadLastReadDM_v1`, and any future key). An
allowlist here is a silent-data-loss generator.

**IndexedDB — named stores** (`createStore(db, store)`):

| DB / store | Holds | Binary? |
|---|---|---|
| `quizzl-groups-state` / `state` | **MLS group state (critical)** | **yes** (Uint8Array) |
| `quizzl-keypackages` / `keypackages` | **MLS key packages (critical)** | — |
| `quizzl-groups-meta` / `groups` | group metadata | — |
| `quizzl-member-profiles` / `profiles` | member profile cache | — |
| `quizzl-media-blobs` / `blobs` | cached image bytes | **yes** (Uint8Array) |
| `quizzl-media-meta` / `meta` | media metadata | — |
| `quizzl-invite-links` / `links` | generated invite links | — |
| `quizzl-join-requests` / `requests` | pending join requests | — |
| `quizzl-profile-request-memos` / `memos` | profile-request backoff | — |

**IndexedDB — default store, colon keys** (enumerate via idb-keyval `keys()` + prefix):
`quizzl:messages:*` (group + `dm:` threads), `quizzl:polls:*`, `quizzl:poll-votes:*`,
`quizzl:reactions:group:*`, `quizzl:reactions:dm:*`.

Enumeration is fully feasible; `indexedDB.databases()` is not needed (rely on the known
DB-name list). Binary detection must be **structural** (encode any `Uint8Array`/`ArrayBuffer`
wherever it appears) — MLS state values are variously a `Uint8Array`, a `{ bytes }` object,
or a plain object (see the branching at `relayBackup.ts:129-135`).

---

## 4. The three moving parts

### 4a. Export (old-domain build)
A "Download my backup" action serializes the full inventory (§3) into one versioned,
plaintext JSON file and triggers a browser download. On success it sets the read-only flag
(4c). Build the file from **Blob parts**, not one mega-string, and chunk the base64
conversion — media blobs can be multi-MB and a single `JSON.stringify` can OOM the tab.

### 4b. Import (new-domain build) — the boot-gate
A fresh browser **silently auto-generates a throwaway identity** on first mount
(`NostrIdentityContext.tsx:171-179`) — there is no login screen. So the import must run
**before the provider tree mounts** and must write `lp_nostrIdentity_v1` first, then trigger
`window.location.reload()` so every context re-reads storage cleanly.

- **Gate placement:** in `app/pages/_app.tsx`, short-circuit *above* `NostrIdentityProvider`;
  render the import UI instead of the provider subtree until import state is clean.
- **Overwrite, not merge:** clear-then-write each target store → deterministic and
  idempotent (safe to re-run).
- **Interruption safety:** write a sentinel `lp_migrationImportState_v1 = "in-progress"`
  before the first write, `"done"` after the last. On boot: `in-progress` → **refuse to
  boot** (offer resume/redo) so a half-populated origin never manufactures a throwaway
  identity or forked MLS state.

### 4c. Read-only-after-export (old-domain build)
A global flag `lp_migrationExported_v1` (set on successful export) blocks **MLS group
publishes** while leaving reads and DMs untouched. Enforce at the **publish chokepoint**,
not per-UI-button (per the walled-garden lesson that per-path gating misses bypasses):

- Extract the three divergent `sendRumorSafe` copies (`ChatStoreContext.tsx:51`,
  `PollStoreContext.tsx:81`, `MarmotContext.tsx:78`) into one shared
  `app/src/lib/marmot/sendRumorSafe.ts` and put the guard there once (covers text,
  reactions, polls, leave announcement).
- Guard the direct-commit paths that bypass `sendRumorSafe`: image send
  (`useImageSend.ts:132`), and the `inviteByNpub` / `grantAdmin` / `cancelPendingInvitation`
  wrappers in `MarmotContext.tsx` (guard at the call site — the impl files receive `commit`
  as an injected dependency and shouldn't own policy).
- DMs need **no special effort** — they go through `directMessages.ts`, never a group
  `sendApplicationRumor`, so scoping the guard to group sends leaves them working.
- UI: a read-only banner + disabled compose/poll/invite affordances are **cosmetic**; the
  chokepoint guard is the real enforcement.

---

## 5. Proposed approach (files)

New shared code on `main` under `app/src/lib/migration/`:

1. `role.ts` — read `NEXT_PUBLIC_MIGRATION_ROLE=export|import` (+ a test-only runtime
   override, see §8).
2. `storageManifest.ts` — single source of truth: named stores, default-store prefixes,
   **logical** store IDs mapped to physical `quizzl-*` names (the indirection hedges the
   deferred namespace rebrand — if `quizzl-*`→`few-*` lands on one branch, only the
   manifest changes; old files still import).
3. `envelope.ts` — versioned format `{ formatVersion, role, createdAt, sourceOrigin,
   localStorage:{}, idb:{} }`; structural `Uint8Array` encode/decode.
4. `exportBackup.ts` — `collectFullExport()` (Blob-parts output).
5. `importBackup.ts` — `applyFullImport()` (identity first, sentinel-wrapped,
   clear-then-write).
6. `sendLock.ts` — `isGroupSendLocked()` / `assertGroupSendUnlocked()`.

Reuse only the **leaf helpers** from `relayBackup.ts` (`uint8ArrayToBase64` /
`base64ToUint8Array`, `IdbGroupStateBackend`) — **not** `collectBackupPayload` /
`restoreFromBackup`, which are a typed subset (capped 10 messages) with deliberate
*merge* semantics. A fresh-origin migration wants a raw full dump and a deterministic
overwrite.

UI: `app/src/components/migration/{ImportGate,ExportPanel,ReadOnlyBanner}.tsx`; boot-gate
wired in `_app.tsx`; banner mounted in `Layout`; entry via `app/pages/migrate.tsx` or a
role branch in `index`.

### Branch structure
Keep **all** migration code on `main`. The only branch-divergent surface is the value of
`NEXT_PUBLIC_MIGRATION_ROLE` (and the deploy target). This collapses per-branch divergence
to nearly zero and lets a single dev build expose both roles for the e2e (§8). The two
long-lived branches simply pin the env var.

---

## 6. Known limitation — MLS epoch advancement (surface to product owner)

The read-only-on-old-origin rule prevents **your own** device from forking a group. It does
**not** stop **other members** from committing (invite / remove / key-rotation) in the
window *after* you export and *before* you import. The imported state is then a few epochs
behind, and — under our own premise that **relays have expired** history — the intervening
commit may be unfetchable, leaving the migrated device unable to decrypt new group traffic
until it is **re-invited**.

This is inherent (MLS does not support the same identity as two live devices; see
`groups-feature-spec-request.md:182-186`, which already scopes multi-device out and accepts
"single-device-per-identity"). The already-shipped `epic-mls-fork-resolution` does **not**
cover it — that epic resolves *different members'* concurrent commits, not one identity
duplicated across origins.

**Mitigations (accept as known limitation):**
- Instruct users to export → import **back-to-back**.
- Migrate `quizzl-keypackages` so a desynced device can be **re-invited** cleanly.
- Document "you may need to be re-added to a very active group" as expected.

**Open sub-decision:** the group *leave* announcement is technically a group send.
Recommendation: **allow leave even in read-only mode** (a departure is not a fork risk);
do not silently gate it. Confirm.

---

## 7. Acceptance criteria (draft)

- **AC-1** Export produces one plaintext file containing **every** `localStorage` key
  (enumerated, not allowlisted) and **every** IndexedDB store in the manifest, with binary
  values structurally encoded.
- **AC-2** Import on a fresh origin writes `lp_nostrIdentity_v1` **before** any provider
  mounts; after reload the app shows the **same `npub`** as the source, with no throwaway
  identity created.
- **AC-3** After import, group membership + **group decryption**, DM history, polls,
  reactions, and cached media are all present and functional.
- **AC-4** Import is idempotent and interruption-safe: a tab closed mid-import leaves the
  app refusing to boot into a half-populated state; re-running completes cleanly.
- **AC-5** After a successful export, **every** MLS group publish path (text, image,
  paste, drop, reaction, poll create/vote/close, invite, grant-admin, cancel-invite) is
  blocked at the chokepoint; group history stays readable; **DMs stay fully functional**.
- **AC-6** All migration code lives on `main`; the only branch difference is
  `NEXT_PUBLIC_MIGRATION_ROLE` + deploy target.
- **AC-7** No `quizzl…`/`nostling…`/`few…` physical storage name is hardcoded outside the
  manifest.

---

## 8. Testing

Per the project rule, e2e drives through the app, never a raw relay socket.

- **Unit (round-trip):** seed fake `localStorage` + `fake-indexeddb`, run
  `collectFullExport()` → serialize → `applyFullImport()` into clean stores → deep-equal.
  Cover the three MLS-state value shapes (`Uint8Array`, `{ bytes }`, plain object) and a
  media blob explicitly.
- **e2e (`app/tests/e2e/migration-export-import.spec.ts`):** two isolated
  `browser.newContext()` (established pattern) to reproduce orphaned storage. Context A
  (export role) creates identity + a group + sends a group message, clicks Export
  (intercept the download); Context B (import role) uploads the file through the real file
  input, lets the app reload, asserts (a) `npub` matches A and (b) the group message is
  present.
- **Both roles in one dev build:** `role.ts` honors a test-only override
  (`?migrationRole=` / `window.__MIGRATION_ROLE`) so one dev server serves both halves to
  the two contexts.

---

## 9. Recommendation

Build it as **one shared implementation on `main`** driven by a single role constant, and
run the two branches as thin env-var pins. The highest-severity footguns are (1) the
throwaway-identity race — the boot-gate must block the whole provider subtree and write
identity before reload — and (2) the MLS epoch-advancement limitation (§6), which is not
fully solvable and must be set as an expectation, not hidden.
