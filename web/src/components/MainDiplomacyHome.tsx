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
import { PowerLabelText } from '@/components/PowerLabelText';
import { PowerNationLink } from '@/components/PowerNationLink';
import { readOnlinePowerSecrets } from '@/lib/onlineSessionBrowser';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';

/**
 * メイン集約 UI。
 */
export function MainDiplomacyHome() {
  const router = useRouter();
  const g = useDiplomacyGame();
  const {
    board,
    unitOrders,
    log,
    turnHistory,
    logListRef,
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
    onlineServerVersion,
    onlineDebugLogCount,
    downloadOnlineDebugLog,
    clearOnlineDebugLog,
    treatyMapVisuals,
    diplomacyPhase,
    advanceToOrdersPhase,
  } = g;

  const hostPowerLinkSecrets = useMemo(() => {
    if (onlineSession?.kind !== 'host') {
      return null;
    }
    return readOnlinePowerSecrets(onlineSession.roomId);
  }, [onlineSession]);

  const isOnlinePowerPlayer = onlineSession?.kind === 'power';

  const [hostSecretsModalOpen, setHostSecretsModalOpen] = useState(false);
  const closeHostSecretsModal = useCallback(() => {
    setHostSecretsModalOpen(false);
  }, []);

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

  function adjustmentStatusLine(pid: string): string {
    if (!powerNeedsAdjustment(board, pid)) {
      return '調整不要';
    }
    const slots = isPowerAdjustmentSlotsFilled(
      board,
      pid,
      disbandPlan,
      buildPlan,
    );
    const saved = powerAdjustmentSaved[pid] === true;
    if (saved && slots) {
      return '完了';
    }
    if (saved && !slots) {
      return '記録済み・内容に不備';
    }
    return '未入力';
  }

  function retreatStatusLine(pid: string): string {
    if (!retreatPowers.has(pid)) {
      return '対象なし';
    }
    return powerRetreatSaved[pid] === true ? '記録済み' : '未入力';
  }

  return (
    <div className="flex h-dvh max-h-dvh flex-col overflow-hidden font-sans text-zinc-900">
      <main className="mx-auto flex h-full min-h-0 w-full max-w-[1920px] flex-col gap-2 px-3 py-2 sm:gap-2 sm:px-4 sm:py-2 lg:px-6 lg:py-3">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
          {onlineSession?.kind === 'host' ? (
            <button
              type="button"
              onClick={() => setHostSecretsModalOpen(true)}
              className="rounded-lg border border-zinc-300 bg-zinc-100 px-3 py-1.5 text-[11px] font-bold text-zinc-800 shadow-sm hover:bg-zinc-200"
            >
              シークレット一覧を開く
            </button>
          ) : (
            <div className="min-w-0 flex-1" aria-hidden />
          )}
          <button
            type="button"
            onClick={() => {
              leaveGameSession({
                intentional: true,
                reason: 'main_header_back_button',
              });
              router.replace('/', { scroll: false });
            }}
            className="shrink-0 text-[11px] font-medium text-zinc-500 underline-offset-2 hover:text-zinc-700 hover:underline"
          >
            タイトルに戻る
          </button>
        </div>
        {onlineSession?.kind === 'host' ? (
          <HostSecretsOverviewModal
            open={hostSecretsModalOpen}
            onClose={closeHostSecretsModal}
            roomId={onlineSession.roomId}
            hostSecretFromContext={onlineSession.hostSecret}
            powerSecrets={hostPowerLinkSecrets}
          />
        ) : null}
        {onlineSession != null ? (
          <div className="shrink-0 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-[11px] text-zinc-700">
            <p>
              オンライン卓に接続中（データ版{' '}
              <span className="tabular-nums">{onlineServerVersion}</span>
              ・
              {onlineSession.kind === 'host'
                ? 'ホスト'
                : `${onlineSession.powerId} 参加`}
              ）
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={downloadOnlineDebugLog}
                className="rounded border border-zinc-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-zinc-700 hover:bg-zinc-100"
              >
                デバッグログを保存（{onlineDebugLogCount}件）
              </button>
              <button
                type="button"
                onClick={clearOnlineDebugLog}
                className="rounded border border-zinc-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-zinc-700 hover:bg-zinc-100"
              >
                ログをクリア
              </button>
            </div>
          </div>
        ) : null}
        <section
          aria-label="勢力別の補給拠点数とユニット数"
          className="w-full shrink-0 rounded-2xl border border-zinc-200/70 bg-white/90 p-2.5 shadow-sm shadow-zinc-900/5 backdrop-blur-sm sm:p-3"
        >
          <div className="flex flex-nowrap gap-2 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch] [scrollbar-width:thin] sm:gap-3">
            {POWER_ORDER.map((pid) => {
              const meta = POWER_META[pid] ?? { color: '#334155', label: pid };
              const sc = countSupplyCenters(board, pid);
              const uc = countUnits(board, pid);
              const diff = sc - uc;
              const scRank = supplyCenterRankByPower.get(pid) ?? 1;
              return (
                <div
                  key={pid}
                  className="flex min-w-[6.75rem] flex-1 flex-col rounded-xl border border-zinc-200/60 bg-zinc-50/80 px-2.5 py-2 shadow-sm sm:min-w-0 sm:px-3 sm:py-2.5"
                  style={{
                    boxShadow: `inset 3px 0 0 0 ${meta.color}`,
                  }}
                >
                  <div className="mb-1.5 flex items-center justify-between gap-2 pl-0.5">
                    <div className="flex min-w-0 flex-1 items-center gap-1.5">
                      <span
                        className="inline-block h-2 w-2 shrink-0 rounded-full ring-2 ring-white"
                        style={{ backgroundColor: meta.color }}
                      />
                      <span className="min-w-0 truncate text-xs font-semibold text-zinc-800 sm:text-[13px]">
                        <PowerLabelText powerId={pid} />
                      </span>
                    </div>
                    <span className="shrink-0 text-[10px] font-bold tabular-nums text-zinc-400 sm:text-[11px]">
                      {scRank}位
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between gap-2 text-[11px] sm:text-xs">
                    <span className="text-zinc-500">拠点</span>
                    <span className="font-bold tabular-nums text-zinc-900">{sc}</span>
                  </div>
                  <div className="flex items-baseline justify-between gap-2 text-[11px] sm:text-xs">
                    <span className="text-zinc-500">ユニット</span>
                    <span className="font-bold tabular-nums text-zinc-900">{uc}</span>
                  </div>
                  {diff !== 0 && (
                    <p
                      className={
                        diff > 0
                          ? 'mt-1.5 truncate text-[10px] font-medium text-emerald-700 sm:text-[11px]'
                          : 'mt-1.5 truncate text-[10px] font-medium text-rose-700 sm:text-[11px]'
                      }
                    >
                      {diff > 0 ? `+${diff} 増産可` : `${diff} 削減`}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 lg:flex-row lg:items-stretch lg:gap-4">
          <div className="flex min-h-0 min-w-0 flex-1 justify-center overflow-hidden lg:h-full lg:justify-start">
            <div
              className="box-border flex h-auto w-full max-w-full flex-col overflow-hidden rounded-2xl border border-zinc-200/70 bg-white p-3 shadow-md shadow-zinc-900/[0.06] ring-1 ring-black/[0.03] sm:p-4 lg:h-full lg:shrink-0"
              style={{ aspectRatio: mapAspectRatio }}
            >
              <MapView
                board={board}
                isResolutionRevealing={isResolutionRevealing}
                pendingMapEffectsRef={pendingMapEffectsRef}
                historyEntries={turnHistory}
                treatyVisuals={treatyMapVisuals}
              />
            </div>
          </div>

          <div
            className={`flex min-h-0 shrink-0 flex-col rounded-2xl border p-3 shadow-md ring-1 sm:p-4 lg:w-auto lg:min-w-[300px] ${
              isRetreatPhase
                ? 'border-amber-300/80 bg-amber-50/50 shadow-amber-900/[0.06] ring-amber-900/[0.08]'
                : isAdjustmentPhasePanel
                  ? 'border-emerald-300/80 bg-emerald-50/50 shadow-emerald-900/[0.06] ring-emerald-900/[0.08]'
                  : 'border-zinc-200/70 bg-white shadow-zinc-900/[0.06] ring-black/[0.03]'
            }`}
          >
            <h2
              className={`mb-2 text-lg font-semibold tracking-tight ${
                isRetreatPhase
                  ? 'text-amber-950'
                  : isAdjustmentPhasePanel
                    ? 'text-emerald-950'
                    : 'text-zinc-900'
              }`}
            >
              {isRetreatPhase
                ? '解体フェーズ'
                : isAdjustmentPhasePanel
                  ? '増産フェーズ'
                  : diplomacyPhase === 'negotiation'
                    ? '交渉フェーズ'
                    : '命令フェーズ'}
            </h2>
            <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1 [scrollbar-width:thin]">
              {POWER_ORDER.map((pid) => {
                const meta = POWER_META[pid] ?? { color: '#334155', label: pid };
                let status: string;
                if (isRetreatPhase) {
                  status = retreatStatusLine(pid);
                } else if (isAdjustmentPhasePanel) {
                  status = adjustmentStatusLine(pid);
                } else if (diplomacyPhase === 'orders') {
                  status = movementStatusLine(pid);
                } else {
                  status = '';
                }
                return (
                  <li
                    key={pid}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-200/70 bg-zinc-50/80 px-3 py-2"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: meta.color }}
                      />
                      <span className="min-w-0 truncate text-sm font-medium text-zinc-800">
                        <PowerLabelText powerId={pid} />
                      </span>
                      {status ? (
                        <span className="text-[11px] text-zinc-500">({status})</span>
                      ) : null}
                    </div>
                    <PowerNationLink
                      powerId={pid}
                      className="shrink-0 rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-zinc-800"
                      disabled={
                        onlineSession?.kind === 'power' &&
                        pid !== onlineSession.powerId
                      }
                      disabledTitle="参加中の国以外は操作できません"
                    >
                      {diplomacyPhase === 'negotiation' && !isRetreatPhase && !isAdjustmentPhasePanel
                        ? '作戦立案'
                        : '命令入力'}
                    </PowerNationLink>
                  </li>
                );
              })}
            </ul>

            {isRetreatPhase ? (
              <>
                <button
                  type="button"
                  disabled={!allPowersRetreatReady || isOnlinePowerPlayer}
                  onClick={confirmRetreatPhase}
                  className="mt-3 w-full shrink-0 rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-amber-900/20 transition-colors hover:bg-amber-500 disabled:cursor-not-allowed disabled:bg-amber-300"
                >
                  命令実行
                </button>
                {isOnlinePowerPlayer ? (
                  <p className="mt-2 text-[11px] text-amber-900/80">
                    命令の実行（裁定）はホストのみ操作できます。
                  </p>
                ) : null}
              </>
            ) : null}

            {isAdjustmentPhasePanel && !isRetreatPhase && (
              <>
                <button
                  type="button"
                  disabled={!allPowersAdjustmentReady || isOnlinePowerPlayer}
                  onClick={finalizeAdjustmentPhase}
                  className="mt-3 w-full shrink-0 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-emerald-900/20 transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-emerald-300"
                >
                  命令実行
                </button>
                {isOnlinePowerPlayer ? (
                  <p className="mt-2 text-[11px] text-zinc-600">
                    命令の実行（裁定）はホストのみ操作できます。
                  </p>
                ) : null}
              </>
            )}

            {!isRetreatPhase && !isAdjustmentPhasePanel && diplomacyPhase === 'negotiation' && (
              <>
                <button
                  type="button"
                  disabled={isOnlinePowerPlayer}
                  onClick={advanceToOrdersPhase}
                  className="mt-3 w-full shrink-0 rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-zinc-900/20 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
                >
                  交渉終了 → 命令フェーズへ
                </button>
                {isOnlinePowerPlayer ? (
                  <p className="mt-2 text-[11px] text-zinc-600">
                    命令フェーズへの移行はホストのみ操作できます。
                  </p>
                ) : null}
              </>
            )}

            {!isRetreatPhase && !isAdjustmentPhasePanel && diplomacyPhase === 'orders' && (
              <>
                <button
                  type="button"
                  disabled={
                    isOrderLocked ||
                    !allPowersMovementReady ||
                    isOnlinePowerPlayer
                  }
                  onClick={handleAdjudicate}
                  className="mt-3 w-full shrink-0 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-emerald-900/20 transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-emerald-300 disabled:shadow-none"
                >
                  命令実行
                </button>
                {isOnlinePowerPlayer ? (
                  <p className="mt-2 text-[11px] text-zinc-600">
                    命令の実行（裁定）はホストのみ操作できます。
                  </p>
                ) : null}
                {isOrderLocked && (
                  <p className="mt-2 text-xs text-zinc-500">
                    解決演出中は命令実行できません。
                  </p>
                )}
              </>
            )}
          </div>
        </div>

        <section className="shrink-0 rounded-2xl border border-zinc-200/70 bg-white p-3 shadow-md shadow-zinc-900/[0.06] ring-1 ring-black/[0.03] sm:p-4">
          {log.length === 0 ? (
            <p className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50/80 px-2 py-2 text-center text-[11px] text-zinc-500 sm:text-xs">
              まだログがありません。「命令実行」でここに結果が表示されます。
            </p>
          ) : (
            <ul
              ref={logListRef}
              className="max-h-[4.5rem] space-y-0 overflow-y-auto text-[11px] leading-snug [scrollbar-width:thin] sm:max-h-[5.25rem] sm:text-xs"
            >
              {log.map((entry) => (
                <li
                  key={entry.id}
                  className={
                    entry.line.startsWith('──')
                      ? 'mt-1 first:mt-0 rounded bg-zinc-100/80 px-1.5 py-0.5 font-semibold text-zinc-800'
                      : 'border-b border-zinc-100 py-0.5 last:border-0'
                  }
                >
                  {entry.line}
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
