-- M5: 학부모 리포트 공유.
-- 학부모는 로그인/역할이 아니라 reports.share_token으로만(인증 없이, 토큰 범위 한정) 본다.
-- 테이블 직접 노출 금지 → security definer RPC가 토큰 검증 + 만료 확인 + report_views 기록 후 데이터만 반환.

-- 1) 과외쌤이 리포트 공유 링크 발급(토큰 + 만료 + 발송 처리) -------------------
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

  -- 작성 과외쌤 본인 또는 해당 학생과 active 연결인 과외쌤만 발급 가능.
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

  new_token := encode(gen_random_bytes(18), 'hex');
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

-- 2) 학부모(anon)가 토큰으로 리포트 조회 — 만료/무효 처리 + 조회 기록 ----------
create or replace function get_shared_report(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  report_row reports%rowtype;
begin
  if p_token is null or length(p_token) < 16 then
    return jsonb_build_object('status', 'not_found');
  end if;

  select * into report_row from reports where share_token = p_token;
  if not found or report_row.status <> 'sent' then
    return jsonb_build_object('status', 'not_found');
  end if;

  if report_row.share_expires_at is not null and report_row.share_expires_at < now() then
    return jsonb_build_object('status', 'expired');
  end if;

  insert into report_views (report_id) values (report_row.id);

  return jsonb_build_object(
    'status', 'ok',
    'report', jsonb_build_object(
      'id', report_row.id,
      'type', report_row.type,
      'period_start', report_row.period_start,
      'period_end', report_row.period_end,
      'data', report_row.data,
      'ai_draft', report_row.ai_draft,
      'teacher_comment', report_row.teacher_comment,
      'included_subjects', report_row.included_subjects,
      'sent_at', report_row.sent_at
    )
  );
end;
$$;

revoke all on function get_shared_report(text) from public;
grant execute on function get_shared_report(text) to anon, authenticated;
