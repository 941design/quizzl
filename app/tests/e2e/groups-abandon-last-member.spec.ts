// E2E: Assembled abandon-last-member flow (epic: abandon-last-member-group, S4).
//
// AC-FLOW-1: A user who creates a group and invites nobody can open the leave
//   modal, activate abandon-group-confirm-btn, and arrive at the group list
//   with the abandoned group absent from it.
// AC-FLOW-2: Reloading the group list after abandon must not show the
//   abandoned group (discriminates a real purge from a render-state removal).
// AC-FLOW-3: This file is named groups-abandon-*.spec.ts so
//   playwright.config.ts:36-41 routes it into the relay bucket.
//
// AC-STRUCT-2: this is the cross-cutting enforcement that the feature is
// actually wired end to end — it drives the real LeaveGroupButton component,
// the real MarmotContext.getLiveMemberPubkeys / leaveGroupImpl, and asserts
// the real navigation outcome. No test-only bypass of the modal.
//
// Single-user spec: group creation alone publishes a KeyPackage, which is
// why this still needs the relay bucket, but nobody is invited, so one
// browser context suffices.

import { test, expect, BrowserContext, Page } from '@playwright/test';
import { USER_A, computeTestKeypairs } from './helpers/auth-helpers';
import { clearAppState } from './helpers/clear-state';
import { dismissErrorOverlay, suppressErrorOverlay } from './helpers/dismiss-error-overlay';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3100';
const GROUP_NAME = 'Abandon Last Member E2E';

async function bootUser(
  browser: { newContext: (opts: object) => Promise<BrowserContext> },
  user: typeof USER_A,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL: BASE_URL });
  await suppressErrorOverlay(context);
  await context.addInitScript(({ privateKeyHex, pubkeyHex, seedHex }) => {
    localStorage.setItem('lp_nostrIdentity_v1', JSON.stringify({ privateKeyHex, pubkeyHex, seedHex }));
  }, { privateKeyHex: user.privateKeyHex, pubkeyHex: user.pubkeyHex, seedHex: user.seedHex });
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

/** Navigate to the group detail page via the group-card. */
async function openGroupDetail(page: Page, groupName: string): Promise<void> {
  await page.goto('/groups/');
  await expect(
    page.getByTestId('groups-empty-state').or(page.getByTestId('groups-list')),
  ).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(groupName)).toBeVisible({ timeout: 60_000 });
  await page.locator(`[data-testid^="group-card-"]`, { hasText: groupName }).click();
  await expect(page.getByTestId('group-detail-page')).toBeVisible({ timeout: 30_000 });
  await dismissErrorOverlay(page);
}

test.describe.serial('Abandon last-member group', () => {
  let ctxA: BrowserContext;
  let pgA: Page;

  test.beforeAll(async ({ browser }) => {
    await computeTestKeypairs();
    ({ context: ctxA, page: pgA } = await bootUser(browser, USER_A));
  });

  test.afterAll(async () => {
    await ctxA?.close();
  });

  // Step 1: create a group and invite nobody — memberPubkeys ends up as
  // exactly [self], which is the solo-group precondition for the whole test.
  test('USER_A creates a group and invites nobody', async () => {
    await pgA.getByTestId('create-group-btn').click();
    await expect(pgA.getByTestId('create-group-modal-content')).toBeVisible();
    await pgA.getByTestId('create-group-name-input').fill(GROUP_NAME);
    await pgA.getByTestId('create-group-submit-btn').click();
    await expect(pgA.getByText(GROUP_NAME)).toBeVisible({ timeout: 30_000 });
    await expect(pgA.getByTestId('create-group-modal-content')).not.toBeVisible({ timeout: 10_000 });
    await dismissErrorOverlay(pgA);
    // Allow the MLS group to initialise and publish its KeyPackage before continuing.
    await pgA.waitForTimeout(3_000);
  });

  // Step 2: open the leave modal on the solo group and assert it renders the
  // abandon state (AC-FLOW-1 / AC-UX-1's runtime proof) — not the sole-admin
  // block and not the normal confirm.
  test('leave modal on a solo group renders the abandon state', async () => {
    await openGroupDetail(pgA, GROUP_NAME);
    await pgA.getByTestId('leave-group-btn').click();
    await expect(pgA.getByTestId('abandon-group-notice')).toBeVisible({ timeout: 15_000 });
    await expect(pgA.getByTestId('abandon-group-confirm-btn')).toBeVisible();
    await expect(pgA.getByTestId('last-admin-blocked-notice')).not.toBeVisible();
  });

  // Step 3 + 4: activate abandon, land back on the group list, reload, and
  // confirm the group stays gone (AC-FLOW-1, AC-FLOW-2).
  test('activating abandon purges the group and arrives at the group list', async () => {
    await pgA.getByTestId('abandon-group-confirm-btn').click();

    // Anchored against pathname + search (not Playwright's toHaveURL, which
    // matches a regex against the full absolute URL and can never satisfy a
    // leading `^/`): rules out both a substring false-positive on
    // `/groups/?id=...` (never actually navigated away) and the
    // trailingSlash:true rewrite of `/groups` to `/groups/`.
    await expect.poll(
      () => {
        const url = new URL(pgA.url());
        return url.pathname + url.search;
      },
      { timeout: 30_000 },
    ).toMatch(/^\/groups\/?$/);
    await expect(
      pgA.getByTestId('groups-empty-state').or(pgA.getByTestId('groups-list')),
    ).toBeVisible({ timeout: 30_000 });
    await expect(pgA.getByText(GROUP_NAME)).not.toBeVisible();

    // Reload to discriminate a real purge from a render-state-only removal.
    await pgA.reload();
    await expect(
      pgA.getByTestId('groups-empty-state').or(pgA.getByTestId('groups-list')),
    ).toBeVisible({ timeout: 60_000 });
    await expect(pgA.getByText(GROUP_NAME)).not.toBeVisible();
  });
});
