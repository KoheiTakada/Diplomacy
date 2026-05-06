/**
 * プロヴィンス（都市）オートコンプリート入力コンポーネント
 *
 * 概要:
 *   プロヴィンスID またはプロヴィンス名のプレフィックス一致で候補を表示
 *   単一値選択版（複数選択は非対応）
 *   マウス選択のみ対応（キーボード操作なし）
 */

'use client';

import type { BoardState } from '@/domain';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type ProvinceAutocompleteProps = {
  board: BoardState;
  value: string; // 現在選択中のプロヴィンスID（空文字列 = 未選択）
  onChange: (provinceId: string) => void;
  placeholder?: string;
};

export function ProvinceAutocomplete({
  board,
  value,
  onChange,
  placeholder = 'プロヴィンス…',
}: ProvinceAutocompleteProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = useMemo(() => {
    if (!query) {
      return [];
    }
    const q = query.toLowerCase();
    return board.provinces
      .filter((p) => p.id.toLowerCase().startsWith(q) || p.name.toLowerCase().startsWith(q))
      .slice(0, 8);
  }, [board.provinces, query]);

  const handlePick = useCallback(
    (provinceId: string) => {
      onChange(provinceId);
      setQuery('');
      setOpen(false);
    },
    [onChange],
  );

  return (
    <div ref={wrapRef} className="relative">
      <input
        type="text"
        value={query}
        placeholder={placeholder}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          if (query) {
            setOpen(true);
          }
        }}
        className="w-full rounded border border-zinc-200 px-2 py-1 text-sm focus:border-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-400/20"
      />
      {open && filtered.length > 0 ? (
        <ul className="absolute left-0 top-full z-20 mt-0.5 max-h-40 w-full overflow-y-auto rounded border border-zinc-300 bg-white shadow-lg">
          {filtered.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="w-full px-2 py-1 text-left text-sm text-zinc-800 hover:bg-zinc-50"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handlePick(p.id)}
              >
                {p.name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
