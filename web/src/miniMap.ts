/**
 * 標準ディプロマシー クラシックマップ（全7勢力・全75プロヴィンス）
 *
 * 概要:
 *   diplomacy 公式 standard.map の隣接関係を基に、STP / SPA / BUL は単一沿岸プロヴィンスに統合。
 *   スイスは通過不可のためグラフに含めない。
 *
 * 主な機能:
 *   - 初期配置・補給所有は 1901 年春の標準ルールに準拠
 *   - POWERS と MINI_MAP_INITIAL_STATE を UI・エンジンから参照
 *
 * 想定される制限事項:
 *   - 分割岸にいる艦隊は Unit.fleetCoast（NC/SC/EC）で所在岸を保持する。
 */

import {
  AreaType,
  boardWithRefreshedProvinceTint,
  BoardState,
  type PowerId,
  Season,
  UnitType,
  type Province,
} from './domain';
import type { Adjacency } from './domain';
import classicAdjPairs from './classicAdjacencies.json';
import classicProvMeta from './classicProvinces.json';

/** 参加勢力一覧（標準7大国） */
export const POWERS: PowerId[] = ['ENG', 'FRA', 'GER', 'ITA', 'AUS', 'RUS', 'TUR'];

/** 隣接ペアの一覧から双方向の Adjacency 配列を生成する */
function buildAdjacencies(pairs: [string, string][]): Adjacency[] {
  return pairs.flatMap(([a, b]) => [
    { fromProvinceId: a, toProvinceId: b },
    { fromProvinceId: b, toProvinceId: a },
  ]);
}

type ProvJson = {
  id: string;
  ja: string;
  areaType: string;
  isSupplyCenter: boolean;
  homePowerId?: string;
};

function toProvinces(meta: ProvJson[]): Province[] {
  return meta.map((row) => {
    const areaType =
      row.areaType === 'Sea'
        ? AreaType.Sea
        : row.areaType === 'Land'
          ? AreaType.Land
          : AreaType.Coastal;
    const p: Province = {
      id: row.id,
      name: row.ja,
      areaType,
      isSupplyCenter: row.isSupplyCenter,
    };
    if (row.homePowerId) {
      p.homePowerId = row.homePowerId;
    }
    return p;
  });
}

const provinces = toProvinces(classicProvMeta as ProvJson[]);

const supplyCenterOwnership: Record<string, PowerId | null> = {};
for (const p of provinces) {
  if (!p.isSupplyCenter) {
    continue;
  }
  if (p.homePowerId) {
    supplyCenterOwnership[p.id] = p.homePowerId;
  } else {
    supplyCenterOwnership[p.id] = null;
  }
}

/** 標準マップの初期ボード状態（1901年春・7勢力） */
const MINI_MAP_INITIAL_STATE_BASE: BoardState = {
  turn: { year: 1901, season: Season.Spring },
  provinces,
  adjacencies: buildAdjacencies(classicAdjPairs as [string, string][]),
  units: [
    { id: 'ENG-F-LON', type: UnitType.Fleet, powerId: 'ENG', provinceId: 'LON' },
    { id: 'ENG-F-EDI', type: UnitType.Fleet, powerId: 'ENG', provinceId: 'EDI' },
    { id: 'ENG-A-LVP', type: UnitType.Army, powerId: 'ENG', provinceId: 'LVP' },
    { id: 'FRA-A-PAR', type: UnitType.Army, powerId: 'FRA', provinceId: 'PAR' },
    { id: 'FRA-A-MAR', type: UnitType.Army, powerId: 'FRA', provinceId: 'MAR' },
    { id: 'FRA-F-BRE', type: UnitType.Fleet, powerId: 'FRA', provinceId: 'BRE' },
    { id: 'GER-A-MUN', type: UnitType.Army, powerId: 'GER', provinceId: 'MUN' },
    { id: 'GER-A-BER', type: UnitType.Army, powerId: 'GER', provinceId: 'BER' },
    { id: 'GER-F-KIE', type: UnitType.Fleet, powerId: 'GER', provinceId: 'KIE' },
    { id: 'ITA-A-VEN', type: UnitType.Army, powerId: 'ITA', provinceId: 'VEN' },
    { id: 'ITA-A-ROM', type: UnitType.Army, powerId: 'ITA', provinceId: 'ROM' },
    { id: 'ITA-F-NAP', type: UnitType.Fleet, powerId: 'ITA', provinceId: 'NAP' },
    { id: 'AUS-A-BUD', type: UnitType.Army, powerId: 'AUS', provinceId: 'BUD' },
    { id: 'AUS-A-VIE', type: UnitType.Army, powerId: 'AUS', provinceId: 'VIE' },
    { id: 'AUS-F-TRI', type: UnitType.Fleet, powerId: 'AUS', provinceId: 'TRI' },
    { id: 'RUS-A-WAR', type: UnitType.Army, powerId: 'RUS', provinceId: 'WAR' },
    { id: 'RUS-A-MOS', type: UnitType.Army, powerId: 'RUS', provinceId: 'MOS' },
    { id: 'RUS-F-SEV', type: UnitType.Fleet, powerId: 'RUS', provinceId: 'SEV' },
    {
      id: 'RUS-F-STP',
      type: UnitType.Fleet,
      powerId: 'RUS',
      provinceId: 'STP',
      fleetCoast: 'SC',
    },
    { id: 'TUR-F-ANK', type: UnitType.Fleet, powerId: 'TUR', provinceId: 'ANK' },
    { id: 'TUR-A-CON', type: UnitType.Army, powerId: 'TUR', provinceId: 'CON' },
    { id: 'TUR-A-SMY', type: UnitType.Army, powerId: 'TUR', provinceId: 'SMY' },
  ],
  supplyCenterOwnership: { ...supplyCenterOwnership },
};

/** 初期配置・サプライ所有に基づきマップ塗りの残存状態を埋めた盤面 */
export const MINI_MAP_INITIAL_STATE: BoardState =
  boardWithRefreshedProvinceTint(MINI_MAP_INITIAL_STATE_BASE);
