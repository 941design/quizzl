# Feature Request: Update Detection for the Static Site

**Status:** Implemented 2026-06-14
**Date:** 2026-06-14
**Type:** Behavior change (client lifecycle / freshness)
**Affected context:** static export (`output: 'export'`), FTP deploy to hosteurope (`Makefile` `deploy`), no service worker present today

---

## 1. Summary

The app is a fully static export. Once a tab is open, it runs whatever JavaScript
it loaded at first paint **forever** — there is no mechanism that tells a running
tab a newer build has shipped. Long-lived chat tabs (the common case here) can run
stale code for days, missing bug fixes and protocol changes while the user has no
idea.

This feature adds **update detection**: the running app periodically checks whether
a newer build is live and, when one is, shows a **non-blocking banner** offering a
reload. The user chooses when to reload — the app **never reloads itself** out from
under an active conversation.

Detection works by **stamping each build with a version** and publishing that
version both *inside* the bundle (baked into the running tab) and as a standalone
`version.json` at the site root. The running tab compares its own baked-in version
against the freshly-fetched `version.json`; a mismatch means a newer build is live.

### What changes for the user

| Actor | Before | After |
|---|---|---|
| User with a long-lived tab | Silently runs old code indefinitely | Sees a banner when a newer build is live; reloads on their own terms |
| User reload behavior | Manual reload is the only way to get new code; user never knows when one is needed | Prompted exactly when it matters; reload is one click |
| App | No awareness of its own staleness | Knows its build version and detects newer ones |
| Mid-conversation user | — (n/a) | **Never interrupted** — no auto-reload; banner is dismissible and non-blocking |

### Decisions taken (confirmed with product owner)

| ID | Decision | Resolution |
|---|---|---|
| D1 | Detection mechanism | **Version-file poll only.** No service worker / PWA layer is added by this feature. (Open door: a future PWA feature would get update detection as a byproduct; out of scope here — §7.) |
| D2 | Reload UX | **Banner-prompted reload.** Non-blocking, dismissible. The app never force-reloads. |

---

## 2. Behavior specification

### 2.1 Build version identity

- Every build is stamped with a **version string** that is unique per deployable
  build and **monotonic enough to differ** between any two deploys. Use the **git
  commit SHA** (short or full) when available, falling back to a **build timestamp**
  if the SHA cannot be resolved (e.g. a dirty/no-git build). (Decision D3 below.)
- The version is computed **once at build time** and written to **two** places:
  1. **Baked into the bundle** as a build-time constant the running tab can read
     (e.g. `NEXT_PUBLIC_BUILD_VERSION`). This is the version of the *code currently
     running in the tab*.
  2. **A standalone `version.json`** emitted to the **site root** of the static
     output (alongside `index.html`). This is the version of the *build currently
     deployed*.
- Both must derive from the **same** computed value in a single build run, so a tab
  built from commit X always carries `X`, and the `version.json` shipped with that
  same build always reads `X`. (AC-STAMP-2.)

`version.json` shape (illustrative, non-binding):

```json
{ "version": "a1b2c3d", "builtAt": "2026-06-14T10:00:00Z" }
```

The **`version` field is the comparison key.** `builtAt` is informational only
(diagnostics / display); equality is decided on `version` alone.

### 2.2 The running tab knows its own version

- At runtime the app holds its **baked-in** version (`NEXT_PUBLIC_BUILD_VERSION`)
  in memory. This value is fixed for the life of the tab and is the source of truth
  for "what am I running right now."

### 2.3 Polling for a newer build

- While the app is open, a background checker fetches `version.json` from the site
  root on an interval. **Default interval: 5 minutes.** (Decision D4.)
- The fetch **must bypass all caches** — `cache: 'no-store'` and/or a cache-busting
  query string (`version.json?t=<ms>`). A cached `version.json` compares
  stale-to-stale and the feature silently never fires. (Caveat §4.1, AC-POLL-3.)
- **Additional trigger — focus/visibility regain:** when the tab returns to the
  foreground (`visibilitychange` → visible, or window `focus`) after having been
  hidden/backgrounded, perform an immediate check rather than waiting for the next
  interval tick. Long-backgrounded tabs are the highest-value case and should learn
  of an update as soon as the user returns to them. (AC-POLL-4.)
- The checker **must fail soft**: a network error, offline state, non-200 response,
  or unparseable body is a **no-op** — no banner, no console spam, retry on the next
  tick. A missing or malformed `version.json` must never break the app or surface an
  error to the user. (AC-POLL-5.)

### 2.4 Detecting an update

- After each successful fetch, compare `fetched.version` against the in-memory
  baked-in version.
  - **Equal** → up to date; do nothing.
  - **Different** → a newer build is live → enter the "update available" state and
    show the banner (§2.5).
- The comparison is **plain inequality**, not ordering: any difference means
  "reload to converge." (We do not attempt to prove the fetched build is *newer* —
  in a forward-only deploy pipeline, different ⇒ newer in practice. See §4.4.)
- Once the "update available" state is set, it **latches** — further successful
  fetches do not clear it or re-trigger the banner, even if `version.json` changes
  again before the user reloads. (AC-DETECT-2.)

### 2.5 The banner (reload UX)

- On entering "update available," show a **non-blocking, dismissible banner**:
  - A short message ("A new version is available.") — translated (`en` + `de`).
  - A **Reload** action that calls `location.reload()`.
  - A **dismiss** (×) control.
- The banner **must not block** interaction with the app. It does not modal-cover
  the chat, does not steal focus, and does not prevent typing or sending. (AC-UX-2.)
- **Reload** performs a full document reload. Because the app already persists
  conversations/messages to IndexedDB, a reload is **non-destructive** to chat
  history (precondition — verify per §4.2). Any purely in-flight UI state (a
  half-typed message, an open dialog) is the user's to protect — which is exactly
  why reload is **user-initiated**, never automatic. (AC-UX-3.)
- **Dismiss** hides the banner for the **current tab session**. It does not
  permanently suppress: a subsequent navigation/reload that still loads the old
  build will re-detect and re-show on the next interval, and the next *new* version
  also re-shows. Dismiss means "not now," not "never." (Decision D5; AC-UX-4.)

### 2.6 Scope of the running checker

- The checker runs once per tab, mounted at the app shell level
  (`pages/_app.tsx`), so it covers every route. It is **client-only** (no SSR
  concern — the app is statically exported and hydrates client-side).

---

## 3. The decisions this required

| ID | Decision | Resolution |
|---|---|---|
| D1 | Detection mechanism | **Version-file poll** (confirmed). No service worker. |
| D2 | Reload UX | **Banner-prompted**, dismissible, never auto-reload (confirmed). |
| D3 | Version identity | **Git short SHA**, falling back to build timestamp when no git. SHA is stable per commit and trivially unique; timestamp covers no-git builds. |
| D4 | Poll interval | **5 minutes**, plus an immediate check on tab focus/visibility regain. Balances freshness against request volume on a small static host. |
| D5 | Dismiss semantics | **Session-only** ("not now"). Re-shows for the next new build; no persistent suppression. |

---

## 4. Conflicts and caveats

### 4.1 Caching is the real enemy, not detection

The detection logic is trivial; the failure mode is **a cached `version.json`**. If
the browser or hosteurope serves a stale copy, the running tab compares its old
version against an old `version.json` and concludes (wrongly) it is up to date —
the feature silently never fires.

Mitigations, both required:
- Fetch `version.json` with `cache: 'no-store'` **and** a cache-busting query
  string. Belt and suspenders, because some intermediaries ignore one or the other.
- We do **not** control hosteurope's response headers well over FTP. The
  cache-busting query string is the defense that does not depend on server config.

**Stale HTML is a related, separate risk.** Even when detection fires and the user
reloads, *whether the reload actually fetches new HTML* depends on how hosteurope
caches `index.html` (and `trailingSlash` directory index files). Next.js
content-hashes JS/CSS chunks, so stale *assets* are not the risk — stale *HTML
pointing at old chunk names* is. If hosteurope serves `index.html` with a long
cache lifetime, a reload could re-serve the old document and the banner would
reappear in a loop. **Verify hosteurope's cache headers for `.html` and `.json`**
as part of this feature; if HTML is cached long, that must be addressed (cache
header, or accept that detection leads but convergence lags). (AC-POLL-3 covers the
JSON fetch; the HTML header verification is an investigation task, not an AC the app
code can satisfy alone.)

### 4.2 Reload must be non-destructive — precondition to verify

The banner's value rests on reload being safe. Confirm that **conversations and
messages are persisted to IndexedDB** (they are, per the DM/groups persistence
work) so a reload reconstructs chat state rather than losing it. If any
user-meaningful state lives **only** in memory, reloading on update would lose it —
in which case either persist it first or the banner copy must warn. This is why the
reload is user-initiated: the user is the last line of defense for in-flight UI
state (half-typed message, open modal). (AC-UX-3.)

### 4.3 Non-atomic FTP deploy — version.json ordering

The deploy is `lftp mirror -R --only-newer --parallel=4` — files upload **in
parallel, not atomically**. If `version.json` lands **before** the new hashed
chunks finish uploading, a user who reloads in that window could 404 a chunk that
is referenced by the new HTML but not yet on the server.

**Required deploy ordering: upload `version.json` LAST**, after all hashed assets
and HTML are in place. With the current single-`mirror` command this ordering is not
guaranteed. Options:
- Exclude `version.json` from the main `mirror`, then upload it in a **second,
  serial** step afterward; or
- Accept the small race (parallel=4, brief window) and document it.

This is a **deploy-pipeline change** (`Makefile`), not app code. The probability is
low but the failure (a hard chunk 404 on reload) is user-visible, so the ordering
fix is recommended. (AC-DEPLOY-1.)

### 4.4 "Different ⇒ newer" assumes a forward-only pipeline

The comparison is plain inequality, so a **rollback** (redeploying an older build)
would also trip the banner and reload users onto the older build. This is correct
behavior — the deployed build is the intended one — but worth stating: the feature
converges tabs onto *whatever is currently deployed*, not onto *the highest version
ever seen*. No version ordering is implied or required.

### 4.5 Multiple tabs

Each tab runs its own checker independently and shows its own banner. There is no
cross-tab coordination (no `BroadcastChannel`) in this scope. Reloading one tab does
not dismiss the banner in another; each tab converges on its own next reload. This
is acceptable and avoids added complexity. (Out of scope: cross-tab sync — §7.)

### 4.6 Dev / test environments

The checker must not interfere with local dev or e2e runs. In dev there is no
meaningful `version.json` and the SHA may be a dev placeholder; the fail-soft
behavior (§2.3) covers a missing/placeholder file. E2e tests that assert update
behavior must be able to **control** what `version.json` returns (serve a fixture or
intercept the request) so a deterministic "update available" can be staged without
an actual redeploy. (See §6 Tests.)

---

## 5. Acceptance criteria

### Build stamping
- **AC-STAMP-1** A production build emits `version.json` at the static-export root
  (next to `index.html`) containing a non-empty `version` field.
- **AC-STAMP-2** The version baked into the bundle (`NEXT_PUBLIC_BUILD_VERSION`) and
  the `version` in the same build's `version.json` are **identical**.
- **AC-STAMP-3** Two builds from two different commits produce two different
  `version` values; the version derives from the git short SHA, falling back to a
  build timestamp when git is unavailable.

### Polling
- **AC-POLL-1** While the app is open, `version.json` is fetched on a ~5-minute
  interval.
- **AC-POLL-2** Returning the tab to the foreground after it was hidden triggers an
  immediate check without waiting for the next interval.
- **AC-POLL-3** The `version.json` fetch bypasses cache (no-store and/or
  cache-busting query string), verified by the request not being served from cache.
- **AC-POLL-4** A focus/visibility-regain check and an interval check use the same
  detection path and both can raise the banner.
- **AC-POLL-5** A network failure, non-200, offline state, or unparseable
  `version.json` is a no-op: no banner, no thrown error, no user-visible failure;
  the next tick retries.

### Detection
- **AC-DETECT-1** When the fetched `version` differs from the baked-in version, the
  banner appears.
- **AC-DETECT-2** When the fetched `version` equals the baked-in version, no banner
  appears; and once the banner is showing, further fetches neither hide it nor
  re-trigger it (latched).

### Reload UX
- **AC-UX-1** The banner is non-blocking: with it visible, the user can still type,
  send, and navigate normally.
- **AC-UX-2** Pressing **Reload** performs a full document reload.
- **AC-UX-3** The app never reloads itself automatically; a reload happens **only**
  on explicit user action.
- **AC-UX-4** Pressing **dismiss** hides the banner for the session; it is not
  permanently suppressed (a later new version, or continued staleness on the next
  interval, re-shows it).
- **AC-UX-5** Banner text (message, Reload, dismiss/aria labels) is translated in
  both `en` and `de`; no hardcoded user-visible strings.

### Deploy
- **AC-DEPLOY-1** The deploy process publishes `version.json` such that it is not
  visible to clients before the build's hashed assets are in place (version.json
  uploaded last, or the race explicitly accepted and documented).

### Fail-soft / isolation
- **AC-SAFE-1** With `version.json` absent (e.g. local dev), the app runs normally
  and never shows an error from the checker.

---

## 6. Implementation pointers (non-binding)

- **Version computation:** resolve git short SHA at build time (e.g. in
  `next.config.mjs` via `child_process` `git rev-parse --short HEAD`, guarded with a
  timestamp fallback). Expose as `process.env.NEXT_PUBLIC_BUILD_VERSION` so it bakes
  into the client bundle.
- **Emitting `version.json`:** write it into the export output as part of the build.
  Options: a `public/version.json` generated by a prebuild script, or a small
  postbuild step that writes into the `out/` directory. It must land at the export
  root so it is fetchable at `/version.json` (respecting `basePath` — currently
  empty — and `trailingSlash`).
- **Checker hook:** a client-only `useUpdateChecker()` mounted in `pages/_app.tsx`.
  Holds an interval, a `visibilitychange`/`focus` listener, and the latched
  "update available" state. Fetches `version.json?t=${Date.now()}` with
  `{ cache: 'no-store' }`. Fail-soft on every error path.
- **Banner UI:** a small presentational component rendered from `_app.tsx` (or the
  shared layout) above/below the app chrome, styled to match existing notices. Wire
  Reload → `window.location.reload()`, dismiss → local state.
- **i18n:** add `en` + `de` keys for the banner message, the Reload action, and the
  dismiss aria-label. Per `CLAUDE.md`, extend the `Copy` type and both language
  objects in `app/src/lib/i18n.ts`; use `useCopy()` in the component.
- **Deploy ordering (§4.3):** in the `Makefile` `deploy` target, either exclude
  `version.json` from the main `lftp mirror` and upload it in a trailing serial
  step, or document the accepted race. Also a one-time **investigation**: capture
  hosteurope's response headers for `index.html` and `version.json` (§4.1) and
  record whether HTML caching needs attention.
- **Tests (e2e — must drive through the app, per `CLAUDE.md` and
  `feedback_e2e_no_direct_relay`):**
  - **Update appears:** load the app with a baked-in version `A`, serve/intercept
    `version.json` to return version `B`, advance to a check (interval or simulated
    focus), assert the banner appears; press Reload and assert a navigation occurs.
    Use Playwright route interception to control `version.json` (this is app-served
    static content, not a relay event — the no-raw-WebSocket rule concerns relay
    publishes and does not apply here; intercepting a static JSON file is the
    correct tool).
  - **No false positive:** `version.json` returns the same version `A`; assert no
    banner ever appears.
  - **Fail-soft:** `version.json` returns 404 / network error; assert no banner and
    no app error.
  - **Dismiss is session-only:** dismiss the banner, then on a later check with a
    *new* version assert it re-appears.
  - **Non-blocking:** with the banner visible, assert the user can still type into
    and send a message.
- **Unit tests:** the version-comparison + latch logic and the fail-soft branches
  are pure and should be unit-tested directly (no browser needed).

---

## 7. Out of scope

- **Service worker / PWA** (offline support, installability, asset precaching). A
  future PWA feature would subsume update detection via an `update ready` event;
  this feature deliberately does not add that layer (Decision D1).
- **Auto-reload** without user consent (Decision D2 rejects it — hostile in a chat
  app mid-message).
- **Cross-tab coordination** (`BroadcastChannel`) so dismissing/reloading one tab
  affects others. Each tab is independent (§4.5).
- **Forced/blocking updates** ("you must reload to continue"). The banner is always
  dismissible; no build is ever gated behind a mandatory reload.
- **Version ordering / downgrade protection.** The feature converges on whatever is
  currently deployed, including rollbacks (§4.4); it does not track a monotonic
  high-water mark.
- **Changelog / "what's new" surfacing** in the banner. The banner says a new
  version exists; it does not describe the changes.
- **Fixing hosteurope HTML cache headers** beyond investigating and reporting them
  (§4.1) — any required header change is a follow-up if the investigation shows it
  is needed.
