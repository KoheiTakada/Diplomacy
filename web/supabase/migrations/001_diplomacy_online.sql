-- オンライン卓用テーブル（Next.js API が service_role でのみアクセスする想定）
-- Supabase SQL Editor または migration で実行してください。

create table if not exists public.diplomacy_online_rooms (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  host_secret_hash text not null,
  snapshot_json text not null,
  version int not null default 1
);

create table if not exists public.diplomacy_online_room_power_secrets (
  room_id uuid not null references public.diplomacy_online_rooms (id) on delete cascade,
  power_id text not null,
  secret_hash text not null,
  primary key (room_id, power_id)
);

create index if not exists diplomacy_online_room_power_secrets_room_id_idx
  on public.diplomacy_online_room_power_secrets (room_id);

comment on table public.diplomacy_online_rooms is 'Diplomacy オンライン卓の共有スナップショット';
comment on table public.diplomacy_online_room_power_secrets is '各国参加用シークレット（SHA-256 ハッシュのみ保存）';
 