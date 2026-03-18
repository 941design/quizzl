import { test, expect } from '@playwright/test';

test.describe('Story 08: Theme Settings + Reset', () => {
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

  test('4. Reset button shows confirmation modal', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    // Click reset button
    await page.getByTestId('reset-data-btn').click();

    // Modal should appear
    const modalContent = page.getByTestId('reset-modal-content');
    await expect(modalContent).toBeVisible();

    // Both buttons present
    await expect(page.getByTestId('reset-cancel-btn')).toBeVisible();
    await expect(page.getByTestId('reset-confirm-btn')).toBeVisible();
  });

  test('5. Cancelling reset modal closes it without resetting', async ({ page }) => {
    // Set up some data
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.setItem('lp_selectedTopics_v1', JSON.stringify({ slugs: ['javascript-basics'] }));
    });

    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    // Open modal and cancel
    await page.getByTestId('reset-data-btn').click();
    await page.getByTestId('reset-cancel-btn').click();

    // Modal should be gone
    const modalContent = page.getByTestId('reset-modal-content');
    await expect(modalContent).not.toBeVisible();

    // Data should still exist
    const stored = await page.evaluate(() => localStorage.getItem('lp_selectedTopics_v1'));
    expect(stored).toBeTruthy();
  });

  test('6. Confirming reset clears ALL lp_ localStorage keys and shows success (AC-016)', async ({ page }) => {
    // Set up data in all 4 lp_* keys
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.setItem('lp_settings_v1', JSON.stringify({ theme: 'playful' }));
      localStorage.setItem('lp_selectedTopics_v1', JSON.stringify({ slugs: ['javascript-basics'] }));
      localStorage.setItem('lp_progress_v1', JSON.stringify({ byTopicSlug: { 'javascript-basics': { quizPoints: 5 } } }));
      localStorage.setItem('lp_studyTimes_v1', JSON.stringify({ sessions: [{ id: 's1' }] }));
    });

    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    // Confirm reset
    await page.getByTestId('reset-data-btn').click();
    await page.getByTestId('reset-confirm-btn').click();

    // Success banner should appear
    const successBanner = page.getByTestId('reset-success-banner');
    await expect(successBanner).toBeVisible();

    // ALL lp_* keys should be gone
    const remaining = await page.evaluate(() => {
      return {
        settings: localStorage.getItem('lp_settings_v1'),
        selectedTopics: localStorage.getItem('lp_selectedTopics_v1'),
        progress: localStorage.getItem('lp_progress_v1'),
        studyTimes: localStorage.getItem('lp_studyTimes_v1'),
      };
    });
    expect(remaining.settings).toBeNull();
    expect(remaining.selectedTopics).toBeNull();
    expect(remaining.progress).toBeNull();
    expect(remaining.studyTimes).toBeNull();
  });
});
