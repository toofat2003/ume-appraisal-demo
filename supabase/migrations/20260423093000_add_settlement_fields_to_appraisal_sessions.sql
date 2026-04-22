alter table public.appraisal_sessions
  add column if not exists offer_price integer,
  add column if not exists contract_price integer,
  add column if not exists is_excluded boolean not null default false;

create index if not exists appraisal_sessions_is_excluded_idx
  on public.appraisal_sessions (is_excluded);

comment on column public.appraisal_sessions.offer_price is
  'Manual offer amount presented to the seller in USD.';

comment on column public.appraisal_sessions.contract_price is
  'Manual final contracted amount in USD.';

comment on column public.appraisal_sessions.is_excluded is
  'Whether the item is excluded from appointment totals.';
