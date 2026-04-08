/**
 * 条約システムの型定義と共通ロジック
 *
 * 概要:
 *   勢力間の条約作成・批准・期限・違反通知・地図描画素材を扱う。
 *
 * 主な機能:
 *   - 条約種別の定義
 *   - 批准済み条約の可視化データ生成
 *   - 最低限の違反検知（不可侵・勢力圏）
 *
 * 想定される制限事項:
 *   - 違反判定は一部種別（明示的に禁止しやすい条項）に限定する。
 */

import { OrderType, Season, type BoardState } from '@/domain';
import type { UnitOrderInput } from '@/diplomacy/gameHelpers';
import { POWER_COLORS } from '@/mapViewConstants';

/** 条約条項の種類 */
export type TreatyClauseKind =
  | 'mutualNonAggression'
  | 'mutualStandoff'
  | 'alliance'
  | 'surrender'
  | 'sphere'
  | 'routeSecure'
  | 'moveSupport'
  | 'convoySupport'
  | 'holdSupport'
  | 'exchangeRetreat'
  | 'intelShare'
  | 'disinformation';

/** 条約カードに表示する条項名 */
export const TREATY_CLAUSE_LABEL: Record<TreatyClauseKind, string> = {
  mutualNonAggression: '相互不可侵',
  mutualStandoff: '相互スタンドオフ',
  alliance: '同盟合意',
  surrender: '降伏',
  sphere: '勢力圏合意',
  routeSecure: '進路確保',
  moveSupport: '移動支援',
  convoySupport: '輸送支援',
  holdSupport: '維持支援',
  exchangeRetreat: '交換/撤退',
  intelShare: '情報提供',
  disinformation: '偽装工作',
};

/** 対価あり合意の条項（作成時に2つ選択） */
export const PRICED_TREATY_CLAUSES: TreatyClauseKind[] = [
  'sphere',
  'routeSecure',
  'moveSupport',
  'convoySupport',
  'holdSupport',
  'exchangeRetreat',
];

/** 条約作成カテゴリ */
export type TreatyCategory = 'simple' | 'priced' | 'information';

/** 期限（null なら無期限） */
export type TreatyExpiry = {
  year: number;
  season: Season;
} | null;

/** 各参加国の批准状態 */
export type TreatyApprovalState =
  | 'pending'
  | 'ratified'
  | 'rejected'
  | 'counterProposed';

/** 延長提案 */
export type TreatyExtensionProposal = {
  proposedByPowerId: string;
  proposedAtIso: string;
  proposedExpiry: TreatyExpiry;
  statusByPower: Record<string, TreatyApprovalState>;
};

/** 条約本体 */
export type TreatyRecord = {
  id: string;
  title: string;
  proposerPowerId: string;
  createdAtIso: string;
  createdAtTurnKey: string;
  category: TreatyCategory;
  clauses: TreatyClauseKind[];
  participantPowerIds: string[];
  visibleToPowerIds: string[];
  provinceIds: string[];
  primaryPowerId?: string;
  secondaryPowerId?: string;
  thirdPowerId?: string;
  unitText?: string;
  detailText?: string;
  expiry: TreatyExpiry;
  statusByPower: Record<string, TreatyApprovalState>;
  ratifiedAtIso?: string;
  discardedAtIso?: string;
  discardedByPowerId?: string;
  extensionProposal?: TreatyExtensionProposal;
};

/** 条約違反通知 */
export type TreatyViolationNotice = {
  id: string;
  treatyId: string;
  violatorPowerId: string;
  targetPowerIds: string[];
  message: string;
  turnKey: string;
  createdAtIso: string;
};

/** 交渉フェーズ中に各勢力がステージングする条約応答操作 */
export type PendingTreatyOp = {
  id: string;
  treatyId: string;
  kind: 'ratify' | 'reject';
  powerId: string;
  createdAtIso: string;
};

/** 地図描画用の条約オーバーレイ */
export type TreatyMapVisuals = {
  provinceFills: {
    provinceId: string;
    color: string;
    opacity: number;
  }[];
  provinceArrows: {
    provinceId: string;
    color: string;
    opacity: number;
  }[];
};

/**
 * 年季を比較する。
 */
function compareTurn(
  a: { year: number; season: Season },
  b: { year: number; season: Season },
): number {
  if (a.year !== b.year) {
    return a.year - b.year;
  }
  const seasonRank = (s: Season): number => (s === Season.Spring ? 0 : 1);
  return seasonRank(a.season) - seasonRank(b.season);
}

/**
 * 条約が全参加国の批准済みかを判定する。
 */
export function isTreatyRatified(t: TreatyRecord): boolean {
  return t.participantPowerIds.every((pid) => t.statusByPower[pid] === 'ratified');
}

/**
 * 指定国が条約の参加国かを判定する。
 */
export function isTreatyParticipant(t: TreatyRecord, powerId: string): boolean {
  return t.participantPowerIds.includes(powerId);
}

/**
 * 指定国が条約を閲覧できるかを判定する。
 */
export function canPowerViewTreaty(t: TreatyRecord, powerId: string): boolean {
  return t.visibleToPowerIds.includes(powerId) || t.participantPowerIds.includes(powerId);
}

/**
 * 条約が有効（批准済み・未破棄・未失効）かを判定する。
 */
export function isTreatyActive(
  t: TreatyRecord,
  currentTurn: { year: number; season: Season },
): boolean {
  if (!isTreatyRatified(t)) {
    return false;
  }
  if (t.discardedAtIso != null) {
    return false;
  }
  if (t.expiry == null) {
    return true;
  }
  return compareTurn(currentTurn, t.expiry) <= 0;
}

/**
 * 期限ラベルを返す。
 */
export function treatyExpiryLabel(t: TreatyRecord): string {
  if (t.expiry == null) {
    return '無期限';
  }
  return `${t.expiry.year} ${t.expiry.season === Season.Spring ? '春' : '秋'}まで`;
}

/**
 * 批准済み条約から地図描画用オーバーレイを生成する。
 */
export function buildTreatyMapVisuals(
  treaties: TreatyRecord[],
  currentTurn: { year: number; season: Season },
): TreatyMapVisuals {
  const fills: TreatyMapVisuals['provinceFills'] = [];
  const arrows: TreatyMapVisuals['provinceArrows'] = [];
  for (const t of treaties) {
    if (!isTreatyActive(t, currentTurn)) {
      continue;
    }
    for (const clause of t.clauses) {
      if (clause === 'mutualNonAggression') {
        for (const provinceId of t.provinceIds) {
          fills.push({ provinceId, color: '#9ca3af', opacity: 0.28 });
        }
      }
      if (
        clause === 'mutualStandoff' ||
        clause === 'moveSupport' ||
        clause === 'convoySupport' ||
        clause === 'holdSupport'
      ) {
        for (const provinceId of t.provinceIds) {
          arrows.push({ provinceId, color: '#9ca3af', opacity: 0.8 });
        }
      }
      if (clause === 'sphere') {
        const spherePower = t.primaryPowerId ?? t.participantPowerIds[0] ?? '';
        const sphereColor = POWER_COLORS[spherePower] ?? '#64748b';
        for (const provinceId of t.provinceIds) {
          fills.push({ provinceId, color: sphereColor, opacity: 0.2 });
        }
      }
    }
  }
  return { provinceFills: fills, provinceArrows: arrows };
}

/**
 * 命令入力から条約違反を検知する（禁止系条項のみ）。
 */
export function detectTreatyViolations(
  board: BoardState,
  unitOrders: Record<string, UnitOrderInput>,
  treaties: TreatyRecord[],
): TreatyViolationNotice[] {
  const turnKey = `${board.turn.year}-${board.turn.season}`;
  const nowIso = new Date().toISOString();
  const notices: TreatyViolationNotice[] = [];
  for (const t of treaties) {
    if (!isTreatyActive(t, board.turn)) {
      continue;
    }
    const watchProvinceSet = new Set(t.provinceIds);
    for (const clause of t.clauses) {
      if (clause !== 'mutualNonAggression' && clause !== 'sphere') {
        continue;
      }
      for (const u of board.units) {
        if (!t.participantPowerIds.includes(u.powerId)) {
          continue;
        }
        const input = unitOrders[u.id];
        if (!input || input.type !== OrderType.Move || !input.targetProvinceId) {
          continue;
        }
        if (!watchProvinceSet.has(input.targetProvinceId)) {
          continue;
        }
        const targetPowerIds = t.participantPowerIds.filter((pid) => pid !== u.powerId);
        notices.push({
          id: `${t.id}-${u.id}-${input.targetProvinceId}-${turnKey}`,
          treatyId: t.id,
          violatorPowerId: u.powerId,
          targetPowerIds,
          message: `${u.powerId} が条約「${t.title}」対象地への移動命令を出しました（${input.targetProvinceId}）。`,
          turnKey,
          createdAtIso: nowIso,
        });
      }
    }
  }
  return notices;
}
