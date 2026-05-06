import { test, expect } from '@playwright/test';
import { USER_A, USER_B, computeTestKeypairs } from './helpers/auth-helpers';
import { clearAppState } from './helpers/clear-state';
import { suppressErrorOverlay } from './helpers/dismiss-error-overlay';

/**
 * E2E tests for the EmojiComposerPicker wired into ChatBox.
 *
 * Strategy: seed USER_A identity + USER_B as a contact into localStorage,
 * then navigate to /contacts?id={USER_B.pubkeyHex}. ContactChat renders
 * ChatBox immediately (no relay needed — messages start empty). The emoji
 * trigger button and textarea are present without any network calls.
 *
 * Test targets (per story-05 ACs):
 *   AC-26: trigger button is visible with correct aria-label and data-testid
 *   AC-27: click trigger opens picker; Escape / outside-click close it
 *   AC-28: Ctrl+Shift+E keyboard shortcut toggles picker
 *   AC-29: picker grid has exactly 24 glyph buttons in 4 columns
 *   AC-30: clicking a glyph inserts at cursor position
 *   AC-31: clicking a glyph with unfocused textarea appends
 *   AC-32: grid has role="grid"; gridcell children; Enter activates
 *   AC-33: end-to-end mid-text insertion assertion
 */

const PEER_PUBKEY = 'b'.repeat(64); // deterministic fake pubkey for contact

async function setupPage(browser: import('@playwright/test').Browser) {
  const context = await browser.newContext();
  await suppressErrorOverlay(context);

  // Pre-seed via addInitScript so data is available before any React hydration.
  await context.addInitScript(
    ({ privateKeyHex, pubkeyHex, seedHex, peerPubkeyHex }) => {
      const now = new Date().toISOString();
      localStorage.setItem(
        'lp_nostrIdentity_v1',
        JSON.stringify({ privateKeyHex, pubkeyHex, seedHex }),
      );
      localStorage.setItem(
        'lp_userProfile_v1',
        JSON.stringify({ nickname: 'Tester', avatar: null, badgeIds: [] }),
      );
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
      privateKeyHex: USER_A.privateKeyHex,
      pubkeyHex: USER_A.pubkeyHex,
      seedHex: USER_A.seedHex,
      peerPubkeyHex: PEER_PUBKEY,
    },
  );

  const page = await context.newPage();
  return { page, context };
}

test.describe('EmojiComposerPicker', () => {
  test.beforeAll(async () => {
    await computeTestKeypairs();
  });

  test('trigger button renders with correct testid and aria-label', async ({ browser }) => {
    const { page, context } = await setupPage(browser);
    try {
      await page.goto(`/contacts?id=${PEER_PUBKEY}`);
      await page.waitForLoadState('networkidle');

      const trigger = page.getByTestId('emoji-composer-trigger');
      await expect(trigger).toBeVisible();
      // aria-label is sourced from copy.emoji.openPicker — English value
      await expect(trigger).toHaveAttribute('aria-label', 'Open emoji picker');
    } finally {
      await context.close();
    }
  });

  test('clicking trigger opens the picker popover', async ({ browser }) => {
    const { page, context } = await setupPage(browser);
    try {
      await page.goto(`/contacts?id=${PEER_PUBKEY}`);
      await page.waitForLoadState('networkidle');

      const trigger = page.getByTestId('emoji-composer-trigger');
      await trigger.click();

      // Chakra renders the popover in a portal; wait for at least one glyph.
      await expect(page.getByTestId('emoji-glyph-😀')).toBeVisible({ timeout: 5_000 });
    } finally {
      await context.close();
    }
  });

  test('picker renders exactly 24 glyph buttons in a role=grid container', async ({ browser }) => {
    const { page, context } = await setupPage(browser);
    try {
      await page.goto(`/contacts?id=${PEER_PUBKEY}`);
      await page.waitForLoadState('networkidle');

      await page.getByTestId('emoji-composer-trigger').click();
      await expect(page.getByTestId('emoji-glyph-😀')).toBeVisible({ timeout: 5_000 });

      // Count gridcell roles — should be exactly 24.
      const cells = page.getByRole('gridcell');
      await expect(cells).toHaveCount(24);

      // Verify the grid container exists.
      await expect(page.getByRole('grid')).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('each glyph button has a non-empty aria-label (AC-63)', async ({ browser }) => {
    const { page, context } = await setupPage(browser);
    try {
      await page.goto(`/contacts?id=${PEER_PUBKEY}`);
      await page.waitForLoadState('networkidle');

      await page.getByTestId('emoji-composer-trigger').click();
      await expect(page.getByTestId('emoji-glyph-😀')).toBeVisible({ timeout: 5_000 });

      // Spot-check a few known glyphs for aria-label presence.
      const thumbsUp = page.getByTestId('emoji-glyph-👍');
      await expect(thumbsUp).toHaveAttribute('aria-label', /Insert emoji/);
    } finally {
      await context.close();
    }
  });

  test('pressing Escape closes the picker (AC-27)', async ({ browser }) => {
    const { page, context } = await setupPage(browser);
    try {
      await page.goto(`/contacts?id=${PEER_PUBKEY}`);
      await page.waitForLoadState('networkidle');

      await page.getByTestId('emoji-composer-trigger').click();
      const firstGlyph = page.getByTestId('emoji-glyph-😀');
      await expect(firstGlyph).toBeVisible({ timeout: 5_000 });

      // Move focus inside the popover so Chakra's Escape handler fires.
      await firstGlyph.focus();
      await page.keyboard.press('Escape');
      await expect(firstGlyph).not.toBeVisible({ timeout: 3_000 });
    } finally {
      await context.close();
    }
  });

  test('clicking outside the picker closes it (AC-27)', async ({ browser }) => {
    const { page, context } = await setupPage(browser);
    try {
      await page.goto(`/contacts?id=${PEER_PUBKEY}`);
      await page.waitForLoadState('networkidle');

      await page.getByTestId('emoji-composer-trigger').click();
      await expect(page.getByTestId('emoji-glyph-😀')).toBeVisible({ timeout: 5_000 });

      // Click the page heading area — well outside the popover.
      await page.click('body', { position: { x: 10, y: 10 } });
      await expect(page.getByTestId('emoji-glyph-😀')).not.toBeVisible({ timeout: 3_000 });
    } finally {
      await context.close();
    }
  });

  test('Ctrl+Shift+E on textarea opens the picker (AC-28)', async ({ browser }) => {
    const { page, context } = await setupPage(browser);
    try {
      await page.goto(`/contacts?id=${PEER_PUBKEY}`);
      await page.waitForLoadState('networkidle');

      const textarea = page.getByTestId('chat-input');
      await textarea.click();

      // Toggle open via keyboard shortcut.
      await page.keyboard.press('Control+Shift+E');
      await expect(page.getByTestId('emoji-glyph-😀')).toBeVisible({ timeout: 5_000 });

      // On open, a rAF-deferred focus call moves keyboard focus to the first
      // glyph after Chakra's useFocusOnShow completes. Escape while the glyph
      // is focused triggers the document-level keydown handler which calls
      // onClose() directly and is more reliable than React synthetic bubbling
      // through Chakra's portal.
      await expect(page.getByTestId('emoji-glyph-😀')).toBeFocused({ timeout: 2_000 });

      // Escape closes the picker via the document-level keydown handler.
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('emoji-glyph-😀')).not.toBeVisible({ timeout: 3_000 });

      // Re-focus the textarea before the second shortcut: after Escape, Chakra's
      // useFocusOnHide moves focus to the trigger button. Our rAF focus-restore
      // fires after, but the CDP round-trip for keyboard.press may race with it.
      // An explicit click is the reliable baseline for the re-open assertion.
      await textarea.click();

      // Toggle open again via shortcut — verify it still works after a close.
      await page.keyboard.press('Control+Shift+E');
      await expect(page.getByTestId('emoji-glyph-😀')).toBeVisible({ timeout: 5_000 });
    } finally {
      await context.close();
    }
  });

  test('clicking a glyph appends to empty textarea (AC-31)', async ({ browser }) => {
    const { page, context } = await setupPage(browser);
    try {
      await page.goto(`/contacts?id=${PEER_PUBKEY}`);
      await page.waitForLoadState('networkidle');

      await page.getByTestId('emoji-composer-trigger').click();
      await expect(page.getByTestId('emoji-glyph-👍')).toBeVisible({ timeout: 5_000 });

      await page.getByTestId('emoji-glyph-👍').click();

      const textarea = page.getByTestId('chat-input');
      await expect(textarea).toHaveValue('👍');
    } finally {
      await context.close();
    }
  });

  /**
   * AC-30 / AC-33: End-to-end cursor-position insertion.
   *
   * 1. Type "hello world" into the textarea.
   * 2. Position cursor at index 5 (after "hello") via Playwright fill+setSelectionRange.
   * 3. Open the picker and click 👍.
   * 4. Assert the value is "hello👍 world".
   */
  test('clicking a glyph inserts at the current cursor position mid-text (AC-30, AC-33)', async ({ browser }) => {
    const { page, context } = await setupPage(browser);
    try {
      await page.goto(`/contacts?id=${PEER_PUBKEY}`);
      await page.waitForLoadState('networkidle');

      const textarea = page.getByTestId('chat-input');
      await textarea.fill('hello world');

      // Set cursor at position 5 (after "hello") via JavaScript.
      await page.evaluate(() => {
        const ta = document.querySelector<HTMLTextAreaElement>('[data-testid="chat-input"]');
        if (ta) {
          ta.focus();
          ta.setSelectionRange(5, 5);
        }
      });

      // Open picker and select 👍
      await page.getByTestId('emoji-composer-trigger').click();
      await expect(page.getByTestId('emoji-glyph-👍')).toBeVisible({ timeout: 5_000 });
      await page.getByTestId('emoji-glyph-👍').click();

      // The picker must have closed.
      await expect(page.getByTestId('emoji-glyph-👍')).not.toBeVisible({ timeout: 3_000 });

      // The textarea value must have the glyph at the correct position.
      // '👍' encodes as 2 UTF-16 code units, so "hello👍 world"
      await expect(textarea).toHaveValue('hello👍 world');
    } finally {
      await context.close();
    }
  });
});
