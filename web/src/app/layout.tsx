/**
 * ルートレイアウト
 *
 * 概要:
 *   全ページ共通のフォント・プロバイダ・メタデータを定義する。
 *
 * 主な機能:
 *   - タブタイトル・OG/Twitter プレビュー用の metadata
 *   - metadataBase は本番 URL 解決用（Vercel または NEXT_PUBLIC_SITE_URL）
 *
 * 想定される制限事項:
 *   - ローカルでは metadataBase が localhost になりうる。
 */

import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { DiplomacyGameProvider } from "@/context/DiplomacyGameContext";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * 本番・プレビューで絶対 URL を組み立てるためのベース。
 *
 * @returns アプリのオリジン
 */
function getMetadataBaseUrl(): URL {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit != null && explicit.length > 0) {
    return new URL(explicit);
  }
  const vercel = process.env.VERCEL_URL;
  if (vercel != null && vercel.length > 0) {
    return new URL(`https://${vercel}`);
  }
  return new URL("http://localhost:3000");
}

const siteDescription =
  "ディプロマシー（ボードゲーム）のオンライン卓支援。Create room / Join room でプレイできます。";

export const metadata: Metadata = {
  metadataBase: getMetadataBaseUrl(),
  title: {
    default: "Diplomacy",
    template: "%s · Diplomacy",
  },
  description: siteDescription,
  applicationName: "Diplomacy",
  openGraph: {
    title: "Diplomacy",
    description: siteDescription,
    type: "website",
    locale: "ja_JP",
    siteName: "Diplomacy",
  },
  twitter: {
    card: "summary_large_image",
    title: "Diplomacy",
    description: siteDescription,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <DiplomacyGameProvider>{children}</DiplomacyGameProvider>
      </body>
    </html>
  );
}
