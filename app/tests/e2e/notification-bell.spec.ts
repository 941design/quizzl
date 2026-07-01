import { test, expect } from '@playwright/test';

/**
 * Notification bell e2e tests.
 *
 * The bell renders in both desktop and mobile nav. Tests target the
 * first visible instance (desktop at the default viewport).
 */

const FAKE_GROUP_ID = 'deadbeef01';
const FAKE_PEER_PUBKEY = 'a'.repeat(64);

/** Locate the first (desktop) notification bell button. */
function bellButton(page: import('@playwright/test').Page) {
  return page.getByRole('button', { name: 'Notifications' }).first();
}

/** Locate the first (desktop) notification badge. */
function badge(page: import('@playwright/test').Page) {
  return page.getByTestId('notification-badge').first();
}

async function waitForBridge(page: import('@playwright/test').Page) {
  await page.waitForFunction(
    () => !!(window as any).__fewUnread,
    null,
    { timeout: 10_000 },
  );
}

/**
 * Wait for the unread store's window bridge, then call incrementUnread.
 */
async function injectUnreadCount(
  page: import('@playwright/test').Page,
  groupId: string,
  count: number,
) {
  await waitForBridge(page);
  await page.evaluate(
    ({ gid, n }) => {
      const store = (window as any).__fewUnread;
      for (let i = 0; i < n; i++) store.incrementUnread(gid);
    },
    { gid: groupId, n: count },
  );
}

async function injectDirectMessageCount(
  page: import('@playwright/test').Page,
  peerPubkeyHex: string,
  count: number,
) {
  await waitForBridge(page);
  await page.evaluate(
    ({ peer, n }) => {
      const store = (window as any).__fewUnread;
      for (let i = 0; i < n; i++) store.incrementDirectMessage(peer);
    },
    { peer: peerPubkeyHex, n: count },
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

  test('bell shows badge when unread direct messages exist', async ({ page }) => {
    await page.goto('/');
    await injectDirectMessageCount(page, FAKE_PEER_PUBKEY, 2);

    await expect(badge(page)).toBeVisible();
    await expect(badge(page)).toHaveText('2');
  });

  test('badge sums groups + direct messages', async ({ page }) => {
    await page.goto('/');
    await injectUnreadCount(page, FAKE_GROUP_ID, 2);
    await injectDirectMessageCount(page, FAKE_PEER_PUBKEY, 3);

    await expect(badge(page)).toHaveText('5');
  });

  test('dropdown lists unread direct-message contact and clears on click', async ({ page }) => {
    await page.goto('/');
    await injectDirectMessageCount(page, FAKE_PEER_PUBKEY, 1);

    await bellButton(page).click();
    const dmEntry = page.getByTestId(`notification-dm-${FAKE_PEER_PUBKEY}`).first();
    await expect(dmEntry).toBeVisible({ timeout: 5_000 });
    await expect(dmEntry).toContainText('1 new direct message');

    await dmEntry.click();
    // After click the DM count should be cleared, so the badge is gone.
    await expect(page.getByTestId('notification-badge')).toHaveCount(0);
  });
});
