/**
 * 勢力ページ用の条約パネル（穴あきテンプレート方式）
 *
 * 概要:
 *   種類を選ぶと文章テンプレートが表示され、空欄をトグルボタン/オートコンプリートで埋める。
 *   対価あり合意は同種2条項も選択可。情報流布は期限不要でテキストメモを入力。
 *   全空欄が埋まったら公開範囲（情報流布以外は期限も）の入力欄が出現する。
 *
 * 主な機能:
 *   - 全国選択をトグルボタンで統一
 *   - 自国が関わるスロットはデフォルト選択済み
 *   - 条約タイトルの自動生成
 *   - 情報流布では第三国を公開先から除外
 *   - 破棄済み・期限切れ条約は非表示
 *
 * 想定される制限事項:
 *   - 条約種別変更時にスロット値はリセットされる。
 */

'use client';

import { useDiplomacyGame } from '@/context/DiplomacyGameContext';
import {
  PRICED_TREATY_CLAUSES,
  TREATY_CLAUSE_LABEL,
  isTreatyActive,
  isTreatyParticipant,
  isTreatyRatified,
  treatyExpiryLabel,
  type PendingTreatyOp,
  type TreatyCategory,
  type TreatyClauseKind,
  type TreatyRecord,
} from '@/diplomacy/treaties';
import { Season, UnitType, type BoardState } from '@/domain';
import {
  POWER_META,
  POWER_ORDER,
  powerLabel,
  provinceName,
  unitLabel,
} from '@/diplomacy/gameHelpers';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/* ──────────────── テンプレート定義 ──────────────── */

/** スロットの入力型 */
type SlotType =
  | 'power'
  | 'powerList'
  | 'province'
  | 'provinceList'
  | 'unit'
  | 'freeText';

/** スロット定義 */
type SlotDef = {
  key: string;
  type: SlotType;
  label: string;
  /** 自国をデフォルト値として使用する */
  defaultSelf?: boolean;
  /** visibleToPowerIds および participantPowerIds に追加しない（第三国など） */
  excludeFromParticipants?: boolean;
};

/** テンプレートの構成要素 */
type TemplatePart = { text: string } | { slotKey: string };

/** 条項テンプレート */
type ClauseDef = { slots: SlotDef[]; parts: TemplatePart[] };

/** スロット値の型 */
type SlotValues = Record<string, string | string[]>;

/** 単純合意の条項一覧 */
const SIMPLE_CLAUSES: TreatyClauseKind[] = [
  'mutualNonAggression',
  'mutualStandoff',
  'alliance',
  'surrender',
];

/** 情報流布の条項一覧 */
const INFO_CLAUSES: TreatyClauseKind[] = ['intelShare', 'disinformation'];

/** 条項ごとの穴あきテンプレート定義 */
const CLAUSE_DEFS: Record<TreatyClauseKind, ClauseDef> = {
  mutualNonAggression: {
    slots: [
      { key: 'powers', type: 'powerList', label: '国', defaultSelf: true },
      { key: 'provinces', type: 'provinceList', label: '都市' },
    ],
    parts: [
      { slotKey: 'powers' },
      { text: 'は' },
      { slotKey: 'provinces' },
      { text: 'を相互不可侵とする' },
    ],
  },
  mutualStandoff: {
    slots: [
      { key: 'powers', type: 'powerList', label: '国', defaultSelf: true },
      { key: 'provinces', type: 'provinceList', label: '都市' },
    ],
    parts: [
      { slotKey: 'powers' },
      { text: 'は' },
      { slotKey: 'provinces' },
      { text: 'でスタンドオフを起こす' },
    ],
  },
  alliance: {
    slots: [
      { key: 'powers', type: 'powerList', label: '同盟国', defaultSelf: true },
      { key: 'thirdPower', type: 'power', label: '第三国' },
    ],
    parts: [
      { slotKey: 'powers' },
      { text: 'は' },
      { slotKey: 'thirdPower' },
      { text: 'に対して対抗施政を取る' },
    ],
  },
  surrender: {
    slots: [
      { key: 'power1', type: 'power', label: '従属国' },
      { key: 'power2', type: 'power', label: '指示国' },
    ],
    parts: [
      { slotKey: 'power1' },
      { text: 'は' },
      { slotKey: 'power2' },
      { text: 'の指示に従う' },
    ],
  },
  sphere: {
    slots: [
      { key: 'provinces', type: 'provinceList', label: '都市' },
      { key: 'power', type: 'power', label: '勢力国', defaultSelf: true },
    ],
    parts: [
      { slotKey: 'provinces' },
      { text: 'を' },
      { slotKey: 'power' },
      { text: 'の勢力圏とする' },
    ],
  },
  routeSecure: {
    slots: [
      { key: 'power', type: 'power', label: '確保国', defaultSelf: true },
      { key: 'unit', type: 'unit', label: 'ユニット' },
      { key: 'province', type: 'province', label: '移動先' },
    ],
    parts: [
      { slotKey: 'power' },
      { text: 'は' },
      { slotKey: 'unit' },
      { text: 'の' },
      { slotKey: 'province' },
      { text: 'への移動経路を確保する' },
    ],
  },
  moveSupport: {
    slots: [
      { key: 'power', type: 'power', label: '支援国', defaultSelf: true },
      { key: 'unit', type: 'unit', label: 'ユニット' },
      { key: 'province', type: 'province', label: '移動先' },
    ],
    parts: [
      { slotKey: 'power' },
      { text: 'は' },
      { slotKey: 'unit' },
      { text: 'の' },
      { slotKey: 'province' },
      { text: 'への移動を支援する' },
    ],
  },
  convoySupport: {
    slots: [
      { key: 'power', type: 'power', label: '輸送国', defaultSelf: true },
      { key: 'unit', type: 'unit', label: 'ユニット' },
      { key: 'province', type: 'province', label: '移動先' },
    ],
    parts: [
      { slotKey: 'power' },
      { text: 'は' },
      { slotKey: 'unit' },
      { text: 'の' },
      { slotKey: 'province' },
      { text: 'への移動を輸送する' },
    ],
  },
  holdSupport: {
    slots: [
      { key: 'power', type: 'power', label: '支援国', defaultSelf: true },
      { key: 'unit', type: 'unit', label: 'ユニット' },
    ],
    parts: [
      { slotKey: 'power' },
      { text: 'は' },
      { slotKey: 'unit' },
      { text: 'の維持を支援する' },
    ],
  },
  exchangeRetreat: {
    slots: [
      { key: 'power1', type: 'power', label: '明渡国', defaultSelf: true },
      { key: 'power2', type: 'power', label: '受取国' },
      { key: 'province', type: 'province', label: '都市' },
    ],
    parts: [
      { slotKey: 'power1' },
      { text: 'は' },
      { slotKey: 'power2' },
      { text: 'に' },
      { slotKey: 'province' },
      { text: 'を明け渡す' },
    ],
  },
  intelShare: {
    slots: [
      { key: 'selfPower', type: 'power', label: '提供国', defaultSelf: true },
      { key: 'targetPower', type: 'power', label: '受領国' },
      {
        key: 'thirdPower',
        type: 'power',
        label: '第三国',
        excludeFromParticipants: true,
      },
    ],
    parts: [
      { slotKey: 'selfPower' },
      { text: 'は' },
      { slotKey: 'targetPower' },
      { text: 'に対して' },
      { slotKey: 'thirdPower' },
      { text: 'の行動に関する情報を提供する' },
    ],
  },
  disinformation: {
    slots: [
      { key: 'power1', type: 'power', label: '工作国', defaultSelf: true },
      { key: 'power2', type: 'power', label: '対象国' },
      {
        key: 'selfPower',
        type: 'power',
        label: '偽装元',
        excludeFromParticipants: true,
      },
      { key: 'freeText', type: 'freeText', label: '偽情報の内容' },
    ],
    parts: [
      { slotKey: 'power1' },
      { text: 'は' },
      { slotKey: 'power2' },
      { text: 'に対して' },
      { slotKey: 'selfPower' },
      { text: 'が「' },
      { slotKey: 'freeText' },
      { text: '」という誤った情報を提供する' },
    ],
  },
};

/* ──────────────── ヘルパー関数 ──────────────── */

/** 条約カテゴリを判定する */
function clauseCategory(kind: TreatyClauseKind): TreatyCategory {
  if (SIMPLE_CLAUSES.includes(kind)) {
    return 'simple';
  }
  if (INFO_CLAUSES.includes(kind)) {
    return 'information';
  }
  return 'priced';
}

/** スロットが入力済みかを判定する */
function isSlotFilled(slot: SlotDef, val: unknown): boolean {
  if (slot.type === 'powerList' || slot.type === 'provinceList') {
    return Array.isArray(val) && val.length > 0;
  }
  return typeof val === 'string' && val.length > 0;
}

/** 全スロットが入力済みかを判定する */
function allSlotsFilled(def: ClauseDef, vals: SlotValues): boolean {
  return def.slots.every((s) => isSlotFilled(s, vals[s.key]));
}

/** デフォルトのスロット値を生成する */
function buildDefaultSlotValues(kind: TreatyClauseKind, powerId: string): SlotValues {
  const defaults: SlotValues = {};
  for (const slot of CLAUSE_DEFS[kind].slots) {
    if (slot.defaultSelf) {
      defaults[slot.key] = slot.type === 'powerList' ? [powerId] : powerId;
    } else if (slot.type === 'powerList') {
      defaults[slot.key] = [];
    }
  }
  return defaults;
}

/** スロット値から参加国IDを抽出する（excludeFromParticipants は除く） */
function extractParticipantPowerIds(def: ClauseDef, vals: SlotValues): string[] {
  const ids: string[] = [];
  for (const slot of def.slots) {
    if (slot.excludeFromParticipants) {
      continue;
    }
    const v = vals[slot.key];
    if (slot.type === 'power' && typeof v === 'string' && v) {
      ids.push(v);
    }
    if (slot.type === 'powerList' && Array.isArray(v)) {
      ids.push(...v);
    }
  }
  return ids;
}

/** スロット値から都市IDを抽出する */
function extractProvinceIds(def: ClauseDef, vals: SlotValues): string[] {
  const ids: string[] = [];
  for (const slot of def.slots) {
    const v = vals[slot.key];
    if (slot.type === 'province' && typeof v === 'string' && v) {
      ids.push(v);
    }
    if (slot.type === 'provinceList' && Array.isArray(v)) {
      ids.push(...v);
    }
  }
  return ids;
}

/** 条約文を構築する */
function buildSentence(
  kind: TreatyClauseKind,
  vals: SlotValues,
  board: BoardState,
): string {
  const def = CLAUSE_DEFS[kind];
  return def.parts
    .map((p) => {
      if ('text' in p) {
        return p.text;
      }
      const slot = def.slots.find((s) => s.key === p.slotKey);
      if (!slot) {
        return '';
      }
      const v = vals[p.slotKey];
      switch (slot.type) {
        case 'power':
          return typeof v === 'string' ? powerLabel(v) : '';
        case 'powerList':
          return Array.isArray(v) ? v.map(powerLabel).join('・') : '';
        case 'province':
          return typeof v === 'string' ? provinceName(board, v) : '';
        case 'provinceList':
          return Array.isArray(v)
            ? v.map((id) => provinceName(board, id)).join('・')
            : '';
        case 'unit':
          return typeof v === 'string' ? unitLabel(board, v) : '';
        case 'freeText':
          return typeof v === 'string' ? v : '';
        default:
          return '';
      }
    })
    .join('');
}

/** 条項の主要な国IDを取得する（タイトル生成用） */
function firstActorFromClause(
  kind: TreatyClauseKind,
  vals: SlotValues,
): string | null {
  for (const slot of CLAUSE_DEFS[kind].slots) {
    if (slot.excludeFromParticipants) {
      continue;
    }
    const v = vals[slot.key];
    if (slot.type === 'power' && typeof v === 'string' && v) {
      return v;
    }
    if (slot.type === 'powerList' && Array.isArray(v) && v.length > 0) {
      return v[0];
    }
  }
  return null;
}

/** 条約タイトルを自動生成する */
function buildAutoTitle(
  clause1Kind: TreatyClauseKind,
  clause1Vals: SlotValues,
  clause2Kind: TreatyClauseKind | null,
  clause2Vals: SlotValues,
): string {
  const label1 = TREATY_CLAUSE_LABEL[clause1Kind];
  const cat = clauseCategory(clause1Kind);

  if (cat === 'information') {
    return label1;
  }

  if (cat === 'simple') {
    const def = CLAUSE_DEFS[clause1Kind];
    const powerNames: string[] = [];
    for (const slot of def.slots) {
      if (slot.excludeFromParticipants) {
        continue;
      }
      const v = clause1Vals[slot.key];
      if (slot.type === 'powerList' && Array.isArray(v)) {
        powerNames.push(...v.map(powerLabel));
      }
      if (slot.type === 'power' && typeof v === 'string' && v) {
        const isThirdEntry = def.slots.indexOf(slot) > 0;
        if (!isThirdEntry) {
          powerNames.push(powerLabel(v));
        }
      }
    }
    const thirdSlot = def.slots.find((s) => s.key === 'thirdPower');
    if (thirdSlot != null) {
      const thirdVal = clause1Vals['thirdPower'];
      const thirdName =
        typeof thirdVal === 'string' && thirdVal ? powerLabel(thirdVal) : '';
      return `${powerNames.join('')} ${label1}${thirdName ? `（対${thirdName}）` : ''}`;
    }
    return `${powerNames.join('')} ${label1}条約`;
  }

  // priced
  if (clause2Kind == null) {
    return label1;
  }
  const label2 = TREATY_CLAUSE_LABEL[clause2Kind];
  if (clause1Kind === clause2Kind) {
    const powers1 = extractParticipantPowerIds(CLAUSE_DEFS[clause1Kind], clause1Vals);
    const powers2 = extractParticipantPowerIds(CLAUSE_DEFS[clause2Kind], clause2Vals);
    const unique = [...new Set([...powers1, ...powers2])].map(powerLabel).join('');
    return `${unique} ${label1}`;
  }
  const actor1 = firstActorFromClause(clause1Kind, clause1Vals);
  const actor2 = firstActorFromClause(clause2Kind, clause2Vals);
  const name1 = actor1 != null ? powerLabel(actor1) : '';
  const name2 = actor2 != null ? powerLabel(actor2) : '';
  return `${name1} ${label1}・${name2} ${label2}`;
}

/* ──────────────── 都市オートコンプリート ──────────────── */

type ProvinceAutocompleteProps = {
  board: BoardState;
  selected: string[];
  onSelect: (ids: string[]) => void;
  multiple: boolean;
};

/** 都市オートコンプリート入力 */
function ProvinceAutocomplete(props: ProvinceAutocompleteProps) {
  const { board, selected, onSelect, multiple } = props;
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
    const selectedSet = new Set(selected);
    return board.provinces
      .filter((p) => !selectedSet.has(p.id) && p.name.startsWith(q))
      .slice(0, 8);
  }, [board.provinces, query, selected]);

  const handlePick = useCallback(
    (provinceId: string) => {
      onSelect(multiple ? selected.concat(provinceId) : [provinceId]);
      setQuery('');
      setOpen(false);
    },
    [multiple, onSelect, selected],
  );

  const handleRemove = useCallback(
    (provinceId: string) => {
      onSelect(selected.filter((id) => id !== provinceId));
    },
    [onSelect, selected],
  );

  return (
    <div ref={wrapRef} className="inline-flex flex-wrap items-center gap-1">
      {selected.map((id) => (
        <span
          key={id}
          className="inline-flex items-center gap-0.5 rounded-md bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-800"
        >
          {provinceName(board, id)}
          <button
            type="button"
            className="ml-0.5 text-zinc-500 hover:text-zinc-800"
            onClick={() => handleRemove(id)}
          >
            ×
          </button>
        </span>
      ))}
      <div className="relative">
        <input
          className="w-24 rounded border border-zinc-200 px-1.5 py-0.5 text-[11px] focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400/25"
          value={query}
          placeholder={selected.length > 0 ? '＋追加' : '都市名…'}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            if (query) {
              setOpen(true);
            }
          }}
        />
        {open && filtered.length > 0 ? (
          <ul className="absolute left-0 top-full z-20 mt-0.5 max-h-40 w-40 overflow-y-auto rounded border border-zinc-300 bg-white shadow-lg">
            {filtered.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className="w-full px-2 py-1 text-left text-[11px] text-zinc-800 hover:bg-zinc-50"
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
    </div>
  );
}

/* ──────────────── 国トグルボタン ──────────────── */

type PowerToggleProps = {
  /** 選択中の国IDリスト */
  selected: string[];
  /** トグル時のコールバック */
  onToggle: (powerId: string) => void;
};

/** 国選択トグルボタン群（単一・複数どちらにも対応） */
function PowerToggle(props: PowerToggleProps) {
  const { selected, onToggle } = props;
  const selectedSet = new Set(selected);
  return (
    <span className="inline-flex flex-wrap gap-0.5">
      {POWER_ORDER.map((pid) => {
        const on = selectedSet.has(pid);
        const meta = POWER_META[pid];
        return (
          <button
            key={pid}
            type="button"
            className={`rounded px-1.5 py-0.5 text-[11px] font-bold transition-colors ${
              on
                ? 'text-white'
                : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'
            }`}
            style={on ? { backgroundColor: meta?.color ?? '#64748b' } : undefined}
            onClick={() => onToggle(pid)}
          >
            {powerLabel(pid)}
          </button>
        );
      })}
    </span>
  );
}

/* ──────────────── スロット入力コンポーネント ──────────────── */

type SlotInputProps = {
  slot: SlotDef;
  board: BoardState;
  value: string | string[] | undefined;
  onChange: (val: string | string[]) => void;
};

/** 1つのスロットの入力UI */
function SlotInput(props: SlotInputProps) {
  const { slot, board, value, onChange } = props;

  switch (slot.type) {
    case 'power': {
      const v = typeof value === 'string' ? value : '';
      return (
        <PowerToggle
          selected={v ? [v] : []}
          onToggle={(pid) => onChange(pid === v ? '' : pid)}
        />
      );
    }

    case 'powerList': {
      const arr = Array.isArray(value) ? value : [];
      return (
        <PowerToggle
          selected={arr}
          onToggle={(pid) => {
            const next = arr.includes(pid)
              ? arr.filter((id) => id !== pid)
              : arr.concat(pid);
            onChange(next);
          }}
        />
      );
    }

    case 'province':
    case 'provinceList': {
      const arr = Array.isArray(value)
        ? value
        : typeof value === 'string' && value
          ? [value]
          : [];
      return (
        <ProvinceAutocomplete
          board={board}
          selected={arr}
          onSelect={(ids) => {
            onChange(slot.type === 'province' ? (ids[0] ?? '') : ids);
          }}
          multiple={slot.type === 'provinceList'}
        />
      );
    }

    case 'unit': {
      const v = typeof value === 'string' ? value : '';
      return (
        <select
          className="rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-[11px] text-zinc-800 focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400/25"
          value={v}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">（{slot.label}▼）</option>
          {board.units.map((u) => (
            <option key={u.id} value={u.id}>
              {powerLabel(u.powerId)}{' '}
              {u.type === UnitType.Army ? '陸軍' : '海軍'}{' '}
              {provinceName(board, u.provinceId)}
            </option>
          ))}
        </select>
      );
    }

    case 'freeText': {
      const v = typeof value === 'string' ? value : '';
      return (
        <input
          className="w-40 rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-[11px] text-zinc-800 focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400/25"
          value={v}
          placeholder={slot.label}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    }
  }
}

/* ──────────────── 条項テンプレートエディタ ──────────────── */

type ClauseEditorProps = {
  clauseKind: TreatyClauseKind;
  values: SlotValues;
  onChange: (key: string, val: string | string[]) => void;
  board: BoardState;
};

/** 穴あきテンプレートとスロット入力を描画する */
function ClauseEditor(props: ClauseEditorProps) {
  const { clauseKind, values, onChange, board } = props;
  const def = CLAUSE_DEFS[clauseKind];
  return (
    <div className="flex flex-wrap items-center gap-x-0.5 gap-y-1.5 text-[13px] leading-relaxed text-zinc-900">
      {def.parts.map((part, i) => {
        if ('text' in part) {
          return (
            <span key={i} className="whitespace-nowrap">
              {part.text}
            </span>
          );
        }
        const slot = def.slots.find((s) => s.key === part.slotKey);
        if (!slot) {
          return null;
        }
        return (
          <SlotInput
            key={i}
            slot={slot}
            board={board}
            value={values[slot.key]}
            onChange={(v) => onChange(slot.key, v)}
          />
        );
      })}
    </div>
  );
}

/* ──────────────── 条約カード ──────────────── */

type TreatyCardProps = {
  treaty: TreatyRecord;
  powerId: string;
  board: BoardState;
  /** 交渉フェーズかどうか（批准/却下をステージングするかどうか） */
  isNegotiationPhase: boolean;
  /** このカードに対するステージング済み操作（あれば） */
  pendingOp: PendingTreatyOp | null;
};

/** 条約カード（条約名・文面・期限/公開先＋右端ボタン） */
function TreatyCard(props: TreatyCardProps) {
  const { treaty: t, powerId, board, isNegotiationPhase, pendingOp } = props;
  const {
    respondTreaty,
    discardTreaty,
    proposeTreatyExtension,
    respondTreatyExtension,
    addPendingTreatyOp,
    removePendingTreatyOp,
  } = useDiplomacyGame();

  const ratified = isTreatyRatified(t);
  const active = isTreatyActive(t, board.turn);
  const isParticipant = isTreatyParticipant(t, powerId);
  const myStatus = t.statusByPower[powerId];
  const ext = t.extensionProposal;

  const [extOpen, setExtOpen] = useState(false);
  const [extIndef, setExtIndef] = useState(false);
  const [extYear, setExtYear] = useState(board.turn.year + 1);
  const [extSeason, setExtSeason] = useState<Season>(Season.Fall);

  /** 右端に表示するアクションボタン群を構築する */
  const actionButtons: React.ReactNode[] = [];

  if (isParticipant && !ratified && myStatus === 'pending') {
    if (isNegotiationPhase) {
      if (pendingOp != null) {
        // ステージング済み: 予定表示と取消ボタン
        actionButtons.push(
          <span
            key="staged-label"
            className={`inline-block rounded px-2 py-1 text-[10px] font-semibold text-white ${
              pendingOp.kind === 'ratify' ? 'bg-emerald-600' : 'bg-rose-600'
            }`}
          >
            {pendingOp.kind === 'ratify' ? '批准予定' : '却下予定'}
          </span>,
          <button
            key="cancel-op"
            type="button"
            className="rounded bg-zinc-400 px-2 py-1 text-[10px] font-semibold text-white hover:bg-zinc-500"
            onClick={() => removePendingTreatyOp(t.id, powerId)}
          >
            取消
          </button>,
        );
      } else {
        // 未回答: ステージングボタン
        actionButtons.push(
          <button
            key="ratify"
            type="button"
            className="rounded bg-emerald-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-emerald-500"
            onClick={() => addPendingTreatyOp({ treatyId: t.id, powerId, kind: 'ratify' })}
          >
            批准
          </button>,
          <button
            key="reject"
            type="button"
            className="rounded bg-rose-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-rose-500"
            onClick={() => addPendingTreatyOp({ treatyId: t.id, powerId, kind: 'reject' })}
          >
            却下
          </button>,
          <button
            key="counter"
            type="button"
            className="rounded bg-zinc-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-zinc-500"
            onClick={() => respondTreaty(t.id, powerId, 'counterProposed')}
          >
            修正
          </button>,
        );
      }
    }
    // 命令フェーズ以降は批准/却下ボタンを表示しない（提出時に未回答アラートで処理）
  }

  if (ratified && active && isParticipant && isNegotiationPhase) {
    actionButtons.push(
      <button
        key="discard"
        type="button"
        className="rounded bg-zinc-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-zinc-500"
        onClick={() => discardTreaty(t.id, powerId)}
      >
        破棄
      </button>,
      <button
        key="extend"
        type="button"
        className="rounded bg-zinc-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-zinc-500"
        onClick={() => setExtOpen((v) => !v)}
      >
        延長
      </button>,
    );
  }

  if (
    ext != null &&
    isParticipant &&
    ext.statusByPower[powerId] === 'pending'
  ) {
    actionButtons.push(
      <button
        key="ext-approve"
        type="button"
        className="rounded bg-emerald-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-emerald-500"
        onClick={() => respondTreatyExtension(t.id, powerId, 'ratified')}
      >
        延長批准
      </button>,
      <button
        key="ext-reject"
        type="button"
        className="rounded bg-rose-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-rose-500"
        onClick={() => respondTreatyExtension(t.id, powerId, 'rejected')}
      >
        延長却下
      </button>,
    );
  }

  /** 合意状態バッジ */
  const statusBadge = ratified
    ? active
      ? { label: '有効', cls: 'bg-emerald-100 text-emerald-800' }
      : { label: '失効', cls: 'bg-zinc-100 text-zinc-500' }
    : { label: '批准待ち', cls: 'bg-zinc-100 text-zinc-600' };

  return (
    <div className="rounded-lg border border-zinc-200 bg-white/90 p-2.5">
      <div className="flex items-start gap-2">
        {/* 左側: テキスト情報 */}
        <div className="min-w-0 flex-1">
          {/* 行1: 条約名 + 状態バッジ */}
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="text-xs font-semibold text-zinc-900">{t.title}</p>
            <span
              className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${statusBadge.cls}`}
            >
              {statusBadge.label}
            </span>
          </div>
          {/* 行2: 文面 */}
          {t.detailText ? (
            <p className="mt-0.5 whitespace-pre-line text-[11px] leading-snug text-zinc-700">
              {t.detailText}
            </p>
          ) : null}
          {/* 行3: 期限 + 公開先 */}
          <p className="mt-0.5 text-[10px] text-zinc-400">
            {treatyExpiryLabel(t)} ／ 公開:{' '}
            {t.visibleToPowerIds.map(powerLabel).join(', ')}
          </p>
          {/* 延長提案受信中 */}
          {ext != null && isParticipant && ext.statusByPower[powerId] === 'pending' ? (
            <p className="mt-1 text-[10px] text-zinc-600">
              延長提案あり（
              {powerLabel(ext.proposedByPowerId)}）:{' '}
              {ext.proposedExpiry == null
                ? '無期限'
                : `${ext.proposedExpiry.year}${
                    ext.proposedExpiry.season === Season.Spring ? '春' : '秋'
                  }まで`}
            </p>
          ) : null}
          {/* 延長提案フォーム */}
          {extOpen ? (
            <div className="mt-2 rounded border border-zinc-200 bg-zinc-50 p-2">
              <label className="flex items-center gap-1.5 text-[11px]">
                <input
                  type="checkbox"
                  checked={extIndef}
                  onChange={(e) => setExtIndef(e.target.checked)}
                />
                無期限で延長
              </label>
              {!extIndef ? (
                <div className="mt-1 flex gap-1.5">
                  <input
                    type="number"
                    className="w-20 rounded border border-zinc-300 px-1.5 py-0.5 text-xs"
                    value={extYear}
                    onChange={(e) => setExtYear(Number(e.target.value))}
                  />
                  <select
                    className="rounded border border-zinc-300 px-1.5 py-0.5 text-xs"
                    value={extSeason}
                    onChange={(e) => setExtSeason(e.target.value as Season)}
                  >
                    <option value={Season.Spring}>春</option>
                    <option value={Season.Fall}>秋</option>
                  </select>
                </div>
              ) : null}
              <div className="mt-1.5 flex gap-1.5">
                <button
                  type="button"
                  className="rounded bg-zinc-900 px-2 py-1 text-[10px] font-semibold text-white"
                  onClick={() => {
                    proposeTreatyExtension(
                      t.id,
                      powerId,
                      extIndef ? null : { year: extYear, season: extSeason },
                    );
                    setExtOpen(false);
                  }}
                >
                  提案を送る
                </button>
                <button
                  type="button"
                  className="rounded bg-zinc-400 px-2 py-1 text-[10px] font-semibold text-white"
                  onClick={() => setExtOpen(false)}
                >
                  キャンセル
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {/* 右側: アクションボタン */}
        {actionButtons.length > 0 ? (
          <div className="flex shrink-0 flex-col gap-1">
            {actionButtons}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ──────────────── メインパネル ──────────────── */

type PowerTreatyPanelProps = { powerId: string };

/**
 * 条約パネル本体。
 */
export function PowerTreatyPanel(props: PowerTreatyPanelProps) {
  const { powerId } = props;
  const {
    board,
    treaties,
    treatyViolations,
    createTreaty,
    clearPowerTreatyViolations,
    diplomacyPhase,
    pendingTreatyOps,
    isRetreatPhase,
    isAdjustmentPhasePanel,
  } = useDiplomacyGame();

  const isNegotiationPhase =
    !isRetreatPhase && !isAdjustmentPhasePanel && diplomacyPhase === 'negotiation';

  /* ── 新規交渉フォームの状態 ── */
  const [clause1Kind, setClause1Kind] = useState<TreatyClauseKind | null>(null);
  const [clause1Vals, setClause1Vals] = useState<SlotValues>({});
  const [clause2Kind, setClause2Kind] = useState<TreatyClauseKind | null>(null);
  const [clause2Vals, setClause2Vals] = useState<SlotValues>({});
  /** 情報流布のメモテキスト */
  const [infoNote, setInfoNote] = useState('');
  /** 公開先（参加国は submit 時に自動追加） */
  const [visibleTo, setVisibleTo] = useState<string[]>([powerId]);
  const [indefinite, setIndefinite] = useState(false);
  const [expiryYear, setExpiryYear] = useState(board.turn.year + 1);
  const [expirySeason, setExpirySeason] = useState<Season>(Season.Fall);

  const isInfo =
    clause1Kind != null && clauseCategory(clause1Kind) === 'information';
  const isPriced =
    clause1Kind != null && clauseCategory(clause1Kind) === 'priced';
  const clause1Def = clause1Kind != null ? CLAUSE_DEFS[clause1Kind] : null;
  const clause2Def = clause2Kind != null ? CLAUSE_DEFS[clause2Kind] : null;
  const clause1Filled = clause1Def != null && allSlotsFilled(clause1Def, clause1Vals);
  const clause2Filled = clause2Def != null && allSlotsFilled(clause2Def, clause2Vals);
  const allFilled = isPriced
    ? clause1Filled && clause2Kind != null && clause2Filled
    : clause1Filled;
  const showConfig = allFilled;

  const handleClause1Change = useCallback(
    (key: string, val: string | string[]) => {
      setClause1Vals((prev) => ({ ...prev, [key]: val }));
    },
    [],
  );

  const handleClause2Change = useCallback(
    (key: string, val: string | string[]) => {
      setClause2Vals((prev) => ({ ...prev, [key]: val }));
    },
    [],
  );

  const handleSubmit = useCallback(() => {
    if (clause1Kind == null || clause1Def == null) {
      return;
    }
    const clauseList: TreatyClauseKind[] = [clause1Kind];
    if (isPriced && clause2Kind != null) {
      clauseList.push(clause2Kind);
    }

    const participantIds1 = extractParticipantPowerIds(clause1Def, clause1Vals);
    const participantIds2 =
      clause2Def != null
        ? extractParticipantPowerIds(clause2Def, clause2Vals)
        : [];
    const allParticipants = Array.from(
      new Set([powerId, ...participantIds1, ...participantIds2]),
    );

    const provIds1 = extractProvinceIds(clause1Def, clause1Vals);
    const provIds2 =
      clause2Def != null ? extractProvinceIds(clause2Def, clause2Vals) : [];
    const allProvIds = Array.from(new Set([...provIds1, ...provIds2]));

    const visibleSet = new Set([...visibleTo, ...allParticipants]);

    const sentence1 = buildSentence(clause1Kind, clause1Vals, board);
    const sentence2 =
      isPriced && clause2Kind != null
        ? buildSentence(clause2Kind, clause2Vals, board)
        : '';

    let detailText = sentence2
      ? `${sentence1}\nかわりに\n${sentence2}`
      : sentence1;
    if (isInfo && infoNote.trim()) {
      detailText += `\n\n${infoNote.trim()}`;
    }

    const title = buildAutoTitle(clause1Kind, clause1Vals, clause2Kind, clause2Vals);

    createTreaty({
      title,
      proposerPowerId: powerId,
      category: clauseCategory(clause1Kind),
      clauses: clauseList,
      participantPowerIds: allParticipants,
      visibleToPowerIds: Array.from(visibleSet),
      provinceIds: allProvIds,
      detailText,
      expiry: isInfo ? null : indefinite
        ? null
        : { year: expiryYear, season: expirySeason },
    });

    setClause1Kind(null);
    setClause1Vals({});
    setClause2Kind(null);
    setClause2Vals({});
    setInfoNote('');
    setVisibleTo([powerId]);
    setIndefinite(false);
  }, [
    board,
    clause1Def,
    clause1Kind,
    clause1Vals,
    clause2Def,
    clause2Kind,
    clause2Vals,
    createTreaty,
    expirySeason,
    expiryYear,
    indefinite,
    infoNote,
    isInfo,
    isPriced,
    powerId,
    visibleTo,
  ]);

  /* ── 既存条約の分類（破棄済み・期限切れは除外） ── */
  const isVisible = useCallback(
    (t: TreatyRecord) =>
      t.visibleToPowerIds.includes(powerId) ||
      t.participantPowerIds.includes(powerId),
    [powerId],
  );

  const myViolationNotices = useMemo(
    () => treatyViolations.filter((n) => n.targetPowerIds.includes(powerId)),
    [treatyViolations, powerId],
  );
  const violatedTreatyIds = useMemo(
    () => new Set(myViolationNotices.map((n) => n.treatyId)),
    [myViolationNotices],
  );

  const violatedTreaties = useMemo(
    () =>
      treaties.filter(
        (t) =>
          isVisible(t) &&
          violatedTreatyIds.has(t.id) &&
          t.discardedAtIso == null,
      ),
    [treaties, isVisible, violatedTreatyIds],
  );

  const pendingTreaties = useMemo(
    () =>
      treaties.filter(
        (t) =>
          isVisible(t) &&
          !isTreatyRatified(t) &&
          t.discardedAtIso == null,
      ),
    [treaties, isVisible],
  );

  const activeTreaties = useMemo(
    () =>
      treaties.filter(
        (t) =>
          isVisible(t) &&
          isTreatyActive(t, board.turn) &&
          !violatedTreatyIds.has(t.id),
      ),
    [treaties, board.turn, isVisible, violatedTreatyIds],
  );

  const hasExisting =
    violatedTreaties.length > 0 ||
    pendingTreaties.length > 0 ||
    activeTreaties.length > 0;

  /* ── レンダリング ── */
  const subTitle =
    'mb-1.5 text-[11px] font-bold text-zinc-600 uppercase tracking-wide';

  return (
    <section className="mt-3 w-full overflow-hidden rounded-xl border border-zinc-200/80 bg-white p-3">
      {/* ──── 新規交渉（交渉フェーズのみ） ──── */}
      {!isNegotiationPhase ? (
        <p className="mb-3 text-[11px] text-zinc-500">
          {isRetreatPhase || isAdjustmentPhasePanel
            ? '退却・調整フェーズ中は新規交渉できません。'
            : '命令フェーズ中は新規交渉できません。'}
        </p>
      ) : (
        <h3 className="mb-2 text-sm font-semibold text-zinc-900">新規交渉</h3>
      )}
      {/* 種類セレクト（交渉フェーズのみ） */}
      <select
        className="w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-2 text-xs font-medium text-zinc-800 shadow-sm focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-400/25"
        value={clause1Kind ?? ''}
        disabled={!isNegotiationPhase}
        onChange={(e) => {
          const next = e.target.value as TreatyClauseKind | '';
          const kind = next || null;
          setClause1Kind(kind);
          setClause1Vals(kind != null ? buildDefaultSlotValues(kind, powerId) : {});
          setClause2Kind(null);
          setClause2Vals({});
          setInfoNote('');
        }}
      >
        <option value="">種類を選択…</option>
        <optgroup label="単純合意">
          {SIMPLE_CLAUSES.map((c) => (
            <option key={c} value={c}>
              {TREATY_CLAUSE_LABEL[c]}
            </option>
          ))}
        </optgroup>
        <optgroup label="対価あり合意（2つ選択）">
          {PRICED_TREATY_CLAUSES.map((c) => (
            <option key={c} value={c}>
              {TREATY_CLAUSE_LABEL[c]}
            </option>
          ))}
        </optgroup>
        <optgroup label="情報流布">
          {INFO_CLAUSES.map((c) => (
            <option key={c} value={c}>
              {TREATY_CLAUSE_LABEL[c]}
            </option>
          ))}
        </optgroup>
      </select>

      {/* テンプレートエディタ */}
      {clause1Kind != null ? (
        <div className="mt-2.5 rounded-lg border border-zinc-200 bg-white/90 p-2.5">
          <ClauseEditor
            clauseKind={clause1Kind}
            values={clause1Vals}
            onChange={handleClause1Change}
            board={board}
          />

          {/* 対価あり: 2条項目 */}
          {isPriced && clause1Filled ? (
            <>
              <p className="my-2.5 text-center text-xs font-bold text-zinc-500">
                かわりに
              </p>
              <select
                className="mb-2 w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-2 text-xs font-medium text-zinc-800 shadow-sm focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-400/25"
                value={clause2Kind ?? ''}
                onChange={(e) => {
                  const next = e.target.value as TreatyClauseKind | '';
                  const kind = next || null;
                  setClause2Kind(kind);
                  setClause2Vals(kind != null ? buildDefaultSlotValues(kind, powerId) : {});
                }}
              >
                <option value="">対価の種類を選択…</option>
                {PRICED_TREATY_CLAUSES.map((c) => (
                  <option key={c} value={c}>
                    {TREATY_CLAUSE_LABEL[c]}
                  </option>
                ))}
              </select>
              {clause2Kind != null ? (
                <ClauseEditor
                  clauseKind={clause2Kind}
                  values={clause2Vals}
                  onChange={handleClause2Change}
                  board={board}
                />
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}

      {/* 設定セクション（全空欄入力後に出現） */}
      {showConfig ? (
        <div className="mt-2.5 space-y-2.5 rounded-lg border border-zinc-200 bg-zinc-50 p-2.5">
          {/* 情報流布: メモテキスト */}
          {isInfo ? (
            <div>
              <p className="mb-1 text-[11px] font-semibold text-zinc-700">
                情報の詳細（任意）
              </p>
              <textarea
                className="w-full rounded border border-zinc-200 px-2 py-1.5 text-[11px] focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400/25"
                rows={3}
                value={infoNote}
                placeholder="共有する情報の内容を自由に記述…"
                onChange={(e) => setInfoNote(e.target.value)}
              />
            </div>
          ) : (
            /* 通常: 期限 */
            <div>
              <p className="mb-1 text-[11px] font-semibold text-zinc-700">
                期限
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="number"
                  className="w-20 rounded border border-zinc-300 px-1.5 py-1 text-xs disabled:opacity-40"
                  value={expiryYear}
                  disabled={indefinite}
                  onChange={(e) => setExpiryYear(Number(e.target.value))}
                />
                <select
                  className="rounded border border-zinc-300 px-1.5 py-1 text-xs disabled:opacity-40"
                  value={expirySeason}
                  disabled={indefinite}
                  onChange={(e) => setExpirySeason(e.target.value as Season)}
                >
                  <option value={Season.Spring}>春</option>
                  <option value={Season.Fall}>秋</option>
                </select>
                <span className="text-[11px] text-zinc-600">まで</span>
                <label className="flex items-center gap-1 text-[11px] text-zinc-700">
                  <input
                    type="checkbox"
                    checked={indefinite}
                    onChange={(e) => setIndefinite(e.target.checked)}
                  />
                  無期限
                </label>
              </div>
            </div>
          )}

          {/* 公開先 */}
          <div>
            <p className="mb-1 text-[11px] font-semibold text-emerald-900">
              公開先（参加国は自動追加）
            </p>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {POWER_ORDER.map((pid) => {
                const on = visibleTo.includes(pid);
                const meta = POWER_META[pid];
                return (
                  <label
                    key={pid}
                    className="flex cursor-pointer items-center gap-1 text-[11px] text-zinc-700"
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() =>
                        setVisibleTo((prev) =>
                          on
                            ? prev.filter((id) => id !== pid)
                            : prev.concat(pid),
                        )
                      }
                    />
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ backgroundColor: meta?.color }}
                    />
                    {meta?.labelCompact ?? meta?.label ?? pid}
                  </label>
                );
              })}
            </div>
          </div>

          <button
            type="button"
            className="w-full rounded-lg bg-zinc-900 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-zinc-800"
            onClick={handleSubmit}
          >
            条約を作成
          </button>
        </div>
      ) : null}

      {/* ──── 既存交渉 ──── */}
      <div className="mt-4 border-t border-zinc-200 pt-3">
        <h3 className="mb-3 text-sm font-semibold text-zinc-900">既存交渉</h3>

        {!hasExisting ? (
          <p className="text-[11px] text-zinc-400">条約はまだありません。</p>
        ) : null}

        {/* 違反された条約 */}
        {(violatedTreaties.length > 0 || myViolationNotices.length > 0) ? (
          <div className="mb-4">
            <div className="mb-1.5 flex items-center gap-2">
              <p className={subTitle}>違反された条約</p>
              <button
                type="button"
                className="rounded border border-rose-300 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-rose-600"
                onClick={() => clearPowerTreatyViolations(powerId)}
              >
                既読
              </button>
            </div>
            {myViolationNotices.map((n) => (
              <p
                key={n.id}
                className="mb-1 rounded bg-rose-50 px-2 py-1 text-[11px] text-rose-900"
              >
                {n.message}
              </p>
            ))}
            <div className="space-y-1.5">
              {violatedTreaties.map((t) => (
                <TreatyCard
                  key={t.id}
                  treaty={t}
                  powerId={powerId}
                  board={board}
                  isNegotiationPhase={isNegotiationPhase}
                  pendingOp={pendingTreatyOps.find((o) => o.treatyId === t.id && o.powerId === powerId) ?? null}
                />
              ))}
            </div>
          </div>
        ) : null}

        {/* 批准待ち */}
        {pendingTreaties.length > 0 ? (
          <div className="mb-4">
            <p className={subTitle}>批准待ち</p>
            <div className="space-y-1.5">
              {pendingTreaties.map((t) => (
                <TreatyCard
                  key={t.id}
                  treaty={t}
                  powerId={powerId}
                  board={board}
                  isNegotiationPhase={isNegotiationPhase}
                  pendingOp={pendingTreatyOps.find((o) => o.treatyId === t.id && o.powerId === powerId) ?? null}
                />
              ))}
            </div>
          </div>
        ) : null}

        {/* 有効な条約 */}
        {activeTreaties.length > 0 ? (
          <div>
            <p className={subTitle}>有効な条約</p>
            <div className="space-y-1.5">
              {activeTreaties.map((t) => (
                <TreatyCard
                  key={t.id}
                  treaty={t}
                  powerId={powerId}
                  board={board}
                  isNegotiationPhase={isNegotiationPhase}
                  pendingOp={pendingTreatyOps.find((o) => o.treatyId === t.id && o.powerId === powerId) ?? null}
                />
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
