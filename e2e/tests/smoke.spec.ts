// e2e/tests/smoke.spec.ts
import { test, expect } from '@playwright/test';

// ベースURL（Actionsでは環境変数E2E_BASE_URLで上書き可能）
const BASE = process.env.E2E_BASE_URL || 'https://miyata-connect.github.io/walk-nav/';

test.describe('Smoke', () => {
  test('ページが開けて地図の著作表記が見える', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });

    // タイトルがそれっぽい
    await expect(page).toHaveTitle(/walk|nav|ナビ/i);

    // Googleマップの著作表記（言語と年は端末依存なので幅広く許容）
    const copyright = page.getByText(/地図データ|Map data|利用規約|Terms of Use/i);
    await expect(copyright).toBeVisible();
  });
});
