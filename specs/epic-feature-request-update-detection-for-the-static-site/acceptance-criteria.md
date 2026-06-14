# Acceptance Criteria: Update Detection for the Static Site

<!--
  Decisions encoded here:

  1. AC-STAMP-1/AC-STAMP-2 reference version.json and NEXT_PUBLIC_BUILD_VERSION, both
     of which are absent from the codebase at planning time (exploration.json confirms:
     no env block in next.config.mjs, no version.json in public/ or out/).
     These are intentionally new artifacts created by this epic — not absent
     pre-existing artifacts — so no adjudication was required (same precedent as
     AC-GRANT-2 in the admin role management epic referencing grantAdminImpl.ts).

  2. AC-DEPLOY-1 is an ordering constraint on the Makefile deploy target, not an
     in-app behavior the automated test suite can gate. It is listed under Manual
     Validation (MV-1) for this reason.

  3. AC-STAMP-3 (two different commits → two different versions) is verifiable
     locally but also benefits from manual confirmation in a CI-less, FTP-deploy
     pipeline. It is listed under Manual Validation (MV-2).

  4. AC-POLL-3 (cache bypass) — "not served from cache" is verified by inspecting
     the Network DevTools tab or Playwright page.route() interception; no purely
     in-app unit test can observe the browser cache layer directly.

  5. Dismiss semantics (AC-UX-4) are session-only: the banner is hidden in
     sessionStorage or local state only, never in localStorage or IndexedDB.
     Re-shows on next version change or new tab — this matches spec Decision D5.
-->

## Build Stamping

**AC-STAMP-1**: A production build MUST emit `version.json` at the static-export root (alongside `index.html`) containing a non-empty `version` field and a `builtAt` field.

**AC-STAMP-2**: The `version` field in the build's `version.json` and the value baked into the bundle as `NEXT_PUBLIC_BUILD_VERSION` MUST be identical — both derived from the same computed value in the same build run.

**AC-STAMP-3**: Two builds from two different git commits MUST produce two different `version` values; the version MUST be the git short SHA when git is available, falling back to a build timestamp (`Date.now()` or `date +%s`) when git is unavailable.

## Polling

**AC-POLL-1**: While the app is open in a browser tab, `useUpdateChecker` MUST fetch `/version.json` on a recurring interval of approximately 5 minutes (300,000 ms); no fetch MUST occur more frequently than this interval under normal conditions.

**AC-POLL-2**: When a tab returns to the foreground after being hidden (`visibilitychange` → visible, or `window` focus event), `useUpdateChecker` MUST perform an immediate check without waiting for the next scheduled interval tick.

**AC-POLL-3**: Every `version.json` fetch MUST include both `cache: 'no-store'` and a cache-busting query string (`?t=<ms timestamp>`); the request MUST NOT be served from the browser cache.

**AC-POLL-4**: A focus/visibility-regain check and a scheduled interval check MUST use the same detection path and MUST both be capable of raising the "update available" state and displaying the banner.

**AC-POLL-5**: A network failure, non-200 HTTP response, offline state, or unparseable `version.json` body MUST be a no-op — no banner is shown, no error is thrown, no error is logged to the console, and the checker retries on the next tick.

## Detection

**AC-DETECT-1**: When a successful `version.json` fetch returns a `version` value that differs from the baked-in `NEXT_PUBLIC_BUILD_VERSION`, `UpdateBanner` MUST become visible.

**AC-DETECT-2**: When a successful `version.json` fetch returns a `version` value equal to the baked-in `NEXT_PUBLIC_BUILD_VERSION`, `UpdateBanner` MUST NOT appear; and once `UpdateBanner` is visible (update available state is latched), subsequent fetches — whether returning the same or a different version — MUST NOT hide the banner or re-trigger it.

## Reload UX

**AC-UX-1**: While `UpdateBanner` is visible, the user MUST be able to type, send messages, and navigate the app normally; the banner MUST NOT modal-cover any content, steal focus, or block any interaction.

**AC-UX-2**: Pressing the **Reload** control in `UpdateBanner` MUST perform a full document reload (`window.location.reload()`).

**AC-UX-3**: The app MUST NOT reload itself automatically at any point; a page reload MUST occur only as a result of an explicit user action on the Reload control.

**AC-UX-4**: Pressing the **dismiss** (×) control in `UpdateBanner` MUST hide the banner for the current tab session; it MUST NOT permanently suppress future notifications — a subsequent check that detects a new or continued version mismatch MUST re-show the banner (session-only suppression, not persistent).

**AC-UX-5**: All user-visible strings in `UpdateBanner` (banner message, Reload button label, dismiss aria-label) MUST be defined as `en` and `de` entries in `app/src/lib/i18n.ts`, declared in the `Copy` type, and referenced via `useCopy()` in the component; no user-visible string MUST be hardcoded in the component file.

## Deploy Ordering

**AC-DEPLOY-1**: The deploy process MUST publish `version.json` after all build-hashed assets and HTML files are in place on the server; `version.json` MUST NOT become visible to polling clients before the hashed JS/CSS chunks referenced by the new HTML are fully uploaded (either by excluding `version.json` from the parallel `lftp mirror` and uploading it last in a serial step, or by documenting the accepted race window with a rationale).

## Fail-Soft / Isolation

**AC-SAFE-1**: When `version.json` is absent (e.g. local dev, first deploy before file exists), `useUpdateChecker` MUST run without error, MUST NOT display a banner, and MUST NOT produce any user-visible failure or console error.

---

## Manual Validation

The following behaviors require manual verification beyond what automated tests can gate:

**MV-1 (relates to AC-DEPLOY-1 — FTP deploy ordering):**
Verify during a real `make deploy` run that `version.json` is uploaded after all hashed JS/CSS chunks and HTML files. Inspect the lftp output or stagger the deploy and confirm a polling client between the two lftp steps does not encounter a 404 on a chunk referenced by the new HTML. The Makefile fix (split into `mirror --exclude version.json` + serial `put version.json`) satisfies this; the manual check confirms the ordering holds in practice.

**MV-2 (relates to AC-STAMP-3 — two commits, two versions):**
After two consecutive production builds from two different commits, confirm that the `version` field in each build's `version.json` differs and that each matches the git short SHA of its commit. Verifiable locally with `git stash` / `git commit` + `make build`; worth confirming in the actual FTP-deploy pipeline since there is no CI.

**MV-3 (relates to AC-POLL-3 — cache bypass in the deployed environment):**
On the live hosteurope deployment, fetch `/version.json` twice in succession and confirm the response is not served from disk cache or a CDN cache. Also capture the `Cache-Control` response header for both `index.html` and `version.json` on hosteurope and record whether HTML caching needs a follow-up (per spec §4.1 investigation task).
