import type { Page } from '@playwright/test';

const INDEXEDDB_DATABASES = [
  'quizzl-groups-meta',
  'quizzl-groups-state',
  'quizzl-keypackages',
  'quizzl-member-scores',
  'quizzl-member-profiles',
];

/**
 * Clear all app state: remove lp_* localStorage keys and delete all IndexedDB databases.
 * IndexedDB deletions are properly awaited to prevent stale data on page reload.
 */
export async function clearAppState(page: Page): Promise<void> {
  await page.evaluate(async (dbNames) => {
    // Clear lp_* localStorage keys
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('lp_')) keysToRemove.push(key);
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));

    // Delete IndexedDB databases — await each deletion
    await Promise.all(
      dbNames.map(
        (name) =>
          new Promise<void>((resolve) => {
            const req = indexedDB.deleteDatabase(name);
            req.onsuccess = () => resolve();
            req.onerror = () => resolve(); // resolve even on error to not block
            req.onblocked = () => resolve(); // resolve even if blocked
          }),
      ),
    );
  }, INDEXEDDB_DATABASES);
}
