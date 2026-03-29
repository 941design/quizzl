import { test, expect, BrowserContext, Page } from '@playwright/test';
import { USER_A, USER_B, computeTestKeypairs } from './helpers/auth-helpers';
import { clearAppState } from './helpers/clear-state';
import { dismissErrorOverlay, suppressErrorOverlay } from './helpers/dismiss-error-overlay';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3100';

/** Boot a user context: inject identity via init script, navigate to /groups/. */
async function bootUser(
  browser: { newContext: (opts: object) => Promise<BrowserContext> },
  user: typeof USER_A,
  opts?: { nickname?: string },
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL: BASE_URL });
  await suppressErrorOverlay(context);
  await context.addInitScript(({ privateKeyHex, pubkeyHex, seedHex, nickname }) => {
    localStorage.setItem('lp_nostrIdentity_v1', JSON.stringify({ privateKeyHex, pubkeyHex, seedHex }));
    if (nickname) {
      localStorage.setItem('lp_userProfile_v1', JSON.stringify({ nickname, avatar: null, badgeIds: [] }));
    }
  }, { privateKeyHex: user.privateKeyHex, pubkeyHex: user.pubkeyHex, seedHex: user.seedHex, nickname: opts?.nickname ?? '' });
  const page = await context.newPage();
  await page.goto('/');
  await clearAppState(page);
  await page.reload();
  await page.goto('/groups/');
  await expect(
    page.getByTestId('groups-empty-state').or(page.getByTestId('groups-list')),
  ).toBeVisible({ timeout: 60_000 });
  return { context, page };
}

/** Create a group from the given page. */
async function createGroup(page: Page, name: string): Promise<void> {
  await page.getByTestId('create-group-btn').click();
  await expect(page.getByTestId('create-group-modal-content')).toBeVisible();
  await page.getByTestId('create-group-name-input').fill(name);
  await page.getByTestId('create-group-submit-btn').click();
  await expect(page.getByText(name)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('create-group-modal-content')).not.toBeVisible({ timeout: 10_000 });
  await dismissErrorOverlay(page);
  await page.waitForTimeout(3_000);
}

/** Navigate to a group's detail page. */
async function openGroupDetail(page: Page, groupName: string): Promise<void> {
  await dismissErrorOverlay(page);
  await page.locator(`:has-text("${groupName}")`).getByRole('link', { name: 'Open' }).click();
  await expect(page.getByTestId('group-detail-page')).toBeVisible({ timeout: 30_000 });
}

// ---------------------------------------------------------------------------
// E2E: Full invite link flow — User A generates link, User B joins via link
// ---------------------------------------------------------------------------
test.describe.serial('Invite link flow — generate, join request, approve', () => {
  const GROUP_NAME = 'Invite Link Test Group';
  let ctxA: BrowserContext;
  let ctxB: BrowserContext;
  let pageA: Page;
  let pageB: Page;
  let inviteUrl = '';

  test.beforeAll(async ({ browser }) => {
    await computeTestKeypairs();
    ({ context: ctxA, page: pageA } = await bootUser(browser, USER_A, { nickname: 'Admin' }));
    ({ context: ctxB, page: pageB } = await bootUser(browser, USER_B, { nickname: 'Invitee' }));
  });

  test.afterAll(async () => {
    await ctxA?.close();
    await ctxB?.close();
  });

  test('User A creates a group', async () => {
    await createGroup(pageA, GROUP_NAME);
  });

  test('User A generates an invite link', async () => {
    await openGroupDetail(pageA, GROUP_NAME);
    await pageA.getByTestId('invite-link-btn').click();
    await expect(pageA.getByTestId('generate-invite-link-modal')).toBeVisible();

    // Read the generated URL from the modal
    const urlElement = pageA.getByTestId('invite-link-url');
    await expect(urlElement).toBeVisible();
    inviteUrl = (await urlElement.textContent()) ?? '';
    expect(inviteUrl).toContain('/groups?join=');
    expect(inviteUrl).toContain('&admin=');
    expect(inviteUrl).toContain('&name=');

    // Copy the link (persists the InviteLink to IDB)
    await pageA.getByTestId('invite-link-copy-btn').click();
    await pageA.waitForTimeout(1_000);

    // Close the modal
    await pageA.locator('[aria-label="Close"]').first().click();
    await expect(pageA.getByTestId('generate-invite-link-modal')).not.toBeVisible({ timeout: 5_000 });
  });

  test('User B opens the invite link and sends a join request', async () => {
    // Extract the path + query from the full URL
    const url = new URL(inviteUrl);
    const pathWithQuery = url.pathname + url.search;

    await pageB.goto(pathWithQuery);
    await dismissErrorOverlay(pageB);

    // Should see the JoinRequestCard
    await expect(pageB.getByTestId('join-request-card')).toBeVisible({ timeout: 30_000 });
    await expect(pageB.getByText(GROUP_NAME)).toBeVisible();

    // Click "Request to Join"
    await pageB.getByTestId('join-request-send-btn').click();

    // Should see success message
    await expect(pageB.getByTestId('join-request-sent')).toBeVisible({ timeout: 30_000 });
  });

  test('User A sees the pending join request', async () => {
    // Navigate to groups and reload to pick up the gift-wrapped join request
    await pageA.goto('/groups/');
    await expect(
      pageA.getByTestId('groups-empty-state').or(pageA.getByTestId('groups-list')),
    ).toBeVisible({ timeout: 60_000 });

    // Wait for the notification bell to show a badge
    await expect
      .poll(
        async () => {
          await dismissErrorOverlay(pageA);
          const badge = pageA.getByTestId('notification-badge');
          return badge.isVisible();
        },
        { timeout: 60_000, intervals: [3_000, 5_000, 5_000, 5_000, 5_000, 5_000, 5_000] },
      )
      .toBe(true);

    // Open the group detail
    await openGroupDetail(pageA, GROUP_NAME);

    // Should see the pending requests section
    await expect(pageA.getByTestId('pending-requests-section')).toBeVisible({ timeout: 30_000 });
  });

  test('User A approves the join request', async () => {
    await dismissErrorOverlay(pageA);

    // Click Approve on the first pending request
    await pageA.locator('[data-testid^="approve-request-"]').first().click();

    // Wait for the pending requests section to disappear (request was approved)
    await expect(pageA.getByTestId('pending-requests-section')).not.toBeVisible({ timeout: 60_000 });
  });

  test('User B receives the Welcome and sees the group', async () => {
    // Navigate User B to the groups list
    await pageB.goto('/groups/');
    await expect(
      pageB.getByTestId('groups-empty-state').or(pageB.getByTestId('groups-list')),
    ).toBeVisible({ timeout: 60_000 });

    // Wait for the group to appear
    await expect(pageB.getByText(GROUP_NAME)).toBeVisible({ timeout: 60_000 });

    // Open the group detail and verify membership
    await openGroupDetail(pageB, GROUP_NAME);
    await expect(pageB.getByTestId('group-detail-page')).toBeVisible({ timeout: 30_000 });
  });
});
