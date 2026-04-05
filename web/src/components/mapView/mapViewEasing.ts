/**
 * MapView SVG アニメーション用のイージング関数
 *
 * 概要:
 *   ユニット移動・スタンドオフ・支援線伸長・バッジスケールで共通利用する補間。
 *
 * @packageDocumentation
 */

/**
 * ease-out cubic（t=0..1）。
 *
 * @param t - 正規化時刻
 * @returns 補間係数
 */
export function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

/**
 * ease-in cubic（t=0..1）。
 *
 * @param t - 正規化時刻
 * @returns 補間係数
 */
export function easeInCubic(t: number): number {
  return t * t * t;
}

/**
 * 支援線の伸長用イージング（0..1）。
 *
 * @param t - 正規化時刻
 */
export function easeOutCubicForSupportLine(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return 1 - (1 - x) ** 3;
}
