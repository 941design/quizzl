/**
 * E2E tests for the Advanced Settings epic (Story 06 — fast-mode tests).
 *
 * These tests run without the strfry relay (no E2E_GROUPS flag needed).
 * They exercise the Advanced section on /settings:
 *   - collapsed by default (AC-GATE-1)
 *   - relay list shows effective relays (AC-RELAY-1)
 *   - invalid URL rejected (AC-RELAY-3)
 *   - last relay removal blocked (AC-RELAY-4)
 *   - reset restores DEFAULT_RELAYS (AC-RELAY-5)
 *   - danger zone wipe requires typed confirmation (AC-OTHER-1)
 *   - no hex pubkey visible in Advanced (AC-NPUB-1)
 *   - Advanced section heading renders (AC-I18N-1 smoke)
 */

import { test, expect } from '@playwright/test';
import { clearAppState } from './helpers/clear-state';
import { injectIdentity, USER_A } from './helpers/auth-helpers';

// Compute keypairs once before the suite runs.
// auth-helpers.ts exposes computeTestKeypairs() but tests can also
// inline the known private-key values without it — we use injectIdentity
// which only needs privateKeyHex/pubkeyHex/seedHex (filled in USER_A).
// However USER_A.pubkeyHex is populated at runtime via computeTestKeypairs,
// so we must call it in beforeAll.
import { computeTestKeypairs } from './helpers/auth-helpers';

const DEFAULT_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol'];

test.describe.serial('Advanced Settings', () => {
  test.beforeAll(async () => {
    await computeTestKeypairs();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearAppState(page);
    await injectIdentity(page, USER_A);
  });

  // -------------------------------------------------------------------------
  // Test 1: AC-GATE-1 — Advanced section is collapsed on load
  // -------------------------------------------------------------------------
  test('1. AC-GATE-1: Advanced section is collapsed by default', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    // Toggle must exist
    const toggle = page.getByTestId('advanced-settings-toggle');
    await expect(toggle).toBeVisible();

    // Relay list should NOT be visible (collapsed)
    const relayList = page.getByTestId('relay-list');
    await expect(relayList).not.toBeVisible();

    // Danger zone wipe button should NOT be visible
    const wipeBtn = page.getByTestId('danger-zone-wipe-btn');
    await expect(wipeBtn).not.toBeVisible();

    // Open the section
    await toggle.click();

    // Now relay list should appear
    await expect(relayList).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Test 2: AC-RELAY-1 — relay list shows current effective relays
  // -------------------------------------------------------------------------
  test('2. AC-RELAY-1: relay list shows DEFAULT_RELAYS after clear state', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    await page.getByTestId('advanced-settings-toggle').click();

    // Both default relays must appear in the list
    for (const url of DEFAULT_RELAYS) {
      const row = page.getByTestId(`relay-row-${url.replace(/[^a-zA-Z0-9]/g, '-')}`);
      await expect(row).toBeVisible();
      await expect(row).toContainText(url);
    }
  });

  // -------------------------------------------------------------------------
  // Test 3: AC-RELAY-3 — invalid URL rejected
  // -------------------------------------------------------------------------
  test('3. AC-RELAY-3: invalid relay URL is rejected with an error', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    await page.getByTestId('advanced-settings-toggle').click();

    const input = page.getByTestId('add-relay-input');
    await input.fill('not-a-relay-url');
    await page.getByTestId('add-relay-btn').click();

    // An inline error should appear
    // The error text is in a <Text> element below the input with data-testid
    await expect(page.getByTestId('add-relay-error')).toBeVisible();

    // The invalid URL must NOT appear as a relay row
    await expect(page.getByTestId('relay-row-not-a-relay-url')).toHaveCount(0);
  });

  // -------------------------------------------------------------------------
  // Test 4: AC-RELAY-4 — last relay removal blocked
  // -------------------------------------------------------------------------
  test('4. AC-RELAY-4: removing the last relay shows a blocking error', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    await page.getByTestId('advanced-settings-toggle').click();

    // Remove relays until one remains — start by removing one
    const firstRelayUrl = DEFAULT_RELAYS[0];
    const firstRelayTestId = firstRelayUrl.replace(/[^a-zA-Z0-9]/g, '-');
    await page.getByTestId(`remove-relay-btn-${firstRelayTestId}`).click();

    // Now only one relay remains — try to remove it
    const secondRelayUrl = DEFAULT_RELAYS[1];
    const secondRelayTestId = secondRelayUrl.replace(/[^a-zA-Z0-9]/g, '-');
    await page.getByTestId(`remove-relay-btn-${secondRelayTestId}`).click();

    // An error message should appear explaining removal is blocked
    await expect(page.locator('text=one relay')).toBeVisible();

    // The relay should still be in the list
    await expect(page.getByTestId(`relay-row-${secondRelayTestId}`)).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Test 5: AC-RELAY-5 — reset restores DEFAULT_RELAYS
  // -------------------------------------------------------------------------
  test('5. AC-RELAY-5: reset button restores DEFAULT_RELAYS and removes custom relay', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    await page.getByTestId('advanced-settings-toggle').click();

    // Add a custom relay
    const input = page.getByTestId('add-relay-input');
    await input.fill('wss://example.com');
    await page.getByTestId('add-relay-btn').click();

    // Verify custom relay was added (use text match — testid form is the sanitized URL)
    await expect(page.locator('[data-testid="relay-list"]')).toContainText('wss://example.com');

    // Click reset
    await page.getByTestId('reset-relays-btn').click();

    // Custom relay should be gone
    await expect(page.locator('[data-testid="relay-list"]')).not.toContainText('wss://example.com');

    // Default relays should be back
    for (const url of DEFAULT_RELAYS) {
      await expect(page.locator('[data-testid="relay-list"]')).toContainText(url);
    }
  });

  // -------------------------------------------------------------------------
  // Test 6: AC-OTHER-1 — danger zone wipe requires typed confirmation
  // -------------------------------------------------------------------------
  test('6. AC-OTHER-1: danger zone wipe confirmation requires typing WIPE', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    await page.getByTestId('advanced-settings-toggle').click();

    // Wipe button should be visible
    const wipeBtn = page.getByTestId('danger-zone-wipe-btn');
    await expect(wipeBtn).toBeVisible();

    // Click it — confirmation flow appears
    await wipeBtn.click();

    // Confirmation input should appear
    const confirmInput = page.getByTestId('danger-zone-confirm-input');
    await expect(confirmInput).toBeVisible();

    // Confirm button should exist; it is disabled until the right word is typed
    const confirmBtn = page.getByTestId('danger-zone-confirm-btn');
    await expect(confirmBtn).toBeVisible();
    await expect(confirmBtn).toBeDisabled();

    // Type the wrong word — confirm button remains disabled
    await confirmInput.fill('wrong');
    await expect(confirmBtn).toBeDisabled();

    // Clear and type the correct word
    await confirmInput.fill('WIPE');
    await expect(confirmBtn).toBeEnabled();
  });

  // -------------------------------------------------------------------------
  // Test 7: AC-NPUB-1 — no raw hex pubkey in Advanced section
  // -------------------------------------------------------------------------
  test('7. AC-NPUB-1: Advanced section does not expose raw hex pubkeys', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    await page.getByTestId('advanced-settings-toggle').click();

    // Wait for section to be visible (relay list rendered)
    await expect(page.getByTestId('relay-list')).toBeVisible();

    // Extract text content of the settings page and check for 64-char hex strings
    const pageText = await page.getByTestId('settings-page').innerText();
    // A raw hex pubkey is exactly 64 lowercase hex characters
    const hexPubkeyPattern = /\b[0-9a-f]{64}\b/;
    expect(hexPubkeyPattern.test(pageText)).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Test 8: AC-I18N-1 — Advanced section heading renders (smoke test)
  // -------------------------------------------------------------------------
  test('8. AC-I18N-1: Advanced section heading is visible and not empty', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    // The toggle button text reflects the i18n key for the section
    const toggle = page.getByTestId('advanced-settings-toggle');
    await expect(toggle).toBeVisible();

    // The button must have non-empty text (proves i18n is wired up)
    const toggleText = await toggle.innerText();
    expect(toggleText.trim().length).toBeGreaterThan(0);

    // After clicking, the relays section title must appear
    await toggle.click();
    await expect(page.getByTestId('relay-list')).toBeVisible();
  });
});
