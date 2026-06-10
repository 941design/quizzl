import { test, expect, BrowserContext, Page } from '@playwright/test';
import { USER_A, USER_B, computeTestKeypairs } from './helpers/auth-helpers';
import { clearAppState } from './helpers/clear-state';
import { suppressErrorOverlay } from './helpers/dismiss-error-overlay';
import { createGroupAndInvite } from './helpers/group-setup';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3100';

/** Boot a user and navigate to /groups/ so the MLS group setup can run. */
async function bootUserOnGroups(
  browser: { newContext: (opts: object) => Promise<BrowserContext> },
  user: typeof USER_A,
  nickname: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL: BASE_URL });
  await suppressErrorOverlay(context);
  await context.addInitScript(
    ({ privateKeyHex, pubkeyHex, seedHex, nickname }) => {
      localStorage.setItem(
        'lp_nostrIdentity_v1',
        JSON.stringify({ privateKeyHex, pubkeyHex, seedHex }),
      );
      localStorage.setItem(
        'lp_userProfile_v1',
        JSON.stringify({ nickname, avatar: null }),
      );
    },
    {
      privateKeyHex: user.privateKeyHex,
      pubkeyHex: user.pubkeyHex,
      seedHex: user.seedHex,
      nickname,
    },
  );
  const page = await context.newPage();
  await page.goto('/');
  await clearAppState(page);
  // re-seed after clearAppState wiped lp_* keys
  await page.evaluate(
    ({ privateKeyHex, pubkeyHex, seedHex, nickname }) => {
      localStorage.setItem(
        'lp_nostrIdentity_v1',
        JSON.stringify({ privateKeyHex, pubkeyHex, seedHex }),
      );
      localStorage.setItem(
        'lp_userProfile_v1',
        JSON.stringify({ nickname, avatar: null }),
      );
    },
    {
      privateKeyHex: user.privateKeyHex,
      pubkeyHex: user.pubkeyHex,
      seedHex: user.seedHex,
      nickname,
    },
  );
  await page.reload();
  await page.goto('/groups/');
  await expect(
    page.getByTestId('groups-empty-state').or(page.getByTestId('groups-list')),
  ).toBeVisible({ timeout: 60_000 });
  return { context, page };
}

test.describe.serial('Direct chat: no duplicate messages on send', () => {
  let contextA: BrowserContext;
  let contextB: BrowserContext;
  let pageA: Page;
  let pageB: Page;

  test.beforeAll(async ({ browser }) => {
    await computeTestKeypairs();
    ({ context: contextA, page: pageA } = await bootUserOnGroups(browser, USER_A, 'Alice'));
    ({ context: contextB, page: pageB } = await bootUserOnGroups(browser, USER_B, 'Bob'));
  });

  test.afterAll(async () => {
    await contextA?.close();
    await contextB?.close();
  });

  test('Alice and Bob establish a shared MLS group (walled-garden prerequisite)', async () => {
    await createGroupAndInvite(pageA, USER_B.npub, pageB, 'No-Dup Test Group');
  });

  test('a sent message appears exactly once in the sender\'s thread', async () => {
    await pageA.goto(`/contacts/?id=${USER_B.pubkeyHex}`);
    await expect(pageA.getByTestId('contact-detail-page')).toBeVisible({ timeout: 30_000 });

    // Open Bob's view of Alice too, so the relay subscription on his side is active.
    await pageB.goto(`/contacts/?id=${USER_A.pubkeyHex}`);
    await expect(pageB.getByTestId('contact-detail-page')).toBeVisible({ timeout: 30_000 });

    // Wait for ContactChat init() to finish: it kicks off two fetchEventsWithTimeout
    // calls and only then registers the live subscriptions (incomingSub / outgoingSub).
    // We need those subs to be active when publish() runs, otherwise the optimistic
    // echo NDK dispatches into matching subs has no listener.
    await pageA.waitForTimeout(10_000);
    await pageB.waitForTimeout(2_000);

    // Record the baseline bubble count BEFORE sending — the relay may have
    // historical messages from previous test runs. The assertion is that sending
    // ONE message increases the count by exactly 1, not that the absolute count is 1.
    const baselineBubbleCount = await pageA.locator('[data-testid^="msg-"]').count();

    // Force the race deterministically. NDK dispatches a just-published event
    // into matching local subscriptions synchronously inside event.publish()
    // (before the relay round-trip resolves). Without the fix, ContactChat
    // adds an optimistic message under a tempId, then later swaps tempId→realId
    // — so if the echo's decrypt+upsert wins the race against the swap, the
    // state ends up with two entries (tempId optimistic + realId echo) for the
    // same logical message. With localhost strfry the round-trip is normally
    // faster than the echo's microtask chain and the race doesn't fire; slow
    // down the outbound EVENT frame so the ordering holds reliably.
    await pageA.evaluate(() => {
      const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
      const origSend = WebSocket.prototype.send;
      (WebSocket.prototype as unknown as { send: (data: unknown) => unknown }).send =
        async function (this: WebSocket, data: unknown) {
          if (typeof data === 'string' && data.startsWith('["EVENT"')) {
            await sleep(800);
          }
          return origSend.call(this, data as string);
        };
    });

    const uniqueText = `dup-check-${Date.now()}`;
    await pageA.getByTestId('chat-input').fill(uniqueText);
    await pageA.getByTestId('chat-send-btn').click();

    // Wait for the message to appear at least once on Alice's side …
    await expect(pageA.getByText(uniqueText)).toBeVisible({ timeout: 30_000 });

    // … then give the relay echo (own-author subscription) time to round-trip.
    await pageA.waitForTimeout(5_000);

    // The unique text must appear exactly once (no duplicate rendering).
    await expect(pageA.getByText(uniqueText)).toHaveCount(1);

    // The TOTAL bubble count must have increased by exactly 1 (no phantom duplicates).
    // We compare against the baseline rather than asserting absolute count = 1,
    // because the relay may have historical messages from previous test runs.
    const bubbleCountAfterSend = await pageA.locator('[data-testid^="msg-"]').count();
    expect(bubbleCountAfterSend).toBe(baselineBubbleCount + 1);

    // Reloading the page must not double the message either: the persisted
    // log + the relay refetch must dedupe. We check that uniqueText appears
    // exactly once after reload; the total bubble count is NOT checked against
    // bubbleCountAfterSend because the relay may deliver gift-wrapped messages
    // from concurrent/prior test runs between the send and the reload, making the
    // absolute count non-deterministic in a full-suite run.
    await pageA.reload();
    await expect(pageA.getByTestId('contact-detail-page')).toBeVisible({ timeout: 30_000 });
    await expect(pageA.getByText(uniqueText)).toBeVisible({ timeout: 30_000 });
    await pageA.waitForTimeout(3_000);
    await expect(pageA.getByText(uniqueText)).toHaveCount(1);

    // And exactly once on the receiver's screen.
    await expect(pageB.getByText(uniqueText)).toBeVisible({ timeout: 30_000 });
    await pageB.waitForTimeout(2_000);
    await expect(pageB.getByText(uniqueText)).toHaveCount(1);
  });
});
