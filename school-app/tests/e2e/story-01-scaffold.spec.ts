import { test, expect } from '@playwright/test';

test.describe('Story 01 - Project Scaffold and Routing', () => {
  test('home page loads with correct title and navigation', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/GroupLearn/);
    await expect(page.getByRole('heading', { name: /Welcome to GroupLearn/i })).toBeVisible();
    await expect(page.getByTestId('browse-topics-btn')).toBeVisible();
  });

  test('navigation links are present', async ({ page }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(nav).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Topics' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Leaderboard' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Study Times' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Settings' })).toBeVisible();
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
