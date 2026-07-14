import { test, expect } from '@playwright/test';

test.describe('Info page - How few.chat works', () => {
  test('reachable via the header info icon', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('header-info-link').click();
    await expect(page).toHaveURL(/\/info/);
    await expect(page.getByRole('heading', { name: /How few\.chat works/i })).toBeVisible();
  });

  test('reachable via the home page card', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('home-info-btn').click();
    await expect(page).toHaveURL(/\/info/);
    await expect(page.getByTestId('info-page')).toBeVisible();
  });

  test('shows the plain-language sections', async ({ page }) => {
    await page.goto('/info');
    const info = page.getByTestId('info-page');
    await expect(info.getByRole('heading', { name: 'No Account Required' })).toBeVisible();
    await expect(info.getByRole('heading', { name: 'Your messages are private' })).toBeVisible();
    await expect(info).toContainText(/end-to-end encrypted/i);
    await expect(info.getByRole('heading', { name: 'Free' })).toBeVisible();
  });
});
