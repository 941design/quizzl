import { test, expect, BrowserContext, Page } from '@playwright/test';
import { USER_A, USER_B, computeTestKeypairs } from './helpers/auth-helpers';
import { clearAppState } from './helpers/clear-state';
import { dismissErrorOverlay, suppressErrorOverlay } from './helpers/dismiss-error-overlay';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3100';

/** Boot a user context: inject identity (+ nickname) via init script, navigate to /groups/. */
async function bootUser(
  browser: { newContext: (opts: object) => Promise<BrowserContext> },
  user: typeof USER_A,
  nickname: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL: BASE_URL });
  await suppressErrorOverlay(context);
  await context.addInitScript(({ privateKeyHex, pubkeyHex, seedHex, nickname }) => {
    localStorage.setItem('lp_nostrIdentity_v1', JSON.stringify({ privateKeyHex, pubkeyHex, seedHex }));
    localStorage.setItem('lp_userProfile_v1', JSON.stringify({ nickname, avatar: null }));
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

async function openGroupDetail(page: Page, groupName: string): Promise<void> {
  await dismissErrorOverlay(page);
  await page.locator(`[data-testid^="group-card-"]`, { hasText: groupName }).click();
  await expect(page.getByTestId('group-detail-page')).toBeVisible({ timeout: 30_000 });
}

// ---------------------------------------------------------------------------
// E2E: Approving a join request must show the requester's KNOWN name, not npub.
//
// The join request carries the requester's self-provided name (rendered in the
// pending-requests prompt "for confirmation"). When the admin approves, that
// name must be persisted so the new member row shows the name immediately —
// exactly like accepting a contact card (name first, avatar later). Before the
// fix, approval called inviteByNpub with pubkey only and discarded the name, so
// the member fell back to a truncated npub until their own profile propagated
// back over the (slow, sometimes flaky) group channel.
//
// Determinism note: the invitee is taken OFFLINE (context closed) before the
// admin approves. Otherwise the invitee's still-open client auto-accepts the
// Welcome (it holds an outbound join-request record for this admin) and then
// publishes its real in-group profile, which would make the name appear via
// propagation and mask the bug. With the invitee offline, B never processes the
// Welcome and never publishes a profile, so B's name can ONLY appear in A's
// member list if the approval path itself persisted the name carried by the
// join request — exactly the behavior under test. The member stays PENDING
// (they have not actually joined yet) — name shown, "Pending" badge retained.
// ---------------------------------------------------------------------------
test.describe.serial('Join request approval shows the requester name, not an npub', () => {
  const GROUP_NAME = 'Join Request Profile Group';
  let ctxA: BrowserContext;
  let ctxB: BrowserContext;
  let pageA: Page;
  let pageB: Page;
  let inviteUrl = '';
  let bClosed = false;

  test.beforeAll(async ({ browser }) => {
    await computeTestKeypairs();
    ({ context: ctxA, page: pageA } = await bootUser(browser, USER_A, 'GroupAdmin'));
    ({ context: ctxB, page: pageB } = await bootUser(browser, USER_B, 'Invitee'));
  });

  test.afterAll(async () => {
    await ctxA?.close();
    if (!bClosed) await ctxB?.close();
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

    await pageA.getByTestId('generate-invite-link-modal').locator('[aria-label="Close"]').click();
    await expect(pageA.getByTestId('generate-invite-link-modal')).not.toBeVisible({ timeout: 5_000 });
    await expect(pageA.getByTestId('group-detail-page')).toBeVisible();
  });

  test('User B (nickname "Invitee") opens the invite link and sends a join request', async () => {
    const url = new URL(inviteUrl);
    const pathWithQuery = url.pathname + url.search;

    await pageB.goto(pathWithQuery);
    await dismissErrorOverlay(pageB);

    await expect(pageB.getByTestId('join-request-card')).toBeVisible({ timeout: 30_000 });
    await expect(pageB.getByText(GROUP_NAME)).toBeVisible();

    await pageB.getByTestId('join-request-send-btn').click();
    await expect(pageB.getByTestId('join-request-sent')).toBeVisible({ timeout: 30_000 });
  });

  test('User A approves the request — the new member shows "Invitee", not an npub, and stays Pending', async () => {
    // The pending-requests section surfaces the request, showing the name from
    // the join request ("Invitee") for confirmation.
    await expect(pageA.getByTestId('pending-requests-section')).toBeVisible({ timeout: 60_000 });
    const requestRow = pageA.locator('[data-testid^="pending-request-row-"]').first();
    await expect(requestRow).toBeVisible({ timeout: 10_000 });
    await expect(requestRow).toContainText('Invitee');

    // Take User B offline BEFORE approval (see the determinism note above): no
    // auto-accept of the Welcome, no in-group profile publish. B's name can then
    // only surface via the approval path persisting the join-request name.
    await ctxB.close();
    bClosed = true;

    // Approve.
    await pageA.locator('[data-testid^="approve-request-"]').first().click();

    // The pending-requests row clears once approval completes.
    await expect(pageA.locator('[data-testid^="pending-request-row-"]')).toHaveCount(0, { timeout: 60_000 });

    // User B is now an MLS member of the group and appears in A's member list.
    // The bug: without persisting the join-request name, B's row falls back to a
    // truncated npub. With the fix, the row shows "Invitee" immediately — no
    // wait for B to accept the Welcome, no wait for profile propagation.
    const bobPrefix = USER_B.pubkeyHex.slice(0, 8);
    await expect(pageA.getByTestId(`member-name-${bobPrefix}`)).toBeVisible({ timeout: 60_000 });
    await expect(pageA.getByTestId(`member-name-${bobPrefix}`)).toHaveText('Invitee');

    // Chosen product behavior: the member keeps the "Pending" badge until they
    // actually join and their real (avatar-bearing) profile arrives.
    await expect(pageA.getByTestId(`member-pending-${bobPrefix}`)).toBeVisible({ timeout: 10_000 });
  });
});
