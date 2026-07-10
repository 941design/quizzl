import { test, expect, type Locator } from '@playwright/test';
import { manifest as aquarelleManifest } from '../../src/themes/aquarelle/manifest';

const THEMES = ['aquarelle'] as const;

// Mirrors useDynamicBanner.ts's private encodeSvgDataUri / useThemeStyles.ts's
// navBannerDecor transform byte-for-byte (whitespace-collapse + trim, then
// encodeURIComponent) so these tests can compute the EXACT CSS
// `backgroundImage` value a real browser renders for aquarelle's frozen
// static fallback SVG (`treatments.banner` in
// app/src/themes/aquarelle/manifest.ts), and reliably tell "still on the
// static fallback" apart from "swapped to a freshly-generated SVG". A
// substring/filter-id marker was rejected: the real generator draws its
// filter-id suffix from a uniform [0, 9999) range, so over enough CI runs a
// genuinely fresh dynamic render could coincidentally reproduce any single
// numeric marker — an exact match against the full known static value has no
// such collision risk.
function encodeSvgDataUri(svg: string): string {
  const collapsed = svg.replace(/\s+/g, ' ').trim();
  return `url("data:image/svg+xml,${encodeURIComponent(collapsed)}")`;
}

const AQUARELLE_STATIC_BANNER_BG = encodeSvgDataUri(aquarelleManifest.treatments.banner);

async function readBannerBackgroundImage(decor: Locator): Promise<string> {
  return decor.evaluate((el) => getComputedStyle(el).backgroundImage);
}

// AC-UX-3a's static-then-swap window: every load/mount renders the frozen
// static fallback first, and only swaps to the async worker/idle-generated
// SVG once generation resolves. `waitForLoadState('networkidle')` does not
// gate on this — it's CPU work, not network — so reading the banner right
// after navigation can race the swap. Poll until the DOM has genuinely moved
// past the known static value before treating a read as "the generated one".
async function waitForDynamicBannerSwap(decor: Locator): Promise<void> {
  await expect.poll(() => readBannerBackgroundImage(decor), { timeout: 15_000 }).not.toBe(AQUARELLE_STATIC_BANNER_BG);
}

// Settle detector for MV-2's rapid live-toggle scenario: rather than a blind
// fixed wait (this repo's own e2e_ac60 lesson — a fixed wait after async
// generation is a known flaky anti-pattern), poll until the banner's
// backgroundImage stops changing across consecutive reads, i.e. any
// in-flight worker/idle-callback generation from the toggling has resolved
// (or been correctly discarded) and the DOM has reached its final state.
async function waitForBannerToSettle(decor: Locator): Promise<string> {
  let previous: string | undefined;
  let stableReads = 0;
  await expect
    .poll(
      async () => {
        const current = await readBannerBackgroundImage(decor);
        stableReads = current === previous ? stableReads + 1 : 0;
        previous = current;
        return stableReads;
      },
      { timeout: 15_000 },
    )
    .toBeGreaterThanOrEqual(2);
  return previous as string;
}

test.describe('Nav banner decoration', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      Object.keys(localStorage)
        .filter((k) => k.startsWith('lp_'))
        .forEach((k) => localStorage.removeItem(k));
    });
  });

  test('decoration element is present on default theme', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const decor = page.getByTestId('nav-banner-decor');
    await expect(decor).toBeVisible();

    // Should have an SVG data-URI background-image
    const bgImage = await decor.evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(bgImage).toContain('data:image/svg+xml');
  });

  test('decoration is positioned top-left and non-interactive', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const decor = page.getByTestId('nav-banner-decor');
    const styles = await decor.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        position: cs.position,
        pointerEvents: cs.pointerEvents,
        left: cs.left,
      };
    });

    expect(styles.position).toBe('absolute');
    expect(styles.pointerEvents).toBe('none');
    expect(parseInt(styles.left, 10)).toBeLessThanOrEqual(10);
  });

  test('decoration is a non-interactive background layer that never blocks menu items', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const decor = page.getByTestId('nav-banner-decor');
    const decorBox = await decor.boundingBox();
    expect(decorBox).not.toBeNull();

    const nav = page.locator('nav[aria-label="Main navigation"]');
    const navBox = await nav.boundingBox();
    expect(navBox).not.toBeNull();

    // aquarelle (the default, and only, theme) declares a dynamic banner, so
    // the decoration is the FULL-HEADER background layer (Layout's dynamic-
    // banner override), not the small corner box the removed static themes
    // used. It therefore spans the nav width — but it must be a purely
    // decorative background: `pointer-events: none` so it never intercepts a
    // menu click.
    expect(decorBox!.width).toBeGreaterThan(navBox!.width * 0.9);
    const pointerEvents = await decor.evaluate((el) => getComputedStyle(el).pointerEvents);
    expect(pointerEvents).toBe('none');
  });

  for (const theme of THEMES) {
    test(`decoration has SVG background for "${theme}" theme`, async ({ page }) => {
      // Set the theme via localStorage before navigating
      await page.goto('/');
      await page.evaluate(
        (t) => localStorage.setItem('lp_settings_v1', JSON.stringify({ theme: t, language: 'en' })),
        theme,
      );
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      const decor = page.getByTestId('nav-banner-decor');
      await expect(decor).toBeVisible();

      const bgImage = await decor.evaluate((el) => getComputedStyle(el).backgroundImage);
      expect(bgImage).toContain('data:image/svg+xml');
    });
  }

  // Story S8 / MV-1, MV-2 (specs/epic-dynamic-theme-visuals/acceptance-criteria.md,
  // epic-state.json manual_validation ledger): `aquarelle` is the first theme to
  // declare `treatments.dynamic.banner`, so these are the first real-browser
  // assertions that the post-hydration swap and per-load non-determinism actually
  // reach the rendered DOM (not just the pure resolveDynamicBannerStyle decision
  // function this repo's jsdom-less unit suite exercises).
  test('AC-UX-6/MV-1: aquarelle nav banner swaps to a freshly-generated SVG that differs across two separate page loads', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() =>
      localStorage.setItem('lp_settings_v1', JSON.stringify({ theme: 'aquarelle', language: 'en' })),
    );

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const decor = page.getByTestId('nav-banner-decor');
    await expect(decor).toBeVisible();

    // Wait for the genuine static->dynamic swap before reading the value
    // under test — otherwise a read landing pre-swap would compare the
    // frozen static value against itself (false failure) or against a later
    // load's dynamic value (a false pass for the wrong reason: static vs.
    // dynamic, not genuine per-load non-determinism of the generator).
    await waitForDynamicBannerSwap(decor);
    const firstLoadBg = await readBannerBackgroundImage(decor);
    expect(firstLoadBg).toContain('data:image/svg+xml');
    expect(firstLoadBg).not.toBe(AQUARELLE_STATIC_BANNER_BG);

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(decor).toBeVisible();
    await waitForDynamicBannerSwap(decor);
    const secondLoadBg = await readBannerBackgroundImage(decor);
    expect(secondLoadBg).toContain('data:image/svg+xml');
    expect(secondLoadBg).not.toBe(AQUARELLE_STATIC_BANNER_BG);

    // Non-determinism (AC-UX-1/AC-UX-6): two loads must produce visibly different
    // generated banners, not the same frozen static fallback served twice.
    expect(firstLoadBg).not.toBe(secondLoadBg);
  });

  test('AC-A11Y-1/AC-UX-6: aquarelle nav logo scrim is present and legible against the real generated banner', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() =>
      localStorage.setItem('lp_settings_v1', JSON.stringify({ theme: 'aquarelle', language: 'en' })),
    );
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // The scrim (S4) must be present whenever a dynamic banner is declared,
    // regardless of what the generator actually produced this load.
    const scrim = page.getByTestId('nav-logo-scrim');
    await expect(scrim).toBeVisible();

    const logoText = scrim.getByText('few.chat', { exact: false });
    await expect(logoText).toBeVisible();
  });

  test('MV-2: repeatedly re-selecting the aquarelle theme live never leaves a broken/blank banner or logs an uncaught error', async ({ page }) => {
    // The old two-theme toggle race (aquarelle <-> a static-only theme) is no
    // longer expressible now that aquarelle is the only shipped theme. This
    // retains the fail-soft smoke check: live in-SPA re-selection via
    // setTheme() must keep the banner valid and never throw.
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(String(err)));
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/profile');
    await page.waitForLoadState('networkidle');

    const aquarelleBtn = page.getByTestId('theme-aquarelle-btn');
    await expect(aquarelleBtn).toBeVisible();

    for (let i = 0; i < 5; i++) {
      await aquarelleBtn.click();
    }
    await page.waitForLoadState('networkidle');

    const decor = page.getByTestId('nav-banner-decor');
    await expect(decor).toBeVisible();

    // Wait for the DOM to genuinely settle (see waitForBannerToSettle) rather
    // than a blind fixed wait — this repo's e2e_ac60 fix established the same
    // rule: a fixed wait after async generation is a known flaky anti-pattern
    // that can also silently miss a late-arriving error.
    const finalBg = await waitForBannerToSettle(decor);
    // Never blank/missing (AC-UX-3a's fail-soft contract) regardless of
    // whether the last-settled generation was the dynamic SVG or the static
    // fallback it reverted to.
    expect(finalBg).toContain('data:image/svg+xml');

    expect(pageErrors, `uncaught page errors: ${pageErrors.join('; ')}`).toHaveLength(0);
    // Filtered rather than a blanket zero-console.error assertion: unrelated
    // dev-server resource noise (e.g. a benign 404 on a source map or
    // favicon) is not this test's concern and would make it flaky. Uncaught
    // exceptions are still caught unfiltered via the pageerror handler above,
    // so this filter only needs to cover non-throwing console noise.
    const relevantConsoleErrors = consoleErrors.filter((text) =>
      /worker|banner|generat|dynamicVisuals|unmounted|state update|setstate/i.test(text),
    );
    expect(relevantConsoleErrors, `console.error calls: ${relevantConsoleErrors.join('; ')}`).toHaveLength(0);
  });
});
