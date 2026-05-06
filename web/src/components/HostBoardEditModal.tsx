/**
 * ホスト専用盤面修正モーダル
 *
 * 概要:
 *   ルール実行結果に誤りがあった場合、ホストが盤面を手作業で修正するUI。
 *   ユニット追加・削除・移動、補給拠点所有権変更が可能。
 */

'use client';

import { useState, useCallback } from 'react';
import type { BoardState } from '@/domain';
import { UnitType } from '@/domain';
import {
  addUnitToBoard,
  removeUnitFromBoard,
  moveUnitOnBoard,
  changeUnitType,
  changeSupplyCenterOwner,
} from '@/lib/boardEditHelpers';
import { POWER_META } from '@/diplomacy/gameHelpers';
import { MINI_MAP_INITIAL_STATE } from '@/miniMap';

type HostBoardEditModalProps = {
  open: boolean;
  board: BoardState;
  onClose: () => void;
  onApply: (newBoard: BoardState) => void;
};

export function HostBoardEditModal({
  open,
  board,
  onClose,
  onApply,
}: HostBoardEditModalProps) {
  const [editedBoard, setEditedBoard] = useState<BoardState>(board);
  const [addUnitFormOpen, setAddUnitFormOpen] = useState(false);
  const [formData, setFormData] = useState({
    powerId: 'ENG',
    provinceId: 'PAR',
    unitType: UnitType.Army as UnitType,
    fleetCoast: 'NC',
  });

  const handleReset = useCallback(() => {
    setEditedBoard(board);
  }, [board]);

  const handleApply = useCallback(() => {
    onApply(editedBoard);
    onClose();
  }, [editedBoard, onApply, onClose]);

  const handleAddUnit = useCallback(() => {
    const newBoard = addUnitToBoard(
      editedBoard,
      formData.powerId,
      formData.provinceId,
      formData.unitType,
      formData.fleetCoast,
    );
    setEditedBoard(newBoard);
    setAddUnitFormOpen(false);
  }, [editedBoard, formData]);

  const handleRemoveUnit = useCallback((unitId: string) => {
    const newBoard = removeUnitFromBoard(editedBoard, unitId);
    setEditedBoard(newBoard);
  }, [editedBoard]);

  const handleMoveUnit = useCallback(
    (unitId: string, newProvinceId: string, newFleetCoast?: string) => {
      const newBoard = moveUnitOnBoard(editedBoard, unitId, newProvinceId, newFleetCoast);
      setEditedBoard(newBoard);
    },
    [editedBoard],
  );

  const handleChangeUnitType = useCallback(
    (unitId: string, newType: UnitType) => {
      const newBoard = changeUnitType(editedBoard, unitId, newType);
      setEditedBoard(newBoard);
    },
    [editedBoard],
  );

  const handleChangeSupplyCenterOwner = useCallback(
    (provinceId: string, newOwnerId: string | null) => {
      const newBoard = changeSupplyCenterOwner(editedBoard, provinceId, newOwnerId);
      setEditedBoard(newBoard);
    },
    [editedBoard],
  );

  if (!open) return null;

  const supplyCenters = editedBoard.provinces.filter((p) => p.isSupplyCenter);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-zinc-200 bg-white shadow-lg">
        {/* ヘッダー */}
        <div className="sticky top-0 border-b border-zinc-200 bg-white px-6 py-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-zinc-900">盤面修正</h2>
            <button
              onClick={onClose}
              className="rounded text-zinc-400 hover:text-zinc-600"
            >
              ✕
            </button>
          </div>
        </div>

        {/* コンテンツ */}
        <div className="space-y-6 px-6 py-4">
          {/* ユニット管理 */}
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold text-zinc-900">ユニット管理</h3>
              <button
                onClick={() => setAddUnitFormOpen(!addUnitFormOpen)}
                className="rounded-lg border border-zinc-300 bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-800 hover:bg-zinc-200"
              >
                + 追加
              </button>
            </div>

            {/* ユニット追加フォーム */}
            {addUnitFormOpen && (
              <div className="mb-4 space-y-2 rounded-lg border border-blue-200 bg-blue-50 p-3">
                <div className="flex gap-2">
                  <select
                    value={formData.powerId}
                    onChange={(e) => setFormData({ ...formData, powerId: e.target.value })}
                    className="flex-1 rounded border border-zinc-200 px-2 py-1 text-sm"
                  >
                    {Object.entries(POWER_META).map(([id, meta]) => (
                      <option key={id} value={id}>
                        {meta.label}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={formData.provinceId}
                    onChange={(e) =>
                      setFormData({ ...formData, provinceId: e.target.value.toUpperCase() })
                    }
                    placeholder="プロヴィンス"
                    className="flex-1 rounded border border-zinc-200 px-2 py-1 text-sm"
                  />
                  <select
                    value={formData.unitType}
                    onChange={(e) =>
                      setFormData({ ...formData, unitType: e.target.value as UnitType })
                    }
                    className="rounded border border-zinc-200 px-2 py-1 text-sm"
                  >
                    <option value={UnitType.Army}>陸軍</option>
                    <option value={UnitType.Fleet}>海軍</option>
                  </select>
                </div>
                {formData.unitType === UnitType.Fleet && (
                  <select
                    value={formData.fleetCoast}
                    onChange={(e) => setFormData({ ...formData, fleetCoast: e.target.value })}
                    className="w-full rounded border border-zinc-200 px-2 py-1 text-sm"
                  >
                    <option value="NC">北岸</option>
                    <option value="SC">南岸</option>
                    <option value="EC">東岸</option>
                  </select>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={handleAddUnit}
                    className="flex-1 rounded bg-blue-500 px-3 py-1 text-xs font-medium text-white hover:bg-blue-600"
                  >
                    追加
                  </button>
                  <button
                    onClick={() => setAddUnitFormOpen(false)}
                    className="flex-1 rounded border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                  >
                    キャンセル
                  </button>
                </div>
              </div>
            )}

            {/* ユニット一覧 */}
            <div className="space-y-2">
              {editedBoard.units.length === 0 ? (
                <div className="text-center text-sm text-zinc-500">ユニットなし</div>
              ) : (
                editedBoard.units.map((unit) => {
                  const meta = POWER_META[unit.powerId];
                  return (
                    <div
                      key={unit.id}
                      className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-2"
                    >
                      <span
                        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[9px] font-bold text-white"
                        style={{ backgroundColor: meta?.color }}
                      >
                        {unit.type === UnitType.Army ? '陸' : '海'}
                      </span>
                      <input
                        type="text"
                        value={unit.provinceId}
                        onChange={(e) =>
                          handleMoveUnit(
                            unit.id,
                            e.target.value.toUpperCase(),
                            unit.fleetCoast,
                          )
                        }
                        className="w-16 rounded border border-zinc-200 px-2 py-0.5 text-xs"
                      />
                      <select
                        value={unit.type}
                        onChange={(e) => handleChangeUnitType(unit.id, e.target.value as UnitType)}
                        className="rounded border border-zinc-200 px-1 py-0.5 text-xs"
                      >
                        <option value={UnitType.Army}>陸軍</option>
                        <option value={UnitType.Fleet}>海軍</option>
                      </select>
                      <button
                        onClick={() => handleRemoveUnit(unit.id)}
                        className="ml-auto rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 hover:bg-red-200"
                      >
                        削除
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </section>

          {/* 補給拠点所有権 */}
          <section>
            <h3 className="mb-3 font-semibold text-zinc-900">補給拠点</h3>
            <div className="grid gap-2">
              {supplyCenters.map((sc) => {
                const owner = editedBoard.supplyCenterOwnership[sc.id];
                const ownerMeta = owner ? POWER_META[owner] : null;
                return (
                  <div key={sc.id} className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-2">
                    <span className="w-12 text-xs font-medium text-zinc-700">{sc.id}</span>
                    <select
                      value={owner ?? ''}
                      onChange={(e) =>
                        handleChangeSupplyCenterOwner(sc.id, e.target.value || null)
                      }
                      className="flex-1 rounded border border-zinc-200 px-2 py-1 text-xs"
                    >
                      <option value="">未所有</option>
                      {Object.entries(POWER_META).map(([id, meta]) => (
                        <option key={id} value={id}>
                          {meta.label}
                        </option>
                      ))}
                    </select>
                    {ownerMeta && (
                      <span
                        className="inline-flex h-4 w-4 rounded-full"
                        style={{ backgroundColor: ownerMeta.color }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* フェーズ情報 */}
          <section>
            <h3 className="mb-2 font-semibold text-zinc-900">ゲーム状態</h3>
            <div className="text-sm text-zinc-600">
              {editedBoard.turn.year} {editedBoard.turn.season === 'Spring' ? '春' : '秋'} ターン
            </div>
          </section>
        </div>

        {/* フッター */}
        <div className="border-t border-zinc-200 bg-zinc-50 px-6 py-4">
          <div className="flex gap-2">
            <button
              onClick={handleReset}
              className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
            >
              リセット
            </button>
            <button
              onClick={onClose}
              className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
            >
              キャンセル
            </button>
            <button
              onClick={handleApply}
              className="flex-1 rounded-lg bg-blue-500 px-3 py-2 text-sm font-medium text-white hover:bg-blue-600"
            >
              修正を反映
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
