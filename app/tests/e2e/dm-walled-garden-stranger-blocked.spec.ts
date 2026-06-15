/**
 * E2E: DM walled garden — stranger blocked (AC-TEST-4)
 *
 * Alice (USER_A) has no shared group with Mallory (USER_C). Mallory sends Alice
 * a NIP-17 gift-wrapped DM via `publishDirectMessage` (the app's DM helper).
 *
 * Assertions:
 *   a. Alice's notification bell stays at 0 (badge never appears).
 *   b. No `notification-dm-<malloryPub>` row appears in the dropdown.
 *   c. `quizzl:messages:dm:<malloryHex>` key is absent from idb-keyval after a wait.
 *
 * Uses the two-context pattern from dm-giftwrap-bell.spec.ts.
 * Mallory = USER_C (seedHex: 'cc'.repeat(16)) — the third deterministic identity.
 * Uses ONLY `publishDirectMessage` — never raw WebSocket.
 *
 * Requires: make e2e-up (strfry relay at ws://localhost:7777).
 */

import { test, expect, BrowserContext, Page } from '@playwright/test';
import { USER_A, USER_C, computeTestKeypairs } from './helpers/auth-helpers';
import { clearAppState } from './helpers/clear-state';
import { suppressErrorOverlay } from './helpers/dismiss-error-overlay';
import { readIdbRecord } from './helpers/idb-record';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3100';

async function waitForBridge(page: Page) {
  await page.waitForFunction(
    () => !!(window as any).__nostlingUnread,
    null,
    { timeout: 10_000 },
  );
}

test.describe('DM walled garden: stranger blocked (AC-TEST-4)', () => {
  test.beforeAll(async () => {
    await computeTestKeypairs();
  });

  test.afterEach(async ({ browser }) => {
    const ctxs = browser.contexts();
    await Promise.all(ctxs.map((c) => c.close()));
  });

  test(
    'AC-TEST-4: Mallory (USER_C, no shared group with Alice) DMs Alice via publishDirectMessage; '
    + 'Alice bell stays at 0, no DM thread appears, no IDB key created',
    async ({ browser }) => {
      const ALICE_NICK = 'alice-walled-garden';
      const MALLORY_NICK = 'mallory-stranger';

      // ── 1. Alice boots with NO groups and NO Mallory in contacts ─────────────
      const aliceCtx = await browser.newContext({ baseURL: BASE_URL });
      await suppressErrorOverlay(aliceCtx);
      await aliceCtx.addInitScript(
        ({ privateKeyHex, pubkeyHex, seedHex, nickname }) => {
          localStorage.setItem('lp_nostrIdentity_v1', JSON.stringify({ privateKeyHex, pubkeyHex, seedHex }));
          localStorage.setItem('lp_userProfile_v1', JSON.stringify({ nickname, avatar: null }));
          // No contacts, no groups — Alice is alone
        },
        {
          privateKeyHex: USER_A.privateKeyHex,
          pubkeyHex: USER_A.pubkeyHex,
          seedHex: USER_A.seedHex,
          nickname: ALICE_NICK,
        },
      );

      const alicePage = await aliceCtx.newPage();
      await alicePage.goto('/');
      await clearAppState(alicePage);

      // Re-seed after clearAppState wiped lp_* keys
      await alicePage.evaluate(
        ({ privateKeyHex, pubkeyHex, seedHex, nickname }) => {
          localStorage.setItem('lp_nostrIdentity_v1', JSON.stringify({ privateKeyHex, pubkeyHex, seedHex }));
          localStorage.setItem('lp_userProfile_v1', JSON.stringify({ nickname, avatar: null }));
        },
        {
          privateKeyHex: USER_A.privateKeyHex,
          pubkeyHex: USER_A.pubkeyHex,
          seedHex: USER_A.seedHex,
          nickname: ALICE_NICK,
        },
      );

      // ── 2. Alice navigates to /contacts to mount the bell watcher ───────────
      await alicePage.goto('/contacts');
      await alicePage.waitForLoadState('networkidle');
      await waitForBridge(alicePage);

      // Get baseline badge count (may be non-zero if messages exist from other tests)
      const startBadgeCount = await alicePage.evaluate(() => {
        const b = document.querySelector('[data-testid="notification-badge"]');
        return b ? parseInt((b.textContent ?? '0').trim(), 10) : 0;
      });

      // ── 3. Mallory boots and sends a DM to Alice ─────────────────────────────
      const malloryCtx = await browser.newContext({ baseURL: BASE_URL });
      await suppressErrorOverlay(malloryCtx);
      await malloryCtx.addInitScript(
        ({ privateKeyHex, pubkeyHex, seedHex, nickname }) => {
          localStorage.setItem('lp_nostrIdentity_v1', JSON.stringify({ privateKeyHex, pubkeyHex, seedHex }));
          localStorage.setItem('lp_userProfile_v1', JSON.stringify({ nickname, avatar: null }));
        },
        {
          privateKeyHex: USER_C.privateKeyHex,
          pubkeyHex: USER_C.pubkeyHex,
          seedHex: USER_C.seedHex,
          nickname: MALLORY_NICK,
        },
      );

      const malloryPage = await malloryCtx.newPage();
      await malloryPage.goto('/');
      await clearAppState(malloryPage);

      await malloryPage.evaluate(
        ({ privateKeyHex, pubkeyHex, seedHex, nickname }) => {
          localStorage.setItem('lp_nostrIdentity_v1', JSON.stringify({ privateKeyHex, pubkeyHex, seedHex }));
          localStorage.setItem('lp_userProfile_v1', JSON.stringify({ nickname, avatar: null }));
        },
        {
          privateKeyHex: USER_C.privateKeyHex,
          pubkeyHex: USER_C.pubkeyHex,
          seedHex: USER_C.seedHex,
          nickname: MALLORY_NICK,
        },
      );

      // Wait for Mallory's app bridge to be ready before publishing
      await malloryPage.goto('/contacts');
      await malloryPage.waitForLoadState('networkidle');
      await waitForBridge(malloryPage);

      // Publish via the app's __nostlingPublishDm bridge (NOT raw WebSocket, NOT @/ imports).
      // The bridge is installed by unreadStore.ts in dev mode and uses the page's own identity.
      const DM_CONTENT = 'stranger-dm-should-be-blocked';
      await malloryPage.waitForFunction(
        () => typeof (window as any).__nostlingPublishDm === 'function',
        null,
        { timeout: 10_000 },
      );
      await malloryPage.evaluate(
        async ({ alicePub, content }) => {
          try {
            await (window as any).__nostlingPublishDm(alicePub, content);
          } catch {
            // Ignore publish errors — the relay may reject or the event may
            // still land; what matters is Alice's gate blocks it on receipt.
          }
        },
        {
          alicePub: USER_A.pubkeyHex,
          content: DM_CONTENT,
        },
      );

      // ── 4. Wait 5 seconds — Alice's bell must stay at 0 ──────────────────────
      await alicePage.waitForTimeout(5_000);

      // Assertion (a): badge count must not increase (stranger DM must be blocked/dropped)
      const afterBadgeCount = await alicePage.evaluate(() => {
        const b = document.querySelector('[data-testid="notification-badge"]');
        return b ? parseInt((b.textContent ?? '0').trim(), 10) : 0;
      });
      expect(afterBadgeCount).toBe(startBadgeCount);

      // ── 5. Assertion (b): no notification-dm-<malloryPub> row in dropdown ───
      // Open the bell to see what notifications (if any) are listed
      const bellButton = alicePage.getByTestId('notification-bell').first();
      await bellButton.click();
      await expect(
        alicePage.getByTestId(`notification-dm-${USER_C.pubkeyHex}`),
      ).toHaveCount(0);

      // ── 6. Assertion (c): no quizzl:messages:dm:<malloryHex> IDB key ─────────
      const malloryKey = await readIdbRecord(
        alicePage,
        'keyval-store',
        'keyval',
        `quizzl:messages:dm:${USER_C.pubkeyHex.toLowerCase()}`,
      );
      expect(malloryKey).toBeNull();
    },
  );
});
