import { defineConfig, devices } from '@playwright/test';

// Dedicated config for the documentation-screenshot capture. Kept separate from
// playwright.config.ts so the capture is NEVER pulled into the e2e gate: it has
// its own testDir/testMatch and is only ever launched by
// scripts/run-screenshots.mjs (which boots the dev server on a random port and
// sets BASE_URL, exactly like run-e2e.mjs).
const baseURL = process.env.BASE_URL || 'http://localhost:3000';

export default defineConfig({
  testDir: './tests/screenshots',
  testMatch: ['capture.ts'],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  // Populated scenarios drive a full MLS group setup; give them room.
  timeout: 600_000,
  use: {
    baseURL,
    // Crisp 2× captures for documentation.
    deviceScaleFactor: 2,
    actionTimeout: 30_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
