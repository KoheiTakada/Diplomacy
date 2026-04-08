# ディプロマシー支援ツール — デザインガイド

## 1. デザイン方針

**地図が主役。UI は地図を邪魔しない。**

- 画面左大半を地図が占め、右パネルは命令入力・状態確認のサポート役に徹する。
- **色は意味のある場所にしか使わない。** パネルやバナー自体の色は白/グレースケールに統一し、有彩色は下記4用途のみに限定する。
- アニメーションは地図上の演出を主軸とし、UI パネルは原則静的。

---

## 2. 色の使用ルール

### 許可される有彩色（4用途のみ）

| 用途 | 色 | 具体例 |
|---|---|---|
| **勢力を表す色** | 各国の代表色（後述） | ユニットバッジ、勢力ドット、勢力カード左線 |
| **フェーズを表す色** | amber（退却）/ emerald（増産） | フェーズパネルの背景・ボーダー・ボタン |
| **条約違反の通知** | rose | 違反メッセージ背景、却下ボタン |
| **増産・削減の差分表示** | emerald-700（＋）/ rose-700（－） | 勢力カード内の差分テキスト |

**それ以外のパネル・バナー・ボタン・テキストはすべて白/グレースケール（zinc 系）で表現する。**

### 禁止事項

- violet・sky・amber（フェーズ以外）・emerald（フェーズ以外）を UI のパネル色・ボタン色・テキスト色に使わない。
- フォーカスリングは例外として `violet-400/25` を継続使用する（ブラウザ UX に準拠した慣習であり、視覚的に目立たない）。

---

## 3. 勢力色

**唯一の参照元: `mapViewConstants.ts` → `POWER_COLORS` / `gameHelpers.ts` → `POWER_META`**  
各所にハードコードしない。`style={{ backgroundColor: meta.color }}` の形でのみ使う。

| 勢力 | 国名 | HEX |
|---|---|---|
| ENG | イギリス | `#ef4444` |
| FRA | フランス | `#3b82f6` |
| GER | ドイツ | `#0d9488` |
| ITA | イタリア | `#22c55e` |
| AUS | オーストリア・ハンガリー | `#eab308` |
| RUS | ロシア | `#a855f7` |
| TUR | トルコ | `#f97316` |

---

## 4. フェーズカラー

ゲームのフェーズごとにパネル全体の色調を変えることで、今どのフェーズかを一目で区別させる。

| フェーズ | ボーダー | 背景 | 見出し | ボタン |
|---|---|---|---|---|
| 命令フェーズ（通常） | `zinc-200/70` | `white` | `zinc-900` | `bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-300` |
| 退却フェーズ | `amber-300/80` | `amber-50/50` | `amber-950` | `bg-amber-600 hover:bg-amber-500 disabled:bg-amber-300` |
| 増産フェーズ | `emerald-300/80` | `emerald-50/50` | `emerald-950` | `bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-300` |

---

## 5. UI ニュートラル（ベース）

**Tailwind zinc 系**に統一。

| トークン | 用途 |
|---|---|
| `white` | カード背景、input 背景 |
| `zinc-50` / `zinc-50/30` | サブカード・セクションの背景 |
| `zinc-100` | disabled input 背景 |
| `zinc-200` | ボーダー（多くは `/60` `/70` `/80` で透過） |
| `zinc-400` | disabled ボタン背景 |
| `zinc-500` | ラベル・説明文・補助リンク |
| `zinc-600` | セクション区切り見出し（小） |
| `zinc-700` | セカンダリテキスト |
| `zinc-800` | 本文テキスト |
| `zinc-900` | 見出し・強調テキスト、プライマリボタン背景 |

---

## 6. タイポグラフィ

フォントは `font-sans`（Geist）。数値には `tabular-nums` を使う。シークレット・ID は `font-mono`。

| 用途 | クラス |
|---|---|
| ページタイトル | `text-3xl font-bold tracking-tight` |
| パネル見出し | `text-lg font-semibold tracking-tight` |
| サブ見出し | `text-sm font-semibold` |
| セクション区切り（大文字） | `text-xs font-semibold uppercase tracking-widest text-zinc-600` |
| 本文・リスト | `text-sm` / `text-xs` |
| 補助テキスト | `text-[11px]` |
| 極小ラベル | `text-[10px]`（`text-[9px]` は使わない） |
| 数値 | `font-bold tabular-nums` |

---

## 7. 角丸（Border Radius）

| 値 | 用途 |
|---|---|
| `rounded-2xl` | 大パネル（地図コンテナ、勢力一覧セクション、ログセクション） |
| `rounded-xl` | 中パネル（命令パネル、条約パネル等）/ フルwidth ボタン |
| `rounded-lg` | 小要素（インラインボタン、input、select） |
| `rounded` | 極小インライン要素（条約内の小ボタン等）|
| `rounded-full` | 勢力ドット、ユニットバッジ |

`rounded-md` は使わない。

---

## 8. コンポーネント規約

### 勢力ドット

```tsx
<span
  className="inline-block h-2 w-2 shrink-0 rounded-full ring-2 ring-white"
  style={{ backgroundColor: meta.color }}
/>
```

大きいコンテキスト（パネル見出し等）は `h-3 w-3`。

### 勢力カード左線

```tsx
style={{ boxShadow: `inset 3px 0 0 0 ${meta.color}` }}
className="rounded-xl border border-zinc-200/60 bg-zinc-50/80 px-2.5 py-2"
```

### ボタン

**フルwidth プライマリ（命令実行・フォーム送信）**:
```
w-full rounded-xl {bg} px-4 py-2.5 text-sm font-semibold text-white
shadow-md shadow-zinc-900/20 transition-colors
hover:{bg-hover} disabled:cursor-not-allowed disabled:{bg-disabled} disabled:shadow-none
```

通常フェーズ / 条約送信 / タイトル画面: `bg-zinc-900 hover:bg-zinc-800 disabled:bg-zinc-400`  
退却フェーズ: `bg-amber-600 hover:bg-amber-500 disabled:bg-amber-300`  
増産フェーズ: `bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-300`

**インライン セカンダリ（「命令入力へ」等）**:
```
rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-zinc-800
```

**インライン アウトライン（キャンセル等）**:
```
rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50
```

**小アクションボタン（条約カード内）**:
```
rounded px-2 py-1 text-[10px] font-semibold text-white
```
批准: `bg-emerald-600 hover:bg-emerald-500`  
却下 / 延長却下: `bg-rose-600 hover:bg-rose-500`  
修正 / 延長 / 破棄 / 提案送信: `bg-zinc-600 hover:bg-zinc-500` / `bg-zinc-900`

**タブボタン（想定行動パネル等）**:
```ts
const tabBtnBase = 'shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors';
const tabBtnActive = 'bg-zinc-900 text-white shadow-sm';
const tabBtnIdle = 'bg-white/80 text-zinc-700 ring-1 ring-zinc-200 hover:bg-zinc-100';
```

**テキストリンクボタン**:
```
text-[11px] font-medium text-zinc-500 underline-offset-2 hover:text-zinc-800 hover:underline
```

### セレクト・インプット

`gameHelpers.ts` の `selectClass` / `selectDisabledClass` を使う（フォーカスカラーは `violet-400`）。  
条約パネル内の select も同様に統一済み。

テキスト input の標準:
```
rounded-lg border border-zinc-200 bg-white px-2 py-2 text-sm text-zinc-900
focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-400/25
```

### 条約ステータスバッジ

| 状態 | クラス |
|---|---|
| 有効 | `bg-emerald-100 text-emerald-800`（意味あり） |
| 失効 | `bg-zinc-100 text-zinc-500` |
| 批准待ち | `bg-zinc-100 text-zinc-600` |

### インフォバナー

接続状態・警告等のバナーはすべて zinc スケールに統一。

```tsx
// 通常情報（オンライン接続など）
className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-[11px] text-zinc-700"

// 警告（退却フェーズ案内など—フェーズバナーの一部として）
className="rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs text-amber-900"
```

### 空状態（Empty State）

```tsx
className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50/80
           px-2 py-2 text-center text-[11px] text-zinc-500"
```

---

## 9. マップビジュアル言語

すべて `mapViewConstants.ts` の定数を参照する。

### ユニットバッジ

| 定数 | 値 |
|---|---|
| `UNIT_ICON_PX` | 20（アイコン幅・高さ） |
| `UNIT_BADGE_RADIUS` | 10（背景円の半径） |
| `UNIT_BADGE_STROKE` | `#d4d4d8`（枠線色） |
| `OCCUPATION_FILL_OPACITY` | `'0.78'`（占領塗り） |

### 支援線

白下地（5.2px）+ 勢力色ストローク（4.4px）の2重ストロークで「白縁付き色線」を表現する。

### 条約オーバーレイ

| 条項 | 表現 | 色 | 不透明度 |
|---|---|---|---|
| `mutualNonAggression` | プロヴィンス塗り | `#9ca3af` | 0.28 |
| `sphere` | プロヴィンス塗り | 勢力色 | 0.20 |
| 戦術系 | 矢印 | `#9ca3af` | 0.80 |

---

## 10. アニメーション定数

UI 側で独自にタイミングを設けない。`mapViewConstants.ts` から参照する。

| 定数 | 値 | 用途 |
|---|---|---|
| `UNIT_MOVE_ANIM_MS` | 520 ms | 通常移動 |
| `STANDOFF_BUMP_MS` | 720 ms | スタンドオフ |
| `CONVOY_PATH_MS` | 900 ms | コンボイ経路 |
| `SUPPORT_LINE_GROW_MS` | 480 ms | 支援線が伸びる |
| `BADGE_SCALE_ANIM_MS` | 420 ms | 支援バッジのスケール変化 |
