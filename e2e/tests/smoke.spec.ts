// e2e/tests/smoke.spec.ts
import { test, expect } from '@playwright/test';

/** Google Maps の初期化を堅牢に待つ */
async function waitForGoogleMapReady(page: import('@playwright/test').Page) {
  // google.maps が生えるまで（スクリプト読込完了待ち）
  await page.waitForFunction(() => {
    // @ts-ignore
    return !!(window as any).google && !!(window as any).google.maps;
  }, { timeout: 45_000 });

  // ルートコンテナ生成
  const gmStyle = page.locator('.gm-style');
  await expect(gmStyle).toBeVisible({ timeout: 45_000 });

  // 著作権表記は表示が遅れることがあるので attach まで緩める
  const cc = page.locator('.gm-style-cc');
  await expect(cc).toBeAttached({ timeout: 45_000 });

  // タイル（img/canvas）が1枚以上入るまで
  await page.waitForFunction(() => {
    const root = document.querySelector('.gm-style');
    if (!root) return false;
    return !!root.querySelector('img[src*="googleapis.com"], img[src*="gstatic.com"], canvas');
  }, { timeout: 45_000 });
}

/** 位置情報を固定（アプリ側コードは触らない） */
const GEO = { latitude: 34.3408, longitude: 134.0641, accuracy: 5 };

test.beforeEach(async ({ context, page }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation(GEO);

  // ページ読込前に geolocation をモック（安定化）
  await page.addInitScript(({ lat, lng }) => {
    const fixed = { coords: { latitude: lat, longitude: lng, accuracy: 5 }, timestamp: Date.now() };
    const ok = (fn: any) => setTimeout(() => fn(fixed), 10);
    // @ts-ignore
    navigator.geolocation.getCurrentPosition = (succ: any, _err?: any) => ok(succ);
    // @ts-ignore
    navigator.geolocation.watchPosition = (succ: any, _err?: any) => { ok(succ); return 1; };
  }, { lat: GEO.latitude, lng: GEO.longitude });
});

test('Smoke: Google Maps が描画され主要UIが生存している', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  await waitForGoogleMapReady(page);

  // 地図コンテナ
  await expect(page.locator('.gm-style')).toBeVisible();

  // 主要UI（ローカライズに依存しないロールで取得を優先）
  await expect(page.getByRole('button', { name: /検索|Search/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /音声|Voice/ })).toBeVisible();

  // 軽い操作（ズーム相当のホイール）
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(200);
  await page.mouse.wheel(0, 300);
});

/** 追加：著作権表記がロケール差で文字違いでも DOM に存在することだけ確認 */
test('Smoke: 著作権表記のコンテナが DOM に存在', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForGoogleMapReady(page);
  await expect(page.locator('.gm-style-cc')).toBeAttached();
});
