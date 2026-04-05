/**
 * 単一勢力向けの秘密入力ページ
 *
 * 概要:
 *   クライアント処理は `PowerPageClient` に分離する。
 */

import PowerPageClient from './PowerPageClient';

/**
 * `/power/[powerId]` のエントリ。
 *
 * @returns 勢力別 UI
 */
export default function PowerPage() {
  return <PowerPageClient />;
}
