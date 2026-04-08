/**
 * MapView 用: 条約オーバーレイ描画
 *
 * 概要:
 *   批准済み条約の地図表現（都市塗り・都市矢印）を SVG に重ねる。
 *
 * 想定される制限事項:
 *   - 州の塗りは data-province の形状をクローンして重ねるため、地図 SVG の属性に依存する。
 */

import { mapAnchorAlongConvoyPath } from '@/components/mapView/mapViewBoardOverlay';
import type { AnchorLayers } from '@/components/mapView/mapViewTypes';
import type { BoardState } from '@/domain';
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
}
