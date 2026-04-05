/**
 * タイトル画面（ログイン相当の入口）
 *
 * 概要:
 *   オンライン卓のみを提供する。Join room（卓ID・ロール・シークレット）と
 *   Create room（新規卓作成）の2導線を持つ。
 *
 * 主な機能:
 *   - Join room: ボタン押下後にフォームを表示し、送信でオンライン参加
 *   - Create room: 世界線名入力後に Supabase へ新規卓を作成
 *
 * 想定される制限事項:
 *   - オンライン卓は Supabase 環境変数と DB マイグレーションが必要。
 *   - シークレットは URL クエリに載るため HTTPS 前提。
 */

'use client';

import { useDiplomacyGame } from '@/context/DiplomacyGameContext';
import { POWERS } from '@/miniMap';
import type { PowerId } from '@/domain';
import { POWER_META } from '@/diplomacy/gameHelpers';
import { useEffect, useRef, useState } from 'react';

/**
 * オンライン参加時のロール選択値（ホストまたは標準7大国のいずれか）。
 */
type OnlineJoinRole = 'host' | PowerId;

/**
 * タイトル UI。
 */
export function TitleScreen() {
  const { startNewOnlineGame, joinOnlineGame } = useDiplomacyGame();
  const onlineWorldlineInputRef = useRef<HTMLInputElement>(null);

  const [onlineBusy, setOnlineBusy] = useState(false);
  const [joinRoomFormOpen, setJoinRoomFormOpen] = useState(false);
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
    if (!onlineNewGameOpen) {
      return;
    }
    const id = window.requestAnimationFrame(() => {
      onlineWorldlineInputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [onlineNewGameOpen]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-gradient-to-b from-zinc-100 to-zinc-200 px-4 py-8 font-sans text-zinc-900">
      <div className="flex w-full max-w-sm flex-col items-stretch gap-8">
        <header className="text-center">
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900">
            Diplomacy
          </h1>
        </header>

        <section
          className="flex flex-col gap-3"
          aria-labelledby="title-online-heading"
        >
          <h2
            id="title-online-heading"
            className="text-center text-xs font-semibold uppercase tracking-widest text-zinc-600"
          >
            — Online —
          </h2>

          {!joinRoomFormOpen ? (
            <button
              type="button"
              disabled={onlineBusy}
              onClick={() => setJoinRoomFormOpen(true)}
              className="w-full rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white shadow-md shadow-violet-900/20 transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:bg-zinc-400"
            >
              Join room
            </button>
          ) : null}

          {joinRoomFormOpen ? (
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
                  disabled={onlineBusy}
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
                        setJoinRoomFormOpen(false);
                      }
                    } finally {
                      setOnlineBusy(false);
                    }
                  }}
                  className="w-full rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white shadow-md shadow-violet-900/20 transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:bg-zinc-400"
                >
                  Join room
                </button>
              </div>
              <button
                type="button"
                onClick={() => setJoinRoomFormOpen(false)}
                className="mt-3 w-full text-center text-[11px] text-zinc-500 underline-offset-2 hover:underline"
              >
                閉じる
              </button>
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => {
              setOnlineNewGameOpen((o) => !o);
              setCreatedOnlineLinks(null);
            }}
            className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm font-semibold text-zinc-800 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Create room
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
                    disabled={onlineBusy}
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
                          '  Online → Join room で卓IDとシークレットを入力。',
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
                    disabled={onlineBusy}
                    onClick={() => {
                      setOnlineNewGameOpen(false);
                      setOnlineStemDraft('');
                      setCreatedOnlineLinks(null);
                    }}
                    className="rounded-lg border border-violet-200 bg-white px-3 py-2 text-xs font-semibold text-violet-900 hover:bg-violet-50 disabled:opacity-60"
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
                      disabled={onlineBusy}
                      onClick={() => {
                        setOnlineNewGameOpen(false);
                        setOnlineStemDraft('');
                        setCreatedOnlineLinks(null);
                      }}
                      className="rounded-lg border border-violet-200 bg-white px-3 py-2 text-xs font-semibold text-violet-900 hover:bg-violet-50 disabled:opacity-60"
                    >
                      キャンセル
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
