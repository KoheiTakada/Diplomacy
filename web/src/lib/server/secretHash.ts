/**
 * オンライン卓トークンのハッシュ・生成（サーバー専用）
 *
 * 概要:
 *   平文トークンは DB に保存せず SHA-256 ハッシュのみ保持する。
 *
 * 主な機能:
 *   - `hashSecret` / `generateOpaqueToken`
 *
 * 想定される制限事項:
 *   - Node.js の crypto に依存（Edge では別実装が必要）。
 */

import { createHash, randomBytes } from 'crypto';

/**
 * UTF-8 文字列を SHA-256 16進ハッシュにする。
 *
 * @param plain - 平文
 * @returns 小文字16進ハッシュ
 */
export function hashSecret(plain: string): string {
  return createHash('sha256').update(plain, 'utf8').digest('hex');
}

/**
 * 推測困難なトークンを生成する（base64url）。
 *
 * @returns 平文トークン
 */
export function generateOpaqueToken(): string {
  return randomBytes(24).toString('base64url');
}
