// e2e/tests/smoke.spec.ts
import { test, expect } from '@playwright/test';

// ベースURL（環境変数があればそれを優先）
const BASE = process.env.E2E_BASE_URL || 'https://miyata-connect.github.io/walk-nav/';

test.describe('Smoke', () => {
  test('ページが開けて地図の帰属表示が見える', async ({ page }) => {
    // ページを開く
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });

    // タイトルがそれっぽいことを確認（簡易スモーク）
    await expect(page).toHaveTitle(/walk|nav|ナビ/i);

    // Google マップの帰属表記（年・言語に依存しないよう aria-label の前方一致で取る）
    const copyright = page.locator("[aria-label^='Map data ©'], [aria-label^='地図データ ©']");
    await expect(copyright).toBeVisible({ timeout: 10000 });
  });
});
