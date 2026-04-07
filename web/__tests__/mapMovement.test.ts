/**
 * mapMovement のユニットテスト
 *
 * 概要:
 *   陸軍のコンボイ到達候補（海域に艦隊がいる経路）の基本動作を検証する。
 */

import { MINI_MAP_INITIAL_STATE } from '@/miniMap';
import {
  buildAdjacencyKeySet,
  canSupportTargetInSupportOrder,
  findConvoyPathProvinceIdsForMove,
  getArmyConvoyReachableLandProvinceIds,
  getConvoyOrderCandidateArmyIds,
  getConvoyOrderDestinationProvinces,
  getSupportMoveDestinationProvinceIds,
  isDirectMoveValid,
} from '@/mapMovement';
import { OrderType, UnitType, type MoveOrder, type Order } from '@/domain';

describe('isDirectMoveValid（艦隊・沿岸同士は共通海域が必要）', () => {
  const board = { ...MINI_MAP_INITIAL_STATE };
  const adjKeys = buildAdjacencyKeySet(board);

  it('アルメニア→スミルナは陸軍のみ可（艦隊は不可）', () => {
    const army = {
      id: 'A',
      type: UnitType.Army,
      powerId: 'RUS',
      provinceId: 'ARM',
    };
    const fleet = {
      id: 'F',
      type: UnitType.Fleet,
      powerId: 'RUS',
      provinceId: 'ARM',
    };
    expect(isDirectMoveValid(army, 'ARM', 'SMY', board, adjKeys)).toBe(true);
    expect(isDirectMoveValid(fleet, 'ARM', 'SMY', board, adjKeys)).toBe(false);
  });

  it('ガスコーニュ→マルセイユは艦隊不可（陸軍は可）', () => {
    const army = {
      id: 'A',
      type: UnitType.Army,
      powerId: 'FRA',
      provinceId: 'GAS',
    };
    const fleet = {
      id: 'F',
      type: UnitType.Fleet,
      powerId: 'FRA',
      provinceId: 'GAS',
    };
    expect(isDirectMoveValid(army, 'GAS', 'MAR', board, adjKeys)).toBe(true);
    expect(isDirectMoveValid(fleet, 'GAS', 'MAR', board, adjKeys)).toBe(false);
  });

  it('ローマ→アビュリアは艦隊不可（ティレニアとアドリアで海域が分断）', () => {
    const fleet = {
      id: 'F',
      type: UnitType.Fleet,
      powerId: 'ITA',
      provinceId: 'ROM',
    };
    expect(isDirectMoveValid(fleet, 'ROM', 'APU', board, adjKeys)).toBe(false);
  });

  it('ピエモンテ→マルセイユはリヨン湾で共通海域があり艦隊可', () => {
    const fleet = {
      id: 'F',
      type: UnitType.Fleet,
      powerId: 'ITA',
      provinceId: 'PIE',
    };
    expect(isDirectMoveValid(fleet, 'PIE', 'MAR', board, adjKeys)).toBe(true);
  });
});

describe('getArmyConvoyReachableLandProvinceIds', () => {
  it('経路上の海上にいずれかの勢力の艦隊がいれば、その艦隊が自軍でなくても陸地到達候補に含める', () => {
    const board = {
      ...MINI_MAP_INITIAL_STATE,
      units: [
        { id: 'A-ENG', type: UnitType.Army, powerId: 'ENG', provinceId: 'LON' },
        {
          id: 'F-GER',
          type: UnitType.Fleet,
          powerId: 'GER',
          provinceId: 'ENG',
        },
      ],
    };
    const adjKeys = buildAdjacencyKeySet(board);
    const reach = getArmyConvoyReachableLandProvinceIds(
      board,
      board.units[0],
      adjKeys,
    );
    expect(reach.has('BEL')).toBe(true);
  });

  it('海上に艦隊がなければコンボイ候補の陸地は増えない（LON→BEL）', () => {
    const board = {
      ...MINI_MAP_INITIAL_STATE,
      units: [{ id: 'A-ENG', type: UnitType.Army, powerId: 'ENG', provinceId: 'LON' }],
    };
    const adjKeys = buildAdjacencyKeySet(board);
    const reach = getArmyConvoyReachableLandProvinceIds(
      board,
      board.units[0],
      adjKeys,
    );
    expect(reach.has('BEL')).toBe(false);
  });
});

describe('支援命令: canSupportTargetInSupportOrder', () => {
  it('隣接していれば待機支援可能', () => {
    const board = { ...MINI_MAP_INITIAL_STATE };
    const adjKeys = buildAdjacencyKeySet(board);
    const mun = board.units.find((u) => u.id === 'GER-A-MUN')!;
    const ber = board.units.find((u) => u.id === 'GER-A-BER')!;
    const ok = canSupportTargetInSupportOrder(board, mun, ber, adjKeys);
    expect(ok).toBe(true);
  });

  it('移動支援の行き先候補には輸送経由のみで届く先を含めない', () => {
    const board = {
      ...MINI_MAP_INITIAL_STATE,
      units: [
        { id: 'SUP-F', type: UnitType.Fleet, powerId: 'ENG', provinceId: 'ENG' },
        { id: 'ARM-LON', type: UnitType.Army, powerId: 'ENG', provinceId: 'LON' },
      ],
    };
    const adjKeys = buildAdjacencyKeySet(board);
    const supporter = board.units.find((u) => u.id === 'SUP-F')!;
    const supported = board.units.find((u) => u.id === 'ARM-LON')!;
    const ids = getSupportMoveDestinationProvinceIds(
      board,
      supporter,
      supported,
      adjKeys,
    );
    expect(ids.has('BEL')).toBe(false);
  });
});

describe('輸送命令 UI: getConvoyOrderCandidateArmyIds / getConvoyOrderDestinationProvinces', () => {
  it('海上の艦隊は、自艦隊を経由するコンボイで届く陸軍だけ候補に含める', () => {
    const board = {
      ...MINI_MAP_INITIAL_STATE,
      units: [
        { id: 'A-ENG', type: UnitType.Army, powerId: 'ENG', provinceId: 'LON' },
        {
          id: 'F-GER',
          type: UnitType.Fleet,
          powerId: 'GER',
          provinceId: 'ENG',
        },
      ],
    };
    const adjKeys = buildAdjacencyKeySet(board);
    const fleet = board.units[1];
    const ids = getConvoyOrderCandidateArmyIds(board, fleet, adjKeys);
    expect(ids).toContain('A-ENG');
    const army = board.units[0];
    const dests = getConvoyOrderDestinationProvinces(board, fleet, army, adjKeys);
    const bel = dests.find((p) => p.id === 'BEL');
    expect(bel).toBeDefined();
  });

  it('沿岸にいる艦隊は輸送命令の陸軍候補を返さない', () => {
    const board = { ...MINI_MAP_INITIAL_STATE };
    const adjKeys = buildAdjacencyKeySet(board);
    const kieFleet = board.units.find((u) => u.id === 'GER-F-KIE')!;
    const ids = getConvoyOrderCandidateArmyIds(board, kieFleet, adjKeys);
    expect(ids.length).toBe(0);
  });
});

describe('findConvoyPathProvinceIdsForMove', () => {
  it('輸送命令が無いコンボイ移動は null', () => {
    const board = MINI_MAP_INITIAL_STATE;
    const engArmy = board.units.find((u) => u.id === 'ENG-A-LVP');
    expect(engArmy).toBeDefined();
    const move: MoveOrder = {
      type: OrderType.Move,
      unitId: engArmy!.id,
      sourceProvinceId: engArmy!.provinceId,
      targetProvinceId: 'BEL',
    };
    const path = findConvoyPathProvinceIdsForMove(
      board,
      move,
      [move],
      buildAdjacencyKeySet(board),
    );
    expect(path).toBeNull();
  });

  it('輸送艦隊の海域が経路に含まれる命令なら陸間の州列を返す', () => {
    const board = {
      ...MINI_MAP_INITIAL_STATE,
      units: [
        { id: 'A-ENG', type: UnitType.Army, powerId: 'ENG', provinceId: 'LON' },
        {
          id: 'F-GER',
          type: UnitType.Fleet,
          powerId: 'GER',
          provinceId: 'ENG',
        },
      ],
    };
    const adjKeys = buildAdjacencyKeySet(board);
    const move: MoveOrder = {
      type: OrderType.Move,
      unitId: 'A-ENG',
      sourceProvinceId: 'LON',
      targetProvinceId: 'BEL',
    };
    const orders: Order[] = [
      move,
      {
        type: OrderType.Convoy,
        unitId: 'F-GER',
        armyUnitId: 'A-ENG',
        fromProvinceId: 'LON',
        toProvinceId: 'BEL',
      },
    ];
    const path = findConvoyPathProvinceIdsForMove(board, move, orders, adjKeys);
    expect(path).not.toBeNull();
    expect(path![0]).toBe('LON');
    expect(path![path!.length - 1]).toBe('BEL');
    expect(path!.includes('ENG')).toBe(true);
  });
});
