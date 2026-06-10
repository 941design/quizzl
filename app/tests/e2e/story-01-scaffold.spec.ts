import { test, expect } from '@playwright/test';

test.describe('Story 01 - Project Scaffold and Routing', () => {
  test('home page loads with correct title and navigation', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Quizzl/);
    await expect(page.getByRole('heading', { name: /Welcome to Quizzl/i })).toBeVisible();
    await expect(page.getByTestId('home-contacts-btn')).toBeVisible();
    await expect(page.getByTestId('home-groups-btn')).toBeVisible();
  });

  test('navigation links are present', async ({ page }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    const primaryNavList = nav.locator('ul').first();
    await expect(nav).toBeVisible();
    // The "Home" item was removed; the app name logo still links back home.
    await expect(primaryNavList.getByRole('link', { name: 'Home' })).toHaveCount(0);
    await expect(primaryNavList.getByRole('link', { name: 'Contacts' })).toBeVisible();
    await expect(primaryNavList.getByRole('link', { name: 'Groups' })).toBeVisible();
    // Learning-platform nav links (Topics/Leaderboard/Study Times) are gone.
    await expect(primaryNavList.getByRole('link', { name: 'Topics' })).toHaveCount(0);
    await expect(primaryNavList.getByRole('link', { name: 'Leaderboard' })).toHaveCount(0);
    await expect(primaryNavList.getByRole('link', { name: 'Study Times' })).toHaveCount(0);
    await expect(page.getByTestId('header-settings-link')).toBeVisible();
  });

  test('contacts page is accessible via navigation', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('navigation').getByRole('link', { name: 'Contacts' }).click();
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/contacts/);
  });

  test('groups page is accessible via navigation', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('navigation').getByRole('link', { name: 'Groups' }).click();
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/groups/);
  });

  test('settings page loads', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  });
});
