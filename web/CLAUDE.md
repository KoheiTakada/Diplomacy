# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## プロジェクト概要

ボードゲーム「ディプロマシー」の進行補助 Web アプリ。7か国のプレイヤーが命令を入力し、ルールエンジンが解決結果をアニメーション付きで表示する。ローカル（IndexedDB）とオンライン（Supabase）の2モードをサポート。

## 開発コマンド

`web/` ディレクトリで実行：

```bash
npm run dev       # 開発サーバー (http://localhost:3000)
npm run build     # 本番ビルド
npm run lint      # ESLint
npm run test      # Jest（全テスト）
npm test -- --testPathPattern=rulesEngine  # テストファイル指定
npm test -- -t "convoy"                    # テスト名指定
```

## 設計上の決定・制約

- **ゲームロジックは純粋関数モジュールのみ**。コンポーネントや API ルートに書かない
- **SVG 操作は `mapView/*.ts` に分離**。`MapView.tsx` に直接書かない
- **`DiplomacyGameContext` が唯一の状態ソース**（約2800行）。`PersistedSnapshot` を JSON シリアライズして IndexedDB / Supabase に保存
- **`powerOrderSaved` は OR マージ**: 一度 `true` になったら `false` に戻さない（他勢力の命令を上書きしないため）
- **条約変更は `PendingTreatyOp` としてバッファリング**し、次の交渉フェーズ開始時に一括適用

## フェーズ遷移

- **春ターン**: `交渉 → 命令 → 解決 → 退却`
- **秋ターン**: `交渉 → 命令 → 解決 → 退却 → 増産/解散`

| 操作 | 交渉 | 命令入力 | 退却 | 増産/解散 |
|-----|------|---------|------|---------|
| 条約：新規作成 | ✅ | ❌ | ❌ | ❌ |
| 条約：批准・却下 | ✅ | ✅ 保留 | ❌ | ❌ |
| 条約：破棄・期限延長 | ✅ | ❌ | ❌ | ❌ |
| 命令確定送信 | ❌ | ✅ | ✅ | ✅ |

## 型の配置ルール

- ドメイン型（`BoardState` / `Unit` / `Order`）→ `domain.ts`
- 条約型（`TreatyRecord`）→ `diplomacy/treaties.ts`
- UI補助型（`UnitOrderInput`）→ `diplomacy/gameHelpers.ts`
- オンライン通信型 → `lib/onlineRoomProtocol.ts` / `lib/onlinePowerPatchTypes.ts`

## デザインシステム

**色**: 有彩色は以下4用途のみ。他のパネル・ボタン・テキストはすべて zinc のみ。

| 用途 | 色 |
|------|----|
| 勢力色 | `POWER_COLORS`（`mapViewConstants.ts`）/ `POWER_META`（`gameHelpers.ts`）を参照、ハードコード禁止 |
| 退却フェーズ UI | amber |
| 補充フェーズ UI | emerald |
| 条約違反・却下 | rose |

**角丸**: `rounded-2xl`（大パネル）→ `rounded-xl`（中パネル・フルwidthボタン）→ `rounded-lg`（input・インラインボタン）→ `rounded`（極小インライン）。`rounded-md` は使わない。

**select / input**: `gameHelpers.ts` の `selectClass` / `selectDisabledClass` を使う。フォーカスリングは `zinc-400/20`。

**タイミング定数**: `mapViewConstants.ts` のみに定義する。他の場所に置かない。

## 既知の制限・未実装

- 支援カット: 基本ロジックと「移動目的地からの攻撃は除外」は実装済み。公式の全例外規定は未カバー
- 観戦モード・ゲーム履歴/リプレイ — 未実装
- ユーザー認証・アカウント — なし（トークンベースのみ）
- モバイル最適化 — 未対応（SVG 負荷大）
