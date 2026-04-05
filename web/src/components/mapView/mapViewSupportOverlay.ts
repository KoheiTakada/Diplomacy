/**
 * MapView 用: 支援線オーバーレイと被支援ユニット記号の段階スケール
 *
 * 概要:
 *   supportLink / supportLinkRevoke / releaseSupportVisualsAfterMove の DOM・rAF 管理。
 *   モジュールスコープの Map で盤面更新をまたいだ状態を保持する。
 *
 * 制限:
 *   単一マップインスタンス想定。複数 MapView を同時にマウントする場合は別途分離が必要。
 */

import type { BoardState } from '@/domain';
import type { MapVisualEffect } from '@/mapVisualEffects';
import {
  BADGE_SCALE_ANIM_MS,
  POWER_COLORS,
  SUPPORT_LINE_DASH_UNIT,
  SUPPORT_LINE_GROW_MS,
  SUPPORT_LINE_STROKE_COLOR,
  SUPPORT_LINE_STROKE_WHITE,
  SUPPORT_MOVE_BADGE_SCALE_MAX,
  SUPPORT_MOVE_BADGE_SCALE_PER_SUPPORT,
  SVG_NS,
} from '@/mapViewConstants';
import {
  easeInCubic,
  easeOutCubic,
  easeOutCubicForSupportLine,
} from '@/components/mapView/mapViewEasing';
import type { Vec2 } from '@/components/mapView/mapViewTypes';

/** 移動支援の線が届くたびに被支援ユニット記号を段階拡大するカウンタ（解決シーケンス内） */
const badgeStageByUnitId = new Map<string, number>();

/**
 * 被支援記号スケールアニメの世代。新しいアニメ開始で増やし、古い rAF コールバックを無効化する。
 */
const badgeScaleAnimGenByUnitId = new Map<string, number>();

/**
 * 支援段階から最終スケール（クランプ済み）を求める。
 *
 * @param stage - 段階（0 で 1）
 * @returns スケール係数
 */
export function scaleForBadgeStage(stage: number): number {
  if (stage <= 0) {
    return 1;
  }
  return Math.min(
    1 + stage * SUPPORT_MOVE_BADGE_SCALE_PER_SUPPORT,
    SUPPORT_MOVE_BADGE_SCALE_MAX,
  );
}

/**
 * transform 属性文字列から scale の係数を読む（なければ 1）。
 *
 * @param t - transform 属性値
 * @returns スケール
 */
function parseScaleFromTransformAttr(t: string | null): number {
  if (t == null || t === '') {
    return 1;
  }
  const m = t.match(/scale\s*\(\s*([-.0-9eE+]+)/);
  return m != null ? Number(m[1]) : 1;
}

/**
 * ユニット記号内の data-unit-badge-inner を取得する。
 *
 * @param svg - 地図ルート SVG
 * @param unitId - ユニット ID
 * @returns 内側 g 要素。無ければ null
 */
function findUnitBadgeInner(
  svg: SVGSVGElement,
  unitId: string,
): Element | null {
  const overlay = svg.querySelector('#units-overlay');
  if (overlay == null) {
    return null;
  }
  const candidates = overlay.querySelectorAll<SVGGElement>('g[data-unit-id]');
  for (let i = 0; i < candidates.length; i += 1) {
    const node = candidates[i];
    if (node.getAttribute('data-unit-id') === unitId) {
      return node.querySelector('[data-unit-badge-inner]');
    }
  }
  return null;
}
function supportLinkStoreKey(
  supporterUnitId: string,
  supportedUnitId: string,
): string {
  return `${supporterUnitId}|${supportedUnitId}`;
}

type SupportLinkEntry = {
  /** 白線＋勢力色線をまとめた g */
  group: SVGGElement;
  lineWhite: SVGLineElement;
  lineColor: SVGLineElement;
  supporterUnitId: string;
  supportedUnitId: string;
  /** performance.now() 基準の期限。tentative 時は無限大 */
  until: number;
  tentative: boolean;
  /** 伸長アニメ開始時刻 */
  growStartedAt: number;
  growDurationMs: number;
  /** 線が届き切ったあと被支援記号を一段拡大するか */
  boostSupportedBadge: boolean;
  /**
   * true: until 無限（移動支援）。false: duration で消え、消滅時に拡大を 1 段戻す（維持支援）。
   */
  linePersistsUntilRelease: boolean;
  /** 伸長完了時のバッジ更新を既に行ったか */
  growCompleteFired: boolean;
};

/** 盤面更新をまたいで残す支援線（暫定線は revoke または次の上書きまで） */
const supportLinkEntryMap = new Map<string, SupportLinkEntry>();

/** 移動完了後に支援線を外すための unitId → setTimeout の ID */
const pendingReleaseSupportTimeouts = new Map<string, number>();

/**
 * boostSupportedBadge 付きの移動支援線をすべて DOM から外しマップから削除する。
 * 解決表示終了時の掃除用。
 */
export function clearAllBoostMoveSupportLinks(): void {
  for (const [k, ent] of [...supportLinkEntryMap]) {
    if (ent.boostSupportedBadge) {
      ent.group.remove();
      supportLinkEntryMap.delete(k);
    }
  }
}

/**
 * 被支援ユニットの移動（またはスタンドオフ等）が終わったあと、
 * 当該ユニット向けの移動支援線と記号拡大を解く。
 *
 * @param svg - 地図ルート SVG
 * @param supportedUnitId - 被支援側ユニット ID（＝動いた／跳ね返ったユニット）
 */
function releaseSupportVisualsForMover(
  svg: SVGSVGElement,
  supportedUnitId: string,
): void {
  const keysToRemove: string[] = [];
  for (const [k, ent] of supportLinkEntryMap) {
    if (ent.supportedUnitId === supportedUnitId && ent.boostSupportedBadge) {
      keysToRemove.push(k);
    }
  }
  for (let i = 0; i < keysToRemove.length; i += 1) {
    const k = keysToRemove[i];
    const ent = supportLinkEntryMap.get(k);
    if (ent != null) {
      ent.group.remove();
      supportLinkEntryMap.delete(k);
    }
  }
  badgeStageByUnitId.delete(supportedUnitId);
  applyBadgeInnerScale(svg, supportedUnitId);
}

/** 保留中の「移動完了後解除」タイマーをすべてキャンセルする */
export function clearAllReleaseSupportTimeouts(): void {
  for (const tid of pendingReleaseSupportTimeouts.values()) {
    window.clearTimeout(tid);
  }
  pendingReleaseSupportTimeouts.clear();
}

/**
 * delayMs 後に当該被支援ユニットの移動支援視覚を解く。同一 unitId は直前の予約を上書き。
 *
 * @param svg - 地図ルート SVG（ref 未設定時のフォールバック）
 * @param unitId - 被支援ユニット ID
 * @param delayMs - 遅延（ミリ秒）
 */
export function scheduleReleaseSupportVisuals(
  svg: SVGSVGElement,
  unitId: string,
  delayMs: number,
): void {
  const prev = pendingReleaseSupportTimeouts.get(unitId);
  if (prev != null) {
    window.clearTimeout(prev);
  }
  const tid = window.setTimeout(() => {
    pendingReleaseSupportTimeouts.delete(unitId);
    const targetSvg = supportLinkSvgRef ?? svg;
    releaseSupportVisualsForMover(targetSvg, unitId);
  }, Math.max(0, delayMs));
  pendingReleaseSupportTimeouts.set(unitId, tid);
}

let supportLinkRafId = 0;
let supportLinkSvgRef: SVGSVGElement | null = null;
let supportLinkLayerRef: SVGGElement | null = null;

/**
 * 被支援記号のスケールを targetScale へイージング付きで変化させる。
 * 拡大時は ease-out、縮小時は ease-in。連続した場合は直前のアニメを打ち切る。
 *
 * @param svg - 地図ルート SVG
 * @param unitId - ユニット ID
 * @param targetScale - 目標スケール
 */
function animateBadgeInnerToScale(
  svg: SVGSVGElement,
  unitId: string,
  targetScale: number,
): void {
  const inner = findUnitBadgeInner(svg, unitId);
  if (inner == null) {
    return;
  }
  const nextGen = (badgeScaleAnimGenByUnitId.get(unitId) ?? 0) + 1;
  badgeScaleAnimGenByUnitId.set(unitId, nextGen);

  const fromScale = parseScaleFromTransformAttr(inner.getAttribute('transform'));
  if (Math.abs(fromScale - targetScale) < 1e-4) {
    inner.setAttribute('transform', `scale(${targetScale})`);
    if (badgeScaleAnimGenByUnitId.get(unitId) === nextGen) {
      badgeScaleAnimGenByUnitId.delete(unitId);
    }
    return;
  }
  const growing = targetScale > fromScale;
  const start = performance.now();

  const tick = (now: number) => {
    if (badgeScaleAnimGenByUnitId.get(unitId) !== nextGen || !inner.isConnected) {
      return;
    }
    const u = Math.min(1, (now - start) / BADGE_SCALE_ANIM_MS);
    const eased = growing ? easeOutCubic(u) : easeInCubic(u);
    const s = fromScale + (targetScale - fromScale) * eased;
    inner.setAttribute('transform', `scale(${s})`);
    if (u < 1) {
      requestAnimationFrame(tick);
    } else {
      inner.setAttribute('transform', `scale(${targetScale})`);
      if (badgeScaleAnimGenByUnitId.get(unitId) === nextGen) {
        badgeScaleAnimGenByUnitId.delete(unitId);
      }
    }
  };
  requestAnimationFrame(tick);
}

/**
 * badgeStageByUnitId の段階に合わせ、記号スケールをイージング付きで更新する。
 *
 * @param svg - 地図ルート SVG
 * @param unitId - ユニット ID
 */
function applyBadgeInnerScale(svg: SVGSVGElement, unitId: string): void {
  const stage = badgeStageByUnitId.get(unitId) ?? 0;
  animateBadgeInnerToScale(svg, unitId, scaleForBadgeStage(stage));
}

/**
 * 移動支援の線が接続完了したときに呼び、被支援ユニットの段階を 1 上げる。
 *
 * @param svg - 地図ルート SVG
 * @param supportedUnitId - 被支援ユニット ID
 */
function bumpSupportedBadgeStage(
  svg: SVGSVGElement,
  supportedUnitId: string,
): void {
  const next = (badgeStageByUnitId.get(supportedUnitId) ?? 0) + 1;
  badgeStageByUnitId.set(supportedUnitId, next);
  applyBadgeInnerScale(svg, supportedUnitId);
}

/**
 * #units-overlay 内の data-unit-id 付き g から translate(x,y) を読む。
 *
 * @param svg - 地図ルート SVG
 * @param unitId - ユニット ID
 * @returns ユーザー座標。未設定・パース不能時は null
 */
function readUnitGroupTranslate(
  svg: SVGSVGElement,
  unitId: string,
): Vec2 | null {
  const overlay = svg.querySelector('#units-overlay');
  if (!overlay) {
    return null;
  }
  const groups = overlay.querySelectorAll('g[data-unit-id]');
  for (const node of groups) {
    if (node.getAttribute('data-unit-id') !== unitId) {
      continue;
    }
    const t = node.getAttribute('transform');
    if (t == null || t === '') {
      return null;
    }
    const m = t.match(/translate\s*\(\s*([-.0-9]+)\s*,\s*([-.0-9]+)\s*\)/);
    if (!m) {
      return null;
    }
    return { x: Number(m[1]), y: Number(m[2]) };
  }
  return null;
}

/**
 * 登録済み支援線の座標を毎フレーム更新し、期限切れを DOM から外す。
 */
function tickSupportLinks(): void {
  supportLinkRafId = 0;
  const svg = supportLinkSvgRef;
  const layer = supportLinkLayerRef;
  if (svg == null || layer == null) {
    return;
  }
  const now = performance.now();
  for (const [k, ent] of supportLinkEntryMap) {
    if (!ent.tentative && now >= ent.until) {
      if (ent.boostSupportedBadge && !ent.linePersistsUntilRelease) {
        const sid = ent.supportedUnitId;
        const cur = badgeStageByUnitId.get(sid) ?? 0;
        badgeStageByUnitId.set(sid, Math.max(0, cur - 1));
        applyBadgeInnerScale(svg, sid);
      }
      ent.group.remove();
      supportLinkEntryMap.delete(k);
      continue;
    }
    const p1 = readUnitGroupTranslate(svg, ent.supporterUnitId);
    const p2 = readUnitGroupTranslate(svg, ent.supportedUnitId);
    if (p1 == null || p2 == null) {
      continue;
    }
    const elapsed = now - ent.growStartedAt;
    const t = easeOutCubicForSupportLine(elapsed / ent.growDurationMs);
    const x2 = p1.x + (p2.x - p1.x) * t;
    const y2 = p1.y + (p2.y - p1.y) * t;
    for (const line of [ent.lineWhite, ent.lineColor]) {
      line.setAttribute('x1', String(p1.x));
      line.setAttribute('y1', String(p1.y));
      line.setAttribute('x2', String(x2));
      line.setAttribute('y2', String(y2));
    }
    if (t >= 1 && !ent.growCompleteFired) {
      ent.growCompleteFired = true;
      ent.lineWhite.setAttribute('x2', String(p2.x));
      ent.lineWhite.setAttribute('y2', String(p2.y));
      ent.lineColor.setAttribute('x2', String(p2.x));
      ent.lineColor.setAttribute('y2', String(p2.y));
      if (ent.boostSupportedBadge) {
        bumpSupportedBadgeStage(svg, ent.supportedUnitId);
      }
    }
  }
  if (supportLinkEntryMap.size > 0) {
    supportLinkRafId = requestAnimationFrame(tickSupportLinks);
  }
}

function ensureSupportLinkTick(): void {
  if (supportLinkRafId !== 0) {
    return;
  }
  supportLinkRafId = requestAnimationFrame(tickSupportLinks);
}

/**
 * mapEffects の supportLink / supportLinkRevoke をストアに反映する。
 * 盤面更新のたびに呼び、ユニット描画後に実行すること（座標追従のため）。
 *
 * @param svg - 地図ルート SVG
 * @param linkLayer - 支援線用 g
 * @param mapEffects - 今回の盤面更新に付与する演出
 * @param board - 支援元ユニットの勢力色取得用
 */
export function syncSupportLinkOverlay(
  svg: SVGSVGElement,
  linkLayer: SVGGElement,
  mapEffects: readonly MapVisualEffect[] | null,
  board: BoardState,
): void {
  supportLinkSvgRef = svg;
  supportLinkLayerRef = linkLayer;
  const list = mapEffects ?? [];
  for (const e of list) {
    if (e.type !== 'supportLinkRevoke') {
      continue;
    }
    const k = supportLinkStoreKey(e.supporterUnitId, e.supportedUnitId);
    const ent = supportLinkEntryMap.get(k);
    if (ent != null) {
      ent.group.remove();
      supportLinkEntryMap.delete(k);
    }
  }
  const dashPat = `${SUPPORT_LINE_DASH_UNIT} ${SUPPORT_LINE_DASH_UNIT}`;
  for (const e of list) {
    if (e.type !== 'supportLink') {
      continue;
    }
    const k = supportLinkStoreKey(e.supporterUnitId, e.supportedUnitId);
    const tentative = e.tentative === true;
    const boostSupportedBadge = e.boostSupportedBadge === true;
    const linePersistsUntilRelease =
      boostSupportedBadge && e.linePersistsUntilRelease !== false;
    const until =
      tentative || linePersistsUntilRelease
        ? Number.POSITIVE_INFINITY
        : performance.now() + Math.max(e.durationMs, 1);
    const supporter = board.units.find((u) => u.id === e.supporterUnitId);
    const supporterColor =
      POWER_COLORS[supporter?.powerId ?? ''] ?? '#6366f1';
    let ent = supportLinkEntryMap.get(k);
    if (ent == null) {
      const group = document.createElementNS(SVG_NS, 'g');
      group.setAttribute('pointer-events', 'none');
      const lineWhite = document.createElementNS(SVG_NS, 'line');
      const lineColor = document.createElementNS(SVG_NS, 'line');
      for (const line of [lineWhite, lineColor]) {
        line.setAttribute('stroke-linecap', 'round');
        line.setAttribute('vector-effect', 'non-scaling-stroke');
        line.setAttribute('stroke-dasharray', dashPat);
        line.setAttribute('pointer-events', 'none');
      }
      lineWhite.setAttribute('stroke', '#ffffff');
      lineWhite.setAttribute('stroke-width', String(SUPPORT_LINE_STROKE_WHITE));
      lineColor.setAttribute('stroke', supporterColor);
      lineColor.setAttribute('stroke-width', String(SUPPORT_LINE_STROKE_COLOR));
      lineColor.setAttribute(
        'stroke-dashoffset',
        String(SUPPORT_LINE_DASH_UNIT),
      );
      group.appendChild(lineWhite);
      group.appendChild(lineColor);
      linkLayer.appendChild(group);
      ent = {
        group,
        lineWhite,
        lineColor,
        supporterUnitId: e.supporterUnitId,
        supportedUnitId: e.supportedUnitId,
        until,
        tentative,
        growStartedAt: performance.now(),
        growDurationMs: SUPPORT_LINE_GROW_MS,
        boostSupportedBadge,
        linePersistsUntilRelease,
        growCompleteFired: false,
      };
      supportLinkEntryMap.set(k, ent);
    } else {
      ent.until = until;
      ent.tentative = tentative;
      ent.boostSupportedBadge = boostSupportedBadge;
      ent.linePersistsUntilRelease = linePersistsUntilRelease;
      ent.lineColor.setAttribute('stroke', supporterColor);
    }
  }
  if (supportLinkEntryMap.size > 0) {
    ensureSupportLinkTick();
  }
}


/**
 * 解決表示終了時などに、被支援バッジ段階カウンタを空にする。
 */
export function clearSupportBadgeStages(): void {
  badgeStageByUnitId.clear();
}

/**
 * 現在の被支援記号スケール段階（0 から）。applyBoardOverlay が参照する。
 *
 * @param unitId - ユニット ID
 * @returns 段階
 */
export function getSupportBadgeStageForUnit(unitId: string): number {
  return badgeStageByUnitId.get(unitId) ?? 0;
}
