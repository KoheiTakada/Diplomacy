/**
 * オンライン卓 API: 各国プレイヤーによる部分更新（PATCH）
 *
 * 概要:
 *   勢力シークレットで認証し、自国の命令・調整・退却入力のみマージする。
 *   版は卓全体で1つだが、同時 PATCH が衝突したときはサーバー内で再試行し、
 *   最大7人がほぼ同時に送っても順にマージして版を進める（クライアント409地獄を防ぐ）。
 *
 * 想定される制限事項:
 *   - 盤面本体の変更は不可（ホストの PUT のみ）。
 *   - 再試行上限を超えた場合は 503（クライアントは従来どおり再送可能）。
 */

import {
  normalizeLoadedSnapshot,
  serializeSnapshotForStorage,
  tryParsePersistedSnapshotJson,
  type PersistedSnapshot,
} from '@/lib/persistedSnapshot';
import type { OnlinePowerPatchBody } from '@/lib/onlinePowerPatchTypes';
import { applyPowerPatchToSnapshot } from '@/lib/server/onlinePowerPatch';
import { hashSecret } from '@/lib/server/secretHash';
import {
  getSupabaseAdmin,
  isSupabaseOnlineConfigured,
} from '@/lib/server/supabaseAdmin';
import { NextResponse } from 'next/server';

const uuidRe =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** 同時 PATCH 時の楽観的ロック再試行上限（卓7人＋余裕） */
const POWER_PATCH_CAS_MAX_ATTEMPTS = 40;

export async function PATCH(
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

  let body: OnlinePowerPatchBody;
  try {
    body = (await req.json()) as OnlinePowerPatchBody;
  } catch {
    return NextResponse.json({ error: 'JSON が不正です' }, { status: 400 });
  }

  if (
    body.powerId == null ||
    body.powerSecret == null ||
    typeof body.expectedVersion !== 'number'
  ) {
    return NextResponse.json({ error: 'パラメータ不足' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  const { data: secRow, error: secErr } = await supabase
    .from('diplomacy_online_room_power_secrets')
    .select('secret_hash')
    .eq('room_id', roomId)
    .eq('power_id', body.powerId)
    .maybeSingle();

  if (secErr != null || secRow == null) {
    return NextResponse.json({ error: '勢力または卓が無効です' }, { status: 403 });
  }

  if (
    (secRow as { secret_hash: string }).secret_hash !==
    hashSecret(body.powerSecret)
  ) {
    return NextResponse.json({ error: '勢力シークレットが一致しません' }, { status: 401 });
  }

  const patchInput: Omit<OnlinePowerPatchBody, 'powerSecret' | 'expectedVersion'> =
    {
      powerId: body.powerId,
      unitOrders: body.unitOrders,
      powerOrderSaved: body.powerOrderSaved,
      powerAdjustmentSaved: body.powerAdjustmentSaved,
      powerRetreatSaved: body.powerRetreatSaved,
      buildPlan: body.buildPlan,
      disbandPlan: body.disbandPlan,
      retreatTargets: body.retreatTargets,
      treaties: body.treaties,
      treatyViolations: body.treatyViolations,
    };

  for (let attempt = 0; attempt < POWER_PATCH_CAS_MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, Math.min(60, 4 * attempt)));
    }

    const { data: roomRow, error: roomErr } = await supabase
      .from('diplomacy_online_rooms')
      .select('snapshot_json, version')
      .eq('id', roomId)
      .maybeSingle();

    if (roomErr != null || roomRow == null) {
      return NextResponse.json({ error: '卓が見つかりません' }, { status: 404 });
    }

    const currentVersion = (roomRow as { version: number }).version;

    const snap = tryParsePersistedSnapshotJson(
      (roomRow as { snapshot_json: string }).snapshot_json,
    );
    if (snap == null) {
      return NextResponse.json(
        { error: 'サーバー上のデータが壊れています' },
        { status: 500 },
      );
    }

    let merged: PersistedSnapshot;
    try {
      merged = applyPowerPatchToSnapshot(normalizeLoadedSnapshot(snap), patchInput);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'パッチが無効です';
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    const snapshotJson = serializeSnapshotForStorage(merged);
    const nextVersion = currentVersion + 1;
    const updatedAtIso = new Date().toISOString();

    const { data: updated, error: upErr } = await supabase
      .from('diplomacy_online_rooms')
      .update({
        snapshot_json: snapshotJson,
        version: nextVersion,
        updated_at: updatedAtIso,
      })
      .eq('id', roomId)
      .eq('version', currentVersion)
      .select('version, updated_at')
      .maybeSingle();

    if (upErr != null) {
      return NextResponse.json({ error: upErr.message }, { status: 500 });
    }
    if (updated != null) {
      return NextResponse.json({
        version: (updated as { version: number }).version,
        updatedAtIso: (updated as { updated_at: string }).updated_at,
      });
    }
  }

  return NextResponse.json(
    {
      error:
        '同時更新が集中しました。しばらく待ってからもう一度お試しください。',
      code: 'PATCH_RETRY_EXHAUSTED',
    },
    { status: 503 },
  );
}
