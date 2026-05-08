/**
 * MapView 用: 命令入力のプレビュー折れ線（移動・支援・輸送）
 *
 * 概要:
 *   移動は実線、支援・輸送艦→陸軍の指示は破線。
 *   陸軍の海上移動は `findConvoyPathProvinceIdsForMove` の経路に沿って折れ線を描く。
 *
 * 制限:
 *   コンボイ経路が入力から一意に定まらない場合は直線フォールバック。
 *   マルチインスタンスの MapView では各 SVG ごとにレイヤを再構築する。
 *   矢じりは折れ線の stroke 色（勢力色）に合わせ、色ごとに marker を生成する。
 */

import {
  OrderType,
  type BoardState,
  type MoveOrder,
  type Unit,
  UnitType,
} from '@/domain';
import {
  asFleetCoast,
  buildDomainOrdersFromInputs,
  emptyOrder,
  type UnitOrderInput,
} from '@/diplomacy/gameHelpers';
import {
  buildAdjacencyKeySet,
  findAllConvoyPathProvinceIdsForArmyDestination,
  isDirectMoveValid,
  isSplitProvince,
} from '@/mapMovement';
import {
  mapAnchorAlongConvoyPath,
  mapAnchorForUnit,
} from '@/components/mapView/mapViewBoardOverlay';
import type { AnchorLayers, Vec2 } from '@/components/mapView/mapViewTypes';
import { SVG_NS } from '@/mapViewConstants';

/** プレビュー折れ線1本 */
export type OrderPreviewPolyline = {
  /** 表示種別 */
  kind: 'move' | 'support' | 'convoy';
  stroke: string;
  points: Vec2[];
  dashed?: boolean;
  pathD?: string;
  isFailing?: boolean;
};

/**
 * 命令種別の矢印色（すべて黒に統一）
 */
const CUDO_ORDER_COLORS = {
  move: '#000000',    // 黒
  support: '#000000', // 黒
  convoy: '#000000',  // 黒
} as const;

const ORDER_PREVIEW_MARKERS_GROUP_ID = 'order-preview-markers';
const LEGACY_PREVIEW_MARKER_ID = 'order-preview-arrowhead';
const ORDER_PREVIEW_LAYER_ID = 'order-preview-overlay';

/**
 * 4点文脈で区間ごとの滑らかな3次ベジェ経路を作る（Catmull-Rom 近似）。
 */
function segmentBezierPathDFromContext(
  p0: Vec2,
  p1: Vec2,
  p2: Vec2,
  p3: Vec2,
): string {
  const t = 1 / 6;
  const c1 = {
    x: p1.x + (p2.x - p0.x) * t,
    y: p1.y + (p2.y - p0.y) * t,
  };
  const c2 = {
    x: p2.x - (p3.x - p1.x) * t,
    y: p2.y - (p3.y - p1.y) * t,
  };
  return `M ${p1.x} ${p1.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${p2.x} ${p2.y}`;
}

/**
 * stroke 文字列と kind から一意なマーカー用 ID を作る（SVG id に安全な英数字）。
 *
 * @param stroke - CSS 色
 * @param kind - 命令種別
 */
function markerElementIdForStrokeAndKind(stroke: string, kind: 'move' | 'support' | 'convoy'): string {
  let h = 0;
  const str = stroke + kind;
  for (let i = 0; i < str.length; i += 1) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) >>> 0;
  }
  return `order-preview-m-${h.toString(16)}`;
}

/**
 * 移動先プロヴィンスのアンカー（艦隊の分割岸は UI 入力を反映）。
 *
 * @param layers - アンカー座標
 * @param mover - 動かすユニット
 * @param targetProvinceId - 移動先 ID
 * @param moveTargetFleetCoast - 到着岸（NC/SC/EC）
 */
function mapAnchorForMoveDestination(
  layers: AnchorLayers,
  mover: Unit,
  targetProvinceId: string,
  moveTargetFleetCoast: string,
): Vec2 | undefined {
  const coastPick = asFleetCoast(moveTargetFleetCoast);
  const dummy: Unit = {
    ...mover,
    id: `${mover.id}__preview_move_dest`,
    provinceId: targetProvinceId,
    fleetCoast:
      mover.type === UnitType.Fleet &&
      isSplitProvince(targetProvinceId) &&
      coastPick != null
        ? coastPick
        : undefined,
  };
  return mapAnchorForUnit(layers, dummy);
}

/**
 * マージ済み命令からプレビュー折れ線を生成する。
 *
 * @param board - 盤面
 * @param layers - SVG アンカー
 * @param mergedUnitOrders - 自国実入力＋他国想定をマージしたマップ
 */
export function buildOrderPreviewPolylines(
  board: BoardState,
  layers: AnchorLayers,
  mergedUnitOrders: Record<string, UnitOrderInput>,
): OrderPreviewPolyline[] {
  const adjKeys = buildAdjacencyKeySet(board);
  const domainOrders = buildDomainOrdersFromInputs(board, mergedUnitOrders);
  const result: OrderPreviewPolyline[] = [];
  const fleetAtSeaByProvinceId = new Map(
    board.units
      .filter((u) => u.type === UnitType.Fleet)
      .map((u) => [u.provinceId, u]),
  );

  // ──── 失敗する命令の判定 ────
  const failingUnitIds = new Set<string>();

  // 1. スタンドオフ: 同じターゲットに複数の Move 命令
  const movesByTarget = new Map<string, string[]>();
  for (const [unitId, order] of Object.entries(mergedUnitOrders)) {
    if (order.type === OrderType.Move && order.targetProvinceId) {
      const target = order.targetProvinceId;
      if (!movesByTarget.has(target)) movesByTarget.set(target, []);
      movesByTarget.get(target)!.push(unitId);
    }
  }
  for (const [_target, unitIds] of movesByTarget.entries()) {
    if (unitIds.length >= 2) {
      unitIds.forEach((uid) => failingUnitIds.add(uid));
    }
  }

  // 2. 輸送なしで海域へ：陸軍が海に移動しようとしているが Convoy 命令がない
  for (const [unitId, order] of Object.entries(mergedUnitOrders)) {
    if (order.type === OrderType.Move) {
      const unit = board.units.find((u) => u.id === unitId);
      const targetProv = board.provinces.find((p) => p.id === order.targetProvinceId);
      if (
        unit &&
        unit.type === UnitType.Army &&
        targetProv &&
        targetProv.areaType === 'Sea'
      ) {
        // 陸軍が海に移動 → Convoy 命令があるか確認
        const hasConvoy = Object.entries(mergedUnitOrders).some(
          ([fid, forder]) =>
            forder.type === OrderType.Convoy &&
            forder.convoyArmyId === unitId &&
            forder.convoyToProvinceId === order.targetProvinceId,
        );
        if (!hasConvoy) {
          failingUnitIds.add(unitId);
        }
      }
    }
  }

  // 3. 支援失敗：支援先ユニットの命令と一致していない（全ユニット対象、想定行動ベース）
  for (const [unitId, order] of Object.entries(mergedUnitOrders)) {
    if (order.type === OrderType.Support && order.supportedUnitId) {
      const supportedOrder = mergedUnitOrders[order.supportedUnitId];

      // 支援先ユニットに命令がない → 失敗
      if (!supportedOrder) {
        failingUnitIds.add(unitId);
        continue;
      }

      // 移動支援の場合、支援先ユニットの実際の移動先と一致しているか確認
      if (order.supportToProvinceId) {
        if (supportedOrder.type !== OrderType.Move ||
            supportedOrder.targetProvinceId !== order.supportToProvinceId) {
          failingUnitIds.add(unitId);
        }
      }
      // 維持支援の場合、支援先ユニットが待機しているか確認
      else {
        if (supportedOrder.type === OrderType.Move) {
          // 支援先ユニットが移動している場合は維持支援失敗
          failingUnitIds.add(unitId);
        }
      }
    }
  }

  // 4. 支援カット：支援元ユニットが敵に攻撃される（同じプロビンスに移動される）
  for (const [unitId, order] of Object.entries(mergedUnitOrders)) {
    if (order.type === OrderType.Support) {
      const supporter = board.units.find((u) => u.id === unitId);
      if (!supporter) continue;

      // 他国のユニットが支援元ユニットを攻撃（同じプロビンスに移動）するかチェック
      const isCut = Object.entries(mergedUnitOrders).some(([otherId, otherOrder]) => {
        if (otherId === unitId) return false; // 自分自身は除外
        const otherUnit = board.units.find((u) => u.id === otherId);
        if (!otherUnit || otherUnit.powerId === supporter.powerId) return false; // 自国は除外

        if (otherOrder.type !== OrderType.Move) return false;

        // 支援元ユニットと同じプロビンスに移動する場合 → 支援カット
        return otherOrder.targetProvinceId === supporter.provinceId;
      });

      if (isCut) {
        failingUnitIds.add(unitId);
      }
    }
  }

  const hasMatchingConvoyOrder = (
    fleetUnitId: string,
    armyUnitId: string,
    targetProvinceId: string,
  ): boolean => {
    const o = mergedUnitOrders[fleetUnitId];
    if (!o || o.type !== OrderType.Convoy) {
      return false;
    }
    return o.convoyArmyId === armyUnitId && o.convoyToProvinceId === targetProvinceId;
  };
  const pushConvoySegmentsByPath = (
    pathProvinceIds: readonly string[],
    armyUnitId: string,
    targetProvinceId: string,
    dashed: boolean,
  ): void => {
    for (let i = 0; i < pathProvinceIds.length - 1; i += 1) {
      const fromPid = pathProvinceIds[i]!;
      const toPid = pathProvinceIds[i + 1]!;
      const a = mapAnchorAlongConvoyPath(layers, board, fromPid);
      const b = mapAnchorAlongConvoyPath(layers, board, toPid);
      if (!a || !b) {
        continue;
      }
      const fromSeaFleet = fleetAtSeaByProvinceId.get(fromPid);
      const toSeaFleet = fleetAtSeaByProvinceId.get(toPid);
      const responsibleFleet = fromSeaFleet ?? toSeaFleet;
      let segStroke = '#000000';
      if (responsibleFleet) {
        segStroke = hasMatchingConvoyOrder(
          responsibleFleet.id,
          armyUnitId,
          targetProvinceId,
        )
          ? CUDO_ORDER_COLORS.convoy
          : '#000000';
      }
      result.push({
        kind: 'convoy',
        stroke: segStroke,
        points: [a, b],
        dashed,
        pathD: segmentBezierPathDFromContext(
          i > 0
            ? mapAnchorAlongConvoyPath(layers, board, pathProvinceIds[i - 1]!) ?? a
            : a,
          a,
          b,
          i + 2 < pathProvinceIds.length
            ? mapAnchorAlongConvoyPath(layers, board, pathProvinceIds[i + 2]!) ?? b
            : b,
        ),
      });
    }
  };

  for (const unit of board.units) {
    const input = mergedUnitOrders[unit.id] ?? emptyOrder();
    const from = mapAnchorForUnit(layers, unit);
    if (!from) {
      continue;
    }

    if (input.type === OrderType.Move && input.targetProvinceId) {
      const stroke = CUDO_ORDER_COLORS.move;
      const domMove = domainOrders.find(
        (o): o is MoveOrder =>
          o.type === OrderType.Move && o.unitId === unit.id,
      );
      if (!domMove) {
        continue;
      }
      const to = mapAnchorForMoveDestination(
        layers,
        unit,
        input.targetProvinceId,
        input.moveTargetFleetCoast,
      );
      if (!to) {
        continue;
      }

      if (unit.type === UnitType.Army) {
        const direct = isDirectMoveValid(
          unit,
          unit.provinceId,
          domMove.targetProvinceId,
          board,
          adjKeys,
          { mode: 'adjudicate' },
        );
        if (!direct) {
          const paths = findAllConvoyPathProvinceIdsForArmyDestination(
            board,
            unit,
            domMove.targetProvinceId,
            adjKeys,
          );
          if (paths.length > 0) {
            let emitted = false;
            for (const path of paths) {
              if (path.length < 2) {
                continue;
              }
              pushConvoySegmentsByPath(
                path,
                unit.id,
                domMove.targetProvinceId,
                false,
              );
              if (path.length >= 2) {
                emitted = true;
              }
            }
            if (emitted) {
              continue;
            }
          }
        }
      }

      result.push({
        kind: 'move',
        stroke,
        points: [from, to],
        isFailing: failingUnitIds.has(unit.id),
      });
      continue;
    }

    if (
      input.type === OrderType.Support &&
      input.supportedUnitId &&
      input.supportToProvinceId
    ) {
      const stroke = CUDO_ORDER_COLORS.support;
      const supported = board.units.find((u) => u.id === input.supportedUnitId);
      if (!supported) {
        continue;
      }
      const to = mapAnchorForUnit(layers, supported);
      if (!to) {
        continue;
      }
      result.push({
        kind: 'support',
        stroke,
        points: [from, to],
        isFailing: failingUnitIds.has(unit.id),
      });
      continue;
    }

    if (
      input.type === OrderType.Convoy &&
      input.convoyArmyId &&
      input.convoyToProvinceId &&
      unit.type === UnitType.Fleet
    ) {
      const stroke = CUDO_ORDER_COLORS.convoy;
      const army = board.units.find((u) => u.id === input.convoyArmyId);
      if (!army) {
        continue;
      }
      const to = mapAnchorForUnit(layers, army);
      if (!to) {
        continue;
      }
      const paths = findAllConvoyPathProvinceIdsForArmyDestination(
        board,
        army,
        input.convoyToProvinceId,
        adjKeys,
      );
      if (paths.length === 0) {
        result.push({
          kind: 'convoy',
          stroke,
          points: [from, to],
          dashed: false,
        });
      }
      for (const path of paths) {
        if (path.length >= 2) {
          pushConvoySegmentsByPath(
            path,
            army.id,
            input.convoyToProvinceId,
            false,
          );
        }
      }
    }
  }

  return result;
}

/**
 * defs を確保し、プレビュー用マーカーを命令種別ごとに再構築する。
 *
 * @param svg - 地図ルート SVG
 * @param polylines - 描画する折れ線
 */
function syncOrderPreviewMarkers(
  svg: SVGSVGElement,
  polylines: readonly OrderPreviewPolyline[],
): void {
  let defs = svg.querySelector('defs');
  if (!defs) {
    defs = document.createElementNS(SVG_NS, 'defs');
    svg.insertBefore(defs, svg.firstChild);
  }

  const legacy = defs.querySelector(`#${LEGACY_PREVIEW_MARKER_ID}`);
  legacy?.parentNode?.removeChild(legacy);

  let group = defs.querySelector(
    `#${ORDER_PREVIEW_MARKERS_GROUP_ID}`,
  ) as SVGGElement | null;
  if (!group) {
    group = document.createElementNS(SVG_NS, 'g');
    group.setAttribute('id', ORDER_PREVIEW_MARKERS_GROUP_ID);
    defs.appendChild(group);
  }
  while (group.firstChild) {
    group.removeChild(group.firstChild);
  }

  const seen = new Set<string>();
  for (const pl of polylines) {
    const key = pl.stroke + pl.kind;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const mid = markerElementIdForStrokeAndKind(pl.stroke, pl.kind);
    const marker = document.createElementNS(SVG_NS, 'marker');
    marker.setAttribute('id', mid);
    // userSpaceOnUse で拡大縮小に比例するように設定
    marker.setAttribute('markerUnits', 'userSpaceOnUse');
    marker.setAttribute('orient', 'auto-start-reverse');

    let shape: SVGElement;
    if (pl.kind === 'move') {
      // 移動: 三角形 →
      marker.setAttribute('viewBox', '0 0 10 10');
      marker.setAttribute('refX', '5');
      marker.setAttribute('refY', '5');
      marker.setAttribute('markerWidth', '15');
      marker.setAttribute('markerHeight', '15');
      shape = document.createElementNS(SVG_NS, 'path');
      shape.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
      shape.setAttribute('fill', pl.stroke);
    } else if (pl.kind === 'support') {
      // 支援: 中アキの丸（2倍 × 1.1倍）
      marker.setAttribute('viewBox', '0 0 10 10');
      marker.setAttribute('refX', '5');
      marker.setAttribute('refY', '5');
      marker.setAttribute('markerWidth', '33');
      marker.setAttribute('markerHeight', '33');
      shape = document.createElementNS(SVG_NS, 'circle');
      shape.setAttribute('cx', '5');
      shape.setAttribute('cy', '5');
      shape.setAttribute('r', '3.5');
      shape.setAttribute('fill', 'none');
      shape.setAttribute('stroke', pl.stroke);
      shape.setAttribute('stroke-width', '0.8');
    } else {
      // 輸送: ダイヤ ◇
      marker.setAttribute('viewBox', '0 0 10 10');
      marker.setAttribute('refX', '5');
      marker.setAttribute('refY', '5');
      marker.setAttribute('markerWidth', '15');
      marker.setAttribute('markerHeight', '15');
      shape = document.createElementNS(SVG_NS, 'path');
      shape.setAttribute('d', 'M 5 0 L 10 5 L 5 10 L 0 5 z');
      shape.setAttribute('fill', pl.stroke);
    }
    marker.appendChild(shape);
    group.appendChild(marker);
  }
}

/**
 * 命令プレビュー用の g を更新する。`polylines` が空ならレイヤを空にする。
 *
 * @param svg - 地図ルート SVG
 * @param polylines - 描画する折れ線
 */
export function syncOrderPreviewOverlay(
  svg: SVGSVGElement,
  polylines: readonly OrderPreviewPolyline[],
): void {
  const drawable = polylines.filter((pl) => pl.points.length >= 2);
  syncOrderPreviewMarkers(
    svg,
    drawable,
  );

  let g = svg.querySelector(`#${ORDER_PREVIEW_LAYER_ID}`) as SVGGElement | null;
  if (!g) {
    g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('id', ORDER_PREVIEW_LAYER_ID);
    g.setAttribute('class', 'map-overlay');
    g.setAttribute('pointer-events', 'none');
    const unitsLayer = svg.querySelector('#units-overlay');
    if (unitsLayer) {
      svg.insertBefore(g, unitsLayer);
    } else {
      svg.appendChild(g);
    }
  }
  while (g.firstChild) {
    g.removeChild(g.firstChild);
  }

  // パルスアニメーション CSS を注入（失敗矢印用）
  const pulseStyle = svg.querySelector('style[data-order-preview-pulse]');
  if (!pulseStyle && drawable.some((pl) => pl.isFailing)) {
    const style = document.createElementNS(SVG_NS, 'style');
    style.setAttribute('data-order-preview-pulse', 'true');
    style.textContent = `
      @keyframes order-preview-pulse {
        0%   { opacity: 0.9; }
        50%  { opacity: 0.3; }
        100% { opacity: 0.9; }
      }
      .order-preview-pulse {
        animation: order-preview-pulse 1.5s infinite;
      }
    `;
    svg.insertBefore(style, svg.firstChild);
  }

  const pathDForPoints = (points: readonly Vec2[], curved: boolean): string => {
    if (points.length < 2) {
      return '';
    }
    if (!curved) {
      return `M ${points[0]!.x} ${points[0]!.y} L ${points
        .slice(1)
        .map((p) => `${p.x} ${p.y}`)
        .join(' L ')}`;
    }
    if (points.length === 2) {
      const a = points[0]!;
      const b = points[1]!;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.max(1, Math.hypot(dx, dy));
      const nx = -dy / len;
      const ny = dx / len;
      const bend = Math.min(26, len * 0.18);
      const cx = mx + nx * bend;
      const cy = my + ny * bend;
      return `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`;
    }
    const p0 = points[0]!;
    let d = `M ${p0.x} ${p0.y}`;
    for (let i = 1; i < points.length - 1; i += 1) {
      const p = points[i]!;
      const n = points[i + 1]!;
      const mx = (p.x + n.x) / 2;
      const my = (p.y + n.y) / 2;
      d += ` Q ${p.x} ${p.y} ${mx} ${my}`;
    }
    const prev = points[points.length - 2]!;
    const last = points[points.length - 1]!;
    d += ` Q ${prev.x} ${prev.y} ${last.x} ${last.y}`;
    return d;
  };
  for (const pl of drawable) {
    const path = document.createElementNS(SVG_NS, 'path');
    const curved = pl.kind === 'convoy';
    path.setAttribute('d', pl.pathD ?? pathDForPoints(pl.points, curved));
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', pl.stroke);
    path.setAttribute('stroke-width', pl.kind === 'convoy' ? '2.5' : '2.2');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('opacity', pl.kind === 'convoy' ? '0.95' : '0.9');
    path.setAttribute(
      'marker-end',
      `url(#${markerElementIdForStrokeAndKind(pl.stroke, pl.kind)})`,
    );
    if (pl.kind === 'support') {
      path.setAttribute('stroke-dasharray', '7 5');
    } else if (pl.kind === 'convoy' && pl.dashed === true) {
      path.setAttribute('stroke-dasharray', '10 5 2 5');
    }
    // 失敗矢印にパルスクラス
    if (pl.isFailing) {
      path.setAttribute('class', 'order-preview-pulse');
    }
    g.appendChild(path);
  }
}
