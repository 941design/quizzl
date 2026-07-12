/**
 * E2E: direct-contact profile exchange — self-heal loop convergence
 * (AC-PROF-7). Epic: direct-contact-profile-exchange, story S08.
 *
 * Named `dm-profile-self-heal.spec.ts` — deliberately NOT `dm-self-heal*`,
 * which already exists (`dm-self-heal.spec.ts`) for an unrelated DM
 * message-content self-heal feature (architecture.md / exploration.json
 * naming-collision note).
 *
 * ── Why this test clears the cache after a real pairing ──────────────────
 * Story S06 already fires an immediate `profile-announce` on BOTH sides at
 * pairing admission time (announce-on-pair). A REAL pairing therefore
 * already leaves both contacts with a complete `{name, avatar}` entry for
 * each other within seconds — which would make an anchor built directly on
 * top of pairing pass even if the periodic PULL loop (scheduler.ts + story
 * S05's `ProfileHealWatcher`) were completely broken. To exercise the loop
 * specifically, this spec:
 *
 *   1. Pairs A and B for real via the card flow, so they are genuinely
 *      mutual, active, non-archived contacts (that half of AC-PROF-7's
 *      precondition is real, not simulated).
 *   2. Clears each side's OWN `contactCache.ts` entry for the other peer
 *      directly in localStorage (`lp_contactCache_v1`) — simulating "the
 *      announce never landed / the cache was lost on this device" without
 *      touching `lp_contacts_v1` (the contact relationship itself is
 *      untouched) and without any re-add/re-scan (both explicitly forbidden
 *      by AC-PROF-7). This is a local-state-only tamper, never a relay
 *      publish, mirroring this repo's existing idb/localStorage-seed
 *      convention (`helpers/pairing.ts`, `dm-self-heal.spec.ts`'s
 *      `seedMalformedRow`).
 *   3. Seeds a DUE-NOW schedule entry on both sides via the AC-E2E-1 test
 *      hook (`seedDueProfileSchedule`) and reloads, so `ProfileHealWatcher`'s
 *      MOUNT-triggered due-sweep (AC-WATCH-1) fires a real
 *      `sendProfileRequest` immediately instead of waiting out the real 1h
 *      backoff floor.
 *   4. Asserts BOTH sides converge to a complete `{name, avatar}`
 *      contact-list entry for the other, driven by the loop alone.
 *
 * Requires the strfry relay harness: make e2e-up (or make test-e2e-groups).
 * Run: E2E_GROUPS=1 node scripts/run-e2e.mjs tests/e2e/dm-profile-self-heal.spec.ts
 */
import { test, expect } from '@playwright/test';
import { USER_A, USER_B, computeTestKeypairs } from './helpers/auth-helpers';
import { bootIdentity, getShareCardLink, extractCardPayload } from './helpers/contact-card';
import { waitForAdmission } from './helpers/pairing';
import { seedDueProfileSchedule } from './helpers/idb-record';
import { clearContactCacheEntry, assertContactConverged } from './helpers/dm-profile';

test.describe('DM profile exchange: self-heal loop convergence (AC-PROF-7)', () => {
  test.beforeAll(async () => {
    await computeTestKeypairs();
  });

  test.afterEach(async ({ browser }) => {
    await Promise.all(browser.contexts().map((c) => c.close()));
  });

  test(
    'two mutual contacts with a lost profile cache converge to complete {name, avatar} via the periodic loop alone',
    async ({ browser }) => {
      // ── 1. Real pairing (card flow) — genuine mutual, active, non-archived
      // contacts on both sides. ──────────────────────────────────────────
      const a = await bootIdentity(browser, USER_A, 'Alice-Heal');
      const cardLink = await getShareCardLink(a.page);
      const payload = extractCardPayload(cardLink);

      const b = await bootIdentity(browser, USER_B, 'Bob-Heal');
      await b.page.goto(`/add#c=${payload}`);
      await expect(b.page.getByTestId('contact-added-success')).toBeVisible({ timeout: 20_000 });

      await a.page.goto('/contacts');
      const admitted = await waitForAdmission(a.page, USER_B.pubkeyHex, 90_000);
      expect(admitted, 'A must admit B via the real pairing-ack before the self-heal setup begins').toBe(true);
      await b.page.goto('/contacts');

      // ── 2. Simulate a lost profile cache on BOTH sides — the precondition
      // AC-PROF-7 exists to heal. lp_contacts_v1 (the contact relationship)
      // is left untouched; only the cached name/avatar is cleared. ────────
      await clearContactCacheEntry(a.page, USER_B.pubkeyHex);
      await clearContactCacheEntry(b.page, USER_A.pubkeyHex);

      // ── 3. Seed a due-now schedule on both sides and reload, so the
      // MOUNT-triggered sweep (AC-WATCH-1) fires immediately instead of
      // waiting out the real 1h floor. ───────────────────────────────────
      const nowSec = Math.floor(Date.now() / 1000);
      await seedDueProfileSchedule(a.page, {
        pubkeyHex: USER_B.pubkeyHex,
        nextAttemptAt: nowSec - 10,
        attempts: 1,
        state: 'active',
      });
      await seedDueProfileSchedule(b.page, {
        pubkeyHex: USER_A.pubkeyHex,
        nextAttemptAt: nowSec - 10,
        attempts: 1,
        state: 'active',
      });

      await a.page.reload();
      await b.page.reload();

      // ── 4. Both sides converge to a complete {name, avatar} entry for the
      // other, via the loop alone — no manual re-add, no re-scan, no direct
      // relay publish anywhere in this test. ─────────────────────────────
      await assertContactConverged(a.page, USER_B.pubkeyHex, 'Bob-Heal', 120_000);
      await assertContactConverged(b.page, USER_A.pubkeyHex, 'Alice-Heal', 120_000);
    },
  );
});
