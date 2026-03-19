import { test, expect } from '@playwright/test';
import { injectIdentity, USER_A, computeTestKeypairs } from './helpers/auth-helpers';
import { clearAppState } from './helpers/clear-state';

/** Truncated npub format: "npub1abcdef0...12345678" */
const TRUNCATED_NPUB_PATTERN = /^npub1[a-z0-9]+\.\.\.[a-z0-9]+$/;

test.describe('Profile display name — prefer nickname, fall back to npub', () => {
  test.beforeAll(async () => {
    await computeTestKeypairs();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearAppState(page);
  });

  test('header shows truncated npub when no nickname is set', async ({ page }) => {
    await injectIdentity(page, USER_A);
    await page.reload();
    await page.waitForLoadState('networkidle');

    const displayName = page
      .getByTestId('header-profile-chip')
      .getByTestId('profile-display-name');
    await expect(displayName).toBeVisible();
    await expect(displayName).toHaveText(TRUNCATED_NPUB_PATTERN);
  });

  test('leaderboard shows truncated npub when no nickname is set', async ({ page }) => {
    await injectIdentity(page, USER_A);
    await page.reload();
    await page.goto('/leaderboard');
    await page.waitForLoadState('networkidle');

    const entry = page.getByTestId('leaderboard-entry-1');
    const displayName = entry.getByTestId('profile-display-name');
    await expect(displayName).toBeVisible();
    await expect(displayName).toHaveText(TRUNCATED_NPUB_PATTERN);
  });

  test('header shows short nickname when set', async ({ page }) => {
    await injectIdentity(page, USER_A);
    await page.evaluate(() => {
      localStorage.setItem(
        'lp_userProfile_v1',
        JSON.stringify({ nickname: 'Jo', avatar: null, badgeIds: [] }),
      );
    });
    await page.reload();
    await page.waitForLoadState('networkidle');

    const displayName = page
      .getByTestId('header-profile-chip')
      .getByTestId('profile-display-name');
    await expect(displayName).toHaveText('Jo');
  });

  test('leaderboard shows short nickname when set', async ({ page }) => {
    await injectIdentity(page, USER_A);
    await page.evaluate(() => {
      localStorage.setItem(
        'lp_userProfile_v1',
        JSON.stringify({ nickname: 'Jo', avatar: null, badgeIds: [] }),
      );
    });
    await page.reload();
    await page.goto('/leaderboard');
    await page.waitForLoadState('networkidle');

    const entry = page.getByTestId('leaderboard-entry-1');
    const displayName = entry.getByTestId('profile-display-name');
    await expect(displayName).toHaveText('Jo');
  });
});
