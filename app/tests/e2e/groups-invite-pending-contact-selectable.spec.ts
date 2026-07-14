// E2E: pending-invitee is treated as already-member (epic: invite-group-member-from-contacts, S3)
//
// Covers AC-E2E-8. Originally written to assert the opposite (a pending
// invitee stays selectable so the admin can re-invite) — that assertion was
// FALSIFIED by running this test live against the real app: `inviteByNpub`
// (MarmotContext.tsx) commits the invitee into `group.memberPubkeys`
// synchronously as part of the MLS `inviteByKeyPackageEvent` call, before the
// invitee ever accepts. So from the picker's `already_member` check
// (AC-ERR-1, matched against `group.memberPubkeys`), a just-invited contact
// is indistinguishable from a fully-joined one — confirmed with the user
// 2026-07-14 (see spec.md DD-4) to ship as the correct, intended behavior
// rather than build out the additional data-flow needed to restore a
// re-invite path (tracked as a follow-up finding).
//
// This test now asserts the corrected, verified-real behavior: after Alice
// invites Bob, Bob's picker option becomes disabled with the "already in
// group" reason (identical to any other already-member contact, AC-UX-2),
// and Alice cannot re-select or resubmit him. Carol is also seeded so the
// picker still renders (not the guidance state) — this isolates "Bob
// specifically is disabled" from "Alice has no contacts at all."
//
// Rule: all group/contact/invite actions are driven through the app UI via
// two real browser contexts — no raw WebSocket, no hand-signed events.

import { test, expect, BrowserContext, Page } from '@playwright/test';
import { USER_A, USER_B, USER_C, computeTestKeypairs } from './helpers/auth-helpers';
import { clearAppState } from './helpers/clear-state';
import { dismissErrorOverlay, suppressErrorOverlay } from './helpers/dismiss-error-overlay';
import { inviteContactViaPicker, seedContact } from './helpers/group-setup';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3100';
const GROUP_NAME = 'Pending Contact Selectable Group';

async function bootUser(
  browser: { newContext: (opts: object) => Promise<BrowserContext> },
  user: typeof USER_A,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL: BASE_URL });
  await suppressErrorOverlay(context);
  await context.addInitScript(({ privateKeyHex, pubkeyHex, seedHex }) => {
    localStorage.setItem('lp_nostrIdentity_v1', JSON.stringify({ privateKeyHex, pubkeyHex, seedHex }));
  }, { privateKeyHex: user.privateKeyHex, pubkeyHex: user.pubkeyHex, seedHex: user.seedHex });
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

test.describe.serial('Pending invitee is treated as already-member', () => {
  let ctxA: BrowserContext;
  let ctxB: BrowserContext;
  let pageA: Page;
  let pageB: Page;

  test.beforeAll(async ({ browser }) => {
    await computeTestKeypairs();
    ({ context: ctxA, page: pageA } = await bootUser(browser, USER_A));
    // Bob's context only exists so his identity publishes a KeyPackage —
    // he never accepts the invitation, staying pending throughout.
    ({ context: ctxB, page: pageB } = await bootUser(browser, USER_B));
  });

  test.afterAll(async () => {
    await ctxA?.close();
    await ctxB?.close();
  });

  test('A creates a group, seeds Carol, and invites Bob', async () => {
    await pageA.getByTestId('create-group-btn').click();
    await expect(pageA.getByTestId('create-group-modal-content')).toBeVisible();
    await pageA.getByTestId('create-group-name-input').fill(GROUP_NAME);
    await pageA.getByTestId('create-group-submit-btn').click();
    await expect(pageA.getByText(GROUP_NAME)).toBeVisible({ timeout: 30_000 });
    await expect(pageA.getByTestId('create-group-modal-content')).not.toBeVisible({ timeout: 10_000 });
    await dismissErrorOverlay(pageA);

    // Seed Carol as a second contact so the picker still has a selectable
    // option after Bob becomes already-member — isolates "Bob is disabled"
    // from "the guidance state shows because Alice has zero contacts".
    await seedContact(pageA, USER_C.npub);

    // seedContact leaves the page on /add's post-add redirect, not /groups/
    // — navigate back before looking for the group card.
    await pageA.goto('/groups/');
    await expect(
      pageA.getByTestId('groups-empty-state').or(pageA.getByTestId('groups-list')),
    ).toBeVisible({ timeout: 30_000 });

    // Wait for B to publish KeyPackages before the first invite.
    await pageB.waitForTimeout(5_000);

    await pageA.locator(`[data-testid^="group-card-"]`, { hasText: GROUP_NAME }).click();
    await expect(pageA.getByTestId('group-detail-page')).toBeVisible({ timeout: 30_000 });

    await inviteContactViaPicker(pageA, USER_B.npub);
    await expect(pageA.getByTestId('invite-success')).toBeVisible({ timeout: 60_000 });

    // Modal auto-closes ~1.5s after success.
    await expect(pageA.getByTestId('invite-member-modal-content')).not.toBeVisible({ timeout: 10_000 });
  });

  test("AC-E2E-8: B's option becomes disabled (already in group) and cannot be re-submitted", async () => {
    // B never accepted — reopen the invite modal on A's side.
    await pageA.getByTestId('invite-member-btn').click();
    await expect(pageA.getByTestId('invite-member-modal-content')).toBeVisible();

    const select = pageA.getByTestId('invite-contact-select');
    await expect(select).toBeVisible({ timeout: 10_000 });

    // Bob is now already-member (memberPubkeys updated synchronously by the
    // successful invite) — disabled, same reason as any other member.
    const bobOption = select.locator(`option[value="${USER_B.pubkeyHex}"]`);
    await expect(bobOption).toBeAttached({ timeout: 10_000 });
    await expect(bobOption).toBeDisabled();

    // Carol remains selectable — confirms the picker itself still renders
    // (this isn't the zero-selectable guidance state).
    const carolOption = select.locator(`option[value="${USER_C.pubkeyHex}"]`);
    await expect(carolOption).toBeAttached({ timeout: 10_000 });
    await expect(carolOption).toBeEnabled();

    // Attempting to select Bob cannot lead to a submission — see
    // groups-error-cases.spec.ts's AC-E2E-5 test for why this asserts via
    // the submit button (the app's isSelectionValid guard) rather than via
    // toHaveValue on the <select>: Playwright's selectOption can force-set
    // a disabled <option>'s value even though native user interaction can't.
    await select.selectOption({ value: USER_B.pubkeyHex }).catch(() => {});
    await expect(pageA.getByTestId('invite-submit-btn')).toBeDisabled();
    await expect(pageA.getByTestId('invite-error')).not.toBeVisible();
    await expect(pageA.getByTestId('invite-success')).not.toBeVisible();
  });
});
