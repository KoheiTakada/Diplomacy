/**
 * ルールエンジン(MVP)の基本テスト
 *
 * 標準クラシックマップ（全7勢力・75プロヴィンス）に対応。
 * 初期配置は 1901 年春の標準ルールに基づく。
 */

import { MINI_MAP_INITIAL_STATE } from '@/miniMap';
import { adjudicateTurn } from '@/rulesEngine';
import { type FleetCoast, OrderType, Season, UnitType } from '@/domain';

describe('adjudicateTurn (MVP)', () => {
  it('単純な移動が成功する', () => {
    const board = MINI_MAP_INITIAL_STATE;
    const orders = [
      {
        type: OrderType.Move,
        unitId: 'FRA-A-PAR',
        sourceProvinceId: 'PAR',
        targetProvinceId: 'BUR',
      } as const,
    ];

    const result = adjudicateTurn(board, orders);
    const movedUnit = result.nextBoardState.units.find((u) => u.id === 'FRA-A-PAR');
    expect(movedUnit?.provinceId).toBe('BUR');
  });

  it('非隣接プロヴィンスへの移動は失敗する', () => {
    const board = MINI_MAP_INITIAL_STATE;
    const orders = [
      {
        type: OrderType.Move,
        unitId: 'FRA-A-PAR',
        sourceProvinceId: 'PAR',
        targetProvinceId: 'MUN',
      } as const,
    ];

    const result = adjudicateTurn(board, orders);
    const unit = result.nextBoardState.units.find((u) => u.id === 'FRA-A-PAR');
    expect(unit?.provinceId).toBe('PAR');
  });

  it('陸軍は海エリアに移動できない', () => {
    const board = {
      ...MINI_MAP_INITIAL_STATE,
      units: [
        { id: 'TEST-A', type: UnitType.Army, powerId: 'ENG', provinceId: 'LVP' },
      ],
    };
    const orders = [
      {
        type: OrderType.Move,
        unitId: 'TEST-A',
        sourceProvinceId: 'LVP',
        targetProvinceId: 'IRI',
      } as const,
    ];

    const result = adjudicateTurn(board, orders);
    const unit = result.nextBoardState.units.find((u) => u.id === 'TEST-A');
    expect(unit?.provinceId).toBe('LVP');
    const resolution = result.orderResolutions.find((r) => r.order.unitId === 'TEST-A');
    expect(resolution?.success).toBe(false);
    expect(resolution?.message).toContain('海エリア');
  });

  it('海軍は純粋な陸エリアに移動できない', () => {
    const board = {
      ...MINI_MAP_INITIAL_STATE,
      units: [
        { id: 'TEST-F', type: UnitType.Fleet, powerId: 'GER', provinceId: 'KIE' },
      ],
    };
    const orders = [
      {
        type: OrderType.Move,
        unitId: 'TEST-F',
        sourceProvinceId: 'KIE',
        targetProvinceId: 'MUN',
      } as const,
    ];

    const result = adjudicateTurn(board, orders);
    const unit = result.nextBoardState.units.find((u) => u.id === 'TEST-F');
    expect(unit?.provinceId).toBe('KIE');
    const resolution = result.orderResolutions.find((r) => r.order.unitId === 'TEST-F');
    expect(resolution?.success).toBe(false);
    expect(resolution?.message).toContain('陸エリア');
  });

  it('支援付き移動が防御側を押し出す', () => {
    const board = {
      ...MINI_MAP_INITIAL_STATE,
      units: [
        { id: 'A-ATT', type: UnitType.Army, powerId: 'FRA', provinceId: 'PAR' },
        { id: 'A-SUP', type: UnitType.Army, powerId: 'FRA', provinceId: 'PIC' },
        { id: 'A-DEF', type: UnitType.Army, powerId: 'GER', provinceId: 'BUR' },
      ],
    };

    const orders = [
      {
        type: OrderType.Move,
        unitId: 'A-ATT',
        sourceProvinceId: 'PAR',
        targetProvinceId: 'BUR',
      } as const,
      {
        type: OrderType.Support,
        unitId: 'A-SUP',
        supportedUnitId: 'A-ATT',
        fromProvinceId: 'PAR',
        toProvinceId: 'BUR',
      } as const,
    ];

    const result = adjudicateTurn(board, orders);
    const attacker = result.nextBoardState.units.find((u) => u.id === 'A-ATT');
    const defenderOnBoard = result.nextBoardState.units.find((u) => u.id === 'A-DEF');
    const dislodged = result.dislodgedUnits.find((d) => d.unit.id === 'A-DEF');

    expect(attacker?.provinceId).toBe('BUR');
    expect(defenderOnBoard).toBeUndefined();
    expect(dislodged).toBeDefined();
    expect(dislodged?.fromProvinceId).toBe('BUR');
  });

  it('移動支援は支援元への非目的地からの攻撃でカットされる', () => {
    const board = {
      ...MINI_MAP_INITIAL_STATE,
      units: [
        { id: 'A-ATT', type: UnitType.Army, powerId: 'FRA', provinceId: 'PAR' },
        { id: 'A-SUP', type: UnitType.Army, powerId: 'FRA', provinceId: 'PIC' },
        { id: 'A-DEF', type: UnitType.Army, powerId: 'GER', provinceId: 'BUR' },
        { id: 'GER-BEL', type: UnitType.Army, powerId: 'GER', provinceId: 'BEL' },
      ],
    };

    const orders = [
      {
        type: OrderType.Move,
        unitId: 'A-ATT',
        sourceProvinceId: 'PAR',
        targetProvinceId: 'BUR',
      } as const,
      {
        type: OrderType.Support,
        unitId: 'A-SUP',
        supportedUnitId: 'A-ATT',
        fromProvinceId: 'PAR',
        toProvinceId: 'BUR',
      } as const,
      {
        type: OrderType.Move,
        unitId: 'GER-BEL',
        sourceProvinceId: 'BEL',
        targetProvinceId: 'PIC',
      } as const,
    ];

    const result = adjudicateTurn(board, orders);
    const attacker = result.nextBoardState.units.find((u) => u.id === 'A-ATT');
    expect(attacker?.provinceId).toBe('PAR');
  });

  it('待機支援は、対象ユニットが移動命令を出していると不一致で失敗する', () => {
    const board = {
      ...MINI_MAP_INITIAL_STATE,
      units: [
        { id: 'FRA-A-PAR-X', type: UnitType.Army, powerId: 'FRA', provinceId: 'PAR' },
        { id: 'FRA-A-PIC-X', type: UnitType.Army, powerId: 'FRA', provinceId: 'PIC' },
      ],
    };
    const orders = [
      {
        type: OrderType.Move,
        unitId: 'FRA-A-PAR-X',
        sourceProvinceId: 'PAR',
        targetProvinceId: 'BUR',
      } as const,
      {
        type: OrderType.Support,
        unitId: 'FRA-A-PIC-X',
        supportedUnitId: 'FRA-A-PAR-X',
        fromProvinceId: 'PAR',
        toProvinceId: 'PAR',
      } as const,
    ];
    const result = adjudicateTurn(board, orders);
    const supportRes = result.orderResolutions.find(
      (r) =>
        r.order.type === OrderType.Support &&
        r.order.unitId === 'FRA-A-PIC-X',
    );
    expect(supportRes?.success).toBe(false);
    expect(supportRes?.message).toContain('一致');
  });

  it('移動支援は、対象ユニットの移動先と一致しないと失敗する', () => {
    const board = {
      ...MINI_MAP_INITIAL_STATE,
      units: [
        { id: 'FRA-A-PAR-Y', type: UnitType.Army, powerId: 'FRA', provinceId: 'PAR' },
        { id: 'FRA-A-PIC-Y', type: UnitType.Army, powerId: 'FRA', provinceId: 'PIC' },
      ],
    };
    const orders = [
      {
        type: OrderType.Move,
        unitId: 'FRA-A-PAR-Y',
        sourceProvinceId: 'PAR',
        targetProvinceId: 'BUR',
      } as const,
      {
        type: OrderType.Support,
        unitId: 'FRA-A-PIC-Y',
        supportedUnitId: 'FRA-A-PAR-Y',
        fromProvinceId: 'PAR',
        toProvinceId: 'BEL',
      } as const,
    ];
    const result = adjudicateTurn(board, orders);
    const supportRes = result.orderResolutions.find(
      (r) =>
        r.order.type === OrderType.Support &&
        r.order.unitId === 'FRA-A-PIC-Y',
    );
    expect(supportRes?.success).toBe(false);
    expect(supportRes?.message).toContain('一致');
  });

  it('移動支援は、支援元が目標地点に隣接していないと失敗する', () => {
    const board = {
      ...MINI_MAP_INITIAL_STATE,
      units: [
        { id: 'FRA-A-PAR-Z', type: UnitType.Army, powerId: 'FRA', provinceId: 'PAR' },
        { id: 'FRA-A-BRE-Z', type: UnitType.Army, powerId: 'FRA', provinceId: 'BRE' },
      ],
    };
    const orders = [
      {
        type: OrderType.Move,
        unitId: 'FRA-A-PAR-Z',
        sourceProvinceId: 'PAR',
        targetProvinceId: 'BUR',
      } as const,
      {
        type: OrderType.Support,
        unitId: 'FRA-A-BRE-Z',
        supportedUnitId: 'FRA-A-PAR-Z',
        fromProvinceId: 'PAR',
        toProvinceId: 'BUR',
      } as const,
    ];
    const result = adjudicateTurn(board, orders);
    const supportRes = result.orderResolutions.find(
      (r) =>
        r.order.type === OrderType.Support &&
        r.order.unitId === 'FRA-A-BRE-Z',
    );
    expect(supportRes?.success).toBe(false);
    expect(supportRes?.message).toContain('一致');
  });

  it('支援元への攻撃は、攻撃側が移動失敗でも支援カットになる', () => {
    const board = {
      ...MINI_MAP_INITIAL_STATE,
      units: [
        { id: 'A-ATT-X', type: UnitType.Army, powerId: 'FRA', provinceId: 'PAR' },
        { id: 'A-SUP-X', type: UnitType.Army, powerId: 'FRA', provinceId: 'PIC' },
        { id: 'A-DEF-X', type: UnitType.Army, powerId: 'GER', provinceId: 'BUR' },
        { id: 'A-CUT-X', type: UnitType.Army, powerId: 'GER', provinceId: 'BEL' },
        { id: 'A-HOLD-X', type: UnitType.Army, powerId: 'FRA', provinceId: 'HOL' },
      ],
    };
    const orders = [
      {
        type: OrderType.Move,
        unitId: 'A-ATT-X',
        sourceProvinceId: 'PAR',
        targetProvinceId: 'BUR',
      } as const,
      {
        type: OrderType.Support,
        unitId: 'A-SUP-X',
        supportedUnitId: 'A-ATT-X',
        fromProvinceId: 'PAR',
        toProvinceId: 'BUR',
      } as const,
      {
        type: OrderType.Move,
        unitId: 'A-CUT-X',
        sourceProvinceId: 'BEL',
        targetProvinceId: 'PIC',
      } as const,
      {
        type: OrderType.Support,
        unitId: 'A-HOLD-X',
        supportedUnitId: 'A-CUT-X',
        fromProvinceId: 'BEL',
        toProvinceId: 'PIC',
      } as const,
    ];
    const result = adjudicateTurn(board, orders);
    const supportRes = result.orderResolutions.find(
      (r) => r.order.type === OrderType.Support && r.order.unitId === 'A-SUP-X',
    );
    const attacker = result.nextBoardState.units.find((u) => u.id === 'A-ATT-X');
    expect(supportRes?.success).toBe(false);
    expect(attacker?.provinceId).toBe('PAR');
  });

  it('移動支援は、支援先（目的地）からの攻撃ではカットされない', () => {
    const board = {
      ...MINI_MAP_INITIAL_STATE,
      units: [
        { id: 'A-ATT-Y', type: UnitType.Army, powerId: 'FRA', provinceId: 'PAR' },
        { id: 'A-SUP-Y', type: UnitType.Army, powerId: 'FRA', provinceId: 'PIC' },
        { id: 'A-DEF-Y', type: UnitType.Army, powerId: 'GER', provinceId: 'BUR' },
      ],
    };
    const orders = [
      {
        type: OrderType.Move,
        unitId: 'A-ATT-Y',
        sourceProvinceId: 'PAR',
        targetProvinceId: 'BUR',
      } as const,
      {
        type: OrderType.Support,
        unitId: 'A-SUP-Y',
        supportedUnitId: 'A-ATT-Y',
        fromProvinceId: 'PAR',
        toProvinceId: 'BUR',
      } as const,
      {
        type: OrderType.Move,
        unitId: 'A-DEF-Y',
        sourceProvinceId: 'BUR',
        targetProvinceId: 'PIC',
      } as const,
    ];
    const result = adjudicateTurn(board, orders);
    const supportRes = result.orderResolutions.find(
      (r) => r.order.type === OrderType.Support && r.order.unitId === 'A-SUP-Y',
    );
    const attacker = result.nextBoardState.units.find((u) => u.id === 'A-ATT-Y');
    expect(supportRes?.success).toBe(true);
    expect(attacker?.provinceId).toBe('BUR');
  });

  it('春の解決後はターンが秋に進む', () => {
    const board = {
      ...MINI_MAP_INITIAL_STATE,
      turn: { year: 1901, season: Season.Spring },
    };
    const result = adjudicateTurn(board, []);
    expect(result.nextBoardState.turn.year).toBe(1901);
    expect(result.nextBoardState.turn.season).toBe(Season.Fall);
  });

  it('秋の解決後はターンが翌年の春に進む', () => {
    const board = {
      ...MINI_MAP_INITIAL_STATE,
      turn: { year: 1901, season: Season.Fall },
    };
    const result = adjudicateTurn(board, []);
    expect(result.nextBoardState.turn.year).toBe(1902);
    expect(result.nextBoardState.turn.season).toBe(Season.Spring);
  });

  it('同一地点への競合移動はスタンドオフになる', () => {
    const board = {
      ...MINI_MAP_INITIAL_STATE,
      units: [
        { id: 'A-1', type: UnitType.Army, powerId: 'FRA', provinceId: 'PAR' },
        { id: 'A-2', type: UnitType.Army, powerId: 'GER', provinceId: 'MUN' },
      ],
    };

    const orders = [
      {
        type: OrderType.Move,
        unitId: 'A-1',
        sourceProvinceId: 'PAR',
        targetProvinceId: 'BUR',
      } as const,
      {
        type: OrderType.Move,
        unitId: 'A-2',
        sourceProvinceId: 'MUN',
        targetProvinceId: 'BUR',
      } as const,
    ];

    const result = adjudicateTurn(board, orders);
    const u1 = result.nextBoardState.units.find((u) => u.id === 'A-1');
    const u2 = result.nextBoardState.units.find((u) => u.id === 'A-2');

    expect(u1?.provinceId).toBe('PAR');
    expect(u2?.provinceId).toBe('MUN');
  });

  it('コンボイ経路が成立すれば非隣接の陸軍移動が成功する', () => {
    const board = {
      ...MINI_MAP_INITIAL_STATE,
      units: [
        { id: 'A-ENG', type: UnitType.Army, powerId: 'ENG', provinceId: 'LON' },
        { id: 'F-ENG', type: UnitType.Fleet, powerId: 'ENG', provinceId: 'ENG' },
      ],
    };
    const orders = [
      {
        type: OrderType.Move,
        unitId: 'A-ENG',
        sourceProvinceId: 'LON',
        targetProvinceId: 'BEL',
      } as const,
      {
        type: OrderType.Convoy,
        unitId: 'F-ENG',
        armyUnitId: 'A-ENG',
        fromProvinceId: 'LON',
        toProvinceId: 'BEL',
      } as const,
    ];

    const result = adjudicateTurn(board, orders);
    const army = result.nextBoardState.units.find((u) => u.id === 'A-ENG');
    expect(army?.provinceId).toBe('BEL');
  });

  it('対応する陸軍移動命令がないコンボイは失敗ログになる', () => {
    const board = {
      ...MINI_MAP_INITIAL_STATE,
      units: [
        { id: 'A-ENG', type: UnitType.Army, powerId: 'ENG', provinceId: 'LON' },
        { id: 'F-ENG', type: UnitType.Fleet, powerId: 'ENG', provinceId: 'ENG' },
      ],
    };
    const orders = [
      {
        type: OrderType.Convoy,
        unitId: 'F-ENG',
        armyUnitId: 'A-ENG',
        fromProvinceId: 'LON',
        toProvinceId: 'BEL',
      } as const,
    ];

    const result = adjudicateTurn(board, orders);
    const convoyRes = result.orderResolutions.find((r) => r.order.type === OrderType.Convoy);
    expect(convoyRes?.success).toBe(false);
    expect(convoyRes?.message).toContain('対応する陸軍移動命令');
  });

  it('複数コンボイ経路の一部が妨害されても1経路生存で移動成功する', () => {
    const board = {
      ...MINI_MAP_INITIAL_STATE,
      units: [
        { id: 'A-ENG', type: UnitType.Army, powerId: 'ENG', provinceId: 'LVP' },
        { id: 'F-IRI', type: UnitType.Fleet, powerId: 'ENG', provinceId: 'IRI' },
        { id: 'F-ENG', type: UnitType.Fleet, powerId: 'ENG', provinceId: 'ENG' },
        { id: 'F-NAO', type: UnitType.Fleet, powerId: 'ENG', provinceId: 'NAO' },
        { id: 'F-MAO', type: UnitType.Fleet, powerId: 'ENG', provinceId: 'MAO' },
        { id: 'F-GER', type: UnitType.Fleet, powerId: 'GER', provinceId: 'NWG' },
        { id: 'A-SUP', type: UnitType.Army, powerId: 'GER', provinceId: 'CLY' },
      ],
    };
    const orders = [
      { type: OrderType.Move, unitId: 'A-ENG', sourceProvinceId: 'LVP', targetProvinceId: 'BEL' } as const,
      { type: OrderType.Convoy, unitId: 'F-IRI', armyUnitId: 'A-ENG', fromProvinceId: 'LVP', toProvinceId: 'BEL' } as const,
      { type: OrderType.Convoy, unitId: 'F-ENG', armyUnitId: 'A-ENG', fromProvinceId: 'LVP', toProvinceId: 'BEL' } as const,
      { type: OrderType.Convoy, unitId: 'F-NAO', armyUnitId: 'A-ENG', fromProvinceId: 'LVP', toProvinceId: 'BEL' } as const,
      { type: OrderType.Convoy, unitId: 'F-MAO', armyUnitId: 'A-ENG', fromProvinceId: 'LVP', toProvinceId: 'BEL' } as const,
      { type: OrderType.Move, unitId: 'F-GER', sourceProvinceId: 'NWG', targetProvinceId: 'NAO' } as const,
      { type: OrderType.Support, unitId: 'A-SUP', supportedUnitId: 'F-GER', fromProvinceId: 'NWG', toProvinceId: 'NAO' } as const,
    ];

    const result = adjudicateTurn(board, orders);
    const army = result.nextBoardState.units.find((u) => u.id === 'A-ENG');
    expect(army?.provinceId).toBe('BEL');
  });

  it('サンクト南岸の艦隊は北岸経由でないバレンツ海へ直接移動できない', () => {
    const board = {
      ...MINI_MAP_INITIAL_STATE,
      units: [
        {
          id: 'R-F',
          type: UnitType.Fleet,
          powerId: 'RUS',
          provinceId: 'STP',
          fleetCoast: 'SC' as FleetCoast,
        },
      ],
    };
    const orders = [
      {
        type: OrderType.Move,
        unitId: 'R-F',
        sourceProvinceId: 'STP',
        targetProvinceId: 'BAR',
      } as const,
    ];
    const result = adjudicateTurn(board, orders);
    const f = result.nextBoardState.units.find((u) => u.id === 'R-F');
    expect(f?.provinceId).toBe('STP');
  });

  it('複数岸への艦隊移動は到着岸（targetFleetCoast）未指定では失敗する', () => {
    const board = {
      ...MINI_MAP_INITIAL_STATE,
      units: [
        { id: 'F-MAO', type: UnitType.Fleet, powerId: 'ENG', provinceId: 'MAO' },
      ],
    };
    const orders = [
      {
        type: OrderType.Move,
        unitId: 'F-MAO',
        sourceProvinceId: 'MAO',
        targetProvinceId: 'SPA',
      } as const,
    ];
    const result = adjudicateTurn(board, orders);
    const f = result.nextBoardState.units.find((u) => u.id === 'F-MAO');
    expect(f?.provinceId).toBe('MAO');
    const r = result.orderResolutions.find((x) => x.order.unitId === 'F-MAO');
    expect(r?.success).toBe(false);
    expect(r?.message).toMatch(/岸|到着/);
  });

  it('同勢力ユニットが残留するマスへは移動できない', () => {
    const board = {
      ...MINI_MAP_INITIAL_STATE,
      units: [
        { id: 'A1', type: UnitType.Army, powerId: 'FRA', provinceId: 'PAR' },
        { id: 'A2', type: UnitType.Army, powerId: 'FRA', provinceId: 'PIC' },
      ],
    };
    const orders = [
      {
        type: OrderType.Move,
        unitId: 'A2',
        sourceProvinceId: 'PIC',
        targetProvinceId: 'PAR',
      } as const,
    ];
    const result = adjudicateTurn(board, orders);
    expect(result.nextBoardState.units.find((u) => u.id === 'A2')?.provinceId).toBe('PIC');
    const r = result.orderResolutions.find((x) => x.order.unitId === 'A2');
    expect(r?.success).toBe(false);
    expect(r?.message).toContain('同じ勢力');
  });

  it('検証落ちで陸軍が去れないマスに、同勢力海軍は入れない（CON の二重占有を防ぐ）', () => {
    const board = MINI_MAP_INITIAL_STATE;
    const orders = [
      {
        type: OrderType.Move,
        unitId: 'TUR-A-CON',
        sourceProvinceId: 'CON',
        targetProvinceId: 'SMY',
      } as const,
      {
        type: OrderType.Move,
        unitId: 'TUR-F-ANK',
        sourceProvinceId: 'ANK',
        targetProvinceId: 'CON',
      } as const,
    ];
    const result = adjudicateTurn(board, orders);
    const army = result.nextBoardState.units.find((u) => u.id === 'TUR-A-CON');
    const fleet = result.nextBoardState.units.find((u) => u.id === 'TUR-F-ANK');
    expect(army?.provinceId).toBe('CON');
    expect(fleet?.provinceId).toBe('ANK');
    const fleetRes = result.orderResolutions.find(
      (r) => r.order.type === OrderType.Move && r.order.unitId === 'TUR-F-ANK',
    );
    expect(fleetRes?.success).toBe(false);
  });

  it('同勢力の入替移動（双方が去る）は許可される', () => {
    const board = {
      ...MINI_MAP_INITIAL_STATE,
      units: [
        { id: 'A1', type: UnitType.Army, powerId: 'FRA', provinceId: 'PAR' },
        { id: 'A2', type: UnitType.Army, powerId: 'FRA', provinceId: 'BUR' },
      ],
    };
    const orders = [
      {
        type: OrderType.Move,
        unitId: 'A1',
        sourceProvinceId: 'PAR',
        targetProvinceId: 'BUR',
      } as const,
      {
        type: OrderType.Move,
        unitId: 'A2',
        sourceProvinceId: 'BUR',
        targetProvinceId: 'PAR',
      } as const,
    ];
    const result = adjudicateTurn(board, orders);
    expect(result.nextBoardState.units.find((u) => u.id === 'A1')?.provinceId).toBe('BUR');
    expect(result.nextBoardState.units.find((u) => u.id === 'A2')?.provinceId).toBe('PAR');
  });

  it('サンクト南岸の艦隊はフィンランドへ移動できる', () => {
    const board = {
      ...MINI_MAP_INITIAL_STATE,
      units: [
        {
          id: 'R-F',
          type: UnitType.Fleet,
          powerId: 'RUS',
          provinceId: 'STP',
          fleetCoast: 'SC' as FleetCoast,
        },
      ],
    };
    const orders = [
      {
        type: OrderType.Move,
        unitId: 'R-F',
        sourceProvinceId: 'STP',
        targetProvinceId: 'FIN',
      } as const,
    ];
    const result = adjudicateTurn(board, orders);
    const f = result.nextBoardState.units.find((u) => u.id === 'R-F');
    expect(f?.provinceId).toBe('FIN');
  });

  it('明示Holdと命令未指定はどちらも維持成功で記録される', () => {
    const board = {
      ...MINI_MAP_INITIAL_STATE,
      units: [
        { id: 'H1', type: UnitType.Army, powerId: 'FRA', provinceId: 'PAR' },
        { id: 'H2', type: UnitType.Army, powerId: 'GER', provinceId: 'BUR' },
      ],
    };
    const orders = [
      { type: OrderType.Hold, unitId: 'H1' } as const,
    ];
    const result = adjudicateTurn(board, orders);
    const h1 = result.orderResolutions.find(
      (r) => r.order.type === OrderType.Hold && r.order.unitId === 'H1',
    );
    const h2 = result.orderResolutions.find(
      (r) => r.order.type === OrderType.Hold && r.order.unitId === 'H2',
    );
    expect(h1?.message).toBe('維持成功');
    expect(h2?.message).toBe('維持成功');
  });

  it('相互移動では、支援付き側が勝って押し出せる（SWE→NWY with SKA support）', () => {
    const board = {
      ...MINI_MAP_INITIAL_STATE,
      units: [
        { id: 'R-A-SWE', type: UnitType.Army, powerId: 'RUS', provinceId: 'SWE' },
        { id: 'E-A-NWY', type: UnitType.Army, powerId: 'ENG', provinceId: 'NWY' },
        { id: 'G-F-SKA', type: UnitType.Fleet, powerId: 'GER', provinceId: 'SKA' },
      ],
    };
    const orders = [
      {
        type: OrderType.Move,
        unitId: 'R-A-SWE',
        sourceProvinceId: 'SWE',
        targetProvinceId: 'NWY',
      } as const,
      {
        type: OrderType.Move,
        unitId: 'E-A-NWY',
        sourceProvinceId: 'NWY',
        targetProvinceId: 'SWE',
      } as const,
      {
        type: OrderType.Support,
        unitId: 'G-F-SKA',
        supportedUnitId: 'R-A-SWE',
        fromProvinceId: 'SWE',
        toProvinceId: 'NWY',
      } as const,
    ];
    const result = adjudicateTurn(board, orders);
    const rus = result.nextBoardState.units.find((u) => u.id === 'R-A-SWE');
    const eng = result.nextBoardState.units.find((u) => u.id === 'E-A-NWY');
    const dislodgedEng = result.dislodgedUnits.find((d) => d.unit.id === 'E-A-NWY');
    expect(rus?.provinceId).toBe('NWY');
    expect(eng).toBeUndefined();
    expect(dislodgedEng).toBeDefined();
  });

});
