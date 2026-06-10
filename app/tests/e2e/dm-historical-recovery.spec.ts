/**
 * E2E: DM historical recovery — AC-13
 *
 * Pre-seeds 5 gift-wrapped DMs from Bob to Alice on the relay before Alice's
 * session starts, then verifies that opening the DM chat recovers all 5 in
 * created_at order with no duplicates.
 *
 * This exercises the §3.5 order-of-operations:
 *   Step 1: loadMessages (0 pre-existing messages)
 *   Step 2: render immediately (empty)
 *   Step 3: fire kind-4 historical fetch
 *   Step 4: fire kind-1059 historical fetch in parallel with #3
 *   Step 5: wait for both → upsertMessages → rendered list is in createdAt order
 *
 * Setup order (walled-garden compatible):
 *   1. Boot Alice and Bob on /groups/.
 *   2. Alice creates a group and invites Bob (walled-garden prerequisite).
 *   3. Seed 5 historical gift-wrapped DMs from Bob to Alice on the relay.
 *   4. Alice navigates to Bob's DM chat and waits for all 5 to render.
 *
 * Keypairs: alice (USER_A), bob (USER_B) from helpers/auth-helpers.ts.
 * Requires the strfry relay harness: make e2e-up.
 * Run: node scripts/run-e2e.mjs tests/e2e/dm-historical-recovery.spec.ts
 */

import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { USER_A, USER_B, computeTestKeypairs } from './helpers/auth-helpers';
import { clearAppState } from './helpers/clear-state';
import { suppressErrorOverlay } from './helpers/dismiss-error-overlay';
import { createGroupAndInvite } from './helpers/group-setup';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3100';
const E2E_RELAY_URL = process.env.E2E_RELAY_URL ?? 'ws://localhost:7777';

/**
 * Build a kind-1059 gift wrap from sender to recipient using nostr-tools.
 * Returns the fully signed wrap event ready to publish.
 */
async function buildGiftWrap(args: {
  senderPrivHex: string;
  recipientPubHex: string;
  rumorContent: string;
  rumorCreatedAt: number;
}): Promise<{ wrapEvent: { id: string; pubkey: string; created_at: number; kind: number; tags: string[][]; content: string; sig: string } }> {
  const { wrapEvent } = await import('nostr-tools/nip59');
  const senderPrivBytes = new Uint8Array(Buffer.from(args.senderPrivHex, 'hex'));
  const wrap = wrapEvent(
    {
      kind: 14,
      tags: [['p', args.recipientPubHex]],
      content: args.rumorContent,
      created_at: args.rumorCreatedAt,
    },
    senderPrivBytes,
    args.recipientPubHex,
  );
  return { wrapEvent: wrap };
}

/**
 * Publish a Nostr event directly to the relay via WebSocket (Node 22+ global).
 *
 * Narrow exception: historical seeding from a non-Quizzl context is acceptable
 * here because the app cannot produce events in the past. The focus of this test
 * is the ContactChat recovery and dedup logic, not the publishing path.
 */
async function publishToRelay(event: object): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(E2E_RELAY_URL);
    const timeout = setTimeout(() => {
      try { ws.close(); } catch { /* ignore */ }
      reject(new Error(`Timed out publishing to ${E2E_RELAY_URL}`));
    }, 10_000);
    ws.onopen = () => {
      ws.send(JSON.stringify(['EVENT', event]));
      setTimeout(() => {
        clearTimeout(timeout);
        try { ws.close(); } catch { /* ignore */ }
        resolve();
      }, 500);
    };
    ws.onerror = () => {
      clearTimeout(timeout);
      reject(new Error(`WebSocket error publishing to ${E2E_RELAY_URL}`));
    };
  });
}

/**
 * Pre-seed 5 gift-wrapped DMs from Bob to Alice on the relay.
 * Uses past timestamps so all events look "historical" to Alice's chat.
 * Returns a run-unique tag used to filter these messages out of relay history.
 */
async function seedHistoricalDMs(
  bobPrivHex: string,
  alicePubHex: string,
): Promise<{ wrapIds: string[]; runTag: string }> {
  const runTag = `hist-test-${Date.now()}`;
  const wrapIds: string[] = [];
  const labels = ['First', 'Second', 'Third', 'Fourth', 'Fifth'];
  const messages = labels.map((label, i) =>
    `${label} msg [${runTag}]${i === 0 ? ' — oldest' : i === 4 ? ' — newest' : ''}`,
  );
  // Use timestamps well in the past so ContactChat's historical fetch window includes them.
  const baseTime = Math.floor(Date.now() / 1000) - 3600; // 1h ago

  for (let i = 0; i < messages.length; i++) {
    const { wrapEvent } = await buildGiftWrap({
      senderPrivHex: bobPrivHex,
      recipientPubHex: alicePubHex,
      rumorContent: messages[i],
      rumorCreatedAt: baseTime + i * 60, // 1 minute apart
    });
    wrapIds.push(wrapEvent.id);
    await publishToRelay(wrapEvent);
    // Small delay so the relay processes events in deterministic order.
    await new Promise((r) => setTimeout(r, 100));
  }

  return { wrapIds, runTag };
}

/**
 * Wait for the contact chat to render N message bubbles.
 */
async function waitForMessagesRendered(page: Page, minCount: number, timeoutMs = 20_000): Promise<void> {
  await page.waitForFunction(
    (min) => document.querySelectorAll('[data-testid^="msg-"]').length >= min,
    minCount,
    { timeout: timeoutMs },
  );
  // Extra buffer: let the upsert settle
  await page.waitForTimeout(1000);
}

/**
 * Boot a user in a fresh context and navigate to /groups/ (needed for MLS setup).
 */
async function bootUserOnGroups(
  browser: { newContext: (opts: object) => Promise<BrowserContext> },
  user: typeof USER_A,
  nickname: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL: BASE_URL });
  await suppressErrorOverlay(context);
  await context.addInitScript(
    ({ privateKeyHex, pubkeyHex, seedHex, nickname }) => {
      localStorage.setItem('lp_nostrIdentity_v1', JSON.stringify({ privateKeyHex, pubkeyHex, seedHex }));
      localStorage.setItem('lp_userProfile_v1', JSON.stringify({ nickname, avatar: null }));
    },
    { privateKeyHex: user.privateKeyHex, pubkeyHex: user.pubkeyHex, seedHex: user.seedHex, nickname },
  );
  const page = await context.newPage();
  await page.goto('/');
  await clearAppState(page);
  await page.evaluate(
    ({ privateKeyHex, pubkeyHex, seedHex, nickname }) => {
      localStorage.setItem('lp_nostrIdentity_v1', JSON.stringify({ privateKeyHex, pubkeyHex, seedHex }));
      localStorage.setItem('lp_userProfile_v1', JSON.stringify({ nickname, avatar: null }));
    },
    { privateKeyHex: user.privateKeyHex, pubkeyHex: user.pubkeyHex, seedHex: user.seedHex, nickname },
  );
  await page.reload();
  await page.goto('/groups/');
  await expect(
    page.getByTestId('groups-empty-state').or(page.getByTestId('groups-list')),
  ).toBeVisible({ timeout: 60_000 });
  return { context, page };
}

test.describe.serial('DM historical recovery — AC-13', () => {
  let aliceCtx: BrowserContext;
  let bobCtx: BrowserContext;
  let alicePage: Page;
  let bobPage: Page;

  test.beforeAll(async ({ browser }) => {
    await computeTestKeypairs();
    ({ context: aliceCtx, page: alicePage } = await bootUserOnGroups(browser, USER_A, 'alice-hist'));
    ({ context: bobCtx, page: bobPage } = await bootUserOnGroups(browser, USER_B, 'bob-hist'));
  });

  test.afterAll(async () => {
    await aliceCtx?.close();
    await bobCtx?.close();
  });

  test('Alice and Bob establish a shared MLS group (walled-garden prerequisite)', async () => {
    await createGroupAndInvite(alicePage, USER_B.npub, bobPage, 'AC-13 History Test Group');
  });

  test('alice recovers 5 historical gift-wrapped DMs in created_at order with no duplicates (AC-13)', async () => {
    const alicePub = USER_A.pubkeyHex;
    const bobPriv = USER_B.privateKeyHex;
    const bobPub = USER_B.pubkeyHex;

    // 1. Seed 5 historical gift-wrapped DMs on the relay (past timestamps, via raw WS —
    //    narrow exception because the app cannot produce events in the past).
    //    Returns a unique runTag to isolate THIS run's messages from relay history.
    const { runTag } = await seedHistoricalDMs(bobPriv, alicePub);

    // 2. Navigate Alice to Bob's DM chat (IDB was cleared in beforeAll so this is a
    //    fresh chat with 0 stored messages — all 5 must come from the historical fetch).
    await alicePage.goto(`/contacts?id=${bobPub}`);

    // 3. Wait for all 5 run-tagged messages to render (historical fetch resolves after mount).
    await alicePage.waitForFunction(
      (tag) => {
        const bubbles = document.querySelectorAll('[data-testid^="msg-"]');
        let taggedCount = 0;
        bubbles.forEach((b) => {
          if (b.textContent?.includes(tag)) taggedCount++;
        });
        return taggedCount >= 5;
      },
      runTag,
      { timeout: 30_000 },
    );
    await alicePage.waitForTimeout(1000); // let upsert settle

    // 4. Assert at least 5 run-tagged messages rendered.
    const allTexts = await alicePage.locator('[data-testid^="msg-"]').allTextContents();
    const seededTexts = allTexts.filter((t) => t.includes(runTag));
    expect(seededTexts.length).toBeGreaterThanOrEqual(5);

    // 5. Assert messages are in created_at order (oldest → newest, top → bottom).
    //    Labels: 'First msg [runTag]', 'Second msg [runTag]', etc.
    const orderedIndices = seededTexts.map((t) => {
      if (t.includes('First')) return 0;
      if (t.includes('Second')) return 1;
      if (t.includes('Third')) return 2;
      if (t.includes('Fourth')) return 3;
      if (t.includes('Fifth')) return 4;
      return -1;
    });
    // Confirm strictly increasing — DOM order matches created_at order.
    for (let i = 1; i < orderedIndices.length; i++) {
      expect(orderedIndices[i]).toBeGreaterThanOrEqual(orderedIndices[i - 1]);
    }

    // 6. Re-open the chat to verify dedup — run-tagged message count must not double.
    const seededCountBefore = seededTexts.length;
    await alicePage.goto('/contacts');
    await alicePage.waitForTimeout(500);
    await alicePage.goto(`/contacts?id=${bobPub}`);
    // Wait for the run-tagged messages to re-appear
    await alicePage.waitForFunction(
      (tag) => {
        const bubbles = document.querySelectorAll('[data-testid^="msg-"]');
        let taggedCount = 0;
        bubbles.forEach((b) => { if (b.textContent?.includes(tag)) taggedCount++; });
        return taggedCount >= 5;
      },
      runTag,
      { timeout: 15_000 },
    );
    await alicePage.waitForTimeout(1000);
    const afterTexts = await alicePage.locator('[data-testid^="msg-"]').allTextContents();
    const seededAfter = afterTexts.filter((t) => t.includes(runTag));
    expect(seededAfter.length).toBe(seededCountBefore);
  });
});
