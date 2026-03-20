import { test, expect, BrowserContext, Page } from '@playwright/test';
import { USER_A, USER_B, computeTestKeypairs } from './helpers/auth-helpers';
import { clearAppState } from './helpers/clear-state';
import { dismissErrorOverlay, suppressErrorOverlay } from './helpers/dismiss-error-overlay';

const BASE_URL = 'http://localhost:3100';

/** Boot a user with identity AND profile nickname pre-set in localStorage. */
async function bootUserWithProfile(
  browser: { newContext: (opts: object) => Promise<BrowserContext> },
  user: typeof USER_A,
  nickname: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL: BASE_URL });
  await suppressErrorOverlay(context);
  // Inject identity + profile via init script BEFORE any page JavaScript runs.
  await context.addInitScript(({ privateKeyHex, pubkeyHex, seedHex, nickname }) => {
    localStorage.setItem('lp_nostrIdentity_v1', JSON.stringify({ privateKeyHex, pubkeyHex, seedHex }));
    localStorage.setItem('lp_userProfile_v1', JSON.stringify({ nickname, avatar: null, badgeIds: [] }));
  }, { privateKeyHex: user.privateKeyHex, pubkeyHex: user.pubkeyHex, seedHex: user.seedHex, nickname });
  const page = await context.newPage();
  await page.goto('/');
  await clearAppState(page);
  // clearAppState removes lp_* keys — the init script re-injects on next navigation
  await page.reload();
  await page.goto('/groups/');
  await expect(
    page.getByTestId('groups-empty-state').or(page.getByTestId('groups-list')),
  ).toBeVisible({ timeout: 60_000 });
  return { context, page };
}

let contextA: BrowserContext;
let contextB: BrowserContext;
let pageA: Page;
let pageB: Page;

test.describe.serial('Group member profiles — names instead of npubs', () => {
  test.beforeAll(async ({ browser }) => {
    await computeTestKeypairs();
    ({ context: contextA, page: pageA } = await bootUserWithProfile(browser, USER_A, 'Alice'));
    ({ context: contextB, page: pageB } = await bootUserWithProfile(browser, USER_B, 'Bob'));
  });

  test.afterAll(async () => {
    await contextA?.close();
    await contextB?.close();
  });

  test('Own profile name is shown in group member list', async () => {
    // Create group
    await pageA.getByTestId('create-group-btn').click();
    await expect(pageA.getByTestId('create-group-modal-content')).toBeVisible();
    await pageA.getByTestId('create-group-name-input').fill('Profile Test Group');
    await pageA.getByTestId('create-group-submit-btn').click();
    await expect(pageA.getByText('Profile Test Group')).toBeVisible({ timeout: 30_000 });
    await expect(pageA.getByTestId('create-group-modal-content')).not.toBeVisible({ timeout: 10_000 });
    await dismissErrorOverlay(pageA);

    // Open group detail
    await pageA.locator(':has-text("Profile Test Group")').getByRole('link', { name: 'Open' }).click();
    await expect(pageA.getByTestId('group-detail-page')).toBeVisible({ timeout: 30_000 });

    // Verify own member entry shows nickname "Alice", not a truncated npub
    const ownPrefix = USER_A.pubkeyHex.slice(0, 8);
    await expect(pageA.getByTestId(`member-name-${ownPrefix}`)).toBeVisible({ timeout: 10_000 });
    await expect(pageA.getByTestId(`member-name-${ownPrefix}`)).toHaveText('Alice');
  });

  test('Invited member profile name is shown after join', async () => {
    // Wait for User B to publish KeyPackages
    await pageB.waitForTimeout(5_000);

    // Invite User B
    await dismissErrorOverlay(pageA);
    await pageA.getByTestId('invite-member-btn').click();
    await expect(pageA.getByTestId('invite-member-modal-content')).toBeVisible();
    await pageA.getByTestId('invite-npub-input').fill(USER_B.npub);
    await pageA.getByTestId('invite-submit-btn').click();
    await expect(pageA.getByTestId('invite-success')).toBeVisible({ timeout: 60_000 });

    // User B receives Welcome and joins
    await pageB.goto('/groups/');
    await expect(pageB.getByText('Profile Test Group')).toBeVisible({ timeout: 60_000 });

    // Wait for User B's profile to be published and User A to receive it
    await pageB.waitForTimeout(10_000);

    // User A navigates back to group detail to see updated member list
    await pageA.goto('/groups/');
    await pageA.locator(':has-text("Profile Test Group")').getByRole('link', { name: 'Open' }).click();
    await expect(pageA.getByTestId('group-detail-page')).toBeVisible({ timeout: 30_000 });

    // Verify User B's member entry shows "Bob"
    const bobPrefix = USER_B.pubkeyHex.slice(0, 8);
    await expect(pageA.getByTestId(`member-name-${bobPrefix}`)).toBeVisible({ timeout: 30_000 });
    await expect(pageA.getByTestId(`member-name-${bobPrefix}`)).toHaveText('Bob');
  });
});
