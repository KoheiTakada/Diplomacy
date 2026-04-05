/**
 * オンライン卓 API: スナップショット取得・ホストによる全体上書き
 *
 * 概要:
 *   GET は `t`（統一トークン）または従来の hostSecret / powerId+powerSecret で読み取り。
 *   成功時は `onlineAuth` でホストかどの国かを返す（クライアントが URL の `t` だけで参加するため）。
 *   PUT はホストのみ、楽観的ロック付きで全体置換。
 *
 * 想定される制限事項:
 *   - GET の `t` 等は API 呼び出し用。共有用 URL のクエリに秘密を載せないこと。
 *   - HTTPS 必須。
 */

import {
  normalizeLoadedSnapshot,
  serializeSnapshotForStorage,
  tryParsePersistedSnapshotJson,
  type PersistedSnapshot,
} from '@/lib/persistedSnapshot';
import { hashSecret } from '@/lib/server/secretHash';
import {
  getSupabaseAdmin,
  isSupabaseOnlineConfigured,
} from '@/lib/server/supabaseAdmin';
import { NextResponse } from 'next/server';

const uuidRe =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RoomRow = {
  id: string;
  host_secret_hash: string;
  snapshot_json: string;
  version: number;
  updated_at: string;
};

async function loadRoom(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  roomId: string,
): Promise<RoomRow | null> {
  const { data, error } = await supabase
    .from('diplomacy_online_rooms')
    .select('id, host_secret_hash, snapshot_json, version, updated_at')
    .eq('id', roomId)
    .maybeSingle();
  if (error != null || data == null) {
    return null;
  }
  return data as RoomRow;
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ roomId: string }> },
) {
  if (!isSupabaseOnlineConfigured()) {
    return NextResponse.json({ error: 'オンライン未設定' }, { status: 503 });
  }
  const { roomId } = await ctx.params;
  if (!uuidRe.test(roomId)) {
    return NextResponse.json({ error: 'roomId が不正です' }, { status: 400 });
  }

  const url = new URL(req.url);
  const tParam = url.searchParams.get('t');
  const hostSecret = url.searchParams.get('hostSecret');
  const powerId = url.searchParams.get('powerId');
  const powerSecret = url.searchParams.get('powerSecret');

  const supabase = getSupabaseAdmin();
  const row = await loadRoom(supabase, roomId);
  if (row == null) {
    return NextResponse.json({ error: '卓が見つかりません' }, { status: 404 });
  }

  type OnlineAuthPayload =
    | { role: 'host' }
    | { role: 'power'; powerId: string };
  let onlineAuth: OnlineAuthPayload | null = null;
  let authorized = false;

  if (tParam != null && tParam.length > 0) {
    const h = hashSecret(tParam);
    if (h === row.host_secret_hash) {
      authorized = true;
      onlineAuth = { role: 'host' };
    } else {
      const { data: prowList } = await supabase
        .from('diplomacy_online_room_power_secrets')
        .select('power_id, secret_hash')
        .eq('room_id', roomId);
      for (const pr of prowList ?? []) {
        const rec = pr as { power_id: string; secret_hash: string };
        if (rec.secret_hash === h) {
          authorized = true;
          onlineAuth = { role: 'power', powerId: rec.power_id };
          break;
        }
      }
    }
  } else {
    if (hostSecret != null && hostSecret.length > 0) {
      if (hashSecret(hostSecret) === row.host_secret_hash) {
        authorized = true;
        onlineAuth = { role: 'host' };
      }
    }
    if (
      !authorized &&
      powerId != null &&
      powerSecret != null &&
      powerSecret.length > 0
    ) {
      const { data: sec } = await supabase
        .from('diplomacy_online_room_power_secrets')
        .select('secret_hash')
        .eq('room_id', roomId)
        .eq('power_id', powerId)
        .maybeSingle();
      if (
        sec != null &&
        (sec as { secret_hash: string }).secret_hash === hashSecret(powerSecret)
      ) {
        authorized = true;
        onlineAuth = { role: 'power', powerId };
      }
    }
  }

  if (!authorized || onlineAuth == null) {
    return NextResponse.json({ error: '認証に失敗しました' }, { status: 401 });
  }

  return NextResponse.json({
    version: row.version,
    snapshotJson: row.snapshot_json,
    updatedAtIso: row.updated_at,
    onlineAuth,
  });
}

type PutBody = {
  hostSecret?: string;
  expectedVersion?: number;
  snapshotJson?: string;
};

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ roomId: string }> },
) {
  if (!isSupabaseOnlineConfigured()) {
    return NextResponse.json({ error: 'オンライン未設定' }, { status: 503 });
  }
  const { roomId } = await ctx.params;
  if (!uuidRe.test(roomId)) {
    return NextResponse.json({ error: 'roomId が不正です' }, { status: 400 });
  }

  let body: PutBody;
  try {
    body = (await req.json()) as PutBody;
  } catch {
    return NextResponse.json({ error: 'JSON が不正です' }, { status: 400 });
  }

  if (
    body.hostSecret == null ||
    typeof body.expectedVersion !== 'number' ||
    body.snapshotJson == null
  ) {
    return NextResponse.json({ error: 'パラメータ不足' }, { status: 400 });
  }

  const parsed = tryParsePersistedSnapshotJson(body.snapshotJson);
  if (parsed == null) {
    return NextResponse.json({ error: 'snapshotJson が無効です' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const row = await loadRoom(supabase, roomId);
  if (row == null) {
    return NextResponse.json({ error: '卓が見つかりません' }, { status: 404 });
  }

  if (hashSecret(body.hostSecret) !== row.host_secret_hash) {
    return NextResponse.json({ error: 'ホスト認証に失敗しました' }, { status: 401 });
  }

  if (row.version !== body.expectedVersion) {
    return NextResponse.json(
      { error: '版が一致しません（他プレイヤーが先に更新しました）', code: 'VERSION_CONFLICT' },
      { status: 409 },
    );
  }

  const normalized = normalizeLoadedSnapshot(parsed as PersistedSnapshot);
  const snapshotJson = serializeSnapshotForStorage(normalized);
  const nextVersion = body.expectedVersion + 1;
  const updatedAtIso = new Date().toISOString();

  const { data: updated, error } = await supabase
    .from('diplomacy_online_rooms')
    .update({
      snapshot_json: snapshotJson,
      version: nextVersion,
      updated_at: updatedAtIso,
    })
    .eq('id', roomId)
    .eq('version', body.expectedVersion)
    .select('version, updated_at')
    .maybeSingle();

  if (error != null) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (updated == null) {
    return NextResponse.json(
      { error: '版が一致しません', code: 'VERSION_CONFLICT' },
      { status: 409 },
    );
  }

  return NextResponse.json({
    version: (updated as { version: number }).version,
    updatedAtIso: (updated as { updated_at: string }).updated_at,
  });
}
