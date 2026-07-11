import type { Page } from '@playwright/test';

/**
 * Expand the Advanced Settings section on the /settings page.
 *
 * The npub (public key) display, relay management, signer connections, and the
 * danger zone all live inside the collapsed "Advanced" region. Tests that need
 * any of those must open it first. Clicking the toggle is idempotent enough for
 * test use: the button auto-waits, and the section starts collapsed on every
 * fresh navigation/reload.
 */
export async function openAdvancedSettings(page: Page): Promise<void> {
  await page.getByTestId('advanced-settings-toggle').click();
}
