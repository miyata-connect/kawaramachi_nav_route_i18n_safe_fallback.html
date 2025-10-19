## Walk-Nav Docs

歩行ナビの音声案内ルール、経路選択ポリシー、しきい値（運用値）とテスト観点のまとまったドキュメントです。

- **Walk-Voice & Routing Rules**  
  音声案内／経路選択の正式仕様（Shortest / Safest / Accessible の定義、横断手段の制約、モール施設通過の扱い など）  
  → [/docs/walk-voice-rules.md](./docs/walk-voice-rules.md)

- **Ops Thresholds & Mode Matrix**  
  季節・天候のしきい値（例: 夏季 6–10 月、炎天下 28℃ 以上）と、各モードの可否表（急勾配の扱い等）  
  → [/docs/ops-thresholds.md](./docs/ops-thresholds.md)

- **Routing Health – Test Checklist**  
  仕様順守を自動/手動で点検するためのチェック項目（安全帯限定・横断手段の厳守・炎天下回避ルートなど）  
  → [/docs/tests/routing-health.md](./docs/tests/routing-health.md)

### 起動時の選択肢（UI概要）
- 「選択したルート案内を優先」 または 「天候回避ルート案内を優先」を選択可能  
- 走行中（歩行中）でも **天候回避** ボタンで即時リルート  
  - 音声: 「天候回避ボタンを選択されました。只今より、天候回避ルートでご案内します」

> **Note**  
> Shortest は「安全帯必須・歩道が無い区間は路肩可」。横断は「横断歩道／歩道橋／地下道／踏切のみ」。  
> イオン/ゆめタウン等のモール施設の**駐車場・店内通路の歩行も可**。

_Last updated: YYYY-MM-DD_
