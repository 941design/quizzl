import { test, expect } from '@playwright/test';

const TOPIC_URL = '/topic/javascript-basics';

test.describe('Story 04 - Notes Editor', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.removeItem('lp_progress_v1');
    });
  });

  test('notes tab shows editor with toolbar', async ({ page }) => {
    await page.goto(TOPIC_URL);
    await page.getByTestId('tab-notes').click();

    await expect(page.getByTestId('notes-editor')).toBeVisible();
    await expect(page.getByTestId('editor-toolbar')).toBeVisible();
  });

  test('toolbar has formatting buttons with ARIA labels', async ({ page }) => {
    await page.goto(TOPIC_URL);
    await page.getByTestId('tab-notes').click();

    await expect(page.getByTestId('editor-toolbar').getByRole('button', { name: 'Bold' })).toBeVisible();
    await expect(page.getByTestId('editor-toolbar').getByRole('button', { name: 'Italic' })).toBeVisible();
    await expect(page.getByTestId('editor-toolbar').getByRole('button', { name: 'Heading 1' })).toBeVisible();
    await expect(page.getByTestId('editor-toolbar').getByRole('button', { name: 'Heading 2' })).toBeVisible();
    await expect(page.getByTestId('editor-toolbar').getByRole('button', { name: 'Bullet list' })).toBeVisible();
    await expect(page.getByTestId('editor-toolbar').getByRole('button', { name: 'Ordered list' })).toBeVisible();
  });

  test('user can type notes and see save status', async ({ page }) => {
    await page.goto(TOPIC_URL);
    await page.getByTestId('tab-notes').click();

    // Wait for editor to load (it's dynamically imported)
    await page.waitForSelector('[data-testid="editor-content"]', { timeout: 5000 });

    // Click inside editor and type
    await page.getByTestId('editor-content').click();
    await page.keyboard.type('My test notes content');

    // Save status should appear
    await expect(page.getByTestId('save-status')).toBeVisible();
  });

  test('notes persist after page refresh', async ({ page }) => {
    await page.goto(TOPIC_URL);
    await page.getByTestId('tab-notes').click();

    // Wait for editor
    await page.waitForSelector('[data-testid="editor-content"]', { timeout: 5000 });

    // Type some content
    await page.getByTestId('editor-content').click();
    await page.keyboard.type('Persistent notes text 12345');

    // Wait for debounced save (600ms)
    await page.waitForTimeout(1000);

    // Refresh page
    await page.reload();

    // Navigate back to notes tab
    await page.getByTestId('tab-notes').click();
    await page.waitForSelector('[data-testid="editor-content"]', { timeout: 5000 });

    // Content should still be there
    await expect(page.getByTestId('editor-content')).toContainText('Persistent notes text 12345');
  });

  test('notes are stored per-topic independently', async ({ page }) => {
    // Add notes to javascript-basics
    await page.goto(TOPIC_URL);
    await page.getByTestId('tab-notes').click();
    await page.waitForSelector('[data-testid="editor-content"]', { timeout: 5000 });
    await page.getByTestId('editor-content').click();
    await page.keyboard.type('JS Notes here');
    await page.waitForTimeout(1000);

    // Go to different topic
    await page.goto('/topic/world-history');
    await page.getByTestId('tab-notes').click();
    await page.waitForSelector('[data-testid="editor-content"]', { timeout: 5000 });

    // World history notes should be empty (not containing JS notes)
    await expect(page.getByTestId('editor-content')).not.toContainText('JS Notes here');
  });
});
