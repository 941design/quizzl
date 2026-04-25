import { test, expect } from '@playwright/test';
import { injectIdentity, USER_A, computeTestKeypairs } from './helpers/auth-helpers';
import { clearAppState } from './helpers/clear-state';
import { suppressErrorOverlay } from './helpers/dismiss-error-overlay';

test.describe('Groups Error Cases', () => {
  test.beforeEach(async ({ page, context }) => {
    await computeTestKeypairs();
    await suppressErrorOverlay(context);
    await page.goto('/');
    await clearAppState(page);
    await injectIdentity(page, USER_A);
    await page.reload();
    // Navigate to groups and wait for initialization
    await page.goto('/groups/');
    await expect(
      page.getByTestId('groups-empty-state').or(page.getByTestId('groups-list')),
    ).toBeVisible({ timeout: 60_000 });
  });

  test('Invite without KeyPackage shows error', async ({ page }) => {
    // Create a group first
    await page.getByTestId('create-group-btn').click();
    await expect(page.getByTestId('create-group-modal-content')).toBeVisible();
    await page.getByTestId('create-group-name-input').fill('Error Test Group');
    await page.getByTestId('create-group-submit-btn').click();
    await expect(page.getByText('Error Test Group')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('create-group-modal-content')).not.toBeVisible({ timeout: 10_000 });

    // Open group detail and try to invite a random npub (no KeyPackages on relay)
    await page.locator(`[data-testid^="group-card-"]`, { hasText: 'Error Test Group' }).click();
    await expect(page.getByTestId('group-detail-page')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('invite-member-btn').click();
    await expect(page.getByTestId('invite-member-modal-content')).toBeVisible();

    // Use a valid-format npub that has no KeyPackages
    await page.getByTestId('invite-npub-input').fill(
      'npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqsclkek',
    );
    await page.getByTestId('invite-submit-btn').click();

    await expect(page.getByTestId('invite-error')).toBeVisible({ timeout: 30_000 });
  });

  test('Invalid npub format shows error', async ({ page }) => {
    // Create a group
    await page.getByTestId('create-group-btn').click();
    await expect(page.getByTestId('create-group-modal-content')).toBeVisible();
    await page.getByTestId('create-group-name-input').fill('Invalid Npub Group');
    await page.getByTestId('create-group-submit-btn').click();
    await expect(page.getByText('Invalid Npub Group')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('create-group-modal-content')).not.toBeVisible({ timeout: 10_000 });

    await page.locator(`[data-testid^="group-card-"]`, { hasText: 'Invalid Npub Group' }).click();
    await expect(page.getByTestId('group-detail-page')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('invite-member-btn').click();
    await expect(page.getByTestId('invite-member-modal-content')).toBeVisible();

    await page.getByTestId('invite-npub-input').fill('not-a-valid-npub');
    await page.getByTestId('invite-submit-btn').click();

    await expect(page.getByTestId('invite-error')).toBeVisible({ timeout: 30_000 });
  });

  test('Offline indicator shown when network drops', async ({ page, context }) => {
    // Simulate going offline
    await context.setOffline(true);
    await page.evaluate(() => {
      window.dispatchEvent(new Event('offline'));
    });

    await expect(page.getByTestId('offline-banner')).toBeVisible({ timeout: 10_000 });

    // Restore
    await context.setOffline(false);
    await page.evaluate(() => {
      window.dispatchEvent(new Event('online'));
    });
  });
});
