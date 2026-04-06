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
 */

'use client';

import {
  HypotheticalForeignOrdersPanel,
  type HypotheticalScenarioState,
} from '@/components/HypotheticalForeignOrdersPanel';
import MapView from '@/components/MapView';
import { PowerSecretWorkbench } from '@/components/PowerSecretWorkbench';
import { useDiplomacyGame } from '@/context/DiplomacyGameContext';
import { mergePowerPageOrderPreview, type UnitOrderInput } from '@/diplomacy/gameHelpers';
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
  } = g;

  const [hypotheticalUi, setHypotheticalUi] = useState<HypotheticalUiState>(
    () => ({
      scenarios: createDefaultHypotheticalScenarios(),
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

  const orderAdjKeys = useMemo(() => buildAdjacencyKeySet(board), [board]);

  const showMovementOrderPreview =
    !isOrderLocked && !isAdjustmentPhasePanel && !isRetreatPhase;

  const orderPreviewMerged = useMemo(() => {
    if (!showMovementOrderPreview) {
      return null;
    }
    return mergePowerPageOrderPreview(
      board,
      powerId,
      unitOrders,
      activeHypotheticalOrders,
    );
  }, [
    board,
    powerId,
    unitOrders,
    activeHypotheticalOrders,
    showMovementOrderPreview,
  ]);

  useEffect(() => {
    if (!powerId || !POWERS.includes(powerId)) {
      router.replace('/');
      return;
    }
    /**
     * 直接 `/power/[id]` を開いた直後など、セッション未開始ならメインへ戻す。
     * ただしオンライン接続情報がある一時状態では即リダイレクトせず待機する。
     */
    if (!gameSessionActive && onlineSession == null) {
      router.replace('/');
    }
  }, [powerId, router, gameSessionActive, onlineSession]);

  if (!gameSessionActive) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-2 text-sm text-zinc-500">
        <p>
          {onlineSession != null
            ? 'セッションを確認しています…'
            : 'セッションが見つかりません。メインへ戻ります…'}
        </p>
        <Link
          href="/"
          className="text-xs font-medium text-violet-600 hover:text-violet-500"
        >
          メインページへ
        </Link>
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
              className="text-[11px] font-medium text-sky-700 underline-offset-2 hover:underline"
            >
              メイン画面（地図・全体進捗）
            </Link>
          </div>
        ) : null}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 lg:flex-row lg:items-stretch lg:gap-4">
          <div className="flex min-h-0 w-full shrink-0 justify-center overflow-hidden lg:h-full lg:w-auto lg:max-w-[min(100%,52%)] lg:justify-start">
            <div
              className="box-border flex h-auto w-full max-w-full flex-col overflow-hidden rounded-2xl border border-zinc-200/70 bg-white p-3 shadow-md shadow-zinc-900/[0.06] ring-1 ring-black/[0.03] sm:p-4 lg:h-full lg:w-auto lg:max-h-full lg:shrink-0"
              style={{ aspectRatio: mapAspectRatio }}
            >
              <MapView
                board={board}
                isResolutionRevealing={isResolutionRevealing}
                pendingMapEffectsRef={pendingMapEffectsRef}
                orderPreviewMerged={orderPreviewMerged}
              />
            </div>
          </div>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <PowerSecretWorkbench
              powerId={powerId}
              showMainPageLink={onlineSession == null}
            />
            {showMovementOrderPreview ? (
              <HypotheticalForeignOrdersPanel
                powerId={powerId}
                board={board}
                orderAdjKeys={orderAdjKeys}
                scenarios={hypotheticalUi.scenarios}
                activeScenarioIndex={hypotheticalUi.activeIndex}
                onSelectScenario={handleSelectHypotheticalScenario}
                onAddScenario={handleAddHypotheticalScenario}
                hypotheticalOrders={activeHypotheticalOrders}
                setHypotheticalOrders={setActiveHypotheticalOrders}
              />
            ) : null}
          </div>
        </div>
      </main>
    </div>
  );
}
