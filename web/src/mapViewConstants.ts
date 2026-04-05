/**
 * MapView および解決表示タイムラインと共有する地図用定数
 *
 * 概要:
 *   SVG パス、勢力色、ユニット記号寸法、支援線、アニメ時間を一箇所にまとめる。
 *
 * 制限:
 *   public 配下の SVG パスはビルド資産と一致させること。
 */

/** メイン地図 SVG（public） */
export const MAP_SVG_PATH = '/illustrator-map.svg';

/** 地図上の陸軍マーク（public の SVG） */
export const UNIT_ARMY_ICON_URL = '/unit-army-tank-icon.svg';

/** 地図上の海軍マーク（public の SVG） */
export const UNIT_FLEET_ICON_URL = '/unit-fleet-anchor-icon.svg';

/** ネスト SVG アイコンの幅・高さ（ユーザー座標） */
export const UNIT_ICON_PX = 20;

/**
 * 背景円の半径。アイコン表示枠の半分に揃え、円の塗りでできる「白い縁」を減らす。
 */
export const UNIT_BADGE_RADIUS = UNIT_ICON_PX / 2;

/**
 * 移動支援1件ごとのユニット記号スケール増分（移動・コンボイ演出中のみ適用）。
 * 上限は記号が過大にならないよう抑える。
 */
export const SUPPORT_MOVE_BADGE_SCALE_PER_SUPPORT = 0.1;
export const SUPPORT_MOVE_BADGE_SCALE_MAX = 1.9;

/** 支援線: 白下地の太さ（ユーザー座標） */
export const SUPPORT_LINE_STROKE_WHITE = 5.2;

/** 支援線: 勢力色ストロークの太さ（やや細くし白が縁に見える） */
export const SUPPORT_LINE_STROKE_COLOR = 4.4;

/** 破線 1 ダッシュ＋ギャップの合計に相当するパターン長 */
export const SUPPORT_LINE_DASH_UNIT = 10;

/** 支援線が被支援ユニットまで伸びる時間（ms） */
export const SUPPORT_LINE_GROW_MS = 480;

/** 被支援記号のスケール変化アニメーション時間（ms）。拡大は ease-out、縮小は ease-in */
export const BADGE_SCALE_ANIM_MS = 420;

/** 背景円の線色（白地と地図の区別用） */
export const UNIT_BADGE_STROKE = '#d4d4d8';

/**
 * 枠線の太さ。vector-effect と併用し、viewBox 拡大でも極細に近い見え方にする。
 */
export const UNIT_BADGE_STROKE_WIDTH = 0.1;

/** 勢力 ID → 地図上の代表色（HEX） */
export const POWER_COLORS: Record<string, string> = {
  ENG: '#ef4444',
  FRA: '#3b82f6',
  GER: '#0d9488',
  ITA: '#22c55e',
  AUS: '#eab308',
  RUS: '#a855f7',
  TUR: '#f97316',
};

/** SVG 名前空間 URI */
export const SVG_NS = 'http://www.w3.org/2000/svg';

/** ホイール／ボタンでの最大拡大時の viewBox 幅の下限（これ以上は拡大しない） */
export const MIN_W = 120;

/** 占領表現の塗り不透明度（境界線が残るよう 1 未満） */
export const OCCUPATION_FILL_OPACITY = '0.78';

/** 移動アニメーション時間（ミリ秒）。解決の1行表示間隔より短めにする */
export const UNIT_MOVE_ANIM_MS = 520;

/** スタンドオフ時の「ぶつかって戻る」全体時間 */
export const STANDOFF_BUMP_MS = 720;

/** コンボイ経路に沿って進む全体時間 */
export const CONVOY_PATH_MS = 900;

/** 同一座標とみなすしきい値（SVG ユーザー座標） */
export const UNIT_POS_EPS = 0.75;
