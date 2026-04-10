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
import { useDiplomacyGame } from '@/context/DiplomacyGameContext';
import { mergePowerPageOrderPreview, type UnitOrderInput } from '@/diplomacy/gameHelpers';
import { readOnlineSessionForPowerPageRestore } from '@/lib/onlineSessionBrowser';
import { buildAdjacencyKeySet } from '@/mapMovement';
import { POWERS } from '@/miniMap';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useMemo,
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
    isOrderLocked,
    isAdjustmentPhasePanel,
    isRetreatPhase,
    diplomacyPhase,
    joinOnlineGame,
    reportUnexpectedTitleNavigation,
    treatyMapVisuals,
    hypotheticalScenarios: savedScenarios,
    setHypotheticalScenarios,
  } = g;
  const [isRestoringSession, setIsRestoringSession] = useState(false);

  const [hypotheticalUi, setHypotheticalUi] = useState<HypotheticalUiState>(
    () => ({
      scenarios: savedScenarios.length > 0 ? savedScenarios : createDefaultHypotheticalScenarios(),
      activeIndex: 0,
    }),
  );

  const activeHypotheticalOrders =
    hypotheticalUi.scenarios[hypotheticalUi.activeIndex]?.orders ?? {};

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
  }, []);

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

  const orderAdjKeys = useMemo(() => buildAdjacencyKeySet(board), [board]);

  /** 移動フェーズ（命令フェーズ or 交渉フェーズ）かどうか */
  const isMovementPhase =
    !isOrderLocked && !isAdjustmentPhasePanel && !isRetreatPhase;
  /** 交渉フェーズ中の移動命令プレビュー（全勢力を想定行動で表示） */
  const showNegotiationHypothetical =
    isMovementPhase && diplomacyPhase === 'negotiation';
  /** 命令フェーズ中の移動命令入力 */
  const showOrdersInput = isMovementPhase && diplomacyPhase === 'orders';

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

  return (
    <div className="flex h-dvh max-h-dvh flex-col overflow-hidden font-sans text-zinc-900">
      <main className="mx-auto flex h-full min-h-0 w-full max-w-[1920px] flex-col gap-2 px-3 py-2 sm:px-4 sm:py-2 lg:px-6 lg:py-3">
        {onlineSession != null ? (
          <div className="flex shrink-0 justify-end">
            <Link
              href="/"
              className="text-[11px] font-medium text-zinc-500 underline-offset-2 hover:text-zinc-800 hover:underline"
            >
              メイン画面（地図・全体進捗）
            </Link>
          </div>
        ) : null}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 lg:flex-row lg:items-stretch lg:gap-4">
          <div className="flex min-h-0 w-full shrink-0 flex-col overflow-hidden lg:h-full lg:w-auto lg:max-w-[calc(100%-268px)] lg:justify-start">
            <div
              className="box-border flex h-auto w-full max-w-full flex-col overflow-hidden rounded-2xl border border-zinc-200/70 bg-white p-3 shadow-md shadow-zinc-900/[0.06] ring-1 ring-black/[0.03] sm:p-4 lg:h-[70%] lg:w-auto lg:shrink-0"
              style={{ aspectRatio: mapAspectRatio }}
            >
              <MapView
                board={board}
                isResolutionRevealing={isResolutionRevealing}
                pendingMapEffectsRef={pendingMapEffectsRef}
                orderPreviewMerged={orderPreviewMerged}
                treatyVisuals={treatyMapVisuals}
              />
            </div>
            <div className="min-h-0 overflow-y-auto pr-1 [scrollbar-width:thin]">
              <PowerTreatyPanel powerId={powerId} />
            </div>
          </div>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {showNegotiationHypothetical ? (
              // 交渉フェーズ: 全勢力の想定行動パネルのみ（単独スクロール）
              <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]">
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
              />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
