/**
 * E2E: `/add#c=` deep-link — AC-UX-3 / AC-UX-7 (epic: contact-card-exchange, story S7).
 *
 * Two scenarios, both driven by a REAL signed card link produced by USER_B's
 * actual Settings share action (never a hand-built card):
 *
 *  - AC-UX-3: a visitor who already has a local identity opens
 *    `/add#c=<card>` on a fresh direct load. The card is read from
 *    `window.location.hash` (never a `?c=` query param — DD 9).
 *  - AC-UX-7: a visitor with NO local identity opens the same link. The app
 *    auto-generates an identity (NostrIdentityContext — there is no separate
 *    onboarding wizard) and, once hydrated, resumes exactly where AC-UX-3
 *    resumes. The card survives that wait and is never transmitted anywhere
 *    (AC-SEC-1 holds throughout — the fragment is never sent to the server
 *    in either case).
 *
 * UPDATED (epic: contact-pairing-code, story S6) — v1-only assumption fix:
 * this suite's ORIGINAL assertion was that a successful add always redirects
 * straight to `/contacts?id=…&added=1` with no intermediate stop. That is no
 * longer universally true: the Profile Share action now ALWAYS emits a v2
 * PAIRING card (RD-1, "replace the current card"), and a NAMELESS scanner
 * opening a live (unexpired) v2 code is durably queued and redirected to
 * name setup BEFORE landing on the contact (S4, RD-7, AC-SCAN-5) — the old
 * "always lands directly on the contact" assumption held only for a v1
 * identity-only card, which this surface no longer produces. Both visitors
 * below were originally booted WITHOUT a nickname (by design, to isolate the
 * hash-parsing behavior from any name-entry concern), so both now hit that
 * exact redirect. The underlying one-directional add this suite actually
 * exists to verify (VQ-S7: single hash-parse, correct pubkeyHex resolved)
 * still completes synchronously either way — asserted below via the
 * visitor's own persisted contacts, not just the URL/redirect target. Full
 * mutual-pairing completion via name setup (the deferred echo actually
 * firing) is covered end-to-end by the relay-bucket
 * dm-pairing-onboarding-scanner.spec.ts; this spec stays in the non-relay
 * bucket and asserts no further than the redirect + the completed
 * one-directional add, since observing the pairing echo itself needs a live
 * relay.
 *
 * No relay traffic — card exchange and the redirect decision are both
 * entirely out-of-band (a nameless scanner's `attemptOrQueuePairingEcho`
 * short-circuits on `hasShareableName` BEFORE any NDK connect/publish), so
 * this spec stays in the non-relay bucket (`make test-e2e-fast`).
 */
import { test, expect } from '@playwright/test';
import { USER_A, USER_B, computeTestKeypairs } from './helpers/auth-helpers';
import { bootIdentity, getShareCardLink, extractCardPayload, newAnonymousContext } from './helpers/contact-card';

async function readContactPubkeysLocal(page: import('@playwright/test').Page): Promise<string[]> {
  return page.evaluate(() => {
    try {
      const raw = localStorage.getItem('lp_contacts_v1');
      return raw ? Object.keys(JSON.parse(raw) as Record<string, unknown>) : [];
    } catch {
      return [];
    }
  });
}

test.describe('/add deep link (AC-UX-3 / AC-UX-7)', () => {
  test.beforeAll(async () => {
    await computeTestKeypairs();
  });

  test('AC-UX-3: existing identity — direct load of /add#c=<card> parses the hash, completes the one-directional add, and (nameless) redirects to pairing name setup (RD-7)', async ({ browser }) => {
    const sharer = await bootIdentity(browser, USER_B, 'DeepLinkBob');
    const cardLink = await getShareCardLink(sharer.page);
    const payload = extractCardPayload(cardLink);

    // Deliberately nameless (as originally) — isolates hash-parsing from any
    // name-entry concern, and is exactly the case a live v2 code now detours
    // through name setup for (see file header).
    const visitor = await bootIdentity(browser, USER_A);
    // Fresh direct load (not a client-side navigation) with the card only in
    // the URL fragment — AC-UX-3 requires this to resolve identically to a
    // reload, and the fragment is never sent to the server.
    await visitor.page.goto(`/add#c=${payload}`);

    // The one-directional add completes synchronously under the hood BEFORE
    // the redirect decision is made (add.tsx calls notifyKnownPeersChanged()
    // ahead of branching on pairingEcho) — assert it directly via storage
    // rather than the (now-redirected-away-from) contact page.
    await expect.poll(() => readContactPubkeysLocal(visitor.page), { timeout: 15_000 }).toContain(USER_B.pubkeyHex);

    // Nameless + a live v2 pairing code → redirected to name setup (AC-SCAN-5)
    // rather than landing directly on the contact.
    // Next.js's static-export trailing-slash convention renders this as
    // `/profile/?pairing=1…` — match on the query string, not a literal
    // `/profile?` (no slash) prefix.
    await expect(visitor.page).toHaveURL(new RegExp(`pairing=1&issuer=${USER_B.pubkeyHex}`));
    await expect(visitor.page.getByTestId('profile-pairing-name-setup-prompt')).toBeVisible({ timeout: 15_000 });

    await sharer.context.close();
    await visitor.context.close();
  });

  test('AC-UX-7: no local identity — /add#c=<card> auto-onboards, completes the one-directional add, and (nameless) redirects to pairing name setup (RD-7)', async ({ browser }) => {
    const sharer = await bootIdentity(browser, USER_B, 'OnboardBob');
    const cardLink = await getShareCardLink(sharer.page);
    const payload = extractCardPayload(cardLink);

    const { context, page } = await newAnonymousContext(browser);
    // No identity seeded at all — NostrIdentityContext generates one on
    // first mount. The page shows a brief "setting up" state
    // (add-page-setting-up) until hydration flips true, then completes the
    // one-directional add using the just-generated (nameless) identity.
    await page.goto(`/add#c=${payload}`);

    await expect.poll(() => readContactPubkeysLocal(page), { timeout: 20_000 }).toContain(USER_B.pubkeyHex);

    // The freshly auto-generated identity has no nickname yet, so the SAME
    // live-v2-code detour as AC-UX-3 applies: redirect to name setup rather
    // than landing on the contact (see file header for why this superseded
    // the original direct-landing assertion).
    // Next.js's static-export trailing-slash convention renders this as
    // `/profile/?pairing=1…` — match on the query string, not a literal
    // `/profile?` (no slash) prefix.
    await expect(page).toHaveURL(new RegExp(`pairing=1&issuer=${USER_B.pubkeyHex}`));
    await expect(page.getByTestId('profile-pairing-name-setup-prompt')).toBeVisible({ timeout: 15_000 });

    await sharer.context.close();
    await context.close();
  });
});
