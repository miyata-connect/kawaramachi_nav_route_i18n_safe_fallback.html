---
title: WalkNav Progress Protocol
version: 2025-10-25
owner: WalkNav Core
lastReviewed: 2025-10-25
status: active
---

# 目的
タスクの状態遷移・承認フロー・報告タイミングを定義し、進捗の可視化と統制を担保する。

# 状態定義
- **Draft**：検討中/要件整理中
- **In-Progress**：実装・検証中
- **Hold**：不整合/承認待ちで停止
- **Review**：PR レビュー中
- **Ready**：マージ/リリース可
- **Done**：リリース完了

# 遷移ルール（抜粋）
- Draft → In-Progress：仕様照合とテンプレ展開が完了
- In-Progress → Review：チェックリスト完了 & テスト追加済み
- Review → Ready：レビュー承認 & CI 通過
- Ready → Done：タグ付け & リリース手順実施
- 任意 → Hold：規約/仕様の不整合・未確定事項を検知

# 報告タイミング
- 状態遷移時に Issue コメントへ要点を記録
- Hold 時は理由・必要承認者・再開条件を明記

# KPI（例）
- PR リードタイム
- レビューサイクル数
- リリース後 72h のエラー率

# 参照
- WalkNav Operation Policy
- WalkNav Operation Checklist
- WalkNav Operation Template
- Functional Spec / v2025-10-25
