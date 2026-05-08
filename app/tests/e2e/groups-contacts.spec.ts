import { test, expect, BrowserContext, Page } from '@playwright/test';
import { USER_A, USER_B, computeTestKeypairs } from './helpers/auth-helpers';
import { clearAppState } from './helpers/clear-state';
import { dismissErrorOverlay, suppressErrorOverlay } from './helpers/dismiss-error-overlay';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3100';

async function bootUserWithProfile(
  browser: { newContext: (opts: object) => Promise<BrowserContext> },
  user: typeof USER_A,
  nickname: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL: BASE_URL });
  await suppressErrorOverlay(context);
  await context.addInitScript(({ privateKeyHex, pubkeyHex, seedHex, nickname }) => {
    localStorage.setItem('lp_nostrIdentity_v1', JSON.stringify({ privateKeyHex, pubkeyHex, seedHex }));
    localStorage.setItem('lp_userProfile_v1', JSON.stringify({ nickname, avatar: null, badgeIds: [] }));
  }, { privateKeyHex: user.privateKeyHex, pubkeyHex: user.pubkeyHex, seedHex: user.seedHex, nickname });
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

test.describe.serial('Contacts and direct chat', () => {
  let contextA: BrowserContext;
  let contextB: BrowserContext;
  let pageA: Page;
  let pageB: Page;

  test.beforeAll(async ({ browser }) => {
    await computeTestKeypairs();
    ({ context: contextA, page: pageA } = await bootUserWithProfile(browser, USER_A, 'Alice'));
    ({ context: contextB, page: pageB } = await bootUserWithProfile(browser, USER_B, 'Bob'));
  });

  test.afterAll(async () => {
    await contextA?.close();
    await contextB?.close();
  });

  test('contacts are discovered from shared groups, survive leave, and support direct chat', async () => {
    await pageA.getByTestId('create-group-btn').click();
    await expect(pageA.getByTestId('create-group-modal-content')).toBeVisible();
    await pageA.getByTestId('create-group-name-input').fill('Contacts Test Group');
    await pageA.getByTestId('create-group-submit-btn').click();
    await expect(pageA.getByText('Contacts Test Group')).toBeVisible({ timeout: 30_000 });

    await pageB.waitForTimeout(5_000);

    await pageA.locator('[data-testid^="group-card-"]', { hasText: 'Contacts Test Group' }).click();
    await expect(pageA.getByTestId('group-detail-page')).toBeVisible({ timeout: 30_000 });
    await pageA.getByTestId('invite-member-btn').click();
    await pageA.getByTestId('invite-npub-input').fill(USER_B.npub);
    await pageA.getByTestId('invite-submit-btn').click();
    await expect(pageA.getByTestId('invite-success')).toBeVisible({ timeout: 60_000 });

    await pageB.goto('/groups/');
    await expect(pageB.getByText('Contacts Test Group')).toBeVisible({ timeout: 60_000 });
    await pageB.locator('[data-testid^="group-card-"]', { hasText: 'Contacts Test Group' }).click();
    await expect(pageB.getByTestId('group-detail-page')).toBeVisible({ timeout: 30_000 });

    await pageA.waitForTimeout(10_000);
    await dismissErrorOverlay(pageA);
    await dismissErrorOverlay(pageB);

    await pageA.goto('/contacts/');
    await expect(pageA.getByTestId('contacts-list')).toBeVisible({ timeout: 30_000 });
    await expect(pageA.getByTestId(`contact-card-${USER_B.pubkeyHex}`)).toContainText('Bob');

    await pageA.goto('/groups/');
    await pageA.locator('[data-testid^="group-card-"]', { hasText: 'Contacts Test Group' }).click();
    await expect(pageA.getByTestId('group-detail-page')).toBeVisible({ timeout: 30_000 });
    await pageA.getByTestId('leave-group-btn').click();
    await pageA.getByTestId('leave-group-confirm-btn').click();
    await expect(pageA.getByTestId('groups-empty-state')).toBeVisible({ timeout: 30_000 });

    await pageA.goto('/contacts/');
    await expect(pageA.getByTestId(`contact-card-${USER_B.pubkeyHex}`)).toContainText('Bob');
    await pageA.getByTestId(`contact-card-${USER_B.pubkeyHex}`).click();
    await expect(pageA.getByTestId('contact-detail-page')).toBeVisible({ timeout: 30_000 });
    await pageA.getByTestId('contact-detail-archive').click();
    await expect(pageA.getByTestId('contact-archived-alert')).toBeVisible();
    await pageA.goto('/contacts/');
    await expect(pageA.getByTestId(`contact-card-${USER_B.pubkeyHex}`)).toHaveCount(0);
    await expect(pageA.getByTestId('contacts-hidden-state')).toContainText('1');
    await pageA.getByTestId('contacts-filter-show-hidden').click();
    await expect(pageA.getByTestId(`contact-card-${USER_B.pubkeyHex}`)).toContainText('Bob');
    await pageA.getByTestId(`contact-card-${USER_B.pubkeyHex}`).click();
    await expect(pageA.getByTestId('contact-detail-page')).toBeVisible({ timeout: 30_000 });
    await pageA.getByTestId('contact-detail-unarchive').click();
    await expect(pageA.getByTestId('contact-archived-alert')).toHaveCount(0);
    await expect(pageA.getByRole('heading', { name: 'Bob' })).toBeVisible();

    await pageB.goto('/contacts/');
    await expect(pageB.getByTestId(`contact-card-${USER_A.pubkeyHex}`)).toContainText('Alice');
    await pageB.getByTestId(`contact-card-${USER_A.pubkeyHex}`).click();
    await expect(pageB.getByTestId('contact-detail-page')).toBeVisible({ timeout: 30_000 });

    await pageA.getByTestId('chat-input').fill('Hi Bob, from contacts');
    await pageA.getByTestId('chat-send-btn').click();
    await expect(pageB.locator('[data-testid^="msg-"]', { hasText: 'Hi Bob, from contacts' }).first()).toBeVisible({ timeout: 60_000 });
  });
});
