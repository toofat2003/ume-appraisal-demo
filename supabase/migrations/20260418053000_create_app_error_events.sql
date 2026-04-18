create table if not exists public.app_error_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default timezone('utc', now()),
  request_id uuid,
  severity text not null default 'error',
  source text not null,
  route text not null,
  message text not null,
  error_name text not null default '',
  stack text,
  user_agent text,
  client_session_id text,
  url text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists app_error_events_created_at_idx
  on public.app_error_events (created_at desc);

create index if not exists app_error_events_request_id_idx
  on public.app_error_events (request_id);

create index if not exists app_error_events_source_idx
  on public.app_error_events (source);

alter table public.app_error_events enable row level security;

comment on table public.app_error_events is
  'Production error and warning events for API and client-side failures.';
