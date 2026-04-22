alter table public.appraisal_sessions
  add column if not exists manual_max_price integer;

comment on column public.appraisal_sessions.manual_max_price is
  'Manual override for Max price in USD. When present, appointment totals use this value instead of suggested_max_price.';
