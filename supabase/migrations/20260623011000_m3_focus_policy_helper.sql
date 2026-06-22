-- M3 stage 2-B: make direct focus_checks teacher RLS use a definer helper
-- so the disclosure check is not blocked by study_sessions' student-only RLS.

create or replace function can_teacher_read_focus_check(
  p_teacher uuid,
  p_session uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from study_sessions s
    join connections c
      on c.student_id = s.student_id
     and c.status = 'active'
    join disclosure_settings d
      on d.connection_id = c.id
    where s.id = p_session
      and c.teacher_id = p_teacher
      and d.share_focus_data = true
  );
$$;

revoke all on function can_teacher_read_focus_check(uuid, uuid) from public;
grant execute on function can_teacher_read_focus_check(uuid, uuid) to authenticated;

drop policy if exists focus_teacher_read_disclosed on focus_checks;
create policy focus_teacher_read_disclosed on focus_checks
  for select using (
    can_teacher_read_focus_check(auth.uid(), focus_checks.session_id)
  );
