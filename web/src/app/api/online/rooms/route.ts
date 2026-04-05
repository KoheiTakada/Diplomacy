/**
 * オンライン卓 API: 卓の新規作成（POST）
 *
 * 概要:
 *   初期スナップショットとホスト・各国用シークレットを発行し Supabase に保存する。
 *
 * 主な機能:
 *   - POST JSON `{ snapshotJson }` で卓作成
 *
 * 想定される制限事項:
 *   - 環境変数未設定時は 503。
 */

import { POWERS } from '@/miniMap';
import {
  serializeSnapshotForStorage,
  tryParsePersistedSnapshotJson,
} from '@/lib/persistedSnapshot';
import { generateOpaqueToken, hashSecret } from '@/lib/server/secretHash';
import {
  getSupabaseAdmin,
  isSupabaseOnlineConfigured,
} from '@/lib/server/supabaseAdmin';
import { NextResponse } from 'next/server';

type PostBody = {
  snapshotJson?: string;
  worldlineStem?: string;
};

export async function POST(req: Request) {
  if (!isSupabaseOnlineConfigured()) {
    return NextResponse.json(
      { error: 'オンライン機能の環境変数が未設定です（Supabase）。' },
      { status: 503 },
    );
  }

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: 'JSON が不正です' }, { status: 400 });
  }

  const raw = body.snapshotJson;
  if (raw == null || typeof raw !== 'string' || raw.length === 0) {
    return NextResponse.json(
      { error: 'snapshotJson が必要です' },
      { status: 400 },
    );
  }

  const parsed = tryParsePersistedSnapshotJson(raw);
  if (parsed == null) {
    return NextResponse.json(
      { error: 'snapshotJson が v:1 スナップショットとして無効です' },
      { status: 400 },
    );
  }

  if (
    body.worldlineStem != null &&
    typeof body.worldlineStem === 'string' &&
    body.worldlineStem.length > 0
  ) {
    parsed.worldlineStem = body.worldlineStem;
  }

  const snapshotJson = serializeSnapshotForStorage(parsed);
  const hostSecret = generateOpaqueToken();
  const hostSecretHash = hashSecret(hostSecret);

  const powerSecrets: Record<string, string> = {};
  const powerRows: { room_id: string; power_id: string; secret_hash: string }[] =
    [];

  const supabase = getSupabaseAdmin();

  const { data: roomRow, error: insErr } = await supabase
    .from('diplomacy_online_rooms')
    .insert({
      host_secret_hash: hostSecretHash,
      snapshot_json: snapshotJson,
      version: 1,
    })
    .select('id, version, updated_at')
    .single();

  if (insErr != null || roomRow == null) {
    return NextResponse.json(
      { error: `卓の作成に失敗しました: ${insErr?.message ?? 'unknown'}` },
      { status: 500 },
    );
  }

  const roomId = roomRow.id as string;

  for (const pid of POWERS) {
    const t = generateOpaqueToken();
    powerSecrets[pid] = t;
    powerRows.push({
      room_id: roomId,
      power_id: pid,
      secret_hash: hashSecret(t),
    });
  }

  const { error: pwErr } = await supabase
    .from('diplomacy_online_room_power_secrets')
    .insert(powerRows);

  if (pwErr != null) {
    await supabase.from('diplomacy_online_rooms').delete().eq('id', roomId);
    return NextResponse.json(
      { error: `各国シークレットの保存に失敗しました: ${pwErr.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({
    roomId,
    hostSecret,
    powerSecrets,
    version: roomRow.version as number,
    snapshotJson,
    updatedAtIso: roomRow.updated_at as string,
  });
}
