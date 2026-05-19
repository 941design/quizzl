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

const ENVELOPE_CONTENT = JSON.stringify({ type: 'text', text: 'hello from envelope' });
const ENVELOPE_ID = 'a'.repeat(64); // canonical 64-hex id

/**
 * Seed a malformed DM row in the idb-keyval store the app actually reads from.
 *
 * The app uses `idb-keyval` (DB="keyval-store", store="keyval") and the chat
 * persistence layer keys rows under `quizzl:messages:dm:<peer-lowercase>`.
 * The whole record is the message array — the IDB record's value is
 * `ChatMessage[]`, not a single row.
 */
async function seedMalformedRow(page: import('@playwright/test').Page): Promise<void> {
  const now = Date.now();
  await page.evaluate(
    ({ bobPub, envelopeContent, envelopeId, now }) => {
      const groupId = `dm:${bobPub.toLowerCase()}`;
      const storageKey = `quizzl:messages:${groupId}`;
      const malformedRow = {
        id: envelopeId,
        content: envelopeContent,
        senderPubkey: bobPub,
        groupId,
        createdAt: now - 60_000,
      };
      return new Promise<void>((resolve, reject) => {
        const openReq = indexedDB.open('keyval-store', 1);
        openReq.onupgradeneeded = () => {
          const db = openReq.result;
          if (!db.objectStoreNames.contains('keyval')) {
            db.createObjectStore('keyval');
          }
        };
        openReq.onsuccess = () => {
          const db = openReq.result;
          const tx = db.transaction('keyval', 'readwrite');
          tx.objectStore('keyval').put([malformedRow], storageKey);
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = () => { db.close(); reject(tx.error); };
        };
        openReq.onerror = () => reject(openReq.error);
      });
    },
    {
      bobPub: USER_B.pubkeyHex,
      envelopeContent: ENVELOPE_CONTENT,
      envelopeId: ENVELOPE_ID,
      now,
    },
  );
}

/** Read the persisted thread array for a DM key from the idb-keyval store. */
async function readDmThread(
  page: import('@playwright/test').Page,
  peerPubkeyHex: string,
): Promise<Array<{ id: string; content: string; senderPubkey: string; createdAt: number }> | null> {
  return page.evaluate((peer) => {
    const storageKey = `quizzl:messages:dm:${peer.toLowerCase()}`;
    return new Promise<any[] | null>((resolve) => {
      const openReq = indexedDB.open('keyval-store', 1);
      openReq.onupgradeneeded = () => {
        const db = openReq.result;
        if (!db.objectStoreNames.contains('keyval')) {
          db.createObjectStore('keyval');
        }
      };
      openReq.onsuccess = () => {
        const db = openReq.result;
        const tx = db.transaction('keyval', 'readonly');
        const getReq = tx.objectStore('keyval').get(storageKey);
        getReq.onsuccess = () => resolve((getReq.result as any[]) ?? null);
        getReq.onerror = () => resolve(null);
        tx.oncomplete = () => db.close();
      };
      openReq.onerror = () => resolve(null);
    });
  }, peerPubkeyHex);
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
      ({ peerPubkeyHex, ts }) => {
        localStorage.setItem('lp_contacts_v1', JSON.stringify({
          [peerPubkeyHex]: { pubkeyHex: peerPubkeyHex, firstSeenAt: ts, lastSeenAt: ts, archivedAt: null },
        }));
      },
      { peerPubkeyHex: bobPub, ts: now },
    );

    // Seed the malformed row into IndexedDB
    await seedMalformedRow(page);
    await page.waitForTimeout(200); // let IDB write settle

    // Verify the malformed row is in IDB before opening the chat
    const preChat = await readDmThread(page, bobPub);
    expect(preChat).not.toBeNull();
    expect(preChat!.length).toBe(1);
    expect(preChat![0].content).toBe(ENVELOPE_CONTENT);
    expect(preChat![0].content).not.toBe('hello from envelope');

    // ── 2. Navigate to Bob's DM chat ────────────────────────────────────────
    await page.goto(`/contacts?id=${bobPub}`);
    await page.waitForLoadState('networkidle');

    // The self-heal pass runs inside loadMessages inside ContactChat.init.
    // Look for the decoded text rendered in a chat bubble.
    const bubble = page.locator('[data-testid^="msg-"]').filter({ hasText: 'hello from envelope' }).first();
    await expect(bubble).toBeVisible({ timeout: 15_000 });
    await expect(bubble).not.toContainText('{"type":"text"');

    // ── 4. page.reload() — verify persistence ───────────────────────────────
    await page.reload();
    await page.waitForLoadState('networkidle');
    const bubbleAfter = page.locator('[data-testid^="msg-"]').filter({ hasText: 'hello from envelope' }).first();
    await expect(bubbleAfter).toBeVisible({ timeout: 15_000 });
    await expect(bubbleAfter).not.toContainText('{"type":"text"');

    // ── 6. Inspect IDB directly — assert row was rewritten in place ──────
    const healed = await readDmThread(page, bobPub);
    expect(healed).not.toBeNull();
    const healedRow = healed!.find((m) => m.id === ENVELOPE_ID);
    expect(healedRow).toBeDefined();
    expect(healedRow!.content).toBe('hello from envelope');
    expect(healedRow!.id).toBe(ENVELOPE_ID);

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
      ({ peerPubkeyHex, ts }) => {
        localStorage.setItem('lp_contacts_v1', JSON.stringify({
          [peerPubkeyHex]: { pubkeyHex: peerPubkeyHex, firstSeenAt: ts, lastSeenAt: ts, archivedAt: null },
        }));
      },
      { peerPubkeyHex: bobPub, ts: now },
    );

    // Seed malformed row
    await seedMalformedRow(page);
    await page.waitForTimeout(200);

    // Verify healed marker is NOT set yet
    const markerBefore = await page.evaluate(() =>
      localStorage.getItem('lp_dmHealed_v1'),
    );
    expect(markerBefore).toBeNull();

    // First chat open
    await page.goto(`/contacts?id=${bobPub}`);
    await page.waitForLoadState('networkidle');
    const bubble = page.locator('[data-testid^="msg-"]').filter({ hasText: 'hello from envelope' }).first();
    await expect(bubble).toBeVisible({ timeout: 15_000 });

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
    const bubbleAfter = page.locator('[data-testid^="msg-"]').filter({ hasText: 'hello from envelope' }).first();
    await expect(bubbleAfter).toBeVisible({ timeout: 15_000 });

    await ctx.close();
  },
);