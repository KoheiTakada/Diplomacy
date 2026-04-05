/**
 * タイトル画面（ログイン相当の入口）
 *
 * 概要:
 *   「オンライン」と「ローカル操作」の2ブロックに分け、
 *   オンラインは Continue（ロール・卓ID・シークレット）と New Game、
 *   ローカルは Continue / New Game を提供する。
 *
 * 主な機能:
 *   - オンライン Continue: ボタン押下後にロール・卓ID・シークレット欄を表示し、再度 Continue で参加
 *   - オンライン New Game: ローカル New Game と同じパネル構成（始める／キャンセル）で Supabase に新規卓を作成
 *   - ローカル Continue / New Game: IndexedDB に保存した世界線の再開・新規
 *
 * 想定される制限事項:
 *   - ローカル保存はこのブラウザの IndexedDB のみ。
 *   - オンライン卓は Supabase 環境変数と DB マイグレーションが必要。
 *   - シークレットは URL クエリに載るため HTTPS 前提。
 */

'use client';

import { useDiplomacyGame } from '@/context/DiplomacyGameContext';
import {
  listWorldlineSaveSummariesInAppStorage,
  type WorldlineSaveSummary,
} from '@/lib/appSaveStorage';
import { POWERS } from '@/miniMap';
import type { PowerId } from '@/domain';
import { POWER_META } from '@/diplomacy/gameHelpers';
import { useEffect, useRef, useState } from 'react';

/**
 * オンライン参加時のロール選択値（ホストまたは標準7大国のいずれか）。
 */
type OnlineJoinRole = 'host' | PowerId;

/**
 * ISO 時刻を一覧用の日本語表記にする。
 *
 * @param iso - ISO 8601 文字列
 * @returns 表示用テキスト、欠損・不正時は null
 */
function formatSavedAtForList(iso: string | null): string | null {
  if (iso == null || iso.length === 0) {
    return null;
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return null;
  }
  return d.toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' });
}

/**
 * タイトル UI。
 */
export function TitleScreen() {
  const {
    loadSaveFromAppStorageByStem,
    startNewGame,
    startNewOnlineGame,
    joinOnlineGame,
  } = useDiplomacyGame();
  const worldlineInputRef = useRef<HTMLInputElement>(null);
  const onlineWorldlineInputRef = useRef<HTMLInputElement>(null);

  const [busy, setBusy] = useState(false);
  const [newGameOpen, setNewGameOpen] = useState(false);
  const [worldlineDraft, setWorldlineDraft] = useState('');
  const [continueOpen, setContinueOpen] = useState(false);
  const [savedSummaries, setSavedSummaries] = useState<WorldlineSaveSummary[]>(
    [],
  );

  const [onlineBusy, setOnlineBusy] = useState(false);
  const [onlineContinueOpen, setOnlineContinueOpen] = useState(false);
  const [onlineStemDraft, setOnlineStemDraft] = useState('');
  const [onlineNewGameOpen, setOnlineNewGameOpen] = useState(false);
  const [joinRoomId, setJoinRoomId] = useState('');
  const [joinOnlineRole, setJoinOnlineRole] =
    useState<OnlineJoinRole>('host');
  const [joinSecret, setJoinSecret] = useState('');
  const [createdOnlineLinks, setCreatedOnlineLinks] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (!newGameOpen) {
      return;
    }
    const id = window.requestAnimationFrame(() => {
      worldlineInputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [newGameOpen]);

  useEffect(() => {
    if (!onlineNewGameOpen) {
      return;
    }
    const id = window.requestAnimationFrame(() => {
      onlineWorldlineInputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [onlineNewGameOpen]);

  useEffect(() => {
    if (!continueOpen) {
      return;
    }
    let cancelled = false;
    void listWorldlineSaveSummariesInAppStorage().then((rows) => {
      if (!cancelled) {
        setSavedSummaries(rows);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [continueOpen]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-gradient-to-b from-zinc-100 to-zinc-200 px-4 py-8 font-sans text-zinc-900">
      <div className="flex w-full max-w-sm flex-col items-stretch gap-8">
        <header className="text-center">
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900">
            Diplomacy
          </h1>
        </header>

        {/* オンライン */}
        <section
          className="flex flex-col gap-3"
          aria-labelledby="title-online-heading"
        >
          <h2
            id="title-online-heading"
            className="text-center text-xs font-semibold uppercase tracking-widest text-zinc-600"
          >
            — オンライン —
          </h2>

          {!onlineContinueOpen ? (
            <button
              type="button"
              disabled={busy || onlineBusy}
              onClick={() => setOnlineContinueOpen(true)}
              className="w-full rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white shadow-md shadow-violet-900/20 transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:bg-zinc-400"
            >
              Continue
            </button>
          ) : null}

          {onlineContinueOpen ? (
            <div className="rounded-xl border border-zinc-200 bg-white p-3 shadow-sm">
              <div className="flex flex-col gap-3">
                <label className="block text-[11px] font-medium text-zinc-700">
                  ロール
                </label>
                <select
                  value={joinOnlineRole}
                  onChange={(e) =>
                    setJoinOnlineRole(e.target.value as OnlineJoinRole)
                  }
                  className="w-full rounded-lg border border-zinc-200 bg-white px-2 py-2 text-xs text-zinc-900 outline-none ring-violet-400 focus:ring-2"
                >
                  <option value="host">ホスト</option>
                  {POWERS.map((pid) => (
                    <option key={pid} value={pid}>
                      {POWER_META[pid]?.label ?? pid}
                    </option>
                  ))}
                </select>
                <label className="block text-[11px] font-medium text-zinc-700">
                  卓ID
                </label>
                <input
                  type="text"
                  value={joinRoomId}
                  onChange={(e) => setJoinRoomId(e.target.value.trim())}
                  placeholder="UUID"
                  className="w-full rounded-lg border border-zinc-200 bg-white px-2 py-2 font-mono text-[11px] text-zinc-900 outline-none ring-violet-400 focus:ring-2"
                />
                <label className="block text-[11px] font-medium text-zinc-700">
                  シークレット
                </label>
                <input
                  type="text"
                  value={joinSecret}
                  onChange={(e) => setJoinSecret(e.target.value.trim())}
                  placeholder={
                    joinOnlineRole === 'host'
                      ? 'ホスト用シークレット'
                      : '各国用シークレット'
                  }
                  className="w-full rounded-lg border border-zinc-200 bg-white px-2 py-2 font-mono text-[11px] text-zinc-900 outline-none ring-violet-400 focus:ring-2"
                />
                <button
                  type="button"
                  disabled={busy || onlineBusy}
                  onClick={async () => {
                    setOnlineBusy(true);
                    try {
                      const r =
                        joinOnlineRole === 'host'
                          ? await joinOnlineGame({
                              roomId: joinRoomId,
                              hostSecret: joinSecret,
                            })
                          : await joinOnlineGame({
                              roomId: joinRoomId,
                              powerId: joinOnlineRole,
                              powerSecret: joinSecret,
                            });
                      if (!r.ok) {
                        window.alert(r.error);
                      } else {
                        setOnlineContinueOpen(false);
                      }
                    } finally {
                      setOnlineBusy(false);
                    }
                  }}
                  className="w-full rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white shadow-md shadow-violet-900/20 transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:bg-zinc-400"
                >
                  Continue
                </button>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => setOnlineContinueOpen(false)}
                className="mt-3 w-full text-center text-[11px] text-zinc-500 underline-offset-2 hover:underline"
              >
                閉じる
              </button>
            </div>
          ) : null}

          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setOnlineNewGameOpen((o) => !o);
              setCreatedOnlineLinks(null);
            }}
            className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm font-semibold text-zinc-800 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            New Game
          </button>
          {onlineNewGameOpen ? (
            <div className="rounded-xl border border-violet-200 bg-violet-50/90 p-3 shadow-sm">
              <label
                htmlFor="title-online-worldline-name"
                className="block text-xs font-medium text-violet-950"
              >
                世界線の名前
              </label>
              <input
                id="title-online-worldline-name"
                ref={onlineWorldlineInputRef}
                type="text"
                value={onlineStemDraft}
                onChange={(e) => setOnlineStemDraft(e.target.value)}
                placeholder="空欄のときは diplomacy として保存"
                className="mt-2 w-full rounded-lg border border-violet-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none ring-violet-400 focus:ring-2"
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setOnlineNewGameOpen(false);
                    setOnlineStemDraft('');
                    setCreatedOnlineLinks(null);
                  }
                }}
              />
              {createdOnlineLinks == null ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy || onlineBusy}
                    onClick={async () => {
                      setOnlineBusy(true);
                      setCreatedOnlineLinks(null);
                      try {
                        const r = await startNewOnlineGame(onlineStemDraft);
                        if (!r.ok) {
                          window.alert(r.error);
                          return;
                        }
                        const origin =
                          typeof window !== 'undefined'
                            ? window.location.origin
                            : '';
                        const lines: string[] = [
                          `卓ID: ${r.roomId}`,
                          `ホスト用シークレット（誰にも見せない）: ${r.hostSecret}`,
                          '',
                          '■ 参加手順（シークレットは URL に含めないでください）',
                          `  サイトを開く: ${origin}/`,
                          '  オンライン → Continue で卓IDとシークレットを入力。',
                          '',
                          '■ 各国に送る用（シークレットのみ。チャット等で個別に送る）',
                        ];
                        for (const pid of POWERS) {
                          const tok = r.powerSecrets[pid];
                          const meta = POWER_META[pid]?.label ?? pid;
                          lines.push(`${meta} (${pid}): ${tok}`);
                        }
                        setCreatedOnlineLinks(lines.join('\n'));
                      } finally {
                        setOnlineBusy(false);
                      }
                    }}
                    className="rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-60"
                  >
                    始める
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setOnlineNewGameOpen(false);
                      setOnlineStemDraft('');
                      setCreatedOnlineLinks(null);
                    }}
                    className="rounded-lg border border-violet-200 bg-white px-3 py-2 text-xs font-semibold text-violet-900 hover:bg-violet-50"
                  >
                    キャンセル
                  </button>
                </div>
              ) : (
                <>
                  <div className="mt-3 rounded-lg border border-violet-200 bg-white p-2">
                    <p className="mb-1 text-[10px] font-medium text-violet-950">
                      以下をコピーして各国に送ってください（再表示されません）。
                    </p>
                    <textarea
                      readOnly
                      value={createdOnlineLinks}
                      rows={12}
                      className="w-full resize-y rounded border border-violet-200 bg-white p-2 font-mono text-[10px] text-zinc-800"
                      onFocus={(e) => e.target.select()}
                    />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setOnlineNewGameOpen(false);
                        setOnlineStemDraft('');
                        setCreatedOnlineLinks(null);
                      }}
                      className="rounded-lg border border-violet-200 bg-white px-3 py-2 text-xs font-semibold text-violet-900 hover:bg-violet-50"
                    >
                      キャンセル
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : null}
        </section>

        {/* ローカル */}
        <section
          className="flex flex-col gap-3"
          aria-labelledby="title-local-heading"
        >
          <h2
            id="title-local-heading"
            className="text-center text-xs font-semibold uppercase tracking-widest text-zinc-600"
          >
            — ローカル操作 —
          </h2>
          <button
            type="button"
            disabled={busy}
            onClick={() => setContinueOpen(true)}
            className="w-full rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white shadow-md shadow-violet-900/20 transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:bg-zinc-400"
          >
            Continue
          </button>

          {continueOpen ? (
            <div className="rounded-xl border border-zinc-200 bg-white p-3 shadow-sm">
              {savedSummaries.length === 0 ? (
                <p className="text-center text-xs text-zinc-500">
                  保存された世界線はありません。
                </p>
              ) : (
                <ul className="flex max-h-52 flex-col gap-1.5 overflow-y-auto">
                  {savedSummaries.map((row) => {
                    const dateLine = formatSavedAtForList(row.savedAtIso);
                    const metaParts = [dateLine, row.progressLabel].filter(
                      (x): x is string => x != null && x.length > 0,
                    );
                    const metaLine =
                      metaParts.length > 0 ? metaParts.join(' ・ ') : null;
                    return (
                      <li key={row.stem}>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={async () => {
                            setBusy(true);
                            try {
                              const ok = await loadSaveFromAppStorageByStem(
                                row.stem,
                              );
                              if (!ok) {
                                window.alert(
                                  '読み込みに失敗しました。データが壊れている可能性があります。',
                                );
                              } else {
                                setContinueOpen(false);
                              }
                            } finally {
                              setBusy(false);
                            }
                          }}
                          className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-left text-xs text-zinc-800 hover:bg-zinc-100 disabled:opacity-60"
                        >
                          <span className="block font-medium text-zinc-900">
                            {row.stem}
                          </span>
                          {metaLine != null ? (
                            <span className="mt-0.5 block text-[11px] font-normal text-zinc-500">
                              {metaLine}
                            </span>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => setContinueOpen(false)}
                className="mt-3 w-full text-center text-[11px] text-zinc-500 underline-offset-2 hover:underline"
              >
                閉じる
              </button>
            </div>
          ) : null}

          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setWorldlineDraft('');
              setNewGameOpen(true);
            }}
            className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm font-semibold text-zinc-800 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            New Game
          </button>

          {newGameOpen ? (
            <div className="rounded-xl border border-violet-200 bg-violet-50/90 p-3 shadow-sm">
              <label
                htmlFor="title-worldline-name"
                className="block text-xs font-medium text-violet-950"
              >
                世界線の名前
              </label>
              <input
                id="title-worldline-name"
                ref={worldlineInputRef}
                type="text"
                value={worldlineDraft}
                onChange={(e) => setWorldlineDraft(e.target.value)}
                placeholder="空欄のときは diplomacy として保存"
                className="mt-2 w-full rounded-lg border border-violet-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none ring-violet-400 focus:ring-2"
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setNewGameOpen(false);
                  }
                }}
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    startNewGame(worldlineDraft);
                    setNewGameOpen(false);
                    setWorldlineDraft('');
                  }}
                  className="rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-60"
                >
                  始める
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setNewGameOpen(false);
                    setWorldlineDraft('');
                  }}
                  className="rounded-lg border border-violet-200 bg-white px-3 py-2 text-xs font-semibold text-violet-900 hover:bg-violet-50"
                >
                  キャンセル
                </button>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
