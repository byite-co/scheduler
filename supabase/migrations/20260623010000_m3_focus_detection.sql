-- M3 stage 2-B: on-device focus detection metadata only.
-- Camera media never leaves the device; only boolean check results and
-- aggregate numeric session metadata are persisted.

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'focus_checks'
      and policyname = 'focus_teacher_read_disclosed'
  ) then
    create policy focus_teacher_read_disclosed on focus_checks
      for select using (
        exists (
          select 1
          from study_sessions s
          join connections c
            on c.student_id = s.student_id
           and c.status = 'active'
          join disclosure_settings d
            on d.connection_id = c.id
          where s.id = focus_checks.session_id
            and c.teacher_id = auth.uid()
            and d.share_focus_data = true
        )
      );
  end if;
end $$;

drop function if exists record_focus_check(uuid, boolean, timestamptz);

create or replace function save_focus_check(
  p_session_id uuid,
  p_drowsy boolean,
  p_checked_at timestamptz default now()
)
returns table (
  session_id uuid,
  focus_score numeric,
  drowsy_count integer,
  check_total integer
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  session_student_id uuid;
  next_total integer;
  next_drowsy integer;
begin
  if auth.uid() is null then
    raise exception 'authentication_required';
  end if;

  select student_id
    into session_student_id
    from study_sessions
    where id = p_session_id
      and focus_mode = true
    for update;

  if session_student_id is null then
    raise exception 'focus_session_not_found';
  end if;

  if session_student_id <> auth.uid() then
    raise exception 'focus_session_owner_required';
  end if;

  insert into focus_checks (session_id, checked_at, drowsy)
  values (p_session_id, coalesce(p_checked_at, now()), coalesce(p_drowsy, false));

  select
    count(*)::integer,
    count(*) filter (where drowsy)::integer
    into next_total, next_drowsy
    from focus_checks
    where focus_checks.session_id = p_session_id;

  return query
    update study_sessions
      set check_total = next_total,
          drowsy_count = next_drowsy,
          focus_score = round(((next_total - next_drowsy)::numeric / greatest(next_total, 1)::numeric) * 100, 2)
      where id = p_session_id
      returning id, study_sessions.focus_score, study_sessions.drowsy_count, study_sessions.check_total;
end;
$$;

revoke all on function save_focus_check(uuid, boolean, timestamptz) from public;
grant execute on function save_focus_check(uuid, boolean, timestamptz) to authenticated;

drop view if exists v_teacher_focus_checks;
drop view if exists v_teacher_study_sessions;

create or replace view v_teacher_study_sessions as
  select
    s.id,
    s.student_id,
    s.subject,
    s.started_at,
    s.ended_at,
    s.duration_sec,
    s.timer_state,
    s.last_resumed_at,
    s.focus_mode,
    case when d.share_focus_data then s.focus_score else null end as focus_score,
    case when d.share_focus_data then s.drowsy_count else null end as drowsy_count,
    case when d.share_focus_data then s.check_total else null end as check_total,
    s.created_at,
    c.teacher_id
  from study_sessions s
  join connections c
    on c.student_id = s.student_id
   and c.status = 'active'
  join disclosure_settings d
    on d.connection_id = c.id
  where d.share_study_time = true
    and c.teacher_id = auth.uid();

grant select on v_teacher_study_sessions to authenticated;

create or replace view v_teacher_focus_checks as
  select
    fc.id,
    fc.session_id,
    fc.checked_at,
    fc.drowsy,
    c.teacher_id
  from focus_checks fc
  join study_sessions s
    on s.id = fc.session_id
  join connections c
    on c.student_id = s.student_id
   and c.status = 'active'
  join disclosure_settings d
    on d.connection_id = c.id
  where d.share_focus_data = true
    and c.teacher_id = auth.uid();

grant select on v_teacher_focus_checks to authenticated;

create index if not exists focus_checks_session_checked_at_idx
  on focus_checks (session_id, checked_at);
