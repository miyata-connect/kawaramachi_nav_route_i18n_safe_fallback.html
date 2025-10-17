// e2e/tests/smoke.spec.ts
import { test, expect } from '@playwright/test';

/**
 * CI で Google Maps を本番読み込みするかどうか。
 * - GitHub Actions などで MAPS_E2E=1 を設定した時だけ “本物の Maps” を検証。
 * - それ以外（デフォルト）は skip して緑化を保つ（リファラ/ネットワークで落ちるのを防止）。
 */
const RUN_REAL_MAPS = process.env.MAPS_E2E === '1';

/** Google Maps の初期化完了を“段階的”に待つ */
async function waitForGoogleMapReady(page: import('@playwright/test').Page) {
  // 1) window.google.maps が生えるまで
  await page.waitForFunction(
    () => !!(window as any).google && !!(window as any).google.maps,
    { timeout: 45_000 }
  );

  // 2) .gm-style（地図コンテナ）が可視
  const gmStyle = page.locator('.gm-style');
  await expect(gmStyle).toBeVisible({ timeout: 45_000 });

  // 3) タイル（img/canvas）が1枚以上入るまで
  await page.waitForFunction(() => {
    const root = document.querySelector('.gm-style');
    if (!root) return false;
    const hasImg = !!root.querySelector('img[src*="googleapis.com"], img[src*="gstatic.com"]');
    const hasCanvas = !!root.querySelector('canvas');
    return hasImg || hasCanvas;
  }, { timeout: 45_000 });

  // 4) 著作権表記コンテナが DOM に attach
  const cc = page.locator('.gm-style-cc');
  await expect(cc).toBeAttached({ timeout: 45_000 });
}

test.describe.configure({ mode: 'serial' });

test.describe('Smoke: Google Maps が描画され主要UIが生存している', () => {
  test.beforeEach(async ({ page }) => {
    // ここはあなたのサイトのトップ/地図ページURLに合わせてください
    // 例: await page.goto('https://miyata-connect.github.io/walk-nav/');
    // ↓ 仮の相対パス（GitHub Pages 直下想定）。必要に応じて修正。
    await page.goto('./');
  });

  test('Maps 初期化とタイル & 著作権UI の生存確認', async ({ page }) => {
    // CI での誤爆（リファラ制限/ネットワーク制限）を回避
    test.info().annotations.push({ type: 'maps-e2e', description: RUN_REAL_MAPS ? 'enabled' : 'skipped' });
    if (process.env.CI && !RUN_REAL_MAPS) {
      test.fixme(true, 'CIで MAPS_E2E=1 が未設定のため、外部依存テストをスキップ');
    }

    // 画面サイズを固定（ヘッダ等で地図が折り返される誤検知を避ける）
    await page.setViewportSize({ width: 1280, height: 900 });

    // 地図の準備完了を待機
    await waitForGoogleMapReady(page);

    // 主要 UI の最終スモーク：ズームボタンや attribution が存在すること（軽く）
    await expect(page.locator('.gm-style')).toBeVisible();
    await expect(page.locator('.gm-style-cc')).toBeAttached();
  });
});

// 全体テスト時間（遅い回線でも落とさない）
test.setTimeout(120_000);

// flaky 対策のリトライ（CIのみ2回）
test.describe.configure({
  retries: process.env.CI ? 2 : 0,
});
