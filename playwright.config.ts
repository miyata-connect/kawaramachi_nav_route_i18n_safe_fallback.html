import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/tests',
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    // ここを足すと可視判定が安定（アプリのコードは触りません）
    viewport: { width: 1280, height: 1200 },
    baseURL: process.env.E2E_BASE_URL || 'https://miyata-connect.github.io/walk-nav/',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
