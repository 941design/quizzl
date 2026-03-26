import { test, expect } from '@playwright/test';

test.describe('Avatar selection', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      Object.keys(localStorage)
        .filter((key) => key.startsWith('lp_'))
        .forEach((key) => localStorage.removeItem(key));
    });
  });

  test('clicking an avatar card selects the avatar', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    await page.getByTestId('choose-avatar-btn').click();
    await expect(page.getByTestId('avatar-browser-modal')).toBeVisible();

    // Clicking the card (not the tiny button) should select the avatar
    const firstCard = page.locator('[data-testid^="avatar-card-"]').first();
    await firstCard.click();

    await expect(page.getByTestId('avatar-browser-modal')).not.toBeVisible();
    // Avatar preview should appear in settings
    await expect(page.locator('[data-testid="choose-avatar-btn"]')).toContainText(/Change/i);
  });

  test('clicking an avatar image selects the avatar', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    await page.getByTestId('choose-avatar-btn').click();
    await expect(page.getByTestId('avatar-browser-modal')).toBeVisible();

    // Clicking the image directly should also work
    const firstImage = page.locator('[data-testid^="avatar-card-"] img').first();
    await firstImage.click();

    await expect(page.getByTestId('avatar-browser-modal')).not.toBeVisible();
  });
});
