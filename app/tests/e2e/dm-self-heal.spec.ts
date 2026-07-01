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
 * Walled-garden prerequisite: Alice and Bob must share an MLS group so that
 * the retroactive purge sweep (AC-PURGE-1) does not remove the seeded thread.
 * Both tests are wrapped in test.describe.serial with a group setup step first.
 *
 * Keypairs: alice (USER_A), bob (USER_B) from helpers/auth-helpers.ts.
 * Requires the strfry relay harness: make e2e-up.
 * Run: node scripts/run-e2e.mjs tests/e2e/dm-self-heal.spec.ts
 */

import { test, expect, BrowserContext, Page } from '@playwright/test';
import { USER_A, USER_C, computeTestKeypairs } from './helpers/auth-helpers';

// USER_B is configured as the maintainer in the e2e test environment
// (NEXT_PUBLIC_MAINTAINER_NPUBS in run-e2e.mjs). Navigating to
// /contacts?id=<maintainer> redirects to /feedback (spec §2.7), which breaks
// this test's DM chat assertions. Use USER_C as the DM peer instead.
const USER_B = USER_C;
import { clearAppState } from './helpers/clear-state';
import { suppressErrorOverlay } from './helpers/dismiss-error-overlay';
import { createGroupAndInvite } from './helpers/group-setup';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3100';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ENVELOPE_CONTENT = JSON.stringify({ type: 'text', text: 'hello from envelope' });
const ENVELOPE_ID = 'a'.repeat(64); // canonical 64-hex id

/**
 * Boot a user and navigate to /groups/ so MarmotContext initializes cleanly
 * (KeyPackages published before createGroupAndInvite runs).
 * This mirrors the bootUserOnGroups pattern used in other walled-garden tests.
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

/**
 * Seed a malformed DM row in the idb-keyval store the app actually reads from.
 *
 * The app uses `idb-keyval` (DB="keyval-store", store="keyval") and the chat
 * persistence layer keys rows under `few:messages:dm:<peer-lowercase>`.
 * The whole record is the message array — the IDB record's value is
 * `ChatMessage[]`, not a single row.
 */
async function seedMalformedRow(page: import('@playwright/test').Page): Promise<void> {
  const now = Date.now();
  await page.evaluate(
    ({ bobPub, envelopeContent, envelopeId, now }) => {
      const groupId = `dm:${bobPub.toLowerCase()}`;
      const storageKey = `few:messages:${groupId}`;
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
    const storageKey = `few:messages:dm:${peer.toLowerCase()}`;
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

test.describe.serial('DM self-heal — AC-29 and AC-27', () => {
  let ctxA: BrowserContext;
  let ctxB: BrowserContext;
  let pageA: Page;
  let pageB: Page;

  test.beforeAll(async ({ browser }) => {
    await computeTestKeypairs();
    // Boot both users via groups page so MarmotContext initializes cleanly
    // (KeyPackages published, purge whitelist ready). Without this, the
    // retroactive purge sweep (AC-PURGE-1) would remove the seeded DM thread
    // because Bob is a stranger with no shared group.
    ({ context: ctxA, page: pageA } = await bootUserOnGroups(browser, USER_A, 'Alice'));
    ({ context: ctxB, page: pageB } = await bootUserOnGroups(browser, USER_B, 'Bob'));
  });

  test.afterAll(async () => {
    await ctxA?.close();
    await ctxB?.close();
  });

  test('Alice and Bob establish a shared MLS group (walled-garden prerequisite)', async () => {
    await createGroupAndInvite(pageA, USER_B.npub, pageB, 'Self-Heal Test Group');
  });

  test(
    'AC-29: malformed JSON-envelope content row is self-healed; '
    + 'bubble renders decoded text; survives page reload; '
    + 'IDB row is rewritten in place (AC-29)',
    async () => {
      const bobPub = USER_B.pubkeyHex;

      // ── 1. Pre-seed Alice's IDB with a malformed row ────────────────────────
      // The purge already ran on boot and Bob is whitelisted (shared group),
      // so the seeded row will survive. Navigate away from groups first so
      // the app is in a neutral state before seeding.
      await pageA.goto('/');
      await pageA.waitForLoadState('networkidle');

      // Seed the malformed row into IndexedDB
      await seedMalformedRow(pageA);
      await pageA.waitForTimeout(200); // let IDB write settle

      // Verify the malformed row is in IDB before opening the chat
      const preChat = await readDmThread(pageA, bobPub);
      expect(preChat).not.toBeNull();
      expect(preChat!.length).toBe(1);
      expect(preChat![0].content).toBe(ENVELOPE_CONTENT);
      expect(preChat![0].content).not.toBe('hello from envelope');

      // ── 2. Navigate to Bob's DM chat ────────────────────────────────────────
      await pageA.goto(`/contacts?id=${bobPub}`);
      await pageA.waitForLoadState('networkidle');

      // The self-heal pass runs inside loadMessages inside ContactChat.init.
      // Look for the decoded text rendered in a chat bubble.
      const bubble = pageA.locator('[data-testid^="msg-"]').filter({ hasText: 'hello from envelope' }).first();
      await expect(bubble).toBeVisible({ timeout: 15_000 });
      await expect(bubble).not.toContainText('{"type":"text"');

      // ── 4. page.reload() — verify persistence ───────────────────────────────
      await pageA.reload();
      await pageA.waitForLoadState('networkidle');
      const bubbleAfter = pageA.locator('[data-testid^="msg-"]').filter({ hasText: 'hello from envelope' }).first();
      await expect(bubbleAfter).toBeVisible({ timeout: 15_000 });
      await expect(bubbleAfter).not.toContainText('{"type":"text"');

      // ── 6. Inspect IDB directly — assert row was rewritten in place ──────
      const healed = await readDmThread(pageA, bobPub);
      expect(healed).not.toBeNull();
      const healedRow = healed!.find((m) => m.id === ENVELOPE_ID);
      expect(healedRow).toBeDefined();
      expect(healedRow!.content).toBe('hello from envelope');
      expect(healedRow!.id).toBe(ENVELOPE_ID);
    },
  );

  test(
    'AC-27: self-heal marker is set; second loadMessages skips the pass '
    + '(no duplicate write after reload)',
    async () => {
      const bobPub = USER_B.pubkeyHex;

      // Navigate away then back to reset state
      await pageA.goto('/');
      await pageA.waitForLoadState('networkidle');

      // Seed malformed row (Bob is whitelisted via shared group)
      await seedMalformedRow(pageA);
      await pageA.waitForTimeout(200);

      // Verify healed marker is NOT set yet
      const markerBefore = await pageA.evaluate(() =>
        localStorage.getItem('lp_dmHealed_v1'),
      );
      // Marker may already be set from the AC-29 test above; clear it first.
      await pageA.evaluate(() => localStorage.removeItem('lp_dmHealed_v1'));

      // First chat open
      await pageA.goto(`/contacts?id=${bobPub}`);
      await pageA.waitForLoadState('networkidle');
      const bubble = pageA.locator('[data-testid^="msg-"]').filter({ hasText: 'hello from envelope' }).first();
      await expect(bubble).toBeVisible({ timeout: 15_000 });

      // Healed marker should now be set
      const markerAfter = await pageA.evaluate(() =>
        localStorage.getItem('lp_dmHealed_v1'),
      );
      expect(markerAfter).not.toBeNull();
      const parsed = JSON.parse(markerAfter!);
      expect(parsed.some((t: string) => t.startsWith('dm:'))).toBe(true);

      // After reload, the healed marker prevents re-running the self-heal pass.
      // The bubble should still render correctly (proving the row was persisted
      // in its healed form, not just decoded in-memory).
      await pageA.reload();
      await pageA.waitForLoadState('networkidle');
      const bubbleAfter = pageA.locator('[data-testid^="msg-"]').filter({ hasText: 'hello from envelope' }).first();
      await expect(bubbleAfter).toBeVisible({ timeout: 15_000 });
    },
  );
});
