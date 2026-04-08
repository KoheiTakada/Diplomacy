/**
 * ディプロマシー支援ツールの共有ゲーム状態（Context）
 *
 * 概要:
 *   メインページと各国専用ページで同一の盤面・命令・ログを共有する。
 *
 * 主な機能:
 *   - 盤面・命令・フェーズ・ログの保持と解決処理
 *   - IndexedDB へのオートセーブ（世界線ごとに1スロット・上書き）
 *   - 命令解決・退却確定・調整完了のたびに当該世界線へ保存（log 含む全体）
 *   - 各国の「入力確定」フラグ（誠実運用向け、パスワードなし）
 *
 * 想定される制限事項:
 *   - プライベートモード等では IndexedDB が使えない場合がある。
 *   - オンライン卓モード時は Supabase 経由で同期し、IndexedDB オートセーブは行わない。
 */

'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { POWERS } from '@/miniMap';
import { applyResolutionRevealStep, RESOLUTION_REVEAL_MS } from '@/resolutionReveal';
import {
  buildResolutionRevealTimeline,
  type RevealTimelineStep,
} from '@/resolutionRevealOrder';
import { adjudicateTurn } from '@/rulesEngine';
import {
  AreaType,
  boardWithRefreshedProvinceTint,
  type DislodgedUnit,
  OrderType,
  Season,
  UnitType,
  type BoardState,
  type Order,
  type Unit,
} from '@/domain';
import { turnLabel } from '@/turnLabel';
import {
  appendMapEffectsForRevealResolution,
  asFleetCoast,
  buildUnitOrderInputsFromDomainOrders,
  buildCapacity,
  canBuildFleetAtProvince,
  buildDefaultOrders,
  buildDomainOrdersFromInputs,
  countSupplyCenters,
  countUnits,
  disbandNeed,
  emptyOrder,
  emptyPowerBoolMap,
  fleetArrivalCoasts,
  formatOrderResolutionLogLine,
  isPowerAdjustmentSlotsFilled,
  isPowerOrdersComplete,
  nextTurn,
  parseRetreatSelection,
  powerHasUnits,
  powerNeedsAdjustment,
  POWER_ORDER,
  supportCountBySupportedUnitIdFromOrders,
  type BuildSlot,
  type DisbandSlot,
  type ResolveLogEntry,
  type UnitOrderInput,
} from '@/diplomacy/gameHelpers';
import { buildAdjacencyKeySet, isSplitProvince } from '@/mapMovement';
import type { MapVisualEffect } from '@/mapVisualEffects';
import { readWorldlineSave, writeWorldlineSave } from '@/lib/appSaveStorage';
import {
  createDefaultPersistedSnapshot,
  normalizeLoadedSnapshot,
  serializeSnapshotForStorage,
  tryParsePersistedSnapshotJson,
  type PersistedSnapshot,
} from '@/lib/persistedSnapshot';
import { buildPowerOnlinePatchPayload } from '@/lib/onlinePowerPatchClient';
import {
  clearOnlineActiveSession,
  storeOnlineHostSecret,
  storeOnlineActiveSession,
  storeOnlinePowerSecrets,
  syncOnlineSecretsSessionStorageToLocalStorage,
} from '@/lib/onlineSessionBrowser';

/** 旧版 localStorage キー（起動時に削除して移行するのみ） */
const LEGACY_STORAGE_KEY = 'diplomacy-game-state-v1';

/**
 * オンライン pull 後に自国ローカル編集をマージしてよいかの判定用。
 * ターン・季・調整／退却フェーズが一致するときのみ true。
 *
 * @param incoming - サーバー側スナップショット
 * @param local - クライアント直前のスナップショット
 */
function sameOnlineGameStepForMerge(
  incoming: PersistedSnapshot,
  local: PersistedSnapshot,
): boolean {
  return (
    incoming.board.turn.year === local.board.turn.year &&
    incoming.board.turn.season === local.board.turn.season &&
    incoming.isBuildPhase === local.isBuildPhase &&
    incoming.isDisbandPhase === local.isDisbandPhase &&
    incoming.isRetreatPhase === local.isRetreatPhase
  );
}

/**
 * スナップショットの進行順（年・季・フェーズ）を比較するためのキー。
 * 小さいほど過去。大きいほど未来。
 */
function snapshotProgressOrderKey(s: PersistedSnapshot): number {
  const seasonRank = s.board.turn.season === Season.Spring ? 0 : 1;
  const phaseRank = s.isBuildPhase || s.isDisbandPhase
    ? 2
    : s.isRetreatPhase
      ? 1
      : 0;
  return s.board.turn.year * 100 + seasonRank * 10 + phaseRank;
}

function compareSnapshotProgress(
  a: PersistedSnapshot,
  b: PersistedSnapshot,
): number {
  const ka = snapshotProgressOrderKey(a);
  const kb = snapshotProgressOrderKey(b);
  if (ka < kb) {
    return -1;
  }
  if (ka > kb) {
    return 1;
  }
  return 0;
}

/**
 * サーバー取得スナップショットへ、自国の命令・調整・退却・記録フラグだけをローカルから上書きする。
 * 進行が変わった盤面（ターン／フェーズ不一致）にはローカルを混ぜない。
 * ポールで flush 成功後も GET が一瞬古い場合や、デバウンス外の再編集を防ぐために勢力クライアントで使う。
 *
 * @param incoming - 正規化済みサーバースナップショット
 * @param local - マージ元（未送信編集を含む可能性）
 * @param powerId - 勢力 ID
 */
function mergePowerSecretSnapshotFromLocal(
  incoming: PersistedSnapshot,
  local: PersistedSnapshot,
  powerId: string,
): PersistedSnapshot {
  if (!sameOnlineGameStepForMerge(incoming, local)) {
    return incoming;
  }
  const unitOrders = { ...incoming.unitOrders };
  for (const u of incoming.board.units) {
    if (u.powerId !== powerId) {
      continue;
    }
    const lo = local.unitOrders[u.id];
    if (lo != null) {
      unitOrders[u.id] = lo;
    }
  }
  const buildPlan = { ...incoming.buildPlan };
  if (local.buildPlan[powerId] != null) {
    buildPlan[powerId] = local.buildPlan[powerId]!;
  }
  const disbandPlan = { ...incoming.disbandPlan };
  if (local.disbandPlan[powerId] != null) {
    disbandPlan[powerId] = local.disbandPlan[powerId]!;
  }
  const retreatTargets = { ...incoming.retreatTargets };
  for (const d of incoming.pendingRetreats) {
    if (d.unit.powerId !== powerId) {
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(local.retreatTargets, d.unit.id)) {
      retreatTargets[d.unit.id] = local.retreatTargets[d.unit.id];
    }
  }
  const powerOrderSaved = { ...incoming.powerOrderSaved };
  powerOrderSaved[powerId] = local.powerOrderSaved[powerId] === true;
  const powerAdjustmentSaved = { ...incoming.powerAdjustmentSaved };
  powerAdjustmentSaved[powerId] = local.powerAdjustmentSaved[powerId] === true;
  const powerRetreatSaved = { ...incoming.powerRetreatSaved };
  powerRetreatSaved[powerId] = local.powerRetreatSaved[powerId] === true;
  return {
    ...incoming,
    unitOrders,
    buildPlan,
    disbandPlan,
    retreatTargets,
    powerOrderSaved,
    powerAdjustmentSaved,
    powerRetreatSaved,
  };
}

/**
 * 版競合（409）後の再取得で、ホストの未送信編集を失わないための3-wayマージ。
 * base = 最後にサーバーと整合したとみなすスナップショット、local = 現在画面、incoming = GET 応答。
 * 各フィールドで local が base から変わっていれば local を採用、さもなくば incoming。
 *
 * @param incoming - サーバーから取得した正規化済みスナップショット
 * @param local - クライアント現在状態
 * @param base - 直近の同期基準
 */
function mergeHostPersistedSnapshotThreeWay(
  incoming: PersistedSnapshot,
  local: PersistedSnapshot,
  base: PersistedSnapshot,
): PersistedSnapshot {
  if (!sameOnlineGameStepForMerge(incoming, local)) {
    return incoming;
  }
  const jsonEq = (a: unknown, b: unknown): boolean =>
    JSON.stringify(a) === JSON.stringify(b);
  const unitOrders = { ...incoming.unitOrders };
  for (const u of incoming.board.units) {
    const id = u.id;
    const loc = local.unitOrders[id] ?? emptyOrder();
    const bas = base.unitOrders[id] ?? emptyOrder();
    if (!jsonEq(loc, bas)) {
      unitOrders[id] = loc;
    } else if (incoming.unitOrders[id] != null) {
      unitOrders[id] = incoming.unitOrders[id]!;
    } else {
      unitOrders[id] = loc;
    }
  }
  const buildPlan = { ...incoming.buildPlan };
  const buildKeys = new Set([
    ...Object.keys(local.buildPlan),
    ...Object.keys(incoming.buildPlan),
    ...Object.keys(base.buildPlan),
  ]);
  for (const pid of buildKeys) {
    const l = local.buildPlan[pid];
    const b = base.buildPlan[pid];
    const i = incoming.buildPlan[pid];
    if (!jsonEq(l, b)) {
      if (l != null) {
        buildPlan[pid] = l;
      }
    } else if (i != null) {
      buildPlan[pid] = i;
    }
  }
  const disbandPlan = { ...incoming.disbandPlan };
  const disbandKeys = new Set([
    ...Object.keys(local.disbandPlan),
    ...Object.keys(incoming.disbandPlan),
    ...Object.keys(base.disbandPlan),
  ]);
  for (const pid of disbandKeys) {
    const l = local.disbandPlan[pid];
    const b = base.disbandPlan[pid];
    const i = incoming.disbandPlan[pid];
    if (!jsonEq(l, b)) {
      if (l != null) {
        disbandPlan[pid] = l;
      }
    } else if (i != null) {
      disbandPlan[pid] = i;
    }
  }
  const retreatTargets = { ...incoming.retreatTargets };
  const retreatKeys = new Set([
    ...Object.keys(local.retreatTargets),
    ...Object.keys(incoming.retreatTargets),
    ...Object.keys(base.retreatTargets),
  ]);
  for (const rid of retreatKeys) {
    const l = local.retreatTargets[rid] ?? '';
    const b = base.retreatTargets[rid] ?? '';
    const inc = incoming.retreatTargets[rid];
    if (l !== b) {
      if (l.length > 0) {
        retreatTargets[rid] = l;
      } else {
        delete retreatTargets[rid];
      }
    } else if (inc != null && inc.length > 0) {
      retreatTargets[rid] = inc;
    } else {
      delete retreatTargets[rid];
    }
  }
  const powerOrderSaved = { ...incoming.powerOrderSaved };
  const powerAdjustmentSaved = { ...incoming.powerAdjustmentSaved };
  const powerRetreatSaved = { ...incoming.powerRetreatSaved };
  for (const pid of POWERS) {
    if (local.powerOrderSaved[pid] !== base.powerOrderSaved[pid]) {
      powerOrderSaved[pid] = local.powerOrderSaved[pid] === true;
    } else {
      powerOrderSaved[pid] = incoming.powerOrderSaved[pid] === true;
    }
    if (local.powerAdjustmentSaved[pid] !== base.powerAdjustmentSaved[pid]) {
      powerAdjustmentSaved[pid] = local.powerAdjustmentSaved[pid] === true;
    } else {
      powerAdjustmentSaved[pid] = incoming.powerAdjustmentSaved[pid] === true;
    }
    if (local.powerRetreatSaved[pid] !== base.powerRetreatSaved[pid]) {
      powerRetreatSaved[pid] = local.powerRetreatSaved[pid] === true;
    } else {
      powerRetreatSaved[pid] = incoming.powerRetreatSaved[pid] === true;
    }
  }
  return {
    ...incoming,
    unitOrders,
    buildPlan,
    disbandPlan,
    retreatTargets,
    powerOrderSaved,
    powerAdjustmentSaved,
    powerRetreatSaved,
  };
}

/**
 * Supabase オンライン卓への接続状態。
 */
export type OnlineSession =
  | {
      kind: 'host';
      roomId: string;
      hostSecret: string;
    }
  | {
      kind: 'power';
      roomId: string;
      powerId: string;
      powerSecret: string;
    };

/** オンライン新規卓作成の結果 */
export type StartOnlineGameResult =
  | {
      ok: true;
      roomId: string;
      hostSecret: string;
      powerSecrets: Record<string, string>;
    }
  | { ok: false; error: string };

/** オンライン参加の結果 */
export type JoinOnlineGameResult = { ok: true } | { ok: false; error: string };

type LeaveGameSessionOptions = {
  intentional?: boolean;
  reason?: string;
};

type OnlineDebugEvent = {
  ts: string;
  tag: string;
  detail?: string;
  roomId?: string;
  role?: string;
  localVersion?: number;
  serverVersion?: number;
};

/**
 * オンライン参加パラメータ。
 * - `token`: 平文のみ。GET `?t=` でサーバーがホスト／各国ハッシュと照合し `onlineAuth` を返す（アドレスバーに載せない）。
 *   `expectedPowerId` 省略時はロールをクライアントで指定せず、応答の role に従う（タイトル画面の Join 推奨）。
 * - `hostSecret` / `powerId`+`powerSecret`: 従来形式（検証付き）。必要なら残す。
 * - `expectedPowerId`: 指定時はトークンがその国用か追加検証（勢力別 URL 等向け）。
 */
export type JoinOnlineGameParams =
  | { roomId: string; hostSecret: string }
  | { roomId: string; powerId: string; powerSecret: string }
  | { roomId: string; token: string; expectedPowerId?: string };

/**
 * 世界線名を stem（ID・ファイル名の核）に整形する。
 *
 * @param raw - ユーザー入力
 * @returns 有効な stem、空・無効なら null
 */
function sanitizeWorldlineStem(raw: string): string | null {
  const t = raw.trim();
  if (t.length === 0) {
    return null;
  }
  const cleaned = t
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  if (cleaned.length === 0) {
    return null;
  }
  const maxLen = 80;
  return cleaned.length > maxLen ? cleaned.slice(0, maxLen) : cleaned;
}

/**
 * インポートファイル名から stem を得る。
 *
 * @param fileName - 例: `foo.json`
 */
function stemFromImportedFileName(fileName: string): string {
  const withoutExt = fileName.replace(/\.json$/i, '').trim();
  return sanitizeWorldlineStem(withoutExt) ?? 'diplomacy-import';
}

/**
 * 新規ゲーム用のデフォルトスナップショット（SSR/CSR 初回と同一）。
 */
export type DiplomacyGameContextValue = {
  board: BoardState;
  setBoard: React.Dispatch<React.SetStateAction<BoardState>>;
  unitOrders: Record<string, UnitOrderInput>;
  setUnitOrders: React.Dispatch<
    React.SetStateAction<Record<string, UnitOrderInput>>
  >;
  log: ResolveLogEntry[];
  setLog: React.Dispatch<React.SetStateAction<ResolveLogEntry[]>>;
  turnHistory: {
    id: string;
    turnLabel: string;
    board: BoardState;
    unitOrders: Record<string, UnitOrderInput>;
    supportCountByUnitId: Record<string, number>;
  }[];
  isBuildPhase: boolean;
  setIsBuildPhase: React.Dispatch<React.SetStateAction<boolean>>;
  buildPlan: Record<string, BuildSlot[]>;
  setBuildPlan: React.Dispatch<
    React.SetStateAction<Record<string, BuildSlot[]>>
  >;
  isDisbandPhase: boolean;
  setIsDisbandPhase: React.Dispatch<React.SetStateAction<boolean>>;
  disbandPlan: Record<string, DisbandSlot[]>;
  setDisbandPlan: React.Dispatch<
    React.SetStateAction<Record<string, DisbandSlot[]>>
  >;
  isRetreatPhase: boolean;
  setIsRetreatPhase: React.Dispatch<React.SetStateAction<boolean>>;
  retreatTargets: Record<string, string>;
  setRetreatTargets: React.Dispatch<
    React.SetStateAction<Record<string, string>>
  >;
  pendingRetreats: DislodgedUnit[];
  setPendingRetreats: React.Dispatch<React.SetStateAction<DislodgedUnit[]>>;
  isResolutionRevealing: boolean;
  powerOrderSaved: Record<string, boolean>;
  setPowerOrderSaved: React.Dispatch<
    React.SetStateAction<Record<string, boolean>>
  >;
  powerAdjustmentSaved: Record<string, boolean>;
  setPowerAdjustmentSaved: React.Dispatch<
    React.SetStateAction<Record<string, boolean>>
  >;
  powerRetreatSaved: Record<string, boolean>;
  setPowerRetreatSaved: React.Dispatch<
    React.SetStateAction<Record<string, boolean>>
  >;
  revealGenRef: RefObject<number>;
  revealTimersRef: RefObject<number[]>;
  nextLogIdRef: RefObject<number>;
  logListRef: RefObject<HTMLUListElement | null>;
  pendingMapEffectsRef: RefObject<MapVisualEffect[]>;
  prependLogLine: (line: string) => void;
  isOrderLocked: boolean;
  isAdjustmentPhasePanel: boolean;
  orderAdjKeys: Set<string>;
  updateOrder: (unitId: string, patch: Partial<UnitOrderInput>) => void;
  changeOrderType: (unitId: string, newType: OrderType) => void;
  resetAllOrders: () => void;
  buildDomainOrders: () => Order[];
  handleAdjudicate: () => void;
  confirmRetreatPhase: () => void;
  finalizeAdjustmentPhase: () => void;
  markPowerOrderSaved: (powerId: string) => void;
  markPowerAdjustmentSaved: (powerId: string) => void;
  markPowerRetreatSaved: (powerId: string) => void;
  allPowersMovementReady: boolean;
  allPowersAdjustmentReady: boolean;
  allPowersRetreatReady: boolean;
  /** ゲーム画面を表示するか */
  gameSessionActive: boolean;
  /**
   * 新規ゲーム。世界線 stem で IndexedDB の当該スロットを上書きする。
   *
   * @param worldlineNameRaw - 世界線名（空なら stem は diplomacy）
   */
  startNewGame: (worldlineNameRaw: string) => void;
  leaveGameSession: (options?: LeaveGameSessionOptions) => void;
  /** 意図しないタイトル遷移の原因を記録する */
  reportUnexpectedTitleNavigation: (reason: string) => void;
  /**
   * JSON テキストを読み込み、世界線を特定してゲームへ入る。
   *
   * @param jsonText - セーブ JSON
   * @param sourceFileName - ファイル名（stem 推定用）
   * @returns 成功なら true
   */
  importSaveFromJsonText: (
    jsonText: string,
    sourceFileName?: string,
  ) => boolean;
  /**
   * IndexedDB に保存された指定世界線のセーブを読み込む。
   *
   * @param worldlineStem - 世界線 ID
   * @returns 成功なら true
   */
  loadSaveFromAppStorageByStem: (worldlineStem: string) => Promise<boolean>;
  /** Supabase オンライン卓。null でローカルのみ */
  onlineSession: OnlineSession | null;
  /** サーバー上のスナップショット版（表示・デバッグ用） */
  onlineServerVersion: number;
  /** 収集中のデバッグイベント件数 */
  onlineDebugLogCount: number;
  /** 収集済みオンラインデバッグログを JSON で保存 */
  downloadOnlineDebugLog: () => void;
  /** 収集済みオンラインデバッグログをクリア */
  clearOnlineDebugLog: () => void;
  /**
   * 新規オンライン卓を作成しホストとして入る。
   *
   * @param worldlineNameRaw - 世界線名
   */
  startNewOnlineGame: (
    worldlineNameRaw: string,
  ) => Promise<StartOnlineGameResult>;
  /**
   * 既存卓にホストまたは勢力として参加する。
   *
   * @param params - 卓 ID とシークレット
   */
  joinOnlineGame: (params: JoinOnlineGameParams) => Promise<JoinOnlineGameResult>;
};

const DiplomacyGameContext = createContext<DiplomacyGameContextValue | null>(
  null,
);

/**
 * 共有ゲーム状態を提供する Provider。
 *
 * @param props.children - 子要素
 */
export function DiplomacyGameProvider(props: { children: ReactNode }) {
  const ONLINE_DEBUG_LOG_MAX = 600;
  const defaultSnap = useMemo(() => createDefaultPersistedSnapshot(), []);
  const [board, setBoard] = useState<BoardState>(defaultSnap.board);
  const [unitOrders, setUnitOrders] = useState<Record<string, UnitOrderInput>>(
    defaultSnap.unitOrders,
  );
  const [log, setLog] = useState<ResolveLogEntry[]>(defaultSnap.log);
  const [turnHistory, setTurnHistory] = useState<
    {
      id: string;
      turnLabel: string;
      board: BoardState;
      unitOrders: Record<string, UnitOrderInput>;
      supportCountByUnitId: Record<string, number>;
    }[]
  >([]);
  const [isBuildPhase, setIsBuildPhase] = useState(defaultSnap.isBuildPhase);
  const [buildPlan, setBuildPlan] = useState<Record<string, BuildSlot[]>>(
    defaultSnap.buildPlan,
  );
  const [isDisbandPhase, setIsDisbandPhase] = useState(defaultSnap.isDisbandPhase);
  const [disbandPlan, setDisbandPlan] = useState<
    Record<string, DisbandSlot[]>
  >(defaultSnap.disbandPlan);
  const [isRetreatPhase, setIsRetreatPhase] = useState(defaultSnap.isRetreatPhase);
  const [retreatTargets, setRetreatTargets] = useState<Record<string, string>>(
    defaultSnap.retreatTargets,
  );
  const [pendingRetreats, setPendingRetreats] = useState<DislodgedUnit[]>(
    defaultSnap.pendingRetreats,
  );
  const [isResolutionRevealing, setIsResolutionRevealing] = useState(false);
  /** ポーリングが解決演出中に古いスナップショットで上書きしないよう参照する */
  const isResolutionRevealingRef = useRef(false);
  const [powerOrderSaved, setPowerOrderSaved] = useState<Record<string, boolean>>(
    defaultSnap.powerOrderSaved,
  );
  const [powerAdjustmentSaved, setPowerAdjustmentSaved] = useState<
    Record<string, boolean>
  >(defaultSnap.powerAdjustmentSaved);
  const [powerRetreatSaved, setPowerRetreatSaved] = useState<
    Record<string, boolean>
  >(defaultSnap.powerRetreatSaved);

  const [gameSessionActive, setGameSessionActive] = useState(false);
  const [activeWorldlineStem, setActiveWorldlineStem] = useState('');
  const [onlineSession, setOnlineSession] = useState<OnlineSession | null>(null);
  const [onlineServerVersion, setOnlineServerVersion] = useState(0);
  const [onlineDebugLogCount, setOnlineDebugLogCount] = useState(0);

  const revealGenRef = useRef(0);
  const revealTimersRef = useRef<number[]>([]);
  const nextLogIdRef = useRef(defaultSnap.nextLogId);
  const logListRef = useRef<HTMLUListElement | null>(null);
  const pendingMapEffectsRef = useRef<MapVisualEffect[]>([]);
  const pendingAppAutoSaveRef = useRef(false);
  const lastServerVersionRef = useRef(0);
  /**
   * ホスト: 版競合時の3-wayマージ用。最後にサーバー内容と揃えた PersistedSnapshot
   * （参加直後・PUT 成功直後・GET フル適用のたびに更新）。
   */
  const onlineHostSyncBaselineRef = useRef<PersistedSnapshot | null>(null);
  const onlineSessionRef = useRef<OnlineSession | null>(null);
  const onlinePushTimerRef = useRef<number | null>(null);
  /** power 参加者は「命令送信」押下時だけサーバー送信するためのフラグ */
  const powerSubmitRequestedRef = useRef(false);
  const buildCurrentSnapshotRef = useRef(() => defaultSnap as PersistedSnapshot);
  const onlineDebugLogRef = useRef<OnlineDebugEvent[]>([]);

  useEffect(() => {
    onlineSessionRef.current = onlineSession;
  }, [onlineSession]);

  /**
   * 旧版が sessionStorage のみに書いていたシークレットを localStorage へ複製する。
   * メインタブを一度開いたあとで別タブから `/power` を開けるようにする。
   */
  useEffect(() => {
    syncOnlineSecretsSessionStorageToLocalStorage();
  }, []);

  useEffect(() => {
    isResolutionRevealingRef.current = isResolutionRevealing;
  }, [isResolutionRevealing]);

  const appendOnlineDebugLog = useCallback(
    (tag: string, detail?: string, serverVersion?: number) => {
      const sess = onlineSessionRef.current;
      const ev: OnlineDebugEvent = {
        ts: new Date().toISOString(),
        tag,
        detail,
        roomId: sess?.roomId,
        role:
          sess == null
            ? 'offline'
            : sess.kind === 'host'
              ? 'host'
              : `power:${sess.powerId}`,
        localVersion: lastServerVersionRef.current,
        serverVersion,
      };
      const next = onlineDebugLogRef.current.concat(ev);
      onlineDebugLogRef.current =
        next.length > ONLINE_DEBUG_LOG_MAX
          ? next.slice(next.length - ONLINE_DEBUG_LOG_MAX)
          : next;
      setOnlineDebugLogCount(onlineDebugLogRef.current.length);
    },
    [],
  );

  const clearOnlineDebugLog = useCallback(() => {
    onlineDebugLogRef.current = [];
    setOnlineDebugLogCount(0);
  }, []);

  const downloadOnlineDebugLog = useCallback(() => {
    const sess = onlineSessionRef.current;
    const payload = {
      exportedAt: new Date().toISOString(),
      roomId: sess?.roomId ?? null,
      role:
        sess == null
          ? 'offline'
          : sess.kind === 'host'
            ? 'host'
            : `power:${sess.powerId}`,
      onlineServerVersion: lastServerVersionRef.current,
      eventCount: onlineDebugLogRef.current.length,
      events: onlineDebugLogRef.current,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeRoomId = sess?.roomId ?? 'offline';
    a.href = url;
    a.download = `diplomacy-online-debug-${safeRoomId}-${Date.now()}.json`;
    a.click();
    window.URL.revokeObjectURL(url);
  }, []);

  const prependLogLine = useCallback((line: string) => {
    setLog((prev) => {
      const id = nextLogIdRef.current;
      nextLogIdRef.current += 1;
      return [{ id, line }, ...prev];
    });
  }, []);

  useEffect(() => {
    return () => {
      for (const t of revealTimersRef.current) {
        window.clearTimeout(t);
      }
    };
  }, []);

  useEffect(() => {
    const el = logListRef.current;
    if (el) {
      el.scrollTop = 0;
    }
  }, [log]);

  /**
   * 永続化スナップショットを React 状態に一括反映する。
   *
   * @param raw - v:1 スナップショット
   */
  const applyPersistedSnapshot = useCallback((raw: PersistedSnapshot) => {
    const merged = normalizeLoadedSnapshot(raw);
    setBoard(merged.board);
    setUnitOrders(merged.unitOrders);
    setLog(merged.log);
    setTurnHistory([]);
    nextLogIdRef.current = merged.nextLogId;
    setIsBuildPhase(merged.isBuildPhase);
    setBuildPlan(merged.buildPlan);
    setIsDisbandPhase(merged.isDisbandPhase);
    setDisbandPlan(merged.disbandPlan);
    setIsRetreatPhase(merged.isRetreatPhase);
    setRetreatTargets(merged.retreatTargets);
    setPendingRetreats(merged.pendingRetreats);
    setPowerOrderSaved(merged.powerOrderSaved);
    setPowerAdjustmentSaved(merged.powerAdjustmentSaved);
    setPowerRetreatSaved(merged.powerRetreatSaved);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      /* 移行・プライベートモード */
    }
  }, []);

  const isOrderLocked =
    isBuildPhase || isDisbandPhase || isRetreatPhase || isResolutionRevealing;

  const isAdjustmentPhasePanel =
    (isBuildPhase || isDisbandPhase) && board.turn.season === Season.Fall;

  const orderAdjKeys = useMemo(() => buildAdjacencyKeySet(board), [board]);

  const updateOrder = useCallback(
    (unitId: string, patch: Partial<UnitOrderInput>) => {
      if (onlineSessionRef.current != null) {
        appendOnlineDebugLog(
          'order_patch',
          `${unitId}:${Object.keys(patch).join(',')}`,
        );
      }
      setUnitOrders((prev) => ({
        ...prev,
        [unitId]: { ...prev[unitId], ...patch },
      }));
    },
    [appendOnlineDebugLog],
  );

  const changeOrderType = useCallback((unitId: string, newType: OrderType) => {
    if (onlineSessionRef.current != null) {
      appendOnlineDebugLog('order_type_change', `${unitId}:${newType}`);
    }
    setUnitOrders((prev) => ({
      ...prev,
      [unitId]: { ...emptyOrder(), type: newType },
    }));
  }, [appendOnlineDebugLog]);

  const resetAllOrders = useCallback(() => {
    setUnitOrders(buildDefaultOrders(board));
  }, [board]);

  const buildDomainOrders = useCallback((): Order[] => {
    return buildDomainOrdersFromInputs(board, unitOrders);
  }, [board, unitOrders]);

  const allPowersMovementReady = useMemo(
    () =>
      POWER_ORDER.every((pid) => {
        if (!powerHasUnits(board, pid)) {
          return true;
        }
        return (
          powerOrderSaved[pid] === true &&
          isPowerOrdersComplete(board, unitOrders, pid)
        );
      }),
    [board, unitOrders, powerOrderSaved],
  );

  const allPowersAdjustmentReady = useMemo(
    () =>
      POWER_ORDER.every((pid) => {
        if (!powerNeedsAdjustment(board, pid)) {
          return true;
        }
        return (
          powerAdjustmentSaved[pid] === true &&
          isPowerAdjustmentSlotsFilled(
            board,
            pid,
            disbandPlan,
            buildPlan,
          )
        );
      }),
    [board, disbandPlan, buildPlan, powerAdjustmentSaved],
  );

  const retreatPowerIds = useMemo(() => {
    const s = new Set<string>();
    for (const d of pendingRetreats) {
      s.add(d.unit.powerId);
    }
    return s;
  }, [pendingRetreats]);

  const allPowersRetreatReady = useMemo(() => {
    if (pendingRetreats.length === 0) {
      return true;
    }
    for (const pid of retreatPowerIds) {
      if (powerRetreatSaved[pid] !== true) {
        return false;
      }
    }
    return true;
  }, [pendingRetreats.length, retreatPowerIds, powerRetreatSaved]);

  const markPowerOrderSaved = useCallback((powerId: string) => {
    setPowerOrderSaved((prev) => ({ ...prev, [powerId]: true }));
    const sess = onlineSessionRef.current;
    if (sess?.kind === 'power' && sess.powerId === powerId) {
      powerSubmitRequestedRef.current = true;
    }
  }, []);

  const markPowerAdjustmentSaved = useCallback((powerId: string) => {
    setPowerAdjustmentSaved((prev) => ({ ...prev, [powerId]: true }));
    const sess = onlineSessionRef.current;
    if (sess?.kind === 'power' && sess.powerId === powerId) {
      powerSubmitRequestedRef.current = true;
    }
  }, []);

  const markPowerRetreatSaved = useCallback((powerId: string) => {
    setPowerRetreatSaved((prev) => ({ ...prev, [powerId]: true }));
    const sess = onlineSessionRef.current;
    if (sess?.kind === 'power' && sess.powerId === powerId) {
      powerSubmitRequestedRef.current = true;
    }
  }, []);

  const scheduleAppAutoSave = useCallback(() => {
    pendingAppAutoSaveRef.current = true;
  }, []);

  const reportUnexpectedTitleNavigation = useCallback(
    (reason: string) => {
      appendOnlineDebugLog('unexpected_title_navigation', reason);
      try {
        console.warn(`[unexpected_title_navigation] ${reason}`);
      } catch {
        /* noop */
      }
    },
    [appendOnlineDebugLog],
  );

  const leaveGameSession = useCallback((options?: LeaveGameSessionOptions) => {
    const intentional = options?.intentional === true;
    const reason = options?.reason ?? 'no_reason';
    appendOnlineDebugLog(
      intentional ? 'intentional_title_navigation' : 'unexpected_title_navigation',
      reason,
    );
    setGameSessionActive(false);
    setActiveWorldlineStem('');
    setOnlineSession(null);
    clearOnlineActiveSession();
    onlineHostSyncBaselineRef.current = null;
    powerSubmitRequestedRef.current = false;
    lastServerVersionRef.current = 0;
    setOnlineServerVersion(0);
  }, [appendOnlineDebugLog]);

  const buildCurrentSnapshot = useCallback((): PersistedSnapshot => {
    const base: PersistedSnapshot = {
      v: 1,
      board,
      unitOrders,
      log,
      nextLogId: nextLogIdRef.current,
      isBuildPhase,
      isDisbandPhase,
      isRetreatPhase,
      retreatTargets,
      pendingRetreats,
      buildPlan,
      disbandPlan,
      powerOrderSaved,
      powerAdjustmentSaved,
      powerRetreatSaved,
    };
    if (activeWorldlineStem.length > 0) {
      base.worldlineStem = activeWorldlineStem;
    }
    return base;
  }, [
    activeWorldlineStem,
    board,
    unitOrders,
    log,
    isBuildPhase,
    isDisbandPhase,
    isRetreatPhase,
    retreatTargets,
    pendingRetreats,
    buildPlan,
    disbandPlan,
    powerOrderSaved,
    powerAdjustmentSaved,
    powerRetreatSaved,
  ]);

  buildCurrentSnapshotRef.current = buildCurrentSnapshot;

  /**
   * 同一ステップでフル再適用を避ける場合でも、他プレイヤーの入力完了状況だけは
   * 画面へ反映して進捗を共有する。
   *
   * @param incoming - サーバー再取得スナップショット
   */
  const applyRealtimeProgressFlags = useCallback((incoming: PersistedSnapshot) => {
    setPowerOrderSaved(incoming.powerOrderSaved);
    setPowerAdjustmentSaved(incoming.powerAdjustmentSaved);
    setPowerRetreatSaved(incoming.powerRetreatSaved);
  }, []);

  const refetchOnlineSnapshot = useCallback(
    async (
      sess: OnlineSession,
      mergePowerLocalSnapshot?: PersistedSnapshot,
      /**
       * ポール検知時のみ: 同一ゲーム進行（同ターン/同フェーズ）なら
       * 画面 state の再適用をスキップして入力中 UI の巻き戻りを防ぐ。
       */
      preferLocalStateWhenSameStep?: boolean,
      /**
       * PUT/PATCH の expectedVersion 不一致（409）直後の再取得。
       * ホストはベースラインとの3-wayで未送信命令を維持する。
       */
      fromVersionConflict?: boolean,
    ) => {
      const secret =
        sess.kind === 'host' ? sess.hostSecret : sess.powerSecret;
      const url = `/api/online/rooms/${sess.roomId}/snapshot?t=${encodeURIComponent(secret)}`;
      const res = await fetch(url);
      if (!res.ok) {
        appendOnlineDebugLog('refetch_snapshot_ng', `HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as {
        version: number;
        snapshotJson: string;
      };
      const p = tryParsePersistedSnapshotJson(data.snapshotJson);
      if (p == null) {
        appendOnlineDebugLog('refetch_snapshot_invalid_json');
        return;
      }
      const incomingSnap = normalizeLoadedSnapshot(p);
      const localNow = buildCurrentSnapshotRef.current();
      if (
        preferLocalStateWhenSameStep &&
        sameOnlineGameStepForMerge(incomingSnap, localNow)
      ) {
        applyRealtimeProgressFlags(incomingSnap);
        lastServerVersionRef.current = data.version;
        setOnlineServerVersion(data.version);
        appendOnlineDebugLog(
          sess.kind === 'host'
            ? 'refetch_snapshot_skip_same_step_host'
            : 'refetch_snapshot_skip_same_step_power',
          undefined,
          data.version,
        );
        return;
      }
      let toApply = incomingSnap;
      if (
        fromVersionConflict === true &&
        sameOnlineGameStepForMerge(incomingSnap, localNow) &&
        sess.kind === 'host' &&
        onlineHostSyncBaselineRef.current != null
      ) {
        toApply = mergeHostPersistedSnapshotThreeWay(
          incomingSnap,
          localNow,
          onlineHostSyncBaselineRef.current,
        );
        appendOnlineDebugLog(
          'refetch_snapshot_409_merge_host',
          undefined,
          data.version,
        );
      } else if (
        fromVersionConflict === true &&
        sess.kind === 'host' &&
        compareSnapshotProgress(incomingSnap, localNow) < 0
      ) {
        /**
         * 409 復旧時に、サーバー側がローカルより古いステップを返すことがある。
         * この場合はローカル進行を優先し、巻き戻し適用を行わない。
         */
        lastServerVersionRef.current = data.version;
        setOnlineServerVersion(data.version);
        appendOnlineDebugLog(
          'refetch_snapshot_409_keep_local_host_newer',
          undefined,
          data.version,
        );
        return;
      } else if (sess.kind === 'power' && mergePowerLocalSnapshot != null) {
        toApply = mergePowerSecretSnapshotFromLocal(
          incomingSnap,
          mergePowerLocalSnapshot,
          sess.powerId,
        );
        if (fromVersionConflict === true) {
          appendOnlineDebugLog(
            'refetch_snapshot_409_merge_power',
            undefined,
            data.version,
          );
        }
      }
      applyPersistedSnapshot(toApply);
      lastServerVersionRef.current = data.version;
      setOnlineServerVersion(data.version);
      if (sess.kind === 'host') {
        onlineHostSyncBaselineRef.current = incomingSnap;
      }
      appendOnlineDebugLog('refetch_snapshot_ok', undefined, data.version);
    },
    [appendOnlineDebugLog, applyPersistedSnapshot, applyRealtimeProgressFlags],
  );

  /**
   * オンライン未送信の変更を即時に送る。
   *
   * @returns 通信・409 解消を含め同期手順を完了できたら true
   */
  const flushOnlinePush = useCallback(async (): Promise<boolean> => {
    const sess = onlineSessionRef.current;
    if (sess == null || !gameSessionActive) {
      return true;
    }
    if (sess.kind === 'power' && !powerSubmitRequestedRef.current) {
      appendOnlineDebugLog('flush_power_skip_draft');
      return true;
    }
    const snap = buildCurrentSnapshotRef.current();
    const json = serializeSnapshotForStorage(snap);
    const v = lastServerVersionRef.current;
    appendOnlineDebugLog('flush_start');
    try {
      if (sess.kind === 'host') {
        const res = await fetch(`/api/online/rooms/${sess.roomId}/snapshot`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            hostSecret: sess.hostSecret,
            expectedVersion: v,
            snapshotJson: json,
          }),
        });
        if (res.status === 409) {
          appendOnlineDebugLog('flush_host_409');
          await refetchOnlineSnapshot(sess, undefined, false, true);
          /**
           * 409 復旧直後は expectedVersion を更新して 1 回だけ再送する。
           * 古い snapshot 適用を回避した場合でも、ローカル最新状態を確実に押し込む。
           */
          const retrySnap = buildCurrentSnapshotRef.current();
          const retryRes = await fetch(`/api/online/rooms/${sess.roomId}/snapshot`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              hostSecret: sess.hostSecret,
              expectedVersion: lastServerVersionRef.current,
              snapshotJson: serializeSnapshotForStorage(retrySnap),
            }),
          });
          if (retryRes.status === 409) {
            appendOnlineDebugLog('flush_host_409_retry_conflict');
            return true;
          }
          if (!retryRes.ok) {
            appendOnlineDebugLog('flush_host_retry_ng', `HTTP ${retryRes.status}`);
            return false;
          }
          const retryData = (await retryRes.json()) as { version: number };
          lastServerVersionRef.current = retryData.version;
          setOnlineServerVersion(retryData.version);
          onlineHostSyncBaselineRef.current = retrySnap;
          appendOnlineDebugLog('flush_host_retry_ok', undefined, retryData.version);
          return true;
        }
        if (!res.ok) {
          appendOnlineDebugLog('flush_host_ng', `HTTP ${res.status}`);
          return false;
        }
        const data = (await res.json()) as { version: number };
        lastServerVersionRef.current = data.version;
        setOnlineServerVersion(data.version);
        onlineHostSyncBaselineRef.current = snap;
        appendOnlineDebugLog('flush_host_ok', undefined, data.version);
        return true;
      }
      const base = buildPowerOnlinePatchPayload(sess.powerId, snap);
      const res = await fetch(`/api/online/rooms/${sess.roomId}/power`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...base,
          powerSecret: sess.powerSecret,
          expectedVersion: v,
        }),
      });
      if (res.status === 409) {
        appendOnlineDebugLog('flush_power_409');
        await refetchOnlineSnapshot(
          sess,
          buildCurrentSnapshotRef.current(),
          false,
          true,
        );
        powerSubmitRequestedRef.current = false;
        return true;
      }
      if (!res.ok) {
        appendOnlineDebugLog('flush_power_ng', `HTTP ${res.status}`);
        return false;
      }
      const data = (await res.json()) as { version: number };
      lastServerVersionRef.current = data.version;
      setOnlineServerVersion(data.version);
      appendOnlineDebugLog('flush_power_ok', undefined, data.version);
      powerSubmitRequestedRef.current = false;
      return true;
    } catch {
      /* ネットワーク断 */
      appendOnlineDebugLog('flush_network_error');
      return false;
    }
  }, [appendOnlineDebugLog, gameSessionActive, refetchOnlineSnapshot]);

  const startNewOnlineGame = useCallback(
    async (worldlineNameRaw: string): Promise<StartOnlineGameResult> => {
      const stem = sanitizeWorldlineStem(worldlineNameRaw) ?? 'diplomacy';
      const snap = createDefaultPersistedSnapshot();
      snap.worldlineStem = stem;
      let res: Response;
      try {
        res = await fetch('/api/online/rooms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            snapshotJson: serializeSnapshotForStorage(snap),
            worldlineStem: stem,
          }),
        });
      } catch {
        return { ok: false, error: '通信に失敗しました' };
      }
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const j = (await res.json()) as { error?: string };
          if (j.error) {
            msg = j.error;
          }
        } catch {
          /* ignore */
        }
        return { ok: false, error: msg };
      }
      const data = (await res.json()) as {
        roomId: string;
        hostSecret: string;
        powerSecrets: Record<string, string>;
        version: number;
        snapshotJson: string;
      };
      const loaded = tryParsePersistedSnapshotJson(data.snapshotJson);
      if (loaded == null) {
        return { ok: false, error: 'サーバー応答が不正です' };
      }
      for (const t of revealTimersRef.current) {
        window.clearTimeout(t);
      }
      revealTimersRef.current = [];
      revealGenRef.current += 1;
      pendingMapEffectsRef.current = [];
      setIsResolutionRevealing(false);
      isResolutionRevealingRef.current = false;
      const normHost = normalizeLoadedSnapshot(loaded);
      applyPersistedSnapshot(normHost);
      setActiveWorldlineStem(stem);
      setGameSessionActive(true);
      setOnlineSession({
        kind: 'host',
        roomId: data.roomId,
        hostSecret: data.hostSecret,
      });
      lastServerVersionRef.current = data.version;
      setOnlineServerVersion(data.version);
      onlineHostSyncBaselineRef.current = normHost;
      pendingAppAutoSaveRef.current = false;
      appendOnlineDebugLog('online_room_created', undefined, data.version);
      storeOnlinePowerSecrets(data.roomId, data.powerSecrets);
      storeOnlineHostSecret(data.roomId, data.hostSecret);
      storeOnlineActiveSession(data.roomId, data.hostSecret);
      return {
        ok: true,
        roomId: data.roomId,
        hostSecret: data.hostSecret,
        powerSecrets: data.powerSecrets,
      };
    },
    [appendOnlineDebugLog, applyPersistedSnapshot],
  );

  const joinOnlineGame = useCallback(
    async (params: JoinOnlineGameParams): Promise<JoinOnlineGameResult> => {
      let token: string;
      if ('token' in params) {
        token = params.token.trim();
      } else if ('hostSecret' in params) {
        token = params.hostSecret.trim();
      } else {
        token = params.powerSecret.trim();
      }
      if (token.length === 0) {
        return { ok: false, error: '認証情報が不足しています' };
      }
      const url = `/api/online/rooms/${params.roomId}/snapshot?t=${encodeURIComponent(token)}`;
      let res: Response;
      try {
        res = await fetch(url);
      } catch {
        return { ok: false, error: '通信に失敗しました' };
      }
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const j = (await res.json()) as { error?: string };
          if (j.error) {
            msg = j.error;
          }
        } catch {
          /* ignore */
        }
        return { ok: false, error: msg };
      }
      const data = (await res.json()) as {
        version: number;
        snapshotJson: string;
        onlineAuth?: { role: 'host' } | { role: 'power'; powerId: string };
      };
      const auth = data.onlineAuth;
      if (auth == null) {
        return {
          ok: false,
          error: 'サーバー応答に onlineAuth がありません',
        };
      }
      if ('hostSecret' in params) {
        if (auth.role !== 'host') {
          return { ok: false, error: 'ホスト用シークレットではありません' };
        }
      } else if ('powerId' in params && 'powerSecret' in params) {
        if (auth.role !== 'power' || auth.powerId !== params.powerId) {
          return { ok: false, error: '国または各国用シークレットが一致しません' };
        }
      } else if ('token' in params && params.expectedPowerId != null) {
        if (
          auth.role !== 'power' ||
          auth.powerId !== params.expectedPowerId
        ) {
          return {
            ok: false,
            error: 'この勢力ページ用のシークレットではありません',
          };
        }
      }
      const loaded = tryParsePersistedSnapshotJson(data.snapshotJson);
      if (loaded == null) {
        return { ok: false, error: 'スナップショットが不正です' };
      }
      for (const t of revealTimersRef.current) {
        window.clearTimeout(t);
      }
      revealTimersRef.current = [];
      revealGenRef.current += 1;
      pendingMapEffectsRef.current = [];
      setIsResolutionRevealing(false);
      isResolutionRevealingRef.current = false;
      const normJoin = normalizeLoadedSnapshot(loaded);
      applyPersistedSnapshot(normJoin);
      const stem =
        loaded.worldlineStem != null && loaded.worldlineStem.length > 0
          ? loaded.worldlineStem
          : 'online';
      setActiveWorldlineStem(stem);
      setGameSessionActive(true);
      if (auth.role === 'host') {
        onlineHostSyncBaselineRef.current = normJoin;
        storeOnlineHostSecret(params.roomId, token);
        storeOnlineActiveSession(params.roomId, token);
        setOnlineSession({
          kind: 'host',
          roomId: params.roomId,
          hostSecret: token,
        });
      } else {
        onlineHostSyncBaselineRef.current = null;
        storeOnlineActiveSession(params.roomId, token);
        setOnlineSession({
          kind: 'power',
          roomId: params.roomId,
          powerId: auth.powerId,
          powerSecret: token,
        });
      }
      lastServerVersionRef.current = data.version;
      setOnlineServerVersion(data.version);
      pendingAppAutoSaveRef.current = false;
      appendOnlineDebugLog('online_join_ok', undefined, data.version);
      return { ok: true };
    },
    [appendOnlineDebugLog, applyPersistedSnapshot],
  );

  const startNewGame = useCallback(
    (worldlineNameRaw: string) => {
      const stem = sanitizeWorldlineStem(worldlineNameRaw) ?? 'diplomacy';
      for (const t of revealTimersRef.current) {
        window.clearTimeout(t);
      }
      revealTimersRef.current = [];
      revealGenRef.current += 1;
      pendingMapEffectsRef.current = [];
      setIsResolutionRevealing(false);
      isResolutionRevealingRef.current = false;
      setOnlineSession(null);
      clearOnlineActiveSession();
      onlineHostSyncBaselineRef.current = null;
      powerSubmitRequestedRef.current = false;
      lastServerVersionRef.current = 0;
      setOnlineServerVersion(0);
      const fresh = createDefaultPersistedSnapshot();
      applyPersistedSnapshot(fresh);
      setActiveWorldlineStem(stem);
      setGameSessionActive(true);
      pendingAppAutoSaveRef.current = false;
      const snap: PersistedSnapshot = { ...fresh, worldlineStem: stem };
      void writeWorldlineSave(stem, serializeSnapshotForStorage(snap));
    },
    [applyPersistedSnapshot],
  );

  const importSaveFromJsonText = useCallback(
    (jsonText: string, sourceFileName?: string): boolean => {
      try {
        const p = JSON.parse(jsonText) as PersistedSnapshot;
        if (p.v !== 1 || !p.board) {
          return false;
        }
        const fromJson =
          p.worldlineStem != null && String(p.worldlineStem).length > 0
            ? sanitizeWorldlineStem(String(p.worldlineStem))
            : null;
        const stem =
          fromJson ??
          (sourceFileName != null && sourceFileName.length > 0
            ? stemFromImportedFileName(sourceFileName)
            : 'diplomacy-import');
        const mergedBase = normalizeLoadedSnapshot(p);
        const merged: PersistedSnapshot = { ...mergedBase, worldlineStem: stem };
        setOnlineSession(null);
        clearOnlineActiveSession();
        onlineHostSyncBaselineRef.current = null;
        powerSubmitRequestedRef.current = false;
        lastServerVersionRef.current = 0;
        setOnlineServerVersion(0);
        setActiveWorldlineStem(stem);
        applyPersistedSnapshot(merged);
        setGameSessionActive(true);
        pendingAppAutoSaveRef.current = false;
        void writeWorldlineSave(stem, serializeSnapshotForStorage(merged));
        return true;
      } catch {
        return false;
      }
    },
    [applyPersistedSnapshot],
  );

  const loadSaveFromAppStorageByStem = useCallback(
    async (worldlineStem: string): Promise<boolean> => {
      if (worldlineStem.length === 0) {
        return false;
      }
      const raw = await readWorldlineSave(worldlineStem);
      if (raw == null || raw.length === 0) {
        return false;
      }
      return importSaveFromJsonText(raw, `${worldlineStem}.json`);
    },
    [importSaveFromJsonText],
  );

  useEffect(() => {
    if (
      !gameSessionActive ||
      activeWorldlineStem.length === 0 ||
      !pendingAppAutoSaveRef.current
    ) {
      return;
    }
    if (onlineSession != null) {
      return;
    }
    pendingAppAutoSaveRef.current = false;
    try {
      const json = serializeSnapshotForStorage(buildCurrentSnapshot());
      void writeWorldlineSave(activeWorldlineStem, json);
    } catch {
      /* 循環参照等 */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- buildCurrentSnapshot は board 等で網羅
  }, [
    gameSessionActive,
    activeWorldlineStem,
    onlineSession,
    board,
    unitOrders,
    log,
    isBuildPhase,
    isDisbandPhase,
    isRetreatPhase,
    retreatTargets,
    pendingRetreats,
    buildPlan,
    disbandPlan,
    powerOrderSaved,
    powerAdjustmentSaved,
    powerRetreatSaved,
  ]);

  useEffect(() => {
    if (!gameSessionActive || onlineSession == null) {
      return;
    }
    /**
     * ホストの解決演出中は中間盤面をサーバーへ送らない。
     * 各クライアントはホスト確定後の単一スナップショットだけを反映する。
     */
    if (onlineSession.kind === 'host' && isResolutionRevealing) {
      if (onlinePushTimerRef.current != null) {
        window.clearTimeout(onlinePushTimerRef.current);
        onlinePushTimerRef.current = null;
      }
      return;
    }
    if (onlineSession.kind === 'power') {
      if (onlinePushTimerRef.current != null) {
        window.clearTimeout(onlinePushTimerRef.current);
        onlinePushTimerRef.current = null;
      }
      return;
    }
    if (onlinePushTimerRef.current != null) {
      window.clearTimeout(onlinePushTimerRef.current);
    }
    onlinePushTimerRef.current = window.setTimeout(() => {
      onlinePushTimerRef.current = null;
      void flushOnlinePush();
    }, 650);
    return () => {
      if (onlinePushTimerRef.current != null) {
        window.clearTimeout(onlinePushTimerRef.current);
      }
    };
  }, [
    gameSessionActive,
    onlineSession,
    board,
    unitOrders,
    log,
    isBuildPhase,
    isDisbandPhase,
    isRetreatPhase,
    retreatTargets,
    pendingRetreats,
    buildPlan,
    disbandPlan,
    powerOrderSaved,
    powerAdjustmentSaved,
    powerRetreatSaved,
    isResolutionRevealing,
    flushOnlinePush,
  ]);

  /**
   * power 参加者は「命令送信」押下時のみ送る。
   * 下書き編集のたびには送らないため、送信要求フラグが立ったときだけ flush する。
   */
  useEffect(() => {
    if (!gameSessionActive || onlineSession?.kind !== 'power') {
      return;
    }
    if (!powerSubmitRequestedRef.current) {
      return;
    }
    const id = window.setTimeout(() => {
      void flushOnlinePush();
    }, 0);
    return () => window.clearTimeout(id);
  }, [
    gameSessionActive,
    onlineSession,
    powerOrderSaved,
    powerAdjustmentSaved,
    powerRetreatSaved,
    flushOnlinePush,
  ]);

  useEffect(() => {
    if (!gameSessionActive || onlineSession == null) {
      return;
    }
    const id = window.setInterval(() => {
      const sess = onlineSessionRef.current;
      if (sess == null) {
        return;
      }
      void (async () => {
        if (isResolutionRevealingRef.current) {
          return;
        }
        const pollSecret =
          sess.kind === 'host' ? sess.hostSecret : sess.powerSecret;
        const pollUrl = `/api/online/rooms/${sess.roomId}/snapshot?t=${encodeURIComponent(pollSecret)}`;
        let pollRes: Response;
        try {
          pollRes = await fetch(pollUrl);
        } catch {
          return;
        }
        if (!pollRes.ok) {
          return;
        }
        const pollData = (await pollRes.json()) as {
          version: number;
          snapshotJson: string;
        };
        if (pollData.version <= lastServerVersionRef.current) {
          return;
        }
        appendOnlineDebugLog('poll_detect_newer', undefined, pollData.version);
        const sessNow = onlineSessionRef.current;
        if (sessNow == null) {
          return;
        }
        /**
         * ポール応答の JSON はデバウンス PATCH より古いことがある。
         * タイマーを切って即 flush し、GET で再取得する。
         * flush が失敗したがデバウンス待ちだった場合は自国分だけローカルをマージする。
         */
        const localSnapForMerge =
          sessNow.kind === 'power'
            ? buildCurrentSnapshotRef.current()
            : null;
        const hadPendingDebounce = onlinePushTimerRef.current != null;
        if (onlinePushTimerRef.current != null) {
          window.clearTimeout(onlinePushTimerRef.current);
          onlinePushTimerRef.current = null;
        }
        const flushOk = await flushOnlinePush();
        const mergeOverlay =
          sessNow.kind === 'power' &&
          localSnapForMerge != null &&
          hadPendingDebounce &&
          !flushOk
            ? localSnapForMerge
            : undefined;
        await refetchOnlineSnapshot(
          sessNow,
          mergeOverlay,
          true,
        );
      })();
    }, 4000);
    return () => window.clearInterval(id);
  }, [
    appendOnlineDebugLog,
    gameSessionActive,
    onlineSession,
    flushOnlinePush,
    refetchOnlineSnapshot,
  ]);

  const handleAdjudicate = useCallback(() => {
    if (isOrderLocked) {
      return;
    }
    if (!allPowersMovementReady) {
      return;
    }

    const currentTurn = board.turn;
    appendOnlineDebugLog(
      'adjudicate_start',
      `${currentTurn.year}-${currentTurn.season}`,
    );
    const isFallTurn = currentTurn.season === Season.Fall;
    const labelBoard = board;
    const domainOrders = buildDomainOrders();
    const result = adjudicateTurn(board, domainOrders);
    const resolvedTurn = turnLabel(labelBoard);
    setTurnHistory((prev) => [
      {
        id: `${currentTurn.year}-${currentTurn.season}-${prev.length}`,
        turnLabel: resolvedTurn,
        board: {
          ...labelBoard,
          units: labelBoard.units.map((u) => ({ ...u })),
        },
        unitOrders: buildUnitOrderInputsFromDomainOrders(labelBoard, domainOrders),
        supportCountByUnitId: supportCountBySupportedUnitIdFromOrders(domainOrders),
      },
      ...prev,
    ]);
    const nextBoardState: BoardState = {
      ...result.nextBoardState,
      turn: currentTurn,
    };

    for (const t of revealTimersRef.current) {
      window.clearTimeout(t);
    }
    revealTimersRef.current = [];
    revealGenRef.current += 1;
    const runGen = revealGenRef.current;
    pendingMapEffectsRef.current = [];

    isResolutionRevealingRef.current = true;
    setIsResolutionRevealing(true);
    setIsBuildPhase(false);
    setIsDisbandPhase(false);
    setBuildPlan({});
    setDisbandPlan({});
    prependLogLine(`── ${resolvedTurn} ターン解決 ──`);

    const emptyFlags = emptyPowerBoolMap(POWERS);

    const finishReveal = () => {
      appendOnlineDebugLog(
        'adjudicate_finish',
        `${currentTurn.year}-${currentTurn.season}`,
      );
      isResolutionRevealingRef.current = false;
      setIsResolutionRevealing(false);
      setPowerOrderSaved({ ...emptyFlags });

      if (result.dislodgedUnits.length > 0) {
        setBoard(nextBoardState);
        setUnitOrders(buildDefaultOrders(nextBoardState));
        setPendingRetreats(result.dislodgedUnits);
        setRetreatTargets({});
        setPowerRetreatSaved({ ...emptyFlags });
        setIsRetreatPhase(true);
        scheduleAppAutoSave();
        return;
      }

      /**
       * 春→秋などは「解決直後」と「季進行後」で setBoard を分けない。
       * 同一ティック内の二重 setBoard が環境によっては最後の更新だけ反映されず
       * 季が進まないように見えるのを避ける。
       */
      if (!isFallTurn) {
        const advancedBoard: BoardState = {
          ...nextBoardState,
          turn: nextTurn(currentTurn),
        };
        setBoard(advancedBoard);
        setUnitOrders(buildDefaultOrders(advancedBoard));
        scheduleAppAutoSave();
        return;
      }

      const hasDisband = POWER_ORDER.some(
        (pid) => disbandNeed(nextBoardState, pid) > 0,
      );
      const hasBuild = POWER_ORDER.some(
        (pid) => buildCapacity(nextBoardState, pid) > 0,
      );
      if (!hasDisband && !hasBuild) {
        const advancedBoard: BoardState = {
          ...nextBoardState,
          turn: nextTurn(currentTurn),
        };
        setBoard(advancedBoard);
        setUnitOrders(buildDefaultOrders(advancedBoard));
        scheduleAppAutoSave();
        return;
      }
      setBoard(nextBoardState);
      setUnitOrders(buildDefaultOrders(nextBoardState));
      setPowerAdjustmentSaved({ ...emptyFlags });
      setIsDisbandPhase(hasDisband);
      setIsBuildPhase(hasBuild);
      scheduleAppAutoSave();
    };

    const timeline = buildResolutionRevealTimeline(
      labelBoard,
      domainOrders,
      result,
      POWER_ORDER,
    );
    if (timeline.length === 0) {
      finishReveal();
      return;
    }

    const flatResolutions = timeline
      .filter(
        (s): s is Extract<RevealTimelineStep, { kind: 'resolution' }> =>
          s.kind === 'resolution',
      )
      .map((s) => s.r);

    let workingUnits = labelBoard.units.map((u) => ({ ...u }));

    timeline.forEach((step, i) => {
      const delayMs = RESOLUTION_REVEAL_MS * (i + 1);
      const tid = window.setTimeout(() => {
        if (revealGenRef.current !== runGen) {
          return;
        }

        if (step.kind === 'tentativeSupportCut') {
          pendingMapEffectsRef.current = [
            {
              id: `tc-${runGen}-${i}-${step.sup.unitId}`,
              type: 'supportLink',
              supporterUnitId: step.sup.unitId,
              supportedUnitId: step.sup.supportedUnitId,
              durationMs: 999999,
              tentative: true,
            },
          ];
          setBoard({
            ...labelBoard,
            turn: currentTurn,
            units: workingUnits,
          });
          if (i === timeline.length - 1) {
            finishReveal();
          }
          return;
        }
        if (step.kind === 'tentativeConvoyDisrupt') {
          pendingMapEffectsRef.current = [
            {
              id: `tcd-${runGen}-${i}-${step.convoyUnitId}`,
              type: 'convoyPathLink',
              convoyUnitId: step.convoyUnitId,
              pathProvinceIds: step.pathProvinceIds,
              tentative: true,
            },
          ];
          setBoard({
            ...labelBoard,
            turn: currentTurn,
            units: workingUnits,
          });
          if (i === timeline.length - 1) {
            finishReveal();
          }
          return;
        }

        const r = step.r;
        workingUnits = applyResolutionRevealStep(
          workingUnits,
          r,
          result,
          nextBoardState,
        );

        const nextEffects: MapVisualEffect[] = [];
        appendMapEffectsForRevealResolution(
          nextEffects,
          step,
          r,
          labelBoard,
          domainOrders,
          flatResolutions,
          runGen,
          i,
        );
        pendingMapEffectsRef.current = nextEffects;

        setBoard({
          ...labelBoard,
          turn: currentTurn,
          units: workingUnits,
        });
        prependLogLine(formatOrderResolutionLogLine(labelBoard, r));
        if (i === timeline.length - 1) {
          finishReveal();
        }
      }, delayMs);
      revealTimersRef.current.push(tid);
    });
  }, [
    appendOnlineDebugLog,
    allPowersMovementReady,
    board,
    buildDomainOrders,
    isOrderLocked,
    prependLogLine,
    scheduleAppAutoSave,
  ]);

  const confirmRetreatPhase = useCallback(() => {
    if (!allPowersRetreatReady) {
      return;
    }
    const provinceName = (provinceId: string): string =>
      board.provinces.find((p) => p.id === provinceId)?.name ?? provinceId;
    const unitKind = (type: UnitType): string => (type === UnitType.Army ? '陸軍' : '海軍');
    const survivors: Unit[] = [...board.units];
    for (const d of pendingRetreats) {
      const target = retreatTargets[d.unit.id];
      if (!target) {
        prependLogLine(
          `${d.unit.powerId} ${provinceName(d.fromProvinceId)}の${unitKind(
            d.unit.type,
          )} を解体`,
        );
        continue;
      }
      const { provinceId, fleetCoast } = parseRetreatSelection(target);
      const retreated: Unit = { ...d.unit, provinceId };
      if (d.unit.type === UnitType.Fleet && fleetCoast != null) {
        retreated.fleetCoast = fleetCoast;
      } else if (d.unit.type === UnitType.Fleet) {
        const auto = fleetArrivalCoasts(provinceId, d.fromProvinceId);
        if (auto.length === 1) {
          retreated.fleetCoast = auto[0];
        } else {
          delete retreated.fleetCoast;
        }
      }
      survivors.push(retreated);
      prependLogLine(
        `${d.unit.powerId} ${provinceName(d.fromProvinceId)}の${unitKind(
          d.unit.type,
        )} が ${provinceName(provinceId)} に退却`,
      );
    }

    let nextBoard: BoardState = boardWithRefreshedProvinceTint({
      ...board,
      units: survivors,
    });

    const emptyFlags = emptyPowerBoolMap(POWERS);
    setIsRetreatPhase(false);
    setPendingRetreats([]);
    setRetreatTargets({});
    setPowerRetreatSaved({ ...emptyFlags });

    if (board.turn.season === Season.Spring) {
      nextBoard = {
        ...nextBoard,
        turn: nextTurn(board.turn),
      };
      setBoard(nextBoard);
      setUnitOrders(buildDefaultOrders(nextBoard));
      prependLogLine('── 退却完了 ──');
      scheduleAppAutoSave();
      return;
    }

    const hasDisband = POWER_ORDER.some((pid) => disbandNeed(nextBoard, pid) > 0);
    const hasBuild = POWER_ORDER.some((pid) => buildCapacity(nextBoard, pid) > 0);
    /**
     * 秋ターン: 調整（削減・増産）が不要なら `handleAdjudicate` の finishReveal と同様に
     * 翌年春へ進める。ここが無いと退却のみの秋のあと年が進まず留まる。
     */
    if (!hasDisband && !hasBuild) {
      const advancedBoard = boardWithRefreshedProvinceTint({
        ...nextBoard,
        turn: nextTurn(board.turn),
      });
      setBoard(advancedBoard);
      setUnitOrders(buildDefaultOrders(advancedBoard));
      setIsDisbandPhase(false);
      setIsBuildPhase(false);
      prependLogLine('── 退却完了 ──');
      scheduleAppAutoSave();
      return;
    }
    setBoard(nextBoard);
    setUnitOrders(buildDefaultOrders(nextBoard));
    setIsDisbandPhase(hasDisband);
    setIsBuildPhase(hasBuild);
    setPowerAdjustmentSaved({ ...emptyFlags });
    prependLogLine('── 退却完了 ──');
    scheduleAppAutoSave();
  }, [
    allPowersRetreatReady,
    board,
    pendingRetreats,
    retreatTargets,
    prependLogLine,
    scheduleAppAutoSave,
  ]);

  const finalizeAdjustmentPhase = useCallback(() => {
    if (!allPowersAdjustmentReady) {
      return;
    }
    const disbandReady = POWER_ORDER.every((pid) => {
      const need = disbandNeed(board, pid);
      if (need <= 0) {
        return true;
      }
      const slots = disbandPlan[pid] ?? [];
      return Array.from({ length: need }).every((_, idx) => !!slots[idx]?.unitId);
    });
    if (!disbandReady) {
      return;
    }

    const provinceName = (provinceId: string): string =>
      board.provinces.find((p) => p.id === provinceId)?.name ?? provinceId;
    const unitKind = (type: UnitType): string => (type === UnitType.Army ? '陸軍' : '海軍');
    const removeSet = new Set<string>();
    POWER_ORDER.forEach((pid) => {
      const need = disbandNeed(board, pid);
      if (need <= 0) {
        return;
      }
      const slots = disbandPlan[pid] ?? [];
      for (let i = 0; i < need; i += 1) {
        const id = slots[i]?.unitId;
        if (id) {
          removeSet.add(id);
        }
      }
    });

    const newUnits: Unit[] = board.units.filter((u) => !removeSet.has(u.id));
    for (const unit of board.units) {
      if (removeSet.has(unit.id)) {
        prependLogLine(
          `${unit.powerId} ${provinceName(unit.provinceId)}の${unitKind(unit.type)} を解体`,
        );
      }
    }
    const boardAfterDisband = { ...board, units: newUnits };
    POWER_ORDER.forEach((pid) => {
      const cap = Math.max(
        countSupplyCenters(boardAfterDisband, pid) -
          countUnits(boardAfterDisband, pid),
        0,
      );
      if (cap <= 0) {
        return;
      }
      const slots = buildPlan[pid] ?? [];
      for (let i = 0; i < cap; i += 1) {
        const slot = slots[i];
        if (!slot || !slot.provinceId) {
          continue;
        }
        if (slot.unitType === UnitType.Fleet) {
          if (!canBuildFleetAtProvince(board, slot.provinceId)) {
            continue;
          }
        }
        if (
          slot.unitType === UnitType.Fleet &&
          isSplitProvince(slot.provinceId) &&
          asFleetCoast(slot.buildFleetCoast ?? '') == null
        ) {
          continue;
        }
        const id = `${pid}-${slot.unitType === UnitType.Army ? 'A' : 'F'}-BUILD-${slot.provinceId}-${board.turn.year}-${i}`;
        const built: Unit = {
          id,
          type: slot.unitType,
          powerId: pid,
          provinceId: slot.provinceId,
        };
        const bc = asFleetCoast(slot.buildFleetCoast ?? '');
        if (
          slot.unitType === UnitType.Fleet &&
          bc != null &&
          isSplitProvince(slot.provinceId)
        ) {
          built.fleetCoast = bc;
        }
        newUnits.push(built);
        prependLogLine(
          `${pid} ${provinceName(slot.provinceId)} に${unitKind(slot.unitType)}を増産`,
        );
      }
    });

    const nextTurnInfo = {
      year: board.turn.year + 1,
      season: Season.Spring,
    };
    const nextBoard: BoardState = boardWithRefreshedProvinceTint({
      ...board,
      turn: nextTurnInfo,
      units: newUnits,
    });
    const emptyFlags = emptyPowerBoolMap(POWERS);
    setBoard(nextBoard);
    setUnitOrders(buildDefaultOrders(nextBoard));
    setIsBuildPhase(false);
    setIsDisbandPhase(false);
    setBuildPlan({});
    setDisbandPlan({});
    setPowerOrderSaved({ ...emptyFlags });
    setPowerAdjustmentSaved({ ...emptyFlags });
    prependLogLine(`── ${board.turn.year}年 秋 調整完了 ──`);
    scheduleAppAutoSave();
  }, [
    allPowersAdjustmentReady,
    board,
    buildPlan,
    disbandPlan,
    prependLogLine,
    scheduleAppAutoSave,
  ]);

  const value = useMemo<DiplomacyGameContextValue>(
    () => ({
      board,
      setBoard,
      unitOrders,
      setUnitOrders,
      log,
      setLog,
      turnHistory,
      isBuildPhase,
      setIsBuildPhase,
      buildPlan,
      setBuildPlan,
      isDisbandPhase,
      setIsDisbandPhase,
      disbandPlan,
      setDisbandPlan,
      isRetreatPhase,
      setIsRetreatPhase,
      retreatTargets,
      setRetreatTargets,
      pendingRetreats,
      setPendingRetreats,
      isResolutionRevealing,
      powerOrderSaved,
      setPowerOrderSaved,
      powerAdjustmentSaved,
      setPowerAdjustmentSaved,
      powerRetreatSaved,
      setPowerRetreatSaved,
      revealGenRef,
      revealTimersRef,
      nextLogIdRef,
      logListRef,
      pendingMapEffectsRef,
      prependLogLine,
      isOrderLocked,
      isAdjustmentPhasePanel,
      orderAdjKeys,
      updateOrder,
      changeOrderType,
      resetAllOrders,
      buildDomainOrders,
      handleAdjudicate,
      confirmRetreatPhase,
      finalizeAdjustmentPhase,
      markPowerOrderSaved,
      markPowerAdjustmentSaved,
      markPowerRetreatSaved,
      allPowersMovementReady,
      allPowersAdjustmentReady,
      allPowersRetreatReady,
      gameSessionActive,
      startNewGame,
      leaveGameSession,
      reportUnexpectedTitleNavigation,
      importSaveFromJsonText,
      loadSaveFromAppStorageByStem,
      onlineSession,
      onlineServerVersion,
      onlineDebugLogCount,
      downloadOnlineDebugLog,
      clearOnlineDebugLog,
      startNewOnlineGame,
      joinOnlineGame,
    }),
    [
      board,
      unitOrders,
      log,
      turnHistory,
      isBuildPhase,
      buildPlan,
      isDisbandPhase,
      disbandPlan,
      isRetreatPhase,
      retreatTargets,
      pendingRetreats,
      isResolutionRevealing,
      powerOrderSaved,
      powerAdjustmentSaved,
      powerRetreatSaved,
      prependLogLine,
      isOrderLocked,
      isAdjustmentPhasePanel,
      orderAdjKeys,
      updateOrder,
      changeOrderType,
      resetAllOrders,
      buildDomainOrders,
      handleAdjudicate,
      confirmRetreatPhase,
      finalizeAdjustmentPhase,
      markPowerOrderSaved,
      markPowerAdjustmentSaved,
      markPowerRetreatSaved,
      allPowersMovementReady,
      allPowersAdjustmentReady,
      allPowersRetreatReady,
      gameSessionActive,
      startNewGame,
      leaveGameSession,
      reportUnexpectedTitleNavigation,
      importSaveFromJsonText,
      loadSaveFromAppStorageByStem,
      onlineSession,
      onlineServerVersion,
      onlineDebugLogCount,
      downloadOnlineDebugLog,
      clearOnlineDebugLog,
      startNewOnlineGame,
      joinOnlineGame,
    ],
  );

  return (
    <DiplomacyGameContext.Provider value={value}>
      {props.children}
    </DiplomacyGameContext.Provider>
  );
}

/**
 * Context を利用するフック（Provider 外では例外）。
 */
export function useDiplomacyGame(): DiplomacyGameContextValue {
  const ctx = useContext(DiplomacyGameContext);
  if (!ctx) {
    throw new Error('useDiplomacyGame は DiplomacyGameProvider 内で使用してください');
  }
  return ctx;
}
