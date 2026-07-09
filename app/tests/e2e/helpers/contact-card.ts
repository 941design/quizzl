/**
 * Shared helpers for the contact-card-exchange epic's non-relay e2e specs
 * (contact-card-add.spec.ts, contact-card-share.spec.ts,
 * contact-card-deeplink.spec.ts).
 *
 * Card links are obtained the true end-to-end way: boot a real browser
 * context with a deterministic identity (+ nickname), then drive the actual
 * Settings "Share contact card" action (S6, AC-UX-4) so `encodeCard` /
 * `buildShareUrl` and the local signer run for real and the resulting link
 * is read back from the DOM. No card bytes are hand-built by test code, and
 * nothing here touches a relay — card exchange is entirely out-of-band
 * (AC-SEC-1), which is exactly why these specs live in the non-relay bucket.
 *
 * Identity/profile seeding follows the same `addInitScript` convention as
 * `groups-contacts.spec.ts`'s `bootUserWithProfile` and
 * `dm-giftwrap-bell.spec.ts`'s `bootUserOnGroups` — real `lp_*` localStorage
 * keys the app itself reads/writes, set before first load.
 */
import { Browser, BrowserContext, Page, expect } from '@playwright/test';
import { USER_A } from './auth-helpers';
import { suppressErrorOverlay } from './dismiss-error-overlay';

export const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

/** Marker used to locate the embedded card payload inside a card link. */
const CARD_LINK_MARKER = '#c=';

/**
 * Boot a fresh browser context with a deterministic identity and an optional
 * nickname pre-seeded, and land on `/`.
 */
export async function bootIdentity(
  browser: Browser,
  user: typeof USER_A,
  nickname?: string,
  options?: { grantClipboard?: boolean },
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL: BASE_URL });
  await suppressErrorOverlay(context);
  if (options?.grantClipboard) {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE_URL });
  }
  await context.addInitScript(
    ({ privateKeyHex, pubkeyHex, seedHex, nickname }) => {
      localStorage.setItem(
        'lp_nostrIdentity_v1',
        JSON.stringify({ privateKeyHex, pubkeyHex, seedHex }),
      );
      if (nickname) {
        localStorage.setItem('lp_userProfile_v1', JSON.stringify({ nickname, avatar: null }));
      }
    },
    {
      privateKeyHex: user.privateKeyHex,
      pubkeyHex: user.pubkeyHex,
      seedHex: user.seedHex,
      nickname: nickname ?? '',
    },
  );
  const page = await context.newPage();
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  return { context, page };
}

/**
 * Boot a fresh, completely anonymous browser context — no identity seeded at
 * all — for AC-UX-7's "visitor with no local identity" case.
 */
export async function newAnonymousContext(
  browser: Browser,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL: BASE_URL });
  await suppressErrorOverlay(context);
  const page = await context.newPage();
  return { context, page };
}

/**
 * Drive the real Profile "Share contact card" action (AC-UX-4) end to end and
 * return the resulting onboarding URL (`https://few.chat/add#c=<payload>`)
 * read from the DOM. `next dev` compiles `/profile` on first visit, so this
 * allows extra time for that.
 */
export async function getShareCardLink(page: Page): Promise<string> {
  await page.goto('/profile');
  await expect(page.getByTestId('profile-share-card-btn')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('profile-share-card-btn').click();
  await expect(page.getByTestId('npub-qr-modal-display')).toBeVisible();
  const valueEl = page.getByTestId('npub-qr-modal-value');
  await expect(valueEl).toBeVisible();
  const text = (await valueEl.textContent())?.trim();
  if (!text) throw new Error('[contact-card helpers] share card link was empty');
  return text;
}

/** Extract the raw `c=` payload from a card link, for direct `/add#c=` hash navigation. */
export function extractCardPayload(cardLink: string): string {
  const idx = cardLink.indexOf(CARD_LINK_MARKER);
  if (idx === -1) throw new Error(`[contact-card helpers] not a card link: ${cardLink}`);
  return cardLink.slice(idx + CARD_LINK_MARKER.length);
}
