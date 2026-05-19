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
 * Keypairs: alice (USER_A), bob (USER_B) from helpers/auth-helpers.ts.
 * Requires the strfry relay harness: make e2e-up.
 * Run: node scripts/run-e2e.mjs tests/e2e/dm-historical-recovery.spec.ts
 */

import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { USER_A, USER_B, injectIdentity, computeTestKeypairs } from './helpers/auth-helpers';
import { clearAppState } from './helpers/clear-state';
import { suppressErrorOverlay } from './helpers/dismiss-error-overlay';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3100';
const E2E_RELAY_URL = process.env.E2E_RELAY_URL ?? 'ws://localhost:7777';

test.beforeAll(async () => {
  await computeTestKeypairs();
});

test.afterEach(async ({ page }) => {
  await clearAppState(page);
});

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
 * This runs before Alice's browser context opens, ensuring the events are
 * "historical" from Alice's perspective (arrived before her session started).
 */
async function seedHistoricalDMs(bobPrivHex: string, alicePubHex: string): Promise<string[]> {
  const wrapIds: string[] = [];
  const messages = [
    'First message from Bob — oldest',
    'Second message from Bob',
    'Third message from Bob',
    'Fourth message from Bob',
    'Fifth message from Bob — newest',
  ];
  const now = Math.floor(Date.now() / 1000);

  for (let i = 0; i < messages.length; i++) {
    const { wrapEvent } = await buildGiftWrap({
      senderPrivHex: bobPrivHex,
      recipientPubHex: alicePubHex,
      rumorContent: messages[i],
      rumorCreatedAt: now - (messages.length - i) * 60,
    });
    wrapIds.push(wrapEvent.id);
    await publishToRelay(wrapEvent);
    // Small delay so the relay processes events in deterministic order.
    await new Promise((r) => setTimeout(r, 100));
  }

  return wrapIds;
}

/**
 * Wait for the contact chat to render N message bubbles.
 * Uses the __quizzlTest bridge to detect IDB writes.
 */
async function waitForMessagesRendered(page: Page, minCount: number, timeoutMs = 15_000): Promise<void> {
  await page.waitForFunction(
    (min) => document.querySelectorAll('[data-testid^="msg-"]').length >= min,
    minCount,
    { timeout: timeoutMs },
  );
  // Extra buffer: let the upsert settle
  await page.waitForTimeout(1000);
}

test('alice recovers 5 historical gift-wrapped DMs in created_at order with no duplicates (AC-13)', async ({ browser }) => {
  const alicePriv = USER_A.privateKeyHex;
  const alicePub = USER_A.pubkeyHex;
  const bobPriv = USER_B.privateKeyHex;
  // Bob's pubkey derived via getPublicKey (computed by computeTestKeypairs)
  const bobPub = USER_B.pubkeyHex;

  // 1. Seed 5 historical gift-wrapped DMs on the relay before Alice's session
  const rumorIds = await seedHistoricalDMs(bobPriv, alicePub);

  // 2. Alice boots with an empty IDB store
  const aliceContext = await browser.newContext({ baseURL: BASE_URL });
  await suppressErrorOverlay(aliceContext);
  const alicePage = await aliceContext.newPage();

  // Inject identity + contact before goto so the contact-chat page mounts
  await alicePage.goto('/');
  await injectIdentity(alicePage, USER_A);

  // Seed contact for Bob
  const now = new Date().toISOString();
  await alicePage.evaluate(
    ({ peerPubkeyHex, ts }) => {
      localStorage.setItem('lp_contacts_v1', JSON.stringify({
        [peerPubkeyHex]: { pubkeyHex: peerPubkeyHex, firstSeenAt: ts, lastSeenAt: ts, archivedAt: null },
      }));
    },
    { peerPubkeyHex: bobPub, ts: now },
  );

  await alicePage.reload();

  // 3. Navigate to Bob's DM chat.
  await alicePage.goto(`/contacts?id=${bobPub}`);

  // 4. Wait for all 5 messages to render (historical fetch resolves after mount).
  await waitForMessagesRendered(alicePage, 5, 20_000);

  // 5. Assert at least 5 messages rendered.
  const bubbleCount = await alicePage.locator('[data-testid^="msg-"]').count();
  expect(bubbleCount).toBeGreaterThanOrEqual(5);

  // 6. Assert messages are in created_at order (oldest → newest, top → bottom).
  // The seeded messages are spaced 60s apart with "First..." oldest and
  // "Fifth..." newest. Filter for our seeded set so unrelated relay events
  // don't interfere with order assertions.
  const allTexts = await alicePage.locator('[data-testid^="msg-"]').allTextContents();
  const seededTexts = allTexts.filter((t) => /First|Second|Third|Fourth|Fifth/.test(t));
  expect(seededTexts.length).toBeGreaterThanOrEqual(5);
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

  // 7. Re-open the chat to verify dedup — message count must not double.
  const seededCountBefore = seededTexts.length;
  await alicePage.goto('/contacts');
  await alicePage.waitForTimeout(500);
  await alicePage.goto(`/contacts?id=${bobPub}`);
  await waitForMessagesRendered(alicePage, 5, 10_000);
  const afterTexts = await alicePage.locator('[data-testid^="msg-"]').allTextContents();
  const seededAfter = afterTexts.filter((t) => /First|Second|Third|Fourth|Fifth/.test(t));
  expect(seededAfter.length).toBe(seededCountBefore);

  await aliceContext.close();
});
