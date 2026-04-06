/**
 * オンライン卓の参加情報を「プレイヤーへそのまま送る」用テキストに整形する。
 *
 * 概要:
 *   ホスト用ブロックと各国用ブロックを並べ、それぞれ卓IDとシークレットを含める。
 *
 * 主な機能:
 *   - `buildOnlineRoomInviteCopyText` でコピー用1本の文字列を生成
 *
 * 想定される制限事項:
 *   - `powerSecrets` が null や欠損のときは各国行のシークレットが空になる。
 *   - 国名は `POWER_META` の表示名に依存する。
 */

import { POWER_META } from '@/diplomacy/gameHelpers';
import { POWERS } from '@/miniMap';

/**
 * 卓ID・ホストシークレット・各国シークレットから、配布用のコピペテキストを組み立てる。
 *
 * @param roomId - 卓 UUID
 * @param hostSecret - ホスト用平文シークレット
 * @param powerSecrets - 勢力 ID → 各国用平文。未保持時は null
 * @returns 末尾改行付きの全文
 */
export function buildOnlineRoomInviteCopyText(
  roomId: string,
  hostSecret: string,
  powerSecrets: Record<string, string> | null,
): string {
  const blocks: string[] = [
    '■ホスト',
    `卓ID: ${roomId}`,
    `ホスト用シークレット: ${hostSecret}`,
    '',
  ];
  for (const pid of POWERS) {
    const label = POWER_META[pid]?.label ?? pid;
    const tok = powerSecrets?.[pid] ?? '';
    blocks.push(
      `■${label}`,
      `卓ID: ${roomId}`,
      `${label}用シークレット: ${tok}`,
      '',
    );
  }
  return blocks.join('\n').trimEnd() + '\n';
}
