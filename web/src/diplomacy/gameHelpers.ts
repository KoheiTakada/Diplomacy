/**
 * ディプロマシー支援ツール用の純粋関数・定数
 *
 * 概要:
 *   メインページおよび各国専用ページから共有する盤面表示・命令UI向けのヘルパー。
 *
 * 主な機能:
 *   - 命令入力型・増産/削減スロット型の定義と初期化
 *   - 解決ログ整形、隣接・退却候補、地図演出用の補助計算
 *   - 勢力ごとの入力完了判定（各国ページと集約メインで共通利用）
 *
 * 想定される制限事項:
 *   - 認証は行わない。完了フラグは端末内の誠実運用向け。
 */

import {
  AreaType,
  type DislodgedUnit,
  type FleetCoast,
  OrderType,
  type OrderResolution,
  Season,
  UnitType,
  type BoardState,
  type MoveOrder,
  type Order,
  type Province,
  type TurnInfo,
  type Unit,
} from '@/domain';
import { POWERS } from '@/miniMap';
import {
  buildAdjacencyKeySet,
  findAllConvoyPathProvinceIdsForMove,
  findConvoyPathProvinceIdsForMove,
  fleetArrivalCoasts,
  getDirectMoveTargets,
  getReachableProvinceIdsForOrderUi,
  getSupportMoveDestinationProvinceIds,
  isDirectMoveValid,
  isProvinceOccupied,
  isSplitProvince,
} from '@/mapMovement';

export {
  fleetArrivalCoasts,
  isSplitProvince,
  supplyCenterKeyForProvince,
} from '@/mapMovement';
import {
  CONVOY_PATH_MS,
  STANDOFF_BUMP_MS,
  UNIT_MOVE_ANIM_MS,
} from '@/mapViewConstants';
import type { MapVisualEffect } from '@/mapVisualEffects';
import type { RevealTimelineStep } from '@/resolutionRevealOrder';

/** MapView の UNIT_MOVE_ANIM_MS と揃える */
export const MAP_UNIT_MOVE_ANIM_MS = UNIT_MOVE_ANIM_MS;

/** MapView の CONVOY_PATH_MS と揃える */
export const MAP_CONVOY_PATH_MS = CONVOY_PATH_MS;

/** ホールド支援時の支援線表示時間 */
export const MAP_HOLD_SUPPORT_LINE_MS = 720;

/** MapView の STANDOFF_BUMP_MS と揃える */
export const MAP_STANDOFF_BUMP_MS = STANDOFF_BUMP_MS;

/**
 * 移動成功時の地図アニメ長さを推定する。
 *
 * @param mv - 移動命令
 * @param labelBoard - 解決前盤面
 * @param domainOrders - 当ターンの全命令
 * @returns ミリ秒
 */
export function estimateMoveRevealAnimationMs(
  mv: MoveOrder,
  labelBoard: BoardState,
  domainOrders: Order[],
): number {
  const mover = labelBoard.units.find((u) => u.id === mv.unitId);
  if (!mover) {
    return MAP_UNIT_MOVE_ANIM_MS;
  }
  if (mover.type === UnitType.Army) {
    const adjKeysForFx = buildAdjacencyKeySet(labelBoard);
    const isDirect = isDirectMoveValid(
      mover,
      mv.sourceProvinceId,
      mv.targetProvinceId,
      labelBoard,
      adjKeysForFx,
      {
        mode: 'adjudicate',
        targetFleetCoast: mv.targetFleetCoast,
      },
    );
    if (!isDirect) {
      const pathIds = findConvoyPathProvinceIdsForMove(
        labelBoard,
        mv,
        domainOrders,
        adjKeysForFx,
      );
      if (pathIds != null && pathIds.length >= 3) {
        return MAP_CONVOY_PATH_MS;
      }
    }
  }
  return MAP_UNIT_MOVE_ANIM_MS;
}

/**
 * タイムライン上の resolution 1件に対応する地図演出を収集する。
 *
 * @param out - 出力配列
 * @param step - タイムラインの resolution ステップ
 * @param r - 解決1件
 * @param labelBoard - 解決前盤面
 * @param domainOrders - 全命令
 * @param flatResolutions - ログ順の解決のみの配列
 * @param runGen - 表示世代
 * @param stepIndex - タイムライン上の添字
 */
export function appendMapEffectsForRevealResolution(
  out: MapVisualEffect[],
  step: Extract<RevealTimelineStep, { kind: 'resolution' }>,
  r: OrderResolution,
  labelBoard: BoardState,
  domainOrders: Order[],
  flatResolutions: OrderResolution[],
  runGen: number,
  stepIndex: number,
): void {
  if (r.order.type === OrderType.Convoy) {
    const c = r.order;
    const move: MoveOrder = {
      type: OrderType.Move,
      unitId: c.armyUnitId,
      sourceProvinceId: c.fromProvinceId,
      targetProvinceId: c.toProvinceId,
    };
    const adjKeys = buildAdjacencyKeySet(labelBoard);
    const paths = findAllConvoyPathProvinceIdsForMove(
      labelBoard,
      move,
      domainOrders,
      adjKeys,
      new Set(),
      6,
    );
    for (let i = 0; i < paths.length; i += 1) {
      out.push({
        id: `cvl-${runGen}-${stepIndex}-${c.unitId}-${i}`,
        type: 'convoyPathLink',
        convoyUnitId: c.unitId,
        pathProvinceIds: paths[i]!,
        tentative: !r.success,
      });
    }
    return;
  }

  if (step.revokeSupportLinksBefore != null) {
    for (let j = 0; j < step.revokeSupportLinksBefore.length; j += 1) {
      const pair = step.revokeSupportLinksBefore[j];
      out.push({
        id: `rv-${runGen}-${stepIndex}-${j}-${pair.supporterUnitId}`,
        type: 'supportLinkRevoke',
        supporterUnitId: pair.supporterUnitId,
        supportedUnitId: pair.supportedUnitId,
      });
    }
  }

  if (r.order.type === OrderType.Support && r.success) {
    const sup = r.order;
    if (sup.fromProvinceId !== sup.toProvinceId) {
      const mv = domainOrders.find(
        (o): o is MoveOrder =>
          o.type === OrderType.Move &&
          o.unitId === sup.supportedUnitId &&
          o.sourceProvinceId === sup.fromProvinceId &&
          o.targetProvinceId === sup.toProvinceId,
      );
      if (mv != null) {
        const durationMs = estimateMoveRevealAnimationMs(
          mv,
          labelBoard,
          domainOrders,
        );
        out.push({
          id: `sl-${runGen}-${stepIndex}-${sup.unitId}`,
          type: 'supportLink',
          supporterUnitId: sup.unitId,
          supportedUnitId: sup.supportedUnitId,
          durationMs,
          boostSupportedBadge: true,
          linePersistsUntilRelease: true,
        });
      }
    } else {
      out.push({
        id: `sh-${runGen}-${stepIndex}-${sup.unitId}`,
        type: 'supportLink',
        supporterUnitId: sup.unitId,
        supportedUnitId: sup.supportedUnitId,
        durationMs: MAP_HOLD_SUPPORT_LINE_MS,
        boostSupportedBadge: true,
        linePersistsUntilRelease: false,
      });
    }
    return;
  }

  if (r.order.type !== OrderType.Move) {
    return;
  }

  const mv = r.order;
  const flatIx = flatResolutions.indexOf(r);
  const isCollisionLikeFailure =
    !r.success &&
    (r.message.includes('スタンドオフ') || r.message.includes('敗北して移動失敗'));
  if (isCollisionLikeFailure) {
    const coll = collectMoveCollisionGroup(flatResolutions, flatIx);
    if (coll != null) {
      if (coll.primaryIndex === flatIx) {
        out.push({
          id: `sc-${runGen}-${stepIndex}`,
          type: 'standoffCollision',
          unitIds: coll.unitIds,
          targetProvinceId: coll.targetProvinceId,
        });
      }
    } else {
      out.push({
        id: `sf-${runGen}-${stepIndex}`,
        type: 'standoffBounce',
        unitId: mv.unitId,
        targetProvinceId: mv.targetProvinceId,
      });
    }
    out.push({
      id: `rel-${runGen}-${stepIndex}-${mv.unitId}-sf`,
      type: 'releaseSupportVisualsAfterMove',
      unitId: mv.unitId,
      delayMs: MAP_STANDOFF_BUMP_MS,
    });
  }
  if (r.success) {
    const mover = labelBoard.units.find((x) => x.id === mv.unitId);
    if (mover?.type === UnitType.Army) {
      const adjKeysForFx = buildAdjacencyKeySet(labelBoard);
      const isDirect = isDirectMoveValid(
        mover,
        mv.sourceProvinceId,
        mv.targetProvinceId,
        labelBoard,
        adjKeysForFx,
        {
          mode: 'adjudicate',
          targetFleetCoast: mv.targetFleetCoast,
        },
      );
      if (!isDirect) {
        const pathIds = findConvoyPathProvinceIdsForMove(
          labelBoard,
          mv,
          domainOrders,
          adjKeysForFx,
        );
        if (pathIds != null && pathIds.length >= 3) {
          out.push({
            id: `cv-${runGen}-${stepIndex}`,
            type: 'convoyAlongPath',
            unitId: mv.unitId,
            pathProvinceIds: pathIds,
          });
        }
      }
    }
    const moveAnimMs = estimateMoveRevealAnimationMs(
      mv,
      labelBoard,
      domainOrders,
    );
    out.push({
      id: `rel-${runGen}-${stepIndex}-${mv.unitId}-mv`,
      type: 'releaseSupportVisualsAfterMove',
      unitId: mv.unitId,
      delayMs: moveAnimMs,
    });
  } else if (!isCollisionLikeFailure) {
    out.push({
      id: `rel-${runGen}-${stepIndex}-${mv.unitId}-fail`,
      type: 'releaseSupportVisualsAfterMove',
      unitId: mv.unitId,
      delayMs: 0,
    });
  }
}

/** ユニットごとの命令入力状態 */
export type UnitOrderInput = {
  type: OrderType;
  targetProvinceId: string;
  moveTargetFleetCoast: string;
  supportedUnitId: string;
  supportToProvinceId: string;
  convoyArmyId: string;
  convoyToProvinceId: string;
};

/** 命令入力の初期値 */
export function emptyOrder(): UnitOrderInput {
  return {
    type: OrderType.Hold,
    targetProvinceId: '',
    moveTargetFleetCoast: '',
    supportedUnitId: '',
    supportToProvinceId: '',
    convoyArmyId: '',
    convoyToProvinceId: '',
  };
}

/**
 * 入力マップを裁定用の `Order[]` に変換する（Context の解決処理と同一ロジック）。
 *
 * @param board - 現在盤面
 * @param unitOrders - ユニット ID ごとの UI 入力
 * @returns 全ユニット分のドメイン命令（未選択は Hold）
 */
export function buildDomainOrdersFromInputs(
  board: BoardState,
  unitOrders: Record<string, UnitOrderInput>,
): Order[] {
  return board.units.map((unit): Order => {
    const input = unitOrders[unit.id] ?? emptyOrder();
    switch (input.type) {
      case OrderType.Move: {
        const move: MoveOrder = {
          type: OrderType.Move,
          unitId: unit.id,
          sourceProvinceId: unit.provinceId,
          targetProvinceId: input.targetProvinceId,
        };
        if (unit.type === UnitType.Fleet) {
          const pick = asFleetCoast(input.moveTargetFleetCoast);
          const multi = fleetArrivalCoasts(
            input.targetProvinceId,
            unit.provinceId,
          );
          if (multi.length > 1 && pick != null) {
            move.targetFleetCoast = pick;
          }
        }
        return move;
      }
      case OrderType.Support: {
        const supported = board.units.find((u) => u.id === input.supportedUnitId);
        return {
          type: OrderType.Support,
          unitId: unit.id,
          supportedUnitId: input.supportedUnitId,
          fromProvinceId: supported?.provinceId ?? '',
          toProvinceId: input.supportToProvinceId,
        };
      }
      case OrderType.Convoy: {
        const army = board.units.find((u) => u.id === input.convoyArmyId);
        return {
          type: OrderType.Convoy,
          unitId: unit.id,
          armyUnitId: input.convoyArmyId,
          fromProvinceId: army?.provinceId ?? '',
          toProvinceId: input.convoyToProvinceId,
        };
      }
      default:
        return { type: OrderType.Hold, unitId: unit.id };
    }
  });
}

/**
 * 裁定用 `Order[]` を、MapView プレビュー再利用用の `UnitOrderInput` マップへ変換する。
 *
 * @param board - 命令時点の盤面
 * @param orders - ドメイン命令一覧
 * @returns ユニットIDごとの入力表現（未指定は Hold）
 */
export function buildUnitOrderInputsFromDomainOrders(
  board: BoardState,
  orders: Order[],
): Record<string, UnitOrderInput> {
  const out: Record<string, UnitOrderInput> = buildDefaultOrders(board);
  for (const o of orders) {
    if (!out[o.unitId]) {
      out[o.unitId] = emptyOrder();
    }
    if (o.type === OrderType.Move) {
      out[o.unitId] = {
        ...emptyOrder(),
        type: OrderType.Move,
        targetProvinceId: o.targetProvinceId,
        moveTargetFleetCoast: o.targetFleetCoast ?? '',
      };
      continue;
    }
    if (o.type === OrderType.Support) {
      out[o.unitId] = {
        ...emptyOrder(),
        type: OrderType.Support,
        supportedUnitId: o.supportedUnitId,
        supportToProvinceId: o.toProvinceId,
      };
      continue;
    }
    if (o.type === OrderType.Convoy) {
      out[o.unitId] = {
        ...emptyOrder(),
        type: OrderType.Convoy,
        convoyArmyId: o.armyUnitId,
        convoyToProvinceId: o.toProvinceId,
      };
      continue;
    }
    out[o.unitId] = { ...emptyOrder(), type: OrderType.Hold };
  }
  return out;
}

/**
 * 命令一覧から「被支援ユニットごとの支援数」を求める（表示専用）。
 *
 * @param orders - ドメイン命令一覧
 * @returns unitId -> supportCount
 */
export function supportCountBySupportedUnitIdFromOrders(
  orders: Order[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const o of orders) {
    if (o.type !== OrderType.Support) {
      continue;
    }
    out[o.supportedUnitId] = (out[o.supportedUnitId] ?? 0) + 1;
  }
  return out;
}

/** 文字列を FleetCoast に変換 */
export function asFleetCoast(s: string): FleetCoast | undefined {
  if (s === 'NC' || s === 'SC' || s === 'EC') {
    return s;
  }
  return undefined;
}

/** 岸コードの日本語ラベル */
export function fleetCoastJa(c: FleetCoast): string {
  if (c === 'NC') {
    return '北岸';
  }
  if (c === 'SC') {
    return '南岸';
  }
  return '東岸';
}

/**
 * 艦隊移動で複数岸がある場合の選択肢。
 *
 * @param unit - ユニット
 * @param targetProvinceId - 移動先
 * @returns 岸の一覧、不要なら null
 */
export function coastChoicesForFleetMove(
  unit: Unit,
  targetProvinceId: string,
): FleetCoast[] | null {
  if (unit.type !== UnitType.Fleet || !targetProvinceId) {
    return null;
  }
  const coasts = fleetArrivalCoasts(targetProvinceId, unit.provinceId);
  if (coasts.length > 1) {
    return coasts;
  }
  return null;
}

/** 退却セレクト値の分解 */
export function parseRetreatSelection(value: string): {
  provinceId: string;
  fleetCoast?: FleetCoast;
} {
  const i = value.indexOf('|');
  if (i < 0) {
    return { provinceId: value };
  }
  const c = asFleetCoast(value.slice(i + 1));
  return { provinceId: value.slice(0, i), fleetCoast: c };
}

/** 盤面に合わせたデフォルト命令マップ */
export function buildDefaultOrders(
  board: BoardState,
): Record<string, UnitOrderInput> {
  const map: Record<string, UnitOrderInput> = {};
  for (const u of board.units) {
    map[u.id] = emptyOrder();
  }
  return map;
}

/**
 * `/power/[powerId]` の地図プレビュー用に、自国の確定入力と他国の想定入力を1つのマップにまとめる。
 *
 * @param board - 盤面
 * @param viewingPowerId - 閲覧中の勢力 ID
 * @param committedOrders - Context の `unitOrders`（全ユニット）
 * @param hypotheticalByUnitId - 他国ユニット向けの想定のみ（未設定は Hold 扱い）
 */
export function mergePowerPageOrderPreview(
  board: BoardState,
  viewingPowerId: string,
  committedOrders: Record<string, UnitOrderInput>,
  hypotheticalByUnitId: Record<string, UnitOrderInput>,
): Record<string, UnitOrderInput> {
  const m: Record<string, UnitOrderInput> = {};
  for (const u of board.units) {
    if (u.powerId === viewingPowerId) {
      m[u.id] = committedOrders[u.id] ?? emptyOrder();
    } else {
      m[u.id] = hypotheticalByUnitId[u.id] ?? emptyOrder();
    }
  }
  return m;
}

/** プロヴィンス名 */
export function provinceName(board: BoardState, id: string): string {
  return board.provinces.find((p) => p.id === id)?.name ?? id;
}

/** 勢力略称 */
const POWER_SHORT: Record<string, string> = {
  ENG: '英',
  FRA: '仏',
  GER: '独',
  ITA: '伊',
  AUS: '墺',
  RUS: '露',
  TUR: '土',
};

/** 勢力略称ラベル */
export function powerLabel(powerId: string): string {
  return POWER_SHORT[powerId] ?? powerId;
}

/** ユニット種別短縮 */
export function unitTypeLabel(type: UnitType): string {
  return type === UnitType.Army ? '陸' : '海';
}

/** ユニットの説明ラベル */
export function unitLabel(board: BoardState, unitId: string): string {
  const u = board.units.find((x) => x.id === unitId);
  if (!u) {
    return unitId;
  }
  const kind = u.type === UnitType.Army ? '陸軍' : '海軍';
  return `${powerLabel(u.powerId)} ${kind}(${provinceName(board, u.provinceId)})`;
}

/**
 * 解決1件をログ1行にする。
 *
 * @param labelBoard - 解決直前盤面
 * @param r - 解決結果
 * @returns ログ文字列
 */
export function formatOrderResolutionLogLine(
  labelBoard: BoardState,
  r: OrderResolution,
): string {
  const pName = (id: string) => provinceName(labelBoard, id);
  const uLabelFn = (id: string) => unitLabel(labelBoard, id);
  const mark = r.success ? '✓' : '✗';
  const label = uLabelFn(r.order.unitId);
  switch (r.order.type) {
    case OrderType.Move: {
      const from = pName(r.order.sourceProvinceId);
      const to = pName(r.order.targetProvinceId);
      return `${mark} ${r.message}: ${label} ${from} → ${to}`;
    }
    case OrderType.Support: {
      const supported = uLabelFn(r.order.supportedUnitId);
      const to = pName(r.order.toProvinceId);
      if (r.order.fromProvinceId === r.order.toProvinceId) {
        return `${mark} ${r.message}: ${label} が ${supported} の維持を支援`;
      }
      return `${mark} ${r.message}: ${label} が ${supported} の${to}への移動を支援`;
    }
    case OrderType.Convoy: {
      const army = uLabelFn(r.order.armyUnitId);
      const to = pName(r.order.toProvinceId);
      return `${mark} ${r.message}: ${label} が ${army} を${to}へ輸送`;
    }
    default:
      return `${mark} ${r.message}: ${label}`;
  }
}

/**
 * スタンドオフ衝突グループを求める。
 *
 * @param resolutions - 解決結果
 * @param index - 対象行
 */
export function collectStandoffCollisionGroup(
  resolutions: OrderResolution[],
  index: number,
): { unitIds: string[]; targetProvinceId: string; primaryIndex: number } | null {
  const cur = resolutions[index];
  if (cur == null || cur.order.type !== OrderType.Move || cur.success) {
    return null;
  }
  if (!cur.message.includes('スタンドオフ')) {
    return null;
  }
  const target = cur.order.targetProvinceId;
  const hits: { idx: number; unitId: string }[] = [];
  resolutions.forEach((res, j) => {
    if (res.order.type !== OrderType.Move || res.success) {
      return;
    }
    if (!res.message.includes('スタンドオフ')) {
      return;
    }
    if (res.order.targetProvinceId !== target) {
      return;
    }
    hits.push({ idx: j, unitId: res.order.unitId });
  });
  if (hits.length < 2) {
    return null;
  }
  const primaryIndex = Math.min(...hits.map((h) => h.idx));
  const unitIds = [...new Set(hits.map((h) => h.unitId))];
  return { unitIds, targetProvinceId: target, primaryIndex };
}

/**
 * 移動衝突グループを求める。
 *
 * スタンドオフだけでなく、同一目標への競合で「勝者1 + 敗者n」になったケースも
 * 1つの衝突演出として扱う。
 */
export function collectMoveCollisionGroup(
  resolutions: OrderResolution[],
  index: number,
): { unitIds: string[]; targetProvinceId: string; primaryIndex: number } | null {
  const cur = resolutions[index];
  if (cur == null || cur.order.type !== OrderType.Move) {
    return null;
  }
  const target = cur.order.targetProvinceId;
  const hits: { idx: number; unitId: string }[] = [];
  resolutions.forEach((res, j) => {
    if (res.order.type !== OrderType.Move) {
      return;
    }
    if (res.order.targetProvinceId !== target) {
      return;
    }
    const moveConflictFailure =
      !res.success &&
      (res.message.includes('スタンドオフ') || res.message.includes('敗北して移動失敗'));
    if (moveConflictFailure) {
      hits.push({ idx: j, unitId: res.order.unitId });
    }
  });
  if (hits.length < 2) {
    return null;
  }
  const primaryIndex = Math.min(...hits.map((h) => h.idx));
  const unitIds = [...new Set(hits.map((h) => h.unitId))];
  return { unitIds, targetProvinceId: target, primaryIndex };
}

/** 勢力の色・日本語名（UI・配布テキスト共通） */
export type PowerMeta = {
  color: string;
  label: string;
  /**
   * 横幅が狭いときの略称（Tailwind `sm` 未満で `label` の代わりに表示）。
   */
  labelCompact?: string;
};

export const POWER_META: Record<string, PowerMeta> = {
  ENG: { color: '#ef4444', label: 'イギリス' },
  FRA: { color: '#3b82f6', label: 'フランス' },
  GER: { color: '#0d9488', label: 'ドイツ' },
  ITA: { color: '#22c55e', label: 'イタリア' },
  AUS: {
    color: '#eab308',
    label: 'オーストリア・ハンガリー',
    labelCompact: 'オーハン',
  },
  RUS: { color: '#a855f7', label: 'ロシア' },
  TUR: { color: '#f97316', label: 'トルコ' },
};

/** 確認ダイアログ用の役職名（各国のイメージに合わせた呼称） */
export const POWER_ROLE_JA: Record<string, string> = {
  ENG: '国王',
  FRA: '国王',
  GER: '宰相',
  ITA: '国王',
  AUS: '皇帝',
  RUS: '皇帝',
  TUR: 'スルタン',
};

/** 勢力表示順 */
export const POWER_ORDER = [...POWERS];

/** 補給拠点数 */
export function countSupplyCenters(board: BoardState, powerId: string): number {
  return Object.values(board.supplyCenterOwnership).filter(
    (owner) => owner === powerId,
  ).length;
}

/** ユニット数 */
export function countUnits(board: BoardState, powerId: string): number {
  return board.units.filter((u) => u.powerId === powerId).length;
}

/** 増産枠 */
export function buildCapacity(board: BoardState, powerId: string): number {
  return Math.max(countSupplyCenters(board, powerId) - countUnits(board, powerId), 0);
}

/** 増産スロット */
export type BuildSlot = {
  provinceId: string;
  unitType: UnitType;
  buildFleetCoast: string;
};

/**
 * 指定プロヴィンスに海軍を増産できるか。
 *
 * ルール上、海軍増産は「海に面した補給拠点」のみ許可する。
 * データ不整合で areaType が Coastal でも、海隣接がなければ不可とする。
 */
export function canBuildFleetAtProvince(
  board: BoardState,
  provinceId: string,
): boolean {
  const p = board.provinces.find((x) => x.id === provinceId);
  if (!p || p.areaType === AreaType.Land) {
    return false;
  }
  return board.adjacencies.some((a) => {
    if (a.fromProvinceId !== provinceId) {
      return false;
    }
    const to = board.provinces.find((x) => x.id === a.toProvinceId);
    return to?.areaType === AreaType.Sea;
  });
}

/** 削減スロット */
export type DisbandSlot = {
  unitId: string;
};

/** 移動先候補プロヴィンス一覧 */
export function getReachableProvinces(
  board: BoardState,
  unit: Unit,
  adjKeys: Set<string>,
): Province[] {
  const targetIds = getReachableProvinceIdsForOrderUi(board, unit, adjKeys);
  return board.provinces
    .filter((p) => targetIds.has(p.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
}

/** 支援の移動先行き先候補 */
export function getSupportableProvinces(
  board: BoardState,
  supportingUnit: Unit,
  supportedUnit: Unit,
  adjKeys: Set<string>,
): Province[] {
  const ids = getSupportMoveDestinationProvinceIds(
    board,
    supportingUnit,
    supportedUnit,
    adjKeys,
  );
  return board.provinces
    .filter((p) => ids.has(p.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
}

/** 次ターン */
export function nextTurn(turn: TurnInfo): TurnInfo {
  if (turn.season === Season.Spring) {
    return { year: turn.year, season: Season.Fall };
  }
  return { year: turn.year + 1, season: Season.Spring };
}

/** 削減必要数 */
export function disbandNeed(board: BoardState, powerId: string): number {
  return Math.max(
    countUnits(board, powerId) - countSupplyCenters(board, powerId),
    0,
  );
}

/** 退却可能プロヴィンス */
export function getRetreatableProvinces(
  board: BoardState,
  dislodged: DislodgedUnit,
  retreatPlan: Record<string, string>,
): Province[] {
  const adjKeys = buildAdjacencyKeySet(board);
  const targetIds = getDirectMoveTargets(
    dislodged.unit,
    dislodged.fromProvinceId,
    board,
    adjKeys,
  );
  const reserved = new Set(
    Object.entries(retreatPlan)
      .filter(([unitId, provId]) => unitId !== dislodged.unit.id && !!provId)
      .map(([, provId]) => provId),
  );

  return board.provinces.filter((p) => {
    if (!targetIds.has(p.id)) {
      return false;
    }
    if (p.id === dislodged.blockedProvinceId) {
      return false;
    }
    if (isProvinceOccupied(board, p.id, dislodged.unit.id)) {
      return false;
    }
    if (reserved.has(p.id)) {
      return false;
    }
    return true;
  });
}

/** セレクト共通クラス */
export const selectClass =
  'w-full rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs text-zinc-800 shadow-sm transition-shadow focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400/20';

/** 無効時セレクト */
export const selectDisabledClass =
  'w-full cursor-not-allowed rounded-lg border border-zinc-200 bg-zinc-100 px-2 py-1.5 text-xs text-zinc-400';

/** ログ1行 */
export type ResolveLogEntry = {
  id: number;
  line: string;
};

/**
 * その勢力のユニット命令が論理的に埋まっているか。
 *
 * @param board - 盤面
 * @param unitOrders - 全ユニットの入力
 * @param powerId - 勢力ID
 */
export function isPowerOrdersComplete(
  board: BoardState,
  unitOrders: Record<string, UnitOrderInput>,
  powerId: string,
): boolean {
  const units = board.units.filter((u) => u.powerId === powerId);
  for (const unit of units) {
    const input = unitOrders[unit.id] ?? emptyOrder();
    switch (input.type) {
      case OrderType.Hold:
        break;
      case OrderType.Move:
        if (!input.targetProvinceId) {
          return false;
        }
        if (unit.type === UnitType.Fleet) {
          const multi = fleetArrivalCoasts(
            input.targetProvinceId,
            unit.provinceId,
          );
          if (multi.length > 1) {
            if (!asFleetCoast(input.moveTargetFleetCoast)) {
              return false;
            }
          }
        }
        break;
      case OrderType.Support:
        if (!input.supportedUnitId || !input.supportToProvinceId) {
          return false;
        }
        break;
      case OrderType.Convoy:
        if (!input.convoyArmyId || !input.convoyToProvinceId) {
          return false;
        }
        break;
      default:
        break;
    }
  }
  return true;
}

/**
 * 調整フェーズでその勢力の削減・増産スロットが埋まっているか（確定ボタン相当の検証）。
 *
 * @param board - 盤面
 * @param powerId - 勢力ID
 * @param disbandPlan - 削減計画
 * @param buildPlan - 増産計画
 */
export function isPowerAdjustmentSlotsFilled(
  board: BoardState,
  powerId: string,
  disbandPlan: Record<string, DisbandSlot[]>,
  buildPlan: Record<string, BuildSlot[]>,
): boolean {
  const need = disbandNeed(board, powerId);
  const cap = buildCapacity(board, powerId);
  if (need <= 0 && cap <= 0) {
    return true;
  }
  if (need > 0) {
    const slots = disbandPlan[powerId] ?? [];
    for (let i = 0; i < need; i += 1) {
      if (!slots[i]?.unitId) {
        return false;
      }
    }
  }
  if (cap > 0) {
    const slots = buildPlan[powerId] ?? [];
    for (let i = 0; i < cap; i += 1) {
      const slot = slots[i];
      if (!slot?.provinceId) {
        return false;
      }
      if (slot.unitType === UnitType.Fleet) {
        if (!canBuildFleetAtProvince(board, slot.provinceId)) {
          return false;
        }
      }
      if (
        slot.unitType === UnitType.Fleet &&
        isSplitProvince(slot.provinceId) &&
        asFleetCoast(slot.buildFleetCoast ?? '') == null
      ) {
        return false;
      }
    }
  }
  return true;
}

/** 盤面上でその勢力にユニットがあるか（命令入力の要否） */
export function powerHasUnits(board: BoardState, powerId: string): boolean {
  return board.units.some((u) => u.powerId === powerId);
}

/** 調整がその勢力に必要か */
export function powerNeedsAdjustment(board: BoardState, powerId: string): boolean {
  return disbandNeed(board, powerId) > 0 || buildCapacity(board, powerId) > 0;
}

/**
 * 勢力ごとの真偽マップを初期化する。
 *
 * @param powers - 勢力ID一覧
 */
export function emptyPowerBoolMap(powers: string[]): Record<string, boolean> {
  const m: Record<string, boolean> = {};
  for (const p of powers) {
    m[p] = false;
  }
  return m;
}
