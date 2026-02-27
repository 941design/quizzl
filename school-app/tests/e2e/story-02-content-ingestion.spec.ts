import { test, expect } from '@playwright/test';

test.describe('Story 02 - Content Ingestion and Topic Selection', () => {
  test.beforeEach(async ({ page }) => {
    // Clear localStorage before each test
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.removeItem('lp_selectedTopics_v1');
    });
  });

  test('topics page shows all 3 bundled topics', async ({ page }) => {
    await page.goto('/topics');
    await expect(page.getByTestId('tab-all-topics')).toContainText('All Topics (3)');
    const allPanel = page.getByRole('tabpanel', { name: /all topics/i });
    await expect(allPanel.getByTestId('topic-card-javascript-basics')).toBeVisible();
    await expect(allPanel.getByTestId('topic-card-world-history')).toBeVisible();
    await expect(allPanel.getByTestId('topic-card-human-biology')).toBeVisible();
  });

  test('topics display title, description, and tags', async ({ page }) => {
    await page.goto('/topics');
    const allPanel = page.getByRole('tabpanel', { name: /all topics/i });
    const jsCard = allPanel.getByTestId('topic-card-javascript-basics');
    await expect(jsCard.getByRole('heading')).toContainText('JavaScript Basics');
    await expect(jsCard).toContainText('fundamentals of JavaScript');
  });

  test('user can select a topic and it appears in My Topics', async ({ page }) => {
    await page.goto('/topics');

    // Select JavaScript Basics
    const allPanel = page.getByRole('tabpanel', { name: /all topics/i });
    await allPanel.getByTestId('toggle-topic-javascript-basics').click();

    // Switch to My Topics tab
    await page.getByTestId('tab-my-topics').click();
    const myPanel = page.getByRole('tabpanel', { name: /my topics/i });

    // Should now show the selected topic
    await expect(myPanel.getByTestId('topic-card-javascript-basics')).toBeVisible();
  });

  test('topic selection persists after page refresh', async ({ page }) => {
    await page.goto('/topics');

    // Select a topic
    const allPanel = page.getByRole('tabpanel', { name: /all topics/i });
    await allPanel.getByTestId('toggle-topic-world-history').click();

    // Refresh page
    await page.reload();

    // Switch to My Topics
    await page.getByTestId('tab-my-topics').click();
    const myPanel = page.getByRole('tabpanel', { name: /my topics/i });

    // Topic should still be selected
    await expect(myPanel.getByTestId('topic-card-world-history')).toBeVisible();
  });

  test('deselecting a topic removes it from My Topics', async ({ page }) => {
    await page.goto('/topics');

    // Select a topic
    const allPanel = page.getByRole('tabpanel', { name: /all topics/i });
    await allPanel.getByTestId('toggle-topic-human-biology').click();

    // Verify it's in My Topics
    await page.getByTestId('tab-my-topics').click();
    const myPanel = page.getByRole('tabpanel', { name: /my topics/i });
    await expect(myPanel.getByTestId('topic-card-human-biology')).toBeVisible();

    // Deselect it from the My Topics panel
    await myPanel.getByTestId('toggle-topic-human-biology').click();

    // Should show empty state
    await expect(page.getByTestId('pick-topics-cta')).toBeVisible();
  });

  test('My Topics shows empty state CTA when no topics selected', async ({ page }) => {
    await page.goto('/topics');
    await page.getByTestId('tab-my-topics').click();

    // Should show CTA to pick topics
    await expect(page.getByTestId('pick-topics-cta')).toBeVisible();
  });
});
