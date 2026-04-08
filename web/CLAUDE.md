# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## プロジェクト概要

ボードゲーム「ディプロマシー」の進行を補助する Web アプリ。7か国のプレイヤーが命令を入力し、ルールエンジンが解決結果をアニメーション付きで表示する。ローカル（IndexedDB）とオンライン（Supabase、最大7勢力同時）の2モードをサポート。

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

## アーキテクチャ

```
[React コンポーネント]
    │  useContext
    ▼
[DiplomacyGameContext]  ←→  [IndexedDB / Supabase]
    │  純粋関数
    ▼
[rulesEngine / mapMovement / gameHelpers / treaties]
    │
    ▼
[domain.ts — コアドメイン型]
```

**基本方針**: ゲームロジックは純粋関数モジュールにのみ書く。コンポーネントは `DiplomacyGameContext` から `useContext` で状態を受け取るだけ。SVG マップのオーバーレイは `mapView/*.ts` が命令的に DOM 操作する（React 管理外）。

### コアロジックファイル

| ファイル | 役割 |
|---------|------|
| `domain.ts` | コア型定義: `BoardState` / `Unit` / `Order` / `AdjudicationResult` |
| `rulesEngine.ts` | `adjudicateTurn(board, orders)` — Move/Hold/Support/Convoy の固定点反復解決 |
| `mapMovement.ts` | 隣接合法性検証、コンボイルート、`fleetArrivalCoasts()` |
| `miniMap.ts` | プロヴィンスマップデータ + 1901 初期盤面 |
| `diplomacy/gameHelpers.ts` | UI補助: `buildDefaultOrders()` / `isPowerOrdersComplete()` / `buildCapacity()` |
| `diplomacy/treaties.ts` | 条約型、`detectTreatyViolations()`、`buildTreatyMapVisuals()` |
| `resolutionRevealOrder.ts` | 解決アニメーションのタイムライン構築 |

### 状態管理・永続化

`DiplomacyGameContext`（約2800行）が唯一の状態ソース。`PersistedSnapshot` を JSON シリアライズして IndexedDB と Supabase に保存・送信する。主要フィールド：

- `board: BoardState` — ユニット・プロヴィンス所有・塗り
- `unitOrders` — 編集中の命令入力（`UnitOrderInput` で部分状態を許容）
- `diplomacyPhase: 'negotiation' | 'orders'`
- `isBuildPhase / isDisbandPhase / isRetreatPhase` — 排他的フェーズフラグ
- `treaties: TreatyRecord[]` / `treatyViolations` / `pendingTreatyOps`
- `powerOrderSaved` — OR マージ（一度 true になったら false に戻さない）

フェーズ遷移:
- **春ターン**: `交渉 → 命令 → 解決 → 退却`
- **秋ターン**: `交渉 → 命令 → 解決 → 退却 → 増産/解散`

### SVG マップオーバーレイ

マップは Illustrator エクスポートの SVG（`public/illustrator-map.svg`）。各 `mapView/*.ts` モジュールが `sync*()` 関数として SVG DOM を直接操作する。`MapView.tsx` は `useEffect` からこれらを呼ぶだけ。

| モジュール | 関数 | 役割 |
|-----------|------|------|
| `mapViewBoardOverlay.ts` | `syncBoardOverlay()` | ユニット配置・塗り更新 |
| `mapViewOrderPreview.ts` | `syncOrderPreview()` | 命令プレビュー矢印（スプライン） |
| `mapViewSupportOverlay.ts` | `syncSupportOverlay()` | 支援カウントバッジ |
| `mapViewTreatyOverlay.ts` | `syncTreatyOverlay()` | 条約フィル・矢印 |

アニメーションのタイミング定数は `mapViewConstants.ts` に集約。他の場所に定義しない。

### オンラインマルチプレイヤー

- **ホスト**: `PUT /api/online/rooms/[roomId]/snapshot` — 全置換（CAS バージョン付き）
- **各勢力**: `PATCH /api/online/rooms/[roomId]/power` — 自分の命令のみ部分更新
- **409 コンフリクト時**: 再取得 → 3-way マージ（local + base + incoming） → リトライ
- 認証: ホストは `hostSecret` ハッシュ、各勢力は `powerSecret` トークン（sessionStorage 保管）

### 分割岸プロヴィンス

STP / SPA / BUL はグラフ上1ノード。艦隊の所在岸は `Unit.fleetCoast: 'NC' | 'SC' | 'EC'` で保持。到着岸の候補は `mapMovement.fleetArrivalCoasts()` で計算する。

### 条約システム

1. `PendingTreatyOp` としてバッファリングし、次の交渉フェーズ開始時に一括適用
2. `detectTreatyViolations()` が `mutualNonAggression` / `sphere` 条項を命令入力と照合 — 命令確定前に呼ぶ
3. マップ反映パイプライン: `buildTreatyMapVisuals()` → `syncTreatyOverlay()`

### 各フェーズの操作可否

| 操作 | 交渉 | 命令入力 | 退却 | 増産/解散 |
|-----|------|---------|------|---------|
| 条約：新規作成 | ✅ | ❌ | ❌ | ❌ |
| 条約：批准・却下 | ✅ | ✅ 保留 | ❌ | ❌ |
| 条約：破棄・期限延長 | ✅ | ❌ | ❌ | ❌ |
| 条約：修正提案 | ✅ | ❌ | ❌ | ❌ |
| 想定行動入力 | ✅ | ✅ | ✅ | ✅ |
| 想定行動：自国を命令欄に反映 | ❌ | ✅ | ❌ | ❌ |
| 新規パターン作成 | ✅ | ✅ | ✅ | ✅ |
| 命令確定送信 | ❌ | ✅ | ✅ | ✅ |

## 型の配置ルール

- ドメイン型（`BoardState` / `Unit` / `Order`）→ `domain.ts`
- 条約型（`TreatyRecord`）→ `diplomacy/treaties.ts`
- UI補助型（`UnitOrderInput`）→ `diplomacy/gameHelpers.ts`
- オンライン通信型 → `lib/onlineRoomProtocol.ts` / `lib/onlinePowerPatchTypes.ts`

## デザインシステム

**色**: 勢力色は `mapViewConstants.ts` の `POWER_COLORS`、`gameHelpers.ts` の `POWER_META` のみを参照。各所にハードコードしない。有彩色の使用は以下4用途のみ：

| 用途 | 色 |
|------|----|
| 勢力を表す色 | `POWER_COLORS` の各国色 |
| 退却フェーズ UI | amber |
| 補充フェーズ UI | emerald |
| 条約違反・却下 | rose |
| 補充/解散の差分（±） | emerald-700 / rose-700 |

それ以外のパネル・バナー・ボタン・テキストはすべて zinc スケールのみで表現する。

**角丸**: `rounded-2xl`（大パネル）→ `rounded-xl`（中パネル・フルwidthボタン）→ `rounded-lg`（input・インラインボタン）→ `rounded`（極小インライン）。`rounded-md` は使わない。

**select / input**: `gameHelpers.ts` の `selectClass` / `selectDisabledClass` を使う。フォーカスリングは `violet-400`（有彩色ルールの唯一の例外）。

## やってはいけないこと

- ゲームロジックを React コンポーネントや API ルートに書かない（純粋関数モジュールのみ）
- SVG 操作を `MapView.tsx` に直接書かず、`mapView/*.ts` に分離する
- 勢力色を各所にハードコードしない（`POWER_COLORS` / `POWER_META` を参照）
- タイミング定数を `mapViewConstants.ts` 以外に定義しない

## 既知の制限・未実装

- 支援カット: 基本ロジックと「移動目的地からの攻撃は除外」は実装済み。公式の全例外規定は未カバー
- 観戦モード・ゲーム履歴/リプレイ — 未実装
- ユーザー認証・アカウント — なし（トークンベースのみ）
- モバイル最適化 — 未対応（SVG 負荷大）
