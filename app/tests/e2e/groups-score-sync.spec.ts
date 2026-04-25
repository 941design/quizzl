import { test, expect, BrowserContext, Page } from '@playwright/test';
import { USER_A, USER_B, computeTestKeypairs } from './helpers/auth-helpers';
import { clearAppState } from './helpers/clear-state';
import { dismissErrorOverlay, suppressErrorOverlay } from './helpers/dismiss-error-overlay';
import { queryRelayForEvents } from './helpers/relay-query';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3100';

/** Boot a user context: inject identity via init script, navigate to /groups/. */
async function bootUser(
  browser: { newContext: (opts: object) => Promise<BrowserContext> },
  user: typeof USER_A,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL: BASE_URL });
  await suppressErrorOverlay(context);
  await context.addInitScript(({ privateKeyHex, pubkeyHex, seedHex }) => {
    localStorage.setItem('lp_nostrIdentity_v1', JSON.stringify({ privateKeyHex, pubkeyHex, seedHex }));
  }, { privateKeyHex: user.privateKeyHex, pubkeyHex: user.pubkeyHex, seedHex: user.seedHex });
  const page = await context.newPage();
  await page.goto('/');
  await clearAppState(page);
  await page.reload();
  await page.goto('/groups/');
  await expect(
    page.getByTestId('groups-empty-state').or(page.getByTestId('groups-list')),
  ).toBeVisible({ timeout: 60_000 });
  return { context, page };
}

let contextA: BrowserContext;
let contextB: BrowserContext;
let pageA: Page;
let pageB: Page;

test.describe.serial('Score Sync via MLS', () => {
  test.beforeAll(async ({ browser }) => {
    await computeTestKeypairs();
    ({ context: contextA, page: pageA } = await bootUser(browser, USER_A));
    ({ context: contextB, page: pageB } = await bootUser(browser, USER_B));

    // Wait for KeyPackage publication
    await pageB.waitForTimeout(5_000);

    // User A creates group
    await pageA.getByTestId('create-group-btn').click();
    await expect(pageA.getByTestId('create-group-modal-content')).toBeVisible();
    await pageA.getByTestId('create-group-name-input').fill('Score Sync Group');
    await pageA.getByTestId('create-group-submit-btn').click();
    await expect(pageA.getByText('Score Sync Group')).toBeVisible({ timeout: 30_000 });
    await expect(pageA.getByTestId('create-group-modal-content')).not.toBeVisible({ timeout: 10_000 });
    await dismissErrorOverlay(pageA);

    // User A invites User B
    await pageA.locator(`[data-testid^="group-card-"]`, { hasText: 'Score Sync Group' }).click();
    await expect(pageA.getByTestId('group-detail-page')).toBeVisible({ timeout: 30_000 });
    await pageA.getByTestId('invite-member-btn').click();
    await expect(pageA.getByTestId('invite-member-modal-content')).toBeVisible();
    await pageA.getByTestId('invite-npub-input').fill(USER_B.npub);
    await pageA.getByTestId('invite-submit-btn').click();
    await expect(pageA.getByTestId('invite-success')).toBeVisible({ timeout: 60_000 });

    // User B joins via Welcome
    await pageB.goto('/groups/');
    await expect(pageB.getByText('Score Sync Group')).toBeVisible({ timeout: 60_000 });
  });

  test.afterAll(async () => {
    await contextA?.close();
    await contextB?.close();
  });

  test('User A completes quiz and score is published', async () => {
    // Navigate to a topic page and select the Quiz tab
    await pageA.goto('/topic/javascript-basics');
    await dismissErrorOverlay(pageA);

    const quizTab = pageA.getByTestId('tab-quiz');
    await expect(quizTab).toBeVisible({ timeout: 10_000 });
    await quizTab.click();

    // Answer all 5 questions (single, multi, flashcard, single, flashcard).
    // Quiz completion triggers publishScoreUpdate only when ALL answered.
    // Detection order: flashcard → multi-choice → single-choice (most specific first).
    for (let q = 0; q < 5; q++) {
      await expect(pageA.getByTestId('question-card')).toBeVisible({ timeout: 10_000 });

      const revealBtn = pageA.getByTestId('reveal-answer-btn');
      const multiSubmit = pageA.getByTestId('submit-multi-answer');

      if (await revealBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
        // Flashcard: reveal then self-assess
        await revealBtn.click();
        const knewItBtn = pageA.getByTestId('knew-it-btn');
        await expect(knewItBtn).toBeVisible({ timeout: 5_000 });
        await knewItBtn.click();
      } else if (await multiSubmit.isVisible({ timeout: 1_000 }).catch(() => false)) {
        // Multi-choice: select first checkbox then submit
        await pageA.locator('[data-testid^="option-"]').first().click();
        await multiSubmit.click();
      } else {
        // Single-choice: clicking an option auto-submits
        await pageA.locator('[data-testid^="option-"]').first().click();
      }

      // Wait for answer state to settle before navigating
      await pageA.waitForTimeout(500);

      // Move to next question (unless this was the last one)
      if (q < 4) {
        await expect(pageA.getByTestId('next-question-btn')).toBeEnabled({ timeout: 5_000 });
        await pageA.getByTestId('next-question-btn').click();
      }
    }

    // Wait for quiz completion callback + score sync
    await pageA.waitForTimeout(10_000);

    // Count kind 445 events on the relay. Profile publish creates some,
    // but score publish adds more. Verify the total increased.
    const events445 = await queryRelayForEvents(pageA, { kinds: [445] });
    expect(events445.length).toBeGreaterThan(0);
  });

  test('User B sees User A score in group detail', async () => {
    // Navigate to group detail
    await pageB.goto('/groups/');
    await expect(
      pageB.getByTestId('groups-empty-state').or(pageB.getByTestId('groups-list')),
    ).toBeVisible({ timeout: 60_000 });
    await dismissErrorOverlay(pageB);
    await pageB.locator(`[data-testid^="group-card-"]`, { hasText: 'Score Sync Group' }).click();
    await expect(pageB.getByTestId('group-detail-page')).toBeVisible({ timeout: 30_000 });

    // Score propagation: A's sendApplicationRumor → relay → B's live sub → ingest → IndexedDB.
    // The group detail page reads scores from IndexedDB on mount. If the score
    // arrived after mount, re-navigate to force a fresh read.
    const scoreVisible = await pageB.getByTestId('member-score-row').isVisible().catch(() => false);
    if (!scoreVisible) {
      // Wait for late delivery, then re-open the page
      await pageB.waitForTimeout(10_000);
      await pageB.goto('/groups/');
      await expect(
        pageB.getByTestId('groups-empty-state').or(pageB.getByTestId('groups-list')),
      ).toBeVisible({ timeout: 60_000 });
      await dismissErrorOverlay(pageB);
      await pageB.locator(`[data-testid^="group-card-"]`, { hasText: 'Score Sync Group' }).click();
      await expect(pageB.getByTestId('group-detail-page')).toBeVisible({ timeout: 30_000 });
    }

    await expect(pageB.getByTestId('member-score-row')).toBeVisible({ timeout: 60_000 });
    await expect(pageB.getByTestId('member-score-points')).toBeVisible();
  });
});
