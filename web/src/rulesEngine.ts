/**
 * ディプロマシー支援ツール用ルールエンジン（MVP版）
 *
 * 概要:
 *   BoardState と Order 一覧から、1ターン分の解決結果を計算する。
 *
 * 対応範囲(MVP):
 *   - Move / Hold / Support / Convoy
 *   - スタンドオフ（バウンス）
 *   - 支援カット
 *   - サプライセンター数に基づく増産/削減のための所有状況更新
 *
 * 制限事項:
 *   - 退却・調整は UI と連携した盤面更新で扱う。本関数は移動解決とターン進行まで。
 *   - 支援カットは「目的地からの攻撃は除外」を反映。公式の全例外は未カバー。
 */

import {
  AdjudicationResult,
  AreaType,
  BoardState,
  ConvoyOrder,
  DislodgedUnit,
  MoveOrder,
  nextProvinceControlTint,
  Order,
  OrderResolution,
  OrderType,
  Season,
  SupportOrder,
  type TurnInfo,
  Unit,
  UnitType,
} from './domain';
import {
  buildAdjacencyKeySet,
  fleetArrivalCoasts,
  fleetCoastalPairSharesSea,
  isDirectMoveValid,
  isSplitProvince,
  resolveFleetCoastAfterMove,
  supplyCenterKeyForProvince,
} from './mapMovement';

/** 移動解決用: 攻撃命令と支援込みの強さ */
type MoveAttack = {
  order: MoveOrder;
  power: number;
};

type SupportKey = string;

function supportKeyOf(s: SupportOrder): SupportKey {
  return `${s.unitId}|${s.supportedUnitId}|${s.fromProvinceId}|${s.toProvinceId}`;
}

function setEqualsByKey<T>(a: Set<T>, b: Set<T>, toKey: (x: T) => string): boolean {
  if (a.size !== b.size) {
    return false;
  }
  const keys = new Set<string>();
  for (const x of a) {
    keys.add(toKey(x));
  }
  for (const y of b) {
    if (!keys.has(toKey(y))) {
      return false;
    }
  }
  return true;
}

/**
 * 検証を通過した移動命令ごとに成否を固定点計算で求める。
 *
 * 概要:
 *   ターン開始時の占有者が「検証済みの移動命令で去る」場合のみマスが空く。
 *   検証落ちした命令（例: 同勢力残留で不可）があっても、従来は「target から出る命令がある」
 *   だけで空き扱いになっていたバグを防ぐ。
 *
 * @param board ターン開始の盤面
 * @param moveOrders 全 Move 命令
 * @param movesByTarget 検証通過した移動のみ、目的地ごとの攻撃リスト
 * @param unitById ユニットID→ユニット
 * @returns 各移動命令の成否
 */
function resolveMoveSuccessMap(
  board: BoardState,
  moveOrders: MoveOrder[],
  movesByTarget: Map<string, MoveAttack[]>,
  unitById: Map<string, Unit>,
): Map<MoveOrder, boolean> {
  const validated = new Set<MoveOrder>();
  for (const arr of movesByTarget.values()) {
    for (const x of arr) {
      validated.add(x.order);
    }
  }

  const outcome = new Map<MoveOrder, boolean | undefined>();
  for (const arr of movesByTarget.values()) {
    for (const x of arr) {
      outcome.set(x.order, undefined);
    }
  }

  for (let iter = 0; iter < 80; iter += 1) {
    let changed = false;

    for (const [target, moves] of movesByTarget.entries()) {
      if (moves.length === 1) {
        const { order: move, power } = moves[0];
        if (outcome.get(move) !== undefined) {
          continue;
        }
        const attacker = unitById.get(move.unitId);
        if (!attacker) {
          outcome.set(move, false);
          changed = true;
          continue;
        }
        const occ = board.units.find((u) => u.provinceId === target);

        if (!occ) {
          outcome.set(move, power > 0);
          changed = true;
          continue;
        }
        if (occ.id === move.unitId) {
          outcome.set(move, false);
          changed = true;
          continue;
        }

        if (occ.powerId === attacker.powerId) {
          const occMove = moveOrders.find(
            (o) =>
              o.type === OrderType.Move &&
              o.unitId === occ.id &&
              o.sourceProvinceId === target,
          );
          const isSwap =
            occMove != null &&
            occMove.targetProvinceId === move.sourceProvinceId &&
            occMove.targetProvinceId !== occMove.sourceProvinceId;

          if (isSwap && validated.has(move) && occMove != null && validated.has(occMove)) {
            const a = outcome.get(move);
            const b = outcome.get(occMove);
            if (a === false || b === false) {
              outcome.set(move, false);
              outcome.set(occMove, false);
              changed = true;
            } else if (a === undefined && b === undefined) {
              outcome.set(move, true);
              outcome.set(occMove, true);
              changed = true;
            } else if (a === true && b === undefined) {
              outcome.set(occMove, true);
              changed = true;
            } else if (b === true && a === undefined) {
              outcome.set(move, true);
              changed = true;
            }
          } else {
            if (
              !occMove ||
              occMove.targetProvinceId === target ||
              !validated.has(occMove)
            ) {
              outcome.set(move, false);
              changed = true;
            } else {
              const os = outcome.get(occMove);
              if (os === false) {
                outcome.set(move, false);
                changed = true;
              } else if (os === true) {
                outcome.set(move, power > 0);
                changed = true;
              }
            }
          }
        } else {
          const om = moveOrders.find(
            (o) =>
              o.type === OrderType.Move &&
              o.unitId === occ.id &&
              o.sourceProvinceId === target,
          );
          let str: number | undefined;
          if (!om || om.targetProvinceId === target) {
            str = 1;
          } else if (!validated.has(om)) {
            str = 1;
          } else {
            const os = outcome.get(om);
            if (os === true) {
              str = 0;
            } else if (os === false) {
              str = 1;
            } else {
              str = undefined;
            }
          }
          if (str !== undefined) {
            outcome.set(move, power > str);
            changed = true;
          }
        }
      } else {
        const maxP = Math.max(...moves.map((m) => m.power));
        const tops = moves.filter((m) => m.power === maxP);
        if (tops.length !== 1) {
          for (const m of moves) {
            if (outcome.get(m.order) === undefined) {
              outcome.set(m.order, false);
              changed = true;
            }
          }
          continue;
        }
        const win = tops[0];
        if (outcome.get(win.order) !== undefined) {
          continue;
        }
        const attacker = unitById.get(win.order.unitId);
        if (!attacker) {
          for (const m of moves) {
            outcome.set(m.order, false);
          }
          changed = true;
          continue;
        }
        const occ = board.units.find((u) => u.provinceId === target);
        const power = win.power;

        if (!occ) {
          for (const m of moves) {
            outcome.set(m.order, m === win);
          }
          changed = true;
          continue;
        }

        if (occ.powerId === attacker.powerId) {
          const occMove = moveOrders.find(
            (o) =>
              o.type === OrderType.Move &&
              o.unitId === occ.id &&
              o.sourceProvinceId === target,
          );
          const isSwap =
            occMove != null &&
            occMove.targetProvinceId === win.order.sourceProvinceId &&
            occMove.targetProvinceId !== occMove.sourceProvinceId;

          if (
            isSwap &&
            occMove != null &&
            validated.has(occMove) &&
            validated.has(win.order)
          ) {
            const a = outcome.get(win.order);
            const b = outcome.get(occMove);
            if (a === false || b === false) {
              for (const m of moves) {
                outcome.set(m.order, false);
              }
              changed = true;
            } else if (a === undefined && b === undefined) {
              outcome.set(win.order, true);
              outcome.set(occMove, true);
              for (const m of moves) {
                outcome.set(m.order, m === win);
              }
              changed = true;
            } else if (a === true && b === undefined) {
              outcome.set(occMove, true);
              for (const m of moves) {
                outcome.set(m.order, m === win);
              }
              changed = true;
            } else if (b === true && a === undefined) {
              outcome.set(win.order, true);
              for (const m of moves) {
                outcome.set(m.order, m === win);
              }
              changed = true;
            }
          } else {
            if (
              !occMove ||
              occMove.targetProvinceId === target ||
              !validated.has(occMove)
            ) {
              for (const m of moves) {
                outcome.set(m.order, false);
              }
              changed = true;
            } else {
              const os = outcome.get(occMove);
              if (os === false) {
                for (const m of moves) {
                  outcome.set(m.order, false);
                }
                changed = true;
              } else if (os === true) {
                for (const m of moves) {
                  outcome.set(m.order, m === win && power > 0);
                }
                changed = true;
              }
            }
          }
        } else {
          const om = moveOrders.find(
            (o) =>
              o.type === OrderType.Move &&
              o.unitId === occ.id &&
              o.sourceProvinceId === target,
          );
          let str: number | undefined;
          if (!om || om.targetProvinceId === target) {
            str = 1;
          } else if (!validated.has(om)) {
            str = 1;
          } else {
            const os = outcome.get(om);
            if (os === true) {
              str = 0;
            } else if (os === false) {
              str = 1;
            } else {
              str = undefined;
            }
          }
          if (str !== undefined) {
            const winnerOk = power > str;
            for (const m of moves) {
              outcome.set(m.order, m === win && winnerOk);
            }
            changed = true;
          }
        }
      }
    }

    if (!changed) {
      break;
    }
  }

  for (const arr of movesByTarget.values()) {
    for (const x of arr) {
      if (outcome.get(x.order) === undefined) {
        outcome.set(x.order, false);
      }
    }
  }

  return outcome as Map<MoveOrder, boolean>;
}

/**
 * ボード状態と命令一覧から、1ターン分の解決結果を計算する。
 *
 * @param board 現在のボード状態
 * @param orders 命令一覧
 * @returns 解決後のボード状態と各命令の結果
 */
export function adjudicateTurn(board: BoardState, orders: Order[]): AdjudicationResult {
  const unitById: Map<string, Unit> = new Map(board.units.map((u) => [u.id, u]));

  const provinceById = new Map(board.provinces.map((p) => [p.id, p]));
  const adjacencyKeys = buildAdjacencyKeySet(board);
  const unitKindLabel = (u: Unit): string =>
    u.type === UnitType.Army ? '陸軍' : '海軍';
  const provinceLabel = (provinceId: string): string =>
    provinceById.get(provinceId)?.name ?? provinceId;
  const unitLabelWithPowerAndCity = (u: Unit): string =>
    `${u.powerId} ${provinceLabel(u.provinceId)}の${unitKindLabel(u)}`;

  // 支援の有効性・コンボイ成立は固定点反復で決定する
  const supportOrders = orders.filter((o): o is SupportOrder => o.type === OrderType.Support);
  const moveOrders = orders.filter((o): o is MoveOrder => o.type === OrderType.Move);
  const convoyOrders = orders.filter((o): o is ConvoyOrder => o.type === OrderType.Convoy);

  const convoySeaByArmy: Map<string, Set<string>> = new Map();
  for (const c of convoyOrders) {
    const fleet = unitById.get(c.unitId);
    if (!fleet || fleet.type !== UnitType.Fleet) {
      continue;
    }
    const fleetProvince = provinceById.get(fleet.provinceId);
    if (!fleetProvince || fleetProvince.areaType !== AreaType.Sea) {
      continue;
    }
    const key = `${c.armyUnitId}:${c.fromProvinceId}:${c.toProvinceId}`;
    const set = convoySeaByArmy.get(key) ?? new Set<string>();
    set.add(fleet.provinceId);
    convoySeaByArmy.set(key, set);
  }

  function hasConvoyRoute(move: MoveOrder, excludeSeas: Set<string> = new Set()): boolean {
    const army = unitById.get(move.unitId);
    if (!army || army.type !== UnitType.Army) {
      return false;
    }
    const key = `${move.unitId}:${move.sourceProvinceId}:${move.targetProvinceId}`;
    const seas = convoySeaByArmy.get(key);
    if (!seas || seas.size === 0) {
      return false;
    }
    const aliveSeas = new Set([...seas].filter((id) => !excludeSeas.has(id)));
    if (aliveSeas.size === 0) {
      return false;
    }

    const starts = new Set(
      [...aliveSeas].filter((seaId) => {
        if (!adjacencyKeys.has(`${move.sourceProvinceId}->${seaId}`)) {
          return false;
        }
        const sp = provinceById.get(seaId);
        return sp?.areaType === AreaType.Sea;
      }),
    );
    const goals = new Set(
      [...aliveSeas].filter((seaId) => adjacencyKeys.has(`${seaId}->${move.targetProvinceId}`)),
    );
    if (starts.size === 0 || goals.size === 0) {
      return false;
    }

    const queue: string[] = [...starts];
    const visited = new Set<string>(queue);
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (goals.has(current)) {
        return true;
      }
      for (const next of aliveSeas) {
        if (visited.has(next)) {
          continue;
        }
        if (!adjacencyKeys.has(`${current}->${next}`)) {
          continue;
        }
        visited.add(next);
        queue.push(next);
      }
    }
    return false;
  }

  const convoyMoveCandidate = new Set<MoveOrder>();
  const directAdjacentMove = new Set<MoveOrder>();
  for (const m of moveOrders) {
    const u = unitById.get(m.unitId);
    if (!u) {
      convoyMoveCandidate.add(m);
      continue;
    }
    /** 解決時は adjudicate モード（複数岸への艦隊移動は targetFleetCoast 必須） */
    if (
      isDirectMoveValid(u, m.sourceProvinceId, m.targetProvinceId, board, adjacencyKeys, {
        targetFleetCoast: m.targetFleetCoast,
      })
    ) {
      directAdjacentMove.add(m);
    } else {
      convoyMoveCandidate.add(m);
    }
  }

  const convoySeaProvinces = new Set(
    convoyOrders
      .map((c) => unitById.get(c.unitId))
      .filter((u): u is Unit => !!u && u.type === UnitType.Fleet)
      .map((u) => u.provinceId),
  );

  /** 輸送成立（経路）を計算する。輸送妨害判定は別段で行う。 */
  function resolveConvoyMoves(disruptedSeas: Set<string>): {
    validConvoyMoves: Set<MoveOrder>;
  } {
    const validConvoyMoves = new Set(
      [...convoyMoveCandidate].filter((m) => hasConvoyRoute(m, disruptedSeas)),
    );
    return { validConvoyMoves };
  }

  /**
   * 支援がカットされるか。
   * 公式: 支援元のマスへの攻撃があるとカット。例外は「支援している移動の目的地からの攻撃」のみ（移動支援のとき）。
   */
  function isSupportCut(
    s: SupportOrder,
    enabledAttackMoves: Set<MoveOrder>,
  ): boolean {
    const supportingUnit = unitById.get(s.unitId);
    if (!supportingUnit) {
      return true;
    }
    const attacksOnSupporter = moveOrders.filter(
      (m) =>
        m.targetProvinceId === supportingUnit.provinceId &&
        enabledAttackMoves.has(m),
    );
    if (attacksOnSupporter.length === 0) {
      return false;
    }
    const isMoveSupport = s.fromProvinceId !== s.toProvinceId;
    return attacksOnSupporter.some(
      (m) => !isMoveSupport || m.sourceProvinceId !== s.toProvinceId,
    );
  }

  const moveOrderByUnitId = new Map<string, MoveOrder>();
  for (const m of moveOrders) {
    moveOrderByUnitId.set(m.unitId, m);
  }

  function isSupportOrderMatchingSupportedAction(s: SupportOrder): boolean {
    const supporter = unitById.get(s.unitId);
    const supported = unitById.get(s.supportedUnitId);
    if (!supporter || !supported) {
      return false;
    }
    if (s.fromProvinceId !== supported.provinceId) {
      return false;
    }
    if (!adjacencyKeys.has(`${supporter.provinceId}->${s.toProvinceId}`)) {
      return false;
    }
    const supportedMove = moveOrderByUnitId.get(s.supportedUnitId);
    const isHoldSupport = s.fromProvinceId === s.toProvinceId;
    if (isHoldSupport) {
      return supportedMove == null;
    }
    if (!supportedMove) {
      return false;
    }
    return supportedMove.targetProvinceId === s.toProvinceId;
  }

  /** 有効かつ非カット支援を strength マップに反映したコピーを返す */
  function buildStrengthWithSupports(
    effectiveSupports: Set<SupportOrder>,
    cut: Set<SupportOrder>,
  ): Map<string, number> {
    const m = new Map<string, number>();
    for (const unit of board.units) {
      m.set(unit.provinceId, 1);
    }
    for (const s of effectiveSupports) {
      if (cut.has(s)) {
        continue;
      }
      const key = `${s.fromProvinceId}->${s.toProvinceId}`;
      m.set(key, (m.get(key) ?? 0) + 1);
    }
    return m;
  }

  const effectiveSupportOrders = new Set(
    supportOrders.filter((s) => isSupportOrderMatchingSupportedAction(s)),
  );
  let supportCut = new Set<SupportOrder>();
  let finalValidConvoyMoves = new Set<MoveOrder>();
  let disruptedSeaProvinces = new Set<string>();

  for (let outer = 0; outer < 12; outer += 1) {
    const convoyResolution = resolveConvoyMoves(disruptedSeaProvinces);
    finalValidConvoyMoves = convoyResolution.validConvoyMoves;

    const strengthForMoves = buildStrengthWithSupports(
      effectiveSupportOrders,
      supportCut,
    );
    const movesByTargetForIter: Map<string, MoveAttack[]> = new Map();
    for (const move of moveOrders) {
      const unit = unitById.get(move.unitId);
      if (!unit) {
        continue;
      }
      const directAdjacent = directAdjacentMove.has(move);
      const convoyRoute = finalValidConvoyMoves.has(move);
      if (!directAdjacent && !convoyRoute) {
        continue;
      }
      const key = `${move.sourceProvinceId}->${move.targetProvinceId}`;
      const power = 1 + (strengthForMoves.get(key) ?? 0);
      const list = movesByTargetForIter.get(move.targetProvinceId) ?? [];
      list.push({ order: move, power });
      movesByTargetForIter.set(move.targetProvinceId, list);
    }

    const moveSuccessForIter = resolveMoveSuccessMap(
      board,
      moveOrders,
      movesByTargetForIter,
      unitById,
    );
    const validatedMovesForIter = new Set<MoveOrder>();
    for (const arr of movesByTargetForIter.values()) {
      for (const a of arr) {
        validatedMovesForIter.add(a.order);
      }
    }
    const successfulMovesForIter = new Set<MoveOrder>();
    for (const mv of validatedMovesForIter) {
      if (moveSuccessForIter.get(mv) === true) {
        successfulMovesForIter.add(mv);
      }
    }

    const nextDisrupted = new Set<string>();
    for (const seaId of convoySeaProvinces) {
      const defendingFleet = board.units.find(
        (u) => u.provinceId === seaId && u.type === UnitType.Fleet,
      );
      if (!defendingFleet) {
        continue;
      }
      for (const sm of successfulMovesForIter) {
        if (sm.targetProvinceId !== seaId) {
          continue;
        }
        const attacker = unitById.get(sm.unitId);
        if (!attacker || attacker.powerId === defendingFleet.powerId) {
          continue;
        }
        const defenderMove = moveOrderByUnitId.get(defendingFleet.id);
        const defenderLeaving =
          defenderMove != null &&
          defenderMove.targetProvinceId !== seaId &&
          moveSuccessForIter.get(defenderMove) === true;
        if (!defenderLeaving) {
          nextDisrupted.add(seaId);
          break;
        }
      }
    }

    const enabledAttackMoves = new Set<MoveOrder>(validatedMovesForIter);
    const nextCut = new Set<SupportOrder>();
    for (const s of effectiveSupportOrders) {
      if (isSupportCut(s, enabledAttackMoves)) {
        nextCut.add(s);
      }
    }

    const sameCut = setEqualsByKey(supportCut, nextCut, supportKeyOf);
    const sameDisrupted = setEqualsByKey(
      disruptedSeaProvinces,
      nextDisrupted,
      (x) => x,
    );
    supportCut = nextCut;
    disruptedSeaProvinces = nextDisrupted;
    if (sameCut && sameDisrupted) {
      break;
    }
  }

  const supportStrength = buildStrengthWithSupports(effectiveSupportOrders, supportCut);
  const defensePowerAt = (provinceId: string): number =>
    supportStrength.get(`${provinceId}->${provinceId}`) ?? 1;
  const lastConvoyResolution = resolveConvoyMoves(disruptedSeaProvinces);
  finalValidConvoyMoves = lastConvoyResolution.validConvoyMoves;

  // 各 Move の最終的なパワー計算（支援込み）
  const movesByTarget: Map<string, MoveAttack[]> = new Map();

  // 解決結果: 各ユニットの新しい位置
  const newUnits: Unit[] = board.units.map((u) => ({ ...u }));
  const unitPositionById: Map<string, string> = new Map(
    newUnits.map((u) => [u.id, u.provinceId]),
  );

  const orderResolutions: OrderResolution[] = [];
  const dislodgedUnits: DislodgedUnit[] = [];

  /**
   * 移動命令で、そのマスから去るか（去らないユニットは「残留扱い」）
   */
  function isLeavingProvinceInMoveOrders(
    unitId: string,
    provinceId: string,
  ): boolean {
    const mv = moveOrders.find((m) => m.unitId === unitId);
    if (!mv) {
      return false;
    }
    if (mv.sourceProvinceId !== provinceId) {
      return false;
    }
    return mv.targetProvinceId !== provinceId;
  }

  // 移動命令のバリデーション（隣接チェック・地形とユニット種別の整合チェック）
  for (const move of moveOrders) {
    const unit = unitById.get(move.unitId);
    const sourceProvince = provinceById.get(move.sourceProvinceId);
    const targetProvince = provinceById.get(move.targetProvinceId);

    if (!unit || !sourceProvince || !targetProvince) {
      orderResolutions.push({
        order: move,
        success: false,
        message: '無効な移動: ユニットまたは都市が存在しません',
      });
      continue;
    }

    const isArmy = unit.type === UnitType.Army;
    const isFleet = unit.type === UnitType.Fleet;

    const directAdjacent = isDirectMoveValid(
      unit,
      move.sourceProvinceId,
      move.targetProvinceId,
      board,
      adjacencyKeys,
      { targetFleetCoast: move.targetFleetCoast },
    );
    const convoyRoute = finalValidConvoyMoves.has(move);
    if (!directAdjacent && !convoyRoute) {
      const rawEdge = adjacencyKeys.has(
        `${move.sourceProvinceId}->${move.targetProvinceId}`,
      );
      let message = '無効な移動: 隣接していないか、輸送ルートが成立していません';
      if (rawEdge) {
        if (isArmy && targetProvince.areaType === AreaType.Sea) {
          message = '無効な移動: 陸軍は海エリアに移動できません';
        } else if (isFleet && targetProvince.areaType === AreaType.Land) {
          message = '無効な移動: 海軍は内陸エリアに移動できません';
        } else if (
          isFleet &&
          unit.fleetCoast == null &&
          isSplitProvince(move.sourceProvinceId)
        ) {
          message =
            '無効な移動: 分割岸都市にいる艦隊は所在岸（NC/SC/EC）が未設定です';
        } else if (
          isFleet &&
          sourceProvince.areaType === AreaType.Coastal &&
          targetProvince.areaType === AreaType.Coastal &&
          !fleetCoastalPairSharesSea(
            move.sourceProvinceId,
            move.targetProvinceId,
            board,
            adjacencyKeys,
          )
        ) {
          message =
            '無効な移動: 沿岸同士の艦隊移動は、両方に接する海域に沿ったルートに限られます';
        } else if (isFleet) {
          const coasts = fleetArrivalCoasts(move.targetProvinceId, move.sourceProvinceId);
          if (coasts.length > 1 && move.targetFleetCoast == null) {
            message =
              '無効な移動: 到着岸が複数あります。命令で targetFleetCoast（岸）を指定してください';
          }
        }
      }
      orderResolutions.push({
        order: move,
        success: false,
        message,
      });
      continue;
    }

    if (isArmy && targetProvince.areaType === AreaType.Sea) {
      orderResolutions.push({
        order: move,
        success: false,
        message: '無効な移動: 陸軍は海エリアに移動できません',
      });
      continue;
    }

    if (isFleet && targetProvince.areaType === AreaType.Land) {
      orderResolutions.push({
        order: move,
        success: false,
          message: '無効な移動: 海軍は内陸エリアに移動できません',
      });
      continue;
    }

    if (
      isFleet &&
      fleetArrivalCoasts(move.targetProvinceId, move.sourceProvinceId).length > 1
    ) {
      const coasts = fleetArrivalCoasts(move.targetProvinceId, move.sourceProvinceId);
      if (
        move.targetFleetCoast == null ||
        !coasts.includes(move.targetFleetCoast)
      ) {
        orderResolutions.push({
          order: move,
          success: false,
          message:
            '無効な移動: 複数岸への移動では命令で到着岸（NC/SC/EC）を正しく指定してください',
        });
        continue;
      }
    }

    /** 同一プロヴィンスに陸海併存不可: 残留する同勢力ユニットがいれば移動不可（入替は双方が去る場合のみ可） */
    const friendlyDefenderStaying = newUnits.some((ou) => {
      if (ou.provinceId !== move.targetProvinceId) {
        return false;
      }
      if (ou.id === move.unitId) {
        return false;
      }
      if (ou.powerId !== unit.powerId) {
        return false;
      }
      return !isLeavingProvinceInMoveOrders(ou.id, move.targetProvinceId);
    });
    if (friendlyDefenderStaying) {
      orderResolutions.push({
        order: move,
        success: false,
        message:
          '無効な移動: 同じ勢力のユニットがその都市に残留しています（1マス1ユニット）',
      });
      continue;
    }

    let power = 1;
    const key = `${move.sourceProvinceId}->${move.targetProvinceId}`;
    power += supportStrength.get(key) ?? 0;
    const list = movesByTarget.get(move.targetProvinceId) ?? [];
    list.push({ order: move, power });
    movesByTarget.set(move.targetProvinceId, list);
  }

  const validatedMoveOrders = new Set<MoveOrder>();
  for (const arr of movesByTarget.values()) {
    for (const x of arr) {
      validatedMoveOrders.add(x.order);
    }
  }

  const moveSuccess = resolveMoveSuccessMap(
    board,
    moveOrders,
    movesByTarget,
    unitById,
  );

  /** 防御側がマスに残留したか（検証済みの退去移動が成功したときのみ空く） */
  function defenderStayedOnProvince(
    targetProvinceId: string,
    occupant: Unit,
  ): boolean {
    const om = moveOrders.find(
      (o) =>
        o.type === OrderType.Move &&
        o.unitId === occupant.id &&
        o.sourceProvinceId === targetProvinceId,
    );
    if (!om || om.targetProvinceId === targetProvinceId) {
      return true;
    }
    if (!validatedMoveOrders.has(om)) {
      return true;
    }
    return moveSuccess.get(om) !== true;
  }

  // Move の結果を決定（moveSuccess に基づく）
  const successfulMoves = new Set<MoveOrder>();

  for (const [target, moves] of movesByTarget.entries()) {
    const occupyingUnit = board.units.find((u) => u.provinceId === target);

    if (moves.length === 1) {
      const { order: move, power: _power } = moves[0];
      const attacker = unitById.get(move.unitId);
      const ok = moveSuccess.get(move) ?? false;

      if (ok) {
        successfulMoves.add(move);
        unitPositionById.set(move.unitId, move.targetProvinceId);
        let successMessage = '移動成功';
        if (occupyingUnit != null && attacker != null) {
          const defenderStayed =
            occupyingUnit.powerId !== attacker.powerId &&
            defenderStayedOnProvince(target, occupyingUnit);
          if (defenderStayed) {
            const defenderPower = defensePowerAt(target);
            successMessage = `${_power}対${defenderPower}で${unitLabelWithPowerAndCity(
              occupyingUnit,
            )}に勝利して移動成功`;
          }
        }
        orderResolutions.push({
          order: move,
          success: true,
          message: successMessage,
        });
        if (
          occupyingUnit != null &&
          attacker != null &&
          occupyingUnit.powerId !== attacker.powerId &&
          defenderStayedOnProvince(target, occupyingUnit)
        ) {
          unitPositionById.delete(occupyingUnit.id);
          dislodgedUnits.push({
            unit: occupyingUnit,
            fromProvinceId: target,
            displacedByUnitId: move.unitId,
            blockedProvinceId: move.sourceProvinceId,
          });
          orderResolutions.push({
            order: {
              type: OrderType.Hold,
              unitId: occupyingUnit.id,
            },
            success: false,
            message: '押し出され退却が必要',
          });
        }
      } else {
        let failMessage = '移動失敗';
        if (
          occupyingUnit != null &&
          attacker != null &&
          occupyingUnit.powerId === attacker.powerId
        ) {
          failMessage =
            '移動失敗: 同勢力のユニットが先にそのマスを空けていません（1マス1ユニット）';
        } else if (
          occupyingUnit != null &&
          attacker != null &&
          occupyingUnit.powerId !== attacker.powerId &&
          defenderStayedOnProvince(target, occupyingUnit)
        ) {
          const defenderPower = defensePowerAt(target);
          if (_power === defenderPower) {
            failMessage = `${_power}対${defenderPower}でスタンドオフ`;
          } else {
            failMessage = `${_power}対${defenderPower}で${unitLabelWithPowerAndCity(
              occupyingUnit,
            )}に敗北して移動失敗`;
          }
        } else {
          failMessage = `${_power}対${_power}で競合しスタンドオフ`;
        }
        orderResolutions.push({
          order: move,
          success: false,
          message: failMessage,
        });
      }
    } else {
      const winners = moves.filter((m) => moveSuccess.get(m.order));
      if (winners.length === 1) {
        const winner = winners[0];
        const attacker = unitById.get(winner.order.unitId);
        successfulMoves.add(winner.order);
        unitPositionById.set(winner.order.unitId, winner.order.targetProvinceId);
        let winnerMessage = `${winner.power}対1で${provinceLabel(
          winner.order.targetProvinceId,
        )}へ移動成功`;
        let winnerOpponentPower = 1;
        if (occupyingUnit != null && attacker != null) {
          const defenderStayed =
            occupyingUnit.powerId !== attacker.powerId &&
            defenderStayedOnProvince(target, occupyingUnit);
          if (defenderStayed) {
            winnerOpponentPower = defensePowerAt(target);
            winnerMessage = `${winner.power}対${winnerOpponentPower}で${unitLabelWithPowerAndCity(
              occupyingUnit,
            )}に勝利して移動成功`;
          }
        }
        const loserTop = moves
          .filter((m) => m !== winner)
          .sort((a, b) => b.power - a.power)[0];
        const loserUnit = loserTop ? unitById.get(loserTop.order.unitId) : null;
        if (loserTop && loserUnit) {
          const opponentPower = Math.max(loserTop.power, winnerOpponentPower);
          winnerMessage = `${winner.power}対${opponentPower}で${unitLabelWithPowerAndCity(
            loserUnit,
          )}に勝利して移動成功`;
        }
        orderResolutions.push({
          order: winner.order,
          success: true,
          message: winnerMessage,
        });
        for (const loser of moves.filter((m) => m !== winner)) {
          const loserUnit = unitById.get(loser.order.unitId);
          const winnerUnit = unitById.get(winner.order.unitId);
          const loserMessage =
            loserUnit && winnerUnit
              ? `${loser.power}対${winner.power}で${unitLabelWithPowerAndCity(
                  winnerUnit,
                )}に敗北して移動失敗`
              : '移動失敗';
          orderResolutions.push({
            order: loser.order,
            success: false,
            message: loserMessage,
          });
        }
        if (
          occupyingUnit != null &&
          attacker != null &&
          occupyingUnit.powerId !== attacker.powerId &&
          defenderStayedOnProvince(target, occupyingUnit)
        ) {
          unitPositionById.delete(occupyingUnit.id);
          dislodgedUnits.push({
            unit: occupyingUnit,
            fromProvinceId: target,
            displacedByUnitId: winner.order.unitId,
            blockedProvinceId: winner.order.sourceProvinceId,
          });
          orderResolutions.push({
            order: {
              type: OrderType.Hold,
              unitId: occupyingUnit.id,
            },
            success: false,
            message: '押し出され退却が必要',
          });
        }
      } else {
        const topPower = Math.max(...moves.map((m) => m.power));
        for (const m of moves) {
          orderResolutions.push({
            order: m.order,
            success: false,
            message: `${m.power}対${topPower}でスタンドオフ`,
          });
        }
      }
    }
  }

  // Hold と未指定ユニット
  for (const c of convoyOrders) {
    const fleet = unitById.get(c.unitId);
    if (!fleet || fleet.type !== UnitType.Fleet) {
      orderResolutions.push({
        order: c,
        success: false,
        message: '輸送失敗: 輸送命令ユニットが海軍ではありません',
      });
      continue;
    }
    const matchingMove = moveOrders.find(
      (m) =>
        m.unitId === c.armyUnitId &&
        m.sourceProvinceId === c.fromProvinceId &&
        m.targetProvinceId === c.toProvinceId,
    );
    if (!matchingMove) {
      orderResolutions.push({
        order: c,
        success: false,
        message: '輸送失敗: 対応する陸軍移動命令がありません',
      });
      continue;
    }
    const convoyFleetProvince = fleet.provinceId;
    const disrupted = disruptedSeaProvinces.has(convoyFleetProvince);
    const convoySuccess =
      finalValidConvoyMoves.has(matchingMove) &&
      !disrupted;
    orderResolutions.push({
      order: c,
      success: convoySuccess,
      message: convoySuccess
        ? '輸送経路成立'
        : disrupted
          ? '輸送失敗: 輸送艦隊が押し出され輸送妨害'
          : '輸送失敗: 経路不成立',
    });
  }

  // 支援命令（カットされていなければ成功）
  for (const s of supportOrders) {
    const supporter = unitById.get(s.unitId);
    const supported = unitById.get(s.supportedUnitId);
    if (!supporter) {
      orderResolutions.push({
        order: s,
        success: false,
        message: '支援失敗: 支援ユニットが盤面に存在しません',
      });
      continue;
    }
    if (!supported) {
      orderResolutions.push({
        order: s,
        success: false,
        message: '支援失敗: 対象ユニットが盤面に存在しません',
      });
      continue;
    }
    if (!effectiveSupportOrders.has(s)) {
      orderResolutions.push({
        order: s,
        success: false,
        message: '支援失敗: 支援対象の行動と命令が一致しません',
      });
      continue;
    }
    const cut = supportCut.has(s);
    orderResolutions.push({
      order: s,
      success: !cut,
      message: cut ? '支援失敗: 支援がカットされました' : '支援成功',
    });
  }

  // Hold と未指定ユニット
  for (const order of orders) {
    if (order.type === OrderType.Hold) {
      orderResolutions.push({
        order,
        success: true,
        message: 'ホールド成功',
      });
    }
  }

  // 移動命令が出ていないユニットは暗黙の Hold
  const movedUnitIds = new Set(moveOrders.map((m) => m.unitId));
  for (const unit of board.units) {
    if (!movedUnitIds.has(unit.id)) {
      const explicitHold = orders.find(
        (o) => o.type === OrderType.Hold && o.unitId === unit.id,
      );
      if (!explicitHold) {
        orderResolutions.push({
          order: { type: OrderType.Hold, unitId: unit.id },
          success: true,
          message: '命令なしのためホールド',
        });
      }
    }
  }

  const winningMoveByUnitId = new Map<string, MoveOrder>();
  for (const m of successfulMoves) {
    winningMoveByUnitId.set(m.unitId, m);
  }

  // ユニット位置の更新（押し出されて退却待ちのユニットは盤面から除去）
  const finalUnits: Unit[] = [];
  for (const unit of board.units) {
    const pos = unitPositionById.get(unit.id);
    if (!pos) {
      continue;
    }
    const move = winningMoveByUnitId.get(unit.id);
    const next: Unit = { ...unit, provinceId: pos };
    if (move != null && unit.type === UnitType.Fleet) {
      const coast = resolveFleetCoastAfterMove(
        unit,
        move.sourceProvinceId,
        move.targetProvinceId,
        move.targetFleetCoast,
      );
      if (coast !== undefined) {
        next.fleetCoast = coast;
      } else {
        delete next.fleetCoast;
      }
    }
    finalUnits.push(next);
  }

  // サプライセンター所有状況の更新（占領している勢力に紐づけ）
  const newSupplyOwnership: BoardState['supplyCenterOwnership'] = {
    ...board.supplyCenterOwnership,
  };
  for (const unit of finalUnits) {
    const prov = board.provinces.find((p) => p.id === unit.provinceId);
    const scKey = supplyCenterKeyForProvince(prov);
    if (scKey) {
      newSupplyOwnership[scKey] = unit.powerId;
    }
  }

  /** 春→秋（同年）、秋→春（翌年）へターンを進める */
  const nextTurn: TurnInfo = board.turn.season === Season.Spring
    ? { year: board.turn.year, season: Season.Fall }
    : { year: board.turn.year + 1, season: Season.Spring };

  const nextBoardState: BoardState = {
    ...board,
    turn: nextTurn,
    units: finalUnits,
    supplyCenterOwnership: newSupplyOwnership,
    provinceControlTint: nextProvinceControlTint(board.provinceControlTint, {
      ...board,
      units: finalUnits,
      supplyCenterOwnership: newSupplyOwnership,
    }),
  };

  return {
    nextBoardState,
    orderResolutions,
    dislodgedUnits,
  };
}

