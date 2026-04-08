# ディプロマシー支援ツール — 設計ドキュメント

## 1. アーキテクチャ概要

```
[UI Components]
    │  useContext
    ▼
[DiplomacyGameContext]  ←→  [IndexedDB / Supabase API]
    │  pure functions
    ▼
[rulesEngine / mapMovement / gameHelpers / treaties]
    │
    ▼
[domain.ts — コアドメイン型]
```

- **UI と状態の分離**: すべてのゲーム状態は `DiplomacyGameContext` に集約。コンポーネントは派生値を `useContext` で受け取るのみ。
- **純粋関数ロジック**: `rulesEngine`, `mapMovement`, `gameHelpers`, `treaties` はすべて副作用なしの純粋関数。テスト可能。
- **SVG 描画の分離**: マップオーバーレイは `mapView/*.ts` の `sync*` 関数群が DOM を直接操作。`MapView.tsx` はそれを呼び出すだけ。

---

## 2. コアドメインモデル（`domain.ts`）

### 主要型

| 型 | 役割 |
|---|---|
| `BoardState` | 1ターン分の盤面スナップショット（ユニット・所有・隣接・塗り） |
| `Unit` | ユニット（種別・所属・位置・艦隊岸） |
| `Order` | Hold / Move / Support / Convoy の4種 |
| `OrderResolution` | 命令1件の解決結果（成功/失敗＋メッセージ） |
| `AdjudicationResult` | ターン解決全体（次盤面＋解決結果一覧＋退却ユニット一覧） |
| `DislodgedUnit` | 押し出されたユニット（退却フェーズ用） |

### 分割岸プロヴィンス

STP（サンクトペテルブルク）・SPA（スペイン）・BUL（ブルガリア）はグラフ上1ノードとして扱い、艦隊の所在岸だけ `Unit.fleetCoast: 'NC' | 'SC' | 'EC'` に格納する。  
到着岸の決定は `mapMovement.fleetArrivalCoasts()` が計算し、曖昧な場合は UI でユーザーに選択させる。

### 塗り（provinceControlTint）

`BoardState.provinceControlTint` は「最後にそのプロヴィンスを支配した勢力」を保持する表示専用フィールド。ルール判定には使用しない。ユニット移動後もその勢力色が残り、別勢力が上書きするまで表示が持続する。`nextProvinceControlTint()` で更新する。

---

## 3. ルールエンジン（`rulesEngine.ts`）

### adjudicateTurn(board, orders) → AdjudicationResult

1. **合法性チェック**: 移動が隣接グラフ上で有効か確認。不正命令は Hold に降格。
2. **固定点反復**: 解決結果が安定するまで繰り返す。
   - 移動力 > 守備力 なら移動成功。
   - 複数ユニットが同一マスへ → スタンドオフ（誰も入れない）。
   - 支援カット: 支援者が攻撃された場合、支援は無効。
   - 頭突き合わせ（head-to-head）: 相手の支援なしに相互 Move → 両者失敗。
3. **コンボイ**: 海路チェーン（艦隊全員が Hold）が成立する場合のみ陸軍を海上輸送。コンボイ艦隊が押し出されると輸送失敗。
4. **退却計算**: 押し出されたユニットに移動可能な退却先を計算（攻撃元・被占領地は除外）。
5. **サプライセンター更新**: 秋ターン解決後に所有者を更新。

### 既知の制限

- 支援カット例外（防衛者が攻撃元を攻撃している場合の支援カット免除）は未実装。
- 退却ルールは簡易モデル（細かい例外規定なし）。

---

## 4. 移動・隣接（`mapMovement.ts`）

| 関数 | 役割 |
|---|---|
| `buildAdjacencyKeySet()` | 双方向隣接セット構築 |
| `isDirectMoveValid()` | 移動合法性（ユニット種別・エリア種別・岸ルール） |
| `getDirectMoveTargets()` | UI用移動先候補リスト |
| `fleetArrivalCoasts()` | 艦隊の到着岸候補 |
| `findConvoyPathProvinceIdsForMove()` | 単一コンボイルート検索 |
| `findAllConvoyPathProvinceIdsForMove()` | 全コンボイルート列挙 |
| `getReachableProvinceIds()` | 移動先ハイライト用 |
| `getSupportableProvinces()` | 支援対象リスト |
| `getRetreatableProvinces()` | 退却先リスト |

---

## 5. 状態管理（DiplomacyGameContext）

### PersistedSnapshot スキーマ

```typescript
{
  v: 1,
  worldlineStem?: string,    // セーブスロット識別子
  savedAt?: string,          // ISO 8601
  board: BoardState,
  unitOrders: Record<unitId, UnitOrderInput>,
  log: ResolveLogEntry[],
  nextLogId: number,
  isBuildPhase: boolean,
  isDisbandPhase: boolean,
  isRetreatPhase: boolean,
  retreatTargets: Record<unitId, provinceId>,
  pendingRetreats: DislodgedUnit[],
  buildPlan: Record<powerId, SlotArray>,
  disbandPlan: Record<powerId, SlotArray>,
  powerOrderSaved: Record<powerId, boolean>,
  powerAdjustmentSaved: Record<powerId, boolean>,
  powerRetreatSaved: Record<powerId, boolean>,
  treaties: TreatyRecord[],
  treatyViolations: TreatyViolationNotice[],
  diplomacyPhase: 'negotiation' | 'orders',
  pendingTreatyOps: PendingTreatyOp[],
}
```

### フェーズ遷移

```
交渉フェーズ (diplomacyPhase='negotiation')
    → 命令フェーズ (diplomacyPhase='orders')
        → [全勢力が命令確定] → adjudicateTurn → 解決アニメーション
            → [退却あり] 退却フェーズ
            → [秋ターン] 補充/解散フェーズ
                → 次ターンの交渉フェーズへ
```

### ゲームヘルパー関数（gameHelpers.ts）

| 関数 | 役割 |
|---|---|
| `UnitOrderInput` | 編集中の命令入力型（部分的な状態を許容） |
| `buildDefaultOrders()` | 全ユニットに Hold 命令を設定 |
| `isPowerOrdersComplete()` | 全ユニットに命令が揃っているか |
| `supportCountBySupportedUnitIdFromOrders()` | 支援数カウント（UI バッジ用） |
| `buildCapacity()` / `disbandNeed()` | 補充/解散数計算 |
| `appendMapEffectsForRevealResolution()` | 解決アニメーション用エフェクトキュー構築 |

---

## 6. オンラインマルチプレイヤー

### API エンドポイント

| エンドポイント | メソッド | 用途 |
|---|---|---|
| `/api/online/rooms` | POST | 部屋作成（ホストシークレット・勢力トークン生成） |
| `/api/online/rooms/[roomId]/snapshot` | GET | スナップショット取得（全員がポーリング） |
| `/api/online/rooms/[roomId]/snapshot` | PUT | 全置換（ホスト専用、CAS バージョン付き） |
| `/api/online/rooms/[roomId]/power` | PATCH | 命令/調整の部分更新（各勢力プレイヤー） |

### 競合解決（3-way マージ）

```
base (前回取得) + local (ローカル変更) + incoming (409後に再取得) → merged
```

- **命令フィールド**: ローカルの変更がベースから変わっていれば優先、そうでなければ incoming を採用。
- **条約フィールド**: ID ベースでマージ。最終状態（ratified / discarded）を優先。
- **powerOrderSaved フラグ**: OR マージ（一度 true になったら false に戻さない）。

### セキュリティ

- ホスト: `hostSecret` ハッシュで認証。
- 各勢力: `powerSecret` トークンで認証。
- 認証は API ルートで確認のみ。Supabase RLS は設定しない（シークレットは DB に平文保存しない——ハッシュのみ）。

---

## 7. 条約システム（`diplomacy/treaties.ts`）

### 条約の種別（clauses）

| カテゴリ | 条項 | 概要 |
|---|---|---|
| simple | `mutualNonAggression` | 相互不可侵 |
| simple | `mutualStandoff` | 相互スタンドオフ |
| simple | `alliance` | 同盟合意 |
| simple | `surrender` | 降伏 |
| priced | `sphere` | 勢力圏合意（primaryPowerId の支配権を認める） |
| priced | `routeSecure` | 進路確保 |
| priced | `moveSupport` | 移動支援 |
| priced | `convoySupport` | 輸送支援 |
| priced | `holdSupport` | 維持支援 |
| priced | `exchangeRetreat` | 交換/撤退 |
| information | `intelShare` | 情報提供 |
| information | `disinformation` | 偽装工作 |

### ライフサイクル

```
提案 (statusByPower: all 'pending')
    → 全員が ratify → isTreatyRatified() = true → 有効
    → 誰かが reject → 無効
    → discardedAtIso が付く → 廃棄
    → expiry を過ぎる → isTreatyActive() = false
```

### 地図オーバーレイ

- `buildTreatyMapVisuals()` → `TreatyMapVisuals`（fills + arrows リスト）
- `syncTreatyOverlay()` → SVG に反映（`mapViewTreatyOverlay.ts`）
- 色: `mutualNonAggression` は灰色フィル、`sphere` は勢力色フィル、戦術条項は灰色矢印。

### 違反検知

`detectTreatyViolations()` は `mutualNonAggression` と `sphere` のみを対象に、命令入力から対象プロヴィンスへの Move を検知して `TreatyViolationNotice` を返す。命令確定前に呼ぶ。

---

## 8. マップ描画（MapView / mapView/\*）

### SVG 構造

- Illustrator からエクスポートした SVG を public/ に配置。
- 各プロヴィンスは ID が対応したパス要素を持つ。
- `mapViewConstants.ts` にプロヴィンスアンカー座標・勢力カラー等を定義。

### オーバーレイ関数

| モジュール | 関数 | 役割 |
|---|---|---|
| `mapViewBoardOverlay.ts` | `syncBoardOverlay()` | ユニット配置・塗り更新 |
| `mapViewOrderPreview.ts` | `syncOrderPreview()` | 命令プレビュー矢印（スプライン） |
| `mapViewSupportOverlay.ts` | `syncSupportOverlay()` | 支援カウントバッジ |
| `mapViewTreatyOverlay.ts` | `syncTreatyOverlay()` | 条約フィル・矢印 |

これらは `MapView.tsx` の `useEffect` から呼ばれ、状態変化のたびに SVG を再描画する。

### コンボイビジュアル

コンボイルートの矢印は連続スプラインセグメントとして描画。未解決リンクはグレー表示。

---

## 9. UI フロー

### ホスト視点（MainDiplomacyHome）

1. タイトル画面 → 新規ゲーム or インポート or オンライン参加
2. メイン画面: マップ + 全勢力の命令確定状態 + 解決ボタン
3. 解決ボタン押下 → アニメーション再生 → 次フェーズへ

### 勢力プレイヤー視点（PowerSecretWorkbench）

1. `/power/[powerId]` にアクセス（勢力トークン付き URL で認証）
2. 命令入力 → 条約操作 → 命令確定
3. ホストが解決するまで待機（ポーリングで自動更新）

### 条約フロー（PowerTreatyPanel）

1. 条約カテゴリ選択（simple / priced / information）
2. 条項テンプレート選択（priced は2項目選択）
3. スロット入力（勢力・プロヴィンス・ユニット・自由テキスト）
4. 期限・閲覧可能勢力設定
5. 提案 → 相手勢力が批准/却下 → 有効化

---

## 10. 未実装・既知の制限

| 項目 | 状態 |
|---|---|
| 支援カット例外（防衛者が攻撃元を攻撃中の免除） | 未実装 |
| 退却フェーズの細かい例外規定 | 未実装（簡易モデル） |
| ユーザー認証・アカウント | なし（トークンベースのみ） |
| 観戦モード / スペクテイター | 未実装 |
| ゲーム履歴・リプレイ | 未実装 |
| モバイル最適化 | 未対応（SVG重いため） |
