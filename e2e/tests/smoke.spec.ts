// e2e/tests/smoke.spec.ts
import { test, expect } from '@playwright/test';

// ベースURL（Actions では E2E_BASE_URL を設定可）
const BASE =
  process.env.E2E_BASE_URL || 'https://miyata-connect.github.io/walk-nav/';

test.describe('Smoke', () => {
  test('ページが開けて地図の著作権表記が見える', async ({ page }) => {
    // ページ遷移＆読み込み待ち（タイル/ウィジェット安定まで）
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');

    // タイトルのスモーク確認（任意）
    await expect(page).toHaveTitle(/walk|nav|ナビ/i);

    // ── 著作権表記の可視確認（構造変化に強いコンテナ指定）
    const copyrightContainer = page.locator('.gm-style-cc');
    try {
      await expect(copyrightContainer).toBeVisible({ timeout: 15000 });
    } catch (e) {
      // 失敗時にスクショを残してデバッグ容易化
      await page.screenshot({
        path: 'test-results/smoke-fail.png',
        fullPage: true,
      });
      throw e;
    }

    // ── 代替案（コメントアウト）：テキストベースでのゆるい一致
    // const copyrightText = page.getByText(
    //   /(地図データ|Map data|利用規約|Terms of Use)/i
    // );
    // await expect(copyrightText).toBeVisible({ timeout: 15000 });
  });
});
