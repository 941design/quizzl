/**
 * E2E: pending contact confirmation (epic: pending-contact-confirmation, S2)
 * — AC-MSG-1, AC-MSG-2, AC-OBS-1, AC-OBS-2, AC-UX-1, AC-UX-2.
 *
 * AC-OBS-2 was amended 2026-07-15 (spec.md `## Amendments`,
 * acceptance-criteria.md AC-OBS-2), after a Stage-1 review found the
 * original wording unsatisfiable: this app only persists a contact's
 * message content once their conversation has been opened at least once (a
 * pre-existing, out-of-epic-scope DM-pipeline property), so the bell cannot
 * reconcile held messages at `confirmContact` time — there is nothing
 * persisted yet to reconcile against. The amended AC instead requires the
 * held messages AND the bell to both catch up correctly the next time the
 * user OPENS the contact's conversation, within the same session (no
 * leave-and-re-enter required). Both tests below assert this end-to-end
 * after confirming: they navigate to the contact's conversation and check
 * both that the held messages render (already-existing coverage) AND that
 * the bell's badge count has cleared once the thread has been viewed — this
 * app's normal "opening a thread marks it read" behavior
 * (`ContactChat`'s `markDirectMessagesRead` mount effect), which is what
 * the amended AC-OBS-2 relies on rather than a special immediate-on-confirm
 * reconciliation. AC-OBS-1 (bell stays silent while still pending) is
 * covered separately, before confirm.
 *
 * Extends the contact-pairing-code epic's `dm-pairing-*.spec.ts` two-browser-
 * context pattern (`bootIdentity`, `getShareCardLink`, `waitForAdmission`).
 * A is the issuer (passive side, scanned by B) — the only side this epic
 * gives a pending contact. B is the scanner — admitted immediately,
 * unaffected by this epic (spec.md "Design Decisions" 1).
 *
 * Every action is driven through the real app: A's code via the real Profile
 * "Share contact card" action, B's scan via the real `/add#c=…` deep-link
 * entry point, every DM via `chat-input`/`chat-send-btn`, every
 * confirm/block action via its real button. No event is hand-signed or sent
 * via raw WebSocket (project CLAUDE.md e2e rule).
 *
 * Requires the strfry relay harness: make e2e-up (or make test-e2e-groups).
 * Run: E2E_GROUPS=1 node scripts/run-e2e.mjs tests/e2e/dm-pairing-pending-confirmation.spec.ts
 */
import { test, expect, Page } from '@playwright/test';
import { USER_A, USER_B, computeTestKeypairs } from './helpers/auth-helpers';
import { bootIdentity, getShareCardLink, extractCardPayload } from './helpers/contact-card';
import { waitForAdmission } from './helpers/pairing';

/**
 * Read a contact's `lastSeenAt` from `lp_contacts_v1` (contacts.ts /
 * STORAGE_KEYS.contacts). `rememberContact(peer)` bumps this on EVERY inbound
 * DM event the bell watcher processes — including one from a still-pending
 * peer, since `rememberContact` fires unconditionally ahead of the
 * pending-confirmation gate (spec.md, `directMessageNotifications.ts`
 * Technical Approach). Used as a proxy for "the live gift-wrap event reached
 * and was processed by A's bell watcher", without depending on message
 * CONTENT ever being locally persisted — see the note on
 * `waitForLastSeenAtBump` below for why content persistence is the wrong
 * signal here.
 */
async function readContactLastSeenAt(page: Page, peerHex: string): Promise<string | null> {
  return page.evaluate((hex) => {
    try {
      const raw = localStorage.getItem('lp_contacts_v1');
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Record<string, { lastSeenAt?: string }>;
      const entry = parsed[hex] ?? parsed[hex.toLowerCase()] ?? parsed[hex.toUpperCase()];
      return entry?.lastSeenAt ?? null;
    } catch {
      return null;
    }
  }, peerHex);
}

/** Read the notification bell's badge count (0 when the badge is absent). */
async function readBadgeCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const badge = document.querySelector('[data-testid="notification-badge"]');
    if (!badge) return 0;
    return parseInt((badge.textContent ?? '0').trim(), 10);
  });
}

test.describe('Pending contact confirmation — message hold, bell delay, confirmation UI', () => {
  test.beforeAll(async () => {
    await computeTestKeypairs();
  });

  test.afterEach(async ({ browser }) => {
    await Promise.all(browser.contexts().map((c) => c.close()));
  });

  test(
    'a pending contact\'s messages ring no bell (AC-OBS-1); the contacts-list confirm action clears the pending badge (AC-UX-1); no message is lost and the bell correctly clears once the thread is opened post-confirm (AC-MSG-1, AC-OBS-2)',
    async ({ browser }) => {
      // ── 1. A (issuer) shares a code; B (scanner) scans it once. B is
      // admitted immediately (unaffected by this epic); A ends up with a
      // PENDING contact for B. ─────────────────────────────────────────────
      const a = await bootIdentity(browser, USER_A, 'Alice-Pending-List');
      const cardLink = await getShareCardLink(a.page);
      const payload = extractCardPayload(cardLink);

      const b = await bootIdentity(browser, USER_B, 'Bob-Pending-List');
      await b.page.goto(`/add#c=${payload}`);
      await expect(b.page.getByTestId('contact-added-success')).toBeVisible({ timeout: 20_000 });

      await a.page.goto('/contacts');
      const admitted = await waitForAdmission(a.page, USER_B.pubkeyHex, 90_000);
      expect(admitted, 'A must auto-admit B from the pairing-ack (as a PENDING contact)').toBe(true);

      // ── 2. AC-UX-1: the contacts list shows B with the pending badge and
      // an explicit confirm action, distinct from the blocked badge. ──────
      await a.page.reload();
      await expect(a.page.getByTestId(`contact-pending-badge-${USER_B.pubkeyHex}`)).toBeVisible({ timeout: 15_000 });

      const baselineLastSeenAt = await readContactLastSeenAt(a.page, USER_B.pubkeyHex);

      // ── 3. B sends two DMs to A while A's B-contact is still pending. ──
      await b.page.goto(`/contacts?id=${USER_A.pubkeyHex}`);
      await expect(b.page.getByTestId('contact-detail-page')).toBeVisible({ timeout: 15_000 });
      const msg1 = `held-1-${Date.now()}`;
      await b.page.getByTestId('chat-input').fill(msg1);
      await b.page.getByTestId('chat-send-btn').click();
      await expect(b.page.locator('[data-testid^="msg-"]').filter({ hasText: msg1 })).toBeVisible({ timeout: 15_000 });
      const msg2 = `held-2-${Date.now()}`;
      await b.page.getByTestId('chat-input').fill(msg2);
      await b.page.getByTestId('chat-send-btn').click();
      await expect(b.page.locator('[data-testid^="msg-"]').filter({ hasText: msg2 })).toBeVisible({ timeout: 15_000 });

      // ── 4. AC-OBS-1: wait until A's LIVE bell watcher has genuinely
      // processed at least one of B's events — proven by `lastSeenAt`
      // advancing, since `rememberContact` fires unconditionally ahead of
      // the pending-confirmation gate — THEN assert the bell never bumped.
      // A's B-contact's message CONTENT is not expected to be locally
      // persisted yet at this point: like any brand-new DM thread (pending
      // or not), content is only fetched from the relay and persisted the
      // first time that peer's ContactChat mounts (see this repo's existing
      // dm-giftwrap-bell.spec.ts, which proves the bell bumps for a normal
      // contact via the SAME live-only path, with no IDB write required).
      await expect.poll(
        async () => readContactLastSeenAt(a.page, USER_B.pubkeyHex),
        { timeout: 30_000 },
      ).not.toBe(baselineLastSeenAt);
      expect(await readBadgeCount(a.page)).toBe(0);

      // ── 5. AC-UX-1: confirm from the LIST row. The pending badge clears
      // and B becomes an ordinary confirmed contact. ──────────────────────
      await a.page.getByTestId(`contact-pending-confirm-${USER_B.pubkeyHex}`).click();
      await expect(a.page.getByTestId(`contact-pending-badge-${USER_B.pubkeyHex}`)).not.toBeVisible({ timeout: 15_000 });

      // ── 6. AC-MSG-1: no message is lost — both DMs sent while B was
      // pending are still recoverable once A actually opens the thread
      // (this repo's existing historical-relay-fetch-on-open behavior,
      // unchanged by this epic per spec.md Design Decision 4). ───────────
      await a.page.goto(`/contacts?id=${USER_B.pubkeyHex}`);
      await expect(a.page.getByTestId('chat-input')).toBeVisible({ timeout: 20_000 });
      await expect(a.page.locator('[data-testid^="msg-"]').filter({ hasText: msg1 })).toBeVisible({ timeout: 20_000 });
      await expect(a.page.locator('[data-testid^="msg-"]').filter({ hasText: msg2 })).toBeVisible({ timeout: 15_000 });

      // ── 7. AC-OBS-2 (amended 2026-07-15): now that A has opened B's
      // conversation post-confirm, the bell must correctly reflect that
      // both held messages have been seen — i.e. the badge clears, via this
      // app's normal open-marks-read behavior (`ContactChat`'s
      // `markDirectMessagesRead` mount effect). This proves the confirm
      // path doesn't leave B's held messages permanently stuck as unread. ─
      await expect.poll(
        async () => readBadgeCount(a.page),
        { timeout: 15_000 },
      ).toBe(0);
    },
  );

  test(
    'detail view shows the confirmation prompt while pending; confirming swaps to the chat thread in place with held messages, and the bell clears once the thread is viewed (AC-UX-2, AC-MSG-2, AC-OBS-2)',
    async ({ browser }) => {
      const a = await bootIdentity(browser, USER_A, 'Alice-Pending-Detail');
      const cardLink = await getShareCardLink(a.page);
      const payload = extractCardPayload(cardLink);

      const b = await bootIdentity(browser, USER_B, 'Bob-Pending-Detail');
      await b.page.goto(`/add#c=${payload}`);
      await expect(b.page.getByTestId('contact-added-success')).toBeVisible({ timeout: 20_000 });

      await a.page.goto('/contacts');
      const admitted = await waitForAdmission(a.page, USER_B.pubkeyHex, 90_000);
      expect(admitted).toBe(true);

      // B sends one message to A while A's B-contact is pending.
      await b.page.goto(`/contacts?id=${USER_A.pubkeyHex}`);
      await expect(b.page.getByTestId('contact-detail-page')).toBeVisible({ timeout: 15_000 });
      const heldMsg = `detail-held-${Date.now()}`;
      await b.page.getByTestId('chat-input').fill(heldMsg);
      await b.page.getByTestId('chat-send-btn').click();
      await expect(b.page.locator('[data-testid^="msg-"]').filter({ hasText: heldMsg })).toBeVisible({ timeout: 15_000 });

      // AC-UX-2 (pre-confirm): A's detail view for B shows the confirmation
      // prompt IN PLACE OF ContactChat — no composer/chat-input reaches the
      // DOM while pending (mirrors the existing Blocked-banner precedent).
      await a.page.goto(`/contacts?id=${USER_B.pubkeyHex}`);
      await expect(a.page.getByTestId('pending-confirmation-prompt')).toBeVisible({ timeout: 20_000 });
      await expect(a.page.getByTestId('chat-input')).not.toBeVisible();

      // AC-UX-2 (post-confirm): confirming swaps the SAME mounted view to
      // the chat thread — no navigation away and back — and AC-MSG-2's held
      // message (received while pending) renders immediately.
      await a.page.getByTestId('pending-confirmation-confirm-btn').click();
      await expect(a.page.getByTestId('chat-input')).toBeVisible({ timeout: 20_000 });
      await expect(a.page.locator('[data-testid^="msg-"]').filter({ hasText: heldMsg })).toBeVisible({ timeout: 15_000 });

      // AC-OBS-2 (amended 2026-07-15): confirming swapped straight into the
      // now-viewed chat thread (no separate navigation), so the held
      // message being visible above already means A has "opened" the
      // conversation — the bell must correctly reflect that by clearing,
      // via the same open-marks-read mount effect as the list-confirm path.
      await expect.poll(
        async () => readBadgeCount(a.page),
        { timeout: 15_000 },
      ).toBe(0);
    },
  );

  test(
    'a contact that is both blocked and pending shows the Blocked banner, never the confirmation prompt (spec.md Design Decision 9)',
    async ({ browser }) => {
      const a = await bootIdentity(browser, USER_A, 'Alice-BlockedPending');
      const cardLink = await getShareCardLink(a.page);
      const payload = extractCardPayload(cardLink);

      const b = await bootIdentity(browser, USER_B, 'Bob-BlockedPending');
      await b.page.goto(`/add#c=${payload}`);
      await expect(b.page.getByTestId('contact-added-success')).toBeVisible({ timeout: 20_000 });

      await a.page.goto('/contacts');
      const admitted = await waitForAdmission(a.page, USER_B.pubkeyHex, 90_000);
      expect(admitted).toBe(true);

      // A blocks the still-pending B via the real Profile block action.
      await a.page.goto(`/profile?pubkey=${USER_B.pubkeyHex}`);
      await expect(a.page.getByTestId('profile-archive')).toBeVisible({ timeout: 15_000 });
      await a.page.getByTestId('profile-archive').click();
      await expect(a.page.getByTestId('block-confirm-modal')).toBeVisible();
      await a.page.getByTestId('block-confirm-btn').click();
      await expect(a.page.getByTestId('block-confirm-modal')).not.toBeVisible();

      // Design Decision 9: blocked always wins over pending — the detail
      // view shows the existing Blocked banner, never the confirmation
      // prompt, for a contact that is both.
      await a.page.goto(`/contacts?id=${USER_B.pubkeyHex}`);
      await expect(a.page.getByTestId('contact-archived-alert')).toBeVisible({ timeout: 15_000 });
      await expect(a.page.getByTestId('pending-confirmation-prompt')).not.toBeVisible();
    },
  );
});
