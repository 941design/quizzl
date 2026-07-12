/**
 * E2E: direct-contact profile exchange — stranger gates (AC-PROF-3 request
 * gate, AC-PROF-4 announce gate). Epic: direct-contact-profile-exchange,
 * story S08. Security-critical.
 *
 * ── "Driven through the app" for a genuine stranger ───────────────────────
 * `send.ts#sendProfileRequest` is only ever invoked from `ProfileHealWatcher`'s
 * own due-sweep, over the SENDER's OWN incomplete-contact list;
 * `send.ts#sendProfileAnnounce` is only ever invoked from `profile.tsx`'s
 * `broadcastProfile` fan-out (over the SENDER's OWN active-contact list) or
 * from `pairingAck.ts`'s admission triggers. None of these requires the
 * TARGET to know or have added the sender first.
 *
 * So to make a genuine, real, unforged wire event arrive at a target A from
 * someone A never added, this spec seeds the STRANGER's OWN
 * `lp_contacts_v1` belief (never A's) that A is a contact — via
 * `seedLocalContact`, mirroring `helpers/pairing.ts`'s established
 * idb/localStorage-seed convention applied to the sender's own state — and
 * then lets the stranger's real app decide, on its own, to send. The
 * resulting `profile-request`/`profile-announce` is fully real: real key
 * material, real gift-wrap, real relay publish. A's own `isAllowedDmSender`
 * / `lp_contacts_v1` records are never touched by any test code, so A's
 * disclosure gate genuinely (not by any target-side tamper) has no record of
 * the stranger — exactly AC-PROF-3/4's precondition.
 *
 * Assertions read A's own local records directly (contactCache, contacts
 * list, schedule store) rather than a UI toast, per VQ-S08-005.
 *
 * Requires the strfry relay harness: make e2e-up (or make test-e2e-groups).
 * Run: E2E_GROUPS=1 node scripts/run-e2e.mjs tests/e2e/dm-profile-stranger-gates.spec.ts
 */
import { test, expect } from '@playwright/test';
import { USER_A, USER_B, computeTestKeypairs } from './helpers/auth-helpers';
import { bootIdentity } from './helpers/contact-card';
import { readIdbRecord, seedDueProfileSchedule } from './helpers/idb-record';
import { readContactCacheEntry, seedLocalContact, readContactsListPubkeys } from './helpers/dm-profile';

/** Fair window to give A's app to (incorrectly) act, before asserting it did not. Local strfry is fast; this is generous, not a race. */
const NEGATIVE_ASSERTION_MARGIN_MS = 10_000;

test.describe('DM profile exchange: stranger gates (AC-PROF-3, AC-PROF-4)', () => {
  test.beforeAll(async () => {
    await computeTestKeypairs();
  });

  test.afterEach(async ({ browser }) => {
    await Promise.all(browser.contexts().map((c) => c.close()));
  });

  test('stranger request gate: A answers no profile-announce to a sender it never added', async ({ browser }) => {
    const a = await bootIdentity(browser, USER_A, 'Alice-Stranger');
    await a.page.goto('/contacts'); // mounts ProfileHealWatcher + its inbound subscription

    const stranger = await bootIdentity(browser, USER_B, 'Stranger-Req');
    // Stranger's OWN belief that A is a contact — A never added the stranger.
    await seedLocalContact(stranger.page, USER_A.pubkeyHex);
    await seedDueProfileSchedule(stranger.page, {
      pubkeyHex: USER_A.pubkeyHex,
      nextAttemptAt: Math.floor(Date.now() / 1000) - 10,
      attempts: 1,
      state: 'active',
    });
    // Mount-triggered sweep fires a REAL sendProfileRequest addressed to A.
    await stranger.page.reload();

    await stranger.page.waitForTimeout(NEGATIVE_ASSERTION_MARGIN_MS);

    const strangerSideEntry = await readContactCacheEntry(stranger.page, USER_A.pubkeyHex);
    expect(
      strangerSideEntry?.avatar ?? null,
      'A must send no profile-announce reply to an unrecognized sender (AC-PROF-3)',
    ).toBeNull();

    // Belt-and-braces: A's own contact list gained no trace of the stranger.
    const aContacts = await readContactsListPubkeys(a.page);
    expect(aContacts.map((h) => h.toLowerCase())).not.toContain(USER_B.pubkeyHex.toLowerCase());
  });

  test('stranger announce gate: A stores nothing, gains no contact entry, and starts no schedule', async ({ browser }) => {
    const a = await bootIdentity(browser, USER_A, 'Alice-Stranger2');
    await a.page.goto('/contacts');

    const stranger = await bootIdentity(browser, USER_B, 'Stranger-Ann');
    // Stranger's OWN belief that A is a contact, then a REAL unsolicited push
    // via profile.tsx's real announce-on-change fan-out (editing their own
    // nickname) — A never requested anything and never added the stranger.
    await seedLocalContact(stranger.page, USER_A.pubkeyHex);
    await stranger.page.goto('/profile');
    await stranger.page.getByTestId('profile-nickname-input').fill('Stranger-Ann-Edited');
    await stranger.page.getByTestId('profile-nickname-input').blur();

    await a.page.waitForTimeout(NEGATIVE_ASSERTION_MARGIN_MS);

    const aCacheEntry = await readContactCacheEntry(a.page, USER_B.pubkeyHex);
    expect(aCacheEntry, 'A must not write a cache entry from an unrecognized sender (AC-PROF-4)').toBeNull();

    const aContacts = await readContactsListPubkeys(a.page);
    expect(
      aContacts.map((h) => h.toLowerCase()),
      'A must gain no new lp_contacts_v1 entry (no contact injection, AC-PROF-4)',
    ).not.toContain(USER_B.pubkeyHex.toLowerCase());

    const aSchedule = await readIdbRecord(a.page, 'few-dm-profile-schedule', 'schedules', USER_B.pubkeyHex.toLowerCase());
    expect(aSchedule, 'A must start/touch no schedule for the stranger (AC-PROF-4)').toBeNull();
  });
});
