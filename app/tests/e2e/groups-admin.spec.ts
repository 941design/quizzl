import { test, expect, BrowserContext, Page } from '@playwright/test';
import { USER_A, USER_B, USER_C, computeTestKeypairs } from './helpers/auth-helpers';
import { clearAppState } from './helpers/clear-state';
import { dismissErrorOverlay, suppressErrorOverlay } from './helpers/dismiss-error-overlay';
import { queryRelayForEvents } from './helpers/relay-query';

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

/** Wait for MarmotContext init and KeyPackage publication. */
async function waitForKeyPackages(page: Page, pubkeyHex: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const events = await queryRelayForEvents(page, {
          kinds: [443],
          authors: [pubkeyHex],
          limit: 1,
        });
        return events.length;
      },
      { timeout: 60_000, intervals: [3_000, 5_000, 5_000, 5_000, 5_000, 5_000, 5_000, 5_000] },
    )
    .toBeGreaterThanOrEqual(1);
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
  await page.locator(`[data-testid^="group-card-"]`, { hasText: groupName }).click();
  await expect(page.getByTestId('group-detail-page')).toBeVisible({ timeout: 30_000 });
}

/** Invite a user by npub from the group detail page. */
async function inviteMember(page: Page, npub: string): Promise<void> {
  await page.getByTestId('invite-member-btn').click();
  await expect(page.getByTestId('invite-member-modal-content')).toBeVisible();
  await page.getByTestId('invite-npub-input').fill(npub);
  await page.getByTestId('invite-submit-btn').click();
  await expect(page.getByTestId('invite-success')).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(3_000);
}

/** Wait for a group to appear in the groups list, then open its detail page. */
async function waitForGroupAndOpen(page: Page, groupName: string): Promise<void> {
  await page.goto('/groups/');
  await expect(
    page.getByTestId('groups-empty-state').or(page.getByTestId('groups-list')),
  ).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(groupName)).toBeVisible({ timeout: 60_000 });
  await openGroupDetail(page, groupName);
}

// ---------------------------------------------------------------------------
// Admin propagation: A creates, invites B (B becomes admin), B invites C
// ---------------------------------------------------------------------------
test.describe.serial('Admin propagation – every invited member becomes admin', () => {
  const GROUP_NAME = 'Admin Propagation Group';
  let ctxA: BrowserContext;
  let ctxB: BrowserContext;
  let ctxC: BrowserContext;
  let pageA: Page;
  let pageB: Page;
  let pageC: Page;

  test.beforeAll(async ({ browser }) => {
    await computeTestKeypairs();
    ({ context: ctxA, page: pageA } = await bootUser(browser, USER_A));
    ({ context: ctxB, page: pageB } = await bootUser(browser, USER_B));
    ({ context: ctxC, page: pageC } = await bootUser(browser, USER_C));
  });

  test.afterAll(async () => {
    await ctxA?.close();
    await ctxB?.close();
    await ctxC?.close();
  });

  test('User A creates a group', async () => {
    await createGroup(pageA, GROUP_NAME);
  });

  test('Users B and C publish KeyPackages', async () => {
    await waitForKeyPackages(pageB, USER_B.pubkeyHex);
    await waitForKeyPackages(pageC, USER_C.pubkeyHex);
  });

  test('User A sees invite button enabled (creator is admin)', async () => {
    await openGroupDetail(pageA, GROUP_NAME);
    const inviteBtn = pageA.getByTestId('invite-member-btn');
    await expect(inviteBtn).toBeVisible();
    await expect(inviteBtn).toBeEnabled({ timeout: 30_000 });
  });

  test('User A invites User B', async () => {
    await inviteMember(pageA, USER_B.npub);
  });

  test('User B joins and sees invite button enabled (promoted to admin)', async () => {
    await waitForGroupAndOpen(pageB, GROUP_NAME);
    // The invite button should be enabled because B was promoted to admin
    const inviteBtn = pageB.getByTestId('invite-member-btn');
    await expect(inviteBtn).toBeVisible();
    await expect(inviteBtn).toBeEnabled({ timeout: 30_000 });
  });

  test('User B invites User C (proving admin privileges)', async () => {
    await dismissErrorOverlay(pageB);
    await inviteMember(pageB, USER_C.npub);
  });

  test('User C joins and sees all 3 members', async () => {
    await waitForGroupAndOpen(pageC, GROUP_NAME);
    const memberA = `member-item-${USER_A.pubkeyHex.slice(0, 8)}`;
    const memberB = `member-item-${USER_B.pubkeyHex.slice(0, 8)}`;
    const memberC = `member-item-${USER_C.pubkeyHex.slice(0, 8)}`;
    await expect(pageC.getByTestId(memberA)).toBeVisible({ timeout: 30_000 });
    await expect(pageC.getByTestId(memberB)).toBeVisible({ timeout: 30_000 });
    await expect(pageC.getByTestId(memberC)).toBeVisible({ timeout: 30_000 });
  });

  test('User C also has invite button enabled (admin via B)', async () => {
    const inviteBtn = pageC.getByTestId('invite-member-btn');
    await expect(inviteBtn).toBeVisible();
    await expect(inviteBtn).toBeEnabled({ timeout: 30_000 });
  });
});
