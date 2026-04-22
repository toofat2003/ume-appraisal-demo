alter table public.appraisal_sessions
  add column if not exists condition_rank text;

do $$
begin
  alter table public.appraisal_sessions
    add constraint appraisal_sessions_condition_rank_check
    check (condition_rank is null or condition_rank in ('A', 'B', 'C'));
exception
  when duplicate_object then null;
end $$;

comment on column public.appraisal_sessions.condition_rank is
  'Manual appraiser condition rank used to select Max price: A=0.6, B=0.5, C=0.2.';
