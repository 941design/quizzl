// E2E: Invite modal guidance state (epic: invite-group-member-from-contacts, S3)
//
// Covers AC-E2E-7: when the AC-STRUCT-1 predicate's output contains zero
// `selectable: true` entries, InviteMemberModal.tsx renders the guidance
// message + `/contacts` link INSTEAD OF the row-based `invite-contact-list`
// picker.
//
// The zero-selectable precondition is constructed deliberately, not
// incidentally: a contact IS seeded (proving listContacts() and the
// predicate actually ran against real local storage, not an empty/unfetched
// state), but that contact is then blocked, so the predicate's output has
// exactly one entry with `selectable: false`. This is a stronger precondition
// than "a brand-new user with literally zero contacts", which the guidance
// state would also satisfy but which cannot distinguish "predicate correctly
// filtered everyone out" from "contacts never loaded at all".
//
// Rule: all group/contact actions are driven through the app UI on a single
// page — no raw WebSocket, no direct localStorage contact writes.

import { test, expect } from '@playwright/test';
import { injectIdentity, USER_A, USER_B, computeTestKeypairs } from './helpers/auth-helpers';
import { clearAppState } from './helpers/clear-state';
import { suppressErrorOverlay } from './helpers/dismiss-error-overlay';
import { seedContact } from './helpers/group-setup';

test.describe('Invite modal guidance state', () => {
  test.beforeEach(async ({ page, context }) => {
    await computeTestKeypairs();
    await suppressErrorOverlay(context);
    await page.goto('/');
    await clearAppState(page);
    await injectIdentity(page, USER_A);
    await page.reload();
    await page.goto('/groups/');
    await expect(
      page.getByTestId('groups-empty-state').or(page.getByTestId('groups-list')),
    ).toBeVisible({ timeout: 60_000 });
  });

  test('AC-E2E-7: zero selectable contacts shows guidance state, not the picker', async ({ page }) => {
    // Seed Bob as a contact, then block him — the ONLY contact Alice has is
    // now disabled, so the predicate's output is zero-selectable.
    await seedContact(page, USER_B.npub);

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
    await page.getByTestId('create-group-name-input').fill('Guidance State Group');
    await page.getByTestId('create-group-submit-btn').click();
    await expect(page.getByText('Guidance State Group')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('create-group-modal-content')).not.toBeVisible({ timeout: 10_000 });

    await page.locator(`[data-testid^="group-card-"]`, { hasText: 'Guidance State Group' }).click();
    await expect(page.getByTestId('group-detail-page')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('invite-member-btn').click();
    await expect(page.getByTestId('invite-member-modal-content')).toBeVisible();

    // Guidance state renders...
    await expect(page.getByTestId('invite-guidance-state')).toBeVisible({ timeout: 10_000 });
    const guidanceLink = page.getByTestId('invite-guidance-link');
    await expect(guidanceLink).toBeVisible();
    // Next.js static-export trailingSlash config appends a trailing slash to
    // internal links (confirmed project convention — see other e2e specs'
    // /contacts/, /groups/, /add/ assertions).
    await expect(guidanceLink).toHaveAttribute('href', '/contacts/');

    // ...and the picker does not, scoped to the modal (mirrors AC-UX-7's
    // scoped-absence pattern).
    await expect(
      page.locator('[data-testid="invite-member-modal-content"] [data-testid="invite-contact-list"]'),
    ).toHaveCount(0);

    // Submit stays disabled/unusable while nothing is selectable.
    await expect(page.getByTestId('invite-submit-btn')).toBeDisabled();

    // The link actually navigates to /contacts (behavioral, not just an
    // attribute check).
    await guidanceLink.click();
    await expect(page.getByTestId('contacts-page')).toBeVisible({ timeout: 15_000 });
  });
});
