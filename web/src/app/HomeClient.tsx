/**
 * ディプロマシー支援ツール ルートページのクライアント部分
 *
 * 概要:
 *   タイトル画面とゲーム本体を `gameSessionActive` で切り替える。
 *   シークレットは URL に含めない（タイトルからの参加と sessionStorage / メモリのみ）。
 *
 * 主な機能:
 *   - タイトル / メインの表示切り替え
 *
 * 想定される制限事項:
 *   - オンライン参加はトップのフォームまたはメモの手入力が必要（共有リンクに秘密を載せない）。
 */

'use client';

import { MainDiplomacyHome } from '@/components/MainDiplomacyHome';
import { TitleScreen } from '@/components/TitleScreen';
import { useDiplomacyGame } from '@/context/DiplomacyGameContext';

/**
 * ルートの対話 UI。
 *
 * @returns タイトルまたはメイン
 */
export default function HomeClient() {
  const { gameSessionActive } = useDiplomacyGame();

  if (!gameSessionActive) {
    return <TitleScreen />;
  }

  return <MainDiplomacyHome />;
}
