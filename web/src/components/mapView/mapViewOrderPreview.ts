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
  findAllConvoyPathProvinceIdsForMove,
  isDirectMoveValid,
  isSplitProvince,
} from '@/mapMovement';
import {
  mapAnchorAlongConvoyPath,
  mapAnchorForUnit,
} from '@/components/mapView/mapViewBoardOverlay';
import type { AnchorLayers, Vec2 } from '@/components/mapView/mapViewTypes';
import { POWER_COLORS, SVG_NS } from '@/mapViewConstants';

/** プレビュー折れ線1本 */
export type OrderPreviewPolyline = {
  /** 表示種別 */
  kind: 'move' | 'support' | 'convoy';
  stroke: string;
  points: Vec2[];
};

const ORDER_PREVIEW_MARKERS_GROUP_ID = 'order-preview-markers';
const LEGACY_PREVIEW_MARKER_ID = 'order-preview-arrowhead';
const ORDER_PREVIEW_LAYER_ID = 'order-preview-overlay';

/**
 * stroke 文字列から一意なマーカー用 ID を作る（SVG id に安全な英数字）。
 *
 * @param stroke - CSS 色
 */
function markerElementIdForStroke(stroke: string): string {
  let h = 0;
  for (let i = 0; i < stroke.length; i += 1) {
    h = (Math.imul(31, h) + stroke.charCodeAt(i)) >>> 0;
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

  for (const unit of board.units) {
    const input = mergedUnitOrders[unit.id] ?? emptyOrder();
    const stroke = POWER_COLORS[unit.powerId] ?? '#6366f1';
    const from = mapAnchorForUnit(layers, unit);
    if (!from) {
      continue;
    }

    if (input.type === OrderType.Move && input.targetProvinceId) {
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
          const paths = findAllConvoyPathProvinceIdsForMove(
            board,
            domMove,
            domainOrders,
            adjKeys,
          );
          if (paths.length > 0) {
            let emitted = false;
            for (const path of paths) {
              if (path.length < 2) {
                continue;
              }
              const wps = path
                .map((pid) => mapAnchorAlongConvoyPath(layers, board, pid))
                .filter((v): v is Vec2 => v != null);
              if (wps.length >= 2) {
                result.push({ kind: 'convoy', stroke, points: wps });
                emitted = true;
              }
            }
            if (emitted) {
              continue;
            }
          }
        }
      }

      result.push({ kind: 'move', stroke, points: [from, to] });
      continue;
    }

    if (
      input.type === OrderType.Support &&
      input.supportedUnitId &&
      input.supportToProvinceId
    ) {
      const supported = board.units.find((u) => u.id === input.supportedUnitId);
      if (!supported) {
        continue;
      }
      const to = mapAnchorForUnit(layers, supported);
      if (!to) {
        continue;
      }
      result.push({ kind: 'support', stroke, points: [from, to] });
      continue;
    }

    if (
      input.type === OrderType.Convoy &&
      input.convoyArmyId &&
      input.convoyToProvinceId &&
      unit.type === UnitType.Fleet
    ) {
      const army = board.units.find((u) => u.id === input.convoyArmyId);
      if (!army) {
        continue;
      }
      const to = mapAnchorForUnit(layers, army);
      if (!to) {
        continue;
      }
      result.push({ kind: 'convoy', stroke, points: [from, to] });
      const convoyMove: MoveOrder = {
        type: OrderType.Move,
        unitId: army.id,
        sourceProvinceId: army.provinceId,
        targetProvinceId: input.convoyToProvinceId,
      };
      const paths = findAllConvoyPathProvinceIdsForMove(
        board,
        convoyMove,
        domainOrders,
        adjKeys,
      );
      for (const path of paths) {
        const wps = path
          .map((pid) => mapAnchorAlongConvoyPath(layers, board, pid))
          .filter((v): v is Vec2 => v != null);
        if (wps.length >= 2) {
          result.push({ kind: 'convoy', stroke, points: wps });
        }
      }
    }
  }

  return result;
}

/**
 * defs を確保し、プレビュー用マーカーを stroke 色ごとに再構築する。
 *
 * @param svg - 地図ルート SVG
 * @param strokeColors - 使用する線色の一覧（重複可）
 */
function syncOrderPreviewMarkersByStroke(
  svg: SVGSVGElement,
  strokeColors: readonly string[],
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
  for (const stroke of strokeColors) {
    if (seen.has(stroke)) {
      continue;
    }
    seen.add(stroke);
    const mid = markerElementIdForStroke(stroke);
    const marker = document.createElementNS(SVG_NS, 'marker');
    marker.setAttribute('id', mid);
    marker.setAttribute('viewBox', '0 0 10 10');
    marker.setAttribute('refX', '9');
    marker.setAttribute('refY', '5');
    marker.setAttribute('markerWidth', '5.5');
    marker.setAttribute('markerHeight', '5.5');
    marker.setAttribute('orient', 'auto-start-reverse');
    const tri = document.createElementNS(SVG_NS, 'path');
    tri.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
    tri.setAttribute('fill', stroke);
    marker.appendChild(tri);
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
  syncOrderPreviewMarkersByStroke(
    svg,
    drawable.map((pl) => pl.stroke),
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
  const pathDForPoints = (points: readonly Vec2[], curved: boolean): string => {
    if (points.length < 2) {
      return '';
    }
    if (!curved || points.length === 2) {
      return `M ${points[0]!.x} ${points[0]!.y} L ${points
        .slice(1)
        .map((p) => `${p.x} ${p.y}`)
        .join(' L ')}`;
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
    path.setAttribute('d', pathDForPoints(pl.points, curved));
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', pl.stroke);
    path.setAttribute('stroke-width', pl.kind === 'convoy' ? '2.5' : '2.2');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('vector-effect', 'non-scaling-stroke');
    path.setAttribute('opacity', pl.kind === 'convoy' ? '0.95' : '0.9');
    path.setAttribute(
      'marker-end',
      `url(#${markerElementIdForStroke(pl.stroke)})`,
    );
    if (pl.kind === 'support') {
      path.setAttribute('stroke-dasharray', '7 5');
    } else if (pl.kind === 'convoy') {
      path.setAttribute('stroke-dasharray', '10 5 2 5');
    }
    g.appendChild(path);
  }
}
