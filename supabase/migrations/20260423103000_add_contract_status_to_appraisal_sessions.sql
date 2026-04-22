alter table public.appraisal_sessions
  add column if not exists is_contracted boolean not null default false;

create index if not exists appraisal_sessions_is_contracted_idx
  on public.appraisal_sessions (is_contracted);

comment on column public.appraisal_sessions.is_contracted is
  'Whether the item was contracted. Offer price is used as the contracted amount.';
