/**
 * オンライン卓（7人プレイ）向けのデータ契約・同期方針（クライアント側の参照用）
 *
 * 概要:
 *   現状アプリは IndexedDB の `PersistedSnapshot` を真実とする。オンライン化では
 *   サーバー上の「卓スナップショット」を真実とし、版番号で競合を検出する。
 *
 * 主な機能:
 *   - 卓ID・スナップショット送受信・版管理の型定義
 *
 * 想定される制限事項:
 *   - このファイルは HTTP/Realtime の実装を含まない。バックエンド選定後に API と接続する。
 *   - 各国シークレット用トークンはサーバー側でハッシュ保管し、URL からは推測困難な値にする。
 */

/** 卓を一意に識別する公開ID（例: nanoid。推測されにくい長さを推奨） */
export type OnlineRoomId = string;

/**
 * 勢力専用URL用のシークレット（生トークン）。
 * クエリ `?t=` 等で渡し、サーバーが `room_secrets` と照合する。
 */
export type PowerJoinSecret = string;

/** サーバーが返すスナップショット1件分 */
export type OnlineRoomSnapshotPayload = {
  /** 単調増加の版。書き込み時にクライアントが `ifMatch` として送る */
  version: number;
  /** `PersistedSnapshot` を JSON 文字列化したもの（v:1 想定） */
  snapshotJson: string;
  /** ISO 8601。表示・デバッグ用 */
  updatedAtIso: string;
};

/** 卓の作成レスポンス（ホストが各国リンクを配布する） */
export type OnlineRoomCreateResponse = {
  roomId: OnlineRoomId;
  /** ホスト用（裁定・全勢力閲覧など）。高エントロピー */
  hostSecret: string;
  /** 勢力ID -> その国専用URL用トークン（平文はこの一度だけ返す想定） */
  powerSecrets: Record<string, PowerJoinSecret>;
  initial: OnlineRoomSnapshotPayload;
};

/** スナップショット全体置換（MVP 向け） */
export type OnlineRoomPutBody = {
  snapshotJson: string;
  /** 楽観的ロック: サーバー現行版と一致しなければ 409 */
  expectedVersion: number;
};

/** スナップショット置換の結果 */
export type OnlineRoomPutResult = {
  version: number;
  updatedAtIso: string;
};

/**
 * 同期方針（実装時の指針）:
 *
 * 1. MVP: ホストのみが `PUT`（裁定・次フェーズ）。各国は自分の `unitOrders` 等だけ
 *    `PATCH` する API に分けるか、または「各国ドラフト」を別テーブルに置き、
 *    ホストがマージしてから `PUT` する。
 * 2. 競合: `expectedVersion` 不一致なら 409 → クライアントは最新を再取得してマージまたは再入力。
 * 3. 配信: ポーリングで十分なら `GET /rooms/:id/snapshot` を 1〜3 秒間隔。
 *    低遅延が必要なら Supabase Realtime / PartyKit / WebSocket サーバーで `version` 更新を通知。
 * 4. 権限: Route Handler または Edge で `hostSecret` / `powerSecrets` を検証し、
 *    勢力ページからは「自国に関わるフィールド」だけ更新可とする（RLS またはアプリ層）。
 */
