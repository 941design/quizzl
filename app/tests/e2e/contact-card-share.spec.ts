/**
 * E2E: Share contact card — AC-UX-4 (epic: contact-card-exchange).
 *
 * "The 'Share contact card' action MUST produce a copy-able card link and a
 * scannable QR. The QR MUST encode the full onboarding URL
 * (https://few.chat/add#c=<b64url>) ... Card production MUST verify ...
 * asserted via adapter-level unit tests ... plus a local-mode e2e." — this
 * is that local-mode e2e. Drives the real **Profile** page with the local
 * signer (no NIP-07/NIP-46 — those are adapter-level unit-test territory
 * per the AC, since the Playwright rig has no bunker/extension).
 *
 * The share-contact-card action lives on the Profile page; the Settings page
 * keeps a plain bare-npub QR (asserted below). No relay traffic — card
 * production is entirely out-of-band (AC-SEC-1), so this spec runs in the
 * non-relay bucket (`make test-e2e-fast`).
 */
import { test, expect } from '@playwright/test';
import { USER_A, computeTestKeypairs } from './helpers/auth-helpers';
import { bootIdentity } from './helpers/contact-card';
import { openAdvancedSettings } from './helpers/settings';

test.describe('Share contact card (AC-UX-4)', () => {
  test.beforeAll(async () => {
    await computeTestKeypairs();
  });

  test('Profile page produces a copy-able card link and a scannable QR encoding the full onboarding URL', async ({ browser }) => {
    const { context, page } = await bootIdentity(browser, USER_A, 'Shariah', { grantClipboard: true });

    await page.goto('/profile');
    await expect(page.getByTestId('profile-share-card-btn')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('profile-share-card-btn').click();

    await expect(page.getByTestId('npub-qr-modal-display')).toBeVisible();
    // NpubQrModal encodes `shareUrl` (the full onboarding URL) at ECC-L
    // whenever a shareUrl is supplied, instead of the bare-npub/ECC-M
    // fallback — see its `eccLevel = shareUrl ? 'L' : 'M'`. Rendering the QR
    // image at all confirms QRCode.toDataURL accepted the produced value.
    await expect(page.getByTestId('npub-qr-image')).toBeVisible();

    const valueEl = page.getByTestId('npub-qr-modal-value');
    await expect(valueEl).toBeVisible();
    const cardLink = (await valueEl.textContent())?.trim() ?? '';
    // Full onboarding URL, not the bare payload (AC-UX-4).
    expect(cardLink).toMatch(/^https:\/\/few\.chat\/add#c=[A-Za-z0-9_-]+$/);

    // The Copy button actually writes the link to the clipboard — read it
    // back via the Clipboard API rather than trusting only the UI label.
    await page.getByTestId('npub-qr-modal-copy-btn').click();
    await expect(page.getByTestId('npub-qr-modal-copy-btn')).toHaveText('Copied!');
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toBe(cardLink);

    await context.close();
  });

  test('Share is disabled until a name is set — no card can go out as a bare npub', async ({ browser }) => {
    // Boot with NO nickname seeded.
    const { context, page } = await bootIdentity(browser, USER_A);

    await page.goto('/profile');
    const shareBtn = page.getByTestId('profile-share-card-btn');
    await expect(shareBtn).toBeVisible({ timeout: 15_000 });

    // With no name set, the Share action is unavailable and an explanatory
    // hint is shown instead.
    await expect(shareBtn).toBeDisabled();
    await expect(page.getByTestId('profile-share-card-needs-name')).toBeVisible();

    // Setting a name enables sharing and clears the hint.
    await page.getByTestId('profile-nickname-input').fill('Named Nadia');
    await expect(shareBtn).toBeEnabled();
    await expect(page.getByTestId('profile-share-card-needs-name')).toHaveCount(0);

    // And the now-enabled action really produces a signed card link.
    await shareBtn.click();
    await expect(page.getByTestId('npub-qr-modal-display')).toBeVisible();
    const cardLink = (await page.getByTestId('npub-qr-modal-value').textContent())?.trim() ?? '';
    expect(cardLink).toMatch(/^https:\/\/few\.chat\/add#c=[A-Za-z0-9_-]+$/);

    await context.close();
  });

  test('Settings page keeps a plain bare-npub QR (not a card link)', async ({ browser }) => {
    const { context, page } = await bootIdentity(browser, USER_A, 'Shariah');

    await page.goto('/settings');
    await openAdvancedSettings(page);
    await expect(page.getByTestId('identity-npub-display')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('show-own-npub-qr-btn').click();

    await expect(page.getByTestId('npub-qr-modal-display')).toBeVisible();
    await expect(page.getByTestId('npub-qr-image')).toBeVisible();

    // The Settings QR encodes the bare npub — NOT the /add#c= card link, and
    // there is no "Copy card link" button in this modal (that lives on Profile).
    const valueEl = page.getByTestId('npub-qr-modal-value');
    await expect(valueEl).toBeVisible();
    const shown = (await valueEl.textContent())?.trim() ?? '';
    expect(shown).toMatch(/^npub1[a-z0-9]+$/);
    expect(shown).not.toContain('/add#c=');
    await expect(page.getByTestId('npub-qr-modal-copy-btn')).toHaveCount(0);

    await context.close();
  });
});
