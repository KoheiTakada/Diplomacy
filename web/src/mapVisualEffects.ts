/**
 * 地図上の演出用メタデータ（解決表示と MapView の連携）
 *
 * 概要:
 *   盤面状態だけでは表現できない「意図した移動先」や「輸送経路」を MapView に渡す。
 *
 * 制限:
 *   1 回の盤面更新でユニットあたり 1 件までを想定（page 側で上書き）。
 */

/**
 * マップに適用する単発演出。
 */
export type MapVisualEffect =
  | {
      id: string;
      type: 'standoffBounce';
      unitId: string;
      targetProvinceId: string;
    }
  | {
      id: string;
      /** 同一マスを狙ってスタンドオフした複数ユニットが、目標州のアンカーへ寄ってぶつかる */
      type: 'standoffCollision';
      unitIds: string[];
      targetProvinceId: string;
    }
  | {
      id: string;
      type: 'convoyAlongPath';
      unitId: string;
      pathProvinceIds: string[];
    }
  | {
      id: string;
      /** 支援元→支援先を結ぶ線。durationMs 間、毎フレーム座標を追従 */
      type: 'supportLink';
      supporterUnitId: string;
      supportedUnitId: string;
      durationMs: number;
      /** true のとき期限なし（supportLinkRevoke まで残す。カット演出の暫定線用） */
      tentative?: boolean;
      /**
       * true のとき、線の伸長完了で被支援ユニットの記号を一段拡大する。
       */
      boostSupportedBadge?: boolean;
      /**
       * boostSupportedBadge 時のみ有効。true（省略時）: 線は release / revoke まで残す（移動支援）。
       * false: durationMs で線を消し、消えるときに拡大を 1 段戻す（維持支援）。
       */
      linePersistsUntilRelease?: boolean;
    }
  | {
      id: string;
      /** 対応する supportLink を即時に消す（支援カット時、攻撃行の直前など） */
      type: 'supportLinkRevoke';
      supporterUnitId: string;
      supportedUnitId: string;
    }
  | {
      id: string;
      /**
       * delayMs 後に、当該ユニットを被支援とする移動支援線をすべて消し、記号拡大も戻す。
       * 移動（またはスタンドオフ）アニメの長さに合わせて page から送る。
       */
      type: 'releaseSupportVisualsAfterMove';
      unitId: string;
      delayMs: number;
    };
