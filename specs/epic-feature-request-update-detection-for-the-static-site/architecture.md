# Architecture: Update Detection for the Static Site

## Paradigm

Modular monolith at the app-shell level. This feature is a thin cross-cutting concern — it adds one new hook, one new component, and modifies three existing files (next.config.mjs, Makefile, _app.tsx). No new module boundary is introduced; the checker integrates into the existing client-only app shell layer.

## Module Map

| Module | Purpose | Location | Owned Data |
|---|---|---|---|
| `useUpdateChecker` | Polls /version.json, compares to baked-in version, latches "update available" state | `app/src/hooks/useUpdateChecker.ts` | interval ref, latched updateAvailable bool |
| `UpdateBanner` | Non-blocking dismissible banner shown when update available | `app/src/components/UpdateBanner.tsx` | dismissed session state |
| `i18n` (extension) | en+de strings for banner message, reload action, dismiss label | `app/src/lib/i18n.ts` | Copy type extension |
| `_app.tsx` (extension) | Mounts useUpdateChecker + renders UpdateBanner in app shell | `app/pages/_app.tsx` | none |
| `next.config.mjs` (extension) | Bakes NEXT_PUBLIC_BUILD_VERSION at build time | `app/next.config.mjs` | build constant |
| `Makefile` (extension) | Emits version.json post-build; uploads version.json last in deploy | `Makefile` | none |

## Boundary Rules

- `useUpdateChecker` has no UI — it returns `{ updateAvailable: boolean }`. It does not import any component.
- `UpdateBanner` takes `updateAvailable` as a prop and imports `useCopy()` for translations; it does not call `useUpdateChecker` directly.
- The connection between hook and component lives exclusively in `_app.tsx` (the orchestration layer).
- `useUpdateChecker` must be client-only (no SSR). The existing `_app.tsx` is already client-rendered; the hook uses `useEffect` which never runs server-side in the static export.

## Seams

None between stories — this epic is implemented as a single story with no cross-story dependencies.

## Implementation Constraints

### Build-time version stamp
- `next.config.mjs`: add `import { execSync } from 'child_process'` and compute:
  ```js
  let BUILD_VERSION;
  try {
    BUILD_VERSION = execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    BUILD_VERSION = Date.now().toString();
  }
  ```
  Then expose via `env: { NEXT_PUBLIC_BUILD_VERSION: BUILD_VERSION }` in `nextConfig`.
- `Makefile`: define `BUILD_VERSION := $(shell git rev-parse --short HEAD 2>/dev/null || date +%s)`.
  Add a post-build step:
  ```make
  echo '{"version":"$(BUILD_VERSION)","builtAt":"$(shell date -u +%Y-%m-%dT%H:%M:%SZ)"}' \
    > $(LOCAL_DIST)/version.json
  ```

### Deploy ordering (AC-DEPLOY-1)
Split the `deploy` Makefile target into two sequential lftp sessions:
1. Mirror everything EXCEPT version.json: `mirror -R --parallel=4 --exclude version.json`
2. Upload version.json last: `put $(LOCAL_DIST)/version.json -o $(FTP_PATH)/version.json`

### Polling
- `fetch('/version.json?t=' + Date.now(), { cache: 'no-store' })` — cache-busting query string plus cache directive.
- Interval: 5 minutes (300,000 ms).
- Immediate check on `visibilitychange` → visible and `window` focus events.
- Fail-soft: any network error, non-200, or parse failure is a no-op. No console spam.

### UpdateBanner component
- Modelled on `OfflineBanner.tsx`: Chakra `Alert` + `CloseButton`, local dismissed state, early `return null`.
- `data-testid="update-banner"` on the root and `data-testid="update-banner-dismiss"` on the close button, `data-testid="update-banner-reload"` on the reload button.
- Reload: `window.location.reload()`.
- Dismiss: sets local dismissed flag (session-only, not persisted).

### i18n
- Add `updateBanner` section to `Copy` type in `i18n.ts`:
  - `message: string` — "A new version is available."
  - `reload: string` — "Reload"
  - `dismissAriaLabel: string` — "Dismiss update notification"
- Add both `en` and `de` values.

### Tests
- **Unit tests** (`app/tests/unit/useUpdateChecker.test.ts`): Extract the pure comparison-and-latch logic into a plain function for direct testing; test fail-soft branches, latch behavior, and version equality. Mock `fetch` via `Object.defineProperty(globalThis, 'fetch', ...)` for the fetch-path tests.
- **E2E tests** (`app/tests/e2e/update-detection.spec.ts`): Use `page.route('**/version.json**', ...)` to intercept `/version.json` requests. Cover: banner appears on version mismatch, no banner on same version, fail-soft on 404, dismiss is session-only, user can still type with banner visible.

## Existing Patterns to Follow

- `app/src/hooks/useOnlineStatus.ts` — hook structure with useEffect + cleanup
- `app/src/components/groups/OfflineBanner.tsx` — Chakra dismissible banner
- `app/src/context/BackupContext.tsx:53-56` — visibilitychange listener pattern
- `app/tests/unit/unreadStore.test.ts` — unit test style without DOM
