/**
 * E2E: `/add#c=` deep-link — AC-UX-3 / AC-UX-7 (epic: contact-card-exchange, story S7).
 *
 * Two scenarios, both driven by a REAL signed card link produced by USER_B's
 * actual Settings share action (never a hand-built card):
 *
 *  - AC-UX-3: a visitor who already has a local identity opens
 *    `/add#c=<card>` on a fresh direct load. The card is read from
 *    `window.location.hash` (never a `?c=` query param — DD 9) and the add
 *    completes. `/add` is not a visible stop: it redirects to
 *    `/contacts?id=<pubkeyHex>&added=1` and the green confirmation renders on
 *    the selected contact's page.
 *  - AC-UX-7: a visitor with NO local identity opens the same link. The app
 *    auto-generates an identity (NostrIdentityContext — there is no separate
 *    onboarding wizard) and, once hydrated, completes the add — then redirects
 *    to the selected contact just as in AC-UX-3. The card survives that wait
 *    and is never transmitted anywhere (AC-SEC-1 holds throughout — the
 *    fragment is never sent to the server in either case).
 *
 * No relay traffic — card exchange is entirely out-of-band, so this spec
 * runs in the non-relay bucket (`make test-e2e-fast`).
 */
import { test, expect } from '@playwright/test';
import { USER_A, USER_B, computeTestKeypairs } from './helpers/auth-helpers';
import { bootIdentity, getShareCardLink, extractCardPayload, newAnonymousContext } from './helpers/contact-card';

test.describe('/add deep link (AC-UX-3 / AC-UX-7)', () => {
  test.beforeAll(async () => {
    await computeTestKeypairs();
  });

  test('AC-UX-3: existing identity — direct load of /add#c=<card> parses the hash and completes the add', async ({ browser }) => {
    const sharer = await bootIdentity(browser, USER_B, 'DeepLinkBob');
    const cardLink = await getShareCardLink(sharer.page);
    const payload = extractCardPayload(cardLink);

    const visitor = await bootIdentity(browser, USER_A);
    // Fresh direct load (not a client-side navigation) with the card only in
    // the URL fragment — AC-UX-3 requires this to resolve identically to a
    // reload, and the fragment is never sent to the server.
    await visitor.page.goto(`/add#c=${payload}`);
    // The /add page is not a visible stop: on a successful add it redirects
    // straight to the selected contact and the green confirmation renders
    // there, not on /add.
    await expect(visitor.page.getByTestId('contact-added-success')).toBeVisible({ timeout: 15_000 });
    await expect(visitor.page).toHaveURL(new RegExp(`id=${USER_B.pubkeyHex}&added=1`));
    await expect(visitor.page.getByTestId('contact-detail-page')).toContainText('DeepLinkBob');

    await sharer.context.close();
    await visitor.context.close();
  });

  test('AC-UX-7: no local identity — /add#c=<card> auto-onboards then completes the add', async ({ browser }) => {
    const sharer = await bootIdentity(browser, USER_B, 'OnboardBob');
    const cardLink = await getShareCardLink(sharer.page);
    const payload = extractCardPayload(cardLink);

    const { context, page } = await newAnonymousContext(browser);
    // No identity seeded at all — NostrIdentityContext generates one on
    // first mount. The page shows a brief "setting up" state
    // (add-page-setting-up) until hydration flips true, then completes the
    // add using the just-generated identity.
    await page.goto(`/add#c=${payload}`);
    // After auto-onboarding completes the add, the page redirects to the
    // selected contact and the green confirmation renders on the contacts page.
    await expect(page.getByTestId('contact-added-success')).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(new RegExp(`id=${USER_B.pubkeyHex}&added=1`));
    await expect(page.getByTestId('contact-detail-page')).toContainText('OnboardBob');

    await sharer.context.close();
    await context.close();
  });
});
