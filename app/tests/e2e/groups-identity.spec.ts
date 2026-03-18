import { test, expect } from '@playwright/test';
import { clearAppState } from './helpers/clear-state';
import { queryRelayForEvents } from './helpers/relay-query';

test.describe('Groups Identity', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearAppState(page);
    await page.reload();
  });

  test('Tier 1 auto-identity: keypair generated on first launch', async ({ page }) => {
    await page.goto('/');
    // Wait for identity to init, then navigate to settings
    await page.goto('/settings/');
    const npubDisplay = page.getByTestId('identity-npub-display');
    await expect(npubDisplay).toBeVisible({ timeout: 30_000 });
    const npubText = await npubDisplay.textContent();
    expect(npubText).toMatch(/npub1/);
  });

  test('Kind 0 metadata published to relay', async ({ page }) => {
    await page.goto('/');
    // Wait for identity initialization and publishing
    await page.waitForTimeout(5_000);
    await page.goto('/settings/');
    const npubDisplay = page.getByTestId('identity-npub-display');
    await expect(npubDisplay).toBeVisible({ timeout: 30_000 });

    // Get pubkey from localStorage
    const pubkeyHex = await page.evaluate(() => {
      const raw = localStorage.getItem('lp_nostrIdentity_v1');
      if (!raw) return null;
      return JSON.parse(raw).pubkeyHex;
    });
    expect(pubkeyHex).toBeTruthy();

    // Query relay for kind 0 events
    const events = await queryRelayForEvents(page, {
      kinds: [0],
      authors: [pubkeyHex!],
      limit: 5,
    });
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].kind).toBe(0);
  });

  test('Kind 443 KeyPackages published to relay', async ({ page }) => {
    await page.goto('/');
    // Wait for MarmotContext to init and publish KeyPackages
    await page.waitForTimeout(10_000);

    const pubkeyHex = await page.evaluate(() => {
      const raw = localStorage.getItem('lp_nostrIdentity_v1');
      if (!raw) return null;
      return JSON.parse(raw).pubkeyHex;
    });
    expect(pubkeyHex).toBeTruthy();

    const events = await queryRelayForEvents(page, {
      kinds: [443],
      authors: [pubkeyHex!],
      limit: 10,
    });
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  test('Identity persists across reload', async ({ page }) => {
    await page.goto('/settings/');
    const npubDisplay = page.getByTestId('identity-npub-display');
    await expect(npubDisplay).toBeVisible({ timeout: 30_000 });
    const npubBefore = await npubDisplay.textContent();

    await page.reload();
    await expect(npubDisplay).toBeVisible({ timeout: 30_000 });
    const npubAfter = await npubDisplay.textContent();

    expect(npubBefore).toBe(npubAfter);
  });
});
