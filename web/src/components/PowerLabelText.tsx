/**
 * 勢力の日本語名を表示するインライン要素
 *
 * 概要:
 *   `POWER_META` の `label` を基本とし、`labelCompact` がある国は
 *   画面幅が狭いとき（Tailwind `sm` 未満）だけ略称を出す。
 *
 * 主な機能:
 *   - レスポンシブな国名表示
 *
 * 想定される制限事項:
 *   - ブレークポイントは `sm` 固定。コンテナ幅には追従しない。
 */

import { POWER_META } from '@/diplomacy/gameHelpers';

type PowerLabelTextProps = {
  /** 勢力 ID（例: ENG） */
  powerId: string;
  /** ルート要素に付与する className */
  className?: string;
};

/**
 * 勢力名ラベル（狭い幅では略称）。
 *
 * @param props - powerId / className
 * @returns span 要素
 */
export function PowerLabelText(props: PowerLabelTextProps) {
  const { powerId, className } = props;
  const meta = POWER_META[powerId];
  const label = meta?.label ?? powerId;
  const compact = meta?.labelCompact;
  if (compact == null) {
    return <span className={className}>{label}</span>;
  }
  return (
    <span className={className}>
      <span className="inline sm:hidden">{compact}</span>
      <span className="hidden sm:inline">{label}</span>
    </span>
  );
}
