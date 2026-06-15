import { test, expect } from '@playwright/test';
import { injectIdentity, USER_A, computeTestKeypairs } from './helpers/auth-helpers';
import { clearAppState } from './helpers/clear-state';

/** Truncated npub format: "npub1abcdef0...12345678" */
const TRUNCATED_NPUB_PATTERN = /^npub1[a-z0-9]+\.\.\.[a-z0-9]+$/;

test.describe('Profile display name — prefer nickname, prompt to set name', () => {
  test.beforeAll(async () => {
    await computeTestKeypairs();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearAppState(page);
  });

  test('header prompts to set a name (no npub) when no nickname is set', async ({ page }) => {
    await injectIdentity(page, USER_A);
    await page.reload();
    await page.waitForLoadState('networkidle');

    const displayName = page
      .getByTestId('header-profile-chip')
      .getByTestId('profile-display-name');
    await expect(displayName).toBeVisible();
    // Fresh user: a pulsing call-to-action, never the meaningless npub.
    await expect(displayName).toHaveAttribute('data-placeholder', 'true');
    await expect(displayName).not.toHaveText(TRUNCATED_NPUB_PATTERN);
  });

  test('header shows short nickname when set', async ({ page }) => {
    await injectIdentity(page, USER_A);
    await page.evaluate(() => {
      localStorage.setItem(
        'lp_userProfile_v1',
        JSON.stringify({ nickname: 'Jo', avatar: null }),
      );
    });
    await page.reload();
    await page.waitForLoadState('networkidle');

    const displayName = page
      .getByTestId('header-profile-chip')
      .getByTestId('profile-display-name');
    await expect(displayName).toHaveText('Jo');
  });
});
