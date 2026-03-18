import type { BrowserContext, Page } from '@playwright/test';

/**
 * Suppress the Next.js dev-mode error overlay for an entire browser context.
 * Must be called BEFORE any page navigation.
 * Injects CSS that hides the `<nextjs-portal>` element which would otherwise
 * block all pointer events when an unhandled runtime error occurs (e.g. relay publish failures).
 */
export async function suppressErrorOverlay(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    // Inject a style to hide nextjs-portal elements as soon as DOM is ready
    const inject = () => {
      if (document.head) {
        const style = document.createElement('style');
        style.textContent = 'nextjs-portal { display: none !important; pointer-events: none !important; }';
        document.head.appendChild(style);
      }
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', inject);
    } else {
      inject();
    }
  });
}

/**
 * Remove existing Next.js dev-mode error overlay from a specific page.
 * Use this for pages already loaded before suppressErrorOverlay was set up.
 */
export async function dismissErrorOverlay(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.querySelectorAll('nextjs-portal').forEach((el) => el.remove());
    // Also inject persistent CSS
    const style = document.createElement('style');
    style.textContent = 'nextjs-portal { display: none !important; pointer-events: none !important; }';
    document.head.appendChild(style);
  });
}
