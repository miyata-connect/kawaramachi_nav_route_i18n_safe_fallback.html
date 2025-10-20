# /v1/places — Google Places Proxy (v1)

目的: Google Places API (New) への安全なプロキシ。APIキーは Worker 側で保持し、クライアントには露出しない。

## 要件 / 受入条件
- [ ] `GET /v1/places` が **200 OK**
- [ ] クエリ: `text`（検索語; 必須）, `lat` `lng` `radius`（任意）
- [ ] ヘッダ: `X-Goog-FieldMask` を **必須**（最小権限・最小応答）
- [ ] CORS: GET 許可・短期キャッシュ（max-age 短め）
- [ ] エラー時は **502**（上流エラー）/ **400**（クエリ不足）/ **429**（レート超過）を返す
- [ ] ログ匿名化（IP/UA は記録しない/マスク）
- [ ] Secrets: `GMAPS_API_KEY` を Cloudflare Variables に設定済みであること

## リクエスト例
GET /v1/places?text=徳島%20ラーメン&lat=34.070&lng=134.550&radius=1200
X-Goog-FieldMask: places.id,places.displayName.text,places.location

## 動作メモ
- Field Mask は **必須**。返却項目は最小に絞る（個人情報・過剰データ防止）。
- `lat/lng/radius` が無い場合は Google 側のデフォルト挙動に委ねる（**400**は出さない）。
- レート制御やキャッシュは短期（秒～分）で。障害時は 502 にフォールバック。
