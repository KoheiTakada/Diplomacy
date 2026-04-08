/**
 * MapView 用: SVG 上の州占領・補給・ユニット・viewBox および applyBoardOverlay
 *
 * 概要:
 *   illustrator-map.svg に対し盤面状態を反映する純粋 DOM 操作をまとめる。
 *   支援線オーバーレイは mapViewSupportOverlay に委譲する。
 *
 * 制限:
 *   ブラウザ DOM API に依存する。テストは主に結合レベルで行う。
 */

import {
  AreaType,
  type BoardState,
  type Unit,
  UnitType,
} from '@/domain';
import { isSplitProvince } from '@/mapMovement';
import type { MapVisualEffect } from '@/mapVisualEffects';
import {
  CONVOY_PATH_MS,
  OCCUPATION_FILL_OPACITY,
  POWER_COLORS,
  STANDOFF_BUMP_MS,
  SVG_NS,
  UNIT_BADGE_RADIUS,
  UNIT_BADGE_STROKE,
  UNIT_BADGE_STROKE_WIDTH,
  UNIT_ICON_PX,
  UNIT_MOVE_ANIM_MS,
  UNIT_POS_EPS,
} from '@/mapViewConstants';
import type {
  AnchorLayers,
  UnitIconTemplates,
  Vec2,
  ViewBox,
} from '@/components/mapView/mapViewTypes';
import {
  easeInCubic,
  easeOutCubic,
} from '@/components/mapView/mapViewEasing';
import {
  getSupportBadgeStageForUnit,
  scaleForBadgeStage,
  scheduleReleaseSupportVisuals,
  syncSupportLinkOverlay,
} from '@/components/mapView/mapViewSupportOverlay';

function isNoneishFill(value: string | null): boolean {
  if (value == null || value === '') {
    return false;
  }
  const v = value.trim().toLowerCase();
  return v === 'none' || v === 'transparent';
}

/**
 * 明示的な白塗りか（ハイライト部分を白のまま残す判定用）。
 *
 * @param value - fill 属性値
 * @returns 白系なら true（属性なしは false：SVG 既定の黒は別扱い）
 */
function isWhiteFillValue(value: string | null): boolean {
  if (value == null || value === '') {
    return false;
  }
  const v = value.trim().toLowerCase();
  if (v === '#fff' || v === '#ffffff' || v === 'white') {
    return true;
  }
  const rgb = v.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgb) {
    const r = Number(rgb[1]);
    const g = Number(rgb[2]);
    const b = Number(rgb[3]);
    return r >= 250 && g >= 250 && b >= 250;
  }
  return false;
}

/**
 * ユニット用に複製した SVG 内の形状を塗り分ける。
 * 黒・既定塗りは勢力色、class st0 や明示白は #ffffff、none はそのまま。
 *
 * @param root - 複製したアイコン SVG ルート
 * @param powerColor - 勢力の代表色（HEX 推奨）
 */
function paintUnitIconGlyph(root: SVGSVGElement, powerColor: string): void {
  const selector = 'path, circle, rect, polygon, ellipse';
  root.querySelectorAll<SVGElement>(selector).forEach((el) => {
    const classes = (el.getAttribute('class') || '').split(/\s+/).filter(Boolean);
    const fillAttr = el.getAttribute('fill');
    if (classes.includes('st0') || isWhiteFillValue(fillAttr)) {
      el.setAttribute('fill', '#ffffff');
      el.removeAttribute('class');
      return;
    }
    if (isNoneishFill(fillAttr)) {
      return;
    }
    el.setAttribute('fill', powerColor);
  });
}

/**
 * fetch したユニットアイコン SVG 文字列を検証してルート要素を返す。
 *
 * @param svgText - SVG ソース全文
 * @returns svg ルート要素
 */
export function parseUnitSvgTemplate(svgText: string): SVGSVGElement {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const root = doc.documentElement;
  if (root.querySelector('parsererror')) {
    throw new Error('ユニットアイコン SVG の解析に失敗しました');
  }
  return root as unknown as SVGSVGElement;
}
function occupationFillForProvince(
  board: BoardState,
  provinceId: string,
): string | null {
  const unit = board.units.find((u) => u.provinceId === provinceId);
  if (unit) {
    return POWER_COLORS[unit.powerId] ?? null;
  }
  const meta = board.provinces.find((p) => p.id === provinceId);
  if (meta?.isSupplyCenter) {
    const owner = board.supplyCenterOwnership[provinceId];
    if (owner) {
      return POWER_COLORS[owner] ?? null;
    }
  }
  const sticky = board.provinceControlTint?.[provinceId];
  if (sticky) {
    return POWER_COLORS[sticky] ?? null;
  }
  return null;
}

/**
 * 補給都市マーカー（円）内部の塗り色。盤面のサプライ所有・州の占領とは無関係。
 * 本拠サプライは常にその国の代表色、初期中立サプライは常に白。
 *
 * @param board - 盤面（provinces の homePowerId を参照）
 * @param provinceId - data-supply または州 ID
 * @returns CSS 色（HEX）
 */
function supplyMarkerInteriorFill(
  board: BoardState,
  provinceId: string,
): string {
  const meta = board.provinces.find((p) => p.id === provinceId);
  if (!meta?.isSupplyCenter) {
    return '#ffffff';
  }
  if (meta.homePowerId) {
    return POWER_COLORS[meta.homePowerId] ?? '#e4e4e7';
  }
  return '#ffffff';
}

/**
 * data-province 形状に占領色を適用する。Sea は常に塗らず style を外す。
 * ユニット・サプライ所有が無い州は provinceControlTint の残存色を使い、
 * それも無ければ style を外して Illustrator のクラス色に戻す。
 */
function applyProvinceOccupationFills(
  svg: SVGSVGElement,
  board: BoardState,
): void {
  svg.querySelectorAll<SVGElement>('[data-province]').forEach((el) => {
    if (el.getAttribute('data-impassable') === 'true') {
      return;
    }
    if (el.getAttribute('data-area-type') === 'Sea') {
      el.style.removeProperty('fill');
      el.style.removeProperty('fill-opacity');
      return;
    }
    const id = el.getAttribute('data-province');
    if (!id) {
      return;
    }
    const color = occupationFillForProvince(board, id);
    if (color) {
      el.style.fill = color;
      el.style.fillOpacity = OCCUPATION_FILL_OPACITY;
    } else {
      el.style.removeProperty('fill');
      el.style.removeProperty('fill-opacity');
    }
  });
}

/**
 * SVG 内の unit-anchors-army / unit-anchors-fleet から座標表を作る。
 * 従来の単一 unit-anchors のみの場合は陸海ともに同一座標とみなす。
 */
export function readAnchorLayers(svg: SVGSVGElement): AnchorLayers {
  const readArmyGroup = (selector: string): Record<string, Vec2> => {
    const out: Record<string, Vec2> = {};
    svg.querySelectorAll(`${selector} circle[data-anchor]`).forEach((node) => {
      const id = node.getAttribute('data-anchor');
      const cx = node.getAttribute('cx');
      const cy = node.getAttribute('cy');
      if (!id || cx == null || cy == null) {
        return;
      }
      out[id] = { x: parseFloat(cx), y: parseFloat(cy) };
    });
    return out;
  };

  const readFleetGroup = (): Record<string, Vec2> => {
    const out: Record<string, Vec2> = {};
    svg.querySelectorAll('#unit-anchors-fleet circle[data-anchor]').forEach((node) => {
      const id = node.getAttribute('data-anchor');
      const coast = node.getAttribute('data-fleet-coast');
      const cx = node.getAttribute('cx');
      const cy = node.getAttribute('cy');
      if (!id || cx == null || cy == null) {
        return;
      }
      const key = coast ? `${id}|${coast}` : id;
      out[key] = { x: parseFloat(cx), y: parseFloat(cy) };
    });
    return out;
  };

  let army = readArmyGroup('#unit-anchors-army');
  let fleet = readFleetGroup();
  if (Object.keys(army).length === 0 && Object.keys(fleet).length === 0) {
    const legacy = readArmyGroup('#unit-anchors');
    army = { ...legacy };
    fleet = { ...legacy };
  }
  return { army, fleet };
}

/**
 * 分割岸の複数 fleet ドットの代表座標（平均）。単一キー `pid` があればそれを優先。
 */
function fleetRepresentativePosition(
  fleet: Record<string, Vec2>,
  provinceId: string,
): Vec2 | undefined {
  if (fleet[provinceId]) {
    return fleet[provinceId];
  }
  const prefix = `${provinceId}|`;
  const keys = Object.keys(fleet).filter((k) => k.startsWith(prefix));
  if (keys.length === 0) {
    return undefined;
  }
  let sx = 0;
  let sy = 0;
  for (const k of keys) {
    const p = fleet[k]!;
    sx += p.x;
    sy += p.y;
  }
  const n = keys.length;
  return { x: sx / n, y: sy / n };
}

/**
 * マップ SVG アンカー上のユニット表示位置（欠けていれば他レイヤーでフォールバック）。
 * 命令プレビュー折れ線などでも利用する。
 */
export function mapAnchorForUnit(layers: AnchorLayers, u: Unit): Vec2 | undefined {
  const pid = u.provinceId;
  if (u.type === UnitType.Army) {
    return layers.army[pid] ?? fleetRepresentativePosition(layers.fleet, pid);
  }
  if (u.type === UnitType.Fleet) {
    if (isSplitProvince(pid) && u.fleetCoast) {
      const k = `${pid}|${u.fleetCoast}`;
      if (layers.fleet[k]) {
        return layers.fleet[k];
      }
    }
    if (layers.fleet[pid]) {
      return layers.fleet[pid];
    }
    const rep = fleetRepresentativePosition(layers.fleet, pid);
    if (rep) {
      return rep;
    }
    return layers.army[pid];
  }
  return undefined;
}

/**
 * 2 点がほぼ同じ位置かどうか。
 *
 * @param a - 点 1
 * @param b - 点 2
 * @returns しきい値未満の差なら true
 */
function positionsNearlyEqual(a: Vec2, b: Vec2): boolean {
  return (
    Math.abs(a.x - b.x) < UNIT_POS_EPS && Math.abs(a.y - b.y) < UNIT_POS_EPS
  );
}

/**
 * 移動ユニットが目標としたプロヴィンスのアンカー座標（失敗時の「行き先」演出用）。
 *
 * @param layers - アンカー座標レイヤー
 * @param board - 盤面
 * @param movingUnit - 動いているユニット（種別・岸を引き継ぐ）
 * @param targetProvinceId - 命令上の移動先
 */
function anchorTowardTargetProvince(
  layers: AnchorLayers,
  board: BoardState,
  movingUnit: Unit,
  targetProvinceId: string,
): Vec2 | undefined {
  const dummy: Unit = {
    ...movingUnit,
    id: `${movingUnit.id}__bump_tgt`,
    provinceId: targetProvinceId,
  };
  return mapAnchorForUnit(layers, dummy);
}

/**
 * コンボイ経路の 1 マス分の表示座標（陸は陸軍アンカー、海は輸送艦隊の位置を優先）。
 *
 * @param layers - アンカー座標
 * @param board - 盤面
 * @param provinceId - プロヴィンス ID
 */
/** コンボイ経路の各プロヴィンスに対応する表示座標（プレビュー折れ線用） */
export function mapAnchorAlongConvoyPath(
  layers: AnchorLayers,
  board: BoardState,
  provinceId: string,
): Vec2 | undefined {
  const meta = board.provinces.find((p) => p.id === provinceId);
  if (!meta) {
    return undefined;
  }
  if (meta.areaType === AreaType.Sea) {
    const fleetHere = board.units.find(
      (uu) =>
        uu.type === UnitType.Fleet && uu.provinceId === provinceId,
    );
    if (fleetHere) {
      return mapAnchorForUnit(layers, fleetHere);
    }
    return fleetRepresentativePosition(layers.fleet, provinceId);
  }
  const landDummy: Unit = {
    id: '__convoy_path_land',
    type: UnitType.Army,
    powerId: 'ENG',
    provinceId,
  };
  return mapAnchorForUnit(layers, landDummy);
}

/**
 * 折れ線に沿った距離 dist の点を返す（先頭から累積）。
 *
 * @param waypoints - 頂点列
 * @param dist - 沿線距離
 */
function pointAlongPolyline(waypoints: Vec2[], dist: number): Vec2 {
  if (waypoints.length === 0) {
    return { x: 0, y: 0 };
  }
  if (waypoints.length === 1) {
    const a = waypoints[0]!;
    return { x: a.x, y: a.y };
  }
  let remaining = dist;
  for (let i = 0; i < waypoints.length - 1; i += 1) {
    const a = waypoints[i]!;
    const b = waypoints[i + 1]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (remaining > len) {
      remaining -= len;
      continue;
    }
    const t = len < 1e-6 ? 1 : Math.min(1, Math.max(0, remaining / len));
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
    };
  }
  const last = waypoints[waypoints.length - 1]!;
  return { x: last.x, y: last.y };
}

/**
 * スタンドオフ: bumpToward 方向へ reachDepth だけ進み、元位置へ戻す。
 *
 * @param reachDepth - 0〜1。複数ユニットの衝突では重心へ近づけるため 0.85 前後を使う
 */
function startStandoffBumpAnimation(
  g: SVGGElement,
  home: Vec2,
  bumpToward: Vec2,
  totalMs: number,
  reachDepth = 0.36,
): void {
  const dx = bumpToward.x - home.x;
  const dy = bumpToward.y - home.y;
  const peak = {
    x: home.x + dx * reachDepth,
    y: home.y + dy * reachDepth,
  };
  const tSplit = 0.44;
  const start = performance.now();
  const tick = (now: number) => {
    if (!g.isConnected) {
      return;
    }
    const u = Math.min(1, (now - start) / totalMs);
    let x: number;
    let y: number;
    if (u < tSplit) {
      const s = u / tSplit;
      const e = easeOutCubic(s);
      x = home.x + (peak.x - home.x) * e;
      y = home.y + (peak.y - home.y) * e;
    } else {
      const s = (u - tSplit) / (1 - tSplit);
      const e = easeInCubic(s);
      x = peak.x + (home.x - peak.x) * e;
      y = peak.y + (home.y - peak.y) * e;
    }
    g.setAttribute('transform', `translate(${x}, ${y})`);
    if (u < 1) {
      requestAnimationFrame(tick);
    }
  };
  g.setAttribute('transform', `translate(${home.x}, ${home.y})`);
  requestAnimationFrame(tick);
}

/**
 * 折れ線座標列に沿って等速に移動（コンボイ演出）。
 */
function startPathFollowAnimation(
  g: SVGGElement,
  waypoints: Vec2[],
  totalMs: number,
): void {
  if (waypoints.length < 2) {
    const p = waypoints[0];
    if (p) {
      g.setAttribute('transform', `translate(${p.x}, ${p.y})`);
    }
    return;
  }
  let totalLen = 0;
  for (let i = 1; i < waypoints.length; i += 1) {
    const a = waypoints[i - 1]!;
    const b = waypoints[i]!;
    totalLen += Math.hypot(b.x - a.x, b.y - a.y);
  }
  if (totalLen < 1e-6) {
    const p = waypoints[waypoints.length - 1]!;
    g.setAttribute('transform', `translate(${p.x}, ${p.y})`);
    return;
  }
  const start = performance.now();
  const tick = (now: number) => {
    if (!g.isConnected) {
      return;
    }
    const u = Math.min(1, (now - start) / totalMs);
    const dist = u * totalLen;
    const p = pointAlongPolyline(waypoints, dist);
    g.setAttribute('transform', `translate(${p.x}, ${p.y})`);
    if (u < 1) {
      requestAnimationFrame(tick);
    }
  };
  const p0 = waypoints[0]!;
  g.setAttribute('transform', `translate(${p0.x}, ${p0.y})`);
  requestAnimationFrame(tick);
}

/**
 * 経路点列を、アンカー通過のベジェ曲線 path へ変換する。
 */
function bezierPathDFromPoints(points: readonly Vec2[]): string {
  if (points.length < 2) {
    return '';
  }
  if (points.length === 2) {
    return `M ${points[0]!.x} ${points[0]!.y} L ${points[1]!.x} ${points[1]!.y}`;
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
}

/**
 * ユニット用の g を from から to へユーザー座標で移動させる。
 * DOM から外れたら中断する。
 *
 * @param g - transform の付いたグループ（子は原点中心）
 * @param from - 開始 translate
 * @param to - 終了 translate
 * @param durationMs - 所要時間
 */
function startUnitMoveAnimation(
  g: SVGGElement,
  from: Vec2,
  to: Vec2,
  durationMs: number,
): void {
  const start = performance.now();
  const tick = (now: number) => {
    if (!g.isConnected) {
      return;
    }
    const u = Math.min(1, (now - start) / durationMs);
    const e = easeOutCubic(u);
    const x = from.x + (to.x - from.x) * e;
    const y = from.y + (to.y - from.y) * e;
    g.setAttribute('transform', `translate(${x}, ${y})`);
    if (u < 1) {
      requestAnimationFrame(tick);
    }
  };
  requestAnimationFrame(tick);
}

/**
 * ユニット記号（円・アイコン・岸ラベル）を原点基準で g に追加する。
 *
 * @param g - 親グループ（外側で translate 済み）
 * @param u - ユニット
 * @param unitColor - 勢力色
 * @param unitIcons - アイコンテンプレート（無ければ円のみ）
 * @param badgeStageLevel - 移動支援線接続完了の累積段数（0 でスケール 1）
 */
function appendUnitShapesToGroup(
  g: SVGGElement,
  u: Unit,
  unitColor: string,
  unitIcons: UnitIconTemplates | null,
  badgeStageLevel = 0,
  staticSupportBoost = 0,
): void {
  const inner = document.createElementNS(SVG_NS, 'g');
  inner.setAttribute('data-unit-badge-inner', '1');
  const scale = scaleForBadgeStage(badgeStageLevel + staticSupportBoost);
  inner.setAttribute('transform', `scale(${scale})`);
  g.appendChild(inner);
  const target = inner;

  const iconHalf = UNIT_ICON_PX / 2;

  const disc = document.createElementNS(SVG_NS, 'circle');
  disc.setAttribute('cx', '0');
  disc.setAttribute('cy', '0');
  disc.setAttribute('r', String(UNIT_BADGE_RADIUS));
  disc.setAttribute('fill', '#ffffff');
  disc.setAttribute('stroke', UNIT_BADGE_STROKE);
  disc.setAttribute('stroke-width', String(UNIT_BADGE_STROKE_WIDTH));
  disc.setAttribute('vector-effect', 'non-scaling-stroke');
  target.appendChild(disc);

  if (unitIcons) {
    const tpl = u.type === UnitType.Army ? unitIcons.army : unitIcons.fleet;
    const nest = tpl.cloneNode(true) as SVGSVGElement;
    nest.removeAttribute('id');
    nest.querySelectorAll('defs').forEach((d) => {
      d.parentNode?.removeChild(d);
    });
    paintUnitIconGlyph(nest, unitColor);
    nest.setAttribute('x', String(-iconHalf));
    nest.setAttribute('y', String(-iconHalf));
    nest.setAttribute('width', String(UNIT_ICON_PX));
    nest.setAttribute('height', String(UNIT_ICON_PX));
    nest.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    target.appendChild(nest);
  }

  if (
    u.type === UnitType.Fleet &&
    u.fleetCoast &&
    isSplitProvince(u.provinceId)
  ) {
    const tc = document.createElementNS(SVG_NS, 'text');
    tc.setAttribute('x', '0');
    tc.setAttribute('y', String(UNIT_BADGE_RADIUS + 6));
    tc.setAttribute('text-anchor', 'middle');
    tc.setAttribute('dominant-baseline', 'hanging');
    tc.setAttribute('font-size', '7');
    tc.setAttribute('fill', '#475569');
    tc.setAttribute('font-weight', '600');
    tc.textContent = u.fleetCoast;
    target.appendChild(tc);
  }
}

/**
 * viewBox 属性文字列を数値タプルに分解する。
 */
export function parseViewBoxAttr(s: string | null): ViewBox | null {
  if (!s) {
    return null;
  }
  const parts = s.trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) {
    return null;
  }
  return { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
}

/**
 * viewBox を地図 SVG の論理範囲内に収める。全体表示より縮小したり地図外へパンしない。
 *
 * @param v - 適用したい viewBox
 * @param extent - 地図全体（初期 fetch 時の viewBox）
 * @returns クランプ後の viewBox
 */
export function clampViewBoxToMapExtent(v: ViewBox, extent: ViewBox): ViewBox {
  const ew = extent.w;
  const eh = extent.h;
  if (ew <= 0 || eh <= 0) {
    return v;
  }
  const mapAr = ew / eh;
  let w = Math.min(v.w, ew);
  let h = w / mapAr;
  if (h > eh) {
    h = eh;
    w = h * mapAr;
  }
  const minX = extent.x;
  const maxX = extent.x + ew - w;
  const minY = extent.y;
  const maxY = extent.y + eh - h;
  const x = Math.min(Math.max(minX, v.x), maxX);
  const y = Math.min(Math.max(minY, v.y), maxY);
  return { x, y, w, h };
}

/**
 * 州の占領色・補給マーカー色・ユニットレイヤーを盤面に合わせて更新する。
 *
 * @param unitIcons - 未ロード時は null（ユニット記号は描画しない）
 * @param previousBoard - 直前の盤面。指定時、同一ユニットの座標変化に移動アニメーションを付ける
 * @param mapEffects - スタンドオフ・コンボイなど盤面だけでは足りない演出
 */
export function applyBoardOverlay(
  svg: SVGSVGElement,
  board: BoardState,
  layers: AnchorLayers,
  unitIcons: UnitIconTemplates | null,
  previousBoard: BoardState | null,
  mapEffects: readonly MapVisualEffect[] | null,
  staticSupportCountByUnitId?: Record<string, number>,
): void {
  applyProvinceOccupationFills(svg, board);

  const legacyEdges = svg.querySelector('#adjacency-edges');
  if (legacyEdges?.parentNode) {
    legacyEdges.parentNode.removeChild(legacyEdges);
  }

  svg.querySelectorAll<SVGCircleElement>('[data-supply]').forEach((c) => {
    const id = c.getAttribute('data-supply');
    if (!id) {
      return;
    }
    const interior = supplyMarkerInteriorFill(board, id);
    c.style.setProperty('fill', interior);
    c.style.setProperty('fill-opacity', '1');
    const meta = board.provinces.find((p) => p.id === id);
    const owner = board.supplyCenterOwnership[id];
    const strokeCol =
      meta?.homePowerId != null
        ? '#231815'
        : owner
          ? (POWER_COLORS[owner] ?? '#231815')
          : '#231815';
    c.style.setProperty('stroke', strokeCol);
    const strokeW = meta?.homePowerId ? '1.6' : '1.1';
    c.style.setProperty('stroke-width', strokeW);
  });

  let unitsLayer = svg.querySelector('#units-overlay');
  if (!unitsLayer) {
    unitsLayer = document.createElementNS(SVG_NS, 'g');
    unitsLayer.setAttribute('id', 'units-overlay');
    unitsLayer.setAttribute('class', 'map-overlay');
    svg.appendChild(unitsLayer);
  }

  let linkLayer = svg.querySelector('#support-links-overlay');
  if (!linkLayer) {
    linkLayer = document.createElementNS(SVG_NS, 'g');
    linkLayer.setAttribute('id', 'support-links-overlay');
    linkLayer.setAttribute('class', 'map-overlay');
    svg.insertBefore(linkLayer, unitsLayer);
  } else if (linkLayer.nextSibling !== unitsLayer) {
    svg.insertBefore(linkLayer, unitsLayer);
  }

  let convoyLayer = svg.querySelector('#convoy-links-overlay');
  if (!convoyLayer) {
    convoyLayer = document.createElementNS(SVG_NS, 'g');
    convoyLayer.setAttribute('id', 'convoy-links-overlay');
    convoyLayer.setAttribute('class', 'map-overlay');
    svg.insertBefore(convoyLayer, unitsLayer);
  } else if (convoyLayer.nextSibling !== unitsLayer) {
    svg.insertBefore(convoyLayer, unitsLayer);
  }
  while (convoyLayer.firstChild) {
    convoyLayer.removeChild(convoyLayer.firstChild);
  }

  while (unitsLayer.firstChild) {
    unitsLayer.removeChild(unitsLayer.firstChild);
  }

  const effectByUnitId = new Map<string, MapVisualEffect>();
  if (mapEffects != null) {
    for (const e of mapEffects) {
      if (e.type === 'standoffCollision') {
        for (const uid of e.unitIds) {
          if (!effectByUnitId.has(uid)) {
            effectByUnitId.set(uid, e);
          }
        }
      } else if (
        e.type === 'supportLink' ||
        e.type === 'supportLinkRevoke' ||
        e.type === 'releaseSupportVisualsAfterMove' ||
        e.type === 'convoyPathLink'
      ) {
        // 支援線レイヤー・タイマーで別途処理
      } else {
        if (!effectByUnitId.has(e.unitId)) {
          effectByUnitId.set(e.unitId, e);
        }
      }
    }
  }

  if (mapEffects != null) {
    for (const e of mapEffects) {
      if (e.type !== 'convoyPathLink') {
        continue;
      }
      const wps: Vec2[] = [];
      for (const pid of e.pathProvinceIds) {
        const v = mapAnchorAlongConvoyPath(layers, board, pid);
        if (v != null) {
          wps.push(v);
        }
      }
      if (wps.length < 2) {
        continue;
      }
      const convoyUnit = board.units.find((u) => u.id === e.convoyUnitId);
      const stroke = POWER_COLORS[convoyUnit?.powerId ?? ''] ?? '#0ea5e9';
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', bezierPathDFromPoints(wps));
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', stroke);
      path.setAttribute('stroke-width', '2.4');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
      path.setAttribute('vector-effect', 'non-scaling-stroke');
      path.setAttribute(
        'stroke-dasharray',
        e.tentative === true ? '6 5 2 5' : '10 5 2 5',
      );
      path.setAttribute('opacity', e.tentative === true ? '0.8' : '0.95');
      convoyLayer.appendChild(path);
    }
  }

  for (const u of board.units) {
    const pos = mapAnchorForUnit(layers, u);
    if (!pos) {
      continue;
    }
    const prevU = previousBoard?.units.find((x) => x.id === u.id);
    const prevPos =
      prevU != null ? mapAnchorForUnit(layers, prevU) : undefined;
    const shouldAnimateMove =
      prevPos != null && !positionsNearlyEqual(prevPos, pos);

    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('data-unit-id', u.id);
    const unitColor = POWER_COLORS[u.powerId] ?? '#334155';
    const badgeStage = getSupportBadgeStageForUnit(u.id);
    const staticBoost = staticSupportCountByUnitId?.[u.id] ?? 0;
    appendUnitShapesToGroup(
      g,
      u,
      unitColor,
      unitIcons,
      badgeStage,
      staticBoost,
    );

    const fx = effectByUnitId.get(u.id);

    if (fx?.type === 'standoffCollision') {
      const home = pos;
      let bump = mapAnchorAlongConvoyPath(
        layers,
        board,
        fx.targetProvinceId,
      );
      if (bump == null) {
        bump = anchorTowardTargetProvince(
          layers,
          board,
          u,
          fx.targetProvinceId,
        );
      }
      if (bump != null && !positionsNearlyEqual(home, bump)) {
        startStandoffBumpAnimation(g, home, bump, STANDOFF_BUMP_MS, 0.88);
      } else {
        g.setAttribute('transform', `translate(${pos.x}, ${pos.y})`);
      }
      unitsLayer.appendChild(g);
      continue;
    }

    if (fx?.type === 'standoffBounce') {
      const home = pos;
      const bump = anchorTowardTargetProvince(
        layers,
        board,
        u,
        fx.targetProvinceId,
      );
      if (bump != null && !positionsNearlyEqual(home, bump)) {
        startStandoffBumpAnimation(g, home, bump, STANDOFF_BUMP_MS);
      } else {
        g.setAttribute('transform', `translate(${pos.x}, ${pos.y})`);
      }
      unitsLayer.appendChild(g);
      continue;
    }

    if (fx?.type === 'convoyAlongPath') {
      const wps: Vec2[] = [];
      for (const pid of fx.pathProvinceIds) {
        const v = mapAnchorAlongConvoyPath(layers, board, pid);
        if (v) {
          wps.push(v);
        }
      }
      if (wps.length >= 2) {
        startPathFollowAnimation(g, wps, CONVOY_PATH_MS);
        unitsLayer.appendChild(g);
        continue;
      }
    }

    if (shouldAnimateMove) {
      g.setAttribute('transform', `translate(${prevPos!.x}, ${prevPos!.y})`);
      startUnitMoveAnimation(g, prevPos!, pos, UNIT_MOVE_ANIM_MS);
    } else {
      g.setAttribute('transform', `translate(${pos.x}, ${pos.y})`);
    }
    unitsLayer.appendChild(g);
  }

  syncSupportLinkOverlay(svg, linkLayer as SVGGElement, mapEffects, board);

  if (mapEffects != null) {
    for (const e of mapEffects) {
      if (e.type === 'releaseSupportVisualsAfterMove') {
        scheduleReleaseSupportVisuals(svg, e.unitId, e.delayMs);
      }
    }
  }
}
