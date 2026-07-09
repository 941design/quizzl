// E2E: Voice call ring + decline flow
//
// Tests the end-to-end signaling path for a call being placed and declined:
//
//   1. Alice and Bob are in a shared MLS group.
//   2. Alice starts a voice call from the group chat.
//   3. Bob's IncomingCallModal appears.
//   4. Bob clicks Decline.
//   5. Bob's modal closes; Alice's call screen closes.
//
// WebRTC note: Playwright is launched with --use-fake-device-for-media-stream so
// getUserMedia() returns fake audio/video streams. ICE negotiation is NOT tested
// here (it requires TURN for most CI environments). Only the signaling path
// (kind-21059 wraps via the strfry relay) and the UI state are verified.
//
// Covered ACs: AC-FLOW-1 (partial: ring + decline), AC-LIFE-2 (decline path)

import { test, expect, BrowserContext, Page } from '@playwright/test';
import { USER_A, USER_B, computeTestKeypairs } from './helpers/auth-helpers';
import { clearAppState } from './helpers/clear-state';
import { suppressErrorOverlay } from './helpers/dismiss-error-overlay';
import { createGroupAndInvite } from './helpers/group-setup';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3100';

async function bootUser(
  browser: { newContext: (opts: object) => Promise<BrowserContext> },
  user: typeof USER_A,
  nickname: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    permissions: ['microphone', 'camera'],
  });
  await suppressErrorOverlay(context);
  await context.addInitScript(
    ({ privateKeyHex, pubkeyHex, seedHex, nick }) => {
      localStorage.setItem('lp_nostrIdentity_v1', JSON.stringify({ privateKeyHex, pubkeyHex, seedHex }));
      localStorage.setItem('lp_userProfile_v1', JSON.stringify({ nickname: nick, avatar: null }));
      // Deterministic loopback ICE: empty iceServers means peer connections form
      // from host candidates alone, with no dependency on public STUN/TURN (which
      // is non-deterministic in CI and unreachable offline). Re-applied on every
      // navigation, so it survives clearAppState's lp_* wipe + reload.
      localStorage.setItem('lp_callIceOverride_v1', JSON.stringify({ iceServers: [], iceTransportPolicy: 'all' }));
    },
    { privateKeyHex: user.privateKeyHex, pubkeyHex: user.pubkeyHex, seedHex: user.seedHex, nick: nickname },
  );
  const page = await context.newPage();
  await page.goto('/');
  await clearAppState(page);
  await page.reload();
  return { context, page };
}

// Skipped: voice/video call UI icons are temporarily disabled (feature code retained).
test.describe.skip('Call: ring and decline', () => {
  test.beforeAll(async () => {
    await computeTestKeypairs();
  });

  test('USER_A calls USER_B; USER_B declines; both sides clear', async ({ browser }) => {
    const { context: aliceCtx, page: alicePage } = await bootUser(browser, USER_A, 'Alice');
    const { context: bobCtx, page: bobPage } = await bootUser(browser, USER_B, 'Bob');

    try {
      // ── Shared group setup ────────────────────────────────────────────────────
      // Uses the existing createGroupAndInvite helper which drives group creation
      // and invite acceptance entirely through the app UI (no raw relay writes).
      await createGroupAndInvite(alicePage, USER_B.npub, bobPage, 'Call Test Group');

      // ── Bob loads /groups/ so his IncomingCallWatcher is subscribed ───────────
      await bobPage.goto('/groups/');
      await expect(
        bobPage.getByTestId('groups-list').or(bobPage.getByTestId('groups-empty-state')),
      ).toBeVisible({ timeout: 30_000 });

      // Give the subscription 3 s to establish before Alice sends the offer.
      await bobPage.waitForTimeout(3_000);

      // ── Alice opens the group and starts a voice call ─────────────────────────
      await alicePage.goto('/groups/');
      // GroupCard renders data-testid="group-card-<id>" inside the groups-list
      // container; match by prefix so we don't depend on the generated id.
      const groupItem = alicePage.locator('[data-testid^="group-card-"]').first();
      await expect(groupItem).toBeVisible({ timeout: 30_000 });
      await groupItem.click();

      // Wait for the GroupCallToolbar voice button to appear in the chat section.
      const voiceBtn = alicePage.getByTestId('group-voice-call-btn');
      await expect(voiceBtn).toBeVisible({ timeout: 15_000 });
      await expect(voiceBtn).toBeEnabled();

      await voiceBtn.click();

      // ── Verify Alice's call screen opens ──────────────────────────────────────
      await expect(alicePage.getByTestId('call-screen')).toBeVisible({ timeout: 15_000 });

      // ── Bob's IncomingCallModal must appear ───────────────────────────────────
      // The modal appears when the kind-21059 wrap with the 25050 Offer is received,
      // decrypted, roster-verified, and written to callStore. Allow 30 s for relay
      // propagation + IncomingCallWatcher subscription processing.
      await expect(bobPage.getByTestId('incoming-call-modal')).toBeVisible({ timeout: 30_000 });

      // ── Bob declines ──────────────────────────────────────────────────────────
      await bobPage.getByTestId('incoming-call-decline-btn').click();

      // Bob's modal should close immediately.
      await expect(bobPage.getByTestId('incoming-call-modal')).not.toBeVisible({ timeout: 10_000 });

      // ── Alice's call screen closes after receiving the 25054 Reject ──────────
      // The CallManager tears down the call when the only callee declines.
      await expect(alicePage.getByTestId('call-screen')).not.toBeVisible({ timeout: 20_000 });

    } finally {
      await aliceCtx.close();
      await bobCtx.close();
    }
  });
});
