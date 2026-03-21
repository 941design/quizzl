import { defineConfig, devices } from '@playwright/test';

const isGroups = !!process.env.E2E_GROUPS;

// Server lifecycle managed by scripts/run-e2e.mjs (random free port).
const baseURL = process.env.BASE_URL || 'http://localhost:3000';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'list',

  ...(isGroups ? { timeout: 120_000 } : {}),

  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    ...(isGroups ? { actionTimeout: 30_000 } : {}),
  },

  expect: {
    ...(isGroups ? { timeout: 30_000 } : {}),
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
      },
      ...(isGroups
        ? { testMatch: 'groups-*.spec.ts' }
        : { testIgnore: 'groups-*.spec.ts' }),
    },
  ],
});
