# Walk Nav サーバ仕様（上書き版 / SPEC.md）

発行日：2025-10-22 (Asia/Tokyo)  
対象：Cloudflare Worker（`worker.js`）が提供する API 群  
バージョン：v1（上書き確定版）

---

## 1. 概要

- 目的：徒歩ナビ用の軽量 API を安全・低コスト・低レイテンシで提供。  
- 提供エンドポイント：  
  - `GET /v1/health` …… 稼働/疎通確認  
  - `POST /v1/places` …… Google Places (New) の `places:searchText` プロキシ  
  - `GET /v1/weather` …… Open-Meteo 多時刻天気（**今 / +3h / +6h**, 日本語対応, 5分キャッシュ）  
  - `GET /v1/incidents` …… 周辺道路・通行止情報（Open Data / Provider混合）  
- UI/クライアントの見た目・文言は不要（本仕様はサーバ API と内部アルゴリズムのみ）。

---

## 2. 表記ルール

- `[ ]`: 値域、`{ }`: 補足、`"`: JSON構造、`' '`: リテラル。  
- 時刻は ISO 8601 + TZ（例 `"2025-10-22T08:00:00+09:00"`）。  
- 日本語コメントはサーバ実装には含めずドキュメントのみ。  

---

## 3. `/v1/health`

### 概要
稼働監視用の軽量エンドポイント。

**Response**
```json
{ "status": "ok", "uptimeSec": 12345 }
