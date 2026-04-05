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
  buildCapacity,
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
  storeOnlineHostSecret,
  storeOnlinePowerSecrets,
} from '@/lib/onlineSessionBrowser';

/** 旧版 localStorage キー（起動時に削除して移行するのみ） */
const LEGACY_STORAGE_KEY = 'diplomacy-game-state-v1';

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

/**
 * オンライン参加パラメータ。
 * - `token`: 平文トークンのみ指定（GET `?t=` で onlineAuth を返す。アドレスバーには載せない）
 * - `expectedPowerId`: トークンがその国用か検証する（省略時はホストまたは任意国）
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
  leaveGameSession: () => void;
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
  const defaultSnap = useMemo(() => createDefaultPersistedSnapshot(), []);
  const [board, setBoard] = useState<BoardState>(defaultSnap.board);
  const [unitOrders, setUnitOrders] = useState<Record<string, UnitOrderInput>>(
    defaultSnap.unitOrders,
  );
  const [log, setLog] = useState<ResolveLogEntry[]>(defaultSnap.log);
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

  const revealGenRef = useRef(0);
  const revealTimersRef = useRef<number[]>([]);
  const nextLogIdRef = useRef(defaultSnap.nextLogId);
  const logListRef = useRef<HTMLUListElement | null>(null);
  const pendingMapEffectsRef = useRef<MapVisualEffect[]>([]);
  const pendingAppAutoSaveRef = useRef(false);
  const lastServerVersionRef = useRef(0);
  const onlineSessionRef = useRef<OnlineSession | null>(null);
  const onlinePushTimerRef = useRef<number | null>(null);
  const buildCurrentSnapshotRef = useRef(() => defaultSnap as PersistedSnapshot);

  useEffect(() => {
    onlineSessionRef.current = onlineSession;
  }, [onlineSession]);

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
      setUnitOrders((prev) => ({
        ...prev,
        [unitId]: { ...prev[unitId], ...patch },
      }));
    },
    [],
  );

  const changeOrderType = useCallback((unitId: string, newType: OrderType) => {
    setUnitOrders((prev) => ({
      ...prev,
      [unitId]: { ...emptyOrder(), type: newType },
    }));
  }, []);

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
  }, []);

  const markPowerAdjustmentSaved = useCallback((powerId: string) => {
    setPowerAdjustmentSaved((prev) => ({ ...prev, [powerId]: true }));
  }, []);

  const markPowerRetreatSaved = useCallback((powerId: string) => {
    setPowerRetreatSaved((prev) => ({ ...prev, [powerId]: true }));
  }, []);

  const scheduleAppAutoSave = useCallback(() => {
    pendingAppAutoSaveRef.current = true;
  }, []);

  const leaveGameSession = useCallback(() => {
    setGameSessionActive(false);
    setActiveWorldlineStem('');
    setOnlineSession(null);
    lastServerVersionRef.current = 0;
    setOnlineServerVersion(0);
  }, []);

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

  const refetchOnlineSnapshot = useCallback(
    async (sess: OnlineSession) => {
      const secret =
        sess.kind === 'host' ? sess.hostSecret : sess.powerSecret;
      const url = `/api/online/rooms/${sess.roomId}/snapshot?t=${encodeURIComponent(secret)}`;
      const res = await fetch(url);
      if (!res.ok) {
        return;
      }
      const data = (await res.json()) as {
        version: number;
        snapshotJson: string;
      };
      const p = tryParsePersistedSnapshotJson(data.snapshotJson);
      if (p == null) {
        return;
      }
      applyPersistedSnapshot(normalizeLoadedSnapshot(p));
      lastServerVersionRef.current = data.version;
      setOnlineServerVersion(data.version);
    },
    [applyPersistedSnapshot],
  );

  const flushOnlinePush = useCallback(async () => {
    const sess = onlineSessionRef.current;
    if (sess == null || !gameSessionActive) {
      return;
    }
    const snap = buildCurrentSnapshotRef.current();
    const json = serializeSnapshotForStorage(snap);
    const v = lastServerVersionRef.current;
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
          await refetchOnlineSnapshot(sess);
          return;
        }
        if (!res.ok) {
          return;
        }
        const data = (await res.json()) as { version: number };
        lastServerVersionRef.current = data.version;
        setOnlineServerVersion(data.version);
        return;
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
        await refetchOnlineSnapshot(sess);
        return;
      }
      if (!res.ok) {
        return;
      }
      const data = (await res.json()) as { version: number };
      lastServerVersionRef.current = data.version;
      setOnlineServerVersion(data.version);
    } catch {
      /* ネットワーク断 */
    }
  }, [gameSessionActive, refetchOnlineSnapshot]);

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
      applyPersistedSnapshot(normalizeLoadedSnapshot(loaded));
      setActiveWorldlineStem(stem);
      setGameSessionActive(true);
      setOnlineSession({
        kind: 'host',
        roomId: data.roomId,
        hostSecret: data.hostSecret,
      });
      lastServerVersionRef.current = data.version;
      setOnlineServerVersion(data.version);
      pendingAppAutoSaveRef.current = false;
      storeOnlinePowerSecrets(data.roomId, data.powerSecrets);
      storeOnlineHostSecret(data.roomId, data.hostSecret);
      return {
        ok: true,
        roomId: data.roomId,
        hostSecret: data.hostSecret,
        powerSecrets: data.powerSecrets,
      };
    },
    [applyPersistedSnapshot],
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
      applyPersistedSnapshot(normalizeLoadedSnapshot(loaded));
      const stem =
        loaded.worldlineStem != null && loaded.worldlineStem.length > 0
          ? loaded.worldlineStem
          : 'online';
      setActiveWorldlineStem(stem);
      setGameSessionActive(true);
      if (auth.role === 'host') {
        storeOnlineHostSecret(params.roomId, token);
        setOnlineSession({
          kind: 'host',
          roomId: params.roomId,
          hostSecret: token,
        });
      } else {
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
      return { ok: true };
    },
    [applyPersistedSnapshot],
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
      setOnlineSession(null);
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
        const parsedPoll = tryParsePersistedSnapshotJson(pollData.snapshotJson);
        if (parsedPoll == null) {
          return;
        }
        applyPersistedSnapshot(normalizeLoadedSnapshot(parsedPoll));
        lastServerVersionRef.current = pollData.version;
        setOnlineServerVersion(pollData.version);
      })();
    }, 4000);
    return () => window.clearInterval(id);
  }, [gameSessionActive, onlineSession, applyPersistedSnapshot]);

  const handleAdjudicate = useCallback(() => {
    if (isOrderLocked) {
      return;
    }
    if (!allPowersMovementReady) {
      return;
    }

    const currentTurn = board.turn;
    const isFallTurn = currentTurn.season === Season.Fall;
    const labelBoard = board;
    const domainOrders = buildDomainOrders();
    const result = adjudicateTurn(board, domainOrders);
    const resolvedTurn = turnLabel(labelBoard);
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

    setIsResolutionRevealing(true);
    setIsBuildPhase(false);
    setIsDisbandPhase(false);
    setBuildPlan({});
    setDisbandPlan({});
    prependLogLine(`── ${resolvedTurn} ターン解決 ──`);

    const emptyFlags = emptyPowerBoolMap(POWERS);

    const finishReveal = () => {
      setBoard(nextBoardState);
      setUnitOrders(buildDefaultOrders(nextBoardState));
      setIsResolutionRevealing(false);
      setPowerOrderSaved({ ...emptyFlags });

      if (result.dislodgedUnits.length > 0) {
        setPendingRetreats(result.dislodgedUnits);
        setRetreatTargets({});
        setPowerRetreatSaved({ ...emptyFlags });
        setIsRetreatPhase(true);
        scheduleAppAutoSave();
        return;
      }

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
    const survivors: Unit[] = [...board.units];
    for (const d of pendingRetreats) {
      const target = retreatTargets[d.unit.id];
      if (!target) {
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
    setBoard(nextBoard);
    setUnitOrders(buildDefaultOrders(nextBoard));
    setIsDisbandPhase(hasDisband);
    setIsBuildPhase(hasBuild);
    if (hasDisband || hasBuild) {
      setPowerAdjustmentSaved({ ...emptyFlags });
    }
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
          const province = board.provinces.find((p) => p.id === slot.provinceId);
          if (!province || province.areaType === AreaType.Land) {
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
      importSaveFromJsonText,
      loadSaveFromAppStorageByStem,
      onlineSession,
      onlineServerVersion,
      startNewOnlineGame,
      joinOnlineGame,
    }),
    [
      board,
      unitOrders,
      log,
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
      importSaveFromJsonText,
      loadSaveFromAppStorageByStem,
      onlineSession,
      onlineServerVersion,
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
