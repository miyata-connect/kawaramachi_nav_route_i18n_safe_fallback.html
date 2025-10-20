# /v1/places (scaffold)

目的: Google Places API の前段プロキシ

受入条件:
- [ ] `GET /v1/places?...` で **200/4xx/5xx** の基本ハンドリング
- [ ] クエリ/ヘッダ正規化（FieldMask, Language, LocationBias など最低限）
- [ ] 安全帯ルール（歩道/横断施設/地下道/歩道橋/踏切 等）の前処理フックを用意
- [ ] API鍵/レートリミットは Secrets/環境変数で差替可能
