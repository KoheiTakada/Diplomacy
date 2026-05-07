/**
 * 単一勢力向け秘密入力ページのクライアント部分
 *
 * 概要:
 *   `/power/ENG` のように勢力 ID でアクセスし、その国の命令・調整・退却のみ編集する。
 *
 * 主な機能:
 *   - 地図の共有表示と PowerSecretWorkbench による入力
 *
 * 想定される制限事項:
 *   - 無効な powerId やゲーム非アクティブ時はメインへリダイレクトする。
 *   - オンライン参加はトップ画面で行い、シークレットは URL に載せない。
 *   - 別タブ復元は localStorage（およびメインで一度同期された sessionStorage）に
 *     卓情報がある場合に限る。初回のみ `/power` を開くと復元できないことがある。
 */

'use client';

import {
  HypotheticalForeignOrdersPanel,
  type HypotheticalScenarioState,
} from '@/components/HypotheticalForeignOrdersPanel';
import MapView from '@/components/MapView';
import { PowerSecretWorkbench } from '@/components/PowerSecretWorkbench';
import { PowerTreatyPanel } from '@/components/PowerTreatyPanel';
import { AppHeader } from '@/components/AppHeader';
import { PhaseTimeline } from '@/components/PhaseTimeline';
import { HamburgerMenu } from '@/components/HamburgerMenu';
import { useDiplomacyGame } from '@/context/DiplomacyGameContext';
import { mergePowerPageOrderPreview, POWER_META, type UnitOrderInput } from '@/diplomacy/gameHelpers';
import { buildTreatyMapVisuals, canPowerViewTreaty } from '@/diplomacy/treaties';
import { readOnlineSessionForPowerPageRestore } from '@/lib/onlineSessionBrowser';
import { buildAdjacencyKeySet } from '@/mapMovement';
import { POWERS } from '@/miniMap';
import { useParams, useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type SetStateAction,
} from 'react';

/** 想定パターンタブ用の一意 ID */
function newHypotheticalScenarioId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `hyp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 初期タブ3つ分の空シナリオ */
function createDefaultHypotheticalScenarios(): HypotheticalScenarioState[] {
  return [1, 2, 3].map((n) => ({
    id: newHypotheticalScenarioId(),
    label: `パターン ${n}`,
    orders: {},
  }));
}

type HypotheticalUiState = {
  scenarios: HypotheticalScenarioState[];
  activeIndex: number;
};

/**
 * 勢力別ページの対話 UI。
 *
 * @returns ローディング / 遷移中 / メイン作業画面
 */
export default function PowerPageClient() {
  const params = useParams();
  const router = useRouter();
  const raw = params.powerId;
  const powerId =
    typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : '';

  const g = useDiplomacyGame();
  const {
    board,
    gameSessionActive,
    isResolutionRevealing,
    pendingMapEffectsRef,
    onlineSession,
    unitOrders,
    setUnitOrders,
    isOrderLocked,
    isAdjustmentPhasePanel,
    isRetreatPhase,
    diplomacyPhase,
    joinOnlineGame,
    reportUnexpectedTitleNavigation,
    treaties,
    hypotheticalScenarios: savedScenarios,
    setHypotheticalScenarios,
  } = g;
  const [isRestoringSession, setIsRestoringSession] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  const [hypotheticalUi, setHypotheticalUi] = useState<HypotheticalUiState>(
    () => ({
      scenarios: savedScenarios.length > 0 ? savedScenarios : createDefaultHypotheticalScenarios(),
      activeIndex: 0,
    }),
  );

  const activeHypotheticalOrders =
    hypotheticalUi.scenarios[hypotheticalUi.activeIndex]?.orders ?? {};

  // ref で常に最新の activeHypotheticalOrders を追跡（フェーズ遷移時に使用）
  const activeHypotheticalOrdersRef = useRef(activeHypotheticalOrders);
  activeHypotheticalOrdersRef.current = activeHypotheticalOrders;
  const prevDiplomacyPhaseRef = useRef(diplomacyPhase);
  const workbenchScrollRef = useRef<HTMLDivElement>(null);

  const setActiveHypotheticalOrders = useCallback(
    (action: SetStateAction<Record<string, UnitOrderInput>>) => {
      setHypotheticalUi((s) => {
        const i = s.activeIndex;
        const sc = s.scenarios[i];
        if (!sc) {
          return s;
        }
        const nextOrders =
          typeof action === 'function' ? action(sc.orders) : action;
        const scenarios = s.scenarios.slice();
        scenarios[i] = { ...sc, orders: nextOrders };
        return { ...s, scenarios };
      });
    },
    [],
  );

  const handleSelectHypotheticalScenario = useCallback((index: number) => {
    setHypotheticalUi((s) => ({
      ...s,
      activeIndex: Math.max(0, Math.min(index, s.scenarios.length - 1)),
    }));
    // 命令フェーズ中にパターンを切り替えたら、自国命令も切り替わる
    const nextIndex = Math.max(0, Math.min(index, hypotheticalUi.scenarios.length - 1));
    const nextScenario = hypotheticalUi.scenarios[nextIndex];
    if (nextScenario != null && diplomacyPhase === 'orders') {
      setUnitOrders((cur) => {
        const next = { ...cur };
        for (const u of board.units) {
          if (u.powerId === powerId) {
            const h = nextScenario.orders[u.id];
            if (h != null) {
              next[u.id] = h;
            } else {
              delete next[u.id];
            }
          }
        }
        return next;
      });
    }
  }, [hypotheticalUi.scenarios, diplomacyPhase, board, powerId, setUnitOrders]);

  const handleAddHypotheticalScenario = useCallback(() => {
    setHypotheticalUi((s) => {
      const nextNum = s.scenarios.length + 1;
      return {
        scenarios: [
          ...s.scenarios,
          {
            id: newHypotheticalScenarioId(),
            label: `パターン ${nextNum}`,
            orders: {},
          },
        ],
        activeIndex: s.scenarios.length,
      };
    });
  }, []);

  // 想定行動パターンを Context に保存
  useEffect(() => {
    setHypotheticalScenarios(hypotheticalUi.scenarios);
  }, [hypotheticalUi.scenarios, setHypotheticalScenarios]);

  // 命令フェーズ中に unitOrders が変更されたら、現在のパターンに自国分を反映
  useEffect(() => {
    // 命令フェーズのみ（isMovementPhase && diplomacyPhase === 'orders'）
    const isMovement = !isOrderLocked && !isAdjustmentPhasePanel && !isRetreatPhase;
    if (!(isMovement && diplomacyPhase === 'orders')) return;
    setHypotheticalUi((s) => {
      const i = s.activeIndex;
      const sc = s.scenarios[i];
      if (!sc) return s;
      // 現在のパターンの orders を更新（自国分のみ）
      const nextOrders = { ...sc.orders };
      let changed = false;
      for (const u of board.units) {
        if (u.powerId === powerId) {
          const cur = unitOrders[u.id];
          const prev = nextOrders[u.id];
          if (cur !== prev) {
            if (cur != null) {
              nextOrders[u.id] = cur;
            } else {
              delete nextOrders[u.id];
            }
            changed = true;
          }
        }
      }
      if (!changed) return s;
      const scenarios = s.scenarios.slice();
      scenarios[i] = { ...sc, orders: nextOrders };
      return { ...s, scenarios };
    });
  }, [unitOrders, diplomacyPhase, isOrderLocked, isAdjustmentPhasePanel, isRetreatPhase, board, powerId]);

  const orderAdjKeys = useMemo(() => buildAdjacencyKeySet(board), [board]);

  const powerTreatyMapVisuals = useMemo(
    () => buildTreatyMapVisuals(
      treaties.filter((t) => canPowerViewTreaty(t, powerId)),
      board.turn,
    ),
    [treaties, board.turn, powerId],
  );

  /** 移動フェーズ（命令フェーズ or 交渉フェーズ）かどうか */
  const isMovementPhase =
    !isOrderLocked && !isAdjustmentPhasePanel && !isRetreatPhase;
  /** 交渉フェーズ中の移動命令プレビュー（全勢力を想定行動で表示） */
  const showNegotiationHypothetical =
    isMovementPhase && diplomacyPhase === 'negotiation';
  /** 命令フェーズ中の移動命令入力 */
  const showOrdersInput = isMovementPhase && diplomacyPhase === 'orders';

  // 交渉フェーズから命令フェーズへ移行したとき、自国の想定行動を unitOrders にコピー
  useEffect(() => {
    const prev = prevDiplomacyPhaseRef.current;
    prevDiplomacyPhaseRef.current = diplomacyPhase;
    if (prev !== 'negotiation' || diplomacyPhase !== 'orders') return;
    const hypotheticals = activeHypotheticalOrdersRef.current;
    setUnitOrders((cur) => {
      const next = { ...cur };
      for (const u of board.units) {
        if (u.powerId === powerId) {
          const h = hypotheticals[u.id];
          if (h != null) {
            next[u.id] = h;
          } else {
            delete next[u.id];
          }
        }
      }
      return next;
    });
  }, [diplomacyPhase, board, powerId, setUnitOrders]);

  const orderPreviewMerged = useMemo(() => {
    if (!isMovementPhase) {
      return null;
    }
    // 交渉フェーズでは自国も想定行動でプレビューする
    const committedForPreview = showNegotiationHypothetical
      ? activeHypotheticalOrders
      : unitOrders;
    return mergePowerPageOrderPreview(
      board,
      powerId,
      committedForPreview,
      activeHypotheticalOrders,
    );
  }, [
    board,
    powerId,
    unitOrders,
    activeHypotheticalOrders,
    isMovementPhase,
    showNegotiationHypothetical,
  ]);

  useEffect(() => {
    if (!powerId || !POWERS.includes(powerId)) {
      reportUnexpectedTitleNavigation(`power_page_invalid_power_id:${powerId}`);
      router.replace('/');
      return;
    }
    if (gameSessionActive || isRestoringSession) {
      return;
    }
    const saved = readOnlineSessionForPowerPageRestore(powerId);
    if (saved == null) {
      reportUnexpectedTitleNavigation(`power_page_session_inactive:${powerId}`);
      router.replace('/');
      return;
    }
    setIsRestoringSession(true);
    void (async () => {
      const result = await joinOnlineGame({
        roomId: saved.roomId,
        token: saved.token,
      });
      if (!result.ok) {
        reportUnexpectedTitleNavigation(
          `power_page_session_restore_failed:${powerId}:${result.error}`,
        );
        router.replace('/');
      }
      setIsRestoringSession(false);
    })();
  }, [
    powerId,
    router,
    gameSessionActive,
    isRestoringSession,
    joinOnlineGame,
    reportUnexpectedTitleNavigation,
  ]);

  if (!gameSessionActive || isRestoringSession) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-sm text-zinc-500">
        {isRestoringSession ? 'オンライン接続を復元しています…' : 'メインへ移動しています…'}
      </div>
    );
  }

  if (!powerId || !POWERS.includes(powerId)) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-sm text-zinc-500">
        遷移中…
      </div>
    );
  }

  const mapAspectRatio = '641.66 / 595.28';
  const powerName = POWER_META[powerId]?.label ?? powerId;

  return (
    <div className="flex h-dvh max-h-dvh flex-col overflow-hidden font-sans text-zinc-900">
      <AppHeader displayName={powerName} onMenuClick={() => setMenuOpen(true)} />
      <PhaseTimeline
        year={board.turn.year}
        season={board.turn.season}
        diplomacyPhase={diplomacyPhase}
        isRetreatPhase={isRetreatPhase}
        isAdjustmentPhasePanel={isAdjustmentPhasePanel}
        isResolutionRevealing={isResolutionRevealing}
      />
      <HamburgerMenu
        open={menuOpen}
        isHostOrLocal={false}
        onClose={closeMenu}
        onDebugLog={undefined}
        onLeave={() => {
          // Player-only menu: just leave
          router.replace('/');
        }}
      />
      <main className="mx-auto flex h-full min-h-0 w-full max-w-[1920px] flex-col gap-2 overflow-hidden px-3 py-2 sm:px-4 sm:py-2 lg:px-6 lg:py-3">
        {/* 3-column layout: map | center content | treaties */}
        <div className="flex min-h-0 min-w-0 flex-1 gap-3 overflow-hidden lg:gap-4">
          {/* Left: Map (40% of viewport width, fixed) */}
          <div
            className="shrink-0 overflow-hidden rounded-2xl border border-zinc-200/70 bg-white shadow-md shadow-zinc-900/[0.06] ring-1 ring-black/[0.03]"
            style={{ aspectRatio: mapAspectRatio, width: '40vw' }}
          >
            <div className="flex h-full flex-col overflow-hidden p-3 sm:p-4">
              <MapView
                board={board}
                isResolutionRevealing={isResolutionRevealing}
                pendingMapEffectsRef={pendingMapEffectsRef}
                orderPreviewMerged={orderPreviewMerged}
                treatyVisuals={powerTreatyMapVisuals}
                onUnitClick={(uid) => {
                  const el = workbenchScrollRef.current?.querySelector(`#unit-panel-${uid}`);
                  el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                }}
              />
            </div>
          </div>

          {/* Center: All-nations unit list or hypothetical */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-zinc-200/70 bg-white shadow-md shadow-zinc-900/[0.06] ring-1 ring-black/[0.03]">
            {showNegotiationHypothetical ? (
              // 交渉フェーズ: 全勢力の想定行動パネルのみ（単独スクロール）
              <div className="min-h-0 flex-1 overflow-y-auto p-3 [scrollbar-width:thin] sm:p-4">
                <HypotheticalForeignOrdersPanel
                  powerId={powerId}
                  includeSelf={true}
                  board={board}
                  orderAdjKeys={orderAdjKeys}
                  scenarios={hypotheticalUi.scenarios}
                  activeScenarioIndex={hypotheticalUi.activeIndex}
                  onSelectScenario={handleSelectHypotheticalScenario}
                  onAddScenario={handleAddHypotheticalScenario}
                  hypotheticalOrders={activeHypotheticalOrders}
                  setHypotheticalOrders={setActiveHypotheticalOrders}
                />
              </div>
            ) : (
              // 命令フェーズ / 退却 / 調整 / ロック中: 命令入力ワークベンチ
              // 命令フェーズのみ他国想定行動をスクロール領域末尾に追記
              <PowerSecretWorkbench
                powerId={powerId}
                showMainPageLink={onlineSession == null}
                scrollAppendContent={
                  showOrdersInput ? (
                    <HypotheticalForeignOrdersPanel
                      powerId={powerId}
                      includeSelf={false}
                      board={board}
                      orderAdjKeys={orderAdjKeys}
                      scenarios={hypotheticalUi.scenarios}
                      activeScenarioIndex={hypotheticalUi.activeIndex}
                      onSelectScenario={handleSelectHypotheticalScenario}
                      onAddScenario={handleAddHypotheticalScenario}
                      hypotheticalOrders={activeHypotheticalOrders}
                      setHypotheticalOrders={setActiveHypotheticalOrders}
                    />
                  ) : undefined
                }
                scrollContainerRef={workbenchScrollRef}
              />
            )}
          </div>

          {/* Right: Treaty panel */}
          <div className="flex w-[268px] shrink-0 flex-col overflow-hidden rounded-2xl border border-zinc-200/70 bg-white shadow-md shadow-zinc-900/[0.06] ring-1 ring-black/[0.03]">
            <div className="min-h-0 flex-1 overflow-y-auto p-3 [scrollbar-width:thin] sm:p-4">
              <PowerTreatyPanel powerId={powerId} />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
