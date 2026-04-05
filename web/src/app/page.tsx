/**
 * ディプロマシー支援ツール ルートページ
 *
 * 概要:
 *   クライアント処理は `HomeClient` に分離する。
 */

import HomeClient from './HomeClient';

/**
 * アプリのルート。
 *
 * @returns ルート UI
 */
export default function Page() {
  return <HomeClient />;
}
