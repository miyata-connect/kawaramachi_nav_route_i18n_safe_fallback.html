# Walk Nav サーバ仕様（上書き版 / SPEC.md）

発行日：2025-10-22 (Asia/Tokyo)  
対象：Cloudflare Worker（`worker.js`）が提供する API 群  
バージョン：v1（上書き確定版）  
更新版：v0.2.0（/v1/incidents v1 追加）

---

## 1. 概要

- 目的：徒歩ナビ用の軽量 API を安全・低コスト・低レイテンシで提供。  
- 提供エンドポイント：  
  - `GET /v1/health` …… 稼働/疎通確認  
  - `POST /v1/places` …… Google Places (New) の `places:searchText` プロキシ  
  - `GET /v1/weather` …… Open-Meteo 多時刻天気（**今 / +3h / +6h**, 日本語対応, 5分キャッシュ）  
  - `GET /v1/incidents` …… 周辺道路・通行止情報（Open Data / Provider混合, TTL=300）  
- UI/クライアントの見た目・文言は不要（本仕様はサーバ API と内部アルゴリズムのみ対象）。

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

### 寒さ規定 v1  
- `/v1/weather` 応答の `now.tempC` 値から寒さステージ (`stage`) を決定する。  
- ステージ区分: `>15`→`none`、`10–15`→`prefer`、`≤10`→`strong`。  
- ステージが `prefer` または `strong` の場合、経路探索では屋内・公共施設・商業施設内のセグメントを優先する。`strong` の場合は特に強く優先し、屋外部分のスコアを減点する。  

### GET /v1/incidents  
- 概要: 周辺の事故・工事・通行止情報を軽量に取得するエンドポイント。ルート探索時の危険回避や案内に利用する。  
- クエリパラメータ:  
  - `lat`、`lng`：取得地点（必須）  
  - `radius`：半径[m]。省略時は 500 m。  
  - `limit`：最大件数。省略時は 10。  
- レスポンス: 以下の構造を持つ JSON。  
```json  
{  
  "items": [  
    {  
      "id": "string",  
      "lat": 0,  
      "lng": 0,  
      "category": "accident" | "construction" | "closure",  
      "message": "string",  
      "source": "provider name",  
      "updatedAt": "ISO8601"  
    }  
  ],  
  "ttlSec": 300  
}  
```  
- `ttlSec` はこのデータのキャッシュ保持期間（秒）。現在は 300。
