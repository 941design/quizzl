import { test, expect, BrowserContext, Page } from '@playwright/test';
import { USER_A, USER_B, computeTestKeypairs } from './helpers/auth-helpers';
import { clearAppState } from './helpers/clear-state';
import { suppressErrorOverlay } from './helpers/dismiss-error-overlay';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3100';

async function bootUserWithContact(
  browser: { newContext: (opts: object) => Promise<BrowserContext> },
  user: typeof USER_A,
  nickname: string,
  peerPubkeyHex: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL: BASE_URL });
  await suppressErrorOverlay(context);
  await context.addInitScript(
    ({ privateKeyHex, pubkeyHex, seedHex, nickname, peerPubkeyHex }) => {
      localStorage.setItem(
        'lp_nostrIdentity_v1',
        JSON.stringify({ privateKeyHex, pubkeyHex, seedHex }),
      );
      localStorage.setItem(
        'lp_userProfile_v1',
        JSON.stringify({ nickname, avatar: null, badgeIds: [] }),
      );
      const now = new Date().toISOString();
      localStorage.setItem(
        'lp_contacts_v1',
        JSON.stringify({
          [peerPubkeyHex]: {
            pubkeyHex: peerPubkeyHex,
            firstSeenAt: now,
            lastSeenAt: now,
            archivedAt: null,
          },
        }),
      );
    },
    {
      privateKeyHex: user.privateKeyHex,
      pubkeyHex: user.pubkeyHex,
      seedHex: user.seedHex,
      nickname,
      peerPubkeyHex,
    },
  );
  const page = await context.newPage();
  await page.goto('/');
  await clearAppState(page);
  // re-seed after clearAppState wiped lp_* keys
  await page.evaluate(
    ({ privateKeyHex, pubkeyHex, seedHex, nickname, peerPubkeyHex }) => {
      localStorage.setItem(
        'lp_nostrIdentity_v1',
        JSON.stringify({ privateKeyHex, pubkeyHex, seedHex }),
      );
      localStorage.setItem(
        'lp_userProfile_v1',
        JSON.stringify({ nickname, avatar: null, badgeIds: [] }),
      );
      const now = new Date().toISOString();
      localStorage.setItem(
        'lp_contacts_v1',
        JSON.stringify({
          [peerPubkeyHex]: {
            pubkeyHex: peerPubkeyHex,
            firstSeenAt: now,
            lastSeenAt: now,
            archivedAt: null,
          },
        }),
      );
    },
    {
      privateKeyHex: user.privateKeyHex,
      pubkeyHex: user.pubkeyHex,
      seedHex: user.seedHex,
      nickname,
      peerPubkeyHex,
    },
  );
  await page.reload();
  return { context, page };
}

test.describe.serial('Direct chat: no duplicate messages on send', () => {
  let contextA: BrowserContext;
  let contextB: BrowserContext;
  let pageA: Page;
  let pageB: Page;

  test.beforeAll(async ({ browser }) => {
    await computeTestKeypairs();
    ({ context: contextA, page: pageA } = await bootUserWithContact(
      browser,
      USER_A,
      'Alice',
      USER_B.pubkeyHex,
    ));
    ({ context: contextB, page: pageB } = await bootUserWithContact(
      browser,
      USER_B,
      'Bob',
      USER_A.pubkeyHex,
    ));
  });

  test.afterAll(async () => {
    await contextA?.close();
    await contextB?.close();
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

    // It must appear exactly once on the sender's screen.
    await expect(pageA.getByText(uniqueText)).toHaveCount(1);
    // And the *total* number of message bubbles must be exactly one (we only
    // sent a single new message into a freshly-cleared relay).
    await expect(pageA.locator('[data-testid^="msg-"]')).toHaveCount(1);

    // Reloading the page must not double the message either: the persisted
    // log + the relay refetch must dedupe.
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
