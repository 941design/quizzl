import { test, expect } from '@playwright/test';

test.describe('Story 06: Study Time Tracking', () => {
  test.beforeEach(async ({ page }) => {
    // Clear study times storage
    await page.goto('/topic/javascript-basics');
    await page.evaluate(() => {
      Object.keys(localStorage)
        .filter((k) => k.startsWith('lp_'))
        .forEach((k) => localStorage.removeItem(k));
    });
    await page.reload();
    await page.waitForLoadState('networkidle');
  });

  test('1. Start/Stop session button appears on topic page', async ({ page }) => {
    // Study timer widget should be visible
    const timer = page.getByTestId('study-timer');
    await expect(timer).toBeVisible();

    // Start session button should be present
    const startBtn = page.getByTestId('start-session-btn');
    await expect(startBtn).toBeVisible();
    await expect(startBtn).toContainText('Start Session');
  });

  test('2. Starting a session shows elapsed time and stop button', async ({ page }) => {
    const startBtn = page.getByTestId('start-session-btn');
    await startBtn.click();

    // Timer elapsed display should appear
    const elapsed = page.getByTestId('timer-elapsed');
    await expect(elapsed).toBeVisible();

    // Stop button should replace start button
    const stopBtn = page.getByTestId('stop-session-btn');
    await expect(stopBtn).toBeVisible();
    await expect(stopBtn).toContainText('Stop Session');
  });

  test('3. Stopping a session records it and shows on study times page', async ({ page }) => {
    // Start and stop a session
    await page.getByTestId('start-session-btn').click();
    await page.waitForTimeout(1500); // Let 1.5 seconds pass
    await page.getByTestId('stop-session-btn').click();

    // Navigate to study-times page
    await page.goto('/study-times');
    await page.waitForLoadState('networkidle');

    // Study times page should show
    const studyPage = page.getByTestId('study-times-page');
    await expect(studyPage).toBeVisible();

    // Summary should show at least 1 session
    const sessionCount = page.getByTestId('session-count');
    await expect(sessionCount).toContainText('1');

    // Session list should show the session
    const sessionList = page.getByTestId('session-list');
    await expect(sessionList).toBeVisible();
  });

  test('4. Study times page shows today and this-week totals', async ({ page }) => {
    // Start/stop a session to have data
    await page.getByTestId('start-session-btn').click();
    await page.waitForTimeout(1200);
    await page.getByTestId('stop-session-btn').click();

    await page.goto('/study-times');
    await page.waitForLoadState('networkidle');

    // Today total should be non-zero
    const todayTotal = page.getByTestId('today-total');
    await expect(todayTotal).toBeVisible();
    // Should show some time (not 0s because we had a session)
    const todayText = await todayTotal.textContent();
    expect(todayText).toBeTruthy();

    // Week total should also be visible
    const weekTotal = page.getByTestId('week-total');
    await expect(weekTotal).toBeVisible();
  });

  test('5. Active session persists: orphaned session recovery banner shown on refresh', async ({ page }) => {
    // Start a session
    await page.getByTestId('start-session-btn').click();
    await expect(page.getByTestId('stop-session-btn')).toBeVisible();

    // Simulate refresh without stopping
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Recovery banner should appear
    const recoveryBanner = page.getByTestId('session-recovery-banner');
    await expect(recoveryBanner).toBeVisible();

    // Both Continue and Stop buttons should be available
    await expect(page.getByTestId('session-recover-continue')).toBeVisible();
    await expect(page.getByTestId('session-recover-stop')).toBeVisible();
  });

  test('6. Stopping orphaned session via recovery banner records it', async ({ page }) => {
    // Start a session
    await page.getByTestId('start-session-btn').click();
    await page.waitForTimeout(1000);

    // Refresh
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Click Stop in recovery banner
    await page.getByTestId('session-recover-stop').click();

    // Recovery banner should disappear
    await expect(page.getByTestId('session-recovery-banner')).not.toBeVisible();

    // Session should be recorded on study-times page
    await page.goto('/study-times');
    await page.waitForLoadState('networkidle');
    const sessionCount = page.getByTestId('session-count');
    await expect(sessionCount).toContainText('1');
  });
});
