import { test, expect } from '@playwright/test';
import { clearAppState } from './helpers/clear-state';
import { queryRelayForEvents } from './helpers/relay-query';
import { openAdvancedSettings } from './helpers/settings';

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
    await openAdvancedSettings(page);
    const npubDisplay = page.getByTestId('identity-npub-display');
    await expect(npubDisplay).toBeVisible({ timeout: 30_000 });
    const npubText = await npubDisplay.textContent();
    expect(npubText).toMatch(/npub1/);
  });

  test('Kind 0 metadata is NEVER published to relay (privacy invariant)', async ({ page }) => {
    // Privacy invariant (CLAUDE.md + AC-SEC-2 of epic-contact-card-exchange):
    // the user's kind-0 profile metadata must NEVER be broadcast to public
    // relays. `publishIdentityToRelays` was removed; profile is exchanged only
    // out-of-band via signed contact cards. This test guards against the
    // broadcast being reintroduced. (Previously this asserted the opposite —
    // that kind 0 IS published — which encoded the now-forbidden behavior.)
    await page.goto('/');
    // Give identity init + any (forbidden) background publish ample time to fire.
    await page.waitForTimeout(5_000);
    await page.goto('/settings/');
    await openAdvancedSettings(page);
    const npubDisplay = page.getByTestId('identity-npub-display');
    await expect(npubDisplay).toBeVisible({ timeout: 30_000 });

    // Get pubkey from localStorage
    const pubkeyHex = await page.evaluate(() => {
      const raw = localStorage.getItem('lp_nostrIdentity_v1');
      if (!raw) return null;
      return JSON.parse(raw).pubkeyHex;
    });
    expect(pubkeyHex).toBeTruthy();

    // Query relay for kind 0 events authored by this identity — there must be NONE.
    const events = await queryRelayForEvents(page, {
      kinds: [0],
      authors: [pubkeyHex!],
      limit: 5,
    });
    expect(events.length).toBe(0);
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
      kinds: [30443],
      authors: [pubkeyHex!],
      limit: 10,
    });
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  test('Identity persists across reload', async ({ page }) => {
    await page.goto('/settings/');
    await openAdvancedSettings(page);
    const npubDisplay = page.getByTestId('identity-npub-display');
    await expect(npubDisplay).toBeVisible({ timeout: 30_000 });
    const npubBefore = await npubDisplay.textContent();

    await page.reload();
    await openAdvancedSettings(page);
    await expect(npubDisplay).toBeVisible({ timeout: 30_000 });
    const npubAfter = await npubDisplay.textContent();

    expect(npubBefore).toBe(npubAfter);
  });
});
