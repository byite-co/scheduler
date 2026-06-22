-- M3 stage 1: timer state for start/pause/resume/end without camera capture.

alter table study_sessions
  add column if not exists timer_state text not null default 'completed',
  add column if not exists last_resumed_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'study_sessions_timer_state_check'
  ) then
    alter table study_sessions
      add constraint study_sessions_timer_state_check
      check (timer_state in ('running', 'paused', 'completed'));
  end if;
end $$;

update study_sessions
set
  timer_state = case when ended_at is null then 'running' else 'completed' end,
  last_resumed_at = case when ended_at is null then coalesce(last_resumed_at, started_at) else null end
where timer_state = 'completed'
  and ended_at is null;

create index if not exists sessions_student_active_timer_idx
  on study_sessions (student_id, timer_state, started_at)
  where ended_at is null;
