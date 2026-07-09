/**
 * E2E: Add contact by pasted card link — AC-UX-1 (epic: contact-card-exchange, story S4).
 *
 * Two-context scenario: USER_B shares a real signed card (via the actual
 * Settings "Share contact card" action), USER_A pastes the resulting card
 * link into the Add Contact modal. Asserts the contact is added AND renders
 * by the card's nickname — not a shortened npub — which is the behavior
 * that distinguishes a card-driven add from a bare-npub add.
 *
 * AC-UX-2 (scanning a card QR) routes through the exact same
 * `processContactInput` core as the paste path here (see
 * `AddContactModal.tsx`'s doc comment: "the single pure core both the paste
 * path ... and the scan path ... route through"), so this test's assertion
 * on that shared core also covers AC-UX-2's outcome. A live camera-based QR
 * scan is not exercised — Chromium headless has no camera/QR-image
 * recognition rig, and faking one would test the QR decoder library, not
 * this app's code — so a dedicated scan e2e is intentionally not written
 * here; the scan path's own input handling is covered by
 * `tests/unit/cards/addContactCardWiring.test.ts` (`normaliseScanPayload`).
 *
 * No relay traffic — card exchange is entirely out-of-band (AC-SEC-1), so
 * this spec runs in the non-relay bucket (`make test-e2e-fast`).
 */
import { test, expect } from '@playwright/test';
import { USER_A, USER_B, computeTestKeypairs } from './helpers/auth-helpers';
import { bootIdentity, getShareCardLink } from './helpers/contact-card';

test.describe('Add contact via pasted card link (AC-UX-1 / AC-UX-2)', () => {
  test.beforeAll(async () => {
    await computeTestKeypairs();
  });

  test('pasting a real card link adds the contact and renders it by nickname, not npub', async ({ browser }) => {
    const sharer = await bootIdentity(browser, USER_B, 'CardBob');
    const cardLink = await getShareCardLink(sharer.page);
    expect(cardLink).toMatch(/^https:\/\/few\.chat\/add#c=.+/);

    const adder = await bootIdentity(browser, USER_A);
    await adder.page.goto('/contacts');
    await expect(adder.page.getByTestId('contacts-page')).toBeVisible({ timeout: 15_000 });

    await adder.page.getByTestId('add-contact-btn').click();
    await expect(adder.page.getByTestId('add-contact-modal-content')).toBeVisible();
    await adder.page.getByTestId('add-contact-npub-input').fill(cardLink);
    await adder.page.getByTestId('add-contact-submit-btn').click();
    await expect(adder.page.getByTestId('add-contact-success')).toBeVisible();

    // Re-navigate rather than waiting out the modal's own auto-close timer —
    // the add already landed synchronously by the time the success alert
    // rendered (processContactInput returns before setSuccess(true)).
    await adder.page.goto('/contacts');
    const contactCard = adder.page.getByTestId(`contact-card-${USER_B.pubkeyHex}`);
    await expect(contactCard).toBeVisible();
    // AC-UX-1: the card's nickname populates the new contact (not the
    // no-profile fallback ProfileSummary uses for a bare-npub add).
    await expect(contactCard).toContainText('CardBob');
    await expect(contactCard).not.toContainText('npub1');

    await sharer.context.close();
    await adder.context.close();
  });
});
