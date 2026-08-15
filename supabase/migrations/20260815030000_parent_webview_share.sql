-- 학부모 웹뷰 — 공유 링크 조회 확장 · 만료 정책 · 무효화.
--
-- [보안 모델] 학부모는 가입하지 않는다. 로그인 없이 링크만으로 본다.
--   그래서 접근 통제는 **토큰 하나**에 달려 있다. 지켜야 할 것:
--     1) 토큰을 모르면 절대 못 본다 — reports 에 anon 정책이 **없다**(테이블 직접 접근 불가).
--        유일한 통로는 이 security definer 함수뿐이다.
--     2) 토큰이 추측 불가해야 한다 — create_report_share 가 UUID 두 개를 이어
--        **64자 hex(≈256비트)** 를 만든다. 무작위 대입이 불가능하다.
--     3) 한 토큰으로 다른 리포트를 못 본다 — 정확 일치로 한 행만 찾고 그 행만 돌려준다.
--
-- [만료를 왜 90일로 바꾸는가] 기존 기본값은 168시간(7일)이었다.
--   · 7일은 **현실에서 너무 짧다.** 학부모가 여행·바쁨으로 늦게 열면 이미 만료다.
--     "링크가 죽었다"는 문의는 과외쌤에게 되돌아온다.
--   · 그렇다고 무기한은 안 된다. 공개 URL 이 영원히 살아 있으면 유출 시 회수 수단이 없다.
--   · 90일이면 최근 리포트를 놓치는 학부모가 없고, 오래된 링크는 자연히 죽는다.
--     주간 리포트의 유효 관심 기간(한 학기 미만)과도 맞는다.
--
-- [유출되면] 그 링크로 **그 리포트 한 건**만 열린다(다른 리포트·학생·계정 접근 불가).
--   회수 수단이 필요해 revoke_report_share 를 새로 만든다 — 토큰을 지우면 즉시 죽는다.

-- 기본 만료를 90일로. 호출부가 값을 넘기면 그 값이 우선한다.
create or replace function create_report_share(p_report_id uuid, p_ttl_hours integer default 2160)
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
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  select * into report_row from reports where id = p_report_id;
  if not found then raise exception 'report_not_found'; end if;
  if not (
    report_row.teacher_id = auth.uid()
    or exists (select 1 from connections c
               where c.student_id = report_row.student_id and c.teacher_id = auth.uid() and c.status = 'active')
  ) then
    raise exception 'not_authorized';
  end if;
  -- UUID 두 개 = 64자 hex ≈ 256비트. 추측·무작위 대입 불가.
  new_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  expires := now() + make_interval(hours => greatest(1, coalesce(p_ttl_hours, 2160)));
  update reports
    set share_token = new_token, share_expires_at = expires, status = 'sent', sent_at = now()
    where id = p_report_id;
  return jsonb_build_object('token', new_token, 'expires_at', expires);
end;
$$;

comment on function create_report_share(uuid, integer) is
  '학부모 공유 링크 발급. 토큰은 64자 hex(≈256비트). 기본 만료 90일(2160시간).';

-- ── 조회 확장 ────────────────────────────────────────────────────────────────
--
-- 웹뷰가 필요로 하는 것을 **이 함수만으로** 다 돌려줘야 한다. 학부모는 anon 이라
-- profiles·connections 를 못 읽는다(읽게 하면 그게 곧 구멍이다).
--   · 글 세 칸 전부(1단계에서 home_support / next_week_focus 추가)
--   · 학생 이름 — 누구 리포트인지 보여줘야 한다
--   · 쌤 이름 — 스냅샷의 branding 이 비어 있을 때(2단계 이전 리포트)의 대비
--   · share_expires_at — 언제까지 볼 수 있는지 알려준다
--
-- ⚠️ **실시간 데이터를 다시 조회하지 않는다.** 자동 수집 값은 전부 reports.data
--    스냅샷에서 온다. 발송 후 학생 기록이 바뀌어도 학부모가 본 내용은 그대로여야 한다.
--    (이름만 profiles 에서 읽는다 — 이름이 바뀌면 최신 이름을 보여주는 편이 자연스럽다.)
create or replace function get_shared_report(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  report_row reports%rowtype;
  student_name text;
  teacher_name text;
begin
  if p_token is null or length(p_token) < 16 then
    return jsonb_build_object('status', 'not_found');
  end if;
  select * into report_row from reports where share_token = p_token;
  -- 없는 토큰과 아직 발송 안 된 리포트를 **같은 응답**으로 합친다.
  -- 구분해서 알려주면 토큰의 존재 여부가 새어 나간다.
  if not found or report_row.status <> 'sent' then
    return jsonb_build_object('status', 'not_found');
  end if;
  if report_row.share_expires_at is not null and report_row.share_expires_at < now() then
    return jsonb_build_object('status', 'expired');
  end if;

  select name into student_name from profiles where id = report_row.student_id;
  select name into teacher_name from profiles where id = report_row.teacher_id;

  insert into report_views (report_id) values (report_row.id);

  return jsonb_build_object(
    'status', 'ok',
    'report', jsonb_build_object(
      'id', report_row.id, 'type', report_row.type,
      'period_start', report_row.period_start, 'period_end', report_row.period_end,
      'data', report_row.data, 'ai_draft', report_row.ai_draft,
      'teacher_comment', report_row.teacher_comment,
      'home_support', report_row.home_support,
      'next_week_focus', report_row.next_week_focus,
      'included_subjects', report_row.included_subjects,
      'sent_at', report_row.sent_at,
      'expires_at', report_row.share_expires_at,
      'student_name', student_name,
      'teacher_name', teacher_name
    )
  );
end;
$$;

comment on function get_shared_report(text) is
  '토큰으로 리포트 하나를 연다. anon 허용 — 이게 학부모 웹뷰의 유일한 통로다. 값은 전부 발송 시점 스냅샷이다.';

revoke all on function get_shared_report(text) from public;
grant execute on function get_shared_report(text) to anon, authenticated;

-- ── 무효화 ──────────────────────────────────────────────────────────────────
--
-- 링크가 유출됐을 때 회수할 수단이 없으면 만료를 기다리는 것 말고 할 수 있는 게 없다.
-- 토큰을 지우면 그 URL 은 즉시 not_found 가 된다(리포트 자체는 남는다 — 이력은 보존).
create or replace function revoke_report_share(p_report_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  report_row reports%rowtype;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  select * into report_row from reports where id = p_report_id;
  if not found then raise exception 'report_not_found'; end if;
  if not (
    report_row.teacher_id = auth.uid()
    or exists (select 1 from connections c
               where c.student_id = report_row.student_id and c.teacher_id = auth.uid() and c.status = 'active')
  ) then
    raise exception 'not_authorized';
  end if;
  update reports set share_token = null, share_expires_at = null where id = p_report_id;
end;
$$;

comment on function revoke_report_share(uuid) is
  '공유 링크 무효화. 토큰을 지워 URL 을 즉시 죽인다. 리포트 본문은 남는다.';

revoke all on function revoke_report_share(uuid) from public;
revoke all on function revoke_report_share(uuid) from anon;
grant execute on function revoke_report_share(uuid) to authenticated;
