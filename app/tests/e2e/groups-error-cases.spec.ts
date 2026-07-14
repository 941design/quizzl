import { test, expect } from '@playwright/test';
import { injectIdentity, USER_A, USER_B, USER_C, computeTestKeypairs } from './helpers/auth-helpers';
import { clearAppState } from './helpers/clear-state';
import { suppressErrorOverlay } from './helpers/dismiss-error-overlay';
import { inviteContactViaPicker, seedContact } from './helpers/group-setup';

test.describe('Groups Error Cases', () => {
  test.beforeEach(async ({ page, context }) => {
    await computeTestKeypairs();
    await suppressErrorOverlay(context);
    await page.goto('/');
    await clearAppState(page);
    await injectIdentity(page, USER_A);
    await page.reload();
    // Navigate to groups and wait for initialization
    await page.goto('/groups/');
    await expect(
      page.getByTestId('groups-empty-state').or(page.getByTestId('groups-list')),
    ).toBeVisible({ timeout: 60_000 });
  });

  test('Invite without KeyPackage shows error', async ({ page }) => {
    // Create a group first
    await page.getByTestId('create-group-btn').click();
    await expect(page.getByTestId('create-group-modal-content')).toBeVisible();
    await page.getByTestId('create-group-name-input').fill('Error Test Group');
    await page.getByTestId('create-group-submit-btn').click();
    await expect(page.getByText('Error Test Group')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('create-group-modal-content')).not.toBeVisible({ timeout: 10_000 });

    // Open group detail, seed a valid-format npub that has no KeyPackages on
    // relay as a contact, then try to invite it via the picker (AC-E2E-4).
    // This npub decodes to a fixed, unused hex pubkey (dead00...00beef) that
    // has never published anything — it is NOT one of USER_A/B/C, so it is
    // guaranteed to have no KeyPackage. (A prior npub1qqq...sclkek literal
    // here had an invalid bech32 checksum — pre-existing, never previously
    // caught because the old npub-input-driven flow let the app's own
    // parseContactCard swallow the decode failure into a generic
    // invalid_npub result rather than throwing; this helper's npubToHex
    // calls nip19.decode directly and throws on a bad checksum, which
    // surfaced the latent bug once this test moved to the picker helper.)
    await page.locator(`[data-testid^="group-card-"]`, { hasText: 'Error Test Group' }).click();
    await expect(page.getByTestId('group-detail-page')).toBeVisible({ timeout: 30_000 });

    await inviteContactViaPicker(
      page,
      'npub1m6ksqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqhmhsmyk3s9',
    );

    await expect(page.getByTestId('invite-error')).toBeVisible({ timeout: 30_000 });
  });

  // Replaces the removed "Invalid npub format shows error" test (AC-E2E-5):
  // the npub free-text input this test used to drive no longer exists in
  // InviteMemberModal (AC-UX-7), so there is no reachable UI surface for an
  // "invalid npub string" scenario any more. The analogous "cannot invite
  // this target" behavior under the picker is a disabled contact — this test
  // blocks a seeded contact and asserts their <option> can neither be
  // selected nor submitted.
  test('AC-E2E-5: a blocked contact cannot be selected or submitted via the invite-contact-list row picker', async ({ page }) => {
    // Seed two contacts: Bob (blocked below) and Carol (stays selectable, so
    // the picker renders instead of the guidance state).
    await seedContact(page, USER_B.npub);
    await seedContact(page, USER_C.npub);

    // Block Bob via the real Profile block action (BlockContactButton).
    await page.goto(`/profile?pubkey=${USER_B.pubkeyHex}`);
    await expect(page.getByTestId('profile-archive')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('profile-archive').click();
    await expect(page.getByTestId('block-confirm-modal')).toBeVisible();
    await page.getByTestId('block-confirm-btn').click();
    await expect(page.getByTestId('block-confirm-modal')).not.toBeVisible({ timeout: 10_000 });

    // Create a group and open the invite modal.
    await page.goto('/groups/');
    await expect(
      page.getByTestId('groups-empty-state').or(page.getByTestId('groups-list')),
    ).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('create-group-btn').click();
    await expect(page.getByTestId('create-group-modal-content')).toBeVisible();
    await page.getByTestId('create-group-name-input').fill('Disabled Contact Group');
    await page.getByTestId('create-group-submit-btn').click();
    await expect(page.getByText('Disabled Contact Group')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('create-group-modal-content')).not.toBeVisible({ timeout: 10_000 });

    await page.locator(`[data-testid^="group-card-"]`, { hasText: 'Disabled Contact Group' }).click();
    await expect(page.getByTestId('group-detail-page')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('invite-member-btn').click();
    await expect(page.getByTestId('invite-member-modal-content')).toBeVisible();

    // Carol (selectable) keeps the picker rendered instead of the guidance state.
    const list = page.getByTestId('invite-contact-list');
    await expect(list).toBeVisible({ timeout: 10_000 });

    // Bob's row is present but non-interactive, carrying the blocked reason suffix.
    const bobRow = page.getByTestId(`invite-contact-row-${USER_B.pubkeyHex}`);
    await expect(bobRow).toBeAttached({ timeout: 10_000 });

    // Attempting to click the disabled row cannot lead to a submission.
    // NOTE: a picker row is a plain Box, not a native <select>/<option>, so
    // there is no DOM `disabled` attribute to assert against. A dispatched
    // click on the row must not be trusted to be inert just because the row
    // has no wired onClick handler — the load-bearing guarantee is that the
    // app's own isSelectionValid guard (entries.some(e => e.selectable &&
    // e.contact.pubkeyHex === selectedPubkeyHex)) keeps invite-submit-btn
    // disabled regardless of what the click dispatch did — asserted below.
    await bobRow.click().catch(() => {});
    await expect(page.getByTestId('invite-submit-btn')).toBeDisabled();
    await expect(page.getByTestId('invite-error')).not.toBeVisible();
    await expect(page.getByTestId('invite-success')).not.toBeVisible();
  });

  test('Offline indicator shown when network drops', async ({ page, context }) => {
    // Simulate going offline
    await context.setOffline(true);
    await page.evaluate(() => {
      window.dispatchEvent(new Event('offline'));
    });

    await expect(page.getByTestId('offline-banner')).toBeVisible({ timeout: 10_000 });

    // Restore
    await context.setOffline(false);
    await page.evaluate(() => {
      window.dispatchEvent(new Event('online'));
    });
  });
});
