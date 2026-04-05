/**
 * 分割岸（STP / SPA / BUL）を単一プロヴィンス＋艦隊の岸フラグで扱う隣接・移動判定
 *
 * 概要:
 *   グラフ上は75州の1ノード。艦隊は STP/SPA/BUL にいるとき `Unit.fleetCoast` で岸を保持する。
 *   陸軍は公式どおり陸隣接のみ。海軍の出入りは岸ごとの隣接リストで制限する。
 *
 * 制限事項:
 *   - SPA（MAO/POR 経由）・BUL（CON 経由）の到着岸が複数ある場合は
 *     MoveOrder.targetFleetCoast の指定が必要（UI で選択）。
 *   - 沿岸州同士の艦隊直移動は、両州に隣接する同一海域が存在するときのみ可（公式の海岸線ルール）。
 */

import {
  AreaType,
  type BoardState,
  type FleetCoast,
  type MoveOrder,
  type Order,
  OrderType,
  type Province,
  type Unit,
  UnitType,
} from './domain';

/** 標準マップで分割岸を持つプロヴィンスID */
const SPLIT_PROVINCE_IDS = new Set<string>(['STP', 'SPA', 'BUL']);

type CoastNeighbors = Partial<Record<FleetCoast, readonly string[]>>;

/** 各分割岸から海軍が直接移動できる隣接プロヴィンス（双方向の片側定義） */
const FLEET_NEIGHBORS_BY_COAST: Record<string, CoastNeighbors> = {
  STP: {
    NC: ['BAR', 'NWY'],
    SC: ['BOT', 'FIN', 'LVN'],
  },
  SPA: {
    NC: ['GAS', 'MAO', 'POR'],
    SC: ['LYO', 'MAO', 'MAR', 'POR', 'WES'],
  },
  BUL: {
    EC: ['BLA', 'CON', 'RUM'],
    SC: ['AEG', 'CON', 'GRE'],
  },
};

/** 分割岸プロヴィンスにいる陸軍が隣接移動できるプロヴィンス */
const ARMY_NEIGHBORS_OF_SPLIT: Record<string, readonly string[]> = {
  STP: ['FIN', 'LVN', 'MOS', 'NWY'],
  SPA: ['GAS', 'LYO', 'MAR', 'POR', 'WES'],
  BUL: ['CON', 'GRE', 'RUM', 'SER'],
};

export type MoveLegalityMode = 'adjudicate' | 'ui';

/**
 * 分割岸プロヴィンスかどうか
 */
export function isSplitProvince(provinceId: string): boolean {
  return SPLIT_PROVINCE_IDS.has(provinceId);
}

/**
 * 海軍が split へ neighbor から入るとき、到着しうる岸の一覧（0〜2件）
 */
export function fleetArrivalCoasts(splitProvinceId: string, neighborId: string): FleetCoast[] {
  const spec = FLEET_NEIGHBORS_BY_COAST[splitProvinceId];
  if (!spec) {
    return [];
  }
  const out: FleetCoast[] = [];
  (['NC', 'SC', 'EC'] as const).forEach((k) => {
    const list = spec[k];
    if (list?.includes(neighborId)) {
      out.push(k);
    }
  });
  return out;
}

/**
 * 同一プロヴィンスに（除外を除き）ユニットがいるか。陸軍・海軍の併存も不可。
 */
export function isProvinceOccupied(
  board: BoardState,
  provinceId: string,
  exceptUnitId?: string,
): boolean {
  return board.units.some((u) => u.id !== exceptUnitId && u.provinceId === provinceId);
}

/**
 * 補給所有のキー（統合後はプロヴィンスIDのまま）
 */
export function supplyCenterKeyForProvince(p: Province | undefined): string | null {
  if (!p?.isSupplyCenter) {
    return null;
  }
  return p.id;
}

/**
 * 隣接グラフのキーを生成する
 */
export function buildAdjacencyKeySet(board: BoardState): Set<string> {
  const s = new Set<string>();
  for (const a of board.adjacencies) {
    s.add(`${a.fromProvinceId}->${a.toProvinceId}`);
  }
  return s;
}

/**
 * 沿岸州同士で、隣接グラフ上つながっていても艦隊が行き来できるか。
 *
 * 両方に接する海（AreaType.Sea）が1つでもあれば true。
 * 海・分割岸のみとの組み合わせでは常に true（呼び出し側で不要なら使わない）。
 *
 * @param fromId 移動元プロヴィンスID
 * @param toId 移動先プロヴィンスID
 * @param board 盤面（州の種別判定用）
 * @param adjKeys 有向隣接キー `A->B`
 * @returns 沿岸↔沿岸なら共通海域の有無、それ以外は true
 */
export function fleetCoastalPairSharesSea(
  fromId: string,
  toId: string,
  board: BoardState,
  adjKeys: Set<string>,
): boolean {
  const fromP = board.provinces.find((p) => p.id === fromId);
  const toP = board.provinces.find((p) => p.id === toId);
  if (!fromP || !toP) {
    return false;
  }
  if (
    fromP.areaType !== AreaType.Coastal ||
    toP.areaType !== AreaType.Coastal
  ) {
    return true;
  }
  for (const sea of board.provinces) {
    if (sea.areaType !== AreaType.Sea) {
      continue;
    }
    if (
      adjKeys.has(`${fromId}->${sea.id}`) &&
      adjKeys.has(`${toId}->${sea.id}`)
    ) {
      return true;
    }
  }
  return false;
}

function armyMayUseEdge(fromId: string, toId: string): boolean {
  if (isSplitProvince(fromId)) {
    const allowed = ARMY_NEIGHBORS_OF_SPLIT[fromId];
    return allowed?.includes(toId) ?? false;
  }
  if (isSplitProvince(toId)) {
    const allowed = ARMY_NEIGHBORS_OF_SPLIT[toId];
    return allowed?.includes(fromId) ?? false;
  }
  return true;
}

function fleetMayUseEdge(
  unit: Unit,
  fromId: string,
  toId: string,
  mode: MoveLegalityMode,
  targetFleetCoast: FleetCoast | undefined,
): boolean {
  if (isSplitProvince(fromId)) {
    const coast = unit.fleetCoast;
    if (!coast) {
      return false;
    }
    const list = FLEET_NEIGHBORS_BY_COAST[fromId]?.[coast];
    return list?.includes(toId) ?? false;
  }
  if (isSplitProvince(toId)) {
    const coasts = fleetArrivalCoasts(toId, fromId);
    if (coasts.length === 0) {
      return false;
    }
    if (coasts.length === 1) {
      return true;
    }
    if (mode === 'ui') {
      return true;
    }
    return targetFleetCoast != null && coasts.includes(targetFleetCoast);
  }
  return true;
}

/**
 * ユニットが from から to へ直接移動できるか（隣接＋地形＋分割岸）
 *
 * @param opts.mode ui は到着岸が複数でも候補表示用に true になりうる
 * @param opts.targetFleetCoast  adjudicate 時、複数岸への艦隊移動で必須
 */
export function isDirectMoveValid(
  unit: Unit,
  fromId: string,
  toId: string,
  board: BoardState,
  adjKeys: Set<string>,
  opts?: {
    mode?: MoveLegalityMode;
    targetFleetCoast?: FleetCoast;
  },
): boolean {
  if (!adjKeys.has(`${fromId}->${toId}`)) {
    return false;
  }
  const mode = opts?.mode ?? 'adjudicate';
  const toP = board.provinces.find((p) => p.id === toId);
  if (!toP) {
    return false;
  }
  if (unit.type === UnitType.Army) {
    if (toP.areaType === AreaType.Sea) {
      return false;
    }
    return armyMayUseEdge(fromId, toId);
  }
  if (unit.type === UnitType.Fleet) {
    if (toP.areaType === AreaType.Land) {
      return false;
    }
    if (!fleetMayUseEdge(unit, fromId, toId, mode, opts?.targetFleetCoast)) {
      return false;
    }
    return fleetCoastalPairSharesSea(fromId, toId, board, adjKeys);
  }
  return false;
}

/**
 * ユニットが from から直接移動しうる隣接プロヴィンスIDの集合（命令UI・退却UI用）
 *
 * 陸軍・海軍の別なく isDirectMoveValid（mode: ui）を全州に対して評価する。
 */
export function getDirectMoveTargets(
  unit: Unit,
  fromId: string,
  board: BoardState,
  adjKeys: Set<string>,
): Set<string> {
  const out = new Set<string>();
  for (const p of board.provinces) {
    if (isDirectMoveValid(unit, fromId, p.id, board, adjKeys, { mode: 'ui' })) {
      out.add(p.id);
    }
  }
  return out;
}

/**
 * 陸軍がコンボイ経由で到達しうる陸地プロヴィンスIDの集合（命令UIの移動先候補用）
 *
 * 経路は「現在地―（隣接）海域―…―（隣接）海域―（隣接）目的陸地」で、
 * 経路上の各海域（AreaType.Sea）に少なくとも1隻の海軍がいるときのみ到達可能とみなす。
 * 艦隊の所属勢力は問わない。直接隣接による陸移動は含めない（呼び出し側で getDirectMoveTargets と併合する）。
 *
 * 制限事項:
 * - 本エンジンの Convoy 命令と同様、海上マス（Sea）にいる艦隊のみを経路に用いる。
 *
 * @param board 盤面
 * @param army 陸軍ユニット
 * @param adjKeys 隣接ペアの集合
 * @returns コンボイのみで到達しうる陸・沿岸プロヴィンスID
 */
export function getArmyConvoyReachableLandProvinceIds(
  board: BoardState,
  army: Unit,
  adjKeys: Set<string>,
): Set<string> {
  if (army.type !== UnitType.Army) {
    return new Set();
  }
  const provinceById = new Map(board.provinces.map((p) => [p.id, p]));
  const seasWithFleet = new Set<string>();
  for (const u of board.units) {
    if (u.type !== UnitType.Fleet) {
      continue;
    }
    const prov = provinceById.get(u.provinceId);
    if (prov?.areaType === AreaType.Sea) {
      seasWithFleet.add(u.provinceId);
    }
  }
  const sourceId = army.provinceId;
  const reachableLand = new Set<string>();

  const startSeas: string[] = [];
  for (const p of board.provinces) {
    if (p.areaType !== AreaType.Sea) {
      continue;
    }
    if (!seasWithFleet.has(p.id)) {
      continue;
    }
    if (!adjKeys.has(`${sourceId}->${p.id}`)) {
      continue;
    }
    startSeas.push(p.id);
  }
  if (startSeas.length === 0) {
    return reachableLand;
  }

  for (const targetP of board.provinces) {
    if (targetP.id === sourceId) {
      continue;
    }
    if (targetP.areaType === AreaType.Sea) {
      continue;
    }
    const goalSeas = new Set<string>();
    for (const p of board.provinces) {
      if (p.areaType !== AreaType.Sea) {
        continue;
      }
      if (!seasWithFleet.has(p.id)) {
        continue;
      }
      if (!adjKeys.has(`${p.id}->${targetP.id}`)) {
        continue;
      }
      goalSeas.add(p.id);
    }
    if (goalSeas.size === 0) {
      continue;
    }

    const queue: string[] = [...startSeas];
    const visited = new Set<string>(queue);
    let hit = false;
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (goalSeas.has(current)) {
        hit = true;
        break;
      }
      for (const next of board.provinces) {
        if (next.areaType !== AreaType.Sea) {
          continue;
        }
        if (!seasWithFleet.has(next.id)) {
          continue;
        }
        if (!adjKeys.has(`${current}->${next.id}`)) {
          continue;
        }
        if (visited.has(next.id)) {
          continue;
        }
        visited.add(next.id);
        queue.push(next.id);
      }
    }
    if (hit) {
      reachableLand.add(targetP.id);
    }
  }
  return reachableLand;
}

/**
 * 命令 UI 用に、ユニットが現在地から移動しうるプロヴィンス ID の集合を返す。
 *
 * 陸軍は隣接移動先とコンボイのみで到達しうる陸地の和集合。海軍は隣接のみ。
 *
 * @param board 盤面
 * @param unit 対象ユニット
 * @param adjKeys 隣接ペアの集合
 * @returns 移動候補のプロヴィンス ID
 */
export function getReachableProvinceIdsForOrderUi(
  board: BoardState,
  unit: Unit,
  adjKeys: Set<string>,
): Set<string> {
  if (unit.type === UnitType.Army) {
    const direct = getDirectMoveTargets(unit, unit.provinceId, board, adjKeys);
    const convoyOnlyLands = getArmyConvoyReachableLandProvinceIds(board, unit, adjKeys);
    return new Set([...direct, ...convoyOnlyLands]);
  }
  return getDirectMoveTargets(unit, unit.provinceId, board, adjKeys);
}

/**
 * 支援命令で「移動支援」の行き先として選べるプロヴィンス ID（交差集合）。
 *
 * 支援元の隣接先と、支援対象ユニットの移動可能先の共通部分。
 * 待機支援用の「対象の現在地」は含めない（UI 側で別オプションとして足す）。
 *
 * @param board 盤面
 * @param supporter 支援するユニット
 * @param supported 支援されるユニット
 * @param adjKeys 隣接ペアの集合
 * @returns 移動支援で選べる行き先
 */
export function getSupportMoveDestinationProvinceIds(
  board: BoardState,
  supporter: Unit,
  supported: Unit,
  adjKeys: Set<string>,
): Set<string> {
  const supporterReach = new Set(
    board.adjacencies
      .filter((a) => a.fromProvinceId === supporter.provinceId)
      .map((a) => a.toProvinceId),
  );
  const supportedReach = getReachableProvinceIdsForOrderUi(board, supported, adjKeys);
  const out = new Set<string>();
  for (const id of supportedReach) {
    if (supporterReach.has(id)) {
      out.add(id);
    }
  }
  return out;
}

/**
 * 支援命令において、支援元が支援対象を（待機または移動）支援しうるか。
 *
 * 待機支援: 支援元が対象の現在地に隣接。
 * 移動支援: 上記 `getSupportMoveDestinationProvinceIds` が空でなければ可。
 *
 * @param board 盤面
 * @param supporter 支援するユニット
 * @param supported 支援されるユニット
 * @param adjKeys 隣接ペアの集合
 */
export function canSupportTargetInSupportOrder(
  board: BoardState,
  supporter: Unit,
  supported: Unit,
  adjKeys: Set<string>,
): boolean {
  if (supporter.id === supported.id) {
    return false;
  }
  const supporterReach = new Set(
    board.adjacencies
      .filter((a) => a.fromProvinceId === supporter.provinceId)
      .map((a) => a.toProvinceId),
  );
  if (supporterReach.has(supported.provinceId)) {
    return true;
  }
  return getSupportMoveDestinationProvinceIds(board, supporter, supported, adjKeys).size > 0;
}

/**
 * 海上に艦隊がいるマスの集合（コンボイ経路のノード）。AreaType.Sea のみ。
 */
function seaProvincesWithFleet(board: BoardState): Set<string> {
  const provinceById = new Map(board.provinces.map((p) => [p.id, p]));
  const seasWithFleet = new Set<string>();
  for (const u of board.units) {
    if (u.type !== UnitType.Fleet) {
      continue;
    }
    const prov = provinceById.get(u.provinceId);
    if (prov?.areaType === AreaType.Sea) {
      seasWithFleet.add(u.provinceId);
    }
  }
  return seasWithFleet;
}

/**
 * 海域グラフ上で、start 集合から goal へ到達可能か（BFS）。
 */
/** BFS 親ポインタ: 海域 ID → 直前の海域 ID（出発海域はマーカー文字列） */
const CONVOY_PATH_PARENT_FROM_SOURCE = '__SRC__' as const;

/**
 * 陸軍のコンボイ移動について、解決エンジンの hasConvoyRoute と同じ前提で
 * 通過する海域 ID の鎖（＋両端の陸）を返す。
 *
 * 経路は「出発陸 → 最初の海域 → … → 最後の海域 → 目的陸」のプロヴィンス ID 列。
 * 成立しない場合は null。
 *
 * @param board - 解決前の盤面
 * @param move - 対象の移動命令（陸軍想定）
 * @param orders - 当ターンの全命令（Convoy を参照）
 * @param adjKeys - 隣接キー集合
 * @param excludeSeas - 輸送妨害で除外する海域（通常の演出では空）
 */
export function findConvoyPathProvinceIdsForMove(
  board: BoardState,
  move: MoveOrder,
  orders: Order[],
  adjKeys: Set<string>,
  excludeSeas: Set<string> = new Set(),
): string[] | null {
  const provinceById = new Map(board.provinces.map((p) => [p.id, p]));
  const unitById = new Map(board.units.map((u) => [u.id, u]));
  const army = unitById.get(move.unitId);
  if (!army || army.type !== UnitType.Army) {
    return null;
  }

  const convoySeaByArmy: Map<string, Set<string>> = new Map();
  for (const c of orders) {
    if (c.type !== OrderType.Convoy) {
      continue;
    }
    const fleet = unitById.get(c.unitId);
    if (!fleet || fleet.type !== UnitType.Fleet) {
      continue;
    }
    const fleetProvince = provinceById.get(fleet.provinceId);
    if (!fleetProvince || fleetProvince.areaType !== AreaType.Sea) {
      continue;
    }
    const convoyKey = `${c.armyUnitId}:${c.fromProvinceId}:${c.toProvinceId}`;
    const set = convoySeaByArmy.get(convoyKey) ?? new Set<string>();
    set.add(fleet.provinceId);
    convoySeaByArmy.set(convoyKey, set);
  }

  const moveKey = `${move.unitId}:${move.sourceProvinceId}:${move.targetProvinceId}`;
  const seas = convoySeaByArmy.get(moveKey);
  if (!seas || seas.size === 0) {
    return null;
  }
  const aliveSeas = new Set([...seas].filter((id) => !excludeSeas.has(id)));

  const starts = [...aliveSeas].filter((seaId) => {
    if (!adjKeys.has(`${move.sourceProvinceId}->${seaId}`)) {
      return false;
    }
    return provinceById.get(seaId)?.areaType === AreaType.Sea;
  });
  const goals = new Set(
    [...aliveSeas].filter((seaId) =>
      adjKeys.has(`${seaId}->${move.targetProvinceId}`),
    ),
  );

  if (starts.length === 0 || goals.size === 0) {
    return null;
  }

  type ParentVal = string | typeof CONVOY_PATH_PARENT_FROM_SOURCE;
  const parent = new Map<string, ParentVal>();
  const queue: string[] = [];

  for (const s of starts) {
    if (!parent.has(s)) {
      parent.set(s, CONVOY_PATH_PARENT_FROM_SOURCE);
      queue.push(s);
    }
  }

  let found: string | null = null;
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (goals.has(cur)) {
      found = cur;
      break;
    }
    for (const next of aliveSeas) {
      if (parent.has(next)) {
        continue;
      }
      if (!adjKeys.has(`${cur}->${next}`)) {
        continue;
      }
      if (provinceById.get(next)?.areaType !== AreaType.Sea) {
        continue;
      }
      parent.set(next, cur);
      queue.push(next);
    }
  }

  if (found == null) {
    return null;
  }

  const seaChain: string[] = [];
  let cur: string | null = found;
  while (cur != null) {
    seaChain.unshift(cur);
    const p = parent.get(cur);
    if (p === CONVOY_PATH_PARENT_FROM_SOURCE) {
      break;
    }
    if (p === undefined) {
      return null;
    }
    cur = p;
  }

  return [move.sourceProvinceId, ...seaChain, move.targetProvinceId];
}

function seaBfsReachableFrom(
  board: BoardState,
  starts: Iterable<string>,
  seasWithFleet: Set<string>,
  adjKeys: Set<string>,
  goal: string,
): boolean {
  const queue: string[] = [];
  const visited = new Set<string>();
  for (const s of starts) {
    if (!seasWithFleet.has(s)) {
      continue;
    }
    if (!visited.has(s)) {
      visited.add(s);
      queue.push(s);
    }
  }
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === goal) {
      return true;
    }
    for (const next of board.provinces) {
      if (next.areaType !== AreaType.Sea) {
        continue;
      }
      if (!seasWithFleet.has(next.id)) {
        continue;
      }
      if (!adjKeys.has(`${current}->${next.id}`)) {
        continue;
      }
      if (visited.has(next.id)) {
        continue;
      }
      visited.add(next.id);
      queue.push(next.id);
    }
  }
  return false;
}

/**
 * 陸軍が、指定した海域マスを経路に含むコンボイで land へ到達しうるか。
 *
 * 解決エンジンと同様、経路上の各 Sea マスに少なくとも1隻の艦隊がいるものとみなす。
 * 「この海域を経由する」コンボイが成立しうるかの判定に使う。
 *
 * @param board 盤面
 * @param army 陸軍（type が Army でない場合は false）
 * @param throughSeaProvinceId 経由必須の Sea プロヴィンス（輸送命令を出す艦隊の位置）
 * @param targetLandProvinceId 到達先の陸・沿岸
 * @param adjKeys 隣接ペアの集合
 */
export function canArmyReachLandByConvoyThroughSea(
  board: BoardState,
  army: Unit,
  throughSeaProvinceId: string,
  targetLandProvinceId: string,
  adjKeys: Set<string>,
): boolean {
  if (army.type !== UnitType.Army) {
    return false;
  }
  const provinceById = new Map(board.provinces.map((p) => [p.id, p]));
  const throughP = provinceById.get(throughSeaProvinceId);
  if (!throughP || throughP.areaType !== AreaType.Sea) {
    return false;
  }
  const seasWithFleet = seaProvincesWithFleet(board);
  if (!seasWithFleet.has(throughSeaProvinceId)) {
    return false;
  }
  const sourceId = army.provinceId;
  const targetP = provinceById.get(targetLandProvinceId);
  if (!targetP || targetP.areaType === AreaType.Sea || targetLandProvinceId === sourceId) {
    return false;
  }

  const startSeas: string[] = [];
  for (const p of board.provinces) {
    if (p.areaType !== AreaType.Sea) {
      continue;
    }
    if (!seasWithFleet.has(p.id)) {
      continue;
    }
    if (!adjKeys.has(`${sourceId}->${p.id}`)) {
      continue;
    }
    startSeas.push(p.id);
  }
  if (startSeas.length === 0) {
    return false;
  }

  const goalSeas: string[] = [];
  for (const p of board.provinces) {
    if (p.areaType !== AreaType.Sea) {
      continue;
    }
    if (!seasWithFleet.has(p.id)) {
      continue;
    }
    if (!adjKeys.has(`${p.id}->${targetLandProvinceId}`)) {
      continue;
    }
    goalSeas.push(p.id);
  }
  if (goalSeas.length === 0) {
    return false;
  }

  const fromStartToThrough = seaBfsReachableFrom(
    board,
    startSeas,
    seasWithFleet,
    adjKeys,
    throughSeaProvinceId,
  );
  if (!fromStartToThrough) {
    return false;
  }
  return goalSeas.some((g) =>
    seaBfsReachableFrom(board, [throughSeaProvinceId], seasWithFleet, adjKeys, g),
  );
}

/**
 * 輸送命令 UI 用: 当該艦隊がコンボイ経路に組み込みうる陸軍の unit ID 一覧。
 *
 * 艦隊が Sea にいない場合は空。各陸軍について、当該艦隊の海域を経由する
 * 非隣接コンボイ移動先が1つ以上あるときのみ候補に含める。
 *
 * @param board 盤面
 * @param convoyingFleet 輸送命令を出す艦隊
 * @param adjKeys 隣接ペアの集合
 */
export function getConvoyOrderCandidateArmyIds(
  board: BoardState,
  convoyingFleet: Unit,
  adjKeys: Set<string>,
): string[] {
  if (convoyingFleet.type !== UnitType.Fleet) {
    return [];
  }
  const fp = board.provinces.find((p) => p.id === convoyingFleet.provinceId);
  if (!fp || fp.areaType !== AreaType.Sea) {
    return [];
  }
  const seaId = convoyingFleet.provinceId;
  const out: string[] = [];
  for (const u of board.units) {
    if (u.type !== UnitType.Army || u.id === convoyingFleet.id) {
      continue;
    }
    let ok = false;
    for (const p of board.provinces) {
      if (p.areaType === AreaType.Sea || p.id === u.provinceId) {
        continue;
      }
      if (
        isDirectMoveValid(u, u.provinceId, p.id, board, adjKeys, {
          mode: 'ui',
        })
      ) {
        continue;
      }
      if (canArmyReachLandByConvoyThroughSea(board, u, seaId, p.id, adjKeys)) {
        ok = true;
        break;
      }
    }
    if (ok) {
      out.push(u.id);
    }
  }
  return out;
}

/**
 * 輸送命令 UI 用: 指定艦隊＋陸軍の組み合わせで選べる輸送先（陸・沿岸）を返す。
 *
 * 解決時にコンボイ移動候補となる移動（隣接移動ではない）に限る。
 *
 * @param board 盤面
 * @param convoyingFleet 輸送命令を出す艦隊
 * @param army 輸送される陸軍
 * @param adjKeys 隣接ペアの集合
 * @returns プロヴィンス一覧（名称ソート済み）
 */
export function getConvoyOrderDestinationProvinces(
  board: BoardState,
  convoyingFleet: Unit,
  army: Unit,
  adjKeys: Set<string>,
): Province[] {
  if (
    convoyingFleet.type !== UnitType.Fleet ||
    army.type !== UnitType.Army
  ) {
    return [];
  }
  const fp = board.provinces.find((p) => p.id === convoyingFleet.provinceId);
  if (!fp || fp.areaType !== AreaType.Sea) {
    return [];
  }
  const seaId = convoyingFleet.provinceId;
  const ids = new Set<string>();
  for (const p of board.provinces) {
    if (p.areaType === AreaType.Sea || p.id === army.provinceId) {
      continue;
    }
    if (
      isDirectMoveValid(army, army.provinceId, p.id, board, adjKeys, {
        mode: 'ui',
      })
    ) {
      continue;
    }
    if (canArmyReachLandByConvoyThroughSea(board, army, seaId, p.id, adjKeys)) {
      ids.add(p.id);
    }
  }
  return board.provinces
    .filter((p) => ids.has(p.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
}

/**
 * 移動成功後の艦隊の fleetCoast を決定する（陸軍は undefined）
 */
export function resolveFleetCoastAfterMove(
  unit: Unit,
  fromId: string,
  toId: string,
  targetFleetCoast: FleetCoast | undefined,
): FleetCoast | undefined {
  if (unit.type !== UnitType.Fleet) {
    return undefined;
  }
  if (!isSplitProvince(toId)) {
    return undefined;
  }
  const coasts = fleetArrivalCoasts(toId, fromId);
  if (coasts.length === 1) {
    return coasts[0];
  }
  return targetFleetCoast;
}
