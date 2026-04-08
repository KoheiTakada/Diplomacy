/**
 * 単一勢力向けの秘密命令・調整・退却入力エリア
 *
 * 概要:
 *   メインページでは他国の入力が見えないよう、各国専用 URL でのみ表示する。
 *
 * 主な機能:
 *   - 通常フェーズ: 自勢力ユニットの命令入力
 *   - 秋の調整: 自勢力の削減・増産のみ
 *   - 退却: 自勢力の押し出しユニットのみ
 *   - 各フェーズで「命令送信」後に入力完了フラグを Context に記録しメインへ戻る
 *
 * 想定される制限事項:
 *   - 全データは localStorage にあるため、開発者ツールでは他国も閲覧可能。
 */

'use client';

import type { ReactNode } from 'react';
import { useDiplomacyGame } from '@/context/DiplomacyGameContext';
import { AreaType, OrderType, UnitType } from '@/domain';
import {
  buildCapacity,
  canBuildFleetAtProvince,
  coastChoicesForFleetMove,
  disbandNeed,
  fleetArrivalCoasts,
  fleetCoastJa,
  getReachableProvinces,
  getRetreatableProvinces,
  getSupportableProvinces,
  isPowerAdjustmentSlotsFilled,
  isPowerOrdersComplete,
  isSplitProvince,
  powerLabel,
  POWER_META,
  provinceName,
  selectClass,
  selectDisabledClass,
  supplyCenterKeyForProvince,
  unitTypeLabel,
  emptyOrder,
} from '@/diplomacy/gameHelpers';
import {
  canSupportTargetInSupportOrder,
  findAllConvoyPathProvinceIdsForArmyDestination,
  getConvoyOrderCandidateArmyIds,
  getConvoyOrderDestinationProvinces,
  isProvinceOccupied,
} from '@/mapMovement';
import { isTreatyParticipant } from '@/diplomacy/treaties';
import { PowerLabelText } from '@/components/PowerLabelText';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

type PowerSecretWorkbenchProps = {
  /** 表示対象の勢力ID */
  powerId: string;
  /**
   * false のとき「メインページへ」を出さない。
   * オンライン参加時はページ上部の導線と重複するため省略する。
   */
  showMainPageLink?: boolean;
  /**
   * ユニットリストのスクロール領域末尾に追記するコンテンツ。
   * 命令入力パネルと想定行動パネルを単一スクロールにまとめるために使用する。
   */
  scrollAppendContent?: ReactNode;
};

/**
 * 単一勢力の入力 UI。
 *
 * @param props - 属性
 */
export function PowerSecretWorkbench(props: PowerSecretWorkbenchProps) {
  const { powerId, showMainPageLink = true, scrollAppendContent } = props;
  const router = useRouter();
  const g = useDiplomacyGame();
  const {
    board,
    unitOrders,
    updateOrder,
    changeOrderType,
    orderAdjKeys,
    isOrderLocked,
    isAdjustmentPhasePanel,
    isRetreatPhase,
    pendingRetreats,
    retreatTargets,
    setRetreatTargets,
    buildPlan,
    setBuildPlan,
    disbandPlan,
    setDisbandPlan,
    markPowerOrderSaved,
    markPowerAdjustmentSaved,
    markPowerRetreatSaved,
    powerOrderSaved,
    powerAdjustmentSaved,
    powerRetreatSaved,
    diplomacyPhase,
    treaties,
    respondTreaty,
  } = g;

  const meta = POWER_META[powerId] ?? { color: '#334155', label: powerId };
  const units = board.units.filter((u) => u.powerId === powerId);
  const myRetreats = pendingRetreats.filter((d) => d.unit.powerId === powerId);
  const needAdj = disbandNeed(board, powerId);
  const capAdj = buildCapacity(board, powerId);
  const needsAdjustmentUi =
    isAdjustmentPhasePanel && (needAdj > 0 || capAdj > 0);

  const ordersComplete = isPowerOrdersComplete(board, unitOrders, powerId);
  const adjSlotsOk = isPowerAdjustmentSlotsFilled(
    board,
    powerId,
    disbandPlan,
    buildPlan,
  );

  const disSlots = disbandPlan[powerId] ?? [];
  const buildSlots = buildPlan[powerId] ?? [];
  const ownedBuildable = board.provinces.filter((p) => {
    const anchorKey = supplyCenterKeyForProvince(p);
    if (anchorKey == null) {
      return false;
    }
    if (board.supplyCenterOwnership[anchorKey] !== powerId) {
      return false;
    }
    if (p.homePowerId != null && p.homePowerId !== powerId) {
      return false;
    }
    if (isProvinceOccupied(board, p.id)) {
      return false;
    }
    if (!p.isSupplyCenter) {
      return false;
    }
    return true;
  });

  const convoyRouteLabelForArmyMoveTarget = (
    army: typeof units[number],
    targetProvinceId: string,
  ): string | null => {
    if (army.type !== UnitType.Army) {
      return null;
    }
    const paths = findAllConvoyPathProvinceIdsForArmyDestination(
      board,
      army,
      targetProvinceId,
      orderAdjKeys,
      8,
    );
    if (paths.length === 0) {
      return null;
    }
    const routeLabels = paths.map((path) => {
      const seaIds = path.slice(1, -1);
      const fleetLabels = seaIds.map((seaId) => {
        const fleet = board.units.find(
          (u) => u.type === UnitType.Fleet && u.provinceId === seaId,
        );
        if (!fleet) {
          return provinceName(board, seaId);
        }
        return `${powerLabel(fleet.powerId)}${provinceName(board, seaId)}`;
      });
      return fleetLabels.join('、');
    });
    return routeLabels.join(' or ');
  };

  return (
    <div className="flex min-h-0 min-w-0 w-full flex-1 flex-col rounded-2xl border border-zinc-200/70 bg-white p-3 shadow-md ring-1 ring-black/[0.03] sm:p-4">
      <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-3 w-3 rounded-full"
            style={{ backgroundColor: meta.color }}
          />
          <h2 className="text-lg font-semibold text-zinc-900">
            <PowerLabelText powerId={powerId} />
          </h2>
        </div>
        {showMainPageLink ? (
          <Link
            href="/"
            className="text-xs font-medium text-zinc-500 underline-offset-2 hover:text-zinc-800 hover:underline"
          >
            ← メインページへ
          </Link>
        ) : null}
      </div>

      {isRetreatPhase && myRetreats.length === 0 && (
        <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs text-amber-900">
          この勢力に退却が必要なユニットはありません。メインページで進行を確認してください。
        </p>
      )}

      {isRetreatPhase && myRetreats.length > 0 && (
        <section className="mb-4 space-y-3 rounded-xl border border-amber-300/90 bg-amber-50/90 p-3">
          <h3 className="text-sm font-semibold text-amber-900">退却</h3>
          <p className="text-xs text-amber-800">
            空欄のままだと除去扱いです。メインページの命令実行までお待ちください。
          </p>
          <div className="space-y-2">
            {myRetreats.map((d) => {
              const options = getRetreatableProvinces(board, d, retreatTargets);
              return (
                <div
                  key={d.unit.id}
                  className="rounded border border-amber-300 bg-white/90 p-2 text-xs"
                >
                  <div className="mb-1 text-zinc-700">
                    {d.unit.type === UnitType.Army ? '陸軍' : '海軍'}（
                    {provinceName(board, d.fromProvinceId)}）の退却先
                  </div>
                  <select
                    className={selectClass}
                    value={retreatTargets[d.unit.id] ?? ''}
                    onChange={(e) =>
                      setRetreatTargets((prev) => ({
                        ...prev,
                        [d.unit.id]: e.target.value,
                      }))
                    }
                  >
                    <option value="">除去する（退却しない）</option>
                    {options.flatMap((p) => {
                      if (d.unit.type !== UnitType.Fleet) {
                        return [
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>,
                        ];
                      }
                      const coasts = fleetArrivalCoasts(p.id, d.fromProvinceId);
                      if (coasts.length <= 1) {
                        return [
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>,
                        ];
                      }
                      return coasts.map((c) => (
                        <option key={`${p.id}|${c}`} value={`${p.id}|${c}`}>
                          {p.name}（{fleetCoastJa(c)}）
                        </option>
                      ));
                    })}
                  </select>
                </div>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => {
              markPowerRetreatSaved(powerId);
              router.push('/');
            }}
            className="w-full rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-500"
          >
            命令送信
          </button>
          <p className="text-[11px] text-amber-900/90">
            記録済み: {powerRetreatSaved[powerId] ? 'はい' : 'いいえ'}
          </p>
        </section>
      )}

      {needsAdjustmentUi && (
        <section className="mb-4 space-y-3 rounded-xl border border-emerald-300/80 bg-emerald-50/50 p-3">
          <h3 className="text-sm font-semibold text-emerald-950">秋の調整</h3>
          {needAdj > 0 && (
            <div className="rounded-xl border border-rose-300/80 bg-rose-50/80 p-2.5">
              <div className="mb-2 text-xs font-semibold text-rose-900">
                削減するユニット（{needAdj}）
              </div>
              <div className="space-y-2">
                {Array.from({ length: needAdj }).map((_, idx) => {
                  const slot = disSlots[idx] ?? { unitId: '' };
                  const used = new Set(
                    disSlots
                      .map((s, i) => (i === idx ? null : s?.unitId ?? null))
                      .filter((x): x is string => !!x),
                  );
                  const opts = units.filter(
                    (u) => !used.has(u.id) || u.id === slot.unitId,
                  );
                  return (
                    <select
                      key={idx}
                      className={selectClass}
                      value={slot.unitId}
                      onChange={(e) =>
                        setDisbandPlan((prev) => {
                          const prevSlots = prev[powerId] ? [...prev[powerId]] : [];
                          prevSlots[idx] = { unitId: e.target.value };
                          return { ...prev, [powerId]: prevSlots };
                        })
                      }
                    >
                      <option value="">削減ユニットを選択</option>
                      {opts.map((u) => (
                        <option key={u.id} value={u.id}>
                          {powerLabel(u.powerId)}{' '}
                          {u.type === UnitType.Army ? '陸' : '海'}{' '}
                          {provinceName(board, u.provinceId)}
                        </option>
                      ))}
                    </select>
                  );
                })}
              </div>
            </div>
          )}
          {capAdj > 0 && (
            <div className="rounded-xl border border-emerald-300/80 bg-white/90 p-2.5">
              <div className="mb-2 text-xs font-semibold text-emerald-900">
                増産（{capAdj}）
              </div>
              <div className="space-y-2">
                {Array.from({ length: capAdj }).map((_, idx) => {
                  const slot =
                    buildSlots[idx] ?? {
                      provinceId: '',
                      unitType: UnitType.Army,
                      buildFleetCoast: '',
                    };
                  const used = new Set(
                    buildSlots
                      .map((s, i) => (i === idx ? null : s?.provinceId ?? null))
                      .filter((x): x is string => !!x),
                  );
                  const options = ownedBuildable
                    .filter((p) => !used.has(p.id) || p.id === slot.provinceId)
                    .filter((p) =>
                      slot.unitType === UnitType.Army
                        ? true
                        : canBuildFleetAtProvince(board, p.id),
                    );
                  const canBuildFleetOnSelected =
                    !!slot.provinceId &&
                    canBuildFleetAtProvince(board, slot.provinceId);
                  return (
                    <div
                      key={idx}
                      className="flex flex-col gap-1.5 rounded-lg border border-emerald-200/60 bg-emerald-50/50 p-2"
                    >
                      <select
                        className={selectClass}
                        value={slot.provinceId}
                        onChange={(e) =>
                          setBuildPlan((prev) => {
                            const nextProvinceId = e.target.value;
                            const keepFleet =
                              slot.unitType === UnitType.Fleet &&
                              canBuildFleetAtProvince(board, nextProvinceId);
                            const prevSlots = prev[powerId] ? [...prev[powerId]] : [];
                            prevSlots[idx] = {
                              provinceId: nextProvinceId,
                              unitType: keepFleet ? UnitType.Fleet : UnitType.Army,
                              buildFleetCoast: '',
                            };
                            return { ...prev, [powerId]: prevSlots };
                          })
                        }
                      >
                        <option value="">拠点を選択</option>
                        {options.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                      <select
                        className={selectClass}
                        value={slot.unitType}
                        onChange={(e) =>
                          setBuildPlan((prev) => {
                            const prevSlots = prev[powerId] ? [...prev[powerId]] : [];
                            prevSlots[idx] = {
                              provinceId: slot.provinceId,
                              unitType: e.target.value as UnitType,
                              buildFleetCoast: '',
                            };
                            return { ...prev, [powerId]: prevSlots };
                          })
                        }
                      >
                        <option value={UnitType.Army}>陸軍</option>
                        {canBuildFleetOnSelected && (
                          <option value={UnitType.Fleet}>海軍</option>
                        )}
                      </select>
                      {slot.unitType === UnitType.Fleet &&
                        slot.provinceId &&
                        isSplitProvince(slot.provinceId) && (
                          <select
                            className={selectClass}
                            value={slot.buildFleetCoast ?? ''}
                            onChange={(e) =>
                              setBuildPlan((prev) => {
                                const prevSlots = prev[powerId]
                                  ? [...prev[powerId]]
                                  : [];
                                prevSlots[idx] = {
                                  ...slot,
                                  buildFleetCoast: e.target.value,
                                };
                                return { ...prev, [powerId]: prevSlots };
                              })
                            }
                          >
                            <option value="">岸を選択</option>
                            {(slot.provinceId === 'STP' ||
                              slot.provinceId === 'SPA') && (
                              <>
                                <option value="NC">{fleetCoastJa('NC')}</option>
                                <option value="SC">{fleetCoastJa('SC')}</option>
                              </>
                            )}
                            {slot.provinceId === 'BUL' && (
                              <>
                                <option value="EC">{fleetCoastJa('EC')}</option>
                                <option value="SC">{fleetCoastJa('SC')}</option>
                              </>
                            )}
                          </select>
                        )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={() => {
              markPowerAdjustmentSaved(powerId);
              router.push('/');
            }}
            className="w-full rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
          >
            命令送信
          </button>
          <p className="text-[11px] text-emerald-900">
            内容が妥当: {adjSlotsOk ? 'はい' : 'いいえ'}／記録済み:{' '}
            {powerAdjustmentSaved[powerId] ? 'はい' : 'いいえ'}
          </p>
        </section>
      )}

      {!isRetreatPhase &&
        !needsAdjustmentUi &&
        !isOrderLocked &&
        units.length === 0 && (
          <p className="text-sm text-zinc-600">現在、この勢力にユニットはありません。</p>
        )}

      {isAdjustmentPhasePanel && !needsAdjustmentUi && (
        <p className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50/80 px-3 py-2 text-xs text-emerald-900">
          この勢力に削減・増産はありません。メインページの命令実行をお待ちください。
        </p>
      )}

      {!isRetreatPhase &&
        !needsAdjustmentUi &&
        !isOrderLocked &&
        units.length > 0 && (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-1 [scrollbar-width:thin]">
            <div className="space-y-2">
            {units.map((unit) => {
              const order = unitOrders[unit.id] ?? emptyOrder();
              const prov = board.provinces.find((p) => p.id === unit.provinceId);
              const isSupport = order.type === OrderType.Support;
              const isConvoy = order.type === OrderType.Convoy;
              const supportedUnit = board.units.find(
                (u) => u.id === order.supportedUnitId,
              );
              const convoyArmyCandidateIdSet = isConvoy
                ? new Set(
                    getConvoyOrderCandidateArmyIds(
                      board,
                      unit,
                      orderAdjKeys,
                    ),
                  )
                : null;
              const convoyArmyForDest = board.units.find(
                (u) => u.id === order.convoyArmyId,
              );
              const convoyDestProvinces =
                isConvoy && convoyArmyForDest
                  ? getConvoyOrderDestinationProvinces(
                      board,
                      unit,
                      convoyArmyForDest,
                      orderAdjKeys,
                    )
                  : [];

              return (
                <div
                  key={unit.id}
                  className="rounded-xl border border-zinc-200/70 bg-zinc-50/90 p-2.5 shadow-sm"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-[10px] font-bold text-white"
                      style={{ backgroundColor: meta.color }}
                    >
                      {unit.type === UnitType.Army ? '陸' : '海'}
                    </span>
                    <span className="min-w-[5rem] text-sm font-medium text-zinc-900">
                      {prov?.name ?? unit.provinceId}
                      {unit.type === UnitType.Fleet &&
                        unit.fleetCoast &&
                        isSplitProvince(unit.provinceId) && (
                          <span className="ml-1 text-xs font-normal text-zinc-500">
                            ({fleetCoastJa(unit.fleetCoast)})
                          </span>
                        )}
                    </span>
                    <select
                      className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs shadow-sm focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400/20"
                      value={order.type}
                      onChange={(e) =>
                        changeOrderType(unit.id, e.target.value as OrderType)
                      }
                    >
                      <option value={OrderType.Hold}>維持</option>
                      <option value={OrderType.Move}>移動</option>
                      <option value={OrderType.Support}>支援</option>
                      <option value={OrderType.Convoy}>輸送</option>
                    </select>
                    {(() => {
                      const isMove = order.type === OrderType.Move;
                      const reachable = isMove
                        ? getReachableProvinces(board, unit, orderAdjKeys)
                        : [];
                      const coastChoices =
                        isMove && unit.type === UnitType.Fleet
                          ? coastChoicesForFleetMove(unit, order.targetProvinceId)
                          : null;
                      return (
                        <>
                          <select
                            className={isMove ? selectClass : selectDisabledClass}
                            value={order.targetProvinceId}
                            disabled={!isMove}
                            onChange={(e) =>
                              updateOrder(unit.id, {
                                targetProvinceId: e.target.value,
                                moveTargetFleetCoast: '',
                              })
                            }
                          >
                            <option value="">
                              {isMove ? '行き先を選択' : '—'}
                            </option>
                            {reachable.map((p) => (
                              <option key={p.id} value={p.id}>
                                {(() => {
                                  const convoyLabel = convoyRouteLabelForArmyMoveTarget(
                                    unit,
                                    p.id,
                                  );
                                  if (!convoyLabel) {
                                    return p.name;
                                  }
                                  return `${p.name}（輸送：${convoyLabel}）`;
                                })()}
                              </option>
                            ))}
                          </select>
                          {isMove && coastChoices && (
                            <select
                              className={selectClass}
                              value={order.moveTargetFleetCoast}
                              onChange={(e) =>
                                updateOrder(unit.id, {
                                  moveTargetFleetCoast: e.target.value,
                                })
                              }
                            >
                              <option value="">到着岸</option>
                              {coastChoices.map((c) => (
                                <option key={c} value={c}>
                                  {fleetCoastJa(c)}
                                </option>
                              ))}
                            </select>
                          )}
                        </>
                      );
                    })()}
                  </div>

                  {isSupport && (
                    <div className="mt-2 ml-0 flex flex-col gap-1.5 sm:ml-8">
                      <div className="flex items-center gap-2">
                        <span className="w-16 shrink-0 text-xs text-zinc-500">
                          対象:
                        </span>
                        <select
                          className={selectClass}
                          value={order.supportedUnitId}
                          onChange={(e) =>
                            updateOrder(unit.id, {
                              supportedUnitId: e.target.value,
                              supportToProvinceId: '',
                            })
                          }
                        >
                          <option value="">ユニットを選択</option>
                          {board.units
                            .filter(
                              (u) =>
                                u.id !== unit.id &&
                                canSupportTargetInSupportOrder(
                                  board,
                                  unit,
                                  u,
                                  orderAdjKeys,
                                ),
                            )
                            .map((u) => {
                              const up = board.provinces.find(
                                (p) => p.id === u.provinceId,
                              );
                              return (
                                <option key={u.id} value={u.id}>
                                  {powerLabel(u.powerId)} {unitTypeLabel(u.type)}{' '}
                                  {up?.name ?? u.provinceId}
                                </option>
                              );
                            })}
                        </select>
                      </div>
                      {order.supportedUnitId &&
                        supportedUnit &&
                        (() => {
                          const supportable = getSupportableProvinces(
                            board,
                            unit,
                            supportedUnit,
                            orderAdjKeys,
                          );
                          return (
                            <div className="flex items-center gap-2">
                              <span className="w-16 shrink-0 text-xs text-zinc-500">
                                行動先:
                              </span>
                              <select
                                className={selectClass}
                                value={order.supportToProvinceId}
                                onChange={(e) =>
                                  updateOrder(unit.id, {
                                    supportToProvinceId: e.target.value,
                                  })
                                }
                              >
                                <option value="">選択してください</option>
                                <option value={supportedUnit.provinceId}>
                                  {provinceName(board, supportedUnit.provinceId)}
                                  （維持支援）
                                </option>
                                {supportable.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                          );
                        })()}
                    </div>
                  )}

                  {isConvoy && (
                    <div className="mt-2 ml-0 flex flex-col gap-1.5 sm:ml-8">
                      <div className="flex items-center gap-2">
                        <span className="w-16 shrink-0 text-xs text-zinc-500">
                          陸軍:
                        </span>
                        <select
                          className={selectClass}
                          value={order.convoyArmyId}
                          onChange={(e) =>
                            updateOrder(unit.id, { convoyArmyId: e.target.value })
                          }
                        >
                          <option value="">陸軍を選択</option>
                          {board.units
                            .filter(
                              (u) =>
                                u.type === UnitType.Army &&
                                (convoyArmyCandidateIdSet?.has(u.id) ?? false),
                            )
                            .map((u) => {
                              const up = board.provinces.find(
                                (p) => p.id === u.provinceId,
                              );
                              return (
                                <option key={u.id} value={u.id}>
                                  {powerLabel(u.powerId)} 陸{' '}
                                  {up?.name ?? u.provinceId}
                                </option>
                              );
                            })}
                        </select>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-16 shrink-0 text-xs text-zinc-500">
                          輸送先:
                        </span>
                        <select
                          className={selectClass}
                          value={order.convoyToProvinceId}
                          onChange={(e) =>
                            updateOrder(unit.id, {
                              convoyToProvinceId: e.target.value,
                            })
                          }
                        >
                          <option value="">行き先を選択</option>
                          {convoyDestProvinces.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            </div>
            {scrollAppendContent}
          </div>
          {diplomacyPhase === 'orders' ? (
            <>
              <button
                type="button"
                onClick={() => {
                  const unanswered = treaties.filter(
                    (t) =>
                      t.discardedAtIso == null &&
                      isTreatyParticipant(t, powerId) &&
                      t.statusByPower[powerId] === 'pending',
                  );
                  if (unanswered.length > 0) {
                    const ok = window.confirm(
                      `${unanswered.length}件の未回答の条約があります。すべて却下して命令を送信しますか？`,
                    );
                    if (!ok) {
                      return;
                    }
                    for (const t of unanswered) {
                      respondTreaty(t.id, powerId, 'rejected');
                    }
                  }
                  markPowerOrderSaved(powerId);
                  router.push('/');
                }}
                className="mt-3 w-full shrink-0 rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white shadow-md hover:bg-zinc-800"
              >
                命令送信
              </button>
              <p className="mt-2 text-[11px] text-zinc-600">
                内容が妥当: {ordersComplete ? 'はい' : 'いいえ'}／記録済み:{' '}
                {powerOrderSaved[powerId] ? 'はい' : 'いいえ'}
              </p>
            </>
          ) : (
            <p className="mt-3 text-[11px] text-zinc-500">
              命令フェーズで命令を送信できます。
            </p>
          )}
        </>
      )}

      {isOrderLocked && (
        <p className="rounded-xl border border-zinc-200/80 bg-zinc-50 px-3 py-2.5 text-xs text-zinc-600">
          ターン解決の演出中は入力できません。しばらくお待ちください。
        </p>
      )}
    </div>
  );
}
