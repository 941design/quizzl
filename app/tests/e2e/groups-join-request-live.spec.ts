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
      localStorage.setItem('lp_userProfile_v1', JSON.stringify({ nickname, avatar: null }));
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
  await page.locator(`[data-testid^="group-card-"]`, { hasText: groupName }).click();
  await expect(page.getByTestId('group-detail-page')).toBeVisible({ timeout: 30_000 });
}

// ---------------------------------------------------------------------------
// E2E: Join request must refresh the OPEN group detail view live.
//
// Regression coverage for: admin stays on an already-open group detail page,
// a peer joins via invite link, and the pending-requests section must appear
// without any navigate-away/reload — mirroring the notification bell, which
// already updates live. See bug-reports/group-view-no-live-refresh-on-member-
// accept-report.md.
//
// The crux of this test is what it does NOT do: after generating the invite
// link, User A's page is never `goto`'d or `reload`'d again. Contrast with
// groups-invite-link.spec.ts, where User A navigates to /groups/ and back
// before checking for the pending-requests section — that round trip masks
// this bug because the mount-only effect in PendingRequestsSection re-reads
// from IDB on the fresh mount. Here the section must already be mounted and
// must update via live state, or the second assertion below fails.
// ---------------------------------------------------------------------------
test.describe.serial('Join request live-refreshes an already-open group detail view', () => {
  const GROUP_NAME = 'Live Refresh Test Group';
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

  test('User A creates a group and generates an invite link', async () => {
    await createGroup(pageA, GROUP_NAME);
    await openGroupDetail(pageA, GROUP_NAME);

    await pageA.getByTestId('invite-link-btn').click();
    await expect(pageA.getByTestId('generate-invite-link-modal')).toBeVisible();

    const urlElement = pageA.getByTestId('invite-link-url');
    await expect(urlElement).toBeVisible();
    inviteUrl = (await urlElement.textContent()) ?? '';
    expect(inviteUrl).toContain('/groups/?join=');

    // Copy the link (persists the InviteLink to IDB — required for the nonce lookup).
    await pageA.getByTestId('invite-link-copy-btn').click();
    await pageA.waitForTimeout(1_000);

    // Close the modal (scope to modal so we don't hit a toast close button).
    await pageA.getByTestId('generate-invite-link-modal').locator('[aria-label="Close"]').click();
    await expect(pageA.getByTestId('generate-invite-link-modal')).not.toBeVisible({ timeout: 5_000 });

    // User A stays right here — on the open group detail page — for the rest
    // of the test. No further navigation/reload of pageA is permitted.
    await expect(pageA.getByTestId('group-detail-page')).toBeVisible();
  });

  test('User B opens the invite link and sends a join request', async () => {
    const url = new URL(inviteUrl);
    const pathWithQuery = url.pathname + url.search;

    await pageB.goto(pathWithQuery);
    await dismissErrorOverlay(pageB);

    await expect(pageB.getByTestId('join-request-card')).toBeVisible({ timeout: 30_000 });
    await expect(pageB.getByText(GROUP_NAME)).toBeVisible();

    await pageB.getByTestId('join-request-send-btn').click();

    await expect(pageB.getByTestId('join-request-sent')).toBeVisible({ timeout: 30_000 });
  });

  test('User A sees both the live bell update AND the live pending-requests section, without navigating away', async () => {
    // Contrast assertion #1: the bell updates live. This proves the join-request
    // rumor was received and processed at all — if this failed too, the bug
    // would be "event never arrived", not the live-refresh bug under test.
    await expect
      .poll(
        async () => {
          await dismissErrorOverlay(pageA);
          const badge = pageA.getByTestId('notification-badge').first();
          return badge.isVisible();
        },
        { timeout: 60_000, intervals: [3_000, 5_000, 5_000, 5_000, 5_000, 5_000, 5_000] },
      )
      .toBe(true);

    // Contrast assertion #2: the pending-requests section on the ALREADY-OPEN
    // group detail page must also update live — no goto/reload of pageA above
    // or below this line. Pre-fix, this times out because the join-request
    // callback only updates the bell store, never the `pendingRequests` React
    // state that PendingRequestsSection renders from.
    await expect(pageA.getByTestId('pending-requests-section')).toBeVisible({ timeout: 30_000 });

    // Also verify a concrete pending-request row rendered (not just the
    // section shell).
    await expect(pageA.locator('[data-testid^="pending-request-row-"]').first()).toBeVisible({ timeout: 5_000 });
  });
});
