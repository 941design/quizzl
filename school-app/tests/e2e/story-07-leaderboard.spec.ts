import { test, expect } from '@playwright/test';

test.describe('Story 07: Leaderboard Page', () => {
  test.beforeEach(async ({ page }) => {
    // Clear all app data
    await page.goto('/');
    await page.evaluate(() => {
      Object.keys(localStorage)
        .filter((k) => k.startsWith('lp_'))
        .forEach((k) => localStorage.removeItem(k));
    });
  });

  test('1. Leaderboard page renders with empty state when no topics selected', async ({ page }) => {
    await page.goto('/leaderboard');
    await page.waitForLoadState('networkidle');

    const leaderboardPage = page.getByTestId('leaderboard-page');
    await expect(leaderboardPage).toBeVisible();

    // No-topics alert should be shown
    const noTopicsAlert = page.getByTestId('leaderboard-no-topics');
    await expect(noTopicsAlert).toBeVisible();
  });

  test('2. Leaderboard shows user entry with 0 points when topics selected but no quiz done', async ({ page }) => {
    // Select a topic first
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.setItem('lp_selectedTopics_v1', JSON.stringify({ slugs: ['javascript-basics'] }));
    });

    await page.goto('/leaderboard');
    await page.waitForLoadState('networkidle');

    // Entry should show
    const entry = page.getByTestId('leaderboard-entry-1');
    await expect(entry).toBeVisible();

    // Points should be 0
    const totalPoints = page.getByTestId('total-points');
    await expect(totalPoints).toContainText('0');

    // Rank should show 1/1
    const rankDisplay = page.getByTestId('rank-display');
    await expect(rankDisplay).toContainText('1');
  });

  test('3. Points aggregate from quiz answers on selected topics', async ({ page }) => {
    await page.goto('/');
    // Set up selected topics and some progress with points
    await page.evaluate(() => {
      localStorage.setItem('lp_selectedTopics_v1', JSON.stringify({
        slugs: ['javascript-basics', 'world-history']
      }));
      localStorage.setItem('lp_progress_v1', JSON.stringify({
        byTopicSlug: {
          'javascript-basics': { answers: {}, quizPoints: 5, notesHtml: '', completedTaskIds: [] },
          'world-history': { answers: {}, quizPoints: 3, notesHtml: '', completedTaskIds: [] },
        }
      }));
    });

    await page.goto('/leaderboard');
    await page.waitForLoadState('networkidle');

    // Total points should be 5 + 3 = 8
    const totalPoints = page.getByTestId('total-points');
    await expect(totalPoints).toContainText('8');

    // Leaderboard entry should show 8 points
    const entryPoints = page.getByTestId('entry-points-1');
    await expect(entryPoints).toContainText('8');
  });

  test('4. Topics selected count shows correctly', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.setItem('lp_selectedTopics_v1', JSON.stringify({
        slugs: ['javascript-basics', 'world-history', 'human-biology']
      }));
    });

    await page.goto('/leaderboard');
    await page.waitForLoadState('networkidle');

    const topicsSelected = page.getByTestId('topics-selected');
    await expect(topicsSelected).toContainText('3');
  });

  test('5. Streak display shows 0 when no study sessions', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.setItem('lp_selectedTopics_v1', JSON.stringify({ slugs: ['javascript-basics'] }));
    });

    await page.goto('/leaderboard');
    await page.waitForLoadState('networkidle');

    const streakDisplay = page.getByTestId('streak-display');
    await expect(streakDisplay).toContainText('0');
  });
});
