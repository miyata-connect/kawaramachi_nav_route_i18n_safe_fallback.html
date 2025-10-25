---
title: WalkNav Operation Policy
version: 2025-10-25
owner: WalkNav Core
lastReviewed: 2025-10-25
status: active
---

# 目的
WalkNav の開発・運用における基本規範を定義する。安全性・可用性・保守性を最優先し、リリース判断・例外対応の基準を明文化する。

# 適用範囲
- ソースコード、ドキュメント、ビルド/デプロイ、サポート運用を含む全工程
- 外部キー/秘密情報の取り扱い（例: Google Maps ブラウザ API キー）

# 基本原則
1. **仕様準拠**：常に「Functional Spec / v2025-10-25」に整合。  
2. **最小権限**：資格情報は最小権限で保管・使用。コミットに含めない。  
3. **再現性**：PR ごとに CI で静的検査・仕様検証を実施。  
4. **可観測性**：障害時の再現ログ/メトリクス/ユーザー報告導線を確保。  
5. **承認プロセス**：破壊的変更・UI文言変更はレビュー + 承認必須。

# 禁止事項
- 機能仕様に未記載の挙動をリリースすること
- 機密情報の直書き（リポジトリ/Issue/PR コメントを含む）

# 変更手続き（承認フロー）
1. Issue 起票（目的・影響範囲・リスク・ロールバックを記載）  
2. Draft PR（テンプレートに従う）  
3. Reviewer ≥ 1 名の承認  
4. CI: `WalkNav Spec & Policy Guard` を通過  
5. マージ → リリース手順に従う

# 参照
- Functional Spec / v2025-10-25（spec/WalkNav_Functional_Spec_v2025-10-25.md）
- WalkNav Operation Checklist
- WalkNav Operation Template
- WalkNav Progress Protocol
