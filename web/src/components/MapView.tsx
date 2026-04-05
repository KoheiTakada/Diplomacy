/**
 * Illustrator 出力の地理 SVG（illustrator-map.svg）を読み込み、盤面を重ね描画するマップ
 *
 * 概要:
 *   public の illustrator-map.svg を fetch し、占領（ユニット所在または補給所有）に応じて陸・沿岸の塗り色・
 *   一度塗られた州は別勢力が上書きするまで provinceControlTint で色を保持する。
 *   補給○は内側の塗りを本拠国色（常時）または中立白。本拠の輪郭は常に黒、中立は現在の所有者色（無ければ黒）。ユニットを DOM で更新する（海域は塗らない）。
 *   ユニットは白い円の上に unit-army-tank-icon / unit-fleet-anchor-icon をネスト SVG で表示し、
 *   アイコン内の黒（既定塗り）を勢力色・白系を #fff に置き換える。
 *   ユニット位置は unit-anchors-army / unit-anchors-fleet。海軍は STP/SPA/BUL で
 *   data-fleet-coast（NC/SC/EC）ごとに別ドットを指定可能。
 *   スイス（SWI）はボードに含めず、地図上のみ通過不可として表示する。
 *   直前の盤面が分かるとき、同一ユニットIDでアンカー座標が変わった場合は短時間の移動アニメーションを付与する。
 *
 * パラメータ:
 *   @param board - 現在の BoardState
 *
 * 表示:
 *   左上に年・季節をフローティング（地図操作を阻害しない pointer-events-none）で表示する。
 *
 * 制限:
 *   初回ロードでネットワーク取得が必要。海岸線グループはヒット判定を阻害しないよう pointer-events を無効化する。
 *   親は page 側で viewBox 比の枠（aspect-ratio）を与え、当コンポーネントはその内側に h-full w-full で収める。
 *   SVG オーバーレイの詳細ロジックは mapView/ 配下のモジュールに分割している。
 */

'use client';

import type { BoardState } from '@/domain';
import type { UnitOrderInput } from '@/diplomacy/gameHelpers';
import type { MapVisualEffect } from '@/mapVisualEffects';
import { turnLabel } from '@/turnLabel';
import {
  applyBoardOverlay,
  clampViewBoxToMapExtent,
  parseUnitSvgTemplate,
  parseViewBoxAttr,
  readAnchorLayers,
} from '@/components/mapView/mapViewBoardOverlay';
import {
  buildOrderPreviewPolylines,
  syncOrderPreviewOverlay,
} from '@/components/mapView/mapViewOrderPreview';
import {
  clearAllBoostMoveSupportLinks,
  clearAllReleaseSupportTimeouts,
  clearSupportBadgeStages,
} from '@/components/mapView/mapViewSupportOverlay';
import {
  MAP_SVG_PATH,
  MIN_W,
  UNIT_ARMY_ICON_URL,
  UNIT_FLEET_ICON_URL,
} from '@/mapViewConstants';
import type { AnchorLayers, UnitIconTemplates, ViewBox } from '@/components/mapView/mapViewTypes';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';

interface MapViewProps {
  board: BoardState;
  /** false になったとき支援バッジ段階をクリアし、解決後の通常サイズに戻す */
  isResolutionRevealing: boolean;
  /** 直近の盤面更新にだけ乗せる演出。読み取り後に page 側で空にする */
  pendingMapEffectsRef: MutableRefObject<MapVisualEffect[]>;
  /**
   * 自国実入力＋他国想定をマージした命令。省略または null で矢印プレビューなし。
   */
  orderPreviewMerged?: Record<string, UnitOrderInput> | null;
}

function syncOrderPreviewLayer(
  svg: SVGSVGElement,
  board: BoardState,
  layers: AnchorLayers,
  merged: Record<string, UnitOrderInput> | null | undefined,
): void {
  if (merged != null) {
    syncOrderPreviewOverlay(
      svg,
      buildOrderPreviewPolylines(board, layers, merged),
    );
  } else {
    syncOrderPreviewOverlay(svg, []);
  }
}

export default function MapView({
  board,
  isResolutionRevealing,
  pendingMapEffectsRef,
  orderPreviewMerged,
}: MapViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const unitIconTemplatesRef = useRef<UnitIconTemplates | null>(null);
  const layersRef = useRef<AnchorLayers>({ army: {}, fleet: {} });
  const vbRef = useRef<ViewBox>({ x: 0, y: 0, w: 641.66, h: 595.28 });
  const panRef = useRef({ active: false, sx: 0, sy: 0 });
  const boardRef = useRef(board);
  const orderPreviewMergedRef = useRef(orderPreviewMerged);

  /** 直前に描画した盤面（ユニット移動アニメーションの起点座標用） */
  const prevBoardRef = useRef<BoardState | null>(null);

  useEffect(() => {
    boardRef.current = board;
  }, [board]);

  useEffect(() => {
    orderPreviewMergedRef.current = orderPreviewMerged;
  }, [orderPreviewMerged]);

  const [vb, setVb] = useState<ViewBox>({ x: 0, y: 0, w: 641.66, h: 595.28 });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const svg = svgRef.current;
    if (!svg) {
      return;
    }
    const rect = svg.getBoundingClientRect();
    const factor = e.deltaY > 0 ? 1.08 : 1 / 1.08;
    setVb((prev) => {
      const newW = prev.w * factor;
      if (newW < MIN_W) {
        return prev;
      }
      const newH = prev.h * factor;
      const mouseX = prev.x + ((e.clientX - rect.left) / rect.width) * prev.w;
      const mouseY = prev.y + ((e.clientY - rect.top) / rect.height) * prev.h;
      const raw = {
        x: mouseX - (mouseX - prev.x) * factor,
        y: mouseY - (mouseY - prev.y) * factor,
        w: newW,
        h: newH,
      };
      return clampViewBoxToMapExtent(raw, vbRef.current);
    });
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    let svgEl: SVGSVGElement | null = null;

    Promise.all([
      fetch(MAP_SVG_PATH, { signal: ac.signal }).then((r) => {
        if (!r.ok) {
          throw new Error(`HTTP ${r.status}`);
        }
        return r.text();
      }),
      fetch(UNIT_ARMY_ICON_URL, { signal: ac.signal }).then((r) => {
        if (!r.ok) {
          throw new Error(`陸軍アイコン HTTP ${r.status}`);
        }
        return r.text();
      }),
      fetch(UNIT_FLEET_ICON_URL, { signal: ac.signal }).then((r) => {
        if (!r.ok) {
          throw new Error(`海軍アイコン HTTP ${r.status}`);
        }
        return r.text();
      }),
    ])
      .then(([mapTxt, armyTxt, fleetTxt]) => {
        const doc = new DOMParser().parseFromString(mapTxt, 'image/svg+xml');
        const root = doc.documentElement;
        if (root.querySelector('parsererror')) {
          throw new Error('SVG の解析に失敗しました');
        }
        svgEl = root as unknown as SVGSVGElement;
        unitIconTemplatesRef.current = {
          army: parseUnitSvgTemplate(armyTxt),
          fleet: parseUnitSvgTemplate(fleetTxt),
        };
        const host = hostRef.current;
        if (!host || ac.signal.aborted) {
          return;
        }

        const vbParsed =
          parseViewBoxAttr(svgEl.getAttribute('viewBox')) ??
          ({ x: 0, y: 0, w: 641.66, h: 595.28 } as ViewBox);
        vbRef.current = vbParsed;
        setVb(vbParsed);

        svgEl.setAttribute(
          'class',
          'block h-full w-full max-h-full max-w-full cursor-grab touch-none active:cursor-grabbing',
        );
        svgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet');

        const coast = svgEl.querySelector('[data-name="海岸線"]');
        if (coast) {
          coast.setAttribute('pointer-events', 'none');
        }

        host.appendChild(svgEl);
        svgRef.current = svgEl;
        layersRef.current = readAnchorLayers(svgEl);
        applyBoardOverlay(
          svgEl,
          boardRef.current,
          layersRef.current,
          unitIconTemplatesRef.current,
          null,
          null,
        );
        prevBoardRef.current = boardRef.current;
        syncOrderPreviewLayer(
          svgEl,
          boardRef.current,
          layersRef.current,
          orderPreviewMergedRef.current,
        );

        svgEl.addEventListener('wheel', handleWheel, { passive: false });

        const onMove = (e: PointerEvent) => {
          const t = e.target as Element | null;
          const el = t?.closest('[data-province]');
          const pid = el?.getAttribute('data-province') ?? null;
          setHoverId(pid);
        };
        const onLeave = () => setHoverId(null);
        svgEl.addEventListener('pointermove', onMove);
        svgEl.addEventListener('pointerleave', onLeave);
        (svgEl as unknown as { _cleanupMap?: () => void })._cleanupMap = () => {
          svgEl?.removeEventListener('wheel', handleWheel);
          svgEl?.removeEventListener('pointermove', onMove);
          svgEl?.removeEventListener('pointerleave', onLeave);
        };
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) {
          return;
        }
        const msg = err instanceof Error ? err.message : String(err);
        setLoadError(msg);
      });

    return () => {
      ac.abort();
      clearAllReleaseSupportTimeouts();
      const s = svgRef.current;
      if (s) {
        const clean = (s as unknown as { _cleanupMap?: () => void })._cleanupMap;
        clean?.();
        s.remove();
      }
      svgRef.current = null;
      unitIconTemplatesRef.current = null;
      setLoadError(null);
    };
  }, [handleWheel]);

  useEffect(() => {
    if (!isResolutionRevealing) {
      clearAllReleaseSupportTimeouts();
      clearAllBoostMoveSupportLinks();
      clearSupportBadgeStages();
    }
  }, [isResolutionRevealing]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) {
      return;
    }
    const pending = pendingMapEffectsRef.current;
    pendingMapEffectsRef.current = [];
    const previousBoard = prevBoardRef.current;
    applyBoardOverlay(
      svg,
      board,
      layersRef.current,
      unitIconTemplatesRef.current,
      previousBoard,
      pending.length > 0 ? pending : null,
    );
    prevBoardRef.current = board;
    syncOrderPreviewLayer(
      svg,
      board,
      layersRef.current,
      orderPreviewMerged,
    );
  }, [board, isResolutionRevealing, orderPreviewMerged]);

  useEffect(() => {
    const svg = svgRef.current;
    if (svg) {
      svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
    }
  }, [vb]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) {
      return;
    }
    panRef.current = { active: true, sx: e.clientX, sy: e.clientY };
    (e.target as Element).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!panRef.current.active) {
      return;
    }
    const svg = svgRef.current;
    if (!svg) {
      return;
    }
    const rect = svg.getBoundingClientRect();
    const dx = e.clientX - panRef.current.sx;
    const dy = e.clientY - panRef.current.sy;
    setVb((prev) => {
      const raw = {
        ...prev,
        x: prev.x - (dx / rect.width) * prev.w,
        y: prev.y - (dy / rect.height) * prev.h,
      };
      return clampViewBoxToMapExtent(raw, vbRef.current);
    });
    panRef.current.sx = e.clientX;
    panRef.current.sy = e.clientY;
  };

  const onPointerUp = () => {
    panRef.current.active = false;
  };

  const zoom = (factor: number) => {
    setVb((prev) => {
      const newW = prev.w * factor;
      if (newW < MIN_W) {
        return prev;
      }
      const newH = prev.h * factor;
      const raw = {
        x: prev.x + (prev.w - newW) / 2,
        y: prev.y + (prev.h - newH) / 2,
        w: newW,
        h: newH,
      };
      return clampViewBoxToMapExtent(raw, vbRef.current);
    });
  };

  const resetView = () => setVb({ ...vbRef.current });

  const btnClass =
    'flex h-8 w-8 items-center justify-center rounded-lg bg-white/95 text-sm font-semibold text-zinc-700 shadow-md shadow-zinc-900/10 ring-1 ring-zinc-200/80 backdrop-blur-sm hover:bg-white select-none transition-colors';

  const hoverLabel =
    hoverId === 'SWI'
      ? 'スイス（通過不可）'
      : hoverId
        ? (board.provinces.find((p) => p.id === hoverId)?.name ?? hoverId)
        : null;

  const turnText = turnLabel(board);

  return (
    <div className="relative h-full min-h-0 w-full">
      <div
        className="pointer-events-none absolute left-3 top-3 z-10 select-none rounded-2xl bg-white/95 px-5 py-3 text-2xl font-bold tabular-nums tracking-tight text-zinc-900 shadow-lg shadow-zinc-900/15 ring-1 ring-zinc-200/80 backdrop-blur-sm sm:left-4 sm:top-4 sm:px-6 sm:py-3.5 sm:text-3xl"
        aria-live="polite"
        aria-label={`現在のターン ${turnText}`}
      >
        {turnText}
      </div>
      <div className="absolute top-2 right-2 z-10 flex flex-col gap-1">
        <button type="button" className={btnClass} onClick={() => zoom(0.75)} aria-label="拡大">
          ＋
        </button>
        <button type="button" className={btnClass} onClick={() => zoom(1.33)} aria-label="縮小">
          −
        </button>
        <button type="button" className={btnClass} onClick={resetView} aria-label="リセット">
          ↺
        </button>
      </div>

      {hoverLabel && (
        <div className="pointer-events-none absolute bottom-3 left-3 z-10 rounded bg-black/75 px-2 py-1 text-xs text-white">
          {hoverLabel}
        </div>
      )}

      {loadError && (
        <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          地図の読み込みに失敗しました: {loadError}
        </div>
      )}

      <div
        ref={hostRef}
        className="h-full min-h-0 w-full overflow-hidden rounded-lg"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      />
    </div>
  );
}
