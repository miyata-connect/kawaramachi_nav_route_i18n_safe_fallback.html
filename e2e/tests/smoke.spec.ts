// e2e/tests/smoke.spec.ts
import { test, expect } from '@playwright/test';

// GitHub Actions では E2E_BASE_URL を入れられます。
// 未設定なら公開ページ直URLを使います。
const BASE =
  process.env.E2E_BASE_URL || 'https://miyata-connect.github.io/walk-nav/';

test.describe('Smoke', () => {
  test('ページが開けて地図の著作権表記が見える', async ({ page }) => {
    // 1) ページ遷移（DOM 構築完了）→ ネットワーク静穏まで待つ
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');

    // 2) 地図コンテナ（gm-style）が視界にあることを軽く確認（任意）
    const mapContainer = page.locator('.gm-style');
    await expect(mapContainer.first()).toBeVisible({ timeout: 15000 });

    // 3) 著作権表記をテキストベースで待つ（多言語に対応）
    //    Google Maps は言語やレイアウトで要素構造が変わるため、
    //    .gm-style-cc 固定よりテキストの方が安定します。
    const copyrightText = page
      .locator('text=/\\b(Map data|地図データ|Terms of Use|利用規約)\\b/i')
      .first();

    try {
      await expect(copyrightText).toBeVisible({ timeout: 20000 });
    } catch (e) {
      // 失敗時はスクショ保存でデバッグ容易化
      await page.screenshot({
        path: 'test-results/smoke-fail.png',
        fullPage: true,
      });
      throw e;
    }
  });
});
