-- M5 fix: create_report_share used extensions.gen_random_bytes which is not on
-- the function's public search_path. Use gen_random_uuid() (public) for the token.

create or replace function create_report_share(
  p_report_id uuid,
  p_ttl_hours integer default 168
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  report_row reports%rowtype;
  new_token text;
  expires timestamptz;
begin
  if auth.uid() is null then
    raise exception 'authentication_required';
  end if;

  select * into report_row from reports where id = p_report_id;
  if not found then
    raise exception 'report_not_found';
  end if;

  if not (
    report_row.teacher_id = auth.uid()
    or exists (
      select 1 from connections c
      where c.student_id = report_row.student_id
        and c.teacher_id = auth.uid()
        and c.status = 'active'
    )
  ) then
    raise exception 'not_authorized';
  end if;

  new_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  expires := now() + make_interval(hours => greatest(1, coalesce(p_ttl_hours, 168)));

  update reports
    set share_token = new_token,
        share_expires_at = expires,
        status = 'sent',
        sent_at = now()
    where id = p_report_id;

  return jsonb_build_object('token', new_token, 'expires_at', expires);
end;
$$;

revoke all on function create_report_share(uuid, integer) from public;
grant execute on function create_report_share(uuid, integer) to authenticated;
