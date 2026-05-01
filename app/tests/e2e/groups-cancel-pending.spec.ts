// E2E: Cancel pending invitation flow.
//
// USER_B is the phantom invitee: briefly booted to publish a KeyPackage on the
// relay, then closed. USER_A invites B's npub, sees the pending badge, and
// cancels. The test asserts:
//   AC-CPI-22: B's row disappears from A's member list after cancel
//   AC-CPI-23: An InviteCancelledChatAnnouncement row appears in chat
//   AC-CPI-24: A can still send a chat message (group not blocked)

import { test, expect, BrowserContext, Page } from '@playwright/test';
import { USER_A, USER_B, computeTestKeypairs } from './helpers/auth-helpers';
import { clearAppState } from './helpers/clear-state';
import { dismissErrorOverlay, suppressErrorOverlay } from './helpers/dismiss-error-overlay';
import { queryRelayForEvents } from './helpers/relay-query';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3100';
const GROUP_NAME = 'Cancel Pending E2E';

async function bootUser(
  browser: { newContext: (opts: object) => Promise<BrowserContext> },
  user: typeof USER_A,
  nickname: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL: BASE_URL });
  await suppressErrorOverlay(context);
  await context.addInitScript(
    ({ privateKeyHex, pubkeyHex, seedHex, nickname }) => {
      localStorage.setItem('lp_nostrIdentity_v1', JSON.stringify({ privateKeyHex, pubkeyHex, seedHex }));
      if (!localStorage.getItem('lp_userProfile_v1')) {
        localStorage.setItem('lp_userProfile_v1', JSON.stringify({ nickname, avatar: null, badgeIds: [] }));
      }
    },
    { privateKeyHex: user.privateKeyHex, pubkeyHex: user.pubkeyHex, seedHex: user.seedHex, nickname },
  );
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

/** Wait for the user's KeyPackage to appear on the relay (kind 443 or 30443). */
async function waitForKeyPackage(page: Page, pubkeyHex: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const events = await queryRelayForEvents(page, { kinds: [443, 30443], authors: [pubkeyHex], limit: 1 });
        return events.length;
      },
      { timeout: 60_000, intervals: [3_000, 5_000, 5_000, 5_000, 5_000, 5_000, 5_000, 5_000] },
    )
    .toBeGreaterThanOrEqual(1);
}

test.describe.serial('Cancel pending invitation', () => {
  let ctxA: BrowserContext;
  let ctxB: BrowserContext;
  let pgA: Page;
  let pgB: Page;

  test.beforeAll(async ({ browser }) => {
    await computeTestKeypairs();
    ({ context: ctxA, page: pgA } = await bootUser(browser, USER_A, 'Alice'));
    ({ context: ctxB, page: pgB } = await bootUser(browser, USER_B, 'Bob'));
  });

  test.afterAll(async () => {
    await ctxA?.close();
    await ctxB?.close();
  });

  test('USER_A creates a group', async () => {
    await pgA.getByTestId('create-group-btn').click();
    await expect(pgA.getByTestId('create-group-modal-content')).toBeVisible();
    await pgA.getByTestId('create-group-name-input').fill(GROUP_NAME);
    await pgA.getByTestId('create-group-submit-btn').click();
    await expect(pgA.getByText(GROUP_NAME)).toBeVisible({ timeout: 30_000 });
    await expect(pgA.getByTestId('create-group-modal-content')).not.toBeVisible({ timeout: 10_000 });
    await dismissErrorOverlay(pgA);
    await pgA.waitForTimeout(3_000);
  });

  test('USER_B publishes a KeyPackage (briefly booted, then context closed)', async () => {
    // B just needs to publish its KP — A will read it from the relay when inviting.
    // B's context is closed before A cancels so B is offline during the cancel.
    await waitForKeyPackage(pgB, USER_B.pubkeyHex);
    await ctxB.close();
  });

  test('USER_A opens the group and invites USER_B by npub', async () => {
    await pgA.goto('/groups/');
    await pgA.locator(`[data-testid^="group-card-"]`, { hasText: GROUP_NAME }).click();
    await expect(pgA.getByTestId('group-detail-page')).toBeVisible({ timeout: 30_000 });
    await dismissErrorOverlay(pgA);

    await pgA.getByTestId('invite-member-btn').click();
    await expect(pgA.getByTestId('invite-member-modal-content')).toBeVisible();
    await pgA.getByTestId('invite-npub-input').fill(USER_B.npub);
    await pgA.getByTestId('invite-submit-btn').click();
    await expect(pgA.getByTestId('invite-success')).toBeVisible({ timeout: 60_000 });
    await pgA.keyboard.press('Escape');
    // Wait for MLS commit to propagate
    await pgA.waitForTimeout(3_000);
  });

  test('USER_B row shows pending badge', async () => {
    // Reload the group detail so the member list reflects the committed state
    await pgA.goto('/groups/');
    await pgA.locator(`[data-testid^="group-card-"]`, { hasText: GROUP_NAME }).click();
    await expect(pgA.getByTestId('group-detail-page')).toBeVisible({ timeout: 30_000 });
    await dismissErrorOverlay(pgA);

    const bPkPrefix = USER_B.pubkeyHex.slice(0, 8);
    await expect(pgA.getByTestId(`member-pending-${bPkPrefix}`)).toBeVisible({ timeout: 30_000 });
    await expect(pgA.getByTestId(`cancel-invite-${bPkPrefix}`)).toBeVisible({ timeout: 10_000 });
  });

  test('USER_A cancels the pending invitation', async () => {
    const bPkPrefix = USER_B.pubkeyHex.slice(0, 8);
    await pgA.getByTestId(`cancel-invite-${bPkPrefix}`).click();
    // Modal should appear
    await expect(pgA.getByTestId(`cancel-invite-confirm-${bPkPrefix}`)).toBeVisible({ timeout: 10_000 });
    await pgA.getByTestId(`cancel-invite-confirm-${bPkPrefix}`).click();
    // Wait for the modal to close — confirms the async cancel handler completed
    await expect(pgA.getByTestId(`cancel-invite-confirm-${bPkPrefix}`)).not.toBeVisible({ timeout: 30_000 });
  });

  // AC-CPI-22: USER_B's row is absent from the member list after cancel
  test('USER_B row is absent from member list after cancel', async () => {
    const bPkPrefix = USER_B.pubkeyHex.slice(0, 8);
    // Navigate away and back to force a fresh load from the updated IDB state.
    // The modal-close wait in the cancel test ensures persistGroup+reloadGroups
    // completed before this navigation begins.
    await pgA.goto('/groups/');
    await pgA.locator(`[data-testid^="group-card-"]`, { hasText: GROUP_NAME }).click();
    await expect(pgA.getByTestId('group-detail-page')).toBeVisible({ timeout: 30_000 });
    await dismissErrorOverlay(pgA);
    await expect(pgA.getByTestId(`member-item-${bPkPrefix}`)).toHaveCount(0, { timeout: 15_000 });
  });

  // AC-CPI-23: Cancellation announcement appears in chat
  test('Cancellation announcement appears in group chat', async () => {
    await expect(pgA.getByTestId('invite-cancelled-announcement')).toBeVisible({ timeout: 15_000 });
  });

  // AC-CPI-24: Group remains usable — USER_A can send a new chat message
  test('USER_A can send a chat message after cancel (group not blocked)', async () => {
    const msg = 'group-usable-after-cancel';
    await expect(pgA.getByTestId('chat-input')).toBeVisible({ timeout: 10_000 });
    await pgA.getByTestId('chat-input').fill(msg);
    await pgA.getByTestId('chat-send-btn').click();
    await expect(
      pgA.locator('[data-testid^="msg-"]').filter({ hasText: msg }),
    ).toBeVisible({ timeout: 15_000 });
  });
});
