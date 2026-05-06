/**
 * ホスト専用盤面修正パネル（右パネル内）
 *
 * 概要:
 *   ルール実行結果に誤りがあった場合、ホストが盤面を手作業で修正するUI。
 *   ユニット追加・削除・移動、補給拠点所有権変更が可能。
 *   右パネル内で地図を見ながら修正できる。
 */

'use client';

import { useState, useCallback, useMemo } from 'react';
import type { BoardState } from '@/domain';
import { UnitType } from '@/domain';
import {
  addUnitToBoard,
  removeUnitFromBoard,
  moveUnitOnBoard,
  changeUnitType,
  changeSupplyCenterOwner,
} from '@/lib/boardEditHelpers';
import { POWER_META, provinceName } from '@/diplomacy/gameHelpers';
import { ProvinceAutocomplete } from '@/components/ProvinceAutocomplete';

type HostBoardEditPanelProps = {
  board: BoardState;
  editedBoard: BoardState;
  onEditedBoardChange: (newBoard: BoardState) => void;
  onClose: () => void;
  onApply: (newBoard: BoardState) => void;
};

export function HostBoardEditPanel({
  board,
  editedBoard,
  onEditedBoardChange,
  onClose,
  onApply,
}: HostBoardEditPanelProps) {
  const [addUnitFormOpen, setAddUnitFormOpen] = useState(false);
  const [formData, setFormData] = useState({
    powerId: 'ENG',
    provinceId: '',
    unitType: UnitType.Army as UnitType,
    fleetCoast: 'NC',
  });

  const handleReset = useCallback(() => {
    onEditedBoardChange(board);
  }, [board, onEditedBoardChange]);

  const handleApply = useCallback(() => {
    onApply(editedBoard);
    onClose();
  }, [editedBoard, onApply, onClose]);

  const handleAddUnit = useCallback(() => {
    if (!formData.provinceId) return;
    const newBoard = addUnitToBoard(
      editedBoard,
      formData.powerId,
      formData.provinceId,
      formData.unitType,
      formData.fleetCoast,
    );
    onEditedBoardChange(newBoard);
    setAddUnitFormOpen(false);
    setFormData({
      powerId: 'ENG',
      provinceId: '',
      unitType: UnitType.Army as UnitType,
      fleetCoast: 'NC',
    });
  }, [editedBoard, formData, onEditedBoardChange]);

  const handleRemoveUnit = useCallback((unitId: string) => {
    const newBoard = removeUnitFromBoard(editedBoard, unitId);
    onEditedBoardChange(newBoard);
  }, [editedBoard, onEditedBoardChange]);

  const handleMoveUnit = useCallback(
    (unitId: string, newProvinceId: string, newFleetCoast?: string) => {
      if (!newProvinceId) return;
      const newBoard = moveUnitOnBoard(editedBoard, unitId, newProvinceId, newFleetCoast);
      onEditedBoardChange(newBoard);
    },
    [editedBoard, onEditedBoardChange],
  );

  const handleChangeUnitType = useCallback(
    (unitId: string, newType: UnitType) => {
      const newBoard = changeUnitType(editedBoard, unitId, newType);
      onEditedBoardChange(newBoard);
    },
    [editedBoard, onEditedBoardChange],
  );

  const handleChangeSupplyCenterOwner = useCallback(
    (provinceId: string, newOwnerId: string | null) => {
      const newBoard = changeSupplyCenterOwner(editedBoard, provinceId, newOwnerId);
      onEditedBoardChange(newBoard);
    },
    [editedBoard, onEditedBoardChange],
  );

  const supplyCenters = useMemo(
    () => editedBoard.provinces.filter((p) => p.isSupplyCenter),
    [editedBoard.provinces],
  );

  return (
    <div className="flex flex-col gap-4 overflow-y-auto">
      {/* ヘッダー */}
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-zinc-900">盤面修正</h2>
        <button
          onClick={onClose}
          className="rounded text-zinc-400 hover:text-zinc-600"
        >
          ✕
        </button>
      </div>

      {/* フェーズ情報 */}
      <div className="rounded-lg border border-zinc-200 bg-zinc-50/50 p-3">
        <div className="text-sm text-zinc-600">
          {editedBoard.turn.year} {editedBoard.turn.season === 'Spring' ? '春' : '秋'} ターン
        </div>
      </div>

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
            <div className="space-y-2">
              <select
                value={formData.powerId}
                onChange={(e) => setFormData({ ...formData, powerId: e.target.value })}
                className="w-full rounded border border-zinc-200 px-2 py-1 text-sm"
              >
                {Object.entries(POWER_META).map(([id, meta]) => (
                  <option key={id} value={id}>
                    {meta.label}
                  </option>
                ))}
              </select>
              <ProvinceAutocomplete
                board={editedBoard}
                value={formData.provinceId}
                onChange={(p) => setFormData({ ...formData, provinceId: p })}
                placeholder="プロヴィンス"
              />
              {formData.provinceId && (
                <div className="text-xs text-zinc-600">
                  選択: {provinceName(editedBoard, formData.provinceId)}
                </div>
              )}
              {/* 陸軍/海軍トグル */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, unitType: UnitType.Army })}
                  className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                    formData.unitType === UnitType.Army
                      ? 'text-white'
                      : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                  }`}
                  style={
                    formData.unitType === UnitType.Army
                      ? { backgroundColor: POWER_META[formData.powerId]?.color || '#94a3b8' }
                      : undefined
                  }
                >
                  陸軍
                </button>
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, unitType: UnitType.Fleet })}
                  className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                    formData.unitType === UnitType.Fleet
                      ? 'text-white'
                      : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                  }`}
                  style={
                    formData.unitType === UnitType.Fleet
                      ? { backgroundColor: POWER_META[formData.powerId]?.color || '#94a3b8' }
                      : undefined
                  }
                >
                  海軍
                </button>
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
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleAddUnit}
                className="flex-1 rounded-lg bg-blue-500 px-3 py-1 text-xs font-medium text-white hover:bg-blue-600"
              >
                追加
              </button>
              <button
                onClick={() => setAddUnitFormOpen(false)}
                className="flex-1 rounded-lg border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
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
                  className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-2"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[9px] font-bold text-white"
                      style={{ backgroundColor: meta?.color }}
                    >
                      {unit.type === UnitType.Army ? '陸' : '海'}
                    </span>
                    <button
                      onClick={() => handleRemoveUnit(unit.id)}
                      className="ml-auto rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 hover:bg-red-200"
                    >
                      削除
                    </button>
                  </div>
                  {/* プロヴィンス入力 */}
                  <div>
                    <div className="mb-1 text-xs text-zinc-600">
                      {provinceName(editedBoard, unit.provinceId)}
                    </div>
                    <ProvinceAutocomplete
                      board={editedBoard}
                      value={unit.provinceId}
                      onChange={(p) => handleMoveUnit(unit.id, p, unit.fleetCoast)}
                      placeholder="位置を変更"
                    />
                  </div>
                  {/* 陸軍/海軍トグル */}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleChangeUnitType(unit.id, UnitType.Army)}
                      className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                        unit.type === UnitType.Army
                          ? 'text-white'
                          : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                      }`}
                      style={
                        unit.type === UnitType.Army
                          ? { backgroundColor: meta?.color || '#94a3b8' }
                          : undefined
                      }
                    >
                      陸軍
                    </button>
                    <button
                      type="button"
                      onClick={() => handleChangeUnitType(unit.id, UnitType.Fleet)}
                      className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                        unit.type === UnitType.Fleet
                          ? 'text-white'
                          : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                      }`}
                      style={
                        unit.type === UnitType.Fleet
                          ? { backgroundColor: meta?.color || '#94a3b8' }
                          : undefined
                      }
                    >
                      海軍
                    </button>
                  </div>
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
                <span className="min-w-12 text-xs font-medium text-zinc-700">{provinceName(editedBoard, sc.id)}</span>
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

      {/* フッター */}
      <div className="flex gap-2 border-t border-zinc-200 pt-3">
        <button
          onClick={handleReset}
          className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
        >
          リセット
        </button>
        <button
          onClick={onClose}
          className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
        >
          キャンセル
        </button>
        <button
          onClick={handleApply}
          className="flex-1 rounded-lg bg-blue-500 px-3 py-2 text-xs font-medium text-white hover:bg-blue-600"
        >
          修正を反映
        </button>
      </div>
    </div>
  );
}
