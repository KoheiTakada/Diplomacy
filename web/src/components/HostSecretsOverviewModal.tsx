/**
 * ホスト向け: 卓ID・ホストシークレット・各国シークレットの一覧モーダル
 *
 * 概要:
 *   メイン画面のボタンから開き、機密文字列を確認・クリップボードにコピーする。
 *
 * 主な機能:
 *   - 卓ID / ホスト用 / 各国用の個別コピー
 *   - 一覧テキストの一括コピー
 *   - ホスト・各国のシークレットは画面上は先頭5文字のみ表示し、以降は ● で隠す（コピーは全文）
 *
 * 想定される制限事項:
 *   - 各国シークレットは sessionStorage に無い場合は表示できない（卓作成時またはホスト参加時に保存された場合のみ）。
 *   - 画面共有中は開かないこと（シークレットが漏れる）。
 *   - ネイティブ `<dialog>` は使わない（`showModal` と backdrop の環境差で閉じる操作が効かない事例があるため）。
 *   - オーバーレイは `document.body` へポータルする。
 */

'use client';

import { POWERS } from '@/miniMap';
import { POWER_META } from '@/diplomacy/gameHelpers';
import { readOnlineHostSecret } from '@/lib/onlineSessionBrowser';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import { createPortal } from 'react-dom';

type HostSecretsOverviewModalProps = {
  /** 表示中なら true */
  open: boolean;
  /** 閉じたときに親が false にする */
  onClose: () => void;
  /** 卓 UUID */
  roomId: string;
  /** 接続中コンテキストのホストシークレット（優先表示） */
  hostSecretFromContext: string;
  /** 各国トークン（sessionStorage 由来。無ければ null） */
  powerSecrets: Record<string, string> | null;
};

/**
 * `window.location.origin` を SSR 安全に取得するための購読（不変想定）。
 *
 * @param onStoreChange - React が渡すコールバック
 * @returns アンサブスクライブ
 */
function subscribeOrigin(onStoreChange: () => void): () => void {
  void onStoreChange;
  return () => {};
}

/**
 * クライアントでの origin。
 */
function getOriginSnapshot(): string {
  return typeof window === 'undefined' ? '' : window.location.origin;
}

/** マスク表示で先頭に残す文字数 */
const SECRET_MASK_VISIBLE_PREFIX_LEN = 5;

/** マスクに使う1文字（以降を隠す） */
const SECRET_MASK_CHAR = '●';

/**
 * シークレットを画面上用にマスクする（先頭のみ平文、それ以降は ●）。
 *
 * @param plain - 平文のシークレット
 * @returns 6文字超は先頭5文字 + ●、それ以下はそのまま、空は空文字
 */
function formatSecretMaskedDisplay(plain: string): string {
  if (plain.length === 0) {
    return '';
  }
  if (plain.length <= SECRET_MASK_VISIBLE_PREFIX_LEN) {
    return plain;
  }
  const head = plain.slice(0, SECRET_MASK_VISIBLE_PREFIX_LEN);
  const hiddenCount = plain.length - SECRET_MASK_VISIBLE_PREFIX_LEN;
  return head + SECRET_MASK_CHAR.repeat(hiddenCount);
}

/**
 * 1行をコピーするボタン付きの表示行。
 *
 * @param props.maskDisplay - true のとき `value` はコピーに使い、表示はマスクする
 */
function SecretRow(props: {
  label: string;
  value: string;
  copyKey: string;
  copyFlash: string | null;
  onCopy: (text: string, key: string) => void;
  maskDisplay?: boolean;
}) {
  const { label, value, copyKey, copyFlash, onCopy, maskDisplay = false } = props;
  const empty = value.length === 0;
  const displayText = empty
    ? ''
    : maskDisplay
      ? formatSecretMaskedDisplay(value)
      : value;
  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50/90 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold text-zinc-800">{label}</span>
        <button
          type="button"
          disabled={empty}
          onClick={() => void onCopy(value, copyKey)}
          className="shrink-0 rounded-md bg-zinc-800 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {copyFlash === copyKey ? 'コピー済み' : 'コピー'}
        </button>
      </div>
      <p className="mt-1.5 break-all font-mono text-[11px] leading-relaxed text-zinc-700">
        {empty ? '—（未保存または不明）—' : displayText}
      </p>
    </div>
  );
}

/**
 * ホスト用シークレット一覧（div ベースのモーダル）。
 *
 * @param props - open / onClose / roomId / secrets
 */
export function HostSecretsOverviewModal(props: HostSecretsOverviewModalProps) {
  const {
    open,
    onClose,
    roomId,
    hostSecretFromContext,
    powerSecrets,
  } = props;
  const [copyFlash, setCopyFlash] = useState<string | null>(null);
  /** クライアントで body へポータルするまで null（SSR では描画しない） */
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const origin = useSyncExternalStore(subscribeOrigin, getOriginSnapshot, () => '');

  useEffect(() => {
    setPortalRoot(document.body);
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const effectiveHostSecret = useMemo(() => {
    const t = hostSecretFromContext.trim();
    if (t.length > 0) {
      return t;
    }
    return readOnlineHostSecret(roomId) ?? '';
  }, [hostSecretFromContext, roomId]);

  const allSecretsText = useMemo(() => {
    const lines: string[] = [
      '【ディプロマシー オンライン卓・シークレット一覧】',
      '',
      `卓ID: ${roomId}`,
      '',
      '■ ホスト用シークレット（裁定・管理用。厳秘）',
      effectiveHostSecret.length > 0 ? effectiveHostSecret : '（不明）',
      '',
      '■ 各国プレイヤー用シークレット（厳秘）',
    ];
    for (const pid of POWERS) {
      const label = POWER_META[pid]?.label ?? pid;
      const tok = powerSecrets?.[pid];
      lines.push(`${label} (${pid}): ${tok != null && tok.length > 0 ? tok : '（このブラウザに未保存）'}`);
    }
    if (origin.length > 0) {
      lines.push('');
      lines.push('■ 参加用（シークレットは URL に含めない）');
      lines.push(`サイト: ${origin}/`);
      lines.push(
        'トップのオンライン → Continue で卓IDと上記の各国シークレットを入力。',
      );
    }
    return lines.join('\n');
  }, [roomId, effectiveHostSecret, powerSecrets, origin]);

  const flash = useCallback((key: string) => {
    setCopyFlash(key);
    window.setTimeout(() => setCopyFlash(null), 1500);
  }, []);

  const copyText = useCallback(
    async (text: string, key: string) => {
      if (text.length === 0) {
        return;
      }
      try {
        await navigator.clipboard.writeText(text);
        flash(key);
      } catch {
        window.alert('コピーに失敗しました。');
      }
    },
    [flash],
  );

  if (!open || portalRoot == null) {
    return null;
  }

  const overlayNode = (
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/50 p-3"
      role="dialog"
      aria-modal="true"
      aria-labelledby="host-secrets-modal-title"
      onClick={onClose}
    >
      <div
        className="flex max-h-[min(90vh,720px)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-zinc-300 bg-white text-zinc-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-200 bg-white px-4 py-3">
          <h2
            id="host-secrets-modal-title"
            className="text-sm font-bold text-zinc-900"
          >
            シークレット一覧
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="relative z-[1] cursor-pointer rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
          >
            閉じる
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 [scrollbar-width:thin]">
          <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] leading-relaxed text-rose-950">
            画面共有・配信中は開かないでください。ホスト用はあなただけ、各国用は該当プレイヤーだけが知る値です。
          </p>

          <div className="space-y-3">
            <SecretRow
              label="卓ID"
              value={roomId}
              copyKey="room"
              copyFlash={copyFlash}
              onCopy={copyText}
            />
            <SecretRow
              label="ホスト用シークレット"
              value={effectiveHostSecret}
              copyKey="host"
              copyFlash={copyFlash}
              onCopy={copyText}
              maskDisplay
            />

            <div>
              <p className="mb-2 text-xs font-semibold text-zinc-800">
                各国プレイヤー用シークレット
              </p>
              {powerSecrets == null ? (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-950">
                  このブラウザに各国トークンが保存されていません。卓を新規作成したブラウザで開くか、タイトル画面のメモを参照してください。
                </p>
              ) : (
                <ul className="space-y-2">
                  {POWERS.map((pid) => {
                    const label = POWER_META[pid]?.label ?? pid;
                    const tok = powerSecrets[pid] ?? '';
                    return (
                      <li key={pid}>
                        <SecretRow
                          label={`${label}（${pid}）`}
                          value={tok}
                          copyKey={`p-${pid}`}
                          copyFlash={copyFlash}
                          onCopy={copyText}
                          maskDisplay
                        />
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={() => void copyText(allSecretsText, 'all')}
            className="mt-4 w-full rounded-xl border border-zinc-300 bg-zinc-100 py-2.5 text-xs font-semibold text-zinc-900 hover:bg-zinc-200"
          >
            {copyFlash === 'all' ? '一覧をコピーしました' : '一覧をすべてテキストでコピー'}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(overlayNode, portalRoot);
}
