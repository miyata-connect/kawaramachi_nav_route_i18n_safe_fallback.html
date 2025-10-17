// e2e/tests/smoke.spec.ts
import { test, expect } from '@playwright/test';

/** Google Maps の初期化を確実に待つユーティリティ */
async function waitForGoogleMapReady(page: import('@playwright/test').Page) {
  // スクリプトロード（google.maps が生えるまで）
  await page.waitForFunction(() => {
    // @ts-ignore
    return !!(window as any).google && !!(window as any).google.maps;
  }, { timeout: 40_000 });

  // Maps のルートコンテナ（gm-style）が生成されるまで
  const gmStyle = page.locator('.gm-style');
  await expect(gmStyle).toBeVisible({ timeout: 40_000 });

  // 著作権表記のコンテナ（gm-style-cc）は表示タイミングが前後するので「存在」までに緩める
  const cc = page.locator('.gm-style-cc');
  await expect(cc).toBeAttached({ timeout: 40_000 });

  // タイルが1枚以上入るまで（img か canvas が子孫に現れる）
  await page.waitForFunction(() => {
    const root = document.querySelector('.gm-style');
    if (!root) return false;
    return !!root.querySelector('img[src*="googleapis.com"], img[src*="gstatic.com"], canvas');
  }, { timeout: 40_000 });
}

/** CI で位置情報を安定化（本体コードは変更しない） */
const GEO = { latitude: 34.3408, longitude: 134.0641, accuracy: 5 };

test.beforeEach(async ({ context, page }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation(GEO);

  // ページ読み込み前に geolocation をモック（getCurrentPosition / watchPosition）
  await page.addInitScript(({ lat, lng }) => {
    const fixed = { coords: { latitude: lat, longitude: lng, accuracy: 5 }, timestamp: Date.now() };
    const ok = (fn: any) => setTimeout(() => fn(fixed), 10);
    // @ts-ignore
    navigator.geolocation.getCurrentPosition = (succ: any) => ok(succ);
    // @ts-ignore
    navigator.geolocation.watchPosition = (succ: any) => { ok(succ); return 1; };
  }, { lat: GEO.latitude, lng: GEO.longitude });
});

test('Smoke: Maps が描画され主要UIが生存している', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  await waitForGoogleMapReady(page);

  // 地図の根要素が可視
  await expect(page.locator('.gm-style')).toBeVisible();

  // 主要UI（例：検索ボタン / 音声ボタン）が生きている
  await expect(page.getByRole('button', { name: /検索/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /音声/ })).toBeVisible();

  // 軽くインタラクション（スクロールで視差変化）
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(200);
  await page.mouse.wheel(0, 300);
});
