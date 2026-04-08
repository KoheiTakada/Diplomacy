/**
 * 解決ログ・地図演出の表示順を組み立てる
 *
 * 概要:
 *   ルールエンジンの orderResolutions を、因果関係と勢力順（国順）を保ちつつ並べ替え、
 *   支援カット用の暫定ステップを差し込む。
 *
 * 主なルール:
 *   - 移動成功: 空けるマスから去る移動（例: B→C）を、そこへ入る移動（A→B）より先に表示
 *   - スタンドオフ等: 同一目標への衝突失敗を、同勢力ブロック失敗より先にまとめる
 *   - 支援成功: 対応する移動／ホールド行の直前に支援解決行を置く
 *   - 支援カット: 暫定支援線 → カットとなる攻撃移動 → 支援失敗（線は revoke）
 *
 * 制限:
 *   - エンジンの成否・メッセージ文字列に依存する分類がある（MVP 前提）
 */

import {
  type AdjudicationResult,
  type BoardState,
  type MoveOrder,
  type Order,
  type OrderResolution,
  OrderType,
  type SupportOrder,
} from './domain';

/** 支援線 revoke 用のペア */
export type SupportLinkPair = {
  supporterUnitId: string;
  supportedUnitId: string;
};

export type RevealTimelineStep =
  | {
      kind: 'resolution';
      r: OrderResolution;
      revokeSupportLinksBefore?: SupportLinkPair[];
    }
  | { kind: 'tentativeSupportCut'; sup: SupportOrder };

type MovePiece =
  | { kind: 'single'; main: OrderResolution }
  | { kind: 'bundle'; main: OrderResolution; dislodgedHold: OrderResolution };

type CutGroup = {
  supportOrders: SupportOrder[];
  failResolutions: OrderResolution[];
  cuttingMoves: MoveOrder[];
  pieceIndices: number[];
  anchorPos: number;
};

function moveKey(m: MoveOrder): string {
  return `${m.unitId}|${m.sourceProvinceId}|${m.targetProvinceId}`;
}

function pieceMain(p: MovePiece): OrderResolution {
  return p.main;
}

function pieceMainMove(p: MovePiece): MoveOrder {
  return p.main.order as MoveOrder;
}

function powerRank(
  unitId: string,
  board: BoardState,
  powerOrder: readonly string[],
): number {
  const u = board.units.find((x) => x.id === unitId);
  const p = u?.powerId ?? '';
  const ix = powerOrder.indexOf(p);
  return ix >= 0 ? ix : 999;
}

function compareUnitIds(
  a: string,
  b: string,
  board: BoardState,
  powerOrder: readonly string[],
): number {
  const ra = powerRank(a, board, powerOrder);
  const rb = powerRank(b, board, powerOrder);
  if (ra !== rb) {
    return ra - rb;
  }
  return a.localeCompare(b);
}

/**
 * 隣接・地形チェック以前の「無効」失敗（戦闘解決に入らなかった移動）
 */
function isMoveValidationFailure(r: OrderResolution): boolean {
  if (r.order.type !== OrderType.Move || r.success) {
    return false;
  }
  const m = r.message;
  if (m.includes('スタンドオフ')) {
    return false;
  }
  if (m.includes('同勢力のユニットが先にそのマスを空けていません')) {
    return false;
  }
  return (
    m.includes('無効な移動') ||
    m.includes('陸軍は海エリアに移動できません') ||
    m.includes('海軍は内陸エリアに移動できません') ||
    m.includes('複数岸への移動では命令で到着岸') ||
    m.includes('その都市に残留しています')
  );
}

function isFriendBlockFail(r: OrderResolution): boolean {
  return (
    r.order.type === OrderType.Move &&
    !r.success &&
    r.message.includes('同勢力のユニットが先にそのマスを空けていません')
  );
}

function isStandoffFail(r: OrderResolution): boolean {
  return (
    r.order.type === OrderType.Move &&
    !r.success &&
    r.message.includes('スタンドオフ')
  );
}

function buildMovePieces(resolutions: OrderResolution[]): MovePiece[] {
  const pieces: MovePiece[] = [];
  const skip = new Set<number>();
  for (let i = 0; i < resolutions.length; i++) {
    if (skip.has(i)) {
      continue;
    }
    const r = resolutions[i];
    if (r.order.type !== OrderType.Move) {
      continue;
    }
    const next = resolutions[i + 1];
    if (
      r.success &&
      next?.order.type === OrderType.Hold &&
      !next.success &&
      next.message.includes('押し出され')
    ) {
      pieces.push({ kind: 'bundle', main: r, dislodgedHold: next });
      skip.add(i + 1);
    } else {
      pieces.push({ kind: 'single', main: r });
    }
  }
  return pieces;
}

/**
 * エンジンの isSupportCut と同趣旨: この攻撃が支援をカットするか
 */
function wouldAttackCutSupport(
  m: MoveOrder,
  s: SupportOrder,
  board: BoardState,
): boolean {
  const supUnit = board.units.find((u) => u.id === s.unitId);
  if (!supUnit) {
    return false;
  }
  if (m.targetProvinceId !== supUnit.provinceId) {
    return false;
  }
  const isMoveSupport = s.fromProvinceId !== s.toProvinceId;
  return !isMoveSupport || m.sourceProvinceId !== s.toProvinceId;
}

function cuttingMovesForSupport(
  s: SupportOrder,
  domainOrders: Order[],
  board: BoardState,
): MoveOrder[] {
  const out: MoveOrder[] = [];
  for (const o of domainOrders) {
    if (o.type !== OrderType.Move) {
      continue;
    }
    if (!wouldAttackCutSupport(o, s, board)) {
      continue;
    }
    out.push(o);
  }
  return out;
}

function cuttingMovesGroupKey(moves: MoveOrder[]): string {
  return [...moves]
    .map((m) => moveKey(m))
    .sort()
    .join(';;');
}

function insertSortedUnique(
  arr: number[],
  v: number,
  compare: (a: number, b: number) => number,
): void {
  if (arr.includes(v)) {
    return;
  }
  arr.push(v);
  arr.sort(compare);
}

/**
 * 戦闘フェーズの移動ピース間の依存を解き、国順でタイブレークした並びを返す。
 */
function topologicalMovePieces(
  combatPieces: MovePiece[],
  labelBoard: BoardState,
  powerOrder: readonly string[],
): number[] {
  const n = combatPieces.length;
  if (n === 0) {
    return [];
  }
  const adj: number[][] = Array.from({ length: n }, () => []);
  const indeg = new Array(n).fill(0);

  const addEdge = (from: number, to: number): void => {
    adj[from].push(to);
    indeg[to] += 1;
  };

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) {
        continue;
      }
      const pi = pieceMainMove(combatPieces[i]);
      const pj = pieceMainMove(combatPieces[j]);
      if (!pieceMain(combatPieces[i]).success || !pieceMain(combatPieces[j]).success) {
        continue;
      }
      if (pi.targetProvinceId !== pj.sourceProvinceId) {
        continue;
      }
      const uj = labelBoard.units.find((u) => u.id === pj.unitId);
      if (uj?.provinceId !== pj.sourceProvinceId) {
        continue;
      }
      // j が i より先（j が空けてから i が入る）
      addEdge(j, i);
    }
  }

  for (let pIdx = 0; pIdx < n; pIdx++) {
    const P = combatPieces[pIdx];
    const main = pieceMain(P);
    if (!isFriendBlockFail(main)) {
      continue;
    }
    const dest = (main.order as MoveOrder).targetProvinceId;
    const occ = labelBoard.units.find((u) => u.provinceId === dest);
    if (occ == null) {
      continue;
    }
    const qIdx = combatPieces.findIndex(
      (cp) => pieceMainMove(cp).unitId === occ.id,
    );
    if (qIdx >= 0) {
      addEdge(qIdx, pIdx);
    }
  }

  const cmpIdx = (a: number, b: number): number =>
    compareUnitIds(
      pieceMainMove(combatPieces[a]).unitId,
      pieceMainMove(combatPieces[b]).unitId,
      labelBoard,
      powerOrder,
    );

  const ready: number[] = [];
  for (let i = 0; i < n; i++) {
    if (indeg[i] === 0) {
      ready.push(i);
    }
  }
  ready.sort(cmpIdx);

  const out: number[] = [];
  while (ready.length > 0) {
    const u = ready.shift()!;
    out.push(u);
    for (const v of adj[u]) {
      indeg[v] -= 1;
      if (indeg[v] === 0) {
        let lo = 0;
        let hi = ready.length;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (cmpIdx(v, ready[mid]) < 0) {
            hi = mid;
          } else {
            lo = mid + 1;
          }
        }
        ready.splice(lo, 0, v);
      }
    }
  }

  if (out.length < n) {
    const rest: number[] = [];
    for (let i = 0; i < n; i++) {
      if (!out.includes(i)) {
        rest.push(i);
      }
    }
    rest.sort(cmpIdx);
    out.push(...rest);
  }

  return out;
}

function sortStandoffClustersWithinCombatOrder(
  fullTopo: number[],
  combatPieces: MovePiece[],
  labelBoard: BoardState,
  powerOrder: readonly string[],
): number[] {
  let topo = [...fullTopo];
  const cmpIdx = (a: number, b: number): number =>
    compareUnitIds(
      pieceMainMove(combatPieces[a]).unitId,
      pieceMainMove(combatPieces[b]).unitId,
      labelBoard,
      powerOrder,
    );

  const byTarget = new Map<string, number[]>();
  for (const idx of topo) {
    const main = pieceMain(combatPieces[idx]);
    if (!isStandoffFail(main)) {
      continue;
    }
    const t = pieceMainMove(combatPieces[idx]).targetProvinceId;
    const arr = byTarget.get(t) ?? [];
    arr.push(idx);
    byTarget.set(t, arr);
  }

  for (const [, members] of byTarget) {
    if (members.length < 2) {
      continue;
    }
    const posMap = new Map(topo.map((idx, i) => [idx, i]));
    const minPos = Math.min(...members.map((m) => posMap.get(m) ?? 0));
    const sortedMembers = [...members].sort(cmpIdx);
    const without = topo.filter((x) => !members.includes(x));
    const head = without.slice(0, minPos);
    const tail = without.slice(minPos);
    topo = [...head, ...sortedMembers, ...tail];
  }

  return topo;
}

function matchSupportToMove(
  sup: SupportOrder,
  mv: MoveOrder,
): boolean {
  return (
    sup.supportedUnitId === mv.unitId &&
    sup.fromProvinceId === mv.sourceProvinceId &&
    sup.toProvinceId === mv.targetProvinceId
  );
}

function findResolutionForSupport(
  resolutions: OrderResolution[],
  sup: SupportOrder,
): OrderResolution | undefined {
  return resolutions.find(
    (res) =>
      res.order.type === OrderType.Support &&
      res.order.unitId === sup.unitId &&
      res.order.supportedUnitId === sup.supportedUnitId &&
      res.order.fromProvinceId === sup.fromProvinceId &&
      res.order.toProvinceId === sup.toProvinceId,
  );
}

function convoysForMove(
  move: MoveOrder,
  convoyPool: OrderResolution[],
  used: Set<OrderResolution>,
  labelBoard: BoardState,
  powerOrder: readonly string[],
): OrderResolution[] {
  const matches = convoyPool.filter(
    (c) =>
      !used.has(c) &&
      c.order.type === OrderType.Convoy &&
      c.order.armyUnitId === move.unitId &&
      c.order.fromProvinceId === move.sourceProvinceId &&
      c.order.toProvinceId === move.targetProvinceId,
  );
  matches.sort((a, b) =>
    compareUnitIds(a.order.unitId, b.order.unitId, labelBoard, powerOrder),
  );
  return matches;
}

function emitPieceSteps(
  piece: MovePiece,
  labelBoard: BoardState,
  domainOrders: Order[],
  allResolutions: OrderResolution[],
  powerOrder: readonly string[],
  supportSuccessPool: OrderResolution[],
  convoyPool: OrderResolution[],
  usedConvoys: Set<OrderResolution>,
  revokeBefore?: SupportLinkPair[],
): RevealTimelineStep[] {
  const steps: RevealTimelineStep[] = [];
  const mv = pieceMainMove(piece);

  const convoys = convoysForMove(
    mv,
    convoyPool,
    usedConvoys,
    labelBoard,
    powerOrder,
  );
  for (const c of convoys) {
    usedConvoys.add(c);
    steps.push({ kind: 'resolution', r: c });
  }

  if (piece.main.success) {
    for (const o of domainOrders) {
      if (o.type !== OrderType.Support) {
        continue;
      }
      if (!matchSupportToMove(o, mv)) {
        continue;
      }
      const sr = findResolutionForSupport(allResolutions, o);
      if (sr?.success) {
        const ix = supportSuccessPool.indexOf(sr);
        if (ix >= 0) {
          supportSuccessPool.splice(ix, 1);
        }
        steps.push({ kind: 'resolution', r: sr });
      }
    }
  }

  steps.push({
    kind: 'resolution',
    r: piece.main,
    revokeSupportLinksBefore: revokeBefore,
  });
  if (piece.kind === 'bundle') {
    steps.push({ kind: 'resolution', r: piece.dislodgedHold });
  }
  return steps;
}

/**
 * 解決表示用のタイムラインを構築する。
 *
 * @param labelBoard - 解決直前盤面
 * @param domainOrders - 当ターンの全命令
 * @param result - adjudicateTurn の戻り値
 * @param powerOrder - 勢力の表示優先順（標準7大国など）
 */
export function buildResolutionRevealTimeline(
  labelBoard: BoardState,
  domainOrders: Order[],
  result: AdjudicationResult,
  powerOrder: readonly string[],
): RevealTimelineStep[] {
  const resolutions = result.orderResolutions;
  const steps: RevealTimelineStep[] = [];
  const used = new Set<number>();
  const powerByUnitId = new Map(labelBoard.units.map((u) => [u.id, u.powerId]));
  const powerOf = (unitId: string): string => powerByUnitId.get(unitId) ?? '';
  const rankOf = (unitId: string): number => {
    const p = powerOf(unitId);
    const i = powerOrder.indexOf(p);
    return i >= 0 ? i : 999;
  };
  const moveIndexByKey = new Map<string, number>();
  const dislodgedHoldByMoveIndex = new Map<number, number>();
  const dislodgingMoveByUnitId = new Map<string, number>();

  for (let i = 0; i < resolutions.length; i += 1) {
    const r = resolutions[i];
    if (r.order.type === OrderType.Move) {
      moveIndexByKey.set(moveKey(r.order), i);
      const nxt = resolutions[i + 1];
      if (
        nxt &&
        nxt.order.type === OrderType.Hold &&
        !nxt.success &&
        nxt.message.includes('押し出され')
      ) {
        dislodgedHoldByMoveIndex.set(i, i + 1);
        dislodgingMoveByUnitId.set(resolutions[i + 1].order.unitId, i);
      }
    }
  }

  const supportSuccessByMoveKey = new Map<string, number[]>();
  const supportSuccessByHoldUnitId = new Map<string, number[]>();
  for (let i = 0; i < resolutions.length; i += 1) {
    const r = resolutions[i];
    if (r.order.type !== OrderType.Support || !r.success) {
      continue;
    }
    const s = r.order;
    if (s.fromProvinceId === s.toProvinceId) {
      const arr = supportSuccessByHoldUnitId.get(s.supportedUnitId) ?? [];
      arr.push(i);
      supportSuccessByHoldUnitId.set(s.supportedUnitId, arr);
    } else {
      const k = `${s.supportedUnitId}|${s.fromProvinceId}|${s.toProvinceId}`;
      const arr = supportSuccessByMoveKey.get(k) ?? [];
      arr.push(i);
      supportSuccessByMoveKey.set(k, arr);
    }
  }

  const convoySuccessByMoveKey = new Map<string, number[]>();
  for (let i = 0; i < resolutions.length; i += 1) {
    const r = resolutions[i];
    if (r.order.type !== OrderType.Convoy) {
      continue;
    }
    if (!r.success) {
      continue;
    }
    const c = r.order;
    const k = `${c.armyUnitId}|${c.fromProvinceId}|${c.toProvinceId}`;
    const arr = convoySuccessByMoveKey.get(k) ?? [];
    arr.push(i);
    convoySuccessByMoveKey.set(k, arr);
  }

  const supportCutFailsByPower = new Map<string, number[]>();
  const supportCutFailByCuttingMove = new Map<number, number[]>();
  const supportCutFailWithoutCuttingMove: number[] = [];

  for (let i = 0; i < resolutions.length; i += 1) {
    const r = resolutions[i];
    if (
      r.order.type !== OrderType.Support ||
      r.success ||
      !r.message.includes('カット')
    ) {
      continue;
    }
    const supportPower = powerOf(r.order.unitId);
    const arr = supportCutFailsByPower.get(supportPower) ?? [];
    arr.push(i);
    supportCutFailsByPower.set(supportPower, arr);

    const cuttingMoves = cuttingMovesForSupport(r.order, domainOrders, labelBoard);
    const linkedMoveIndices = cuttingMoves
      .map((m) => moveIndexByKey.get(moveKey(m)))
      .filter((x): x is number => x != null);
    if (linkedMoveIndices.length === 0) {
      supportCutFailWithoutCuttingMove.push(i);
      continue;
    }
    for (const mi of linkedMoveIndices) {
      const cur = supportCutFailByCuttingMove.get(mi) ?? [];
      cur.push(i);
      supportCutFailByCuttingMove.set(mi, cur);
    }
  }

  const convoyDisruptedFailByPower = new Map<string, number[]>();
  const convoyDisruptedFailByDislodgingMove = new Map<number, number[]>();
  const convoyDisruptedFailWithoutDislodgingMove: number[] = [];
  for (let i = 0; i < resolutions.length; i += 1) {
    const r = resolutions[i];
    if (r.order.type !== OrderType.Convoy || r.success) {
      continue;
    }
    if (!r.message.includes('輸送艦隊が押し出され輸送妨害')) {
      continue;
    }
    const convoyPower = powerOf(r.order.unitId);
    const arr = convoyDisruptedFailByPower.get(convoyPower) ?? [];
    arr.push(i);
    convoyDisruptedFailByPower.set(convoyPower, arr);

    const dislodgingMoveIndex = dislodgingMoveByUnitId.get(r.order.unitId);
    if (dislodgingMoveIndex == null) {
      convoyDisruptedFailWithoutDislodgingMove.push(i);
      continue;
    }
    const cur = convoyDisruptedFailByDislodgingMove.get(dislodgingMoveIndex) ?? [];
    cur.push(i);
    convoyDisruptedFailByDislodgingMove.set(dislodgingMoveIndex, cur);
  }

  const tentativeSupportCutDone = new Set<number>();
  const emitTentativeSupportCut = (idx: number): void => {
    if (tentativeSupportCutDone.has(idx)) {
      return;
    }
    const r = resolutions[idx];
    if (
      r.order.type !== OrderType.Support ||
      r.success ||
      !r.message.includes('カット')
    ) {
      return;
    }
    steps.push({ kind: 'tentativeSupportCut', sup: r.order });
    tentativeSupportCutDone.add(idx);
  };

  const emitResolution = (idx: number, revoke?: SupportLinkPair[]): void => {
    if (used.has(idx)) {
      return;
    }
    steps.push({
      kind: 'resolution',
      r: resolutions[idx],
      revokeSupportLinksBefore: revoke,
    });
    used.add(idx);
  };

  const emitSupportAndConvoyForMove = (mv: MoveOrder): void => {
    const k = `${mv.unitId}|${mv.sourceProvinceId}|${mv.targetProvinceId}`;
    const supportIdx = supportSuccessByMoveKey.get(k) ?? [];
    supportIdx.sort(
      (a, b) =>
        rankOf(resolutions[a].order.unitId) - rankOf(resolutions[b].order.unitId),
    );
    for (const si of supportIdx) {
      emitResolution(si);
    }
    const convoyIdx = convoySuccessByMoveKey.get(k) ?? [];
    convoyIdx.sort(
      (a, b) =>
        rankOf(resolutions[a].order.unitId) - rankOf(resolutions[b].order.unitId),
    );
    for (const ci of convoyIdx) {
      emitResolution(ci);
    }
  };

  const orderMovesByVacateDependency = (indices: number[]): number[] => {
    if (indices.length <= 1) {
      return indices;
    }
    const idxSet = new Set(indices);
    const sourceToIdx = new Map<string, number>();
    for (const i of indices) {
      const r = resolutions[i];
      if (r.order.type !== OrderType.Move) {
        continue;
      }
      sourceToIdx.set(r.order.sourceProvinceId, i);
    }
    const outEdges = new Map<number, number[]>();
    const indegree = new Map<number, number>();
    for (const i of indices) {
      outEdges.set(i, []);
      indegree.set(i, 0);
    }
    for (const i of indices) {
      const r = resolutions[i];
      if (r.order.type !== OrderType.Move) {
        continue;
      }
      const dep = sourceToIdx.get(r.order.targetProvinceId);
      if (dep == null || dep === i || !idxSet.has(dep)) {
        continue;
      }
      outEdges.get(dep)?.push(i);
      indegree.set(i, (indegree.get(i) ?? 0) + 1);
    }
    const queue = indices.filter((i) => (indegree.get(i) ?? 0) === 0).sort((a, b) => a - b);
    const ordered: number[] = [];
    while (queue.length > 0) {
      const v = queue.shift();
      if (v == null) {
        break;
      }
      ordered.push(v);
      const nxt = outEdges.get(v) ?? [];
      for (const to of nxt) {
        const d = (indegree.get(to) ?? 0) - 1;
        indegree.set(to, d);
        if (d === 0) {
          insertSortedUnique(queue, to, (x, y) => x - y);
        }
      }
    }
    for (const i of indices) {
      if (!ordered.includes(i)) {
        ordered.push(i);
      }
    }
    return ordered;
  };

  const emitMoveWithCoupledFailures = (mi: number): void => {
    const r = resolutions[mi];
    if (r.order.type !== OrderType.Move) {
      return;
    }
    emitSupportAndConvoyForMove(r.order);
    emitResolution(mi);
    const dislodgedHold = dislodgedHoldByMoveIndex.get(mi);
    if (dislodgedHold != null) {
      emitResolution(dislodgedHold);
    }

    const supportCuts = supportCutFailByCuttingMove.get(mi) ?? [];
    supportCuts.sort((a, b) => a - b);
    for (const si of supportCuts) {
      const sr = resolutions[si];
      if (sr.order.type !== OrderType.Support) {
        continue;
      }
      emitResolution(si, [
        {
          supporterUnitId: sr.order.unitId,
          supportedUnitId: sr.order.supportedUnitId,
        },
      ]);
    }

    const convoyDisrupted = convoyDisruptedFailByDislodgingMove.get(mi) ?? [];
    convoyDisrupted.sort((a, b) => a - b);
    for (const ci of convoyDisrupted) {
      emitResolution(ci);
    }
  };

  for (const powerId of powerOrder) {
    const preludeSupportCuts = supportCutFailsByPower.get(powerId) ?? [];
    preludeSupportCuts.sort((a, b) => a - b);
    for (const si of preludeSupportCuts) {
      emitTentativeSupportCut(si);
    }

    const moveIndices = resolutions
      .map((r, i) => ({ r, i }))
      .filter(
        ({ r, i }) =>
          r.order.type === OrderType.Move &&
          powerOf(r.order.unitId) === powerId &&
          !used.has(i),
      )
      .map(({ i }) => i);

    const successMoves = moveIndices.filter((i) => resolutions[i].success);
    const singleSuccess = orderMovesByVacateDependency(
      successMoves.filter((i) => {
        const r = resolutions[i];
        if (r.order.type !== OrderType.Move) {
          return false;
        }
        const k = `${r.order.unitId}|${r.order.sourceProvinceId}|${r.order.targetProvinceId}`;
        return (supportSuccessByMoveKey.get(k)?.length ?? 0) === 0;
      }),
    );
    for (const mi of singleSuccess) {
      emitMoveWithCoupledFailures(mi);
    }
    const supportedNoConflict = orderMovesByVacateDependency(
      successMoves.filter((i) => {
        const r = resolutions[i];
        if (r.order.type !== OrderType.Move) {
          return false;
        }
        const k = `${r.order.unitId}|${r.order.sourceProvinceId}|${r.order.targetProvinceId}`;
        const hasSupport = (supportSuccessByMoveKey.get(k)?.length ?? 0) > 0;
        return hasSupport && !r.message.includes('勝利して移動成功');
      }),
    );
    for (const mi of supportedNoConflict) {
      emitMoveWithCoupledFailures(mi);
    }
    const supportedConflict = orderMovesByVacateDependency(
      successMoves.filter((i) => {
        const r = resolutions[i];
        if (r.order.type !== OrderType.Move) {
          return false;
        }
        const k = `${r.order.unitId}|${r.order.sourceProvinceId}|${r.order.targetProvinceId}`;
        const hasSupport = (supportSuccessByMoveKey.get(k)?.length ?? 0) > 0;
        return hasSupport && r.message.includes('勝利して移動成功');
      }),
    );
    for (const mi of supportedConflict) {
      emitMoveWithCoupledFailures(mi);
    }

    const singleConflict = orderMovesByVacateDependency(
      successMoves.filter((i) => {
        const r = resolutions[i];
        return (
          r.order.type === OrderType.Move &&
          r.message.includes('勝利して移動成功') &&
          (() => {
            const k = `${r.order.unitId}|${r.order.sourceProvinceId}|${r.order.targetProvinceId}`;
            return (supportSuccessByMoveKey.get(k)?.length ?? 0) === 0;
          })()
        );
      }),
    );
    for (const mi of singleConflict) {
      emitMoveWithCoupledFailures(mi);
    }

    const failedMoves = moveIndices.filter(
      (i) => !used.has(i) && resolutions[i].success === false,
    );
    const standoffFails = failedMoves.filter((i) =>
      isStandoffFail(resolutions[i]),
    );
    const friendBlockFails = failedMoves.filter((i) =>
      isFriendBlockFail(resolutions[i]),
    );
    const otherMoveFails = failedMoves.filter(
      (i) => !standoffFails.includes(i) && !friendBlockFails.includes(i),
    );

    const failedMoveBySourceProvince = new Map<string, number>();
    for (const i of failedMoves) {
      const r = resolutions[i];
      if (r.order.type !== OrderType.Move) {
        continue;
      }
      failedMoveBySourceProvince.set(r.order.sourceProvinceId, i);
    }
    const blockerByFriendFail = new Map<number, number>();
    for (const fi of friendBlockFails) {
      const r = resolutions[fi];
      if (r.order.type !== OrderType.Move) {
        continue;
      }
      const blocker = failedMoveBySourceProvince.get(r.order.targetProvinceId);
      if (blocker != null && blocker !== fi) {
        blockerByFriendFail.set(fi, blocker);
      }
    }

    const rootStandoffByFriendFail = new Map<number, number>();
    for (const fi of friendBlockFails) {
      const visited = new Set<number>();
      let cur = fi;
      while (true) {
        const blocker = blockerByFriendFail.get(cur);
        if (blocker == null) {
          break;
        }
        if (visited.has(blocker)) {
          break;
        }
        visited.add(blocker);
        if (standoffFails.includes(blocker)) {
          rootStandoffByFriendFail.set(fi, blocker);
          break;
        }
        cur = blocker;
      }
    }

    const standoffGroupByTarget = new Map<string, number[]>();
    for (const si of standoffFails) {
      const r = resolutions[si];
      if (r.order.type !== OrderType.Move) {
        continue;
      }
      const g = standoffGroupByTarget.get(r.order.targetProvinceId) ?? [];
      g.push(si);
      standoffGroupByTarget.set(r.order.targetProvinceId, g);
    }
    const standoffGroups = [...standoffGroupByTarget.values()].map((g) =>
      g.sort((a, b) => a - b),
    );
    const hasDependentFriendFail = (group: number[]): boolean =>
      friendBlockFails.some((fi) =>
        group.includes(rootStandoffByFriendFail.get(fi) ?? -1),
      );
    const unaffectedStandoffGroups = standoffGroups.filter(
      (g) => !hasDependentFriendFail(g),
    );
    const affectingStandoffGroups = standoffGroups.filter((g) =>
      hasDependentFriendFail(g),
    );

    for (const group of unaffectedStandoffGroups) {
      for (const si of group) {
        emitMoveWithCoupledFailures(si);
      }
    }
    for (const group of affectingStandoffGroups) {
      for (const si of group) {
        emitMoveWithCoupledFailures(si);
      }
      const relatedFriendFails = friendBlockFails
        .filter((fi) => group.includes(rootStandoffByFriendFail.get(fi) ?? -1))
        .sort((a, b) => a - b);
      for (const fi of relatedFriendFails) {
        emitMoveWithCoupledFailures(fi);
      }
    }

    for (const fi of friendBlockFails) {
      if (!used.has(fi) && !rootStandoffByFriendFail.has(fi)) {
        emitMoveWithCoupledFailures(fi);
      }
    }
    for (const oi of otherMoveFails.sort((a, b) => a - b)) {
      if (!used.has(oi)) {
        emitMoveWithCoupledFailures(oi);
      }
    }

    const supportOwn = resolutions
      .map((r, i) => ({ r, i }))
      .filter(
        ({ r, i }) =>
          r.order.type === OrderType.Support &&
          powerOf(r.order.unitId) === powerId &&
          !used.has(i),
      )
      .sort((a, b) => a.i - b.i);
    for (const { i } of supportOwn) {
      const r = resolutions[i];
      if (r.order.type === OrderType.Support && !r.success && r.message.includes('カット')) {
        continue;
      }
      if (r.order.type === OrderType.Support && !r.success && r.message.includes('一致しません')) {
        continue;
      }
      emitResolution(i);
    }

    const convoyOwn = resolutions
      .map((r, i) => ({ r, i }))
      .filter(
        ({ r, i }) =>
          r.order.type === OrderType.Convoy &&
          powerOf(r.order.unitId) === powerId &&
          !used.has(i),
      )
      .sort((a, b) => a.i - b.i);
    for (const { i } of convoyOwn) {
      const r = resolutions[i];
      if (
        r.order.type === OrderType.Convoy &&
        !r.success &&
        r.message.includes('輸送艦隊が押し出され輸送妨害')
      ) {
        continue;
      }
      emitResolution(i);
    }

    const holdOwn = resolutions
      .map((r, i) => ({ r, i }))
      .filter(
        ({ r, i }) =>
          r.order.type === OrderType.Hold &&
          powerOf(r.order.unitId) === powerId &&
          !used.has(i),
      )
      .sort((a, b) => a.i - b.i);
    for (const { r, i } of holdOwn) {
      if (r.success) {
        const hs = supportSuccessByHoldUnitId.get(r.order.unitId) ?? [];
        hs.sort((a, b) => rankOf(resolutions[a].order.unitId) - rankOf(resolutions[b].order.unitId));
        for (const si of hs) {
          emitResolution(si);
        }
      }
      emitResolution(i);
    }

    const convoyDisruptedOwn = convoyDisruptedFailByPower.get(powerId) ?? [];
    convoyDisruptedOwn.sort((a, b) => a - b);
    for (const ci of convoyDisruptedOwn) {
      if (!used.has(ci)) {
        emitResolution(ci);
      }
    }

    const supportMismatchOwn = resolutions
      .map((r, i) => ({ r, i }))
      .filter(
        ({ r, i }) =>
          r.order.type === OrderType.Support &&
          powerOf(r.order.unitId) === powerId &&
          !used.has(i) &&
          !r.success &&
          r.message.includes('一致しません'),
      )
      .sort((a, b) => a.i - b.i);
    for (const { i } of supportMismatchOwn) {
      emitResolution(i);
    }
  }

  supportCutFailWithoutCuttingMove.sort((a, b) => a - b);
  for (const si of supportCutFailWithoutCuttingMove) {
    if (used.has(si)) {
      continue;
    }
    const r = resolutions[si];
    if (r.order.type !== OrderType.Support) {
      continue;
    }
    emitTentativeSupportCut(si);
    emitResolution(si, [
      {
        supporterUnitId: r.order.unitId,
        supportedUnitId: r.order.supportedUnitId,
      },
    ]);
  }

  convoyDisruptedFailWithoutDislodgingMove.sort((a, b) => a - b);
  for (const ci of convoyDisruptedFailWithoutDislodgingMove) {
    if (!used.has(ci)) {
      emitResolution(ci);
    }
  }

  for (let i = 0; i < resolutions.length; i += 1) {
    if (!used.has(i)) {
      emitResolution(i);
    }
  }

  return steps;
}
