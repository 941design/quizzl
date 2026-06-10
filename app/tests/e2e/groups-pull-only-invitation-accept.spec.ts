/**
 * E2E: Pull-only invitation accept flow (AC-TEST-5)
 *
 * Alice (USER_A) creates a group and invites Bob (USER_B) by npub.
 * Bob sees a pending invitation card on /groups/ (NOT a group card) and clicks Accept.
 * After accepting:
 *   a. Bob's groups list includes the group.
 *   b. Alice DMs Bob via publishDirectMessage.
 *   c. Bob's notification bell increments.
 *   d. The message renders in Bob's DM thread with Alice.
 *
 * No raw WebSocket relay writes — all publishes go through the app's bridges.
 *
 * Requires: make e2e-up (strfry relay at ws://localhost:7777).
 */

import { test, expect, BrowserContext, Page } from '@playwright/test';
import { USER_A, USER_B, computeTestKeypairs } from './helpers/auth-helpers';
import { clearAppState } from './helpers/clear-state';
import { suppressErrorOverlay, dismissErrorOverlay } from './helpers/dismiss-error-overlay';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3100';
const GROUP_NAME = 'Pull-Only Accept Test Group';

async function bootUser(
  browser: { newContext: (opts: object) => Promise<BrowserContext> },
  user: typeof USER_A,
  nickname: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL: BASE_URL });
  await suppressErrorOverlay(context);
  await context.addInitScript(
    ({ privateKeyHex, pubkeyHex, seedHex, nick }) => {
      localStorage.setItem('lp_nostrIdentity_v1', JSON.stringify({ privateKeyHex, pubkeyHex, seedHex }));
      localStorage.setItem('lp_userProfile_v1', JSON.stringify({ nickname: nick, avatar: null }));
    },
    { privateKeyHex: user.privateKeyHex, pubkeyHex: user.pubkeyHex, seedHex: user.seedHex, nick: nickname },
  );
  const page = await context.newPage();
  await page.goto('/');
  await clearAppState(page);
  await page.evaluate(
    ({ privateKeyHex, pubkeyHex, seedHex, nick }) => {
      localStorage.setItem('lp_nostrIdentity_v1', JSON.stringify({ privateKeyHex, pubkeyHex, seedHex }));
      localStorage.setItem('lp_userProfile_v1', JSON.stringify({ nickname: nick, avatar: null }));
    },
    { privateKeyHex: user.privateKeyHex, pubkeyHex: user.pubkeyHex, seedHex: user.seedHex, nick: nickname },
  );
  await page.reload();
  await page.goto('/groups/');
  await expect(
    page.getByTestId('groups-empty-state').or(page.getByTestId('groups-list')),
  ).toBeVisible({ timeout: 60_000 });
  return { context, page };
}

test.describe.serial('Pull-only invitation: Accept (AC-TEST-5)', () => {
  let aliceCtx: BrowserContext;
  let bobCtx: BrowserContext;
  let alicePage: Page;
  let bobPage: Page;

  test.beforeAll(async ({ browser }) => {
    await computeTestKeypairs();
    ({ context: aliceCtx, page: alicePage } = await bootUser(browser, USER_A, 'Alice'));
    ({ context: bobCtx, page: bobPage } = await bootUser(browser, USER_B, 'Bob'));
  });

  test.afterAll(async () => {
    await aliceCtx?.close();
    await bobCtx?.close();
  });

  test('Alice creates a group and invites Bob', async () => {
    // Walled Garden v2: warm up Bob's seen-set with stale wraps from prior
    // tests, then clear the queue so the fresh invite is the entry to accept.
    await bobPage.waitForTimeout(10_000);
    await bobPage.evaluate(() => {
      localStorage.removeItem('lp_pendingInvitations_v1');
    });

    await alicePage.getByTestId('create-group-btn').click();
    await expect(alicePage.getByTestId('create-group-modal-content')).toBeVisible();
    await alicePage.getByTestId('create-group-name-input').fill(GROUP_NAME);
    await alicePage.getByTestId('create-group-submit-btn').click();
    await expect(alicePage.getByText(GROUP_NAME)).toBeVisible({ timeout: 30_000 });
    await expect(alicePage.getByTestId('create-group-modal-content')).not.toBeVisible({ timeout: 10_000 });
    await dismissErrorOverlay(alicePage);
    await alicePage.waitForTimeout(3_000);

    await alicePage.locator('[data-testid^="group-card-"]', { hasText: GROUP_NAME }).click();
    await expect(alicePage.getByTestId('group-detail-page')).toBeVisible({ timeout: 30_000 });
    await alicePage.getByTestId('invite-member-btn').click();
    await alicePage.getByTestId('invite-npub-input').fill(USER_B.npub);
    await alicePage.getByTestId('invite-submit-btn').click();
    await expect(alicePage.getByTestId('invite-success')).toBeVisible({ timeout: 60_000 });
    await alicePage.waitForTimeout(3_000);
  });

  test('Bob sees a pending invitation (not a group card) and clicks Accept', async () => {
    // Bob waits for the Welcome to arrive over the relay
    await bobPage.waitForTimeout(5_000);
    await bobPage.goto('/groups/');

    // AC-TEST-5(b): Bob sees a pending invitation row (before the group appears)
    await expect(bobPage.getByTestId('pending-invitations-section')).toBeVisible({ timeout: 90_000 });
    const invitationRow = bobPage.locator('[data-testid^="pending-invitation-row-"]').last();
    await expect(invitationRow).toBeVisible({ timeout: 30_000 });

    // Confirm the group card is NOT yet visible (invitation not yet accepted)
    await expect(bobPage.locator('[data-testid^="group-card-"]', { hasText: GROUP_NAME })).toHaveCount(0);

    // AC-TEST-5(c): Bob clicks Accept (pick the most recent so we don't grab a
    // stale invitation from earlier specs in the same suite run).
    await bobPage.locator('[data-testid^="accept-invitation-"]').last().click();

    // AC-TEST-5(d): After accepting, the group appears in Bob's list
    await expect(bobPage.getByText(GROUP_NAME)).toBeVisible({ timeout: 90_000 });
  });

  test('Alice DMs Bob; Bob bell increments and message renders', async () => {
    // Bob navigates to /contacts so the bell watcher mounts
    await bobPage.goto('/contacts');
    await bobPage.waitForLoadState('networkidle');
    await bobPage.waitForFunction(
      () => !!(window as any).__nostlingUnread,
      null,
      { timeout: 15_000 },
    );

    const initialBadgeCount = await bobPage.evaluate(() => {
      const badge = document.querySelector('[data-testid="notification-badge"]');
      if (!badge) return 0;
      return parseInt((badge.textContent ?? '0').trim(), 10);
    });

    // AC-TEST-5(f): Alice DMs Bob via the app bridge (not raw WebSocket)
    const DM_CONTENT = `accept-test-dm-${Date.now()}`;
    await alicePage.waitForFunction(
      () => typeof (window as any).__nostlingPublishDm === 'function',
      null,
      { timeout: 15_000 },
    );
    await alicePage.evaluate(
      async ({ bobPub, content }) => {
        await (window as any).__nostlingPublishDm(bobPub, content);
      },
      { bobPub: USER_B.pubkeyHex, content: DM_CONTENT },
    );

    // AC-TEST-5(f): Bob's bell increments above the baseline
    await bobPage.waitForFunction(
      (baseline) => {
        const badge = document.querySelector('[data-testid="notification-badge"]');
        if (!badge) return false;
        return parseInt((badge.textContent ?? '0').trim(), 10) > baseline;
      },
      initialBadgeCount,
      { timeout: 60_000 },
    );

    // AC-TEST-5(f): message renders in Bob's DM thread with Alice
    await bobPage.goto(`/contacts?id=${USER_A.pubkeyHex}`);
    await bobPage.waitForLoadState('networkidle');
    const bubble = bobPage.locator('[data-testid^="msg-"]').filter({ hasText: DM_CONTENT }).first();
    await expect(bubble).toBeVisible({ timeout: 30_000 });
  });
});
