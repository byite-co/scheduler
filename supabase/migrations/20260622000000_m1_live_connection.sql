alter table profiles
  add column if not exists guardian_consented_at timestamptz;

drop policy if exists conn_party_write on connections;
drop policy if exists conn_student_insert_pending on connections;
drop policy if exists conn_teacher_update_status on connections;

create policy conn_student_insert_pending on connections for insert
  with check (
    student_id = auth.uid()
    and requested_by = auth.uid()
    and status = 'pending'
  );

create policy conn_teacher_update_status on connections for update
  using (teacher_id = auth.uid())
  with check (teacher_id = auth.uid());

create or replace function request_connection_by_invite(p_code text)
returns connections
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_code text;
  invite_row invite_codes%rowtype;
  existing_row connections%rowtype;
  result_row connections%rowtype;
begin
  normalized_code := upper(regexp_replace(coalesce(p_code, ''), '[\s-]+', '', 'g'));

  if auth.uid() is null then
    raise exception 'authentication_required';
  end if;

  if not current_role_is('student') then
    raise exception 'student_profile_required';
  end if;

  if normalized_code !~ '^[A-Z0-9]{6,8}$' then
    raise exception 'invalid_invite_code';
  end if;

  select *
    into invite_row
    from invite_codes
    where code = normalized_code
      and (expires_at is null or expires_at > now())
    for update;

  if not found then
    raise exception 'invite_code_not_found';
  end if;

  if invite_row.used_by is not null and invite_row.used_by <> auth.uid() then
    raise exception 'invite_code_already_used';
  end if;

  select *
    into existing_row
    from connections
    where teacher_id = invite_row.teacher_id
      and student_id = auth.uid()
    for update;

  if found then
    if existing_row.status in ('rejected', 'disconnected') then
      update connections
        set status = 'pending',
            invite_code = normalized_code,
            requested_by = auth.uid(),
            created_at = now(),
            activated_at = null
        where id = existing_row.id
        returning * into result_row;
    else
      result_row := existing_row;
    end if;
  else
    insert into connections (teacher_id, student_id, status, invite_code, requested_by)
    values (invite_row.teacher_id, auth.uid(), 'pending', normalized_code, auth.uid())
    returning * into result_row;
  end if;

  update invite_codes
    set used_by = auth.uid()
    where code = normalized_code
      and used_by is null;

  insert into disclosure_settings (connection_id)
  values (result_row.id)
  on conflict (connection_id) do nothing;

  return result_row;
end;
$$;

revoke all on function request_connection_by_invite(text) from public;
grant execute on function request_connection_by_invite(text) to authenticated;

create or replace view v_teacher_study_sessions as
  select s.*, c.teacher_id
  from study_sessions s
  join connections c on c.student_id = s.student_id and c.status = 'active'
  join disclosure_settings d on d.connection_id = c.id
  where d.share_study_time = true
    and c.teacher_id = auth.uid();

grant select on v_teacher_study_sessions to authenticated;
