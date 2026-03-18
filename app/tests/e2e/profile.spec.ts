import { test, expect } from '@playwright/test';

test.describe('Profile updates', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      Object.keys(localStorage)
        .filter((key) => key.startsWith('lp_'))
        .forEach((key) => localStorage.removeItem(key));
    });
  });

  test('saving nickname and avatar updates the header immediately without reload', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    await page.getByTestId('profile-nickname-input').fill('Berry Hero');
    await page.getByTestId('choose-avatar-btn').click();
    await expect(page.getByTestId('avatar-browser-modal')).toBeVisible();

    const firstAvatarSelect = page.locator('[data-testid^="select-avatar-"]').first();
    await firstAvatarSelect.click();

    await page.getByTestId('save-profile-btn').click();

    const headerChip = page.getByTestId('header-profile-chip');
    await expect(headerChip.getByTestId('profile-display-name')).toHaveText('Berry Hero');
    await expect(headerChip.getByTestId('profile-avatar-thumb').locator('img')).toBeVisible();
  });

  test('leaderboard uses the saved nickname and avatar without requiring a reload', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    await page.getByTestId('profile-nickname-input').fill('Apple Ace');
    await page.getByTestId('choose-avatar-btn').click();
    await page.locator('[data-testid^="select-avatar-"]').first().click();
    await page.getByTestId('save-profile-btn').click();

    await page.getByRole('navigation').getByRole('link', { name: 'Leaderboard' }).click();
    await expect(page).toHaveURL(/\/leaderboard/);

    const leaderboardEntry = page.getByTestId('leaderboard-entry-1');
    await expect(leaderboardEntry.getByTestId('profile-display-name')).toHaveText('Apple Ace');
    await expect(leaderboardEntry.getByTestId('profile-avatar-thumb').locator('img')).toBeVisible();
  });

  test('mobile header keeps the profile visible inside the navigation drawer', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    await page.getByTestId('profile-nickname-input').fill('Pocket Pear');
    await page.getByTestId('save-profile-btn').click();

    await page.getByTestId('mobile-menu-btn').click();

    const mobileProfileChip = page.getByTestId('mobile-header-profile-chip');
    await expect(mobileProfileChip).toBeVisible();
    await expect(mobileProfileChip.getByTestId('profile-display-name')).toHaveText('Pocket Pear');
  });

  test('settings remain reachable from the header cogwheel', async ({ page }) => {
    await page.goto('/');

    await page.getByTestId('header-settings-link').click();
    await expect(page).toHaveURL(/\/settings/);
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  });
});
