import { test, expect, BrowserContext, Page } from '@playwright/test';
import { clearAppState } from './helpers/clear-state';
import { suppressErrorOverlay, dismissErrorOverlay } from './helpers/dismiss-error-overlay';

const BASE_URL = 'http://localhost:3100';

test.describe.serial('Seed phrase recovery — profile and groups', () => {
  let contextA: BrowserContext;
  let pageA: Page;
  let mnemonic: string;
  let originalNpub: string;
  const NICKNAME = 'SeedRecoveryHero';
  const GROUP_NAME = 'Recovery Test Group';

  test.beforeAll(async ({ browser }) => {
    // Boot User A — inject profile via init script so that the auto-generated
    // identity's publishIdentityToRelays picks up the nickname when publishing
    // kind 0 metadata. The init script runs BEFORE page JS on every navigation.
    contextA = await browser.newContext({ baseURL: BASE_URL });
    await suppressErrorOverlay(contextA);
    await contextA.addInitScript(({ nickname }) => {
      localStorage.setItem(
        'lp_userProfile_v1',
        JSON.stringify({ nickname, avatar: null, badgeIds: [] }),
      );
    }, { nickname: NICKNAME });
    pageA = await contextA.newPage();
    await pageA.goto('/');
    await clearAppState(pageA);
    await pageA.reload();
  });

  test.afterAll(async () => {
    await contextA?.close();
  });

  test('User A generates backup and publishes identity to relay', async () => {
    // Navigate to settings — identity is auto-generated, profile is injected
    await pageA.goto('/settings/');
    await expect(pageA.getByTestId('identity-npub-display')).toBeVisible({ timeout: 30_000 });
    originalNpub = (await pageA.getByTestId('identity-npub-display').textContent()) ?? '';

    // Verify profile is shown
    await expect(pageA.getByTestId('profile-nickname-input')).toHaveValue(NICKNAME, { timeout: 10_000 });

    // Generate and capture mnemonic
    await pageA.getByTestId('generate-backup-phrase-btn').click();
    await expect(pageA.getByTestId('mnemonic-display')).toBeVisible({ timeout: 10_000 });
    const mnemonicText = await pageA.getByTestId('mnemonic-display').textContent();
    expect(mnemonicText).toBeTruthy();
    mnemonic = mnemonicText!.trim();
    const words = mnemonic.split(/\s+/);
    expect(words.length).toBe(12);

    // Confirm backup
    await pageA.getByTestId('backup-confirm-checkbox').check();
    await pageA.getByTestId('backup-done-btn').click();

    // Wait for kind 0 to propagate (publishIdentityToRelays is fire-and-forget on init)
    await pageA.waitForTimeout(5_000);
  });

  test('User A creates a group', async () => {
    await pageA.goto('/groups/');
    await expect(
      pageA.getByTestId('groups-empty-state').or(pageA.getByTestId('groups-list')),
    ).toBeVisible({ timeout: 60_000 });
    await dismissErrorOverlay(pageA);

    await pageA.getByTestId('create-group-btn').click();
    await expect(pageA.getByTestId('create-group-modal-content')).toBeVisible();
    await pageA.getByTestId('create-group-name-input').fill(GROUP_NAME);
    await pageA.getByTestId('create-group-submit-btn').click();

    await expect(pageA.getByText(GROUP_NAME)).toBeVisible({ timeout: 30_000 });
    await expect(pageA.getByTestId('create-group-modal-content')).not.toBeVisible({ timeout: 10_000 });
    await dismissErrorOverlay(pageA);
    await pageA.waitForTimeout(3_000);
  });

  test('Restore from seed recovers npub and profile', async ({ browser }) => {
    const freshContext = await browser.newContext({ baseURL: BASE_URL });
    await suppressErrorOverlay(freshContext);
    const freshPage = await freshContext.newPage();

    try {
      await freshPage.goto('/settings/');
      await expect(freshPage.getByTestId('identity-npub-display')).toBeVisible({ timeout: 30_000 });

      // Wait for auto-generated identity to finish initializing (NDK connects to relay)
      await freshPage.waitForTimeout(3_000);

      // Enter seed phrase and restore
      await freshPage.getByTestId('restore-phrase-input').fill(mnemonic);
      await freshPage.getByTestId('restore-identity-btn').click();

      // Verify npub matches the original
      await expect(freshPage.getByTestId('identity-npub-display')).toHaveText(originalNpub, { timeout: 30_000 });

      // Verify the profile nickname was recovered from relay kind 0
      await expect(freshPage.getByTestId('profile-nickname-input')).toHaveValue(NICKNAME, { timeout: 30_000 });

      // Verify the recovered profile is persisted in localStorage
      const storedProfile = await freshPage.evaluate(() => {
        return JSON.parse(localStorage.getItem('lp_userProfile_v1') || '{}');
      });
      expect(storedProfile.nickname).toBe(NICKNAME);

      // Navigate to groups page — should load without errors
      await freshPage.goto('/groups/');
      await expect(
        freshPage.getByTestId('groups-empty-state').or(freshPage.getByTestId('groups-list')),
      ).toBeVisible({ timeout: 60_000 });
    } finally {
      await freshContext.close();
    }
  });
});
