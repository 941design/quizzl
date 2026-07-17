/**
 * E2E: `/add` first-visit welcome screen — contact-card variant (epic:
 * first-visit-invite-welcome, story S3; AC-CONTACT-1..5, AC-NAME-2,
 * AC-RETURN-1, AC-PRIV-1/2).
 *
 * A genuine first-time visitor (no identity seeded — the app auto-generates
 * one on mount, S1's `isFreshIdentity`) who opens a real `/add#c=…` contact-
 * card link sees the blended `WelcomeInvite` screen instead of today's
 * "setting up…" spinner. Every card in this suite is produced the true
 * end-to-end way: a real booted browser context driving the actual Profile
 * "Share contact card" action (`getShareCardLink`, story S6 precedent), or a
 * real, deterministically-derived npub belonging to a genuinely computed test
 * identity (`computeTestKeypairs`) for the bare-npub fallback case — never a
 * hand-built or forged card.
 *
 * No relay traffic is required to observe any assertion in this file (the
 * add itself, the welcome screen's render, and the redirect decision are all
 * out-of-band — see contact-card-deeplink.spec.ts's identical precedent), so
 * this spec's filename carries neither a `groups-` nor `dm-` prefix and
 * therefore lands in the non-relay bucket (`make test-e2e-fast`) via
 * playwright.config.ts's testMatch/testIgnore split.
 */
import { test, expect, type Page } from '@playwright/test';
import { USER_A, USER_B, computeTestKeypairs } from './helpers/auth-helpers';
import { bootIdentity, newAnonymousContext, getShareCardLink, extractCardPayload } from './helpers/contact-card';

async function readContactPubkeys(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    try {
      const raw = localStorage.getItem('lp_contacts_v1');
      return raw ? Object.keys(JSON.parse(raw) as Record<string, unknown>) : [];
    } catch {
      return [];
    }
  });
}

async function readSavedNickname(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    try {
      const raw = localStorage.getItem('lp_userProfile_v1');
      return raw ? ((JSON.parse(raw) as { nickname: string }).nickname ?? null) : null;
    } catch {
      return null;
    }
  });
}

test.describe('/add first-visit welcome screen — contact-card variant', () => {
  test.beforeAll(async () => {
    await computeTestKeypairs();
  });

  test.afterEach(async ({ browser }) => {
    await Promise.all(browser.contexts().map((c) => c.close()));
  });

  test('AC-CONTACT-1/2/4/5, AC-NAME-2, AC-PRIV-1/2: a first-timer sees the inviter name, must enter a name to continue, and completing it saves the name + adds the contact', async ({
    browser,
  }) => {
    // ── A shares a real, named contact card. ────────────────────────────
    const sharer = await bootIdentity(browser, USER_A, 'Alice-Welcome');
    const cardLink = await getShareCardLink(sharer.page);
    const payload = extractCardPayload(cardLink);

    // ── B is a completely fresh visitor — no identity, no profile seeded
    // at all. Opening the link makes the app auto-generate an identity on
    // mount (isFreshIdentity = true for this load). ────────────────────
    const { context, page } = await newAnonymousContext(browser);

    // AC-PRIV-1: the hard privacy invariant is "never publish a kind-0
    // (profile metadata) event to a relay" — NOT "never open a WebSocket at
    // all". The app legitimately connects to relays for unrelated reasons
    // (e.g. publishing an MLS KeyPackage, kind 30443) regardless of this
    // story, on every identity mount, fresh or returning — asserting zero
    // connections would fail on pre-existing, unrelated app behavior. Track
    // every outgoing frame across the WHOLE flow (render + submit) and
    // assert none is ever a kind-0 EVENT publish — this is the actual
    // invariant CLAUDE.md requires and this story must not introduce a new
    // way to violate.
    let kind0EventPublished = false;
    page.on('websocket', (ws) => {
      ws.on('framesent', (frame) => {
        try {
          const text = typeof frame.payload === 'string' ? frame.payload : frame.payload.toString('utf-8');
          const data: unknown = JSON.parse(text);
          if (Array.isArray(data) && data[0] === 'EVENT' && (data[1] as { kind?: number })?.kind === 0) {
            kind0EventPublished = true;
          }
        } catch {
          // Non-JSON or non-EVENT frames (PING/AUTH/etc.) are irrelevant here.
        }
      });
    });

    await page.goto(`/add#c=${payload}`);

    // AC-CONTACT-1: the welcome screen renders, NOT the "setting up…" spinner.
    await expect(page.getByTestId('welcome-invite')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('add-page-setting-up')).toHaveCount(0);

    // AC-CONTACT-2: the readable, signature-verified inviter name is shown.
    await expect(page.getByTestId('welcome-invite-line')).toHaveText('Alice-Welcome invited you to few.chat');

    // AC-PRIV-2: merely rendering the invite line (a pure fragment decode,
    // no relay read) cannot have published anything by this point.
    expect(kind0EventPublished).toBe(false);

    // AC-CONTACT-5: the primary action is disabled until a non-blank name.
    await expect(page.getByTestId('welcome-primary-action')).toBeDisabled();
    await page.getByTestId('welcome-name-input').fill('Bob-Newcomer');
    await expect(page.getByTestId('welcome-primary-action')).toBeEnabled();

    // ── Complete the invite. ─────────────────────────────────────────────
    await page.getByTestId('welcome-primary-action').click();

    // AC-CONTACT-4c: lands on the added contact, never the pairing name-setup
    // detour (AC-NAME-2 — the name captured on the welcome screen satisfies
    // the pending-echo requirement inline). Match on the query string only
    // (not a literal `/contacts?` path prefix) — Next's static-export
    // trailing-slash convention renders this as `/contacts/?id=…` (see
    // contact-card-deeplink.spec.ts's identical precedent).
    await expect(page).toHaveURL(new RegExp(`id=${USER_A.pubkeyHex}&added=1`), { timeout: 20_000 });
    await expect(page).not.toHaveURL(/pairing=1/);

    // AC-CONTACT-4a / AC-NAME-1: the entered name was saved to the local
    // profile (observable state, not just the redirect).
    await expect.poll(() => readSavedNickname(page)).toBe('Bob-Newcomer');

    // AC-CONTACT-4b: the existing add-contact flow actually ran.
    await expect.poll(() => readContactPubkeys(page)).toContain(USER_A.pubkeyHex);

    // AC-PRIV-1: across the FULL flow — render, name entry, saveProfile,
    // and the completed add (incl. the pairing-echo attempt, which is a
    // targeted gift wrap, never a kind-0) — no public profile broadcast was
    // ever sent.
    expect(kind0EventPublished).toBe(false);

    await sharer.context.close();
    await context.close();
  });

  test('AC-CONTACT-3: a card with no readable name (bare npub) omits the invite line but still renders the pitch, name input, and action', async ({
    browser,
  }) => {
    // A real npub belonging to a genuinely-derived test identity (USER_B) —
    // exactly the "bare npub" input parseContactCard documents as a
    // first-class supported form (no signature to verify, so no readable
    // name is ever produced for it — AC-CONTACT-3's fallback).
    const { context, page } = await newAnonymousContext(browser);
    await page.goto(`/add#c=${USER_B.npub}`);

    await expect(page.getByTestId('welcome-invite')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('add-page-setting-up')).toHaveCount(0);

    // No invite line at all — not an empty one.
    await expect(page.getByTestId('welcome-invite-line')).toHaveCount(0);

    // The rest of the screen still renders (name input + action).
    await expect(page.getByTestId('welcome-name-input')).toBeVisible();
    await expect(page.getByTestId('welcome-primary-action')).toBeVisible();
    await expect(page.getByTestId('welcome-primary-action')).toBeDisabled();

    await page.getByTestId('welcome-name-input').fill('Carol-Newcomer');
    await expect(page.getByTestId('welcome-primary-action')).toBeEnabled();
    await page.getByTestId('welcome-primary-action').click();

    await expect(page).toHaveURL(new RegExp(`id=${USER_B.pubkeyHex}&added=1`), { timeout: 20_000 });
    await expect.poll(() => readSavedNickname(page)).toBe('Carol-Newcomer');
    await expect.poll(() => readContactPubkeys(page)).toContain(USER_B.pubkeyHex);

    await context.close();
  });

  test('AC-RETURN-1: a returning user (identity already on disk) opening a contact card link never sees the welcome screen', async ({
    browser,
  }) => {
    const sharer = await bootIdentity(browser, USER_A, 'Alice-Returning');
    const cardLink = await getShareCardLink(sharer.page);
    const payload = extractCardPayload(cardLink);

    // A visitor with an identity ALREADY seeded (bootIdentity, nameless) —
    // isFreshIdentity is false for this load, so today's pre-epic behavior
    // must apply unchanged.
    const visitor = await bootIdentity(browser, USER_B);
    await visitor.page.goto(`/add#c=${payload}`);

    // Give the page every chance to render the welcome screen if the gate
    // were broken, then assert it never appears at any point.
    await expect.poll(() => readContactPubkeys(visitor.page), { timeout: 15_000 }).toContain(USER_A.pubkeyHex);
    await expect(visitor.page.getByTestId('welcome-invite')).toHaveCount(0);

    await sharer.context.close();
    await visitor.context.close();
  });
});
