/**
 * E2E tests for story-07 (message edit & delete epic): DM coverage.
 *
 * Drives the real UI (hover → action-edit-<id>/action-delete-<id> → confirm/save)
 * through the __fewDmMessageEdits-backed handleDeleteMessage/handleEditMessage
 * paths in ContactChat.tsx. Reactions are injected via the pre-existing
 * __fewDmReactions bridge only where the AC under test (reactions survive
 * edit / vanish on delete) is not itself about the reaction picker UI.
 *
 * DM delete/edit needs the walled-garden MLS group prerequisite
 * (createGroupAndInvite) exactly like dm-self-heal.spec.ts and
 * groups-dm-reactions.spec.ts, so — despite being "DM" — this file needs the
 * strfry relay and is named dm-*.spec.ts to land in the relay/"groups" test
 * mode (see app/playwright.config.ts testMatch).
 *
 * Requires the strfry relay harness: make e2e-up.
 * Single-spec run: E2E_GROUPS=1 node scripts/run-e2e.mjs tests/e2e/dm-message-edit-delete.spec.ts
 *
 * Covers (acceptance-criteria.md):
 *   AC-DEL-1 (text + image), AC-DEL-3, AC-DEL-6, AC-EDIT-1, AC-EDIT-2,
 *   AC-EDIT-3, AC-EDIT-5, AC-EDIT-7, AC-AUTH-1, AC-IMG-1, AC-IMG-2,
 *   AC-ORDER-1/AC-ORDER-3 (best-effort e2e proxy, see the dedicated test).
 */

import { test, expect, BrowserContext, Page } from '@playwright/test';
import path from 'node:path';
import { USER_A, USER_C, computeTestKeypairs } from './helpers/auth-helpers';
import { clearAppState } from './helpers/clear-state';
import { suppressErrorOverlay } from './helpers/dismiss-error-overlay';
import { createGroupAndInvite } from './helpers/group-setup';

// USER_B is configured as the maintainer in the e2e test environment
// (NEXT_PUBLIC_MAINTAINER_NPUBS in run-e2e.mjs). Navigating to
// /contacts?id=<maintainer> redirects to /feedback (spec §2.7), which breaks
// this file's DM chat assertions. Use USER_C as the DM peer instead
// (matches groups-dm-reactions.spec.ts and dm-self-heal.spec.ts).
const USER_B = USER_C;

const BASE_URL = process.env.BASE_URL || 'http://localhost:3100';
const FIXTURE_IMAGE = path.join(__dirname, '../fixtures/test-image.png');

// ─── Boot helpers ───────────────────────────────────────────────────────────

/**
 * Boot a user on /groups/ with a clean MarmotContext init (KeyPackage
 * published before createGroupAndInvite runs). Mirrors the bootUserOnGroups
 * pattern used across the walled-garden DM specs.
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

/** Navigate to the contacts page and open the DM with the peer. */
async function openDmWithPeer(page: Page, peerPubkeyHex: string): Promise<void> {
  await page.goto(`/contacts?id=${peerPubkeyHex}`);
  await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 30_000 });
}

/** Wait for the __fewDmReactions bridge to be available. */
async function waitForDmReactionsBridge(page: Page): Promise<void> {
  await page.waitForFunction(() => !!(window as any).__fewDmReactions, null, { timeout: 15_000 });
}

async function sendDmReactionViaBridge(
  page: Page,
  peerPubkeyHex: string,
  messageId: string,
  emoji: string,
  isRemoval = false,
): Promise<void> {
  await waitForDmReactionsBridge(page);
  await page.evaluate(
    ({ peerPubkeyHex, messageId, emoji, isRemoval }) => {
      return (window as any).__fewDmReactions.send(peerPubkeyHex, messageId, emoji, isRemoval);
    },
    { peerPubkeyHex, messageId, emoji, isRemoval },
  );
}

/** Send a text DM via the real composer and return the new bubble's message id. */
async function sendDmAndGetMessageId(page: Page, content: string): Promise<string> {
  const before = new Set(await page.locator('[data-testid^="msg-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid'))));
  await page.getByTestId('chat-input').fill(content);
  await page.getByTestId('chat-input').press('Enter');

  const bubble = page.locator('[data-testid^="msg-"]').filter({ hasText: content }).first();
  await expect(bubble).toBeVisible({ timeout: 15_000 });
  const testId = await bubble.getAttribute('data-testid');
  const id = testId?.replace('msg-', '') ?? '';
  expect(id).toBeTruthy();
  expect(before.has(`msg-${id}`)).toBe(false);
  return id;
}

/** Attach + send the fixture image via the real composer; return the new bubble's message id. */
async function sendDmImageAndGetMessageId(page: Page, caption = ''): Promise<string> {
  const before = new Set(await page.locator('[data-testid^="msg-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid'))));

  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByTestId('image-attachment-button').click(),
  ]);
  await fileChooser.setFiles(FIXTURE_IMAGE);
  await expect(page.getByTestId('image-preview-thumbnail')).toBeVisible({ timeout: 10_000 });

  if (caption) await page.getByTestId('chat-input').fill(caption);
  await page.getByTestId('chat-send-btn').click();
  await expect(page.getByTestId('image-preview-thumbnail')).not.toBeVisible({ timeout: 30_000 });

  // Resolve the newly-sent bubble against the before-snapshot (not merely
  // "first image thumbnail in DOM order") so this stays correct if another
  // image test is ever added to this file — mirrors sendDmAndGetMessageId.
  const bubble = page.getByTestId('image-thumbnail').locator('xpath=ancestor::*[starts-with(@data-testid, "msg-")]').first();
  await expect(bubble).toBeVisible({ timeout: 15_000 });
  const testId = await bubble.getAttribute('data-testid');
  const id = testId?.replace('msg-', '') ?? '';
  expect(id).toBeTruthy();
  expect(before.has(`msg-${id}`)).toBe(false);
  return id;
}

/** Hover a message row and click its delete icon (arms the two-click confirm). */
async function armDelete(page: Page, messageId: string): Promise<void> {
  const row = page.locator(`[data-testid="msg-${messageId}"]`);
  await row.hover();
  await page.getByTestId(`action-delete-${messageId}`).click();
  await expect(page.getByTestId(`action-delete-confirm-row-${messageId}`)).toBeVisible({ timeout: 5_000 });
}

/** Full two-click delete flow via the real UI (AC-DEL-6). */
async function deleteMessageViaUi(page: Page, messageId: string): Promise<void> {
  await armDelete(page, messageId);
  await page.getByTestId(`action-delete-confirm-${messageId}`).click();
}

/** Enter edit mode, replace content, and save (AC-EDIT-1/2). */
async function editMessageViaUi(page: Page, messageId: string, newContent: string): Promise<void> {
  const row = page.locator(`[data-testid="msg-${messageId}"]`);
  await row.hover();
  await page.getByTestId(`action-edit-${messageId}`).click();
  await expect(page.getByTestId('chat-edit-banner')).toBeVisible({ timeout: 5_000 });
  const input = page.getByTestId('chat-input');
  await input.fill(newContent);
  await page.getByTestId('chat-send-btn').click();
  await expect(page.getByTestId('chat-edit-banner')).not.toBeVisible({ timeout: 15_000 });
}

/** Assert a given message id has disappeared (tombstoned/silent removal, AC-DEL-3). */
async function expectMessageGone(page: Page, messageId: string): Promise<void> {
  await expect.poll(
    () => page.locator(`[data-testid="msg-${messageId}"]`).count(),
    { timeout: 30_000 },
  ).toBe(0);
}

// ─── Tests ──────────────────────────────────────────────────────────────────

test.describe.serial('DM message edit & delete — S7', () => {
  let ctxA: BrowserContext;
  let ctxB: BrowserContext;
  let pageA: Page; // Alice
  let pageB: Page; // Bob

  test.beforeAll(async ({ browser }) => {
    await computeTestKeypairs();
    ({ context: ctxA, page: pageA } = await bootUserOnGroups(browser, USER_A, 'Alice'));
    ({ context: ctxB, page: pageB } = await bootUserOnGroups(browser, USER_B, 'Bob'));

    // Establish the walled-garden MLS group prerequisite for DM delivery.
    await createGroupAndInvite(pageA, USER_B.npub, pageB, 'S7 DM Edit Delete Group');

    await openDmWithPeer(pageA, USER_B.pubkeyHex);
    await openDmWithPeer(pageB, USER_A.pubkeyHex);
  });

  test.afterAll(async () => {
    await ctxA?.close();
    await ctxB?.close();
  });

  test('AC-DEL-1/AC-DEL-3: Alice deletes an authored text DM message; disappears for her and Bob', async () => {
    const content = `del-text-${Date.now()}`;
    const id = await sendDmAndGetMessageId(pageA, content);

    // Bob must actually have received the message before the delete lands,
    // otherwise disappearance is indistinguishable from "never arrived".
    await expect(pageB.locator(`[data-testid="msg-${id}"]`)).toBeVisible({ timeout: 30_000 });

    await deleteMessageViaUi(pageA, id);

    await expectMessageGone(pageA, id);
    await expectMessageGone(pageB, id);
  });

  test('AC-DEL-1/AC-IMG-1: Alice deletes an authored image DM message; disappears for her and Bob', async () => {
    const id = await sendDmImageAndGetMessageId(pageA, `del-image-${Date.now()}`);

    await expect(pageB.locator(`[data-testid="msg-${id}"]`)).toBeVisible({ timeout: 60_000 });

    await deleteMessageViaUi(pageA, id);

    await expectMessageGone(pageA, id);
    await expectMessageGone(pageB, id);
  });

  test('AC-EDIT-1/AC-EDIT-2/AC-EDIT-3: Alice edits an authored text DM message in place; both sides show new content + edited marker', async () => {
    const original = `edit-orig-${Date.now()}`;
    const updated = `edit-updated-${Date.now()}`;
    const id = await sendDmAndGetMessageId(pageA, original);

    const bobBubbleBeforeEdit = pageB.locator(`[data-testid="msg-${id}"]`);
    await expect(bobBubbleBeforeEdit).toBeVisible({ timeout: 30_000 });
    // Pre-edit baseline: both sides show the original content and no marker,
    // so the "old content there, then replaced, marker appears" narrative is
    // fully asserted within this test rather than assumed.
    await expect(pageA.locator(`[data-testid="msg-${id}"]`)).toContainText(original);
    await expect(bobBubbleBeforeEdit).toContainText(original);
    await expect(pageA.getByTestId(`edited-marker-${id}`)).not.toBeAttached();
    await expect(pageB.getByTestId(`edited-marker-${id}`)).not.toBeAttached();

    await editMessageViaUi(pageA, id, updated);

    // AC-EDIT-2: in-place update — same slot id, new content, still one bubble.
    const aliceBubble = pageA.locator(`[data-testid="msg-${id}"]`);
    await expect(aliceBubble).toContainText(updated, { timeout: 10_000 });
    await expect(pageA.locator('[data-testid^="msg-"]').filter({ hasText: original })).toHaveCount(0);
    // AC-EDIT-3
    await expect(pageA.getByTestId(`edited-marker-${id}`)).toBeVisible({ timeout: 10_000 });

    // Bob sees the same slot updated in place — same testid, new content, marker.
    const bobBubble = pageB.locator(`[data-testid="msg-${id}"]`);
    await expect(bobBubble).toContainText(updated, { timeout: 30_000 });
    await expect(pageB.getByTestId(`edited-marker-${id}`)).toBeVisible({ timeout: 15_000 });
  });

  test('AC-AUTH-1: edit/delete affordances appear only on the author\'s own message', async () => {
    const content = `auth-check-${Date.now()}`;
    const id = await sendDmAndGetMessageId(pageA, content);
    await expect(pageB.locator(`[data-testid="msg-${id}"]`)).toBeVisible({ timeout: 30_000 });

    // Bob's page: Alice's message is not his own — action buttons must not
    // even be attached to the DOM (not just visually hidden).
    await pageB.locator(`[data-testid="msg-${id}"]`).hover();
    await expect(pageB.getByTestId(`action-edit-${id}`)).not.toBeAttached();
    await expect(pageB.getByTestId(`action-delete-${id}`)).not.toBeAttached();

    // Alice's page: her own message — action buttons attached after hover.
    await pageA.locator(`[data-testid="msg-${id}"]`).hover();
    await expect(pageA.getByTestId(`action-edit-${id}`)).toBeAttached();
    await expect(pageA.getByTestId(`action-delete-${id}`)).toBeAttached();
  });

  test('AC-DEL-6: a single click on delete does not remove the message; only the confirm click does', async () => {
    const content = `del6-${Date.now()}`;
    const id = await sendDmAndGetMessageId(pageA, content);

    await armDelete(pageA, id);
    // First click armed the confirm row but must NOT have deleted yet.
    await expect(pageA.getByTestId(`msg-${id}`)).toBeAttached();
    await expect(pageA.getByTestId(`action-delete-confirm-row-${id}`)).toBeVisible();

    await pageA.getByTestId(`action-delete-confirm-${id}`).click();
    await expectMessageGone(pageA, id);
  });

  test('AC-EDIT-5: empty edit content is disallowed; cancel restores the original untouched', async () => {
    const original = `edit5-keep-${Date.now()}`;
    const id = await sendDmAndGetMessageId(pageA, original);

    const row = pageA.locator(`[data-testid="msg-${id}"]`);
    await row.hover();
    await pageA.getByTestId(`action-edit-${id}`).click();
    await expect(pageA.getByTestId('chat-edit-banner')).toBeVisible({ timeout: 5_000 });

    const input = pageA.getByTestId('chat-input');
    await input.fill('   ');
    await expect(pageA.getByTestId('chat-edit-empty-hint')).toBeVisible({ timeout: 5_000 });
    await expect(pageA.getByTestId('chat-send-btn')).toBeDisabled();

    await pageA.getByTestId('chat-edit-cancel').click();
    await expect(pageA.getByTestId('chat-edit-banner')).not.toBeVisible({ timeout: 5_000 });

    // Original message untouched — still present, unedited.
    await expect(pageA.locator(`[data-testid="msg-${id}"]`)).toContainText(original);
    await expect(pageA.getByTestId(`edited-marker-${id}`)).not.toBeAttached();
  });

  test('AC-IMG-2: an image message offers delete but not edit', async () => {
    const id = await sendDmImageAndGetMessageId(pageA, `img2-${Date.now()}`);

    const row = pageA.locator(`[data-testid="msg-${id}"]`);
    await row.hover();
    await expect(pageA.getByTestId(`action-edit-${id}`)).not.toBeAttached();
    await expect(pageA.getByTestId(`action-delete-${id}`)).toBeAttached();
  });

  test('S3 confirmatory: reactions survive an edit and vanish on delete', async () => {
    const original = `react-survive-${Date.now()}`;
    const updated = `react-survive-updated-${Date.now()}`;
    const id = await sendDmAndGetMessageId(pageA, original);
    await expect(pageB.locator(`[data-testid="msg-${id}"]`)).toBeVisible({ timeout: 30_000 });

    // Bob reacts to Alice's message.
    await sendDmReactionViaBridge(pageB, USER_A.pubkeyHex, id, '👍');
    await expect(pageB.getByTestId(`reaction-badge-${id}-👍`)).toBeVisible({ timeout: 10_000 });
    await expect(pageA.getByTestId(`reaction-badge-${id}-👍`)).toBeVisible({ timeout: 30_000 });

    // AC-EDIT-7: Alice edits her message via the real UI; the badge survives.
    await editMessageViaUi(pageA, id, updated);
    await expect(pageA.locator(`[data-testid="msg-${id}"]`)).toContainText(updated, { timeout: 10_000 });
    await expect(pageA.getByTestId(`reaction-badge-${id}-👍`)).toBeVisible({ timeout: 10_000 });
    await expect(pageB.getByTestId(`reaction-badge-${id}-👍`)).toBeVisible({ timeout: 15_000 });

    // Delete: both the message and its reaction badge vanish.
    await deleteMessageViaUi(pageA, id);
    await expectMessageGone(pageA, id);
    await expectMessageGone(pageB, id);
    await expect(pageA.getByTestId(`reaction-badge-${id}-👍`)).not.toBeAttached();
    await expect(pageB.getByTestId(`reaction-badge-${id}-👍`)).not.toBeAttached();
  });

  // AC-ORDER-1/AC-ORDER-3 e2e proxy. This is a best-effort proxy, NOT a
  // controlled-wire-order test: we do not control relay delivery order at
  // the protocol level. What we DO control is Bob's local ingest timing —
  // ContactChat's giftWrapSub only runs while the DM thread route is
  // mounted (see ContactChat.tsx useEffect cleanup at giftWrapSub?.stop?.()),
  // so as long as Bob is NOT on this specific /contacts?id=<alice> route
  // while Alice sends+deletes, both the original rumor and the delete
  // signal are already resolvable on the relay by the time Bob's thread
  // first mounts and subscribes. That exercises AC-ORDER-1's pending-signal
  // application path (deferred authorization, apply-when-target-arrives)
  // as an outcome, without claiming to control wire arrival order directly.
  //
  // AC-ORDER-1/AC-ORDER-3 themselves are OWNED and deterministically tested
  // by S3 (24-permutation order-independence + fault-injection unit tests).
  // This e2e only claims: "a fresh-mount batch ingest of both an original
  // rumor and its delete signal converges to deleted" — it cannot and does
  // not claim to control wire arrival order.
  test('AC-ORDER-1/AC-ORDER-3 proxy: a message deleted before Bob ever opens the thread never renders for him', async () => {
    // Move Bob off the DM route so his giftWrapSub for this thread is torn
    // down before Alice sends+deletes.
    await pageB.goto('/groups/');
    await expect(
      pageB.getByTestId('groups-empty-state').or(pageB.getByTestId('groups-list')),
    ).toBeVisible({ timeout: 30_000 });

    const content = `order-proxy-${Date.now()}`;
    const id = await sendDmAndGetMessageId(pageA, content);
    await deleteMessageViaUi(pageA, id);
    await expectMessageGone(pageA, id);

    // Positive control: a SECOND, NOT-deleted message sent in the same
    // window. Without this, the test below only asserts ABSENCE of msg-<id>
    // — if Bob's fresh-mount ingest were broken, or Alice's send above never
    // reached the relay at all, the observed count would also be 0 and the
    // test would pass vacuously. Asserting the control message DOES render
    // on Bob's fresh mount proves this mount's ingest path actually works,
    // so the subsequent absence check for the deleted id is meaningful.
    const controlContent = `order-proxy-control-${Date.now()}`;
    const controlId = await sendDmAndGetMessageId(pageA, controlContent);

    // Residual fixed wait: gives the relay a moment to have the original
    // rumor, the delete signal, and the control message all resolvable
    // before Bob's first-ever open of this thread — Playwright cannot poll
    // "is this event resolvable on the relay for a not-yet-subscribed
    // client" (no readiness marker for that exists), so unlike a state poll
    // this wait exists purely to reduce the test's own false-negative risk
    // (Bob subscribing before the events are even queryable), not to gate a
    // correctness assertion. Same allowance as the AC-60 relay-propagation
    // precedent (groups-dm-reactions.spec.ts) — if this ever flakes, widen
    // the allowance rather than re-litigating the approach.
    await pageA.waitForTimeout(3_000);

    // Install a MutationObserver on Bob's NEXT navigation (runs before the
    // page's own scripts, via addInitScript) that latches `true` the moment
    // a [data-testid="msg-<id>"] node for the DELETED message ever attaches
    // to the DOM. This replaces point-in-time sampling — which can miss a
    // sub-poll-interval flash-render — with a continuous, gap-free
    // never-attached guarantee spanning the entire observation window.
    const deletedTestId = `msg-${id}`;
    await pageB.addInitScript((targetTestId: string) => {
      (window as any).__msgEverAttached = false;
      const mark = () => {
        (window as any).__msgEverAttached = true;
      };
      const scan = (node: Element) => {
        if (node.getAttribute?.('data-testid') === targetTestId) mark();
        node.querySelectorAll?.(`[data-testid="${targetTestId}"]`).forEach(mark);
      };
      const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.type === 'attributes' && m.target instanceof Element) scan(m.target);
          m.addedNodes.forEach((n) => n instanceof Element && scan(n));
        }
      });
      const start = () =>
        observer.observe(document.documentElement, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['data-testid'],
        });
      if (document.documentElement) start();
      else document.addEventListener('DOMContentLoaded', start);
    }, deletedTestId);

    // Bob opens the DM thread for the very first time since this message
    // was created — this is his first ingest of both signals together.
    await openDmWithPeer(pageB, USER_A.pubkeyHex);

    // Positive control assertion (see comment above): proves this mount's
    // ingest path actually delivered a message before we trust the absence
    // check below.
    await expect(pageB.locator(`[data-testid="msg-${controlId}"]`)).toBeVisible({ timeout: 30_000 });

    // Sustained poll for steady-state absence, backed by the MutationObserver
    // latch for gap-free "never attached" coverage over the same window.
    await expectMessageGone(pageB, id);
    const everAttached = await pageB.evaluate(() => (window as any).__msgEverAttached);
    expect(everAttached).toBe(false);
  });
});
