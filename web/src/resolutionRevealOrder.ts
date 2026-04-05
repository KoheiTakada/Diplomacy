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
  if (m.includes('スタンドオフまたは防御力不足')) {
    return false;
  }
  return (
    m.includes('無効な移動') ||
    m.includes('陸軍は海エリアに移動できません') ||
    m.includes('海軍は純粋な陸エリアに移動できません') ||
    m.includes('複数岸への移動では命令で到着岸') ||
    m.includes('そのプロヴィンスに残留しています')
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

  const supportSuccessPool = resolutions.filter(
    (r) => r.order.type === OrderType.Support && r.success,
  );
  const convoyPool = resolutions.filter((r) => r.order.type === OrderType.Convoy);
  const usedConvoys = new Set<OrderResolution>();

  const allMovePieces = buildMovePieces(resolutions);
  const validationPieces = allMovePieces.filter((p) =>
    isMoveValidationFailure(p.main),
  );
  const combatPieces = allMovePieces.filter(
    (p) => !isMoveValidationFailure(p.main),
  );

  const validationSorted = [...validationPieces].sort((a, b) =>
    compareUnitIds(
      pieceMainMove(a).unitId,
      pieceMainMove(b).unitId,
      labelBoard,
      powerOrder,
    ),
  );
  for (const p of validationSorted) {
    steps.push(
      ...emitPieceSteps(
        p,
        labelBoard,
        domainOrders,
        resolutions,
        powerOrder,
        supportSuccessPool,
        convoyPool,
        usedConvoys,
      ),
    );
  }

  let fullTopo = topologicalMovePieces(
    combatPieces,
    labelBoard,
    powerOrder,
  );
  fullTopo = sortStandoffClustersWithinCombatOrder(
    fullTopo,
    combatPieces,
    labelBoard,
    powerOrder,
  );

  const cutFailRes = resolutions.filter(
    (r) =>
      r.order.type === OrderType.Support &&
      !r.success &&
      r.message.includes('カット'),
  );

  const cutGroupMap = new Map<string, CutGroup>();
  for (const fr of cutFailRes) {
    const s = fr.order as SupportOrder;
    const cms = cuttingMovesForSupport(s, domainOrders, labelBoard);
    const gkey = cuttingMovesGroupKey(cms);
    let g = cutGroupMap.get(gkey);
    if (g == null) {
      g = {
        supportOrders: [],
        failResolutions: [],
        cuttingMoves: cms,
        pieceIndices: [],
        anchorPos: 0,
      };
      cutGroupMap.set(gkey, g);
    }
    g.supportOrders.push(s);
    g.failResolutions.push(fr);
  }

  for (const g of cutGroupMap.values()) {
    g.supportOrders.sort((a, b) =>
      compareUnitIds(a.unitId, b.unitId, labelBoard, powerOrder),
    );
    g.failResolutions.sort((a, b) =>
      compareUnitIds(a.order.unitId, b.order.unitId, labelBoard, powerOrder),
    );
    for (const m of g.cuttingMoves) {
      const pIdx = combatPieces.findIndex(
        (cp) => moveKey(pieceMainMove(cp)) === moveKey(m),
      );
      if (pIdx >= 0) {
        insertSortedUnique(
          g.pieceIndices,
          pIdx,
          (a, b) =>
            compareUnitIds(
              pieceMainMove(combatPieces[a]).unitId,
              pieceMainMove(combatPieces[b]).unitId,
              labelBoard,
              powerOrder,
            ),
        );
      }
    }
    if (g.pieceIndices.length > 0) {
      const positions = g.pieceIndices.map((pi) => fullTopo.indexOf(pi));
      g.anchorPos = Math.min(...positions.filter((x) => x >= 0));
    } else {
      g.anchorPos = 0;
    }
  }

  const cuttingPieceSet = new Set<number>();
  for (const g of cutGroupMap.values()) {
    for (const pi of g.pieceIndices) {
      cuttingPieceSet.add(pi);
    }
  }

  const cutChunks = [...cutGroupMap.values()].sort(
    (a, b) => a.anchorPos - b.anchorPos,
  );

  const merged: Array<MovePiece | { cut: CutGroup }> = [];
  for (let pos = 0; pos < fullTopo.length; pos++) {
    const chunkHere = cutChunks.filter((c) => c.anchorPos === pos);
    for (const cg of chunkHere) {
      merged.push({ cut: cg });
    }
    const pIdx = fullTopo[pos];
    if (cuttingPieceSet.has(pIdx)) {
      continue;
    }
    merged.push(combatPieces[pIdx]);
  }

  for (const item of merged) {
    if ('cut' in item) {
      const cg = item.cut;
      const pairs: SupportLinkPair[] = cg.supportOrders.map((s) => ({
        supporterUnitId: s.unitId,
        supportedUnitId: s.supportedUnitId,
      }));
      for (const s of cg.supportOrders) {
        steps.push({ kind: 'tentativeSupportCut', sup: s });
      }
      if (cg.pieceIndices.length > 0) {
        const sortedPi = [...cg.pieceIndices].sort((a, b) =>
          compareUnitIds(
            pieceMainMove(combatPieces[a]).unitId,
            pieceMainMove(combatPieces[b]).unitId,
            labelBoard,
            powerOrder,
          ),
        );
        sortedPi.forEach((pi, idx) => {
          const p = combatPieces[pi];
          steps.push(
            ...emitPieceSteps(
              p,
              labelBoard,
              domainOrders,
              resolutions,
              powerOrder,
              supportSuccessPool,
              convoyPool,
              usedConvoys,
              idx === 0 ? pairs : undefined,
            ),
          );
        });
      }
      for (const fr of cg.failResolutions) {
        const needRevoke =
          cg.pieceIndices.length === 0 ? pairs : undefined;
        steps.push({
          kind: 'resolution',
          r: fr,
          revokeSupportLinksBefore: needRevoke,
        });
      }
    } else {
      steps.push(
        ...emitPieceSteps(
          item,
          labelBoard,
          domainOrders,
          resolutions,
          powerOrder,
          supportSuccessPool,
          convoyPool,
          usedConvoys,
        ),
      );
    }
  }

  for (const c of convoyPool) {
    if (!usedConvoys.has(c)) {
      steps.push({ kind: 'resolution', r: c });
    }
  }

  const supportFailOther = resolutions.filter(
    (r) =>
      r.order.type === OrderType.Support &&
      !r.success &&
      !r.message.includes('カット'),
  );
  supportFailOther.sort((a, b) =>
    compareUnitIds(a.order.unitId, b.order.unitId, labelBoard, powerOrder),
  );
  for (const r of supportFailOther) {
    steps.push({ kind: 'resolution', r });
  }

  const holdRows = resolutions.filter((r, i, arr) => {
    if (r.order.type !== OrderType.Hold) {
      return false;
    }
    const prev = arr[i - 1];
    if (
      prev?.order.type === OrderType.Move &&
      prev.success &&
      !r.success &&
      r.message.includes('押し出され')
    ) {
      return false;
    }
    return true;
  });
  holdRows.sort((a, b) =>
    compareUnitIds(a.order.unitId, b.order.unitId, labelBoard, powerOrder),
  );

  for (const hr of holdRows) {
    const hid = hr.order.unitId;
    const hu = labelBoard.units.find((u) => u.id === hid);
    const hProv = hu?.provinceId ?? '';
    for (const o of domainOrders) {
      if (o.type !== OrderType.Support) {
        continue;
      }
      if (o.supportedUnitId !== hid) {
        continue;
      }
      if (o.fromProvinceId !== hProv || o.toProvinceId !== hProv) {
        continue;
      }
      const sr = findResolutionForSupport(resolutions, o);
      if (sr?.success) {
        const ix = supportSuccessPool.indexOf(sr);
        if (ix >= 0) {
          supportSuccessPool.splice(ix, 1);
        }
        steps.push({ kind: 'resolution', r: sr });
      }
    }
    steps.push({ kind: 'resolution', r: hr });
  }

  for (const leftover of supportSuccessPool) {
    steps.push({ kind: 'resolution', r: leftover });
  }

  return steps;
}
