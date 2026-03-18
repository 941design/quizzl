import { test, expect } from '@playwright/test';

const THEMES = ['calm', 'playful', 'lego', 'minecraft', 'flower'] as const;

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

  test('decoration does not overlap menu items', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const decor = page.getByTestId('nav-banner-decor');
    const decorBox = await decor.boundingBox();
    expect(decorBox).not.toBeNull();

    // Desktop nav links sit to the right; decoration should stay in the left portion
    const nav = page.locator('nav[aria-label="Main navigation"]');
    const navBox = await nav.boundingBox();
    expect(navBox).not.toBeNull();

    // Decoration should occupy roughly one third of the nav width
    expect(decorBox!.width).toBeGreaterThan(navBox!.width * 0.25);
    expect(decorBox!.width).toBeLessThan(navBox!.width * 0.4);
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

  test('decoration SVG changes when theme is switched', async ({ page }) => {
    // Start with calm
    await page.goto('/');
    await page.evaluate(() =>
      localStorage.setItem('lp_settings_v1', JSON.stringify({ theme: 'calm', language: 'en' })),
    );
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const decor = page.getByTestId('nav-banner-decor');
    const calmBg = await decor.evaluate((el) => getComputedStyle(el).backgroundImage);

    // Switch to lego
    await page.evaluate(() =>
      localStorage.setItem('lp_settings_v1', JSON.stringify({ theme: 'lego', language: 'en' })),
    );
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const legoBg = await decor.evaluate((el) => getComputedStyle(el).backgroundImage);

    // The two backgrounds must differ
    expect(calmBg).not.toBe(legoBg);
  });
});
