/**
 * ディプロマシー支援ツール用ドメインモデル定義
 *
 * 概要:
 *   ディプロマシーにおける盤面（ボード）、ユニット、命令（オーダー）、
 *   およびラウンド進行に必要な基本的な型を定義する。
 *
 * 主な機能と仕様:
 *   - 縮小マップおよび正式マップの両方で利用できる中立的なモデル。
 *   - 陸軍 / 海軍、エリア種別（陸 / 海 / 両用）、サプライセンターなどを表現する。
 *   - Move / Support / Hold / Convoy など、MVPで扱う命令種別を表現する。
 *
 * 想定される制限事項:
 *   - 退却フェーズは簡易モデルのみを扱い、細かい例外規定はMVP範囲外とする。
 *   - 勢力やプレイヤー管理は必要最小限の情報のみを保持する。
 *   - STP / SPA / BUL は1プロヴィンス。艦隊のみ所在岸を fleetCoast で保持する。
 *
 * 型情報:
 *   - 各インターフェースおよび列挙型を参照。
 */

/**
 * ゲームの季節（フェーズ）を表す列挙型。
 * ディプロマシーでは春と秋の2フェーズで1年が進行する。
 */
export enum Season {
  Spring = 'Spring',
  Fall = 'Fall',
}

/**
 * 現在のターン情報を表す型。
 * 年と季節の組み合わせでゲームの進行状況を管理する。
 */
export interface TurnInfo {
  /** 西暦年（初期値は1901） */
  year: number;
  /** 季節（春または秋） */
  season: Season;
}

/**
 * エリアの種別（陸 / 海 / 両用）を表す列挙型。
 */
export enum AreaType {
  Land = 'Land',
  Sea = 'Sea',
  Coastal = 'Coastal',
}

/**
 * ユニット種別（陸軍 / 海軍）を表す列挙型。
 */
export enum UnitType {
  Army = 'Army',
  Fleet = 'Fleet',
}

/**
 * 勢力（国）を表す型。
 * MVPでは文字列IDのみを扱い、詳細情報は別途拡張する想定。
 */
export type PowerId = string;

/**
 * 分割岸プロヴィンスに所在する艦隊の岸（North / South / East Coast）
 */
export type FleetCoast = 'NC' | 'SC' | 'EC';

/**
 * プロヴィンス（州）を表す基本情報。
 * エリア（陸海）の細分は簡略化し、name を一意識別子として扱う。
 */
export interface Province {
  /** プロヴィンスの一意なID（例: "PAR", "BUR"） */
  id: string;
  /** 表示名（例: "Paris"） */
  name: string;
  /** エリア種別 */
  areaType: AreaType;
  /** サプライセンターかどうか */
  isSupplyCenter: boolean;
  /** ホーム補給拠点の所属勢力ID（非ホーム拠点は undefined） */
  homePowerId?: PowerId;
}

/**
 * プロヴィンス間の隣接関係を表す型。
 * from から to へ移動可能であることを意味する。
 */
export interface Adjacency {
  fromProvinceId: string;
  toProvinceId: string;
}

/**
 * ボード上に存在するユニットを表す型。
 */
export interface Unit {
  /** ユニットID（一意） */
  id: string;
  /** ユニット種別（陸軍 / 海軍） */
  type: UnitType;
  /** 所属勢力（PowerId） */
  powerId: PowerId;
  /** 現在位置のプロヴィンスID */
  provinceId: string;
  /**
   * 艦隊が STP / SPA / BUL にいるときの所在岸。それ以外の州では未設定。
   */
  fleetCoast?: FleetCoast;
}

/**
 * 命令の種別を表す列挙型。
 */
export enum OrderType {
  Hold = 'Hold',
  Move = 'Move',
  Support = 'Support',
  Convoy = 'Convoy',
}

/**
 * Hold 命令を表す型。
 * 対象ユニットはその場に留まる。
 */
export interface HoldOrder {
  type: OrderType.Hold;
  unitId: string;
}

/**
 * Move 命令を表す型。
 * sourceProvinceId から targetProvinceId への移動を指示する。
 */
export interface MoveOrder {
  type: OrderType.Move;
  unitId: string;
  sourceProvinceId: string;
  targetProvinceId: string;
  /**
   * SPA（MAO/POR など）・BUL（CON）のように到着岸が一意でない艦隊移動で指定
   */
  targetFleetCoast?: FleetCoast;
}

/**
 * Support 命令を表す型。
 * 対象となるユニットの Hold または Move を支援する。
 */
export interface SupportOrder {
  type: OrderType.Support;
  unitId: string;
  /** 支援対象ユニットID */
  supportedUnitId: string;
  /** 支援対象ユニットの元位置 */
  fromProvinceId: string;
  /** 支援対象ユニットの移動先（Hold の場合は同一プロヴィンス） */
  toProvinceId: string;
}

/**
 * Convoy 命令を表す型。
 * 海軍ユニットが、陸軍ユニットの Move を海上経由で輸送する。
 */
export interface ConvoyOrder {
  type: OrderType.Convoy;
  /** コンボイを実行する海軍ユニットID */
  unitId: string;
  /** 輸送される陸軍ユニットID */
  armyUnitId: string;
  /** 陸軍の元位置 */
  fromProvinceId: string;
  /** 陸軍の目的地 */
  toProvinceId: string;
}

/**
 * いずれかの命令を表す共用型。
 */
export type Order = HoldOrder | MoveOrder | SupportOrder | ConvoyOrder;

/**
 * 1ターン分のボード状態を表す型。
 */
export interface BoardState {
  /** 現在のターン情報（年＋季節） */
  turn: TurnInfo;
  /** 全プロヴィンス一覧 */
  provinces: Province[];
  /** プロヴィンス間の隣接関係一覧 */
  adjacencies: Adjacency[];
  /** 盤面上の全ユニット */
  units: Unit[];
  /** サプライセンターの所有者マップ（プロヴィンスID→PowerId） */
  supplyCenterOwnership: Record<string, PowerId | null>;
  /**
   * マップ塗りの残存勢力（陸・沿岸）。海域ユニットは対象外。
   * 永続化スナップショットに無い旧データでは undefined になり得る。
   */
  provinceControlTint?: Record<string, PowerId>;
}

/**
 * マップ上の州の「塗り色」用に、最後に支配表示した勢力を保持する。
 * ユニットが去ったあとも別勢力が上書きするまで消さない（表示専用・ルール判定には使わない）。
 *
 * @param previousTint - 直前盤面のマップ。省略時は空オブジェクトとみなす
 * @param board - 反映後の盤面（ユニット配置・サプライ所有が最新）
 * @returns マージ後の provinceId → 勢力ID
 */
export function nextProvinceControlTint(
  previousTint: Record<string, PowerId> | undefined,
  board: BoardState,
): Record<string, PowerId> {
  const out: Record<string, PowerId> = { ...(previousTint ?? {}) };
  const provinceById = new Map(board.provinces.map((p) => [p.id, p]));
  for (const u of board.units) {
    const prov = provinceById.get(u.provinceId);
    if (!prov || prov.areaType === AreaType.Sea) {
      continue;
    }
    out[u.provinceId] = u.powerId;
  }
  for (const [pid, owner] of Object.entries(board.supplyCenterOwnership)) {
    if (owner != null) {
      out[pid] = owner;
    }
  }
  return out;
}

/**
 * provinceControlTint を現在のユニット・サプライに同期した盤面を返す。
 *
 * @param board - 入力盤面
 * @returns 同一盤面に更新済み tint を載せたコピー
 */
export function boardWithRefreshedProvinceTint(board: BoardState): BoardState {
  return {
    ...board,
    provinceControlTint: nextProvinceControlTint(
      board.provinceControlTint,
      board,
    ),
  };
}

/**
 * 命令解決後の1件の結果を表す型。
 * ルールエンジンの出力として利用する。
 */
export interface OrderResolution {
  order: Order;
  /** 成功したかどうか */
  success: boolean;
  /** スタンドオフ・支援カットなどの理由メッセージ（ユーザー向け） */
  message: string;
}

/**
 * 押し出されて退却が必要になったユニットを表す型。
 */
export interface DislodgedUnit {
  unit: Unit;
  /** 押し出された元のプロヴィンスID */
  fromProvinceId: string;
  /** どのユニットに押し出されたか（ユニットID、任意） */
  displacedByUnitId?: string;
  /** 退却不可となる攻撃元プロヴィンスID（任意） */
  blockedProvinceId?: string;
}

/**
 * 命令解決処理の結果全体を表す型。
 */
export interface AdjudicationResult {
  /** 更新後のボード状態 */
  nextBoardState: BoardState;
  /** 各命令ごとの結果 */
  orderResolutions: OrderResolution[];
  /** 退却フェーズで処理すべき押し出されたユニット一覧 */
  dislodgedUnits: DislodgedUnit[];
}

