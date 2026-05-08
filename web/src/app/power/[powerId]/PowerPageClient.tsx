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
import { FlyoutMenu } from '@/components/FlyoutMenu';
import { useDiplomacyGame } from '@/context/DiplomacyGameContext';
import { mergePowerPageOrderPreview, POWER_META, type UnitOrderInput, type BuildSlot, type DisbandSlot, getReachableProvinces, emptyOrder, disbandNeed, buildCapacity, countUnits } from '@/diplomacy/gameHelpers';
import { OrderType, UnitType } from '@/domain';
import { buildTreatyMapVisuals, canPowerViewTreaty } from '@/diplomacy/treaties';
import { readOnlineSessionForPowerPageRestore } from '@/lib/onlineSessionBrowser';
import { buildAdjacencyKeySet, canSupportTargetInSupportOrder } from '@/mapMovement';
import { POWERS } from '@/miniMap';
import { useLocalHypotheticalOrders } from '@/hooks/useLocalHypotheticalOrders';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type SetStateAction,
} from 'react';


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
    buildPlan,
    disbandPlan,
    markPowerAdjustmentSaved,
  } = g;
  const [isRestoringSession, setIsRestoringSession] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  // スマートフォン版のタブ状態（"orders" or "treaties"）
  const [mobileCenterTabActive, setMobileCenterTabActive] = useState<'orders' | 'treaties'>('orders');

  // フライアウトメニュー状態管理
  const [flyout, setFlyout] = useState<{ open: boolean; unitId: string; anchorX: number; anchorY: number } | null>(null);
  // フライアウトのステップ: null = フライアウトなし, 'menu' = メニュー表示中, 'moveSelect' = 移動先選択中, etc
  const [flyoutStep, setFlyoutStep] = useState<'menu' | 'moveSelect' | 'convoyedSelect' | null>(null);
  // 移動可能なプロビンスID（フライアウトで移動を選択したときのみ設定）
  const [reachableProvinceIds, setReachableProvinceIds] = useState<Set<string> | null>(null);

  // クリック状態: 何を待っているか
  // 'default' = ユニット選択待ち (フライアウト閉じている)
  // 'province' = プロビンス選択待ち (移動先など)
  // 'unit' = ユニット選択待ち (支援対象など)
  const [awaitingInputFor, setAwaitingInputFor] = useState<'default' | 'province' | 'unit'>('default');

  // 支援/輸送対象ユニット選択時の中間状態
  const [pendingOrderState, setPendingOrderState] = useState<{
    kind: 'support' | 'convoy';
    targetUnitId: string;
  } | null>(null);
  // どちらの種類のユニット選択待ちか（support か convoy）
  const [awaitingUnitKind, setAwaitingUnitKind] = useState<'support' | 'convoy' | null>(null);

  // 他国ユニット用フライアウト（各勢力ページのローカル state）
  const [hypotheticalFlyout, setHypotheticalFlyout] = useState<{ open: boolean; unitId: string; anchorX: number; anchorY: number } | null>(null);
  const [hypotheticalFlyoutStep, setHypotheticalFlyoutStep] = useState<'menu' | 'moveSelect' | null>(null);
  const [hypotheticalAwaitingInputFor, setHypotheticalAwaitingInputFor] = useState<'default' | 'province' | 'unit'>('default');
  const [hypotheticalPendingOrderState, setHypotheticalPendingOrderState] = useState<{
    kind: 'support' | 'convoy';
    targetUnitId: string;
  } | null>(null);
  const [hypotheticalAwaitingUnitKind, setHypotheticalAwaitingUnitKind] = useState<'support' | 'convoy' | null>(null);
  const [hypotheticalReachableProvinceIds, setHypotheticalReachableProvinceIds] = useState<Set<string> | null>(null);

  // ローカル（localStorage で永続化）の想定行動：この国のページでのみ有効
  const {
    scenarios: hypotheticalScenarios,
    activeIndex: hypotheticalActiveIndex,
    isLoaded: hypotheticalIsLoaded,
    selectScenario: selectHypotheticalScenario,
    addScenario: addHypotheticalScenario,
    updateOrders: updateHypotheticalOrders,
  } = useLocalHypotheticalOrders(powerId);

  const activeHypotheticalOrders = useMemo(() => {
    return hypotheticalScenarios[hypotheticalActiveIndex]?.orders ?? {};
  }, [hypotheticalScenarios, hypotheticalActiveIndex]);

  // 仮ユニット（増産フェーズで新規追加）
  const pendingBuildUnits = useMemo(() => {
    if (!isAdjustmentPhasePanel) return [];
    const slots = buildPlan[powerId] ?? [];
    return slots.map((slot) => ({
      id: `_new_${slot.provinceId}`,
      type: slot.unitType,
      powerId,
      provinceId: slot.provinceId,
    } as const));
  }, [buildPlan, powerId, isAdjustmentPhasePanel]);

  // 削減が必要か判定
  const needsDisband = useMemo(() => {
    return disbandNeed(board, powerId) > 0;
  }, [board, powerId]);

  // 増産可能数を計算
  const buildCap = useMemo(() => {
    return buildCapacity(board, powerId);
  }, [board, powerId]);

  // 実際の増産可能数（既存計画を差し引く）
  const remainingBuildCapacity = useMemo(() => {
    const planned = buildPlan[powerId]?.length ?? 0;
    return Math.max(0, buildCap - planned);
  }, [buildCap, buildPlan, powerId]);

  // 削減予定のユニットID
  const disbandedUnitIds = useMemo(() => {
    if (!isAdjustmentPhasePanel) return new Set<string>();
    const slots = disbandPlan[powerId] ?? [];
    return new Set(slots.map((slot) => slot.unitId));
  }, [disbandPlan, powerId, isAdjustmentPhasePanel]);

  // ref で常に最新の activeHypotheticalOrders を追跡（フェーズ遷移時に使用）
  const activeHypotheticalOrdersRef = useRef(activeHypotheticalOrders);
  activeHypotheticalOrdersRef.current = activeHypotheticalOrders;
  const prevDiplomacyPhaseRef = useRef(diplomacyPhase);
  const workbenchScrollRef = useRef<HTMLDivElement>(null);

  // フライアウト用の補助計算
  const currentUnit = useMemo(() => {
    if (!flyout) return null;
    // board.units から探す
    const unit = board.units.find((u) => u.id === flyout.unitId);
    if (unit) return unit;
    // pendingBuildUnits から探す（仮ユニット）
    const pendingUnit = pendingBuildUnits.find((u) => u.id === flyout.unitId);
    return pendingUnit ?? null;
  }, [flyout, board.units, pendingBuildUnits]);
  const convoyableArmies = useMemo(() => {
    if (!currentUnit || currentUnit.type !== UnitType.Fleet) return [];
    // 現在のユニット（海軍）が輸送可能な陸軍（同じプロビンスのみ）
    return board.units.filter((u) => u.powerId === powerId && u.type === UnitType.Army && u.provinceId === currentUnit.provinceId);
  }, [currentUnit, board.units, powerId]);

  // 被輸送可能かどうか（陸軍で、同じプロビンスに海軍がいるか）
  const canConvoyedMove = useMemo(() => {
    if (!currentUnit || currentUnit.type !== UnitType.Army) return false;
    // 同じプロビンスに自国の海軍がいるか確認
    return board.units.some(
      (u) => u.powerId === powerId && u.type === UnitType.Fleet && u.provinceId === currentUnit.provinceId
    );
  }, [currentUnit, board.units, powerId]);

  const retreatOptions = useMemo(() => {
    if (!currentUnit || !isRetreatPhase) return [];
    // 後で retreat logic を実装
    return [];
  }, [currentUnit, isRetreatPhase]);

  // 入力待ちフェーズに応じた選択可能なプロビンス・ユニット
  const selectableProvinceIds = useMemo(() => {
    // 他国の想定行動入力を優先
    if (hypotheticalAwaitingInputFor === 'province' && hypotheticalReachableProvinceIds) {
      return hypotheticalReachableProvinceIds;
    }
    // 自国の入力
    if (awaitingInputFor === 'province' && reachableProvinceIds) {
      return reachableProvinceIds;
    }
    return undefined;
  }, [awaitingInputFor, reachableProvinceIds, hypotheticalAwaitingInputFor, hypotheticalReachableProvinceIds]);

  // フライアウト確定時に markPowerOrderSaved を遅延実行するフラグ
  const pendingMarkSavedRef = useRef<string | null>(null);

  // unitOrders が変わったら、pending markSaved をチェック
  useEffect(() => {
    if (pendingMarkSavedRef.current) {
      g.markPowerOrderSaved(pendingMarkSavedRef.current);
      pendingMarkSavedRef.current = null;
    }
  }, [unitOrders, g]);

  // 調整フェーズ中に buildPlan / disbandPlan が変更されたら markPowerAdjustmentSaved を呼ぶ
  // ただし依存配列では参照値で判定されるので、オブジェクトの内容変化でも発火する
  const buildPlanForThisPower = useMemo(
    () => buildPlan[powerId],
    [buildPlan, powerId],
  );
  const disbandPlanForThisPower = useMemo(
    () => disbandPlan[powerId],
    [disbandPlan, powerId],
  );

  useEffect(() => {
    if (isAdjustmentPhasePanel) {
      markPowerAdjustmentSaved(powerId);
    }
  }, [isAdjustmentPhasePanel, powerId, markPowerAdjustmentSaved, buildPlanForThisPower, disbandPlanForThisPower]);

  const handleSelectHypotheticalScenario = useCallback((index: number) => {
    selectHypotheticalScenario(index);
    // 命令フェーズ中にパターンを切り替えたら、自国命令も切り替わる
    const nextScenario = hypotheticalScenarios[index];
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
  }, [hypotheticalScenarios, diplomacyPhase, board, powerId, setUnitOrders, selectHypotheticalScenario]);

  const handleAddHypotheticalScenario = useCallback(() => {
    addHypotheticalScenario();
  }, [addHypotheticalScenario]);

  // 命令フェーズ中に unitOrders が変更されたら、現在のパターンに自国分を反映
  useEffect(() => {
    // 命令フェーズのみ（isMovementPhase && diplomacyPhase === 'orders'）
    const isMovement = !isOrderLocked && !isAdjustmentPhasePanel && !isRetreatPhase;
    if (!(isMovement && diplomacyPhase === 'orders' && hypotheticalIsLoaded)) return;

    updateHypotheticalOrders((current) => {
      const nextOrders = { ...current };
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
      return changed ? nextOrders : current;
    });
  }, [unitOrders, diplomacyPhase, isOrderLocked, isAdjustmentPhasePanel, isRetreatPhase, board, powerId, hypotheticalIsLoaded, updateHypotheticalOrders]);

  const orderAdjKeys = useMemo(() => buildAdjacencyKeySet(board), [board]);

  const supportableUnits = useMemo(() => {
    if (!currentUnit) return [];
    // ドロップダウンと同じロジック: canSupportTargetInSupportOrder で支援可能なユニットのみ
    const units = board.units.filter((u) =>
      u.id !== currentUnit.id &&
      canSupportTargetInSupportOrder(board, currentUnit, u, orderAdjKeys)
    );
    return units;
  }, [currentUnit, board.units, orderAdjKeys]);

  // hypothetical 用の supportableUnits（他国ユニットの支援対象）
  const hypotheticalSupportableUnits = useMemo(() => {
    if (!hypotheticalFlyout) return [];
    // ドロップダウンと同じロジック: canSupportTargetInSupportOrder で支援可能なユニットのみ
    const hypoUnit = board.units.find((u) => u.id === hypotheticalFlyout.unitId);
    if (!hypoUnit) return [];
    const units = board.units.filter((u) =>
      u.id !== hypotheticalFlyout.unitId &&
      canSupportTargetInSupportOrder(board, hypoUnit, u, orderAdjKeys)
    );
    return units;
  }, [hypotheticalFlyout, board.units, orderAdjKeys]);

  // hypothetical 用の convoyableArmies（他国ユニットの輸送対象）
  const hypotheticalConvoyableArmies = useMemo(() => {
    if (!hypotheticalFlyout) return [];
    const hypoUnit = board.units.find((u) => u.id === hypotheticalFlyout.unitId);
    if (!hypoUnit || hypoUnit.type !== UnitType.Fleet) return [];
    // hypothetical 海軍と同じプロビンスに存在する陸軍のみ
    return board.units.filter((u) => u.type === UnitType.Army && u.provinceId === hypoUnit.provinceId);
  }, [hypotheticalFlyout, board.units]);

  const selectableUnitIds = useMemo(() => {
    // 他国の想定行動入力を優先
    if (hypotheticalAwaitingInputFor === 'unit' && hypotheticalAwaitingUnitKind) {
      if (hypotheticalAwaitingUnitKind === 'support') {
        return new Set(hypotheticalSupportableUnits.map((u) => u.id));
      }
      if (hypotheticalAwaitingUnitKind === 'convoy') {
        return new Set(hypotheticalConvoyableArmies.map((u) => u.id));
      }
    }
    // 自国の入力
    if (awaitingInputFor === 'unit' && awaitingUnitKind) {
      if (awaitingUnitKind === 'support') {
        return new Set(supportableUnits.map((u) => u.id));
      }
      if (awaitingUnitKind === 'convoy') {
        return new Set(convoyableArmies.map((u) => u.id));
      }
    }
    return undefined;
  }, [awaitingInputFor, awaitingUnitKind, hypotheticalAwaitingInputFor, hypotheticalAwaitingUnitKind, supportableUnits, convoyableArmies, hypotheticalSupportableUnits, hypotheticalConvoyableArmies]);

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
    if (prev !== 'negotiation' || diplomacyPhase !== 'orders' || !hypotheticalIsLoaded) return;
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
  }, [diplomacyPhase, board, powerId, setUnitOrders, hypotheticalIsLoaded]);

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

  const backButton = (
    <Link
      href="/"
      className="rounded-lg bg-zinc-900 px-4 py-2 text-center text-sm font-semibold text-white shadow-md shadow-zinc-900/20 transition-colors hover:bg-zinc-800"
    >
      メインに戻る
    </Link>
  );

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
        rightAction={backButton}
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
      <main className="mx-auto flex h-full min-h-0 w-full max-w-[1920px] flex-col overflow-hidden px-3 py-2 sm:px-4 sm:py-2 lg:px-6 lg:py-3">
        {/* Desktop: 3-column (map maximized + center/treaties minimum) | Mobile: Stacked with tabs */}
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden flex-col lg:flex-row" style={{ minHeight: 0, gap: '0.375rem' }}>
          {/* Left: Map - flex-1 on mobile (full width, no border), max-h-full on desktop (styled) */}
          <div
            className="flex-1 min-w-0 overflow-hidden lg:rounded-2xl lg:border lg:border-zinc-200/70 lg:bg-white lg:shadow-md lg:shadow-zinc-900/[0.06] lg:ring-1 lg:ring-black/[0.03] lg:max-h-full"
            style={{
              aspectRatio: mapAspectRatio,
              minHeight: 0,
              minWidth: '300px',
            }}
          >
            <div className="flex h-full flex-col overflow-hidden p-0 lg:p-3 sm:lg:p-4">
              <MapView
                board={board}
                isResolutionRevealing={isResolutionRevealing}
                pendingMapEffectsRef={pendingMapEffectsRef}
                orderPreviewMerged={orderPreviewMerged}
                treatyVisuals={powerTreatyMapVisuals}
                extraUnits={isAdjustmentPhasePanel ? pendingBuildUnits : undefined}
                disbandedUnitIds={isAdjustmentPhasePanel ? disbandedUnitIds : undefined}
                selectableProvinceIds={selectableProvinceIds}
                selectableUnitIds={selectableUnitIds}
                onUnitClick={(uid, clientX, clientY) => {
                  // board.units から探す
                  const clickedUnit = board.units.find((u) => u.id === uid);

                  // 仮ユニット（増産フェーズの新規）の処理
                  if (!clickedUnit && uid.startsWith('_new_') && isAdjustmentPhasePanel) {
                    const pendingUnit = pendingBuildUnits.find((u) => u.id === uid);
                    if (pendingUnit) {
                      // 訂正フライアウトを開く
                      setFlyout({ open: true, unitId: uid, anchorX: clientX, anchorY: clientY });
                    }
                    return;
                  }

                  // board に存在しないユニットは無視
                  if (!clickedUnit) return;

                  // 自国ユニットの処理（移動フェーズなら常に開く）
                  if (clickedUnit.powerId === powerId) {
                    if (awaitingInputFor === 'unit' && selectableUnitIds?.has(uid) && awaitingUnitKind) {
                      // 支援対象や輸送対象ユニット選択中
                      setPendingOrderState({ kind: awaitingUnitKind, targetUnitId: uid });
                      // 対象ユニットの移動可能プロビンスを計算
                      const targetReachableProvinces = getReachableProvinces(board, clickedUnit, orderAdjKeys);
                      const targetReachableIds = new Set(targetReachableProvinces.map((p) => p.id));

                      // 支援の場合、支援ユニット自体の移動可能プロビンスとの交集合
                      if (awaitingUnitKind === 'support' && currentUnit) {
                        const supporterReachableProvinces = getReachableProvinces(board, currentUnit, orderAdjKeys);
                        const supporterReachableIds = new Set(supporterReachableProvinces.map((p) => p.id));
                        // 交集合を取る
                        const intersection = new Set<string>();
                        for (const prov of supporterReachableIds) {
                          if (targetReachableIds.has(prov)) {
                            intersection.add(prov);
                          }
                        }
                        setReachableProvinceIds(intersection);
                      } else {
                        // 輸送の場合は対象の移動可能プロビンスをそのまま使用
                        setReachableProvinceIds(targetReachableIds);
                      }

                      setAwaitingInputFor('province');
                      setAwaitingUnitKind(null);
                    } else if (awaitingInputFor === 'default' || isMovementPhase) {
                      // 通常: ユニットをクリックしてフライアウトを開く
                      // 移動フェーズなら常に開く（交渉フェーズでも自国入力可能）
                      // 増産フェーズなら削減が必要な場合のみ既存ユニット操作可能
                      if (!isAdjustmentPhasePanel || needsDisband) {
                        setFlyout({ open: true, unitId: uid, anchorX: clientX, anchorY: clientY });
                        const el = workbenchScrollRef.current?.querySelector(`#unit-panel-${uid}`);
                        el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                      }
                    }
                    // awaitingInputFor === 'province' の場合はクリック無視
                  } else if (isMovementPhase) {
                    // 他国ユニット（交渉フェーズまたは命令フェーズ、ローカル state のみ）
                    if (hypotheticalAwaitingInputFor === 'unit' && selectableUnitIds?.has(uid) && hypotheticalAwaitingUnitKind) {
                      // 支援対象や輸送対象ユニット選択中
                      setHypotheticalPendingOrderState({ kind: hypotheticalAwaitingUnitKind, targetUnitId: uid });
                      // 対象ユニットの移動可能プロビンスを計算
                      const targetReachableProvinces = getReachableProvinces(board, clickedUnit, orderAdjKeys);
                      const targetReachableIds = new Set(targetReachableProvinces.map((p) => p.id));

                      // 支援ユニット（hypothetical flyout のユニット）
                      const hypotheticalSupporter = hypotheticalFlyout ? board.units.find((u) => u.id === hypotheticalFlyout.unitId) : null;

                      // 支援の場合、支援ユニット自体の移動可能プロビンスとの交集合
                      if (hypotheticalAwaitingUnitKind === 'support' && hypotheticalSupporter) {
                        const supporterReachableProvinces = getReachableProvinces(board, hypotheticalSupporter, orderAdjKeys);
                        const supporterReachableIds = new Set(supporterReachableProvinces.map((p) => p.id));
                        // 交集合を取る
                        const intersection = new Set<string>();
                        for (const prov of supporterReachableIds) {
                          if (targetReachableIds.has(prov)) {
                            intersection.add(prov);
                          }
                        }
                        setHypotheticalReachableProvinceIds(intersection);
                      } else {
                        // 輸送の場合は対象の移動可能プロビンスをそのまま使用
                        setHypotheticalReachableProvinceIds(targetReachableIds);
                      }

                      setHypotheticalAwaitingInputFor('province');
                      setHypotheticalAwaitingUnitKind(null);
                    } else if (hypotheticalAwaitingInputFor === 'default') {
                      // 他国フライアウトを開く
                      setHypotheticalFlyout({ open: true, unitId: uid, anchorX: clientX, anchorY: clientY });
                    }
                  }
                }}
                onProvinceClick={(provinceId, clientX, clientY) => {
                  // 状態による処理の分岐
                  if (awaitingInputFor === 'province' && flyout) {
                    // 移動先や輸送先プロビンス選択中
                    // 移動/被輸送/支援/輸送の場合、移動可能性を検証
                    if (reachableProvinceIds && !reachableProvinceIds.has(provinceId)) {
                      // 移動不可なプロビンス → クリック無視
                      return;
                    }
                    // 状態リセットを最後に行う
                    if (pendingOrderState?.kind === 'support' && pendingOrderState.targetUnitId) {
                      // 支援命令を確定
                      g.updateOrder(flyout.unitId, {
                        type: OrderType.Support,
                        supportedUnitId: pendingOrderState.targetUnitId,
                        supportToProvinceId: provinceId,
                      });
                    } else if (pendingOrderState?.kind === 'convoy' && pendingOrderState.targetUnitId) {
                      // 輸送命令を確定
                      g.updateOrder(flyout.unitId, {
                        type: OrderType.Convoy,
                        convoyArmyId: pendingOrderState.targetUnitId,
                        convoyToProvinceId: provinceId,
                      });
                    } else {
                      // 移動命令を確定
                      g.updateOrder(flyout.unitId, { targetProvinceId: provinceId });
                    }
                    // 交渉フェーズでは自国想定行動も想定行動ローカルストレージに反映
                    if (showNegotiationHypothetical) {
                      updateHypotheticalOrders((prev) => ({
                        ...prev,
                        [flyout.unitId]: { ...prev[flyout.unitId] ?? emptyOrder(), ...((pendingOrderState?.kind === 'support' && pendingOrderState.targetUnitId) ? {
                          type: OrderType.Support,
                          supportedUnitId: pendingOrderState.targetUnitId,
                          supportToProvinceId: provinceId,
                        } : (pendingOrderState?.kind === 'convoy' && pendingOrderState.targetUnitId) ? {
                          type: OrderType.Convoy,
                          convoyArmyId: pendingOrderState.targetUnitId,
                          convoyToProvinceId: provinceId,
                        } : {
                          type: OrderType.Move,
                          targetProvinceId: provinceId,
                        }) },
                      }));
                    } else {
                      // オンライン同期: unitOrders 更新完了後に markPowerOrderSaved を呼ぶ
                      // updateOrder は非同期で setUnitOrders をスケジュールするため、
                      // useEffect で unitOrders 変化を監視して markPowerOrderSaved を呼ぶ
                      pendingMarkSavedRef.current = powerId;
                    }
                    // 状態リセット
                    setFlyout(null);
                    setAwaitingInputFor('default');
                    setFlyoutStep(null);
                    setPendingOrderState(null);
                    setAwaitingUnitKind(null);
                    setReachableProvinceIds(null);
                  } else if (awaitingInputFor === 'default' && !flyout) {
                    // フライアウトが閉じていてプロビンスをクリック → 増産フェーズなら開く
                    if (isAdjustmentPhasePanel && remainingBuildCapacity > 0) {
                      // 空のプロビンス → フライアウト開く（陸軍/海軍を選択）
                      setFlyout({ open: true, unitId: provinceId, anchorX: clientX, anchorY: clientY });
                    }
                  }
                  // awaitingInputFor === 'default' かつ flyout が開いている場合はクリック無視
                  // (フライアウト内のボタンで処理される)

                  // 他国プロビンス選択（ローカル想定行動のみ）
                  if (hypotheticalAwaitingInputFor === 'province' && hypotheticalFlyout && isMovementPhase) {
                    // 他国の移動/支援/輸送先プロビンス選択中
                    if (hypotheticalReachableProvinceIds && !hypotheticalReachableProvinceIds.has(provinceId)) {
                      // 移動不可なプロビンス → クリック無視
                      return;
                    }
                    // ローカル state に想定行動を更新（サーバー同期しない）
                    if (hypotheticalPendingOrderState?.kind === 'support' && hypotheticalPendingOrderState.targetUnitId) {
                      // 支援命令
                      updateHypotheticalOrders((prev) => ({
                        ...prev,
                        [hypotheticalFlyout.unitId]: {
                          ...emptyOrder(),
                          type: OrderType.Support,
                          supportedUnitId: hypotheticalPendingOrderState.targetUnitId,
                          supportToProvinceId: provinceId,
                        },
                      }));
                    } else if (hypotheticalPendingOrderState?.kind === 'convoy' && hypotheticalPendingOrderState.targetUnitId) {
                      // 輸送命令
                      updateHypotheticalOrders((prev) => ({
                        ...prev,
                        [hypotheticalFlyout.unitId]: {
                          ...emptyOrder(),
                          type: OrderType.Convoy,
                          convoyArmyId: hypotheticalPendingOrderState.targetUnitId,
                          convoyToProvinceId: provinceId,
                        },
                      }));
                    } else {
                      // 移動命令
                      updateHypotheticalOrders((prev) => ({
                        ...prev,
                        [hypotheticalFlyout.unitId]: { ...emptyOrder(), type: OrderType.Move, targetProvinceId: provinceId },
                      }));
                    }
                    // 状態リセット
                    setHypotheticalFlyout(null);
                    setHypotheticalAwaitingInputFor('default');
                    setHypotheticalFlyoutStep(null);
                    setHypotheticalPendingOrderState(null);
                    setHypotheticalAwaitingUnitKind(null);
                    setHypotheticalReachableProvinceIds(null);
                  }
                }}
              />
            </div>
          </div>

          {/* Center & Right: Desktop side-by-side | Mobile tabbed */}
          <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden flex-col lg:flex-row" style={{ minHeight: 0, gap: '0.375rem' }}>
            {/* Desktop: Center & Right side by side (expands with available space) */}
            <div className="hidden lg:flex lg:min-h-0 overflow-hidden flex-1" style={{ minHeight: 0, gap: '0.375rem' }}>
              {/* Center: All-nations unit list or hypothetical (flex-1, grows with available space) */}
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-zinc-200/70 bg-white shadow-md shadow-zinc-900/[0.06] ring-1 ring-black/[0.03]">
                {showNegotiationHypothetical && hypotheticalIsLoaded ? (
                  // 交渉フェーズ: 全勢力の想定行動パネルのみ（単独スクロール）
                  <div className="min-h-0 flex-1 overflow-y-auto p-3 [scrollbar-width:thin] sm:p-4">
                    <HypotheticalForeignOrdersPanel
                      powerId={powerId}
                      includeSelf={true}
                      board={board}
                      orderAdjKeys={orderAdjKeys}
                      scenarios={hypotheticalScenarios as HypotheticalScenarioState[]}
                      activeScenarioIndex={hypotheticalActiveIndex}
                      onSelectScenario={handleSelectHypotheticalScenario}
                      onAddScenario={handleAddHypotheticalScenario}
                      hypotheticalOrders={activeHypotheticalOrders}
                      setHypotheticalOrders={updateHypotheticalOrders}
                    />
                  </div>
                ) : (
                  // 命令フェーズ / 退却 / 調整 / ロック中: 命令入力ワークベンチ
                  // 命令フェーズのみ他国想定行動をスクロール領域末尾に追記
                  <PowerSecretWorkbench
                    powerId={powerId}
                    showMainPageLink={onlineSession == null}
                    scrollAppendContent={
                      showOrdersInput && hypotheticalIsLoaded ? (
                        <HypotheticalForeignOrdersPanel
                          powerId={powerId}
                          includeSelf={false}
                          board={board}
                          orderAdjKeys={orderAdjKeys}
                          scenarios={hypotheticalScenarios as HypotheticalScenarioState[]}
                          activeScenarioIndex={hypotheticalActiveIndex}
                          onSelectScenario={handleSelectHypotheticalScenario}
                          onAddScenario={handleAddHypotheticalScenario}
                          hypotheticalOrders={activeHypotheticalOrders}
                          setHypotheticalOrders={updateHypotheticalOrders}
                        />
                      ) : undefined
                    }
                    scrollContainerRef={workbenchScrollRef}
                  />
                )}
              </div>

              {/* Right: Treaty panel (268px fixed) */}
              <div className="flex w-[268px] shrink-0 flex-col min-h-0 overflow-hidden rounded-2xl border border-zinc-200/70 bg-white shadow-md shadow-zinc-900/[0.06] ring-1 ring-black/[0.03]">
                <div className="min-h-0 flex-1 overflow-y-auto p-3 [scrollbar-width:thin] sm:p-4">
                  <PowerTreatyPanel powerId={powerId} />
                </div>
              </div>
            </div>

            {/* Mobile: Tabbed content */}
            <div className="flex lg:hidden flex-col min-h-0 flex-1 rounded-2xl border border-zinc-200/70 bg-white shadow-md shadow-zinc-900/[0.06] ring-1 ring-black/[0.03]">
              {/* Tab buttons */}
              <div className="flex gap-2 shrink-0 border-b border-zinc-200 p-2">
                <button
                  onClick={() => setMobileCenterTabActive('orders')}
                  className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                    mobileCenterTabActive === 'orders'
                      ? 'bg-zinc-900 text-white'
                      : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'
                  }`}
                >
                  行動入力
                </button>
                <button
                  onClick={() => setMobileCenterTabActive('treaties')}
                  className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                    mobileCenterTabActive === 'treaties'
                      ? 'bg-zinc-900 text-white'
                      : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'
                  }`}
                >
                  条約
                </button>
              </div>

              {/* Tab content */}
              {mobileCenterTabActive === 'orders' && (
                <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                  {showNegotiationHypothetical && hypotheticalIsLoaded ? (
                    // 交渉フェーズ: 全勢力の想定行動パネルのみ（単独スクロール）
                    <div className="min-h-0 flex-1 overflow-y-auto p-3 [scrollbar-width:thin] sm:p-4">
                      <HypotheticalForeignOrdersPanel
                        powerId={powerId}
                        includeSelf={true}
                        board={board}
                        orderAdjKeys={orderAdjKeys}
                        scenarios={hypotheticalScenarios as HypotheticalScenarioState[]}
                        activeScenarioIndex={hypotheticalActiveIndex}
                        onSelectScenario={handleSelectHypotheticalScenario}
                        onAddScenario={handleAddHypotheticalScenario}
                        hypotheticalOrders={activeHypotheticalOrders}
                        setHypotheticalOrders={updateHypotheticalOrders}
                      />
                    </div>
                  ) : (
                    // 命令フェーズ / 退却 / 調整 / ロック中: 命令入力ワークベンチ
                    <PowerSecretWorkbench
                      powerId={powerId}
                      showMainPageLink={onlineSession == null}
                      scrollAppendContent={
                        showOrdersInput && hypotheticalIsLoaded ? (
                          <HypotheticalForeignOrdersPanel
                            powerId={powerId}
                            includeSelf={false}
                            board={board}
                            orderAdjKeys={orderAdjKeys}
                            scenarios={hypotheticalScenarios as HypotheticalScenarioState[]}
                            activeScenarioIndex={hypotheticalActiveIndex}
                            onSelectScenario={handleSelectHypotheticalScenario}
                            onAddScenario={handleAddHypotheticalScenario}
                            hypotheticalOrders={activeHypotheticalOrders}
                            setHypotheticalOrders={updateHypotheticalOrders}
                          />
                        ) : undefined
                      }
                      scrollContainerRef={workbenchScrollRef}
                    />
                  )}
                </div>
              )}

              {mobileCenterTabActive === 'treaties' && (
                <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                  <div className="min-h-0 flex-1 overflow-y-auto p-3 [scrollbar-width:thin] sm:p-4">
                    <PowerTreatyPanel powerId={powerId} />
                  </div>
                </div>
              )}

              {/* Mobile action button at bottom */}
              <div className="shrink-0 lg:hidden">
                <Link
                  href="/"
                  className="block w-full rounded-lg bg-zinc-900 px-4 py-2.5 text-center text-sm font-semibold text-white shadow-md shadow-zinc-900/20 transition-colors hover:bg-zinc-800"
                >
                  メインに戻る
                </Link>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* フライアウトメニュー */}
      {flyout && board && (
        <FlyoutMenu
          open={flyout.open}
          anchorX={flyout.anchorX}
          anchorY={flyout.anchorY}
          onClose={() => {
            setFlyout(null);
            setAwaitingInputFor('default');
            setFlyoutStep(null);
            setPendingOrderState(null);
            setAwaitingUnitKind(null);
            setReachableProvinceIds(null);
          }}
          phase={isRetreatPhase ? 'retreat' : isAdjustmentPhasePanel ? 'adjustment' : 'movement'}
          unitId={flyout.unitId}
          unit={currentUnit ?? null}
          step={flyoutStep as any}
          supportableUnits={supportableUnits}
          convoyableArmies={convoyableArmies}
          retreatOptions={retreatOptions}
          isDisbandPending={
            isAdjustmentPhasePanel &&
            !flyout.unitId.startsWith('_new_') &&
            (disbandPlan[powerId] ?? []).some((slot) => slot.unitId === flyout.unitId)
          }
          canConvoyedMove={canConvoyedMove}
          onHold={(uid) => {
            g.changeOrderType(uid, OrderType.Hold);
            pendingMarkSavedRef.current = powerId;
            setFlyout(null);
            setAwaitingInputFor('default');
            setFlyoutStep(null);
            setAwaitingUnitKind(null);
            setReachableProvinceIds(null);
          }}
          onMoveStart={(uid) => {
            g.changeOrderType(uid, OrderType.Move);
            setAwaitingInputFor('province');
            // 移動可能なプロビンスを計算
            const unit = board.units.find((u) => u.id === uid);
            if (unit) {
              const reachableProvinces = getReachableProvinces(board, unit, orderAdjKeys);
              const reachableIds = new Set(reachableProvinces.map((p) => p.id));
              setReachableProvinceIds(reachableIds);
            }
            // フライアウトを閉じて（でもunitIdは保持）、地図上の強調表示で促す
            setFlyout((prev) => prev ? { ...prev, open: false } : null);
            setFlyoutStep(null);
          }}
          onConvoyedMoveStart={(uid) => {
            // 被輸送の場合も移動先プロビンス選択
            g.changeOrderType(uid, OrderType.Move);
            setAwaitingInputFor('province');
            // 被輸送の場合も移動可能なプロビンスを計算
            const unit = board.units.find((u) => u.id === uid);
            if (unit) {
              const reachableProvinces = getReachableProvinces(board, unit, orderAdjKeys);
              const reachableIds = new Set(reachableProvinces.map((p) => p.id));
              setReachableProvinceIds(reachableIds);
            }
            // フライアウトを閉じて（でもunitIdは保持）、地図上の強調表示で促す
            setFlyout((prev) => prev ? { ...prev, open: false } : null);
            setFlyoutStep(null);
          }}
          onSupportStart={(uid) => {
            // 支援対象ユニット選択へ
            g.changeOrderType(uid, OrderType.Support);
            setAwaitingInputFor('unit');
            setAwaitingUnitKind('support');
            setReachableProvinceIds(null);
            // フライアウトを閉じて、地図上で対象ユニットをハイライト
            setFlyout((prev) => prev ? { ...prev, open: false } : null);
          }}
          onConvoyStart={(uid) => {
            // 輸送対象陸軍選択へ
            g.changeOrderType(uid, OrderType.Convoy);
            setAwaitingInputFor('unit');
            setAwaitingUnitKind('convoy');
            setReachableProvinceIds(null);
            // フライアウトを閉じて、地図上で対象ユニットをハイライト
            setFlyout((prev) => prev ? { ...prev, open: false } : null);
          }}
          onRetreatChoice={(uid, destProvId) => {
            g.setRetreatTargets((prev) => ({
              ...prev,
              [uid]: destProvId,
            }));
            setFlyout(null);
            setAwaitingInputFor('default');
            setFlyoutStep(null);
            setAwaitingUnitKind(null);
            setReachableProvinceIds(null);
          }}
          onDisband={(uid) => {
            if (isAdjustmentPhasePanel) {
              // 増産取り消し: buildPlan から削除
              if (uid.startsWith('_new_')) {
                const provId = uid.substring('_new_'.length);
                g.setBuildPlan((prev) => {
                  const prevSlots = prev[powerId] ? [...prev[powerId]] : [];
                  const newSlots = prevSlots.filter((slot) => slot.provinceId !== provId);
                  return { ...prev, [powerId]: newSlots };
                });
              } else {
                // 既存ユニットの削減トグル
                g.setDisbandPlan((prev) => {
                  const prevSlots = prev[powerId] ? [...prev[powerId]] : [];
                  const isAlreadyMarked = prevSlots.some((slot) => slot.unitId === uid);
                  if (isAlreadyMarked) {
                    // 削除マーク済み → 削除をキャンセル
                    return { ...prev, [powerId]: prevSlots.filter((slot) => slot.unitId !== uid) };
                  } else {
                    // 未マーク → 削除をマーク
                    return { ...prev, [powerId]: [...prevSlots, { unitId: uid }] };
                  }
                });
              }
            } else if (isRetreatPhase) {
              // 退却フェーズ: 解体
              g.setDisbandPlan((prev) => {
                const prevSlots = prev[powerId] ? [...prev[powerId]] : [];
                prevSlots.push({ unitId: uid });
                return { ...prev, [powerId]: prevSlots };
              });
            }
            setFlyout(null);
            setAwaitingInputFor('default');
            setFlyoutStep(null);
            setAwaitingUnitKind(null);
            setReachableProvinceIds(null);
          }}
          onBuild={(provId, unitType) => {
            // 増産可能数をチェック
            if (remainingBuildCapacity <= 0) {
              // 増産可能数が0以下なら処理しない
              setFlyout(null);
              return;
            }
            g.setBuildPlan((prev) => {
              const prevSlots = prev[powerId] ? [...prev[powerId]] : [];
              // 増産可能数チェック（念のため）
              if (prevSlots.length >= buildCap) {
                return prev;
              }
              prevSlots.push({
                provinceId: provId,
                unitType,
                buildFleetCoast: '',
              });
              return { ...prev, [powerId]: prevSlots };
            });
            setFlyout(null);
            setAwaitingInputFor('default');
            setFlyoutStep(null);
            setAwaitingUnitKind(null);
            setReachableProvinceIds(null);
          }}
          onBuildTypeChange={(uid, newType) => {
            // uid が _new_ prefix なら仮ユニット、そうでなければ既存ユニット
            let provinceId: string | null = null;

            if (uid.startsWith('_new_')) {
              // 仮ユニット: _new_PROVID から provinceId を抽出
              provinceId = uid.substring('_new_'.length);
            } else {
              // 既存ユニット: board から provinceId を取得
              const unit = board.units.find((u) => u.id === uid);
              if (!unit) return;
              provinceId = unit.provinceId;
            }

            g.setBuildPlan((prev) => {
              const prevSlots = prev[powerId] ? [...prev[powerId]] : [];
              const idx = prevSlots.findIndex((slot) => slot.provinceId === provinceId);
              if (idx >= 0) {
                const newSlots = [...prevSlots];
                newSlots[idx] = { ...newSlots[idx], unitType: newType };
                return { ...prev, [powerId]: newSlots };
              }
              return prev;
            });
            setFlyout(null);
            setAwaitingInputFor('default');
            setFlyoutStep(null);
            setAwaitingUnitKind(null);
          }}
        />
      )}

      {/* 他国ユニット用フライアウトメニュー（ローカル想定行動のみ） */}
      {hypotheticalFlyout && board && isMovementPhase && (
        <FlyoutMenu
          open={hypotheticalFlyout.open}
          anchorX={hypotheticalFlyout.anchorX}
          anchorY={hypotheticalFlyout.anchorY}
          onClose={() => {
            setHypotheticalFlyout(null);
            setHypotheticalAwaitingInputFor('default');
            setHypotheticalFlyoutStep(null);
            setHypotheticalPendingOrderState(null);
            setHypotheticalAwaitingUnitKind(null);
            setHypotheticalReachableProvinceIds(null);
          }}
          phase="movement"
          unitId={hypotheticalFlyout.unitId}
          unit={board.units.find((u) => u.id === hypotheticalFlyout.unitId) ?? null}
          step={hypotheticalFlyoutStep as any}
          supportableUnits={(() => {
            const hypoUnit = board.units.find((u) => u.id === hypotheticalFlyout.unitId);
            if (!hypoUnit) return [];
            // ドロップダウンと同じロジック: canSupportTargetInSupportOrder で支援可能なユニットのみ
            return board.units.filter((u) =>
              u.id !== hypotheticalFlyout.unitId &&
              canSupportTargetInSupportOrder(board, hypoUnit, u, orderAdjKeys)
            );
          })()}
          convoyableArmies={(() => {
            const hypoUnit = board.units.find((u) => u.id === hypotheticalFlyout.unitId);
            if (!hypoUnit || hypoUnit.type !== UnitType.Fleet) return [];
            // hypothetical 海軍と同じプロビンスに存在する陸軍
            return board.units.filter((u) => u.type === UnitType.Army && u.provinceId === hypoUnit.provinceId);
          })()}
          retreatOptions={[]}
          canConvoyedMove={(() => {
            const hypoUnit = board.units.find((u) => u.id === hypotheticalFlyout.unitId);
            if (!hypoUnit || hypoUnit.type !== UnitType.Army) return false;
            return board.units.some(
              (u) => u.type === UnitType.Fleet && u.provinceId === hypoUnit.provinceId
            );
          })()}
          onHold={(uid) => {
            updateHypotheticalOrders((prev) => ({
              ...prev,
              [uid]: { ...emptyOrder(), type: OrderType.Hold },
            }));
            setHypotheticalFlyout(null);
            setHypotheticalAwaitingInputFor('default');
            setHypotheticalFlyoutStep(null);
            setHypotheticalAwaitingUnitKind(null);
          }}
          onMoveStart={(uid) => {
            setHypotheticalFlyoutStep('moveSelect');
            setHypotheticalAwaitingInputFor('province');
            // 移動可能なプロビンスを計算
            const unit = board.units.find((u) => u.id === uid);
            if (unit) {
              const reachableProvinces = getReachableProvinces(board, unit, orderAdjKeys);
              const reachableIds = new Set(reachableProvinces.map((p) => p.id));
              setHypotheticalReachableProvinceIds(reachableIds);
            }
            // フライアウトを閉じて（でも unitId は保持）
            setHypotheticalFlyout((prev) => prev ? { ...prev, open: false } : null);
          }}
          onConvoyedMoveStart={(uid) => {
            // 他国で被輸送はあまり使われないが、念のため実装
            setHypotheticalFlyoutStep('moveSelect');
            setHypotheticalAwaitingInputFor('province');
            const unit = board.units.find((u) => u.id === uid);
            if (unit) {
              const reachableProvinces = getReachableProvinces(board, unit, orderAdjKeys);
              const reachableIds = new Set(reachableProvinces.map((p) => p.id));
              setHypotheticalReachableProvinceIds(reachableIds);
            }
            // フライアウトを閉じて
            setHypotheticalFlyout((prev) => prev ? { ...prev, open: false } : null);
          }}
          onSupportStart={(uid) => {
            setHypotheticalAwaitingInputFor('unit');
            setHypotheticalAwaitingUnitKind('support');
            // フライアウトを閉じて、地図上で対象ユニットをハイライト
            setHypotheticalFlyout((prev) => prev ? { ...prev, open: false } : null);
          }}
          onConvoyStart={(uid) => {
            setHypotheticalAwaitingInputFor('unit');
            setHypotheticalAwaitingUnitKind('convoy');
            // フライアウトを閉じて、地図上で対象ユニットをハイライト
            setHypotheticalFlyout((prev) => prev ? { ...prev, open: false } : null);
          }}
          onRetreatChoice={() => {}}
          onDisband={() => {}}
          onBuild={() => {}}
        />
      )}
    </div>
  );
}
