// tests/smoke.spec.ts
import { test, expect } from '@playwright/test';

/**
 * Maps が「本当に」初期化完了したかを判定する関数。
 * - window.google / google.maps が存在
 * - .gm-style（Maps が必ず挿入するコンテナ）が可視 & サイズ>0
 */
async function waitForGoogleMapReady(page: import('@playwright/test').Page) {
  // Google Maps スクリプト自体のロード待ち
  await page.waitForFunction(() => {
    // @ts-ignore
    return !!(window as any).google && !!(window as any).google.maps;
  }, { timeout: 30_000 });

  // 地図 DOM（.gm-style）が可視になりサイズが乗るまで待つ
  await page.waitForFunction(() => {
    const el = document.querySelector('.gm-style') as HTMLElement | null;
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    const visible = style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    return visible;
  }, { timeout: 30_000 });
}

/**
 * CI で位置情報を安定供給（現在地待ちで詰まらないように固定座標を付与）
 * ※ アプリ本体は触らない。テストの前処理で権限 & 座標を注入。
 */
const GEO = { latitude: 34.3408, longitude: 134.0641, accuracy: 5 };

test.beforeEach(async ({ context, page }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation(GEO);

  // ページに入る前に geolocation を確実に提供（アプリの getCurrentPosition/ watchPosition から参照される）
  await page.addInitScript(({ lat, lng }) => {
    const fixed = { coords: { latitude: lat, longitude: lng, accuracy: 5 }, timestamp: Date.now() };
    const ok = (success: PositionCallback) => setTimeout(() => success(fixed as any), 10);
    const err = (_: PositionErrorCallback) => {};
    // @ts-ignore
    navigator.geolocation.getCurrentPosition = (succ: any, _fail?: any) => ok(succ);
    // @ts-ignore
    navigator.geolocation.watchPosition = (succ: any, _fail?: any) => {
      ok(succ);
      return 1; // watchId
    };
  }, { lat: GEO.latitude, lng: GEO.longitude });
});

test('smoke: Google Maps が表示され、主要UIが生きている', async ({ page }) => {
  // 1) トップへ
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  // 2) Google Maps 初期化完了を厳密に待つ
  await waitForGoogleMapReady(page);

  // 3) 地図の可視性（真っ白誤検知を避ける）
  const mapContainer = page.locator('.gm-style');
  await expect(mapContainer).toBeVisible();

  // 4) 主要UIが最低限生きている（例：検索ボタン、音声ボタン）
  //    実アプリのテキストに合わせる（日本語UI前提）
  const searchBtn = page.getByRole('button', { name: /検索/ });
  await expect(searchBtn).toBeVisible();

  const voiceBtn = page.getByRole('button', { name: /音声/ });
  await expect(voiceBtn).toBeVisible();

  // 5) ズームや移動が可能（地図がホントに生きてるか軽く触る）
  //    Maps キーボード/マウスイベントは重いので、DOM スクロールで代替の軽い生存確認でも可。
  await page.mouse.wheel(0, -400); // 上方向へスクロール
  await page.waitForTimeout(300);
  await page.mouse.wheel(0, 400);  // 戻す
});