import { test, expect, BrowserContext, Page } from '@playwright/test';
import { injectIdentity, USER_A, USER_B, computeTestKeypairs } from './helpers/auth-helpers';
import { clearAppState } from './helpers/clear-state';
import { queryRelayForEvents } from './helpers/relay-query';
import { dismissErrorOverlay, suppressErrorOverlay } from './helpers/dismiss-error-overlay';

const BASE_URL = 'http://localhost:3100';

let contextA: BrowserContext;
let contextB: BrowserContext;
let pageA: Page;
let pageB: Page;

test.describe.serial('Group Lifecycle', () => {
  test.beforeAll(async ({ browser }) => {
    await computeTestKeypairs();

    // Create persistent contexts for User A and User B
    contextA = await browser.newContext({ baseURL: BASE_URL });
    await suppressErrorOverlay(contextA);
    pageA = await contextA.newPage();
    await pageA.goto('/');
    await clearAppState(pageA);
    await injectIdentity(pageA, USER_A);
    await pageA.reload();
    // Navigate to groups and wait for MarmotContext to initialize
    await pageA.goto('/groups/');
    await expect(
      pageA.getByTestId('groups-empty-state').or(pageA.getByTestId('groups-list')),
    ).toBeVisible({ timeout: 60_000 });

    contextB = await browser.newContext({ baseURL: BASE_URL });
    await suppressErrorOverlay(contextB);
    pageB = await contextB.newPage();
    await pageB.goto('/');
    await clearAppState(pageB);
    await injectIdentity(pageB, USER_B);
    await pageB.reload();
    await pageB.goto('/groups/');
    await expect(
      pageB.getByTestId('groups-empty-state').or(pageB.getByTestId('groups-list')),
    ).toBeVisible({ timeout: 60_000 });
  });

  test.afterAll(async () => {
    await contextA?.close();
    await contextB?.close();
  });

  test('User A creates a group', async () => {
    await pageA.getByTestId('create-group-btn').click();
    await expect(pageA.getByTestId('create-group-modal-content')).toBeVisible();
    await pageA.getByTestId('create-group-name-input').fill('E2E Test Group');
    await pageA.getByTestId('create-group-submit-btn').click();

    // Group should appear in the list
    await expect(pageA.getByText('E2E Test Group')).toBeVisible({ timeout: 30_000 });
    await expect(pageA.getByTestId('create-group-modal-content')).not.toBeVisible({ timeout: 10_000 });
    await dismissErrorOverlay(pageA);

    // Allow time for relay events to be published
    await pageA.waitForTimeout(3_000);
  });

  test('User B initializes and publishes KeyPackages', async () => {
    // Wait for KeyPackage publication (happens automatically during MarmotContext init)
    await pageB.waitForTimeout(5_000);

    const events = await queryRelayForEvents(pageB, {
      kinds: [443],
      authors: [USER_B.pubkeyHex],
      limit: 10,
    });
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  test('User A invites User B by npub', async () => {
    await dismissErrorOverlay(pageA);
    // Click on the group to open detail
    await pageA.locator(':has-text("E2E Test Group")').getByRole('link', { name: 'Open' }).click();
    await expect(pageA.getByTestId('group-detail-page')).toBeVisible({ timeout: 30_000 });

    // Open invite modal
    await pageA.getByTestId('invite-member-btn').click();
    await expect(pageA.getByTestId('invite-member-modal-content')).toBeVisible();

    // Enter User B's npub
    await pageA.getByTestId('invite-npub-input').fill(USER_B.npub);
    await pageA.getByTestId('invite-submit-btn').click();

    // Wait for success
    await expect(pageA.getByTestId('invite-success')).toBeVisible({ timeout: 60_000 });

    // Verify gift wrap was published to relay
    await pageA.waitForTimeout(3_000);
    const giftWrapEvents = await queryRelayForEvents(pageA, { kinds: [1059], limit: 10 });
    expect(giftWrapEvents.length).toBeGreaterThanOrEqual(1);
  });

  test('User B receives Welcome and joins group', async () => {
    // User B should see the group appear in their groups list via Welcome subscription
    await pageB.goto('/groups/');

    // First verify MarmotContext initializes
    await expect(
      pageB.getByTestId('groups-empty-state').or(pageB.getByTestId('groups-list')),
    ).toBeVisible({ timeout: 60_000 });

    // Wait for the group to appear (Welcome delivery can take 5-30s)
    await expect(pageB.getByText('E2E Test Group')).toBeVisible({ timeout: 60_000 });
  });

  test('User B leaves group', async () => {
    await dismissErrorOverlay(pageB);
    // Click on the group
    await pageB.locator(':has-text("E2E Test Group")').getByRole('link', { name: 'Open' }).click();
    await expect(pageB.getByTestId('group-detail-page')).toBeVisible({ timeout: 30_000 });

    // Leave the group
    await pageB.getByTestId('leave-group-btn').click();
    await pageB.getByTestId('leave-group-confirm-btn').click();

    // Group should be removed from User B's list
    await expect(pageB.getByText('E2E Test Group')).not.toBeVisible({ timeout: 30_000 });
  });
});
