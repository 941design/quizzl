/**
 * E2E: DM walled garden — group member allowed (AC-TEST-5)
 *
 * Alice (USER_A) and Bob (USER_B) share a real MLS group created during the test.
 * Bob DMs Alice via `publishDirectMessage`. The walled garden gate must ALLOW
 * the message through because Bob is a group member.
 *
 * Assertions:
 *   a. Alice's notification bell counter increments (badge shows >= 1).
 *   b. The message renders in Alice's DM thread with Bob.
 *
 * This is the "gate is not too tight" regression guard — it proves the whitelist
 * gate allows legitimate members through, not just blocks strangers.
 *
 * Uses the two-context serial setup from groups-lifecycle.spec.ts:
 *   1. Both users boot on /groups/
 *   2. Alice creates a group
 *   3. Alice invites Bob by npub
 *   4. Bob receives the Welcome and joins (group appears in his list)
 *   5. Bob DMs Alice via publishDirectMessage
 *   6. Alice's bell increments and message renders
 *
 * Requires: make e2e-up (strfry relay at ws://localhost:7777).
 */

import { test, expect, BrowserContext, Page } from '@playwright/test';
import { USER_A, USER_B, computeTestKeypairs } from './helpers/auth-helpers';
import { clearAppState } from './helpers/clear-state';
import { suppressErrorOverlay, dismissErrorOverlay } from './helpers/dismiss-error-overlay';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3100';

async function waitForBridge(page: Page) {
  await page.waitForFunction(
    () => !!(window as any).__quizzlUnread,
    null,
    { timeout: 10_000 },
  );
}

/** Boot a user: inject identity, clear state, navigate to /groups/. */
async function bootUserOnGroups(
  browser: { newContext: (opts: object) => Promise<BrowserContext> },
  user: typeof USER_A,
  nickname: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL: BASE_URL });
  await suppressErrorOverlay(context);
  await context.addInitScript(
    ({ privateKeyHex, pubkeyHex, seedHex, nickname }) => {
      localStorage.setItem('lp_nostrIdentity_v1', JSON.stringify({ privateKeyHex, pubkeyHex, seedHex }));
      localStorage.setItem('lp_userProfile_v1', JSON.stringify({ nickname, avatar: null, badgeIds: [] }));
    },
    { privateKeyHex: user.privateKeyHex, pubkeyHex: user.pubkeyHex, seedHex: user.seedHex, nickname },
  );
  const page = await context.newPage();
  await page.goto('/');
  await clearAppState(page);
  await page.evaluate(
    ({ privateKeyHex, pubkeyHex, seedHex, nickname }) => {
      localStorage.setItem('lp_nostrIdentity_v1', JSON.stringify({ privateKeyHex, pubkeyHex, seedHex }));
      localStorage.setItem('lp_userProfile_v1', JSON.stringify({ nickname, avatar: null, badgeIds: [] }));
    },
    { privateKeyHex: user.privateKeyHex, pubkeyHex: user.pubkeyHex, seedHex: user.seedHex, nickname },
  );
  await page.reload();
  await page.goto('/groups/');
  await expect(
    page.getByTestId('groups-empty-state').or(page.getByTestId('groups-list')),
  ).toBeVisible({ timeout: 60_000 });
  return { context, page };
}

test.describe.serial('DM walled garden: group member allowed (AC-TEST-5)', () => {
  let aliceCtx: BrowserContext;
  let bobCtx: BrowserContext;
  let alicePage: Page;
  let bobPage: Page;

  test.beforeAll(async ({ browser }) => {
    await computeTestKeypairs();

    ({ context: aliceCtx, page: alicePage } = await bootUserOnGroups(browser, USER_A, 'Alice'));
    ({ context: bobCtx, page: bobPage } = await bootUserOnGroups(browser, USER_B, 'Bob'));
  });

  test.afterAll(async () => {
    await aliceCtx?.close();
    await bobCtx?.close();
  });

  test('Alice creates a group and invites Bob', async () => {
    await alicePage.getByTestId('create-group-btn').click();
    await expect(alicePage.getByTestId('create-group-modal-content')).toBeVisible();
    await alicePage.getByTestId('create-group-name-input').fill('Walled Garden Test Group');
    await alicePage.getByTestId('create-group-submit-btn').click();

    await expect(alicePage.getByText('Walled Garden Test Group')).toBeVisible({ timeout: 30_000 });
    await expect(alicePage.getByTestId('create-group-modal-content')).not.toBeVisible({ timeout: 10_000 });
    await dismissErrorOverlay(alicePage);
    await alicePage.waitForTimeout(3_000);

    // Open group detail and invite Bob
    await alicePage.locator('[data-testid^="group-card-"]', { hasText: 'Walled Garden Test Group' }).click();
    await expect(alicePage.getByTestId('group-detail-page')).toBeVisible({ timeout: 30_000 });

    await alicePage.getByTestId('invite-member-btn').click();
    await expect(alicePage.getByTestId('invite-member-modal-content')).toBeVisible();
    await alicePage.getByTestId('invite-npub-input').fill(USER_B.npub);
    await alicePage.getByTestId('invite-submit-btn').click();
    await expect(alicePage.getByTestId('invite-success')).toBeVisible({ timeout: 60_000 });
    await alicePage.waitForTimeout(3_000);
  });

  test('Bob receives Welcome and joins the group', async () => {
    // Bob waits for KeyPackage publication (automatic on MarmotContext init)
    await bobPage.waitForTimeout(5_000);

    await bobPage.goto('/groups/');
    await expect(
      bobPage.getByTestId('groups-empty-state').or(bobPage.getByTestId('groups-list')),
    ).toBeVisible({ timeout: 60_000 });

    // Wait for the group to appear (Welcome delivery can take time)
    await expect(bobPage.getByText('Walled Garden Test Group')).toBeVisible({ timeout: 90_000 });
  });

  test('Bob DMs Alice via publishDirectMessage; Alice bell increments and message renders', async () => {
    // Alice navigates to /contacts to mount the bell watcher
    await alicePage.goto('/contacts');
    await alicePage.waitForLoadState('networkidle');
    await waitForBridge(alicePage);

    // Record the CURRENT badge count as baseline — invite/Welcome events from the
    // prior test steps may have already created notifications. The assertion is that
    // the count INCREASES by at least 1 after Bob sends, not that it starts at 0.
    const initialBadgeCount = await alicePage.evaluate(() => {
      const badge = document.querySelector('[data-testid="notification-badge"]');
      if (!badge) return 0;
      return parseInt((badge.textContent ?? '0').trim(), 10);
    });

    // Bob publishes a DM to Alice via the app's __quizzlPublishDm bridge (dev only).
    // This avoids broken @/-alias dynamic imports from page.evaluate which fail in
    // the browser context — the bridge uses the page's already-loaded webpack bundle.
    const DM_CONTENT = `member-dm-${Date.now()}`;
    await bobPage.waitForFunction(
      () => typeof (window as any).__quizzlPublishDm === 'function',
      null,
      { timeout: 10_000 },
    );
    await bobPage.evaluate(
      async ({ alicePub, content }) => {
        await (window as any).__quizzlPublishDm(alicePub, content);
      },
      {
        alicePub: USER_A.pubkeyHex,
        content: DM_CONTENT,
      },
    );

    // Assertion (a): Alice's bell counter must increment above the baseline
    await alicePage.waitForFunction(
      (baseline) => {
        const badge = document.querySelector('[data-testid="notification-badge"]');
        if (!badge) return false;
        const count = parseInt((badge.textContent ?? '0').trim(), 10);
        return count > baseline;
      },
      initialBadgeCount,
      { timeout: 30_000 },
    );

    // Assertion (b): message renders in Alice's DM thread with Bob
    await alicePage.goto(`/contacts?id=${USER_B.pubkeyHex}`);
    await alicePage.waitForLoadState('networkidle');

    const bubble = alicePage.locator('[data-testid^="msg-"]').filter({ hasText: DM_CONTENT }).first();
    await expect(bubble).toBeVisible({ timeout: 30_000 });
  });
});
