/**
 * MapView 周辺で共有する幾何・レイヤー用の型定義
 *
 * 概要:
 *   SVG ユーザー座標、ユニットアンカー、viewBox、複製用アイコンテンプレの型を集約する。
 *
 * 制限:
 *   ドメインの BoardState 等とは別層の表示用型のみを置く。
 */

/**
 * SVG ユーザー座標上の 2 次元点。
 */
export type Vec2 = { x: number; y: number };

/**
 * 陸軍用・海軍用のユニット基準座標。
 * fleet のキーは州 ID、または分割岸用 `州ID|NC` 形式（data-fleet-coast 相当）。
 */
export type AnchorLayers = {
  army: Record<string, Vec2>;
  fleet: Record<string, Vec2>;
};

/**
 * SVG viewBox の数値表現（x, y, width, height）。
 */
export type ViewBox = { x: number; y: number; w: number; h: number };

/**
 * ユニットアイコン SVG テンプレート（fetch 済みのルート要素を cloneNode で複製する）。
 */
export type UnitIconTemplates = {
  army: SVGSVGElement;
  fleet: SVGSVGElement;
};
