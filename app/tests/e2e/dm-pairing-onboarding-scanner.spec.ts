/**
 * E2E: pairing — nameless onboarding scanner completes a deferred echo
 * automatically (AC-PAIR-10, AC-SCAN-5, AC-SCAN-6).
 *
 * Epic: contact-pairing-code, story S6. A scanner with NO prior identity or
 * profile opens a live pairing code cold: the app auto-generates a fresh
 * identity on mount, one-directionally adds the issuer immediately, then —
 * because the fresh identity has no name yet — redirects to
 * `/profile?pairing=1&issuer=…` instead of completing the echo right away
 * (AC-SCAN-5). The pending intent is durably persisted before that redirect,
 * so the moment the scanner sets a name the profile page's own edge-triggered
 * effect (profile.tsx's `hasShareableName` false->true transition) drains it
 * automatically (AC-SCAN-6) — no second scan, no manual retry action.
 *
 * Every step is driven through the real app: A's code via the real Profile
 * "Share contact card" action, B's identity via the app's own auto-generation
 * (a genuinely fresh, unseeded browser context), B's redirect via a real
 * `/add#c=…` navigation, and B's echo via genuinely filling the real
 * nickname input — never a hand-built event or a forced function call.
 *
 * Requires the strfry relay harness: make e2e-up (or make test-e2e-groups).
 * Run: E2E_GROUPS=1 node scripts/run-e2e.mjs tests/e2e/dm-pairing-onboarding-scanner.spec.ts
 */
import { test, expect } from '@playwright/test';
import { USER_A, computeTestKeypairs } from './helpers/auth-helpers';
import { bootIdentity, newAnonymousContext, getShareCardLink, extractCardPayload } from './helpers/contact-card';
import { waitForAdmission, readContactPubkeys } from './helpers/pairing';

test.describe('Pairing: nameless onboarding scanner completes a deferred echo (AC-PAIR-10)', () => {
  test.beforeAll(async () => {
    await computeTestKeypairs();
  });

  test.afterEach(async ({ browser }) => {
    await Promise.all(browser.contexts().map((c) => c.close()));
  });

  test(
    'a scanner with no prior identity is routed to name setup, and the deferred echo fires once a name is set',
    async ({ browser }) => {
      // ── 1. A (issuer) shares a real v2 pairing code. ────────────────────
      const a = await bootIdentity(browser, USER_A, 'Alice-Pairing');
      const cardLink = await getShareCardLink(a.page);
      const payload = extractCardPayload(cardLink);

      // ── 2. B is a completely fresh visitor — no identity, no profile
      // seeded at all. Opening the code makes the app auto-generate an
      // identity on mount (NostrIdentityContext), then — because that fresh
      // identity has no name yet — redirect to name setup (AC-SCAN-5). ────
      const b = await newAnonymousContext(browser);
      await b.page.goto(`/add#c=${payload}`);
      // Next.js's static-export trailing-slash convention renders this as
      // `/profile/?pairing=1…` — match on the query string, not a literal
      // `/profile?` (no slash) prefix (see contact-card-deeplink.spec.ts's
      // identical fix for the same underlying URL shape).
      await expect(b.page).toHaveURL(new RegExp('pairing=1&issuer='), { timeout: 20_000 });
      await expect(b.page.getByTestId('profile-pairing-name-setup-prompt')).toBeVisible({ timeout: 15_000 });

      // ── 3. Read B's freshly auto-generated pubkey — it wasn't seeded, the
      // app generated it, so the test doesn't know it ahead of time. ──────
      const bPubkeyHex: string = await b.page.evaluate(() => {
        const raw = localStorage.getItem('lp_nostrIdentity_v1');
        return raw ? (JSON.parse(raw) as { pubkeyHex: string }).pubkeyHex : '';
      });
      expect(bPubkeyHex).toMatch(/^[0-9a-f]{64}$/);

      // ── 4. B's one-directional add of A already completed under the hood
      // before the redirect decision (add.tsx's existing behavior). ───────
      const bContacts = await readContactPubkeys(b.page);
      expect(bContacts).toContain(USER_A.pubkeyHex);

      // ── 5. Complete onboarding: filling the nickname input alone already
      // flips hasShareableName true, which edge-triggers the profile page's
      // own effect that drains the held pending intent automatically. ─────
      await b.page.getByTestId('profile-nickname-input').fill('Onboarded-Bob');
      await b.page.getByTestId('profile-nickname-input').blur();

      // ── 6. A must auto-admit the onboarded scanner once it sets a name,
      // with no further scan on either side. ──────────────────────────────
      const admitted = await waitForAdmission(a.page, bPubkeyHex, 60_000);
      expect(admitted, 'A must admit the onboarded scanner once they set a name, with no further scan').toBe(true);
    },
  );
});
