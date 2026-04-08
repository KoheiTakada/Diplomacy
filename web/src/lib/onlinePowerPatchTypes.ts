/**
 * オンライン卓 PATCH API 用の JSON 型（クライアント・サーバー共通）
 *
 * 概要:
 *   Route Handler と勢力ページの同期で同一形を使う。
 *
 * 主な機能:
 *   - `OnlinePowerPatchBody` 型定義
 *
 * 想定される制限事項:
 *   - フィールド追加時は API と `applyPowerPatchToSnapshot` を同期すること。
 */

import type { BuildSlot, DisbandSlot, UnitOrderInput } from '@/diplomacy/gameHelpers';
import type { PendingTreatyOp, TreatyRecord, TreatyViolationNotice } from '@/diplomacy/treaties';

/** PATCH /api/online/rooms/[id]/power の JSON ボディ */
export type OnlinePowerPatchBody = {
  powerId: string;
  powerSecret: string;
  expectedVersion: number;
  unitOrders?: Record<string, UnitOrderInput>;
  powerOrderSaved?: boolean;
  powerAdjustmentSaved?: boolean;
  powerRetreatSaved?: boolean;
  buildPlan?: BuildSlot[];
  disbandPlan?: DisbandSlot[];
  retreatTargets?: Record<string, string>;
  treaties?: TreatyRecord[];
  treatyViolations?: TreatyViolationNotice[];
  pendingTreatyOps?: PendingTreatyOp[];
};
