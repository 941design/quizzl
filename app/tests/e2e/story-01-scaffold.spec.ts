import { test, expect } from '@playwright/test';

test.describe('Story 01 - Project Scaffold and Routing', () => {
  test('home page loads with correct title and navigation', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Quizzl/);
    await expect(page.getByRole('heading', { name: /Welcome to Quizzl/i })).toBeVisible();
    await expect(page.getByTestId('browse-topics-btn')).toBeVisible();
  });

  test('navigation links are present', async ({ page }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    const primaryNavList = nav.locator('ul').first();
    await expect(nav).toBeVisible();
    await expect(primaryNavList.getByRole('link', { name: 'Topics' })).toBeVisible();
    await expect(primaryNavList.getByRole('link', { name: 'Leaderboard' })).toBeVisible();
    await expect(primaryNavList.getByRole('link', { name: 'Study Times' })).toBeVisible();
    await expect(primaryNavList.getByRole('link', { name: 'Settings' })).toHaveCount(0);
    await expect(page.getByTestId('header-settings-link')).toBeVisible();
  });

  test('topics page is accessible via navigation', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('navigation').getByRole('link', { name: 'Topics' }).click();
    await expect(page).toHaveURL(/\/topics/);
    await expect(page.getByRole('heading', { name: 'Topics' })).toBeVisible();
  });

  test('leaderboard page loads', async ({ page }) => {
    await page.goto('/leaderboard');
    await expect(page.getByRole('heading', { name: 'Leaderboard' })).toBeVisible();
  });

  test('study-times page loads', async ({ page }) => {
    await page.goto('/study-times');
    await expect(page.getByRole('heading', { name: /study times/i })).toBeVisible();
  });

  test('settings page loads', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  });
});
