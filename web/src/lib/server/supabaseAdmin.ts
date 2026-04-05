/**
 * Supabase 管理クライアント（service_role・サーバー専用）
 *
 * 概要:
 *   Route Handler からオンライン卓テーブルへアクセスする。
 *
 * 主な機能:
 *   - 環境変数検証付きクライアント生成
 *
 * 想定される制限事項:
 *   - `SUPABASE_SERVICE_ROLE_KEY` をクライアントバンドルに含めないこと。
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null = null;

/**
 * service_role の Supabase クライアントを返す（シングルトン）。
 *
 * @returns Supabase クライアント
 * @throws 必須環境変数が無い場合
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (cached != null) {
    return cached;
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url == null || url.length === 0) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL が設定されていません');
  }
  if (serviceKey == null || serviceKey.length === 0) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY が設定されていません');
  }
  cached = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

/**
 * Supabase オンライン機能がサーバーで利用可能か。
 *
 * @returns 環境変数が揃っていれば true
 */
export function isSupabaseOnlineConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return (
    url != null &&
    url.length > 0 &&
    serviceKey != null &&
    serviceKey.length > 0
  );
}
