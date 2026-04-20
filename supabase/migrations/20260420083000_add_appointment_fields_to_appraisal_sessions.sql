alter table public.appraisal_sessions
  add column if not exists appointment_id text,
  add column if not exists appointment_label text;

create index if not exists appraisal_sessions_appointment_id_idx
  on public.appraisal_sessions (appointment_id);

comment on column public.appraisal_sessions.appointment_id is
  'Client-generated identifier used to group appraisals from the same appointment/household visit.';

comment on column public.appraisal_sessions.appointment_label is
  'Human-readable appointment label such as a customer or household name.';
