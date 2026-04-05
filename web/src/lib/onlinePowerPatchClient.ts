/**
 * オンライン同期: 勢力ページから PATCH するボディの組み立て
 *
 * 概要:
 *   現在の `PersistedSnapshot` から自国分のフィールドだけを取り出す。
 *
 * 主な機能:
 *   - `buildPowerOnlinePatchPayload`
 *
 * 想定される制限事項:
 *   - サーバー側でも再検証するため、クライアントの取りこぼしは致命的にならない。
 */

import type { PersistedSnapshot } from '@/lib/persistedSnapshot';
import type { OnlinePowerPatchBody } from '@/lib/onlinePowerPatchTypes';

/**
 * 自国の退却対象ユニットに関する retreatTargets のみを返す。
 *
 * @param snap - スナップショット
 * @param powerId - 勢力 ID
 */
function retreatTargetsForPower(
  snap: PersistedSnapshot,
  powerId: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of snap.pendingRetreats) {
    if (d.unit.powerId !== powerId) {
      continue;
    }
    const t = snap.retreatTargets[d.unit.id];
    if (t != null && t.length > 0) {
      out[d.unit.id] = t;
    }
  }
  return out;
}

/**
 * PATCH 用ペイロード（expectedVersion / powerSecret は呼び出し側で付与）。
 *
 * @param powerId - 勢力 ID
 * @param snap - 現在のスナップショット
 * @returns ボディの一部
 */
export function buildPowerOnlinePatchPayload(
  powerId: string,
  snap: PersistedSnapshot,
): Omit<OnlinePowerPatchBody, 'powerSecret' | 'expectedVersion'> {
  const unitOrders: PersistedSnapshot['unitOrders'] = {};
  for (const u of snap.board.units) {
    if (u.powerId === powerId) {
      const o = snap.unitOrders[u.id];
      if (o != null) {
        unitOrders[u.id] = o;
      }
    }
  }

  return {
    powerId,
    unitOrders,
    powerOrderSaved: snap.powerOrderSaved[powerId] === true,
    powerAdjustmentSaved: snap.powerAdjustmentSaved[powerId] === true,
    powerRetreatSaved: snap.powerRetreatSaved[powerId] === true,
    buildPlan: snap.buildPlan[powerId] ?? [],
    disbandPlan: snap.disbandPlan[powerId] ?? [],
    retreatTargets: retreatTargetsForPower(snap, powerId),
  };
}
