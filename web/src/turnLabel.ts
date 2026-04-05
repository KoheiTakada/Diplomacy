/**
 * 盤面のターン情報を UI 用の日本語ラベルに変換する。
 *
 * @param board - 現在の BoardState
 * @returns 「1901年 春」形式の文字列
 */
import { type BoardState, Season } from '@/domain';

export function turnLabel(board: BoardState): string {
  const seasonText = board.turn.season === Season.Spring ? '春' : '秋';
  return `${board.turn.year}年 ${seasonText}`;
}
