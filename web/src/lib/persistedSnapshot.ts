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
} from '@/domain';
import type { PendingTreatyOp, TreatyRecord, TreatyViolationNotice } from '@/diplomacy/treaties';

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
  treaties: TreatyRecord[];
  treatyViolations: TreatyViolationNotice[];
  /** 交渉フェーズ中にステージングされた条約応答操作。交渉終了時に一括適用する */
  pendingTreatyOps: PendingTreatyOp[];
  /** 現在のゲームフェーズ */
  diplomacyPhase: 'negotiation' | 'orders';
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
    treaties: [],
    treatyViolations: [],
    pendingTreatyOps: [],
    diplomacyPhase: 'negotiation',
  };
}

/**
 * 読み込んだスナップショットの勢力フラグを既知の勢力で補完する。
 *
 * @param loaded - 読み込み済みデータ
 * @returns 正規化後
 */
export function normalizeLoadedSnapshot(loaded: PersistedSnapshot): PersistedSnapshot {
  const emptyFlags = emptyPowerBoolMap(POWERS);
  return {
    ...loaded,
    board: boardWithRefreshedProvinceTint(loaded.board),
    powerOrderSaved: { ...emptyFlags, ...loaded.powerOrderSaved },
    powerAdjustmentSaved: { ...emptyFlags, ...loaded.powerAdjustmentSaved },
    powerRetreatSaved: { ...emptyFlags, ...loaded.powerRetreatSaved },
    treaties: Array.isArray(loaded.treaties) ? loaded.treaties : [],
    treatyViolations: Array.isArray(loaded.treatyViolations)
      ? loaded.treatyViolations
      : [],
    pendingTreatyOps: Array.isArray(loaded.pendingTreatyOps) ? loaded.pendingTreatyOps : [],
    diplomacyPhase: loaded.diplomacyPhase ?? 'orders',
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
