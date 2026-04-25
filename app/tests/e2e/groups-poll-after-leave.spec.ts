/**
 * Soft-leave: verify the group keeps working after a member leaves.
 *
 * Leave is a client-side-only operation (no MLS Remove proposal). The
 * departing member purges local state; the remaining members' MLS state
 * is unaffected. This test confirms that polls, chat, voting, and poll
 * close all work normally after a soft-leave.
 *
 * See specs/out-of-band-leave.md for the planned protocol-level solution.
 */

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
    if (!localStorage.getItem('lp_userProfile_v1')) {
      localStorage.setItem('lp_userProfile_v1', JSON.stringify({ nickname, avatar: null, badgeIds: [] }));
    }
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

async function createGroupAndOpen(page: Page, groupName: string): Promise<void> {
  await expect(
    page.getByTestId('groups-empty-state').or(page.getByTestId('groups-list')),
  ).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('create-group-btn').click();
  await expect(page.getByTestId('create-group-modal-content')).toBeVisible();
  await page.getByTestId('create-group-name-input').fill(groupName);
  await page.getByTestId('create-group-submit-btn').click();
  await expect(page.getByText(groupName)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('create-group-modal-content')).not.toBeVisible({ timeout: 10_000 });
  await dismissErrorOverlay(page);
  await page.locator(`[data-testid^="group-card-"]`, { hasText: groupName }).click();
  await expect(page.getByTestId('group-detail-page')).toBeVisible({ timeout: 30_000 });
}

async function inviteAndJoin(
  inviterPage: Page,
  inviteeNpub: string,
  inviteePage: Page,
  groupName: string,
): Promise<void> {
  await dismissErrorOverlay(inviterPage);
  await inviterPage.getByTestId('invite-member-btn').click();
  await expect(inviterPage.getByTestId('invite-member-modal-content')).toBeVisible();
  await inviterPage.getByTestId('invite-npub-input').fill(inviteeNpub);
  await inviterPage.getByTestId('invite-submit-btn').click();
  await expect(inviterPage.getByTestId('invite-success')).toBeVisible({ timeout: 60_000 });
  await inviterPage.keyboard.press('Escape');

  // Invitee receives Welcome and joins
  await inviteePage.goto('/groups/');
  await expect(inviteePage.getByText(groupName)).toBeVisible({ timeout: 60_000 });

  // Wait for profile exchange to complete
  await inviteePage.waitForTimeout(10_000);
}

async function openGroupDetail(page: Page, groupName: string): Promise<void> {
  await page.goto('/groups/');
  await page.locator(`[data-testid^="group-card-"]`, { hasText: groupName }).click();
  await expect(page.getByTestId('group-detail-page')).toBeVisible({ timeout: 30_000 });
}

// ---------------------------------------------------------------------------
// Test: group functionality continues after soft-leave
// ---------------------------------------------------------------------------

test.describe.serial('Group works after soft-leave', () => {
  let ctxA: BrowserContext;
  let ctxB: BrowserContext;
  let pgA: Page;
  let pgB: Page;
  const GROUP_NAME = 'Soft Leave Test';

  test.beforeAll(async ({ browser }) => {
    await computeTestKeypairs();
    ({ context: ctxA, page: pgA } = await bootUserWithProfile(browser, USER_A, 'Alice'));
    ({ context: ctxB, page: pgB } = await bootUserWithProfile(browser, USER_B, 'Bob'));
  });

  test.afterAll(async () => {
    await ctxA?.close();
    await ctxB?.close();
  });

  test('Setup: A creates group and invites B', async () => {
    await createGroupAndOpen(pgA, GROUP_NAME);
    await pgB.waitForTimeout(5_000);
    await inviteAndJoin(pgA, USER_B.npub, pgB, GROUP_NAME);
  });

  test('B soft-leaves the group (local purge only, no MLS proposal)', async () => {
    await openGroupDetail(pgB, GROUP_NAME);
    await pgB.getByTestId('leave-group-btn').click();
    await pgB.getByTestId('leave-group-confirm-btn').click();

    // Group disappears from B's local list
    await expect(pgB.getByText(GROUP_NAME)).not.toBeVisible({ timeout: 30_000 });
  });

  test('A can create a poll immediately (no unapplied proposals)', async () => {
    // No need to wait for proposal propagation — soft-leave sends nothing.
    await openGroupDetail(pgA, GROUP_NAME);

    await pgA.getByTestId('create-poll-btn').click();
    await expect(pgA.getByTestId('create-poll-modal')).toBeVisible();

    await pgA.getByTestId('poll-title-input').fill('Post-leave poll');
    await pgA.getByTestId('poll-option-input-0').fill('Option X');
    await pgA.getByTestId('poll-option-input-1').fill('Option Y');
    await pgA.getByTestId('create-poll-submit-btn').click();

    await expect(pgA.getByTestId('create-poll-modal')).not.toBeVisible({ timeout: 30_000 });

    const panel = pgA.getByTestId('poll-panel');
    await expect(panel.getByText('Post-leave poll')).toBeVisible({ timeout: 10_000 });
  });

  test('Chat announcement sent successfully', async () => {
    await expect(pgA.getByTestId('poll-chat-announcement')).toBeVisible({ timeout: 30_000 });
    await expect(pgA.getByText('Alice started a poll')).toBeVisible();
  });

  test('A can send a chat message', async () => {
    const chatInput = pgA.getByTestId('chat-input');
    await chatInput.fill('Hello after leave');
    await pgA.getByTestId('chat-send-btn').click();
    await expect(pgA.getByText('Hello after leave')).toBeVisible({ timeout: 10_000 });
  });

  test('A can vote on the poll', async () => {
    const panel = pgA.getByTestId('poll-panel');
    const pollCard = panel.locator('[data-testid^="poll-card-"]').first();

    await pollCard.getByText('Option X').click();
    await pollCard.getByText('Vote', { exact: true }).click();
    await expect(pollCard.getByText('Voted')).toBeVisible({ timeout: 10_000 });
  });

  test('A can close the poll', async () => {
    const panel = pgA.getByTestId('poll-panel');
    const pollCard = panel.locator('[data-testid^="poll-card-"]').first();

    await pollCard.getByText('Close Poll').click();
    await expect(pollCard.getByText('Close this poll?')).toBeVisible();
    await pollCard.getByText('Confirm').click();

    await expect(pgA.getByTestId('poll-toggle-closed')).toBeVisible({ timeout: 30_000 });
    await pgA.getByTestId('poll-toggle-closed').click();

    await expect(
      panel.locator('[data-testid^="poll-results-card-"]').first(),
    ).toBeVisible({ timeout: 10_000 });
    await expect(panel.getByText('1 voter')).toBeVisible();
  });
});
