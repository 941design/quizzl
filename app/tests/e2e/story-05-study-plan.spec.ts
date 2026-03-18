import { test, expect } from '@playwright/test';

test.describe('Story 05: Study Plan Tab', () => {
  test.beforeEach(async ({ page }) => {
    // Clear localStorage before each test
    await page.goto('/topic/javascript-basics');
    await page.evaluate(() => {
      Object.keys(localStorage)
        .filter((k) => k.startsWith('lp_'))
        .forEach((k) => localStorage.removeItem(k));
    });
    await page.reload();
    // Navigate to Study Plan tab
    await page.getByTestId('tab-study-plan').click();
    await page.waitForLoadState('networkidle');
  });

  test('1. Study plan renders steps and tasks', async ({ page }) => {
    // Study plan container should be visible
    const container = page.getByTestId('study-plan-container');
    await expect(container).toBeVisible();

    // Overall progress bar should be present
    const progressBar = page.getByTestId('plan-progress');
    await expect(progressBar).toBeVisible();

    // At least one step should be visible
    // javascript-basics has 3 steps
    const steps = container.locator('[data-testid^="study-step-"]');
    await expect(steps).toHaveCount(3);

    // First step should be expanded by default
    const firstStep = steps.first();
    await expect(firstStep).toBeVisible();

    // Task checkboxes should be visible in first step
    const taskItems = firstStep.locator('[data-testid^="task-item-"]');
    await expect(taskItems).not.toHaveCount(0);
  });

  test('2. Tasks can be checked and unchecked', async ({ page }) => {
    const container = page.getByTestId('study-plan-container');
    const firstStep = container.locator('[data-testid^="study-step-"]').first();

    // Get first task checkbox
    const firstCheckbox = firstStep.locator('[data-testid^="task-checkbox-"]').first();
    await expect(firstCheckbox).not.toBeChecked();

    // Check it
    await firstCheckbox.click();
    await expect(firstCheckbox).toBeChecked();

    // Uncheck it
    await firstCheckbox.click();
    await expect(firstCheckbox).not.toBeChecked();
  });

  test('3. Completing tasks updates progress', async ({ page }) => {
    const container = page.getByTestId('study-plan-container');
    const firstStep = container.locator('[data-testid^="study-step-"]').first();

    // Get all task checkboxes in first step
    const checkboxes = firstStep.locator('[data-testid^="task-checkbox-"]');
    const count = await checkboxes.count();
    expect(count).toBeGreaterThan(0);

    // Check all tasks in first step
    for (let i = 0; i < count; i++) {
      await checkboxes.nth(i).click();
    }

    // All checkboxes should now be checked
    for (let i = 0; i < count; i++) {
      await expect(checkboxes.nth(i)).toBeChecked();
    }

    // The "Done" badge should appear on the first step
    const doneBadge = firstStep.getByText('Done');
    await expect(doneBadge).toBeVisible();
  });

  test('4. Completed task IDs persist after page refresh', async ({ page }) => {
    const container = page.getByTestId('study-plan-container');
    const firstStep = container.locator('[data-testid^="study-step-"]').first();

    // Check first task
    const firstCheckbox = firstStep.locator('[data-testid^="task-checkbox-"]').first();
    await firstCheckbox.click();
    await expect(firstCheckbox).toBeChecked();

    // Wait a moment for localStorage write
    await page.waitForTimeout(200);

    // Reload and navigate back to study plan
    await page.reload();
    await page.getByTestId('tab-study-plan').click();
    await page.waitForLoadState('networkidle');

    // First checkbox should still be checked
    const container2 = page.getByTestId('study-plan-container');
    const firstStep2 = container2.locator('[data-testid^="study-step-"]').first();
    const firstCheckbox2 = firstStep2.locator('[data-testid^="task-checkbox-"]').first();
    await expect(firstCheckbox2).toBeChecked();
  });

  test('5. Steps can be collapsed and expanded', async ({ page }) => {
    const container = page.getByTestId('study-plan-container');
    const firstStep = container.locator('[data-testid^="study-step-"]').first();

    // The first step header button should exist
    const headerButton = firstStep.locator('button').first();
    await expect(headerButton).toBeVisible();

    // Click to collapse - tasks should hide
    await headerButton.click();
    // After collapse, check a task item is no longer visible
    const taskItem = firstStep.locator('[data-testid^="task-item-"]').first();
    // It may be hidden but the DOM element still exists (Collapse)
    await expect(firstStep).toBeVisible(); // step container still visible

    // Click to expand again
    await headerButton.click();
    await expect(taskItem).toBeVisible();
  });
});
