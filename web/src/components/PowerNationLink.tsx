/**
 * 各国専用ページへの遷移ボタン（役職確認ダイアログ付き）
 *
 * 概要:
 *   クリックで「〇〇の国王ですか？」形式の確認を表示し、承認時のみ遷移する。
 *
 * 主な機能:
 *   - HTML dialog によるモーダル表示
 *   - Next.js App Router へのプログラム遷移
 *
 * 想定される制限事項:
 *   - 認証はなく、誠実運用前提。
 *   - オンライン参加プレイヤーは自国以外 `disabled` で開けない。
 */

'use client';

import { useRouter } from 'next/navigation';
import { useRef } from 'react';
import { PowerLabelText } from '@/components/PowerLabelText';
import { POWER_ROLE_JA } from '@/diplomacy/gameHelpers';

type PowerNationLinkProps = {
  /** 勢力ID（例: ENG） */
  powerId: string;
  /** ボタンに表示する文言 */
  children: React.ReactNode;
  /** 追加の button className */
  className?: string;
  /** true のとき確認ダイアログを出さず押せない */
  disabled?: boolean;
  /** disabled 時のツールチップ・説明用 */
  disabledTitle?: string;
};

/**
 * 確認後に `/power/[powerId]` へ進むリンクボタン（オンライン時も同じ。認証は Context）。
 *
 * @param props - 属性
 */
export function PowerNationLink(props: PowerNationLinkProps) {
  const {
    powerId,
    children,
    className = '',
    disabled = false,
    disabledTitle,
  } = props;
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const role = POWER_ROLE_JA[powerId] ?? '指導者';

  const mergedClass =
    disabled && className.length > 0
      ? `${className} cursor-not-allowed opacity-45`
      : disabled
        ? 'cursor-not-allowed rounded-lg bg-zinc-400 px-3 py-1.5 text-xs font-semibold text-white opacity-70'
        : className;

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        title={disabled ? disabledTitle : undefined}
        className={mergedClass}
        onClick={() => {
          if (disabled) {
            return;
          }
          dialogRef.current?.showModal();
        }}
      >
        {children}
      </button>
      <dialog
        ref={dialogRef}
        className="fixed left-1/2 top-1/2 z-[200] m-0 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-zinc-200 bg-white p-4 text-zinc-900 shadow-xl [&::backdrop]:bg-black/40"
      >
        <p className="text-sm font-medium leading-relaxed">
          <PowerLabelText powerId={powerId} />
          の{role}ですか？
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
            onClick={() => dialogRef.current?.close()}
          >
            いいえ
          </button>
          <button
            type="button"
            className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-500"
            onClick={() => {
              dialogRef.current?.close();
              router.push(`/power/${powerId}`);
            }}
          >
            はい
          </button>
        </div>
      </dialog>
    </>
  );
}
