/**
 * 解決フェーズの段階的表示（ログと盤面の同期）用ヘルパー。
 *
 * 概要:
 *   命令解決結果を1行ずつ表示するとき、地図上のユニット配置を同じ順で追従させる。
 *
 * 主な機能:
 *   - 1件の OrderResolution を適用したときのユニット配列を返す
 *   - 移動成功時は最終盤面のユニット状態を反映し、押し出し対象は同タイミングで除去
 *
 * 制限:
 *   - サプライセンター所有の更新は行わない（呼び出し側が最終盤面で一括反映する）
 *   - Support 命令の解決行は盤面を変えない（cloneAll のまま通過）
 */

import {
  type AdjudicationResult,
  type BoardState,
  type OrderResolution,
  OrderType,
  type Unit,
} from '@/domain';

/** 解決ログ1行と地図更新の間隔（ミリ秒） */
export const RESOLUTION_REVEAL_MS = 1000;

/** 押し出しを表すホールド結果メッセージ（rulesEngine と一致させる） */
const DISLODGED_HOLD_MESSAGE = '押し出され退却が必要';

/**
 * 段階表示用に、1件の解決結果に応じてユニット一覧を更新する。
 *
 * @param workingUnits - 直前までの表示上のユニット一覧
 * @param resolution - 今回発表する解決1件
 * @param result - 解決全体（押し出し情報の参照用）
 * @param finalBoard - 解決完了後の盤面（成功移動後の艦隊岸など最終形）
 * @returns 更新後のユニット一覧
 */
export function applyResolutionRevealStep(
  workingUnits: Unit[],
  resolution: OrderResolution,
  result: AdjudicationResult,
  finalBoard: BoardState,
): Unit[] {
  const { order } = resolution;
  const finalById = new Map(finalBoard.units.map((u) => [u.id, u]));

  const cloneAll = (arr: Unit[]): Unit[] => arr.map((u) => ({ ...u }));

  if (order.type === OrderType.Move && resolution.success) {
    const displacedIds = new Set(
      result.dislodgedUnits
        .filter((d) => d.displacedByUnitId === order.unitId)
        .map((d) => d.unit.id),
    );
    return workingUnits
      .filter((u) => !displacedIds.has(u.id))
      .map((u) => {
        if (u.id !== order.unitId) {
          return { ...u };
        }
        const finalU = finalById.get(order.unitId);
        return finalU != null ? { ...finalU } : { ...u };
      });
  }

  if (order.type === OrderType.Move && !resolution.success) {
    return cloneAll(workingUnits);
  }

  if (order.type === OrderType.Support) {
    return cloneAll(workingUnits);
  }

  if (
    order.type === OrderType.Hold &&
    resolution.message.includes(DISLODGED_HOLD_MESSAGE)
  ) {
    return workingUnits
      .filter((u) => u.id !== order.unitId)
      .map((u) => ({ ...u }));
  }

  return cloneAll(workingUnits);
}
