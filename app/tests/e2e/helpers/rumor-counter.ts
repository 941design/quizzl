import type { Page } from '@playwright/test';

declare global {
  interface Window {
    __rumorCounters: { in: Record<number, number>; out: Record<number, number> };
    __quizzlTest: {
      onRumorSent?: (kind: number) => void;
      onRumorReceived?: (kind: number) => void;
      parseProfilePayload?: (content: string) => unknown;
      onChatIdbWrite?: (args: { groupId: string; messageId: string }) => void;
    };
  }
}

/**
 * Install rumor counters on the page via addInitScript.
 *
 * Sets up window.__quizzlTest.onRumorSent and onRumorReceived callbacks that
 * are called by MarmotContext dev-mode hooks on each PROFILE_REQUEST_KIND send
 * and each PROFILE_RUMOR_KIND receive.
 *
 * FIXTURE-07-001 — permanent test infrastructure.
 */
export async function installRumorCounter(page: Page, kinds: number[]): Promise<void> {
  await page.addInitScript((kindsArg) => {
    window.__rumorCounters = { in: {}, out: {} };
    for (const k of kindsArg) {
      window.__rumorCounters.in[k] = 0;
      window.__rumorCounters.out[k] = 0;
    }
    window.__quizzlTest = window.__quizzlTest ?? ({} as Window['__quizzlTest']);
    window.__quizzlTest.onRumorSent = (kind) => {
      if (window.__rumorCounters.out[kind] !== undefined) {
        window.__rumorCounters.out[kind]++;
      }
    };
    window.__quizzlTest.onRumorReceived = (kind) => {
      if (window.__rumorCounters.in[kind] !== undefined) {
        window.__rumorCounters.in[kind]++;
      }
    };
  }, kinds);
}

/**
 * Read the current count for a rumor kind and direction from the page's counter.
 *
 * FIXTURE-07-001
 */
export async function getRumorCount(
  page: Page,
  kind: number,
  direction: 'in' | 'out',
): Promise<number> {
  return page.evaluate(
    ({ kind: k, direction: d }) => window.__rumorCounters?.[d]?.[k] ?? 0,
    { kind, direction },
  );
}
