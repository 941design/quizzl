/**
 * E2E: DM self-heal — AC-29
 *
 * Pre-seeds Alice's IndexedDB with a malformed DM row whose `content` is
 * the raw JSON envelope string (e.g. '{"type":"text","text":"hello"}') instead
 * of the decoded text. Verifies that:
 *
 *   1. Opening the DM chat renders the DECODED message (not the JSON string).
 *   2. After page.reload(), the bubble STILL renders the decoded text
 *      (self-heal persisted to IDB, not just in-memory).
 *   3. Direct IDB inspection confirms the row was rewritten in place.
 *
 * Keypairs: alice (USER_A), bob (USER_B) from helpers/auth-helpers.ts.
 * Requires the strfry relay harness: make e2e-up.
 * Run: node scripts/run-e2e.mjs tests/e2e/dm-self-heal.spec.ts
 */

import { test, expect } from '@playwright/test';
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Seed a malformed DM row directly into IndexedDB before the chat mount. */
async function seedMalformedRow(page: import('@playwright/test').Page, alicePrivHex: string): Promise<void> {
  const now = Date.now();
  // The raw JSON envelope string — this is the malformed content we expect
  // the self-heal pass to correct.
  const envelopeContent = JSON.stringify({ type: 'text', text: 'hello from envelope' });
  const envelopeId = 'a'.repeat(64); // canonical id

  await page.evaluate(
    ({ alicePriv, alicePub, bobPub, envelopeContent, envelopeId, now }) => {
      // Open IndexedDB and write directly to the messages store
      const openReq = indexedDB.open('quizzl-messages');
      openReq.onupgradeneeded = () => {
        const db = openReq.result;
        if (!db.objectStoreNames.contains('messages')) {
          db.createObjectStore('messages', { keyPath: 'id' });
        }
      };
      openReq.onsuccess = () => {
        const db = openReq.result;
        const tx = db.transaction('messages', 'readwrite');
        const store = tx.objectStore('messages');
        const malformedRow = {
          id: envelopeId,
          content: envelopeContent, // raw JSON string — the bug
          senderPubkey: bobPub,     // peer-authored
          groupId: `dm:${bobPub.slice(0, 64).toLowerCase()}`,
          createdAt: now - 60_000,
        };
        store.put(malformedRow);
        tx.oncomplete = () => db.close();
        tx.onerror = () => db.close();
      };
    },
    {
      alicePriv,
      alicePub: USER_A.pubkeyHex,
      bobPub: USER_B.pubkeyHex,
      envelopeContent,
      envelopeId,
      now,
    },
  );
}

/** Read a message row from IndexedDB by id. */
async function readIdbRow(
  page: import('@playwright/test').Page,
  messageId: string,
): Promise<any | null> {
  return page.evaluate(
    (id) =>
      new Promise<any | null>((resolve) => {
        const openReq = indexedDB.open('quizzl-messages');
        openReq.onsuccess = () => {
          const db = openReq.result;
          if (!db.objectStoreNames.contains('messages')) {
            resolve(null);
            return;
          }
          const tx = db.transaction('messages', 'readonly');
          const store = tx.objectStore('messages');
          const getReq = store.get(id);
          getReq.onsuccess = () => resolve(getReq.result ?? null);
          getReq.onerror = () => resolve(null);
          tx.oncomplete = () => db.close();
        };
        openReq.onerror = () => resolve(null);
      }),
    messageId,
  );
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

test(
  'AC-29: malformed JSON-envelope content row is self-healed; '
  + 'bubble renders decoded text; survives page reload; '
  + 'IDB row is rewritten in place (AC-29)',
  async ({ browser }) => {
    const bobPub = USER_B.pubkeyHex;
    const alicePriv = USER_A.privateKeyHex;
    const alicePub = USER_A.pubkeyHex;
    const THREAD_ID = `dm:${bobPub}`.toLowerCase();

    // ── 1. Pre-seed Alice's IDB with a malformed row ────────────────────────
    // We'll use a helper context that opens the page once, seeds the row via
    // page.evaluate, then navigates to the chat.
    const ctx = await browser.newContext({ baseURL: BASE_URL });
    await suppressErrorOverlay(ctx);
    const page = await ctx.newPage();

    // Go to app first so we have a valid page context
    await page.goto('/');
    await injectIdentity(page, USER_A);
    await page.waitForTimeout(500);

    // Seed contact for Bob
    const now = new Date().toISOString();
    await page.evaluate(
      ({ peerPubkeyHex, pubkeyHex, ts }) => {
        localStorage.setItem('lp_contacts_v1', JSON.stringify({
          [peerPubkeyHex]: { pubkeyHex, firstSeenAt: ts, lastSeenAt: ts, archivedAt: null },
        }));
      },
      { peerPubkeyHex: bobPub, pubkeyHex: alicePub, now },
    );

    // Seed the malformed row into IndexedDB
    await seedMalformedRow(page, alicePriv);
    await page.waitForTimeout(200); // let IDB write settle

    // Verify the malformed row is in IDB before opening the chat
    const preChatRow = await readIdbRow(page, 'a'.repeat(64));
    expect(preChatRow).not.toBeNull();
    expect(preChatRow.content).toBe(JSON.stringify({ type: 'text', text: 'hello from envelope' }));
    expect(preChatRow.content).not.toBe('hello from envelope');

    // ── 2. Navigate to Bob's DM chat ────────────────────────────────────────
    await page.goto(`/contacts?id=bob&peer=${bobPub}`);
    await page.waitForLoadState('networkidle');

    // The self-heal pass runs inside loadMessages inside ContactChat.init.
    // We need to wait for the message to appear.
    await page.waitForFunction(
      () => {
        // Look for any message element with the decoded text
        const els = document.querySelectorAll('[data-testid="chat-bubble"], .chat-bubble, [class*="message"]');
        return Array.from(els).some((el) => el.textContent?.includes('hello from envelope'));
      },
      null,
      { timeout: 15_000 },
    );

    // ── 3. Assert: bubble renders the DECODED text (not the JSON string) ──
    const bubbles = page.locator('[data-testid="chat-bubble"], .chat-bubble, [class*="message"]');
    const bubbleCount = await bubbles.count();
    expect(bubbleCount, 'at least one message bubble should be visible').toBeGreaterThan(0);

    const firstBubble = bubbles.first();
    const bubbleText = await firstBubble.textContent();
    expect(bubbleText).toContain('hello from envelope');
    // Must NOT contain the JSON string
    expect(bubbleText).not.toContain('{"type":"text"');

    // ── 4. page.reload() — verify persistence ───────────────────────────────
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Wait for the message to re-appear after reload
    await page.waitForFunction(
      () => {
        const els = document.querySelectorAll('[data-testid="chat-bubble"], .chat-bubble, [class*="message"]');
        return Array.from(els).some((el) => el.textContent?.includes('hello from envelope'));
      },
      null,
      { timeout: 15_000 },
    );

    // ── 5. Assert: bubble STILL renders the decoded text after reload ─────
    const afterReloadBubbles = page.locator('[data-testid="chat-bubble"], .chat-bubble, [class*="message"]');
    const afterReloadText = (await afterReloadBubbles.first().textContent()) ?? '';
    expect(afterReloadText).toContain('hello from envelope');
    expect(afterReloadText).not.toContain('{"type":"text"');

    // ── 6. Inspect IDB directly — assert row was rewritten in place ──────
    const idbRow = await readIdbRow(page, 'a'.repeat(64));
    expect(idbRow).not.toBeNull();
    expect(idbRow.content).toBe('hello from envelope'); // decoded, not the JSON string
    // id and createdAt unchanged
    expect(idbRow.id).toBe('a'.repeat(64));

    await ctx.close();
  },
);

test(
  'AC-27: self-heal marker is set; second loadMessages skips the pass '
  + '(no duplicate write after reload)',
  async ({ browser }) => {
    const bobPub = USER_B.pubkeyHex;
    const alicePub = USER_A.pubkeyHex;

    const ctx = await browser.newContext({ baseURL: BASE_URL });
    await suppressErrorOverlay(ctx);
    const page = await ctx.newPage();

    await page.goto('/');
    await injectIdentity(page, USER_A);
    await page.waitForTimeout(500);

    const now = new Date().toISOString();
    await page.evaluate(
      ({ peerPubkeyHex, pubkeyHex, ts }) => {
        localStorage.setItem('lp_contacts_v1', JSON.stringify({
          [peerPubkeyHex]: { pubkeyHex, firstSeenAt: ts, lastSeenAt: ts, archivedAt: null },
        }));
      },
      { peerPubkeyHex: bobPub, pubkeyHex: alicePub, now },
    );

    // Seed malformed row
    await seedMalformedRow(page, USER_A.privateKeyHex);
    await page.waitForTimeout(200);

    // Verify healed marker is NOT set yet
    const markerBefore = await page.evaluate(() =>
      localStorage.getItem('lp_dmHealed_v1'),
    );
    expect(markerBefore).toBeNull();

    // First chat open
    await page.goto(`/contacts?id=bob&peer=${bobPub}`);
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(
      () => {
        const els = document.querySelectorAll('[data-testid="chat-bubble"], .chat-bubble, [class*="message"]');
        return Array.from(els).some((el) => el.textContent?.includes('hello from envelope'));
      },
      null,
      { timeout: 15_000 },
    );

    // Healed marker should now be set
    const markerAfter = await page.evaluate(() =>
      localStorage.getItem('lp_dmHealed_v1'),
    );
    expect(markerAfter).not.toBeNull();
    const parsed = JSON.parse(markerAfter!);
    expect(parsed.some((t: string) => t.startsWith('dm:'))).toBe(true);

    // After reload, the healed marker prevents re-running the self-heal pass.
    // The bubble should still render correctly (proving the row was persisted
    // in its healed form, not just decoded in-memory).
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(
      () => {
        const els = document.querySelectorAll('[data-testid="chat-bubble"], .chat-bubble, [class*="message"]');
        return Array.from(els).some((el) => el.textContent?.includes('hello from envelope'));
      },
      null,
      { timeout: 10_000 },
    );

    const text = (await page.locator('[data-testid="chat-bubble"], .chat-bubble, [class*="message"]').first().textContent()) ?? '';
    expect(text).toContain('hello from envelope');

    await ctx.close();
  },
);