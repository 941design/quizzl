import { test, expect } from '@playwright/test';

/**
 * Notification bell e2e tests.
 *
 * The bell renders in both desktop and mobile nav. Tests target the
 * first visible instance (desktop at the default viewport).
 */

const FAKE_GROUP_ID = 'deadbeef01';

/** Locate the first (desktop) notification bell button. */
function bellButton(page: import('@playwright/test').Page) {
  return page.getByRole('button', { name: 'Notifications' }).first();
}

/** Locate the first (desktop) notification badge. */
function badge(page: import('@playwright/test').Page) {
  return page.getByTestId('notification-badge').first();
}

/**
 * Wait for the unread store's window bridge, then call incrementUnread.
 */
async function injectUnreadCount(
  page: import('@playwright/test').Page,
  groupId: string,
  count: number,
) {
  await page.waitForFunction(
    () => !!(window as any).__quizzlUnread,
    null,
    { timeout: 10_000 },
  );
  await page.evaluate(
    ({ gid, n }) => {
      const store = (window as any).__quizzlUnread;
      for (let i = 0; i < n; i++) store.incrementUnread(gid);
    },
    { gid: groupId, n: count },
  );
}

test.describe('Notification Bell', () => {
  test('bell icon is visible in the navigation', async ({ page }) => {
    await page.goto('/');
    await expect(bellButton(page)).toBeVisible();
  });

  test('bell has no badge when there are no unread messages', async ({ page }) => {
    await page.goto('/');
    await expect(bellButton(page)).toBeVisible();
    await expect(page.getByTestId('notification-badge')).toHaveCount(0);
  });

  test('clicking bell opens dropdown with empty state', async ({ page }) => {
    await page.goto('/');
    await bellButton(page).click();
    // Chakra Popover animates open — allow time for the transition
    await expect(page.getByText('No new messages').first()).toBeVisible({
      timeout: 5_000,
    });
  });

  test('bell shows badge when unread messages exist', async ({ page }) => {
    await page.goto('/');
    await injectUnreadCount(page, FAKE_GROUP_ID, 3);

    await expect(badge(page)).toBeVisible();
    await expect(badge(page)).toHaveText('3');
  });

  test('badge updates reactively when new messages arrive', async ({ page }) => {
    await page.goto('/');
    await injectUnreadCount(page, FAKE_GROUP_ID, 2);
    await expect(badge(page)).toHaveText('2');

    await injectUnreadCount(page, FAKE_GROUP_ID, 1);
    await expect(badge(page)).toHaveText('3');
  });

  test('badge shows 99+ for large counts', async ({ page }) => {
    await page.goto('/');
    await injectUnreadCount(page, FAKE_GROUP_ID, 150);

    await expect(badge(page)).toBeVisible();
    await expect(badge(page)).toHaveText('99+');
  });
});
