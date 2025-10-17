// e2e/tests/smoke.spec.ts
import { test, expect } from '@playwright/test';

const BASE =
  process.env.E2E_BASE_URL || 'https://miyata-connect.github.io/walk-nav/';

test.describe('Smoke', () => {
  test('ページが開けて地図の著作権表記が DOM に存在する', async ({ page }) => {
    // 1) ページ遷移 → ネットワーク静穏まで
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');

    // 2) 地図コンテナが少なくとも1つある（レンダラーが起動している）こと
    await expect(page.locator('.gm-style').first()).toBeVisible({ timeout: 15000 });

    // 3) 著作権表記の候補を「コンテナ or 代表テキスト」で幅広く拾う
    //    ・.gm-style-cc … Google Maps の著作権/利用規約ブロック
    //    ・text=...     … 言語や構造が違っても引っかかる代表語句
    const candidates = page.locator(
      '.gm-style-cc, text=/\\b(Map data|地図データ|Terms of Use|利用規約)\\b/i'
    );

    // 4) 可視ではなく「存在」を確認（ヘッドレスで hidden になる揺らぎを回避）
    const count = await candidates.count();
    // 失敗時に状況を残す
    if (count === 0) {
      await page.screenshot({ path: 'test-results/smoke-fail.png', fullPage: true });
    }
    expect(count).toBeGreaterThan(0);
  });
});
