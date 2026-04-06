/**
 * オンライン卓: シークレットのブラウザ保持（sessionStorage + localStorage）
 *
 * 概要:
 *   卓作成時に返る `powerSecrets` とホスト用シークレットを保持する。
 *   別タブの `/power/[powerId]` から参加を復元できるよう、同一キー名で
 *   localStorage にもミラーする（sessionStorage はタブ間で共有されない）。
 *
 * 主な機能:
 *   - `storeOnlinePowerSecrets` / `readOnlinePowerSecrets`
 *   - `storeOnlineHostSecret` / `readOnlineHostSecret`
 *   - `readOnlineSessionForPowerPageRestore`（active 無し時のホスト／各国フォールバック）
 *   - `syncOnlineSecretsSessionStorageToLocalStorage`（旧データの移行用）
 *
 * 想定される制限事項:
 *   - 別ブラウザ・シークレットウィンドウでは参照できない。
 *   - localStorage はブラウザを閉じても残る（共有端末では注意）。
 *   - 最後に使った卓 ID は1つだけ保持し、複数卓を行き来する場合は誤復元の余地がある。
 */

const keyPrefix = 'diplomacy:onlinePowerSecrets:';
const hostKeyPrefix = 'diplomacy:onlineHostSecret:';
const activeSessionKey = 'diplomacy:onlineActiveSession:v1';
const lastActiveRoomKey = 'diplomacy:onlineLastActiveRoom:v1';

export type BrowserOnlineActiveSession = {
  roomId: string;
  token: string;
};

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
  const storageKey = `${keyPrefix}${roomId}`;
  const json = JSON.stringify(secrets);
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(storageKey, json);
    }
  } catch {
    /* 容量・プライベートモード */
  }
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(storageKey, json);
      localStorage.setItem(lastActiveRoomKey, roomId);
    }
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
  const storageKey = `${keyPrefix}${roomId}`;
  const tryParse = (raw: string | null): Record<string, string> | null => {
    if (raw == null || raw.length === 0) {
      return null;
    }
    try {
      const p = JSON.parse(raw) as Record<string, string>;
      return typeof p === 'object' && p != null ? p : null;
    } catch {
      return null;
    }
  };
  try {
    if (typeof localStorage !== 'undefined') {
      const fromLocal = tryParse(localStorage.getItem(storageKey));
      if (fromLocal != null) {
        return fromLocal;
      }
    }
  } catch {
    /* noop */
  }
  try {
    if (typeof sessionStorage !== 'undefined') {
      return tryParse(sessionStorage.getItem(storageKey));
    }
  } catch {
    /* noop */
  }
  return null;
}

/**
 * ホスト用シークレットを保存する（同一ブラウザで一覧画面から再表示するため）。
 *
 * @param roomId - 卓 UUID
 * @param hostSecret - ホスト平文トークン
 */
export function storeOnlineHostSecret(roomId: string, hostSecret: string): void {
  if (hostSecret.length === 0) {
    return;
  }
  const storageKey = `${hostKeyPrefix}${roomId}`;
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(storageKey, hostSecret);
    }
  } catch {
    /* 容量・プライベートモード */
  }
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(storageKey, hostSecret);
      localStorage.setItem(lastActiveRoomKey, roomId);
    }
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
  const storageKey = `${hostKeyPrefix}${roomId}`;
  try {
    if (typeof localStorage !== 'undefined') {
      const v = localStorage.getItem(storageKey);
      if (v != null && v.length > 0) {
        return v;
      }
    }
  } catch {
    /* noop */
  }
  try {
    if (typeof sessionStorage !== 'undefined') {
      const v = sessionStorage.getItem(storageKey);
      if (v != null && v.length > 0) {
        return v;
      }
    }
  } catch {
    /* noop */
  }
  return null;
}

/**
 * 現在のオンライン参加情報を localStorage に保存する（別タブ復元用）。
 *
 * @param roomId - 卓 UUID
 * @param token - ホストまたは各国シークレット
 */
export function storeOnlineActiveSession(roomId: string, token: string): void {
  if (typeof localStorage === 'undefined') {
    return;
  }
  try {
    localStorage.setItem(
      activeSessionKey,
      JSON.stringify({
        roomId,
        token,
      }),
    );
    localStorage.setItem(lastActiveRoomKey, roomId);
  } catch {
    /* 容量・プライベートモード */
  }
}

/**
 * 保存済みのオンライン参加情報を読む（別タブ復元用）。
 *
 * @returns 無ければ null
 */
export function readOnlineActiveSession(): BrowserOnlineActiveSession | null {
  if (typeof localStorage === 'undefined') {
    return null;
  }
  try {
    const raw = localStorage.getItem(activeSessionKey);
    if (raw == null || raw.length === 0) {
      return null;
    }
    const p = JSON.parse(raw) as BrowserOnlineActiveSession;
    if (
      p == null ||
      typeof p.roomId !== 'string' ||
      p.roomId.length === 0 ||
      typeof p.token !== 'string' ||
      p.token.length === 0
    ) {
      return null;
    }
    return p;
  } catch {
    return null;
  }
}

/**
 * 保存済みのオンライン参加情報を消す。
 */
export function clearOnlineActiveSession(): void {
  if (typeof localStorage === 'undefined') {
    return;
  }
  try {
    localStorage.removeItem(activeSessionKey);
    localStorage.removeItem(lastActiveRoomKey);
  } catch {
    /* 容量・プライベートモード */
  }
}

/**
 * メインタブで sessionStorage にだけ残っているシークレットを localStorage へ複製する。
 * デプロイ直後や旧版からの移行で、別タブ `/power` が復元できるようにする。
 */
export function syncOnlineSecretsSessionStorageToLocalStorage(): void {
  if (typeof sessionStorage === 'undefined' || typeof localStorage === 'undefined') {
    return;
  }
  try {
    let latestHostRoom: string | null = null;
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k == null) {
        continue;
      }
      if (k.startsWith(hostKeyPrefix)) {
        const v = sessionStorage.getItem(k);
        if (v != null && v.length > 0) {
          localStorage.setItem(k, v);
          latestHostRoom = k.slice(hostKeyPrefix.length);
        }
      } else if (k.startsWith(keyPrefix)) {
        const v = sessionStorage.getItem(k);
        if (v != null && v.length > 0) {
          localStorage.setItem(k, v);
        }
      }
    }
    const existingLast = localStorage.getItem(lastActiveRoomKey);
    if (
      (existingLast == null || existingLast.length === 0) &&
      latestHostRoom != null
    ) {
      localStorage.setItem(lastActiveRoomKey, latestHostRoom);
    }
  } catch {
    /* noop */
  }
}

/**
 * `/power/[powerId]` 用: 明示的な active セッションが無いとき、
 * 最後の卓 ID とホストシークレット、または各国シークレットから復元トークンを得る。
 *
 * @param powerId - URL の勢力 ID（例: ENG）
 * @returns 参加に使える roomId + token、無ければ null
 */
export function readOnlineSessionForPowerPageRestore(
  powerId: string,
): BrowserOnlineActiveSession | null {
  const direct = readOnlineActiveSession();
  if (direct != null) {
    return direct;
  }
  if (typeof localStorage === 'undefined') {
    return null;
  }
  let roomId: string | null = null;
  try {
    roomId = localStorage.getItem(lastActiveRoomKey);
  } catch {
    return null;
  }
  if (roomId == null || roomId.length === 0) {
    return null;
  }
  const hostTok = readOnlineHostSecret(roomId);
  if (hostTok != null && hostTok.length > 0) {
    return { roomId, token: hostTok };
  }
  const powerSecrets = readOnlinePowerSecrets(roomId);
  const pTok = powerSecrets?.[powerId];
  if (pTok != null && pTok.length > 0) {
    return { roomId, token: pTok };
  }
  return null;
}
