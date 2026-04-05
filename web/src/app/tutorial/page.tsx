/**
 * ディプロマシー（ボードゲーム）のルール動画ページ
 *
 * 概要:
 *   YouTube 埋め込みのみでルールを伝える。本文の解説は載せない。
 *
 * 主な機能:
 *   - YouTube 埋め込み
 *   - タイトル画面へ戻る導線
 *
 * 想定される制限事項:
 *   - 動画の内容・利用可否は YouTube 側に依存する。
 */

import type { Metadata } from 'next';
import Link from 'next/link';

/** 埋め込み用のディプロマシー解説動画（YouTube 動画 ID）。 */
const TUTORIAL_YOUTUBE_VIDEO_ID = 'kmLyTI13nVY';

export const metadata: Metadata = {
  title: 'ルール解説',
  description: 'ディプロマシーのルール解説動画（YouTube）。',
};

/**
 * ルール動画ページ。
 *
 * @returns 動画と戻るリンクのみの UI
 */
export default function TutorialPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-gradient-to-b from-zinc-100 to-zinc-200 px-4 py-6 font-sans text-zinc-900">
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col justify-center gap-4">
        <Link
          href="/"
          className="self-start text-sm font-medium text-zinc-600 underline-offset-2 hover:text-zinc-900 hover:underline"
        >
          ← 戻る
        </Link>
        <h1 className="sr-only">ルール解説動画</h1>
        <div
          className="relative aspect-video w-full overflow-hidden rounded-xl border border-zinc-300 bg-zinc-900 shadow-md"
        >
          <iframe
            className="absolute inset-0 h-full w-full"
            src={`https://www.youtube.com/embed/${TUTORIAL_YOUTUBE_VIDEO_ID}`}
            title="ディプロマシー ルール解説（YouTube）"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        </div>
      </div>
    </div>
  );
}
