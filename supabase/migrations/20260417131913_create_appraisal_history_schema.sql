create extension if not exists pgcrypto;

create table if not exists public.appraisal_sessions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default timezone('utc', now()),
  item_name text not null,
  brand text not null default '',
  model text not null default '',
  category text not null,
  category_group text not null,
  condition_summary text not null default '',
  confidence numeric(5, 4) not null,
  search_query text not null,
  reasoning text not null default '',
  suggested_max_price integer not null,
  buy_price_range_low integer not null,
  buy_price_range_high integer not null,
  low_price integer not null,
  median_price integer not null,
  high_price integer not null,
  listing_count integer not null,
  raw_result_json jsonb not null default '{}'::jsonb
);

create table if not exists public.appraisal_images (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.appraisal_sessions(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  slot_label text not null,
  position integer not null,
  storage_path text not null unique,
  public_url text not null,
  mime_type text
);

create index if not exists appraisal_sessions_created_at_idx
  on public.appraisal_sessions (created_at desc);

create index if not exists appraisal_images_session_id_position_idx
  on public.appraisal_images (session_id, position);

alter table public.appraisal_sessions enable row level security;
alter table public.appraisal_images enable row level security;

comment on table public.appraisal_sessions is
  'Appraisal history master table for POC sessions.';

comment on table public.appraisal_images is
  'Uploaded appraisal photos stored in Supabase Storage and referenced from sessions.';
