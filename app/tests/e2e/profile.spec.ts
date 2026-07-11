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

  test('editing nickname and avatar auto-saves and updates the header immediately without reload', async ({ page }) => {
    await page.goto('/profile');
    await page.waitForLoadState('networkidle');

    // Nickname is persisted on every keystroke — the header reflects it with no
    // explicit save action.
    await page.getByTestId('profile-nickname-input').fill('Berry Hero');

    const headerChip = page.getByTestId('header-profile-chip');
    await expect(headerChip.getByTestId('profile-display-name')).toHaveText('Berry Hero');

    // Avatar is applied on selection.
    await page.getByTestId('choose-avatar-btn').click();
    await expect(page.getByTestId('avatar-browser-modal')).toBeVisible();

    // Clicking the card selects the avatar (there is no separate select button).
    const firstAvatarCard = page.locator('[data-testid^="avatar-card-"]').first();
    await firstAvatarCard.click();

    await expect(headerChip.getByTestId('profile-avatar-thumb').locator('img')).toBeVisible();
  });

  test('mobile header keeps the profile visible inside the navigation drawer', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/profile');
    await page.waitForLoadState('networkidle');

    await page.getByTestId('profile-nickname-input').fill('Pocket Pear');

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
