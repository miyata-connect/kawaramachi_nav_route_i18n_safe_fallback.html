# Walk Nav サーバ仕様（上書き版 / SPEC.md）

発行日：2025-10-20（Asia/Tokyo）  
対象：Cloudflare Worker（`worker.js`）が提供する API 群  
バージョン：v1（上書き確定版）

## 1. 概要
- 目的：徒歩ナビ用の軽量 API を安全・低コスト・低レイテンシで提供。
- 提供エンドポイント：
  - `GET /v1/health` … 稼働/疎通確認
  - `POST /v1/places` … Google Places (New) `places:searchText` プロキシ
  - `GET /v1/weather` … Open-Meteo 集約（**今 / +3h / +6h**、日本語対応、5分キャッシュ）
- UI/クライアントの見た目・文言は不変（本仕様はサーバ API と内部アルゴリズムのみ）。

## 2. 表記
- [ ]：値域、( )：補足、{ }：JSON 構造、" "：リテラル。
- 時刻は ISO 8601 + TZ（例 `"2025-10-20T03:00:00+09:00"`）。

## 3. 実行環境・シークレット
- プラットフォーム：Cloudflare Workers
- ファイル：`worker.js`（エントリ）、`wrangler.toml`（設定）
- Secret：`GMAPS_API_KEY`（Google Places API (New) 用、必須）
- Vars：平文キーは置かない。

## 4. 共通仕様
- CORS：
  - `Access-Control-Allow-Origin: *`
  - `Access-Control-Allow-Methods: GET, POST, OPTIONS`
  - `Access-Control-Allow-Headers: Content-Type, Accept-Language, X-Admin-Token`
- 言語：
  - 入力 `Accept-Language`（未指定時 `"ja-JP"`）。
  - `/v1/weather` の `lang` は `"ja"|"en"`（既定 `"ja"`）。
- エラー形式：
  ```json
  {"error":{"code":"<snake_case>","message":"<text>"}}
