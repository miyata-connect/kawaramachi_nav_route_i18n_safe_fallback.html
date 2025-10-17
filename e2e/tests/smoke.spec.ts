// e2e/tests/smoke.spec.ts
import { test, expect } from '@playwright/test';

// BASE は config の use.baseURL 優先。未設定なら直接 URL。
const BASE = process.env.E2E_BASE_URL || 'https://miyata-connect.github.io/walk-nav/';

test.describe('Smoke', () => {
  test('ページが開けて地図の著作権表記が DOM に存在する', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });

    // 1) マップ本体が初期化されるまで待つ（Google Maps の共通クラス）
    await expect(page.locator('.gm-style')).toBeVisible({ timeout: 20000 });

    // 2) コピーライトコンテナを取得（ここに "Map data © 20xx / Terms of Use / 地図データ / 利用規約" が入る）
    const copyrightBox = page.locator('.gm-style-cc');

    // 3) 文字列は言語で揺れるので正規表現でゆるく拾う
    //    例: "Map data ©2025", "Terms of Use", "地図データ ©2025", "利用規約" など
    const candidates = copyrightBox.filter({
      hasText: /\b(Map data|地図データ|Terms of Use|利用規約)\b/i,
    });

    // 4) 「可視」を直接要求すると hidden 判定に揺れることがあるため、
    //    まず DOM に何かしら該当があることを確認（= 0 でない）
    const count = await candidates.count();
    expect(count).toBeGreaterThan(0);

    // 5) 最初の要素は可視であること（多少待つ）
    await expect(candidates.first()).toBeVisible({ timeout: 20000 });
  });
});
