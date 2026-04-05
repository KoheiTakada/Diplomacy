/**
 * アプリ内セーブ用 IndexedDB（世界線ごとに1スロット・上書き）
 *
 * 概要:
 *   キーは世界線 stem（`wl:` プレフィックス付き）。同一世界線は常に上書き保存される。
 *
 * 主な機能:
 *   - 世界線キーでの書き込み / 読み込み
 *   - 保存済み世界線 stem の一覧
 *
 * 想定される制限事項:
 *   - プライベートモード等では失敗しうる。
 *   - 旧セーブに savedAt が無い場合、日時は null になる。
 */

const DB_NAME = 'diplomacy-support-v1';
const DB_VERSION = 1;
const STORE_NAME = 'kv';
const KEY_PREFIX = 'wl:';

/**
 * タイトル「続きから」一覧用の1件分の情報。
 */
export type WorldlineSaveSummary = {
  /** 世界線 ID */
  stem: string;
  /**
   * 最終保存の ISO 8601 時刻（旧データで無い場合は null）
   */
  savedAtIso: string | null;
  /**
   * 盤面の進行表示（例: 「1901年 春」）。欠損時は null
   */
  progressLabel: string | null;
};

/**
 * セーブ JSON 文字列から一覧表示用フィールドだけを取り出す。
 *
 * @param jsonText - v:1 スナップショット JSON
 * @returns savedAt と進行ラベル
 */
function parseSaveSummaryFromJson(jsonText: string): Pick<
  WorldlineSaveSummary,
  'savedAtIso' | 'progressLabel'
> {
  try {
    const p = JSON.parse(jsonText) as {
      savedAt?: unknown;
      board?: { turn?: { year?: unknown; season?: unknown } };
    };
    const savedAtIso =
      typeof p.savedAt === 'string' && p.savedAt.length > 0 ? p.savedAt : null;
    const year = p.board?.turn?.year;
    const season = p.board?.turn?.season;
    let progressLabel: string | null = null;
    if (typeof year === 'number' && Number.isFinite(year)) {
      if (season === 'Spring') {
        progressLabel = `${year}年 春`;
      } else if (season === 'Fall') {
        progressLabel = `${year}年 秋`;
      }
    }
    return { savedAtIso, progressLabel };
  } catch {
    return { savedAtIso: null, progressLabel: null };
  }
}

/**
 * stem を IndexedDB のキーにする。
 *
 * @param worldlineStem - 整形済み世界線 ID
 */
function storageKey(worldlineStem: string): string {
  return `${KEY_PREFIX}${worldlineStem}`;
}

/**
 * オブジェクトストアを開く。
 */
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
}

/**
 * 指定世界線のセーブ JSON を上書きする。
 *
 * @param worldlineStem - 世界線 ID（ファイル名ベースと同一）
 * @param jsonText - v:1 スナップショット JSON（log・盤面を含む全体）
 */
export async function writeWorldlineSave(
  worldlineStem: string,
  jsonText: string,
): Promise<void> {
  if (typeof indexedDB === 'undefined' || worldlineStem.length === 0) {
    return;
  }
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore(STORE_NAME).put(jsonText, storageKey(worldlineStem));
    });
    db.close();
  } catch {
    /*  */
  }
}

/**
 * 指定世界線のセーブを読む（タイトル以外での利用向け）。
 *
 * @param worldlineStem - 世界線 ID
 */
export async function readWorldlineSave(
  worldlineStem: string,
): Promise<string | null> {
  if (typeof indexedDB === 'undefined' || worldlineStem.length === 0) {
    return null;
  }
  try {
    const db = await openDb();
    const text = await new Promise<string | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      tx.onerror = () => reject(tx.error);
      const r = tx.objectStore(STORE_NAME).get(storageKey(worldlineStem));
      r.onsuccess = () => {
        const v = r.result;
        resolve(typeof v === 'string' ? v : null);
      };
      r.onerror = () => reject(r.error);
    });
    db.close();
    return text;
  } catch {
    return null;
  }
}

/**
 * オートセーブが存在する世界線 stem を列挙する（ソート済み）。
 *
 * @returns stem の配列
 */
export async function listWorldlineStemsInAppStorage(): Promise<string[]> {
  if (typeof indexedDB === 'undefined') {
    return [];
  }
  try {
    const db = await openDb();
    const stems = await new Promise<string[]>((resolve, reject) => {
      const out: string[] = [];
      const tx = db.transaction(STORE_NAME, 'readonly');
      tx.onerror = () => reject(tx.error);
      const cursorReq = tx.objectStore(STORE_NAME).openCursor();
      cursorReq.onerror = () => reject(cursorReq.error);
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor == null) {
          resolve([...out].sort((a, b) => a.localeCompare(b, 'ja')));
          return;
        }
        const key = cursor.key;
        if (typeof key === 'string' && key.startsWith(KEY_PREFIX)) {
          out.push(key.slice(KEY_PREFIX.length));
        }
        cursor.continue();
      };
    });
    db.close();
    return stems;
  } catch {
    return [];
  }
}

/**
 * 保存済み世界線ごとに stem・最終保存日時・進行年季を列挙する（新しい保存が先）。
 *
 * @returns 一覧用サマリの配列
 */
export async function listWorldlineSaveSummariesInAppStorage(): Promise<
  WorldlineSaveSummary[]
> {
  if (typeof indexedDB === 'undefined') {
    return [];
  }
  try {
    const db = await openDb();
    const entries = await new Promise<WorldlineSaveSummary[]>((resolve, reject) => {
      const out: WorldlineSaveSummary[] = [];
      const tx = db.transaction(STORE_NAME, 'readonly');
      tx.onerror = () => reject(tx.error);
      const cursorReq = tx.objectStore(STORE_NAME).openCursor();
      cursorReq.onerror = () => reject(cursorReq.error);
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor == null) {
          const timeDesc = (iso: string | null): number => {
            if (iso == null || iso.length === 0) {
              return Number.NEGATIVE_INFINITY;
            }
            const t = Date.parse(iso);
            return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
          };
          out.sort((a, b) => {
            const ta = timeDesc(a.savedAtIso);
            const tb = timeDesc(b.savedAtIso);
            if (ta !== tb) {
              return tb - ta;
            }
            return a.stem.localeCompare(b.stem, 'ja');
          });
          resolve(out);
          return;
        }
        const key = cursor.key;
        const val = cursor.value;
        if (
          typeof key === 'string' &&
          key.startsWith(KEY_PREFIX) &&
          typeof val === 'string'
        ) {
          const stem = key.slice(KEY_PREFIX.length);
          const { savedAtIso, progressLabel } = parseSaveSummaryFromJson(val);
          out.push({ stem, savedAtIso, progressLabel });
        }
        cursor.continue();
      };
    });
    db.close();
    return entries;
  } catch {
    return [];
  }
}
