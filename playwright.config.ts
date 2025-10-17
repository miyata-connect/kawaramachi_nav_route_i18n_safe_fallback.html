// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

const BASE = process.env.E2E_BASE_URL || 'https://miyata-connect.github.io/walk-nav/';

export default defineConfig({
  testDir: 'e2e/tests',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE,
    trace: 'on-first-retry',
    screenshot: 'off',
    video: 'off',
    viewport: { width: 390, height: 844 }, // だいたいスマホ縦
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
