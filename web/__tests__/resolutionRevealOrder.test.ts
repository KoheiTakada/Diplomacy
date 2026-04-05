/**
 * 解決表示タイムラインの順序テスト
 */

import { MINI_MAP_INITIAL_STATE } from '@/miniMap';
import { adjudicateTurn } from '@/rulesEngine';
import {
  buildResolutionRevealTimeline,
  type RevealTimelineStep,
} from '@/resolutionRevealOrder';
import { OrderType, UnitType } from '@/domain';

const POWER_ORDER = ['ENG', 'FRA', 'GER', 'ITA', 'AUS', 'RUS', 'TUR'] as const;

/**
 * タイムライン内の Move 解決行の unitId を出現順で返す。
 *
 * @param timeline - buildResolutionRevealTimeline の戻り値
 * @returns 移動命令のユニット ID 列
 */
function moveUnitIdsInOrder(timeline: RevealTimelineStep[]): string[] {
  const ids: string[] = [];
  for (const step of timeline) {
    if (step.kind !== 'resolution') {
      continue;
    }
    if (step.r.order.type !== OrderType.Move) {
      continue;
    }
    ids.push(step.r.order.unitId);
  }
  return ids;
}

describe('buildResolutionRevealTimeline', () => {
  it('空ける移動（B→C）が入る移動（A→B）より先に並ぶ', () => {
    const board = {
      ...MINI_MAP_INITIAL_STATE,
      units: [
        { id: 'A-PB', type: UnitType.Army, powerId: 'FRA', provinceId: 'PAR' },
        { id: 'B-CM', type: UnitType.Army, powerId: 'FRA', provinceId: 'BUR' },
      ],
    };
    const orders = [
      {
        type: OrderType.Move,
        unitId: 'A-PB',
        sourceProvinceId: 'PAR',
        targetProvinceId: 'BUR',
      } as const,
      {
        type: OrderType.Move,
        unitId: 'B-CM',
        sourceProvinceId: 'BUR',
        targetProvinceId: 'MUN',
      } as const,
    ];

    const result = adjudicateTurn(board, orders);
    const timeline = buildResolutionRevealTimeline(
      board,
      [...orders],
      result,
      POWER_ORDER,
    );
    const ids = moveUnitIdsInOrder(timeline);
    const iB = ids.indexOf('B-CM');
    const iA = ids.indexOf('A-PB');
    expect(iB).toBeGreaterThanOrEqual(0);
    expect(iA).toBeGreaterThanOrEqual(0);
    expect(iB).toBeLessThan(iA);
  });

  it('同一目標へのスタンドオフ失敗が、同勢力ブロック失敗より先に並ぶ', () => {
    const board = {
      ...MINI_MAP_INITIAL_STATE,
      units: [
        { id: 'D-BE', type: UnitType.Army, powerId: 'GER', provinceId: 'BER' },
        { id: 'E-MU', type: UnitType.Army, powerId: 'GER', provinceId: 'MUN' },
        { id: 'G-RU', type: UnitType.Army, powerId: 'GER', provinceId: 'RUH' },
      ],
    };
    const orders = [
      {
        type: OrderType.Move,
        unitId: 'D-BE',
        sourceProvinceId: 'BER',
        targetProvinceId: 'MUN',
      } as const,
      {
        type: OrderType.Move,
        unitId: 'E-MU',
        sourceProvinceId: 'MUN',
        targetProvinceId: 'BUR',
      } as const,
      {
        type: OrderType.Move,
        unitId: 'G-RU',
        sourceProvinceId: 'RUH',
        targetProvinceId: 'BUR',
      } as const,
    ];

    const result = adjudicateTurn(board, orders);
    const timeline = buildResolutionRevealTimeline(
      board,
      [...orders],
      result,
      POWER_ORDER,
    );
    const ids = moveUnitIdsInOrder(timeline);
    const iD = ids.indexOf('D-BE');
    const iE = ids.indexOf('E-MU');
    const iG = ids.indexOf('G-RU');
    expect(iE).toBeGreaterThanOrEqual(0);
    expect(iG).toBeGreaterThanOrEqual(0);
    expect(iD).toBeGreaterThanOrEqual(0);
    const standMax = Math.max(iE, iG);
    const standMin = Math.min(iE, iG);
    expect(iD).toBeGreaterThan(standMax);
    expect(Math.abs(iE - iG)).toBe(1);
  });

  it('移動支援の成功行が、その移動行より前に並ぶ', () => {
    const board = {
      ...MINI_MAP_INITIAL_STATE,
      units: [
        { id: 'A-ATT', type: UnitType.Army, powerId: 'FRA', provinceId: 'PAR' },
        { id: 'A-SUP', type: UnitType.Army, powerId: 'FRA', provinceId: 'PIC' },
        { id: 'A-DEF', type: UnitType.Army, powerId: 'GER', provinceId: 'BUR' },
      ],
    };
    const domainOrders = [
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

    const result = adjudicateTurn(board, [...domainOrders]);
    const timeline = buildResolutionRevealTimeline(
      board,
      domainOrders,
      result,
      POWER_ORDER,
    );
    let seenSupport = -1;
    let seenMove = -1;
    timeline.forEach((s, i) => {
      if (s.kind !== 'resolution') {
        return;
      }
      if (s.r.order.type === OrderType.Support && s.r.success) {
        seenSupport = i;
      }
      if (s.r.order.type === OrderType.Move && s.r.order.unitId === 'A-ATT') {
        seenMove = i;
      }
    });
    expect(seenSupport).toBeGreaterThanOrEqual(0);
    expect(seenMove).toBeGreaterThanOrEqual(0);
    expect(seenSupport).toBeLessThan(seenMove);
  });
});
