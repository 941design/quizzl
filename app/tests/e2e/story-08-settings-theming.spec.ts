import { test, expect } from '@playwright/test';

test.describe('Story 08: Theme Settings', () => {
  test.beforeEach(async ({ page }) => {
    // Clear all app data
    await page.goto('/');
    await page.evaluate(() => {
      Object.keys(localStorage)
        .filter((k) => k.startsWith('lp_'))
        .forEach((k) => localStorage.removeItem(k));
    });
  });

  test('1. Settings page renders with theme buttons', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    const settingsPage = page.getByTestId('settings-page');
    await expect(settingsPage).toBeVisible();

    // Available theme buttons should be visible
    const calmBtn = page.getByTestId('theme-calm-btn');
    const playfulBtn = page.getByTestId('theme-playful-btn');
    const legoBtn = page.getByTestId('theme-lego-btn');
    const minecraftBtn = page.getByTestId('theme-minecraft-btn');
    const flowerBtn = page.getByTestId('theme-flower-btn');
    await expect(calmBtn).toBeVisible();
    await expect(playfulBtn).toBeVisible();
    await expect(legoBtn).toBeVisible();
    await expect(minecraftBtn).toBeVisible();
    await expect(flowerBtn).toBeVisible();
  });

  test('2. Switching to playful theme persists in localStorage', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    // Click playful
    await page.getByTestId('theme-playful-btn').click();

    // Theme preview should update
    const preview = page.getByTestId('theme-preview');
    await expect(preview).toContainText('Playful');

    // Verify localStorage
    const stored = await page.evaluate(() => localStorage.getItem('lp_settings_v1'));
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored!);
    expect(parsed.theme).toBe('playful');
  });

  test('3. Theme setting persists after page reload', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    // Switch to playful
    await page.getByTestId('theme-playful-btn').click();
    await expect(page.getByTestId('theme-preview')).toContainText('Playful');

    // Reload
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Should still show playful
    await expect(page.getByTestId('theme-preview')).toContainText('Playful');
  });

  // NOTE: The "Reset All Data" UI was removed from the Settings page because an
  // accidental trigger would irreversibly wipe the user's identity and all local
  // state. The underlying resetAllData() logic is retained but currently unused;
  // its behavior is covered by app/tests/unit/storage.test.ts.
});
