/**
 * E2E: DM gift-wrapped bell — AC-22
 *
 * Two-context scenario (Alice = recipient with closed chat, Bob = sender).
 *
 *   1. Alice signs in and navigates to /contacts (bell watcher is mounted).
 *      Alice does NOT open any chat — the bell watcher must fire on subscription.
 *   2. Bob signs in, connects NDK, and calls publishDirectMessage to Alice.
 *   3. Assert Alice's bell badge becomes ≥ 1 without Alice ever opening the chat.
 *   4. Alice opens the DM chat with Bob → message renders.
 *
 * This exercises the full relay → NDK subscription → bell watcher subscription
 * (kind-1059 branch) → bell badge pipeline end-to-end.
 *
 * Uses deterministic alice/bob keypairs from helpers/auth-helpers.ts.
 * Requires the strfry relay harness: make e2e-up.
 * Run: node scripts/run-e2e.mjs tests/e2e/dm-giftwrap-bell.spec.ts
 */

import { test, expect, BrowserContext, Page } from '@playwright/test';
import { USER_A, USER_B, computeTestKeypairs, injectIdentity } from './helpers/auth-helpers';
import { clearAppState } from './helpers/clear-state';
import { suppressErrorOverlay } from './helpers/dismiss-error-overlay';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3100';
const E2E_RELAY_URL = process.env.E2E_RELAY_URL ?? 'ws://localhost:7777';

async function waitForBridge(page: Page) {
  await page.waitForFunction(
    () => !!(window as any).__quizzlUnread,
    null,
    { timeout: 10_000 },
  );
}

/**
 * Boot a user in a fresh Playwright context with identity + peer contact seeded.
 */
async function bootUser(
  browser: { newContext: (opts: object) => Promise<BrowserContext> },
  user: typeof USER_A,
  nickname: string,
  peerPubkeyHex: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL: BASE_URL });
  await suppressErrorOverlay(context);

  const now = new Date().toISOString();
  await context.addInitScript(
    ({ privateKeyHex, pubkeyHex, seedHex, nickname, peerPubkeyHex, now }) => {
      localStorage.setItem('lp_nostrIdentity_v1', JSON.stringify({ privateKeyHex, pubkeyHex, seedHex }));
      localStorage.setItem('lp_userProfile_v1', JSON.stringify({ nickname, avatar: null, badgeIds: [] }));
      localStorage.setItem('lp_contacts_v1', JSON.stringify({
        [peerPubkeyHex]: { pubkeyHex, firstSeenAt: now, lastSeenAt: now, archivedAt: null },
      }));
    },
    { privateKeyHex: user.privateKeyHex, pubkeyHex: user.pubkeyHex, seedHex: user.seedHex, nickname, peerPubkeyHex, now },
  );

  const page = await context.newPage();
  await page.goto('/');
  await clearAppState(page);

  // Re-seed after clearAppState wipes lp_* keys
  await page.evaluate(
    ({ privateKeyHex, pubkeyHex, seedHex, nickname, peerPubkeyHex, now }) => {
      localStorage.setItem('lp_nostrIdentity_v1', JSON.stringify({ privateKeyHex, pubkeyHex, seedHex }));
      localStorage.setItem('lp_userProfile_v1', JSON.stringify({ nickname, avatar: null, badgeIds: [] }));
      localStorage.setItem('lp_contacts_v1', JSON.stringify({
        [peerPubkeyHex]: { pubkeyHex, firstSeenAt: now, lastSeenAt: now, archivedAt: null },
      }));
    },
    { privateKeyHex: user.privateKeyHex, pubkeyHex: user.pubkeyHex, seedHex: user.seedHex, nickname, peerPubkeyHex, now },
  );

  return { context, page };
}

test.describe('DM gift-wrapped bell — AC-22', () => {
  test.beforeAll(async () => {
    await computeTestKeypairs();
  });

  test.afterEach(async ({ browser }) => {
    // Clean up both contexts
    const ctxs = browser.contexts();
    await Promise.all(ctxs.map((c) => c.close()));
  });

  test(
    'AC-22: alice receives a NIP-17 gift-wrapped DM from bob; bell badge becomes 1 '
    + 'without alice opening the chat; opening the chat renders the message (AC-22)',
    async ({ browser }) => {
      const ALICE_NICK = 'alice-test';
      const BOB_NICK = 'bob-test';

      // ── 1. Alice boots with Bob as a contact (closed chat) ──────────────────
      const aliceCtx = await browser.newContext({ baseURL: BASE_URL });
      await suppressErrorOverlay(aliceCtx);
      const alicePage = await aliceCtx.newPage();

      const now = new Date().toISOString();
      await aliceCtx.addInitScript(
        ({ privateKeyHex, pubkeyHex, seedHex, nickname, peerPubkeyHex, now }) => {
          localStorage.setItem('lp_nostrIdentity_v1', JSON.stringify({ privateKeyHex, pubkeyHex, seedHex }));
          localStorage.setItem('lp_userProfile_v1', JSON.stringify({ nickname, avatar: null, badgeIds: [] }));
          localStorage.setItem('lp_contacts_v1', JSON.stringify({
            [peerPubkeyHex]: { pubkeyHex, firstSeenAt: now, lastSeenAt: now, archivedAt: null },
          }));
        },
        {
          privateKeyHex: USER_A.privateKeyHex,
          pubkeyHex: USER_A.pubkeyHex,
          seedHex: USER_A.seedHex,
          nickname: ALICE_NICK,
          peerPubkeyHex: USER_B.pubkeyHex,
          now,
        },
      );
      await alicePage.goto('/');
      await clearAppState(alicePage);
      await aliceCtx.addInitScript(
        ({ privateKeyHex, pubkeyHex, seedHex, nickname, peerPubkeyHex, now }) => {
          localStorage.setItem('lp_nostrIdentity_v1', JSON.stringify({ privateKeyHex, pubkeyHex, seedHex }));
          localStorage.setItem('lp_userProfile_v1', JSON.stringify({ nickname, avatar: null, badgeIds: [] }));
          localStorage.setItem('lp_contacts_v1', JSON.stringify({
            [peerPubkeyHex]: { pubkeyHex, firstSeenAt: now, lastSeenAt: now, archivedAt: null },
          }));
        },
        {
          privateKeyHex: USER_A.privateKeyHex,
          pubkeyHex: USER_A.pubkeyHex,
          seedHex: USER_A.seedHex,
          nickname: ALICE_NICK,
          peerPubkeyHex: USER_B.pubkeyHex,
          now,
        },
      );

      // ── 2. Alice navigates to /contacts to mount the bell watcher ───────────
      await alicePage.goto('/contacts');
      await alicePage.waitForLoadState('networkidle');
      await waitForBridge(alicePage);

      // ── 3. Bob boots, connects NDK, publishes a NIP-17 gift-wrapped DM ─────
      const bobCtx = await browser.newContext({ baseURL: BASE_URL });
      await suppressErrorOverlay(bobCtx);
      const bobPage = await bobCtx.newPage();

      await injectIdentity(bobPage, USER_B);
      await bobPage.reload();

      // Wait for NDK to be ready, then publish the DM via the app's publishDirectMessage
      // Use a page.evaluate that imports the app's DM publisher and calls it.
      const RUMOR_CONTENT = 'hello from bob via gift wrap';
      let publishOk = false;
      let publishError = '';

      await bobPage.waitForFunction(
        () => !!(window as any).__quizzlUnread,
        null,
        { timeout: 15_000 },
      );

      try {
        await bobPage.evaluate(
          async ({ bobPriv, alicePub, content, relayUrl }) => {
            const { getNdk } = await import('@/src/lib/ndkClient');
            const { publishDirectMessage } = await import('@/src/lib/directMessages');

            const ndk = await (await import('@/src/lib/ndkClient')).connectNdk(bobPriv);
            await ndk.connect();

            try {
              await publishDirectMessage({
                ndk,
                privateKeyHex: bobPriv,
                peerPubkeyHex: alicePub,
                content,
              });
              return { ok: true };
            } catch (err) {
              return { ok: false, error: String(err) };
            }
          },
          {
            bobPriv: USER_B.privateKeyHex,
            alicePub: USER_A.pubkeyHex,
            content: RUMOR_CONTENT,
            relayUrl: E2E_RELAY_URL,
          },
        );
        publishOk = true;
      } catch (err) {
        publishError = String(err);
      }

      // Verify Bob was able to publish (NDK + relay must be up)
      expect(publishOk, `Bob's publishDirectMessage call failed: ${publishError}`).toBe(true);

      // ── 4. Wait for Alice's bell badge to become ≥ 1 ────────────────────────
      // The bell badge lives on the notification bell button or the DM dropdown.
      await alicePage.waitForFunction(
        () => {
          const badge = document.querySelector('[data-testid="notification-badge"]');
          if (!badge) {
            // Bell badge may live inside a button or nav item — check aria-label
            const bell = document.querySelector('[aria-label*="message"], [aria-label*="notification"]');
            if (bell) {
              const count = parseInt(bell.getAttribute('data-count') ?? bell.textContent ?? '0', 10);
              return count >= 1;
            }
            return false;
          }
          const count = parseInt(badge.textContent ?? badge.getAttribute('data-count') ?? '0', 10);
          return count >= 1;
        },
        null,
        { timeout: 15_000 },
      );

      // ── 5. Alice opens the DM chat with Bob and verifies the message renders ─
      await alicePage.goto('/contacts');
      await alicePage.waitForLoadState('networkidle');

      // Click the bell to open the DM dropdown, find Bob, click into the chat
      const bellButton = alicePage.getByRole('button', { name: /messages?|direct/i }).first();
      await bellButton.click();

      // Wait for the unread DM list to appear in the dropdown
      const dmList = alicePage.getByRole('list', { name: /unread/i }).first();
      const bobRow = dmList.getByText(/bob/i, { exact: false }).first();
      await bobRow.click();

      // Wait for the chat to load and the message bubble to appear
      await alicePage.waitForLoadState('networkidle');
      const bubbles = alicePage.locator('[data-testid="message-bubble"], .message-bubble').first();
      await expect(bubbles).toBeVisible();
      await expect(bubbles).toContainText(RUMOR_CONTENT);
    },
  );
});
