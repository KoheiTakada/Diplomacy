/**
 * ホスト盤面修正用のユニット・補給拠点操作ロジック
 */

import type { BoardState, Unit } from '@/domain';
import { UnitType } from '@/domain';

/**
 * ユニットを追加する
 */
export function addUnitToBoard(
  board: BoardState,
  powerId: string,
  provinceId: string,
  unitType: UnitType,
  fleetCoast?: string,
): BoardState {
  const newUnit: Unit = {
    id: `${powerId}-${unitType === UnitType.Army ? 'A' : 'F'}-${provinceId}`,
    type: unitType,
    powerId,
    provinceId,
    fleetCoast: unitType === UnitType.Fleet ? (fleetCoast as any) : undefined,
  };
  return {
    ...board,
    units: [...board.units, newUnit],
  };
}

/**
 * ユニットを削除する
 */
export function removeUnitFromBoard(
  board: BoardState,
  unitId: string,
): BoardState {
  return {
    ...board,
    units: board.units.filter((u) => u.id !== unitId),
  };
}

/**
 * ユニットを移動する
 */
export function moveUnitOnBoard(
  board: BoardState,
  unitId: string,
  newProvinceId: string,
  newFleetCoast?: string,
): BoardState {
  const updatedUnits = board.units.map((u) => {
    if (u.id !== unitId) return u;
    return {
      ...u,
      provinceId: newProvinceId,
      fleetCoast: u.type === UnitType.Fleet ? (newFleetCoast as any) : undefined,
    };
  });
  return {
    ...board,
    units: updatedUnits,
  };
}

/**
 * ユニットの種別を変更する
 */
export function changeUnitType(
  board: BoardState,
  unitId: string,
  newType: UnitType,
): BoardState {
  const updatedUnits = board.units.map((u) => {
    if (u.id !== unitId) return u;
    return {
      ...u,
      type: newType,
      fleetCoast: newType === UnitType.Fleet ? u.fleetCoast : undefined,
    };
  });
  return {
    ...board,
    units: updatedUnits,
  };
}

/**
 * 補給拠点の所有国を変更する
 */
export function changeSupplyCenterOwner(
  board: BoardState,
  provinceId: string,
  newOwnerId: string | null,
): BoardState {
  return {
    ...board,
    supplyCenterOwnership: {
      ...board.supplyCenterOwnership,
      [provinceId]: newOwnerId,
    },
  };
}
