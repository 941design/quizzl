/**
 * useUpdateChecker — polls /version.json every 5 minutes and on tab focus/visibility
 * to detect when a new build has been deployed. Once a mismatch is detected,
 * updateAvailable latches to true and stays true for the session.
 *
 * Client-only: all side effects are inside useEffect (never runs server-side).
 * Fail-soft: network errors, non-200 responses, and bad JSON are silent no-ops.
 */
import { useEffect, useState } from 'react';

const POLL_INTERVAL_MS = 300_000; // 5 minutes

/**
 * Pure comparison-and-latch logic, exported for unit testing.
 *
 * Returns true only when fetchedVersion differs from currentVersion
 * AND the latch has not already been set.
 */
export function shouldShowUpdate(
  fetchedVersion: string,
  currentVersion: string,
  alreadyLatched: boolean
): boolean {
  if (alreadyLatched) return false;
  return fetchedVersion !== currentVersion;
}

export type UpdateCheckerResult = {
  updateAvailable: boolean;
};

export function useUpdateChecker(): UpdateCheckerResult {
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    const currentVersion = process.env.NEXT_PUBLIC_BUILD_VERSION ?? '';

    // Skip checking entirely when no baked-in version is available (local dev
    // without NEXT_PUBLIC_BUILD_VERSION set). This prevents spurious banners
    // when running the dev server without a version stamp.
    if (!currentVersion) return;

    let latched = false;
    // Suppress checks for 2 seconds after mount so that browser events that
    // fire during page load (focus, visibilitychange) do not make network
    // requests before the page has fully settled. This keeps Playwright's
    // networkidle from being disrupted during e2e tests.
    let startupComplete = false;

    async function checkForUpdate() {
      if (!startupComplete) return;
      try {
        const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) {
          // An unread response body leaves the underlying connection open
          // indefinitely (observed: it never reaches the browser's network-idle
          // state), so the common 404-in-dev case must still drain it.
          await res.body?.cancel();
          return;
        }
        const data = await res.json();
        if (typeof data?.version !== 'string') return;
        if (shouldShowUpdate(data.version, currentVersion, latched)) {
          latched = true;
          setUpdateAvailable(true);
        }
      } catch {
        // Fail-soft: network failure, offline, bad JSON — all are silent no-ops.
      }
    }

    // First check fires 2 seconds after mount (after startup window closes).
    const startupTimer = setTimeout(() => {
      startupComplete = true;
      checkForUpdate();
    }, 2000);

    // Schedule recurring checks every 5 minutes.
    const intervalId = setInterval(checkForUpdate, POLL_INTERVAL_MS);

    // Immediate check when the tab returns to the foreground.
    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        checkForUpdate();
      }
    }

    // Immediate check when the window regains focus.
    function handleFocus() {
      checkForUpdate();
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      clearTimeout(startupTimer);
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  return { updateAvailable };
}
