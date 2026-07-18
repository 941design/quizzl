/**
 * Screenshot capture driver for the browsable UI documentation gallery.
 *
 * Runs under Playwright (its own config: playwright.screenshots.config.ts) so
 * it can reuse the e2e seed helpers (`createGroupAndInvite`, `seedContact`, the
 * deterministic keypairs) and drive every populated state through the app's
 * REAL publish paths — never a hand-signed relay event (CLAUDE.md e2e rule).
 *
 * It walks `screens.config.ts`, photographs each screen at all four viewports,
 * and writes `manifest.json` next to the images. `build-gallery.mjs` turns that
 * into `index.html`. Capture is resilient: any single screen (or an entire
 * populated scenario) that fails is recorded with status `failed` and the run
 * continues, so one flaky relay state never blanks the whole gallery.
 *
 * NOT part of the e2e gate — a separate config and Make target, deliberately
 * excluded from `make test`.
 */
import { test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { FLOWS, VIEWPORTS, type ScreenSpec } from './screens.config';
import { USER_A, USER_B, USER_C, computeTestKeypairs } from '../e2e/helpers/auth-helpers';
import { createGroupAndInvite, inviteContactViaPicker } from '../e2e/helpers/group-setup';
import { suppressErrorOverlay, dismissErrorOverlay } from '../e2e/helpers/dismiss-error-overlay';

// ── Output locations ───────────────────────────────────────────────────────
const OUT_DIR = path.resolve(process.env.SCREENSHOTS_OUT || 'screenshots-out');
const SHOTS_DIR = path.join(OUT_DIR, 'shots');

// ── Which builder keys are heavy, multi-user "scenarios" (vs. single-user
//    pre-actions handled inline in the simple loop). ─────────────────────────
const SCENARIO_BUILDERS = new Set([
  'contactsPopulated',
  'dmConversation',
  'groupWithMessages',
  'inviteModal',
  'pendingInvitation',
]);

// ── Capture results, merged into the manifest at the end. ────────────────────
type Shot = { viewport: string; width: number; height: number; file: string };
type Captured = { status: 'ok' | 'failed'; error?: string; shots: Shot[] };
const captured: Record<string, Captured> = {};

function recordFailure(screenId: string, error: unknown): void {
  captured[screenId] = { status: 'failed', error: String(error), shots: [] };
}

/** Photograph the current page state at every viewport. Best-effort per shot. */
async function captureScreen(page: Page, screen: ScreenSpec): Promise<void> {
  const rec: Captured = { status: 'ok', shots: [] };
  try {
    if (screen.waitFor) {
      await page
        .getByTestId(screen.waitFor)
        .first()
        .waitFor({ state: 'visible', timeout: 15_000 })
        .catch(() => {
          /* best-effort anchor — still capture what rendered */
        });
    }
    // Let webfonts settle so text isn't captured mid-swap.
    await page.evaluate(() => (document as any).fonts?.ready).catch(() => {});
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(screen.settleMs ?? 450);
      const file = `${screen.id}__${vp.id}.png`;
      await page.screenshot({
        path: path.join(SHOTS_DIR, file),
        fullPage: true,
        animations: 'disabled',
      });
      rec.shots.push({ viewport: vp.id, width: vp.width, height: vp.height, file });
    }
  } catch (error) {
    rec.status = 'failed';
    rec.error = String(error);
  }
  captured[screen.id] = rec;
}

/** Seed a deterministic identity + nickname + theme/language before first paint. */
async function seededContext(
  browser: Browser,
  opts: {
    user?: typeof USER_A;
    nickname?: string;
    theme?: string;
    language?: 'en' | 'de';
  } = {},
): Promise<BrowserContext> {
  const user = opts.user ?? USER_A;
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  await suppressErrorOverlay(context);
  await context.addInitScript(
    (args: {
      privateKeyHex: string;
      pubkeyHex: string;
      seedHex: string;
      nickname: string;
      settings: Record<string, unknown>;
    }) => {
      localStorage.setItem(
        'lp_nostrIdentity_v1',
        JSON.stringify({ privateKeyHex: args.privateKeyHex, pubkeyHex: args.pubkeyHex, seedHex: args.seedHex }),
      );
      localStorage.setItem('lp_userProfile_v1', JSON.stringify({ nickname: args.nickname, avatar: null }));
      localStorage.setItem('lp_settings_v1', JSON.stringify(args.settings));
    },
    {
      privateKeyHex: user.privateKeyHex,
      pubkeyHex: user.pubkeyHex,
      seedHex: user.seedHex,
      nickname: opts.nickname ?? 'Robin Maple',
      settings: {
        language: opts.language ?? 'en',
        ...(opts.theme ? { theme: opts.theme } : {}),
      },
    },
  );
  return context;
}

test.beforeAll(async () => {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  await computeTestKeypairs();
});

// ── 1. Single-user screens (route-based + inline pre-actions) ────────────────
test('single-user screens', async ({ browser }) => {
  test.setTimeout(300_000);
  for (const flow of FLOWS) {
    for (const screen of flow.screens) {
      if (screen.builder && SCENARIO_BUILDERS.has(screen.builder)) continue;
      let context: BrowserContext | null = null;
      try {
        context = await seededContext(browser, { theme: screen.theme, language: screen.language });
        const page = await context.newPage();
        await page.goto(screen.route || '/', { waitUntil: 'domcontentloaded' });
        await dismissErrorOverlay(page).catch(() => {});

        // Single-user pre-actions that reveal a state behind one interaction.
        if (screen.builder === 'settingsAdvanced') {
          await page.getByTestId('advanced-settings-toggle').click().catch(() => {});
        }
        if (screen.builder === 'createGroupModal') {
          await page.getByTestId('create-group-btn').click().catch(() => {});
        }

        await captureScreen(page, screen);
      } catch (error) {
        recordFailure(screen.id, error);
      } finally {
        await context?.close().catch(() => {});
      }
    }
  }
});

// ── 2. Scenario: a real group with a member + messages, the invite modal,
//       a populated address book, and a two-way DM (all off one setup). ───────
test('scenario: group, contact and direct message', async ({ browser }) => {
  test.setTimeout(600_000);
  const screensById = new Map<string, ScreenSpec>();
  for (const flow of FLOWS) for (const s of flow.screens) screensById.set(s.id, s);

  let aliceCtx: BrowserContext | null = null;
  let bobCtx: BrowserContext | null = null;
  try {
    aliceCtx = await seededContext(browser, { user: USER_A, nickname: 'Robin Maple' });
    bobCtx = await seededContext(browser, { user: USER_B, nickname: 'Sam Birch' });
    const alice = await aliceCtx.newPage();
    const bob = await bobCtx.newPage();
    await alice.goto('/');
    await bob.goto('/');

    // Real end-to-end group setup (create → invite via contact picker → accept).
    await createGroupAndInvite(alice, USER_B.npub, bob, 'Watercolour Workshop');

    // Alice is on the group detail page. Exchange a couple of messages so the
    // conversation isn't empty.
    await alice.getByTestId('chat-input').fill("Welcome! Let's paint this week 🎨").catch(() => {});
    await alice.getByTestId('chat-input').press('Enter').catch(() => {});
    await alice.waitForTimeout(2_000);

    // Bob opens the group and replies.
    try {
      await bob.locator('[data-testid^="group-card-"]').first().click();
      await bob.getByTestId('group-detail-page').waitFor({ state: 'visible', timeout: 30_000 });
      await bob.getByTestId('chat-input').fill('Thanks for the invite — see you there!');
      await bob.getByTestId('chat-input').press('Enter');
      await bob.waitForTimeout(2_000);
    } catch {
      /* one-sided conversation is still a usable screenshot */
    }

    // group-detail: settle so both messages are visible on Alice's side.
    const groupDetailUrl = alice.url();
    await alice.reload().catch(() => {});
    await alice.getByTestId('group-detail-page').waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
    await alice.waitForTimeout(1_500);
    if (screensById.has('group-detail')) await captureScreen(alice, screensById.get('group-detail')!);

    // group-invite: reopen the invite modal (Bob is already a contact).
    try {
      await alice.getByTestId('invite-member-btn').click();
      await alice.getByTestId('invite-member-modal-content').waitFor({ state: 'visible', timeout: 15_000 });
      if (screensById.has('group-invite')) await captureScreen(alice, screensById.get('group-invite')!);
      await alice.keyboard.press('Escape').catch(() => {});
    } catch (error) {
      recordFailure('group-invite', error);
    }

    // contacts-populated: Alice's address book now holds Bob.
    try {
      await alice.goto('/contacts');
      await alice.getByTestId('contacts-list').waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {});
      if (screensById.has('contacts-populated')) await captureScreen(alice, screensById.get('contacts-populated')!);
    } catch (error) {
      recordFailure('contacts-populated', error);
    }

    // dm-conversation: Alice and Bob share a group, so the DM gate is open.
    try {
      await alice.goto(`/contacts?id=${USER_B.pubkeyHex}`);
      await alice.getByTestId('chat-input').waitFor({ state: 'visible', timeout: 30_000 });
      await alice.getByTestId('chat-input').fill('Hi Sam — loved the piece you shared!');
      await alice.getByTestId('chat-input').press('Enter');
      await alice.waitForTimeout(1_500);
      try {
        await bob.goto(`/contacts?id=${USER_A.pubkeyHex}`);
        await bob.getByTestId('chat-input').waitFor({ state: 'visible', timeout: 30_000 });
        await bob.getByTestId('chat-input').fill('Thank you! 🌿 More soon.');
        await bob.getByTestId('chat-input').press('Enter');
        await bob.waitForTimeout(1_500);
      } catch {
        /* Alice's side alone is still a valid DM screenshot */
      }
      await alice.reload().catch(() => {});
      await alice.getByTestId('chat-input').waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
      await alice.waitForTimeout(1_500);
      if (screensById.has('dm-conversation')) await captureScreen(alice, screensById.get('dm-conversation')!);
    } catch (error) {
      recordFailure('dm-conversation', error);
    }

    void groupDetailUrl;
  } catch (error) {
    for (const id of ['group-detail', 'group-invite', 'contacts-populated', 'dm-conversation']) {
      if (!captured[id]) recordFailure(id, error);
    }
  } finally {
    await aliceCtx?.close().catch(() => {});
    await bobCtx?.close().catch(() => {});
  }
});

// ── 3. Scenario: the invitee's pending-invitation state (captured before
//       acceptance, which the combined scenario above races past). ────────────
test('scenario: pending invitation', async ({ browser }) => {
  test.setTimeout(300_000);
  const screensById = new Map<string, ScreenSpec>();
  for (const flow of FLOWS) for (const s of flow.screens) screensById.set(s.id, s);

  let aliceCtx: BrowserContext | null = null;
  let caraCtx: BrowserContext | null = null;
  try {
    aliceCtx = await seededContext(browser, { user: USER_A, nickname: 'Robin Maple' });
    caraCtx = await seededContext(browser, { user: USER_C, nickname: 'Cara Poplar' });
    const alice = await aliceCtx.newPage();
    const cara = await caraCtx.newPage();

    // Cara comes online first so stale gift wraps are drained and marked seen.
    await cara.goto('/groups/');
    await cara
      .getByTestId('groups-empty-state')
      .or(cara.getByTestId('groups-list'))
      .first()
      .waitFor({ state: 'visible', timeout: 30_000 });
    await cara.waitForTimeout(8_000);
    await cara.evaluate(() => localStorage.removeItem('lp_pendingInvitations_v1'));

    // Alice creates a group and invites Cara — but we stop BEFORE Cara accepts.
    await alice.goto('/groups/');
    await alice
      .getByTestId('groups-empty-state')
      .or(alice.getByTestId('groups-list'))
      .first()
      .waitFor({ state: 'visible', timeout: 30_000 });
    await alice.getByTestId('create-group-btn').click();
    await alice.getByTestId('create-group-modal-content').waitFor({ state: 'visible' });
    await alice.getByTestId('create-group-name-input').fill('Evening Sketching');
    await alice.getByTestId('create-group-submit-btn').click();
    await alice.getByText('Evening Sketching').waitFor({ state: 'visible', timeout: 30_000 });
    await dismissErrorOverlay(alice).catch(() => {});
    await alice.waitForTimeout(3_000);

    await alice.locator('[data-testid^="group-card-"]', { hasText: 'Evening Sketching' }).click();
    await alice.getByTestId('group-detail-page').waitFor({ state: 'visible', timeout: 30_000 });
    await inviteContactViaPicker(alice, USER_C.npub);
    await alice.getByTestId('invite-success').waitFor({ state: 'visible', timeout: 60_000 });

    // Cara's pending-invitations queue receives the fresh gift wrap.
    await cara.waitForTimeout(5_000);
    await cara
      .getByTestId('pending-invitations-section')
      .waitFor({ state: 'visible', timeout: 45_000 });
    if (screensById.has('group-pending-invitation')) {
      await captureScreen(cara, screensById.get('group-pending-invitation')!);
    }
  } catch (error) {
    recordFailure('group-pending-invitation', error);
  } finally {
    await aliceCtx?.close().catch(() => {});
    await caraCtx?.close().catch(() => {});
  }
});

// ── Write the manifest the gallery renders from. ─────────────────────────────
test.afterAll(async () => {
  const flows = FLOWS.map((flow) => ({
    id: flow.id,
    title: flow.title,
    summary: flow.summary,
    screens: flow.screens.map((s) => ({
      id: s.id,
      title: s.title,
      description: s.description,
      invariants: s.invariants,
      populated: !!(s.builder && SCENARIO_BUILDERS.has(s.builder)),
      capture: captured[s.id] ?? { status: 'failed', error: 'not captured', shots: [] },
    })),
  }));

  const totals = flows
    .flatMap((f) => f.screens)
    .reduce(
      (acc, s) => {
        if (s.capture.status === 'ok') acc.ok += 1;
        else acc.failed += 1;
        return acc;
      },
      { ok: 0, failed: 0 },
    );

  const manifest = {
    generatedAt: new Date().toISOString(),
    buildVersion: process.env.NEXT_PUBLIC_BUILD_VERSION || 'dev',
    viewports: VIEWPORTS,
    totals,
    flows,
  };

  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  // eslint-disable-next-line no-console
  console.log(`[screenshots] manifest written: ${totals.ok} ok, ${totals.failed} failed`);
});
