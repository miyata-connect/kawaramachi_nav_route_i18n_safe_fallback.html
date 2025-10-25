---
title: WalkNav Functional Spec / v2025-10-25
version: 2025-10-25
owner: WalkNav Core
lastReviewed: 2025-10-25
status: canonical
---

> **This file pins the canonical Functional Spec version: v2025-10-25.**
>
> - If `SPEC.md` exists at repository root, it is treated as the **source content**.
> - This file serves as the **versioned alias** and MUST be the reference target from
>   Policy/Checklist/Template/Progress documents and README.
>
> 参照文言（他ドキュメントからの固定表記）：
> **“Functional Spec / v2025-10-25”**

## 1. 目的
機能仕様の参照先をバージョン固定し、変更管理とレビューの一貫性を確保する。

## 2. 内容ソース
- 既存の `SPEC.md`（リポジトリ直下）を**一次ソース**とする。
- 将来的に仕様本文を本ファイルへ移設する場合は、PR にて実体を移し、`SPEC.md` から当該章へリンクする。

## 3. 最低限含むべき仕様章（ガイド）
- 対象範囲・非対象
- UI/UX（地図表示・ローディング文言・非表示ポリシー）
- 位置情報取得（権限/誤差/再試行/フォールバック）
- 経路選択ロジック（歩行に特化した優先度）
- 音声/テキスト案内（タイミング・文言規約）
- エラー時挙動（通知・復帰・ログ）
- 依存サービス・キー管理（例：Google Maps ブラウザ API キー）
- 計測・テレメトリ（PII 無し）

## 4. 破壊的変更の扱い
- バージョンを上げ、移行ガイド/ロールバック手順を添付する。

## 5. 参照先
- WalkNav Operation Policy / Checklist / Template / Progress Protocol

---

**Fixed reference string:** _Functional Spec / v2025-10-25_
