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

  test('1. Settings page renders the aquarelle theme button (the only shipped theme)', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    const settingsPage = page.getByTestId('settings-page');
    await expect(settingsPage).toBeVisible();

    // aquarelle is the only shipped theme; its button is present and the
    // removed themes' buttons are gone.
    await expect(page.getByTestId('theme-aquarelle-btn')).toBeVisible();
    for (const removed of ['calm', 'playful', 'lego', 'minecraft', 'flower']) {
      await expect(page.getByTestId(`theme-${removed}-btn`)).toHaveCount(0);
    }
  });

  test('2. Selecting the aquarelle theme persists in localStorage', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    await page.getByTestId('theme-aquarelle-btn').click();

    // Theme preview should show the aquarelle theme
    const preview = page.getByTestId('theme-preview');
    await expect(preview).toContainText('Aquarelle');

    // Verify localStorage
    const stored = await page.evaluate(() => localStorage.getItem('lp_settings_v1'));
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored!);
    expect(parsed.theme).toBe('aquarelle');
  });

  test('3. Theme setting persists after page reload', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    await page.getByTestId('theme-aquarelle-btn').click();
    await expect(page.getByTestId('theme-preview')).toContainText('Aquarelle');

    // Reload
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Should still show aquarelle
    await expect(page.getByTestId('theme-preview')).toContainText('Aquarelle');
  });

  // NOTE: The "Reset All Data" UI was removed from the Settings page because an
  // accidental trigger would irreversibly wipe the user's identity and all local
  // state. The underlying resetAllData() logic is retained but currently unused;
  // its behavior is covered by app/tests/unit/storage.test.ts.

  test('4. a deprecated/unknown stored theme name falls back to aquarelle without error', async ({ page }) => {
    // A settings blob persisted before the old themes were removed must not
    // break the app — it normalizes to aquarelle on read.
    await page.goto('/');
    await page.evaluate(() =>
      localStorage.setItem('lp_settings_v1', JSON.stringify({ theme: 'minecraft', language: 'en' })),
    );
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    await expect(page.getByTestId('theme-preview')).toContainText('Aquarelle');
    const stored = await page.evaluate(() => localStorage.getItem('lp_settings_v1'));
    // Reading settings normalizes the deprecated name; once the picker writes,
    // the persisted value is the valid aquarelle id.
    await page.getByTestId('theme-aquarelle-btn').click();
    const afterClick = await page.evaluate(() => JSON.parse(localStorage.getItem('lp_settings_v1')!));
    expect(afterClick.theme).toBe('aquarelle');
    expect(stored).toBeTruthy();
  });

  test('5. the light aquarelle theme renders no content panel', async ({ page }) => {
    // Light themes paint content directly on a light appBg; the panel must not
    // appear, so the layout stays unchanged for them.
    await page.goto('/');
    await page.evaluate(() =>
      localStorage.setItem('lp_settings_v1', JSON.stringify({ theme: 'aquarelle', language: 'en' })),
    );
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page.getByTestId('content-panel')).toHaveCount(0);
  });
});
