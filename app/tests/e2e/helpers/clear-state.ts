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
 */
export async function clearAppState(page: Page): Promise<void> {
  await page.evaluate((dbNames) => {
    // Clear lp_* localStorage keys
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('lp_')) keysToRemove.push(key);
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));

    // Delete IndexedDB databases
    for (const name of dbNames) {
      indexedDB.deleteDatabase(name);
    }
  }, INDEXEDDB_DATABASES);
}
