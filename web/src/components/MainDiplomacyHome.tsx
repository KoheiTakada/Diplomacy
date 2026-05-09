/**
 * ディプロマシー支援ツールのメインページ（集約画面）
 *
 * 概要:
 *   盤面・ログの共有表示と、右パネル内の各国導線・フェーズ確定（通常・退却・調整）を提供する。
 *   各国の命令・退却・調整の具体入力は各国ページに分離する。
 *
 * 主な機能:
 *   - 勢力別の入力完了状況表示（見出し: 命令フェーズ / 解体フェーズ / 増産フェーズ）
 *   - 役職確認ダイアログ付きの各国リンク
 *   - 命令実行（移動・退却・調整。全員の記録と検証を満たしたときのみ有効）
 *
 * 想定される制限事項:
 *   - オンライン卓は Supabase へ同期。IndexedDB への保存は内部実装として残る。
 *   - オンラインで各国として参加した場合は自国の命令入力のみ有効。裁定はホストのみ。
 */

'use client';

import { useDiplomacyGame } from '@/context/DiplomacyGameContext';
import {
  countSupplyCenters,
  countUnits,
  isPowerAdjustmentSlotsFilled,
  isPowerOrdersComplete,
  powerHasUnits,
  POWER_META,
  POWER_ORDER,
  powerNeedsAdjustment,
} from '@/diplomacy/gameHelpers';
import MapView from '@/components/MapView';
import { HostSecretsOverviewModal } from '@/components/HostSecretsOverviewModal';
import { HostBoardEditPanel } from '@/components/HostBoardEditPanel';
import { PowerLabelText } from '@/components/PowerLabelText';
import { PowerNationLink } from '@/components/PowerNationLink';
import { AppHeader } from '@/components/AppHeader';
import { PhaseTimeline } from '@/components/PhaseTimeline';
import { HamburgerMenu } from '@/components/HamburgerMenu';
import { readOnlinePowerSecrets } from '@/lib/onlineSessionBrowser';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';

/**
 * テキストを一定文字数で分割する
 */
function splitLogLine(text: string, maxLength: number = 20): string[] {
  const result: string[] = [];
  for (let i = 0; i < text.length; i += maxLength) {
    result.push(text.substring(i, i + maxLength));
  }
  return result.length === 0 ? [text] : result;
}

/**
 * メイン集約 UI。
 */
export function MainDiplomacyHome() {
  const router = useRouter();
  const g = useDiplomacyGame();
  const {
    board,
    setBoard,
    unitOrders,
    log,
    turnHistory,
    leaveGameSession,
    pendingMapEffectsRef,
    isResolutionRevealing,
    isRetreatPhase,
    pendingRetreats,
    isAdjustmentPhasePanel,
    isOrderLocked,
    disbandPlan,
    buildPlan,
    powerOrderSaved,
    powerAdjustmentSaved,
    powerRetreatSaved,
    handleAdjudicate,
    confirmRetreatPhase,
    finalizeAdjustmentPhase,
    allPowersMovementReady,
    allPowersAdjustmentReady,
    allPowersRetreatReady,
    onlineSession,
    downloadOnlineDebugLog,
    diplomacyPhase,
    advanceToOrdersPhase,
  } = g;

  const hostPowerLinkSecrets = useMemo(() => {
    if (onlineSession?.kind !== 'host') {
      return null;
    }
    return readOnlinePowerSecrets(onlineSession.roomId);
  }, [onlineSession]);

  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  const [hostSecretsModalOpen, setHostSecretsModalOpen] = useState(false);
  const closeHostSecretsModal = useCallback(() => {
    setHostSecretsModalOpen(false);
  }, []);

  const [boardEditPanelOpen, setBoardEditPanelOpen] = useState(false);
  const [editedBoard, setEditedBoard] = useState<typeof board | null>(null);

  // スマートフォン版のタブ状態（"log" or "nations"）
  const [mobileTabActive, setMobileTabActive] = useState<'log' | 'nations'>('nations');

  const closeBoardEditPanel = useCallback(() => {
    setBoardEditPanelOpen(false);
    setEditedBoard(null);
  }, []);

  const handleBoardEditPanelOpen = useCallback(() => {
    setEditedBoard(board);
    setBoardEditPanelOpen(true);
  }, [board]);

  const handleApplyBoardEdit = useCallback(
    (newBoard: typeof board) => {
      setBoard(newBoard);
      setEditedBoard(null);
      setBoardEditPanelOpen(false);
    },
    [setBoard],
  );

  const boardEditHighlightSet = useMemo<Set<string> | null>(() => {
    if (!boardEditPanelOpen || !editedBoard) return null;
    const changed = new Set<string>();
    const origIds = new Map(board.units.map((u) => [u.id, u]));
    const editedIds = new Map(editedBoard.units.map((u) => [u.id, u]));
    // ユニット削除・移動・種別変更
    for (const [id, u] of origIds) {
      if (!editedIds.has(id)) {
        changed.add(u.provinceId);
        continue;
      }
      const eu = editedIds.get(id)!;
      if (eu.provinceId !== u.provinceId) {
        changed.add(u.provinceId);
        changed.add(eu.provinceId);
      }
      if (eu.type !== u.type) {
        changed.add(u.provinceId);
      }
    }
    // ユニット追加
    for (const [id, u] of editedIds) {
      if (!origIds.has(id)) {
        changed.add(u.provinceId);
      }
    }
    // 補給拠点所有権変更
    for (const [pid, owner] of Object.entries(editedBoard.supplyCenterOwnership)) {
      if (board.supplyCenterOwnership[pid] !== owner) {
        changed.add(pid);
      }
    }
    return changed.size > 0 ? changed : null;
  }, [board, editedBoard, boardEditPanelOpen]);

  const supplyCenterRankByPower = useMemo(() => {
    const sorted = [...POWER_ORDER]
      .map((pid) => ({ pid, sc: countSupplyCenters(board, pid) }))
      .sort((a, b) => b.sc - a.sc);
    const rankMap = new Map<string, number>();
    for (let i = 0; i < sorted.length; i += 1) {
      const cur = sorted[i];
      if (i === 0) {
        rankMap.set(cur.pid, 1);
        continue;
      }
      const prev = sorted[i - 1];
      if (cur.sc === prev.sc) {
        rankMap.set(cur.pid, rankMap.get(prev.pid)!);
      } else {
        rankMap.set(cur.pid, i + 1);
      }
    }
    return rankMap;
  }, [board]);

  const retreatPowers = useMemo(() => {
    const s = new Set<string>();
    for (const d of pendingRetreats) {
      s.add(d.unit.powerId);
    }
    return s;
  }, [pendingRetreats]);

  const mapAspectRatio = '641.66 / 595.28';

  function movementStatusLine(pid: string): string {
    if (!powerHasUnits(board, pid)) {
      return 'ユニットなし（不要）';
    }
    const ok = isPowerOrdersComplete(board, unitOrders, pid);
    const saved = powerOrderSaved[pid] === true;
    if (saved && ok) {
      return '完了';
    }
    if (saved && !ok) {
      return '記録済み・内容に不備';
    }
    return '未入力';
  }

  function orderStatusLine(pid: string): string {
    if (!powerHasUnits(board, pid)) {
      return '不要';
    }
    const complete = isPowerOrdersComplete(board, unitOrders, pid);
    const saved = powerOrderSaved[pid] === true;
    return (saved && complete) ? '完了' : '未入力';
  }

  function adjustmentStatusLine(pid: string): string {
    if (!powerNeedsAdjustment(board, pid)) {
      return '不要';
    }
    const slots = isPowerAdjustmentSlotsFilled(
      board,
      pid,
      disbandPlan,
      buildPlan,
    );
    const saved = powerAdjustmentSaved[pid] === true;
    return (saved && slots) ? '完了' : '未入力';
  }

  function retreatStatusLine(pid: string): string {
    if (!retreatPowers.has(pid)) {
      return '不要';
    }
    return powerRetreatSaved[pid] === true ? '完了' : '未入力';
  }

  // 現在のフェーズに応じたステータス表示
  function currentPhaseStatusLine(pid: string): string | null {
    if (isOrderLocked && !isRetreatPhase && !isAdjustmentPhasePanel) {
      return null;
    }
    if (isRetreatPhase) {
      return `退却: ${retreatStatusLine(pid)}`;
    }
    if (isAdjustmentPhasePanel) {
      return `調整: ${adjustmentStatusLine(pid)}`;
    }
    if (diplomacyPhase === 'orders') {
      return `命令: ${orderStatusLine(pid)}`;
    }
    return null;
  }

  const handlePhaseAction = useCallback(() => {
    if (isRetreatPhase) {
      confirmRetreatPhase();
    } else if (isAdjustmentPhasePanel) {
      finalizeAdjustmentPhase();
    } else if (diplomacyPhase === 'negotiation') {
      advanceToOrdersPhase();
    } else if (diplomacyPhase === 'orders') {
      handleAdjudicate();
    }
  }, [
    isRetreatPhase,
    isAdjustmentPhasePanel,
    diplomacyPhase,
    confirmRetreatPhase,
    finalizeAdjustmentPhase,
    advanceToOrdersPhase,
    handleAdjudicate,
  ]);

  const isHostOrLocal = onlineSession?.kind !== 'power';
  const displayName =
    onlineSession?.kind === 'power'
      ? POWER_META[onlineSession.powerId]?.label ?? onlineSession.powerId
      : onlineSession?.kind === 'host'
        ? 'ホスト'
        : 'ローカル';

  const actionButton = isHostOrLocal ? (
    <button
      type="button"
      disabled={
        (isRetreatPhase && !allPowersRetreatReady) ||
        (isAdjustmentPhasePanel && !allPowersAdjustmentReady) ||
        (!isRetreatPhase && !isAdjustmentPhasePanel &&
          diplomacyPhase === 'orders' &&
          (isOrderLocked || !allPowersMovementReady))
      }
      onClick={handlePhaseAction}
      className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-zinc-900/20 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
    >
      フェーズ進行
    </button>
  ) : (
    <Link
      href={`/power/${onlineSession?.powerId}`}
      className="rounded-lg bg-zinc-900 px-4 py-2 text-center text-sm font-semibold text-white shadow-md shadow-zinc-900/20 transition-colors hover:bg-zinc-800"
    >
      命令入力
    </Link>
  );

  return (
    <div className="flex h-dvh max-h-dvh flex-col overflow-hidden font-sans text-zinc-900">
      <AppHeader displayName={displayName} onMenuClick={() => setMenuOpen(true)} />
      <PhaseTimeline
        year={board.turn.year}
        season={board.turn.season}
        diplomacyPhase={diplomacyPhase}
        isRetreatPhase={isRetreatPhase}
        isAdjustmentPhasePanel={isAdjustmentPhasePanel}
        isResolutionRevealing={isResolutionRevealing}
        rightAction={actionButton}
      />
      <HamburgerMenu
        open={menuOpen}
        isHostOrLocal={isHostOrLocal}
        onClose={closeMenu}
        onSecrets={isHostOrLocal ? () => setHostSecretsModalOpen(true) : undefined}
        onDebugLog={
          onlineSession
            ? downloadOnlineDebugLog
            : undefined
        }
        onBoardEdit={
          isHostOrLocal ? handleBoardEditPanelOpen : undefined
        }
        onLeave={() => {
          leaveGameSession({
            intentional: true,
            reason: 'hamburger_menu_leave_button',
          });
          router.replace('/', { scroll: false });
        }}
      />
      <main className="mx-auto flex h-full min-h-0 w-full max-w-[1920px] flex-col overflow-hidden px-3 py-2 sm:px-4 sm:py-2 lg:px-6 lg:py-3">
        {onlineSession?.kind === 'host' ? (
          <HostSecretsOverviewModal
            open={hostSecretsModalOpen}
            onClose={closeHostSecretsModal}
            roomId={onlineSession.roomId}
            hostSecretFromContext={onlineSession.hostSecret}
            powerSecrets={hostPowerLinkSecrets}
          />
        ) : null}

        {/* Desktop: 3-column (map maximized + log/nations minimum) | Mobile: Stacked with tabs */}
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden flex-col lg:flex-row" style={{ minHeight: 0, gap: '0.375rem' }}>
          {/* Map: flex-1 on mobile (full width, no border), max-h-full on desktop (styled) */}
          <div
            className="flex-1 min-w-0 overflow-hidden lg:rounded-2xl lg:border lg:border-zinc-200/70 lg:bg-white lg:shadow-md lg:shadow-zinc-900/[0.06] lg:ring-1 lg:ring-black/[0.03] lg:max-h-full"
            style={boardEditPanelOpen
              ? { minHeight: 0, minWidth: '300px' }
              : { aspectRatio: mapAspectRatio, minHeight: 0, minWidth: '300px' }
            }
          >
            {boardEditPanelOpen ? (
              <HostBoardEditPanel
                board={board}
                editedBoard={editedBoard ?? board}
                onEditedBoardChange={setEditedBoard}
                onClose={closeBoardEditPanel}
                onApply={handleApplyBoardEdit}
              />
            ) : (
              <div className="flex h-full flex-col overflow-hidden p-0 lg:p-3 sm:lg:p-4">
                <MapView
                  board={board}
                  highlightedProvinceIds={boardEditHighlightSet ?? undefined}
                  isResolutionRevealing={isResolutionRevealing}
                  pendingMapEffectsRef={pendingMapEffectsRef}
                  historyEntries={turnHistory}
                />
              </div>
            )}
          </div>

          {/* Desktop: Log and Nations side by side | Mobile: Tabbed */}
          <div className="hidden lg:flex lg:min-h-0 overflow-hidden flex-1" style={{ minHeight: 0, gap: '0.375rem' }}>
            {/* Log - Desktop only (minimum 160px) */}
            <div className="flex shrink-0 flex-col overflow-hidden" style={{ minWidth: '160px' }}>
              <section className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-zinc-200/70 bg-white p-2 shadow-md shadow-zinc-900/[0.06] ring-1 ring-black/[0.03]">
                {log.length === 0 ? (
                  <p className="text-center text-[10px] text-zinc-400">
                    ログなし
                  </p>
                ) : (
                  <ul className="space-y-0 text-[10px] leading-snug [scrollbar-width:thin]">
                    {log.map((entry) => {
                      const isHeader = entry.line.startsWith('──');
                      const lines = splitLogLine(entry.line);
                      return (
                        <li
                          key={entry.id}
                          className={
                            isHeader
                              ? 'mt-1 first:mt-0 rounded bg-zinc-100/80 px-1.5 py-0.5 font-semibold text-zinc-800'
                              : 'border-b border-zinc-100 py-0.5 last:border-0'
                          }
                        >
                          {lines.map((line, idx) => (
                            <div key={idx}>{line}</div>
                          ))}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </div>

            {/* Nations list - Desktop only (flex-1, grows with available space) */}
            <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
              <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-zinc-200/70 bg-white shadow-md shadow-zinc-900/[0.06] ring-1 ring-black/[0.03]">
                <ul className="divide-y divide-zinc-100 text-[11px]">
                  {POWER_ORDER.map((pid, idx) => {
                    const meta = POWER_META[pid] ?? { color: '#334155', label: pid };
                    const sc = countSupplyCenters(board, pid);
                    const uc = countUnits(board, pid);
                    const scRank = supplyCenterRankByPower.get(pid) ?? 1;

                    return (
                      <li
                        key={pid}
                        className="flex flex-col gap-1.5 border-l-4 px-2.5 py-2 text-[11px]"
                        style={{ borderLeftColor: meta.color }}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-zinc-900">
                            #{idx + 1}{' '}
                            <PowerLabelText powerId={pid} />
                          </span>
                          <span className="font-bold text-zinc-400">
                            {scRank}位
                          </span>
                        </div>
                        <div className="flex justify-between text-zinc-600">
                          <span>拠点:{sc}</span>
                          <span>ユニット:{uc}</span>
                        </div>
                        {isHostOrLocal && currentPhaseStatusLine(pid) && (
                          <div className="text-[10px] text-zinc-500 px-1">
                            {currentPhaseStatusLine(pid)}
                          </div>
                        )}
                        {isHostOrLocal && (
                          <PowerNationLink
                            powerId={pid}
                            className="rounded-lg bg-zinc-100 px-2 py-1 text-center text-[10px] font-semibold text-zinc-900 hover:bg-zinc-200 transition-colors"
                          >
                            命令入力
                          </PowerNationLink>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          </div>

          {/* Mobile: Tabbed content with fixed buttons and content */}
          <div className="flex flex-col min-h-0 flex-1 overflow-hidden lg:hidden rounded-2xl border border-zinc-200/70 bg-white shadow-md shadow-zinc-900/[0.06] ring-1 ring-black/[0.03]" style={{ minHeight: 0 }}>
            {/* Tab buttons - fixed height */}
            <div className="flex gap-2 shrink-0 border-b border-zinc-200 p-2">
              <button
                onClick={() => setMobileTabActive('log')}
                className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                  mobileTabActive === 'log'
                    ? 'bg-zinc-900 text-white'
                    : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'
                }`}
              >
                ログ
              </button>
              <button
                onClick={() => setMobileTabActive('nations')}
                className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                  mobileTabActive === 'nations'
                    ? 'bg-zinc-900 text-white'
                    : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'
                }`}
              >
                国一覧
              </button>
            </div>

            {/* Tab content */}
            {mobileTabActive === 'log' && (
              <div className="min-h-0 flex-1 overflow-y-auto bg-white p-2">
                {log.length === 0 ? (
                  <p className="text-center text-[10px] text-zinc-400">
                    ログなし
                  </p>
                ) : (
                  <ul className="space-y-0 text-[10px] leading-snug [scrollbar-width:thin]">
                    {log.map((entry) => {
                      const isHeader = entry.line.startsWith('──');
                      const lines = splitLogLine(entry.line);
                      return (
                        <li
                          key={entry.id}
                          className={
                            isHeader
                              ? 'mt-1 first:mt-0 rounded bg-zinc-100/80 px-1.5 py-0.5 font-semibold text-zinc-800'
                              : 'border-b border-zinc-100 py-0.5 last:border-0'
                          }
                        >
                          {lines.map((line, idx) => (
                            <div key={idx}>{line}</div>
                          ))}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}

            {mobileTabActive === 'nations' && (
              <div className="min-h-0 flex-1 overflow-y-auto bg-white">
                <ul className="divide-y divide-zinc-100">
                  {POWER_ORDER.map((pid, idx) => {
                    const meta = POWER_META[pid] ?? { color: '#334155', label: pid };
                    const sc = countSupplyCenters(board, pid);
                    const uc = countUnits(board, pid);
                    const scRank = supplyCenterRankByPower.get(pid) ?? 1;

                    return (
                      <li
                        key={pid}
                        className="flex flex-col gap-1.5 border-l-4 px-2.5 py-2 text-[11px]"
                        style={{ borderLeftColor: meta.color }}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-zinc-900">
                            #{idx + 1}{' '}
                            <PowerLabelText powerId={pid} />
                          </span>
                          <span className="font-bold text-zinc-400">
                            {scRank}位
                          </span>
                        </div>
                        <div className="flex justify-between text-zinc-600">
                          <span>拠点:{sc}</span>
                          <span>ユニット:{uc}</span>
                        </div>
                        {isHostOrLocal && currentPhaseStatusLine(pid) && (
                          <div className="text-[10px] text-zinc-500 px-1">
                            {currentPhaseStatusLine(pid)}
                          </div>
                        )}
                        {isHostOrLocal && (
                          <PowerNationLink
                            powerId={pid}
                            className="rounded-lg bg-zinc-100 px-2 py-1 text-center text-[10px] font-semibold text-zinc-900 hover:bg-zinc-200 transition-colors"
                          >
                            命令入力
                          </PowerNationLink>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* Mobile action button at bottom */}
            <div className="shrink-0 lg:hidden">
              {isHostOrLocal ? (
                <button
                  type="button"
                  disabled={
                    (isRetreatPhase && !allPowersRetreatReady) ||
                    (isAdjustmentPhasePanel && !allPowersAdjustmentReady) ||
                    (!isRetreatPhase && !isAdjustmentPhasePanel &&
                      diplomacyPhase === 'orders' &&
                      (isOrderLocked || !allPowersMovementReady))
                  }
                  onClick={handlePhaseAction}
                  className="w-full rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-zinc-900/20 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
                >
                  フェーズ進行
                </button>
              ) : (
                <Link
                  href={`/power/${onlineSession?.powerId}`}
                  className="block w-full rounded-lg bg-zinc-900 px-4 py-2.5 text-center text-sm font-semibold text-white shadow-md shadow-zinc-900/20 transition-colors hover:bg-zinc-800"
                >
                  命令入力
                </Link>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
