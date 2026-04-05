/**
 * オンライン卓: ホストが各国用リンクを再表示するための sessionStorage 補助
 *
 * 概要:
 *   卓作成時に一度だけ返る `powerSecrets` をブラウザに保持し、
 *   ホストの「シークレット一覧」等で再表示する。
 *
 * 主な機能:
 *   - `storeOnlinePowerSecrets` / `readOnlinePowerSecrets`
 *   - `storeOnlineHostSecret` / `readOnlineHostSecret`
 *
 * 想定される制限事項:
 *   - 別ブラウザ・シークレットウィンドウでは参照できない。
 *   - ホストが「参加」から入り直した場合、未保存なら各国トークンは使えない。
 */

const keyPrefix = 'diplomacy:onlinePowerSecrets:';
const hostKeyPrefix = 'diplomacy:onlineHostSecret:';

/**
 * 各国シークレットを保存する。
 *
 * @param roomId - 卓 UUID
 * @param secrets - 勢力 ID -> 平文トークン
 */
export function storeOnlinePowerSecrets(
  roomId: string,
  secrets: Record<string, string>,
): void {
  if (typeof sessionStorage === 'undefined') {
    return;
  }
  try {
    sessionStorage.setItem(`${keyPrefix}${roomId}`, JSON.stringify(secrets));
  } catch {
    /* 容量・プライベートモード */
  }
}

/**
 * 保存済みの各国シークレットを読む。
 *
 * @param roomId - 卓 UUID
 * @returns 無ければ null
 */
export function readOnlinePowerSecrets(
  roomId: string,
): Record<string, string> | null {
  if (typeof sessionStorage === 'undefined') {
    return null;
  }
  try {
    const raw = sessionStorage.getItem(`${keyPrefix}${roomId}`);
    if (raw == null || raw.length === 0) {
      return null;
    }
    const p = JSON.parse(raw) as Record<string, string>;
    return typeof p === 'object' && p != null ? p : null;
  } catch {
    return null;
  }
}

/**
 * ホスト用シークレットを保存する（同一ブラウザで一覧画面から再表示するため）。
 *
 * @param roomId - 卓 UUID
 * @param hostSecret - ホスト平文トークン
 */
export function storeOnlineHostSecret(roomId: string, hostSecret: string): void {
  if (typeof sessionStorage === 'undefined') {
    return;
  }
  try {
    sessionStorage.setItem(`${hostKeyPrefix}${roomId}`, hostSecret);
  } catch {
    /* 容量・プライベートモード */
  }
}

/**
 * 保存済みホストシークレットを読む。
 *
 * @param roomId - 卓 UUID
 * @returns 無ければ null
 */
export function readOnlineHostSecret(roomId: string): string | null {
  if (typeof sessionStorage === 'undefined') {
    return null;
  }
  try {
    const v = sessionStorage.getItem(`${hostKeyPrefix}${roomId}`);
    if (v == null || v.length === 0) {
      return null;
    }
    return v;
  } catch {
    return null;
  }
}
