/**
 * MapView 用: 条約オーバーレイ描画
 *
 * 概要:
 *   批准済み条約の地図表現（都市塗り・都市矢印）を SVG に重ねる。
 *
 * 想定される制限事項:
 *   - 州の塗りは data-province の形状をクローンして重ねるため、地図 SVG の属性に依存する。
 */

import { mapAnchorAlongConvoyPath, mapAnchorForUnit } from '@/components/mapView/mapViewBoardOverlay';
import type { AnchorLayers } from '@/components/mapView/mapViewTypes';
import { UnitType, type BoardState } from '@/domain';
import { SVG_NS } from '@/mapViewConstants';
import type { TreatyMapVisuals } from '@/diplomacy/treaties';

const TREATY_LAYER_ID = 'treaty-overlay';
const TREATY_MARKER_ID = 'treaty-overlay-arrowhead';

/**
 * 条約描画レイヤーを更新する。
 */
export function syncTreatyOverlay(
  svg: SVGSVGElement,
  board: BoardState,
  layers: AnchorLayers,
  treatyVisuals: TreatyMapVisuals | null | undefined,
): void {
  let overlay = svg.querySelector(`#${TREATY_LAYER_ID}`) as SVGGElement | null;
  if (!overlay) {
    overlay = document.createElementNS(SVG_NS, 'g');
    overlay.setAttribute('id', TREATY_LAYER_ID);
    overlay.setAttribute('class', 'map-overlay');
    overlay.setAttribute('pointer-events', 'none');
    const unitsLayer = svg.querySelector('#units-overlay');
    if (unitsLayer) {
      svg.insertBefore(overlay, unitsLayer);
    } else {
      svg.appendChild(overlay);
    }
  }
  while (overlay.firstChild) {
    overlay.removeChild(overlay.firstChild);
  }

  if (!treatyVisuals) {
    return;
  }

  let defs = svg.querySelector('defs');
  if (!defs) {
    defs = document.createElementNS(SVG_NS, 'defs');
    svg.insertBefore(defs, svg.firstChild);
  }
  let marker = defs.querySelector(`#${TREATY_MARKER_ID}`) as SVGMarkerElement | null;
  if (!marker) {
    marker = document.createElementNS(SVG_NS, 'marker');
    marker.setAttribute('id', TREATY_MARKER_ID);
    marker.setAttribute('viewBox', '0 0 10 10');
    marker.setAttribute('refX', '9');
    marker.setAttribute('refY', '5');
    marker.setAttribute('markerWidth', '5.5');
    marker.setAttribute('markerHeight', '5.5');
    marker.setAttribute('orient', 'auto');
    const tri = document.createElementNS(SVG_NS, 'path');
    tri.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
    tri.setAttribute('fill', '#9ca3af');
    marker.appendChild(tri);
    defs.appendChild(marker);
  }

  for (const fill of treatyVisuals.provinceFills) {
    const nodes = svg.querySelectorAll<SVGElement>(
      `[data-province="${fill.provinceId}"]`,
    );
    nodes.forEach((source, idx) => {
      const clone = source.cloneNode(true) as SVGElement;
      clone.removeAttribute('id');
      clone.setAttribute('data-treaty-fill', `${fill.provinceId}-${idx}`);
      clone.style.setProperty('fill', fill.color);
      clone.style.setProperty('fill-opacity', String(fill.opacity));
      clone.style.setProperty('stroke', 'none');
      overlay!.appendChild(clone);
    });
  }

  for (const arrow of treatyVisuals.provinceArrows) {
    const anchor = mapAnchorAlongConvoyPath(layers, board, arrow.provinceId);
    if (!anchor) {
      continue;
    }
    const fromX = anchor.x - 9;
    const fromY = anchor.y + 8;
    const toX = anchor.x + 9;
    const toY = anchor.y - 8;
    const ctrlX = anchor.x + 3;
    const ctrlY = anchor.y - 16;
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute(
      'd',
      `M ${fromX} ${fromY} Q ${ctrlX} ${ctrlY} ${toX} ${toY}`,
    );
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', arrow.color);
    path.setAttribute('stroke-width', '2');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('vector-effect', 'non-scaling-stroke');
    path.setAttribute('opacity', String(arrow.opacity));
    path.setAttribute('marker-end', `url(#${TREATY_MARKER_ID})`);
    overlay.appendChild(path);
  }

  // unitArrows: ユニット位置から位置への矢印（支援系）
  for (const arrow of treatyVisuals.unitArrows) {
    const fromAnchor = mapAnchorAlongConvoyPath(layers, board, arrow.fromProvinceId);
    const toAnchor = mapAnchorAlongConvoyPath(layers, board, arrow.toProvinceId);
    if (!fromAnchor || !toAnchor) {
      continue;
    }

    // from === to の場合（holdSupport）: 小さな円弧矢印
    if (arrow.fromProvinceId === arrow.toProvinceId) {
      const x = fromAnchor.x;
      const y = fromAnchor.y;
      const r = 8;
      const fromX = x - r;
      const fromY = y;
      const toX = x + r;
      const toY = y;
      const ctrlX = x;
      const ctrlY = y - r * 1.5;
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute(
        'd',
        `M ${fromX} ${fromY} Q ${ctrlX} ${ctrlY} ${toX} ${toY}`,
      );
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', arrow.color);
      path.setAttribute('stroke-width', '1.5');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('vector-effect', 'non-scaling-stroke');
      path.setAttribute('opacity', String(arrow.opacity));
      path.setAttribute('marker-end', `url(#${TREATY_MARKER_ID})`);
      overlay.appendChild(path);
    } else {
      // 通常の矢印: fromAnchor → toAnchor
      const dx = toAnchor.x - fromAnchor.x;
      const dy = toAnchor.y - fromAnchor.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      const ctrlX = (fromAnchor.x + toAnchor.x) / 2 + dy * 0.1;
      const ctrlY = (fromAnchor.y + toAnchor.y) / 2 - dx * 0.1;
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute(
        'd',
        `M ${fromAnchor.x} ${fromAnchor.y} Q ${ctrlX} ${ctrlY} ${toAnchor.x} ${toAnchor.y}`,
      );
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', arrow.color);
      path.setAttribute('stroke-width', '1.5');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('vector-effect', 'non-scaling-stroke');
      path.setAttribute('opacity', String(arrow.opacity));
      path.setAttribute('marker-end', `url(#${TREATY_MARKER_ID})`);
      overlay.appendChild(path);
    }
  }

  // unitPulses: ユニット位置のパルス強調
  const pulseStyle = svg.querySelector('style[data-treaty-pulse-animation]');
  if (treatyVisuals.unitPulses.length > 0 && !pulseStyle) {
    const style = document.createElementNS(SVG_NS, 'style');
    style.setAttribute('data-treaty-pulse-animation', 'true');
    style.textContent = `
      @keyframes treaty-pulse-opacity {
        0%   { opacity: 1;   }
        50%  { opacity: 0.5; }
        100% { opacity: 1;   }
      }
      .treaty-unit-pulse {
        animation: treaty-pulse-opacity 1.5s infinite;
      }
    `;
    svg.insertBefore(style, svg.firstChild);
  }

  for (const pulse of treatyVisuals.unitPulses) {
    const unit = board.units.find((u) => u.id === pulse.unitId);
    if (!unit) {
      continue;
    }
    const anchor = mapAnchorForUnit(layers, unit);
    if (!anchor) {
      continue;
    }

    const circle = document.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('cx', String(anchor.x));
    circle.setAttribute('cy', String(anchor.y));
    circle.setAttribute('r', '12');
    circle.setAttribute('fill', 'none');
    circle.setAttribute('stroke', '#FF1493');
    circle.setAttribute('stroke-width', '2');
    circle.setAttribute('class', 'treaty-unit-pulse');
    overlay.appendChild(circle);
  }
}
