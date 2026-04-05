/**
 * SNS・チャット共有時のプレビュー画像（OG / Twitter 等）
 *
 * 概要:
 *   1200×630 のカード風ビジュアルを動的生成する。
 *
 * 主な機能:
 *   - next/og の ImageResponse で PNG を返す
 *
 * 想定される制限事項:
 *   - 利用可能なのはインラインスタイルと限定的なレイアウトのみ。
 */

import { ImageResponse } from 'next/og';

/** 推奨 OG サイズ（px） */
export const size = {
  width: 1200,
  height: 630,
};

/** MIME タイプ */
export const contentType = 'image/png';

/** アクセシビリティ用の代替テキスト */
export const alt = 'Diplomacy';

/**
 * Open Graph 用のプレビュー画像を生成する。
 *
 * @returns PNG バイナリ相当のレスポンス
 */
export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(165deg, #fafafa 0%, #e4e4e7 45%, #d4d4d8 100%)',
          position: 'relative',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 6,
            background: 'linear-gradient(90deg, #7c3aed 0%, #a78bfa 50%, #7c3aed 100%)',
          }}
        />
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '48px 64px',
          }}
        >
          <div
            style={{
              fontSize: 96,
              fontWeight: 700,
              letterSpacing: '-0.04em',
              color: '#18181b',
              lineHeight: 1.05,
            }}
          >
            Diplomacy
          </div>
          <div
            style={{
              marginTop: 20,
              width: 120,
              height: 4,
              borderRadius: 2,
              background: '#7c3aed',
            }}
          />
          <div
            style={{
              marginTop: 28,
              fontSize: 30,
              fontWeight: 500,
              color: '#52525b',
              letterSpacing: '0.02em',
            }}
          >
            Online rooms · Classic map
          </div>
          <div
            style={{
              marginTop: 14,
              fontSize: 22,
              fontWeight: 400,
              color: '#71717a',
            }}
          >
            Create room / Join room
          </div>
        </div>
        <div
          style={{
            position: 'absolute',
            bottom: 36,
            left: 0,
            right: 0,
            display: 'flex',
            justifyContent: 'center',
            fontSize: 18,
            color: '#a1a1aa',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
          }}
        >
          Board game assistant
        </div>
      </div>
    ),
    {
      ...size,
    },
  );
}
