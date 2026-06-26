// E2E: Video call must show remote frames on BOTH sides (AC2 / bidirectional).
//
// Reproduces "only the caller sees both video images": a video call where the
// caller renders the callee's frames but the callee never renders the caller's.
// Unlike the voice connect test (which only checks that a stream attaches), this
// asserts ACTUAL video frames flow by reading videoWidth on the remote <video>
// element on each side.
//
// Uses two isolated browser contexts on the same machine with loopback ICE
// (lp_callIceOverride_v1), fake media devices, and a shared 2-member group.

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

/** Wait until the remote <video> tile actually has decoded frames (videoWidth > 0). */
async function remoteFrameWidth(page: Page): Promise<number> {
  return await page.evaluate(() => {
    const v = document.querySelector('[data-testid^="remote-video-"]') as HTMLVideoElement | null;
    return v ? v.videoWidth : -1;
  });
}

test.describe.serial('Call: video frames flow both ways', () => {
  test.beforeAll(async () => {
    await computeTestKeypairs();
  });

  test('USER_A video-calls USER_B; both sides render remote frames', async ({ browser }) => {
    const { context: aliceCtx, page: alicePage } = await bootUser(browser, USER_A, 'Alice');
    const { context: bobCtx, page: bobPage } = await bootUser(browser, USER_B, 'Bob');

    try {
      await createGroupAndInvite(alicePage, USER_B.npub, bobPage, 'Video Call Group');

      await bobPage.goto('/groups/');
      await expect(
        bobPage.getByTestId('groups-list').or(bobPage.getByTestId('groups-empty-state')),
      ).toBeVisible({ timeout: 30_000 });
      await bobPage.waitForTimeout(3_000);

      await alicePage.goto('/groups/');
      const groupItem = alicePage.locator('[data-testid^="group-card-"]').first();
      await expect(groupItem).toBeVisible({ timeout: 30_000 });
      await groupItem.click();

      // Start a VIDEO call.
      const videoBtn = alicePage.getByTestId('group-video-call-btn');
      await expect(videoBtn).toBeVisible({ timeout: 15_000 });
      await expect(videoBtn).toBeEnabled();
      await videoBtn.click();

      await expect(alicePage.getByTestId('call-screen')).toBeVisible({ timeout: 15_000 });

      // Bob accepts.
      await expect(bobPage.getByTestId('incoming-call-modal')).toBeVisible({ timeout: 30_000 });
      await bobPage.getByTestId('incoming-call-accept-btn').click();
      await expect(bobPage.getByTestId('call-screen')).toBeVisible({ timeout: 15_000 });

      // Both remote tiles must render and carry actual frames.
      await expect(alicePage.locator('[data-testid^="remote-video-"]').first()).toBeVisible({ timeout: 30_000 });
      await expect(bobPage.locator('[data-testid^="remote-video-"]').first()).toBeVisible({ timeout: 30_000 });

      // The real assertion: decoded frames on BOTH sides (videoWidth > 0).
      await expect.poll(() => remoteFrameWidth(alicePage), { timeout: 20_000 }).toBeGreaterThan(0);
      await expect.poll(() => remoteFrameWidth(bobPage), { timeout: 20_000 }).toBeGreaterThan(0);
    } finally {
      await aliceCtx.close();
      await bobCtx.close();
    }
  });
});
