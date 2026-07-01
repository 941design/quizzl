# Feature Request — Storage Namespace Rebrand Migration (`quizzl…` → `nostling…`)

**Status:** Superseded by specs/epic-few-chat-rebrand/
**Author:** rebrand follow-up (2026-06-10)
**Depends on:** brand-only rename (shipped — UI, package, wire `client` tag, window
test hooks, docs all now say *Nostling*)

---

## 1. Why this exists

The *Nostling* rebrand was applied **brand-only**: everything a user or developer
sees now says Nostling, but the **persisted local-storage namespaces still carry the
old `quizzl…` name**. The running code deliberately still reads and writes the old
key names so that **no existing user loses local data**.

This request covers the remaining, deferred half: renaming the on-disk storage
namespaces to `nostling…` and pointing the code at the new names — **without**
orphaning the data already sitting in users' browsers under the old names.

### The honest framing (decision driver)

Storage key names are **invisible to users**. This migration delivers **zero
user-visible benefit** — it only makes internal storage names match the brand.
Therefore every option below is evaluated primarily on **risk avoided**, not value
delivered. "Do nothing" is a legitimate outcome (see §7).

---

## 2. What is and isn't affected

### Out of scope — already safe (no migration needed)

The most sensitive data was **never** `quizzl`-named. All identity, settings, and
contact data lives under the **`lp_*`** localStorage prefix and is untouched by the
rebrand:

- `lp_nostrIdentity_v1` (the user's **nsec** — the irreplaceable asset)
- `lp_settings_v1`, `lp_userProfile_v1`, `lp_contacts_v1`, `lp_contactCache_v1`,
  `lp_knownPeers_v1`, `lp_pendingInvitations_v1`, `lp_dmHealed_v1`, …

**These must NOT be renamed** by this feature. The user's keypair surviving is the
whole point; leaving it on the stable `lp_*` prefix removes it from the blast radius
entirely.

### In scope — the `quizzl…` storage surface

| Backend | Name(s) | Holds | Loss impact if orphaned |
|---|---|---|---|
| idb-keyval **default** store (colon keys) | `quizzl:messages:{groupId}`, `quizzl:messages:dm:{peer}` | cached chat history | history re-syncs from relays; reaction context lost until refetch |
| idb-keyval **default** store | `quizzl:reactions:group:{groupId}`, `quizzl:reactions:dm:{peer}` | reactions | reactions reset until refetch |
| idb-keyval **default** store | `quizzl:polls:{groupId}`, `quizzl:poll-votes:{pollId}` | polls / votes | poll state reset |
| idb-keyval **named DB** `createStore('quizzl-groups-state','state')` | **MLS group state** | **critical** | **user may lose ability to decrypt ongoing groups until re-joined** |
| idb-keyval **named DB** `createStore('quizzl-keypackages','keypackages')` | **MLS key packages** | **critical** | breaks being added to / re-keying groups |
| idb-keyval **named DB** `quizzl-groups-meta` | group metadata (name/members/relays) | group list disappears until re-derived |
| idb-keyval **named DB** `quizzl-member-profiles` | member profile cache | avatars/names blank until refetch |
| idb-keyval **named DB** `quizzl-invite-links` | generated invite links | outstanding links un-resolvable locally |
| idb-keyval **named DB** `quizzl-join-requests` | pending join requests | pending requests lost |
| idb-keyval **named DB** `quizzl-profile-request-memos` | profile-request backoff memos | re-emits some requests |
| idb-keyval **named DB** `quizzl-media-blobs`, `quizzl-media-meta` | cached image blobs | images re-download (can be large) |
| localStorage | `quizzl_groups_v1` | group metadata list | group list reset until re-derived |

> `quizzl-member-scores` / `quizzl_member_scores_v1` and `quizzl:media:*` appear only
> in tests/specs, not live source — **verify before including**; likely stale fixtures.

---

## 3. Caveats discovered while doing the rename (the hard parts)

1. **IndexedDB has no rename primitive.** The named stores
   (`createStore('quizzl-…')`) are *separate IndexedDB databases*. "Renaming" one
   means: open old DB → read all records → write all to new DB → verify → delete old
   DB. There is no atomic rename. This is the bulk of the work.

2. **MLS state is the critical asset.** `quizzl-groups-state` + `quizzl-keypackages`
   hold cryptographic group state. A *partial* or *failed* copy here can leave a user
   unable to decrypt active groups. Rule: **verify-before-delete, never delete the old
   copy until the new copy is confirmed complete.**

3. **Boot-ordering gate.** Migration must finish **before** `MarmotContext`,
   `ChatStoreContext`, or any storage reader initializes. Today there is **no
   migration runner at all** — this would be the project's first. It needs a gate in
   app bootstrap that blocks data-dependent contexts until migration resolves.

4. **Lazy/dynamic reads.** `reactions/api.ts` does `await import('idb-keyval')`
   *inside* functions, on demand. Any boot gate must cover these too, or reads must
   carry their own old-name fallback (see §4 option C).

5. **Interruption & idempotency.** A user can close the tab mid-copy. The migration
   must be safe to re-run: copy with overwrite-if-absent semantics, and only set the
   completion flag (`nostling:migration:storage-rebrand:done`) **after** full verify.

6. **Cross-tab concurrency.** Two tabs booting at once could both migrate. Guard with
   the **Web Locks API** (`navigator.locks.request`) or a localStorage mutex so only
   one tab copies.

7. **Quota / peak storage.** `quizzl-media-blobs` can be large. Copy-then-delete *per
   record* bounds peak usage but weakens batch atomicity (acceptable for media — it
   re-downloads; not acceptable for MLS state — copy whole, verify, then delete).

8. **Don't brick on failure.** If migration throws, the app must keep working by
   reading the **old** names. The code cutover therefore should be guarded
   (read-new-or-old) rather than a hard switch, at least for one release.

---

## 4. Options (the decision)

### Decision A — cutover strategy

| | A. One-shot copy + delete | B. Copy, keep old (no delete) | C. Lazy dual-read (recommended) |
|---|---|---|---|
| Boot does | full copy of all stores, verify, delete old, set flag | full copy + verify, set flag, leave old behind | nothing up-front |
| Code reads | new names only | new names only | **read new; on miss, read old, write-through to new** |
| Data-loss risk | highest (big-bang delete) | low (old retained) | **lowest (no delete, no big-bang)** |
| MLS-decrypt risk | real if copy of `groups-state` is partial | low | **none — old copy always intact** |
| Boot latency | high (copies media blobs up front) | high | **none** |
| Cleanup of old data | immediate | never (or a later release) | optional later sweep once `done` flag is old enough |
| Complexity | medium | low–medium | medium (per-store read shim) |
| Reversibility | poor | good | good |

**Recommendation: Option C (lazy dual-read), or do nothing (§7).** It eliminates the
only thing that matters here — data-loss risk — at the cost of carrying a small
read-fallback shim per store. Because the migration has no user benefit, paying boot
latency or accepting big-bang delete risk (A) is unjustified.

### Decision B — old-data cleanup

When (if ever) to delete the old `quizzl…` stores after dual-read has been live:
never / next major / behind a one-time sweep gated on a flag age. **Recommend:**
defer; a few orphaned IDB databases cost nothing and removing them re-introduces
delete risk.

### Decision C — bundle vs standalone

Whether to ship this alone or fold it into the **next** legitimate storage-version
bump (e.g. the next time `quizzl-groups-state`'s schema changes anyway).
**Recommend:** bundle. A migration that must run is worth far more when it rides a
change users already benefit from.

---

## 5. Proposed approach (if Option C is chosen)

1. **Introduce name constants.** Centralize every storage name in one module
   (`app/src/lib/storageNames.ts`): `NEW` (`nostling:*` / `nostling-*`) and a `LEGACY`
   map. Today these literals are scattered across `chatPersistence.ts`,
   `reactions/api.ts`, `pollPersistence.ts`, `groupStorage.ts`, `inviteLinkStorage.ts`,
   `joinRequestStorage.ts`, `profileRequestStorage.ts`, `mediaPersistence.ts`,
   `relayBackup.ts`. Centralizing is a prerequisite and a cleanup win on its own.

2. **Default-store keys (colon):** read helper tries `nostling:…`, falls back to
   `quizzl:…`, and write-through copies to the new key on a successful old-name read.
   Writes always use the new name.

3. **Named stores:** create the `nostling-*` stores; each accessor reads new-store
   first, falls back to old-store, write-through migrates the record. Writes go to the
   new store.

4. **One-time bulk sweep (optional, lock-guarded):** a low-priority idle task copies
   any not-yet-touched records so cold data eventually migrates without waiting for
   access. Behind `navigator.locks` + completion flag.

5. **No deletes** in v1. Old stores remain as a safety net.

6. **Tests:** unit tests for the read-fallback + write-through shim (old-only →
   reads through and migrates; new present → ignores old; both present → new wins).
   E2e: seed an old-named store, boot, assert data is visible and a new-named copy
   appears. (Follow the project rule: drive through the app, not raw relay writes.)

---

## 6. Acceptance criteria (draft)

- **AC-1** No `lp_*` localStorage key is read, written, renamed, or deleted by this
  feature. (Identity/settings untouched.)
- **AC-2** A user with data under any `quizzl…` name, after upgrading, sees that data
  with **no loss** — chat history, reactions, polls, group membership, **and group
  decryption** all continue working.
- **AC-3** On a successful old-name read, a `nostling…` copy is created
  (write-through); subsequent reads hit the new name.
- **AC-4** No old-named store is **deleted** in v1.
- **AC-5** Migration is idempotent and interruption-safe: reload at any point leaves
  data intact and recoverable.
- **AC-6** Concurrent tabs do not corrupt or double-migrate (lock-guarded).
- **AC-7** If the migration path throws, the app still functions by reading old names
  (no brick).
- **AC-8** All storage names are referenced through a single constants module; no
  `quizzl…` / `nostling…` storage literal is hardcoded outside it.

---

## 7. Recommendation

**Defer, and prefer Option C when it ships.** The rebrand is already complete for
every audience that can perceive it. The storage rename is internal cosmetics with a
real data-loss tail (MLS group state), so:

- **Do not** run a big-bang copy+delete (Option A) — all risk, no benefit.
- **If/when** touched, use lazy dual-read (Option C) and **bundle** it with the next
  storage-schema change that users actually benefit from (Decision C).
- **Until then**, the code happily writing `nostling` on the wire while reading
  `quizzl:*` from disk is **correct and intended**, not debt to rush.
