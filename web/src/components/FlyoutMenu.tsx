'use client';

import { UnitType, type Unit, type FleetCoast } from '@/domain';
import { POWER_META } from '@/diplomacy/gameHelpers';
import { useState, useRef, useEffect } from 'react';

export interface FlyoutMenuProps {
  // 表示制御
  open: boolean;
  anchorX: number;
  anchorY: number;
  onClose: () => void;

  // 現在のフェーズ
  phase: 'movement' | 'retreat' | 'adjustment';

  // 対象ユニット
  unitId: string;
  unit: Unit | null;

  // UI ステップ（PowerPageClient によって制御される）
  step?: 'menu' | 'moveSelect' | 'convoyedSelect' | 'coastSelect';

  // 命令確定コールバック
  onHold: (unitId: string) => void;
  onMoveStart: (unitId: string) => void;
  onConvoyedMoveStart?: (unitId: string) => void;
  onSupportStart?: (unitId: string) => void;
  onConvoyStart?: (unitId: string) => void;
  onRetreatChoice: (unitId: string, destProvId: string) => void;
  onDisband: (unitId: string) => void;
  onBuild: (provinceId: string, unitType: UnitType) => void;
  onBuildTypeChange?: (unitId: string, newType: UnitType) => void;
  onCoastSelect?: (coast: FleetCoast) => void;

  // 選択肢データ
  retreatOptions?: string[];
  supportableUnits?: Unit[];
  convoyableArmies?: Unit[];
  isDisbandPending?: boolean; // 削減フェーズで削除予定かどうか
  canConvoyedMove?: boolean; // 被輸送が可能かどうか
  availableCoasts?: FleetCoast[]; // 利用可能な岸（coastSelect ステップで使用）
}

/**
 * マップ上のユニットをクリック時に出現するフライアウトメニュー。
 * 全フェーズ対応：移動/被輸送/支援/輸送、待機、退却、削減、増産
 */
export function FlyoutMenu({
  open,
  anchorX,
  anchorY,
  onClose,
  phase,
  unitId,
  unit,
  step: controlledStep,
  onHold,
  onMoveStart,
  onConvoyedMoveStart,
  onSupportStart,
  onConvoyStart,
  onRetreatChoice,
  onDisband,
  onBuild,
  onBuildTypeChange,
  onCoastSelect,
  retreatOptions = [],
  supportableUnits = [],
  convoyableArmies = [],
  isDisbandPending = false,
  canConvoyedMove = false,
  availableCoasts = [],
}: FlyoutMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuHeight, setMenuHeight] = useState(0);
  // controlledStep が提供されている場合はそれを使う、そうでなければ内部状態を使う
  const [internalStep, setInternalStep] = useState<'menu' | 'moveSelect' | 'convoyedSelect' | 'coastSelect'>('menu');
  const step = controlledStep ?? internalStep;
  const setStep = controlledStep ? () => {} : setInternalStep;

  // メニューのサイズを測定
  useEffect(() => {
    if (menuRef.current) {
      setMenuHeight(menuRef.current.getBoundingClientRect().height);
    }
  }, [step]);

  if (!open) {
    return null;
  }

  // adjustment フェーズ以外では unit が not null である必要がある
  if (!unit && phase !== 'adjustment') {
    return null;
  }

  // ビューポート内の位置を計算
  const FLYOUT_WIDTH = 180;
  const OFFSET = 8; // クリック位置からのオフセット
  const flyoutHeight = menuHeight > 0 ? menuHeight : 250; // 実測値、またはデフォルト

  let left: number;
  let top: number;

  // 右に表示できるか確認、無理なら左に表示
  if (anchorX + FLYOUT_WIDTH + OFFSET > window.innerWidth) {
    left = Math.max(0, anchorX - FLYOUT_WIDTH - OFFSET);
  } else {
    left = anchorX + OFFSET;
  }

  // 下に表示できるか確認、無理なら上に表示
  if (anchorY + flyoutHeight + OFFSET > window.innerHeight) {
    top = Math.max(0, anchorY - flyoutHeight - OFFSET);
  } else {
    top = anchorY + OFFSET;
  }

  const handleBackgroundClick = (e: React.MouseEvent) => {
    if (e.target === menuRef.current?.parentElement) {
      onClose();
    }
  };

  const buttonClass = 'w-full px-3 py-2 text-sm text-left rounded-lg hover:bg-zinc-50 active:bg-zinc-100 transition-colors';

  // ============ 移動フェーズ ============
  if (phase === 'movement') {
    if (!unit) return null; // TS narrowing: unit は not null
    return (
      <div
        className="fixed inset-0 z-40 pointer-events-none"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
      >
        <div
          ref={menuRef}
          className="fixed z-50 bg-white rounded-xl shadow-xl border border-zinc-200 p-2 min-w-[140px] pointer-events-auto"
          style={{ left: `${left}px`, top: `${top}px` }}
        >
          {/* メニュー表示 */}
          {step === 'menu' && (
            <div className="flex flex-col gap-1">
              <button
                type="button"
                className={buttonClass}
                onClick={() => {
                  onHold(unitId);
                  onClose();
                  setStep('menu');
                }}
              >
                待機
              </button>

              <button
                type="button"
                className={buttonClass}
                onClick={() => {
                  if (!controlledStep) setStep('moveSelect');
                  onMoveStart(unitId);
                }}
              >
                移動
              </button>

              {unit.type === UnitType.Army && canConvoyedMove && (
                <button
                  type="button"
                  className={buttonClass}
                  onClick={() => {
                    if (!controlledStep) setStep('convoyedSelect');
                    onConvoyedMoveStart?.(unitId);
                  }}
                >
                  被輸送
                </button>
              )}

              {supportableUnits.length > 0 && (
                <button
                  type="button"
                  className={buttonClass}
                  onClick={() => {
                    onSupportStart?.(unitId);
                  }}
                >
                  支援
                </button>
              )}

              {unit.type === UnitType.Fleet && convoyableArmies.length > 0 && (
                <button
                  type="button"
                  className={buttonClass}
                  onClick={() => {
                    onConvoyStart?.(unitId);
                  }}
                >
                  輸送
                </button>
              )}

              <button
                type="button"
                className="w-full px-3 py-2 text-xs text-zinc-500 rounded-lg hover:bg-zinc-100 transition-colors"
                onClick={onClose}
              >
                キャンセル
              </button>
            </div>
          )}

          {/* 岸選択表示 */}
          {step === 'coastSelect' && (
            <div className="flex flex-col gap-1">
              <div className="text-xs font-semibold text-zinc-600 px-3 py-2">岸を選択</div>
              {availableCoasts.map((coast) => {
                const coastLabel = coast === 'NC' ? '北岸' : coast === 'SC' ? '南岸' : '東岸';
                return (
                  <button
                    key={coast}
                    type="button"
                    className={buttonClass}
                    onClick={() => {
                      onCoastSelect?.(coast);
                      onClose();
                    }}
                  >
                    {coastLabel}
                  </button>
                );
              })}
            </div>
          )}

        </div>
      </div>
    );
  }

  // ============ 退却フェーズ ============
  if (phase === 'retreat') {
    if (!unit) return null; // TS narrowing: unit は not null
    return (
      <div
        className="fixed inset-0 z-40 pointer-events-none"
      >
        <div
          ref={menuRef}
          className="fixed z-50 bg-white rounded-xl shadow-xl border border-zinc-200 p-2 min-w-[140px] pointer-events-auto"
          style={{ left: `${left}px`, top: `${top}px` }}
        >
          <div className="flex flex-col gap-1">
            {retreatOptions.map((provId) => (
              <button
                key={provId}
                type="button"
                className={buttonClass}
                onClick={() => {
                  onRetreatChoice(unitId, provId);
                  onClose();
                }}
              >
                {provId}
              </button>
            ))}
            <button
              type="button"
              className={buttonClass}
              onClick={() => {
                onDisband(unitId);
                onClose();
              }}
            >
              解体
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ============ 増産/削減フェーズ ============
  if (phase === 'adjustment') {
    // unit が null = 空のプロビンス（新規増産対象）
    if (!unit) {
      // 空のプロビンス = 増産対象（provinceId は unitId として渡される）
      return (
        <div
          className="fixed inset-0 z-40 pointer-events-none"
        >
          <div
            ref={menuRef}
            className="fixed z-50 bg-white rounded-xl shadow-xl border border-zinc-200 p-2 min-w-[140px] pointer-events-auto"
            style={{ left: `${left}px`, top: `${top}px` }}
          >
            <div className="flex flex-col gap-1">
              <button
                type="button"
                className={buttonClass}
                onClick={() => {
                  // unitId がここではプロビンスID として機能する
                  onBuild(unitId, UnitType.Army);
                  onClose();
                }}
              >
                陸軍
              </button>
              <button
                type="button"
                className={buttonClass}
                onClick={() => {
                  onBuild(unitId, UnitType.Fleet);
                  onClose();
                }}
              >
                海軍
              </button>
            </div>
          </div>
        </div>
      );
    }

    // unit が not null = 既存or新規ユニット
    if (!unit) {
      return null; // 念のため
    }

    // isNewBuild: unitId が _new_ prefix なら新規ユニット（訂正用フライアウト）
    const isNewBuild = unitId.startsWith('_new_');

    if (isNewBuild) {
      // 仮表示ユニット（訂正用）
      return (
        <div
          className="fixed inset-0 z-40 pointer-events-none"
        >
          <div
            ref={menuRef}
            className="fixed z-50 bg-white rounded-xl shadow-xl border border-zinc-200 p-2 min-w-[160px] pointer-events-auto"
            style={{ left: `${left}px`, top: `${top}px` }}
          >
            <div className="flex flex-col gap-1">
              {unit.type === UnitType.Army ? (
                <button
                  type="button"
                  className={buttonClass}
                  onClick={() => {
                    onBuildTypeChange?.(unitId, UnitType.Fleet);
                    onClose();
                  }}
                >
                  海軍に変更
                </button>
              ) : (
                <button
                  type="button"
                  className={buttonClass}
                  onClick={() => {
                    onBuildTypeChange?.(unitId, UnitType.Army);
                    onClose();
                  }}
                >
                  陸軍に変更
                </button>
              )}
              <button
                type="button"
                className={buttonClass}
                onClick={() => {
                  onDisband(unitId);
                  onClose();
                }}
              >
                増産取り消し
              </button>
            </div>
          </div>
        </div>
      );
    }

    // 既存ユニット（削除オプションのみ）
    return (
      <div
        className="fixed inset-0 z-40 pointer-events-none"
      >
        <div
          ref={menuRef}
          className="fixed z-50 bg-white rounded-xl shadow-xl border border-zinc-200 p-2 min-w-[140px] pointer-events-auto"
          style={{ left: `${left}px`, top: `${top}px` }}
        >
          <button
            type="button"
            className={`${buttonClass} ${isDisbandPending ? 'bg-zinc-200 text-zinc-700' : ''}`}
            onClick={() => {
              onDisband(unitId);
              onClose();
            }}
          >
            {isDisbandPending ? '削除をキャンセル' : '削除'}
          </button>
        </div>
      </div>
    );
  }

  return null;
}
