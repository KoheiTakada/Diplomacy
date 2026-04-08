/**
 * オンライン卓: 勢力単位のスナップショット部分更新（サーバー検証つき）
 *
 * 概要:
 *   PATCH API が受け取った差分をスナップショットにマージする。
 *   自国に属さないユニット ID は拒否する。
 *
 * 主な機能:
 *   - `applyPowerPatchToSnapshot` による検証付きマージ
 *
 * 想定される制限事項:
 *   - 盤面・ログ・裁定結果の変更はホストの PUT のみ（各国は命令入力系のみ）。
 */

import type { PersistedSnapshot } from '@/lib/persistedSnapshot';
import type { OnlinePowerPatchBody } from '@/lib/onlinePowerPatchTypes';

/**
 * 勢力に属するユニット ID の集合を返す。
 *
 * @param snap - 現在スナップショット
 * @param powerId - 勢力 ID
 * @returns ユニット ID 集合
 */
function unitIdsOwnedByPower(
  snap: PersistedSnapshot,
  powerId: string,
): Set<string> {
  const s = new Set<string>();
  for (const u of snap.board.units) {
    if (u.powerId === powerId) {
      s.add(u.id);
    }
  }
  return s;
}

/**
 * 退却対象のユニット ID（自国）を返す。
 *
 * @param snap - スナップショット
 * @param powerId - 勢力 ID
 */
function retreatUnitIdsForPower(
  snap: PersistedSnapshot,
  powerId: string,
): Set<string> {
  const s = new Set<string>();
  for (const d of snap.pendingRetreats) {
    if (d.unit.powerId === powerId) {
      s.add(d.unit.id);
    }
  }
  return s;
}

/**
 * 検証付きで勢力パッチをスナップショットに適用する。
 *
 * @param snap - 基準スナップショット（コピーして返す）
 * @param patch - クライアント差分
 * @returns マージ後の新スナップショット
 * @throws 検証エラー時は Error（message を API で返す）
 */
export function applyPowerPatchToSnapshot(
  snap: PersistedSnapshot,
  patch: Omit<OnlinePowerPatchBody, 'powerSecret' | 'expectedVersion'>,
): PersistedSnapshot {
  const owned = unitIdsOwnedByPower(snap, patch.powerId);
  const retreatOwned = retreatUnitIdsForPower(snap, patch.powerId);
  const next: PersistedSnapshot = {
    ...snap,
    unitOrders: { ...snap.unitOrders },
    powerOrderSaved: { ...snap.powerOrderSaved },
    powerAdjustmentSaved: { ...snap.powerAdjustmentSaved },
    powerRetreatSaved: { ...snap.powerRetreatSaved },
    buildPlan: { ...snap.buildPlan },
    disbandPlan: { ...snap.disbandPlan },
    retreatTargets: { ...snap.retreatTargets },
    treaties: snap.treaties.slice(),
    treatyViolations: snap.treatyViolations.slice(),
    pendingTreatyOps: snap.pendingTreatyOps.slice(),
  };

  if (patch.unitOrders != null) {
    for (const unitId of Object.keys(patch.unitOrders)) {
      if (!owned.has(unitId)) {
        throw new Error(`unitOrders に他国ユニットが含まれています: ${unitId}`);
      }
      const cur = next.unitOrders[unitId];
      const delta = patch.unitOrders[unitId];
      next.unitOrders[unitId] = { ...cur, ...delta };
    }
  }

  if (patch.powerOrderSaved !== undefined) {
    next.powerOrderSaved[patch.powerId] = patch.powerOrderSaved;
  }
  if (patch.powerAdjustmentSaved !== undefined) {
    next.powerAdjustmentSaved[patch.powerId] = patch.powerAdjustmentSaved;
  }
  if (patch.powerRetreatSaved !== undefined) {
    next.powerRetreatSaved[patch.powerId] = patch.powerRetreatSaved;
  }

  if (patch.buildPlan !== undefined) {
    next.buildPlan[patch.powerId] = patch.buildPlan;
  }
  if (patch.disbandPlan !== undefined) {
    next.disbandPlan[patch.powerId] = patch.disbandPlan;
  }

  if (patch.retreatTargets != null) {
    for (const unitId of Object.keys(patch.retreatTargets)) {
      if (!retreatOwned.has(unitId)) {
        throw new Error(
          `retreatTargets に自国の退却ユニット以外が含まれています: ${unitId}`,
        );
      }
    }
    for (const unitId of Object.keys(patch.retreatTargets)) {
      next.retreatTargets[unitId] = patch.retreatTargets[unitId];
    }
  }

  if (patch.treaties != null) {
    next.treaties = patch.treaties;
  }
  if (patch.treatyViolations != null) {
    next.treatyViolations = patch.treatyViolations;
  }

  if (patch.pendingTreatyOps != null) {
    // Merge: keep other powers' ops, replace this power's ops (last-wins per treatyId+powerId)
    const otherOps = next.pendingTreatyOps.filter(
      (op) => op.powerId !== patch.powerId,
    );
    const incomingOps = patch.pendingTreatyOps.filter(
      (op) => op.powerId === patch.powerId,
    );
    // Last-wins within incoming for same treatyId
    const deduped = new Map<string, typeof incomingOps[number]>();
    for (const op of incomingOps) {
      deduped.set(op.treatyId, op);
    }
    next.pendingTreatyOps = [...otherOps, ...Array.from(deduped.values())];
  }

  return next;
}
