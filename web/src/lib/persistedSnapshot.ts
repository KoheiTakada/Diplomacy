/**
 * IndexedDB / オンライン卓で共有するゲームスナップショット型と生成ヘルパ
 *
 * 概要:
 *   DiplomacyGameContext と API Route の両方から参照する v:1 スナップショット定義。
 *
 * 主な機能:
 *   - デフォルト初期盤面の生成
 *   - 読み込み後の勢力フラグ正規化
 *   - 保存用 JSON 文字列化（savedAt 付与）
 *
 * 想定される制限事項:
 *   - スキーマ変更時は API とクライアントを同時に更新すること。
 */

import { MINI_MAP_INITIAL_STATE, POWERS } from '@/miniMap';
import {
  buildDefaultOrders,
  emptyPowerBoolMap,
  type BuildSlot,
  type DisbandSlot,
  type ResolveLogEntry,
  type UnitOrderInput,
} from '@/diplomacy/gameHelpers';
import {
  boardWithRefreshedProvinceTint,
  type BoardState,
  type DislodgedUnit,
  type Unit,
} from '@/domain';

/**
 * 同一 id のユニットが複数あると地図上で二重描画・移動アニメが重なる。
 * オンライン卓でマージ不整合が起きた場合の保険として後勝ちで1件にまとめる。
 *
 * @param board - 入力盤面
 * @returns 重複除去後の盤面
 */
function dedupeBoardUnitsById(board: BoardState): BoardState {
  const byId = new Map<string, Unit>();
  for (const u of board.units) {
    byId.set(u.id, u);
  }
  return {
    ...board,
    units: Array.from(byId.values()),
  };
}

/**
 * 盤面に存在しないユニット id の命令を除去する（重複除去後の整合用）。
 *
 * @param unitOrders - 入力命令マップ
 * @param board - 参照盤面
 */
function pruneOrphanUnitOrders(
  unitOrders: Record<string, UnitOrderInput>,
  board: BoardState,
): Record<string, UnitOrderInput> {
  const ids = new Set(board.units.map((u) => u.id));
  const out: Record<string, UnitOrderInput> = { ...unitOrders };
  for (const k of Object.keys(out)) {
    if (!ids.has(k)) {
      delete out[k];
    }
  }
  return out;
}

/** v:1 永続化スナップショット */
export type PersistedSnapshot = {
  v: 1;
  /** 世界線 ID（ローカル保存キー。オンライン時も互換のため任意で保持） */
  worldlineStem?: string;
  /** 最終保存時刻（ISO 8601） */
  savedAt?: string;
  board: BoardState;
  unitOrders: Record<string, UnitOrderInput>;
  log: ResolveLogEntry[];
  nextLogId: number;
  isBuildPhase: boolean;
  isDisbandPhase: boolean;
  isRetreatPhase: boolean;
  retreatTargets: Record<string, string>;
  pendingRetreats: DislodgedUnit[];
  buildPlan: Record<string, BuildSlot[]>;
  disbandPlan: Record<string, DisbandSlot[]>;
  powerOrderSaved: Record<string, boolean>;
  powerAdjustmentSaved: Record<string, boolean>;
  powerRetreatSaved: Record<string, boolean>;
};

/**
 * 新規ゲーム用のデフォルトスナップショットを返す。
 *
 * @returns v:1 スナップショット
 */
export function createDefaultPersistedSnapshot(): PersistedSnapshot {
  const emptyFlags = emptyPowerBoolMap(POWERS);
  return {
    v: 1,
    board: MINI_MAP_INITIAL_STATE,
    unitOrders: buildDefaultOrders(MINI_MAP_INITIAL_STATE),
    log: [],
    nextLogId: 1,
    isBuildPhase: false,
    isDisbandPhase: false,
    isRetreatPhase: false,
    retreatTargets: {},
    pendingRetreats: [],
    buildPlan: {},
    disbandPlan: {},
    powerOrderSaved: { ...emptyFlags },
    powerAdjustmentSaved: { ...emptyFlags },
    powerRetreatSaved: { ...emptyFlags },
  };
}

/**
 * 読み込んだスナップショットを正規化する。
 * 勢力フラグの補完に加え、ユニット id 重複の除去と孤児命令の削除を行う。
 *
 * @param loaded - 読み込み済みデータ
 * @returns 正規化後
 */
export function normalizeLoadedSnapshot(loaded: PersistedSnapshot): PersistedSnapshot {
  const emptyFlags = emptyPowerBoolMap(POWERS);
  const board = boardWithRefreshedProvinceTint(
    dedupeBoardUnitsById(loaded.board),
  );
  return {
    ...loaded,
    board,
    unitOrders: pruneOrphanUnitOrders(loaded.unitOrders, board),
    powerOrderSaved: { ...emptyFlags, ...loaded.powerOrderSaved },
    powerAdjustmentSaved: { ...emptyFlags, ...loaded.powerAdjustmentSaved },
    powerRetreatSaved: { ...emptyFlags, ...loaded.powerRetreatSaved },
  };
}

/**
 * 保存用に savedAt を付与して JSON 化する。
 *
 * @param snap - スナップショット
 * @returns JSON テキスト
 */
export function serializeSnapshotForStorage(snap: PersistedSnapshot): string {
  return JSON.stringify({ ...snap, savedAt: new Date().toISOString() });
}

/**
 * JSON 文字列を v:1 スナップショットとして検証する。
 *
 * @param jsonText - JSON テキスト
 * @returns 妥当ならパース済み、否则 null
 */
export function tryParsePersistedSnapshotJson(
  jsonText: string,
): PersistedSnapshot | null {
  try {
    const p = JSON.parse(jsonText) as PersistedSnapshot;
    if (p.v !== 1 || p.board == null) {
      return null;
    }
    return p;
  } catch {
    return null;
  }
}
