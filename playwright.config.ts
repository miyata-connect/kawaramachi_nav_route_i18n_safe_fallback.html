// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  // テストの配置場所
  testDir: './e2e/tests',

  // タイムアウト類
  timeout: 30_000,
  expect: { timeout: 10_000 },

  // 並列・CI向け挙動
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,

  // レポーター
  reporter: [['list'], ['html', { open: 'never' }]],

  // 既定のブラウザ設定
  use: {
    // GitHub Pages を直接叩く。必要なら Actions の env:E2E_BASE_URL で上書き可
    baseURL:
      process.env.E2E_BASE_URL ||
      'https://miyata-connect.github.io/walk-nav/',
    viewport: { width: 1280, height: 1200 },
    navigationTimeout: 30_000,
    actionTimeout: 0,
    trace: 'on-first-retry',
  },

  // 対象ブラウザ（まずは Chromium だけ）
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // ＜補足＞
  // webServer の起動は不要（静的サイトを Pages から読むため）
});
