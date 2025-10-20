# Walk-Nav v1 Endpoints (scaffold)

方針：**1ドメイン + 複数パス + /v1**（Cloudflare Worker）

提供パス:
- `GET /v1/health`    … 稼働確認（200/OK, build/meta）
- `GET /v1/places`    … Google Places Proxy（Header 正規化, FieldMask, 安全帯ポリシ適用の前段）
- `GET /v1/weather`   … 天候・暑熱情報の集約（無料/低料金ソースの暫定）
- `GET /v1/incidents` … 事件・事故等の簡易集約（ソース確定まではダミー）

## 運用ルール（要点のみ）
- 位置許可は **前景（When In Use）** で運用
- 自動リルートはしない：案内のみ → 「よろしいですか？」確認の上で切替
- Shortest/Safest/Accessible 定義は `docs/walk-voice-rules.md` に従う
- バージョン付け: `/v1` 固定（互換を壊す変更は /v2 で）

## TODO（このブランチ内で完了させる）
- [ ] `/v1/health` のレスポンス雛形（200/OK, build/meta ダミー）
- [ ] `/v1/places` の外形（Header 正規化, FieldMask 通しの前処理のみ）
- [ ] `/v1/weather` の外形（無料/低料金APIのスイッチング層のみ）
- [ ] `/v1/incidents` の外形（ダミーデータ返却）
- [ ] CORS 方針（GET のみ短期）とログ匿名化の基本形
- [ ] README（環境変数とSecretsの置き方の骨子）
