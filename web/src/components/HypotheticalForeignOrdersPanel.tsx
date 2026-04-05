/**
 * 他国ユニット向けの想定命令入力パネル（/power ページ専用）
 *
 * 概要:
 *   実際の `unitOrders`（サーバ同期対象）には書き込まず、地図上の矢印プレビューのみに使う。
 *
 * 主な機能:
 *   - タブで複数パターンを切替（地図はアクティブタブのみ反映）
 *   - 自国以外の各ユニットについて、移動・支援・輸送の想定を入力
 *   - 状態は当ページの React state のみ（タブを閉じ／ページを離れると消える）
 *
 * 想定される制限事項:
 *   - 移動フェーズ以外では表示しない（呼び出し側で制御）。
 */

'use client';

import type { BoardState } from '@/domain';
import { OrderType, UnitType } from '@/domain';
import {
  coastChoicesForFleetMove,
  emptyOrder,
  fleetCoastJa,
  getReachableProvinces,
  getSupportableProvinces,
  isSplitProvince,
  POWER_META,
  provinceName,
  selectClass,
  selectDisabledClass,
  type UnitOrderInput,
  unitTypeLabel,
} from '@/diplomacy/gameHelpers';
import {
  canSupportTargetInSupportOrder,
  getConvoyOrderCandidateArmyIds,
  getConvoyOrderDestinationProvinces,
} from '@/mapMovement';
import { POWERS } from '@/miniMap';
import type { Dispatch, SetStateAction } from 'react';

/** 想定行動の1パターン（タブ1つに対応） */
export type HypotheticalScenarioState = {
  /** タブ識別子 */
  id: string;
  /** タブ表示名 */
  label: string;
  /** 他国ユニット ID → 想定命令 */
  orders: Record<string, UnitOrderInput>;
};

type HypotheticalForeignOrdersPanelProps = {
  /** 自国 ID（この国のユニットは一覧に出さない） */
  powerId: string;
  board: BoardState;
  orderAdjKeys: Set<string>;
  scenarios: HypotheticalScenarioState[];
  activeScenarioIndex: number;
  onSelectScenario: (index: number) => void;
  onAddScenario: () => void;
  /** アクティブタブの `orders` */
  hypotheticalOrders: Record<string, UnitOrderInput>;
  setHypotheticalOrders: Dispatch<
    SetStateAction<Record<string, UnitOrderInput>>
  >;
};

/**
 * 想定命令の更新（該当ユニットキーのみマージ）。
 */
function patchHypothetical(
  setHypotheticalOrders: HypotheticalForeignOrdersPanelProps['setHypotheticalOrders'],
  unitId: string,
  patch: Partial<UnitOrderInput>,
): void {
  setHypotheticalOrders((prev) => ({
    ...prev,
    [unitId]: { ...(prev[unitId] ?? emptyOrder()), ...patch },
  }));
}

/**
 * 想定命令の種別変更（フィールドを初期化）。
 */
function setHypotheticalType(
  setHypotheticalOrders: HypotheticalForeignOrdersPanelProps['setHypotheticalOrders'],
  unitId: string,
  newType: OrderType,
): void {
  setHypotheticalOrders((prev) => ({
    ...prev,
    [unitId]: { ...emptyOrder(), type: newType },
  }));
}

/**
 * 他国想定命令 UI。
 *
 * @param props - 属性
 */
export function HypotheticalForeignOrdersPanel(
  props: HypotheticalForeignOrdersPanelProps,
) {
  const {
    powerId,
    board,
    orderAdjKeys,
    scenarios,
    activeScenarioIndex,
    onSelectScenario,
    onAddScenario,
    hypotheticalOrders,
    setHypotheticalOrders,
  } = props;

  const foreignUnits = board.units.filter((u) => u.powerId !== powerId);
  if (foreignUnits.length === 0) {
    return null;
  }

  const tabBtnBase =
    'shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors';
  const tabBtnActive = 'bg-sky-600 text-white shadow-sm';
  const tabBtnIdle =
    'bg-white/80 text-sky-900 ring-1 ring-sky-200/80 hover:bg-sky-100/80';

  return (
    <section className="mt-4 space-y-3 rounded-xl border border-sky-200/80 bg-sky-50/40 p-3">
      <div>
        <h3 className="text-sm font-semibold text-sky-950">他国の想定行動</h3>
        <p className="mt-0.5 text-[11px] text-sky-800/80">
          ページを閉じると消えます。
        </p>
      </div>
      <div
        className="flex flex-wrap items-center gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:thin]"
        role="tablist"
        aria-label="想定パターン"
      >
        {scenarios.map((sc, idx) => {
          const selected = idx === activeScenarioIndex;
          return (
            <button
              key={sc.id}
              type="button"
              role="tab"
              aria-selected={selected}
              className={`${tabBtnBase} ${selected ? tabBtnActive : tabBtnIdle}`}
              onClick={() => onSelectScenario(idx)}
            >
              {sc.label}
            </button>
          );
        })}
        <button
          type="button"
          className={`${tabBtnBase} ${tabBtnIdle}`}
          onClick={onAddScenario}
        >
          ＋ 追加
        </button>
      </div>
      <div className="max-h-[40vh] space-y-4 overflow-y-auto overflow-x-hidden pr-1 [scrollbar-width:thin]">
        {POWERS.filter((pid) => pid !== powerId).map((pid) => {
          const units = foreignUnits.filter((u) => u.powerId === pid);
          if (units.length === 0) {
            return null;
          }
          const meta = POWER_META[pid] ?? { color: '#334155', label: pid };
          return (
            <div key={pid} className="space-y-2">
              <div className="flex items-center gap-2 border-b border-sky-200/60 pb-1">
                <span
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: meta.color }}
                />
                <span className="text-xs font-semibold text-sky-950">
                  {meta.label}
                </span>
              </div>
              {units.map((unit) => {
                const order =
                  hypotheticalOrders[unit.id] ?? emptyOrder();
                const prov = board.provinces.find(
                  (p) => p.id === unit.provinceId,
                );
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
                    className="rounded-lg border border-sky-200/70 bg-white/90 p-2 shadow-sm"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[9px] font-bold text-white"
                        style={{ backgroundColor: meta.color }}
                      >
                        {unit.type === UnitType.Army ? '陸' : '海'}
                      </span>
                      <span className="min-w-[4rem] text-xs font-medium text-zinc-900">
                        {prov?.name ?? unit.provinceId}
                        {unit.type === UnitType.Fleet &&
                          unit.fleetCoast &&
                          isSplitProvince(unit.provinceId) && (
                            <span className="ml-1 text-[10px] font-normal text-zinc-500">
                              ({fleetCoastJa(unit.fleetCoast)})
                            </span>
                          )}
                      </span>
                      <select
                        className="rounded-md border border-zinc-200 bg-white px-1.5 py-0.5 text-[11px] shadow-sm focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/25"
                        value={order.type}
                        onChange={(e) =>
                          setHypotheticalType(
                            setHypotheticalOrders,
                            unit.id,
                            e.target.value as OrderType,
                          )
                        }
                      >
                        <option value={OrderType.Hold}>待機</option>
                        <option value={OrderType.Move}>移動</option>
                        <option value={OrderType.Support}>支援</option>
                        <option value={OrderType.Convoy}>輸送</option>
                      </select>
                      {(() => {
                        const isMove = order.type === OrderType.Move;
                        const reachable = isMove
                          ? getReachableProvinces(
                              board,
                              unit,
                              orderAdjKeys,
                            )
                          : [];
                        const coastChoices =
                          isMove && unit.type === UnitType.Fleet
                            ? coastChoicesForFleetMove(
                                unit,
                                order.targetProvinceId,
                              )
                            : null;
                        return (
                          <>
                            <select
                              className={
                                isMove ? selectClass : selectDisabledClass
                              }
                              value={order.targetProvinceId}
                              disabled={!isMove}
                              onChange={(e) =>
                                patchHypothetical(
                                  setHypotheticalOrders,
                                  unit.id,
                                  {
                                    targetProvinceId: e.target.value,
                                    moveTargetFleetCoast: '',
                                  },
                                )
                              }
                            >
                              <option value="">
                                {isMove ? '行き先を選択' : '—'}
                              </option>
                              {reachable.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name}
                                </option>
                              ))}
                            </select>
                            {isMove && coastChoices && (
                              <select
                                className={selectClass}
                                value={order.moveTargetFleetCoast}
                                onChange={(e) =>
                                  patchHypothetical(
                                    setHypotheticalOrders,
                                    unit.id,
                                    {
                                      moveTargetFleetCoast: e.target.value,
                                    },
                                  )
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
                      <div className="mt-2 flex flex-col gap-1.5 sm:ml-7">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="w-14 shrink-0 text-[10px] text-zinc-500">
                            対象:
                          </span>
                          <select
                            className={selectClass}
                            value={order.supportedUnitId}
                            onChange={(e) =>
                              patchHypothetical(setHypotheticalOrders, unit.id, {
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
                                    {unitTypeLabel(u.type)}{' '}
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
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="w-14 shrink-0 text-[10px] text-zinc-500">
                                  行動先:
                                </span>
                                <select
                                  className={selectClass}
                                  value={order.supportToProvinceId}
                                  onChange={(e) =>
                                    patchHypothetical(
                                      setHypotheticalOrders,
                                      unit.id,
                                      {
                                        supportToProvinceId: e.target.value,
                                      },
                                    )
                                  }
                                >
                                  <option value="">選択してください</option>
                                  <option value={supportedUnit.provinceId}>
                                    {provinceName(
                                      board,
                                      supportedUnit.provinceId,
                                    )}
                                    （待機支援）
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
                      <div className="mt-2 flex flex-col gap-1.5 sm:ml-7">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="w-14 shrink-0 text-[10px] text-zinc-500">
                            陸軍:
                          </span>
                          <select
                            className={selectClass}
                            value={order.convoyArmyId}
                            onChange={(e) =>
                              patchHypothetical(setHypotheticalOrders, unit.id, {
                                convoyArmyId: e.target.value,
                              })
                            }
                          >
                            <option value="">陸軍を選択</option>
                            {board.units
                              .filter(
                                (u) =>
                                  u.type === UnitType.Army &&
                                  (convoyArmyCandidateIdSet?.has(u.id) ??
                                    false),
                              )
                              .map((u) => {
                                const up = board.provinces.find(
                                  (p) => p.id === u.provinceId,
                                );
                                return (
                                  <option key={u.id} value={u.id}>
                                    陸 {up?.name ?? u.provinceId}
                                  </option>
                                );
                              })}
                          </select>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="w-14 shrink-0 text-[10px] text-zinc-500">
                            輸送先:
                          </span>
                          <select
                            className={selectClass}
                            value={order.convoyToProvinceId}
                            onChange={(e) =>
                              patchHypothetical(setHypotheticalOrders, unit.id, {
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
          );
        })}
      </div>
    </section>
  );
}
