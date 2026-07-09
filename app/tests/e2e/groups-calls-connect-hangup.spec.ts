// E2E: Voice call connect + hangup flow (AC-FLOW-1)
//
// Tests the full media path for a 1:1 call that actually connects:
//
//   1. Alice and Bob are in a shared 2-member MLS group.
//   2. Alice starts a voice call from the group chat.
//   3. Bob's IncomingCallModal appears; Bob accepts.
//   4. Both peers reach the active call screen AND a remote media tile appears
//      on each side — proof that ICE negotiated and the remote track arrived
//      (this is what the manager-level pending-ICE queue makes reliable: the
//      caller trickles ICE before the callee has a PeerSession, and those
//      candidates must not be dropped).
//   5. Alice hangs up; both call screens close.
//
// WebRTC note: Playwright is launched with --use-fake-device-for-media-stream so
// getUserMedia() returns fake audio/video. The test injects an empty-iceServers
// override (lp_callIceOverride_v1) so the connection forms from loopback host
// candidates alone — deterministic, no external TURN, per AC-FLOW-1.
//
// Covered ACs: AC-FLOW-1 (1:1 voice call connects + hangup tears down)

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
      // from host candidates alone, with no dependency on public STUN/TURN.
      // Re-applied on every navigation, so it survives clearAppState + reload.
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
test.describe.skip('Call: connect and hangup', () => {
  test.beforeAll(async () => {
    await computeTestKeypairs();
  });

  test('USER_A calls USER_B; USER_B accepts; both connect; hangup clears both', async ({ browser }) => {
    const { context: aliceCtx, page: alicePage } = await bootUser(browser, USER_A, 'Alice');
    const { context: bobCtx, page: bobPage } = await bootUser(browser, USER_B, 'Bob');

    try {
      // ── Shared group setup (drives all relay writes through the app) ──────────
      await createGroupAndInvite(alicePage, USER_B.npub, bobPage, 'Connect Test Group');

      // ── Bob loads /groups/ so his IncomingCallWatcher is subscribed ───────────
      await bobPage.goto('/groups/');
      await expect(
        bobPage.getByTestId('groups-list').or(bobPage.getByTestId('groups-empty-state')),
      ).toBeVisible({ timeout: 30_000 });

      // Give the subscription time to establish before Alice sends the offer.
      await bobPage.waitForTimeout(3_000);

      // ── Alice opens the group and starts a voice call ─────────────────────────
      await alicePage.goto('/groups/');
      const groupItem = alicePage.locator('[data-testid^="group-card-"]').first();
      await expect(groupItem).toBeVisible({ timeout: 30_000 });
      await groupItem.click();

      const voiceBtn = alicePage.getByTestId('group-voice-call-btn');
      await expect(voiceBtn).toBeVisible({ timeout: 15_000 });
      await expect(voiceBtn).toBeEnabled();
      await voiceBtn.click();

      // ── Alice's call screen opens ─────────────────────────────────────────────
      await expect(alicePage.getByTestId('call-screen')).toBeVisible({ timeout: 15_000 });

      // ── Bob's IncomingCallModal appears; Bob accepts ──────────────────────────
      await expect(bobPage.getByTestId('incoming-call-modal')).toBeVisible({ timeout: 30_000 });
      await bobPage.getByTestId('incoming-call-accept-btn').click();

      // Bob's modal closes and his call screen opens (active state).
      await expect(bobPage.getByTestId('incoming-call-modal')).not.toBeVisible({ timeout: 10_000 });
      await expect(bobPage.getByTestId('call-screen')).toBeVisible({ timeout: 15_000 });

      // ── Both peers connect: a remote media tile appears on each side ──────────
      // The remote tile renders only once the participant's stream is non-null,
      // which happens when onTrack fires — i.e. the RTCPeerConnection connected
      // and media flowed. This is the assertion that would fail if early ICE
      // candidates were dropped (the bug the pending-ICE queue fixes).
      await expect(alicePage.locator('[data-testid^="remote-video-"]').first()).toBeVisible({ timeout: 30_000 });
      await expect(bobPage.locator('[data-testid^="remote-video-"]').first()).toBeVisible({ timeout: 30_000 });

      // ── Alice hangs up; both call screens close ───────────────────────────────
      await alicePage.getByTestId('hangup-btn').click();
      await expect(alicePage.getByTestId('call-screen')).not.toBeVisible({ timeout: 20_000 });
      await expect(bobPage.getByTestId('call-screen')).not.toBeVisible({ timeout: 20_000 });

    } finally {
      await aliceCtx.close();
      await bobCtx.close();
    }
  });
});
