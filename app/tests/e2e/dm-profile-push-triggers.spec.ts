/**
 * E2E: direct-contact profile exchange — push-trigger complements
 * (AC-PROF-11b: announce-on-pair + announce-on-change). Epic:
 * direct-contact-profile-exchange, story S08.
 *
 * Complements `dm-profile-self-heal.spec.ts` (AC-PROF-7, the PULL loop) by
 * proving the PUSH side of the same feature: a real pairing gives both sides
 * the other's avatar immediately (no `seedDueProfileSchedule`, no backoff
 * wait at all — this is the opposite setup from the self-heal spec, which
 * deliberately clears the cache to force reliance on the pull loop), and a
 * later profile edit propagates to an already-complete contact via a push,
 * with no request sent by the receiving side.
 *
 * Everything is driven through the real app: the card-share/scan flow, and
 * editing the nickname field, exactly as a user would.
 *
 * Requires the strfry relay harness: make e2e-up (or make test-e2e-groups).
 * Run: E2E_GROUPS=1 node scripts/run-e2e.mjs tests/e2e/dm-profile-push-triggers.spec.ts
 */
import { test, expect } from '@playwright/test';
import { USER_A, USER_B, computeTestKeypairs } from './helpers/auth-helpers';
import { bootIdentity, getShareCardLink, extractCardPayload } from './helpers/contact-card';
import { waitForAdmission } from './helpers/pairing';
import { assertContactConverged } from './helpers/dm-profile';

test.describe('DM profile exchange: push-trigger complements (AC-PROF-11b)', () => {
  test.beforeAll(async () => {
    await computeTestKeypairs();
  });

  test.afterEach(async ({ browser }) => {
    await Promise.all(browser.contexts().map((c) => c.close()));
  });

  test(
    'pairing pushes a complete profile both ways immediately (incl. the issuer showing the scanner\'s submitted name), and a later edit propagates without a request',
    async ({ browser }) => {
      // ── 1. Real pairing (card flow). ────────────────────────────────────
      const a = await bootIdentity(browser, USER_A, 'Alice-Push');
      const cardLink = await getShareCardLink(a.page);
      const payload = extractCardPayload(cardLink);

      const b = await bootIdentity(browser, USER_B, 'Bob-Push');
      await b.page.goto(`/add#c=${payload}`);
      await expect(b.page.getByTestId('contact-added-success')).toBeVisible({ timeout: 20_000 });

      await a.page.goto('/contacts');
      const admitted = await waitForAdmission(a.page, USER_B.pubkeyHex, 90_000);
      expect(admitted, 'A must admit B via the real pairing-ack').toBe(true);

      // ── 2. Pairing-instant profile (announce-on-pair, AC-PROF-11b): both
      // sides reach a complete {name, avatar} entry for the other WITHOUT
      // waiting the ~1h backoff floor and WITHOUT seedDueProfileSchedule —
      // this is the push path, not the pull loop dm-profile-self-heal.spec.ts
      // exercises. The issuer (A) showing the scanner's (B's) submitted name
      // here is the epic's §10.1 fix landing alongside the announce push.
      await assertContactConverged(a.page, USER_B.pubkeyHex, 'Bob-Push', 45_000);
      await assertContactConverged(b.page, USER_A.pubkeyHex, 'Alice-Push', 45_000);

      // ── 3. Edit propagation (announce-on-change, AC-PROF-11b): A edits its
      // nickname; B's cached profile for A updates via the pushed announce
      // alone — B performs no action of its own (no request, no re-scan). ──
      await a.page.goto('/profile');
      await a.page.getByTestId('profile-nickname-input').fill('Alice-Push-Renamed');
      await a.page.getByTestId('profile-nickname-input').blur();

      await assertContactConverged(b.page, USER_A.pubkeyHex, 'Alice-Push-Renamed', 45_000);
    },
  );
});
