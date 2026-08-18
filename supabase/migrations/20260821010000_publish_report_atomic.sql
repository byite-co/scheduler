-- R3 작업 2 — 리포트 발송을 한 트랜잭션으로 묶는다.
--
-- [무엇이 문제였나]  apps/teacher/src/app/m5.tsx:399-465
--   발송이 쓰기 3~4개로 쪼개져 있었다:
--     ① reports insert (status='draft')
--     ② create_report_share RPC — 토큰 발급 + status='sent' + sent_at
--     ③ reports update({status:'sent', sent_at})   ← ②가 이미 한 일. **중복 쓰기**다
--     ④ report_deliveries insert
--   ③과 ④는 **error 를 읽지 않는다**. 그리고 성공 메시지는 ②의 결과만 보고 정해진다 —
--   ④가 실패해도 "공유 링크를 발급했어요" 가 뜬다. 즉 발송 이력(report_deliveries)이 없는데
--   과외쌤은 보냈다고 믿는다. 중간에 끊기면 학부모에게 갈 링크는 살아 있고 이력은 없다.
--
-- [해결]
--   네 단계를 이 RPC 하나에 넣는다. plpgsql 함수 본문은 단일 트랜잭션이므로 전부 커밋되거나
--   전부 롤백된다. ③의 중복 쓰기는 사라진다(토큰 발급과 상태 전이가 같은 자리에서 일어난다).
--
-- [발송 채널]
--   link 만 실제로 발급된다. kakao·pdf 는 연동이 없으므로 delivery 를 'pending' 으로만 남긴다
--   — 되는 척하면 과외쌤이 보냈다고 믿는다(기존 화면의 방침을 그대로 옮겼다).
--
-- [권한을 표 정책보다 좁게 잡는다]
--   reports 의 with check 는 `teacher_id = auth.uid() OR <active 연결>` 이라 **첫 가지만으로**
--   통과한다 — A5.1 에서 이걸로 미연결 학생에게 리포트를 붙일 수 있었다.
--   이 RPC 는 **active 연결을 요구**한다. 빌더가 애초에 active 학생만 나열하므로 정상 흐름은
--   영향이 없고, 미연결 학생 대상 발송 경로만 닫힌다.
--
--   발급 한도는 그대로 enforce_report_quota 트리거가 ① 시점에 막는다(화면 게이트와 이중).

create or replace function publish_report(
  p_student_id uuid,
  p_period_start date,
  p_period_end date,
  p_data jsonb,
  p_teacher_comment text,
  p_included_subjects subject_code[],
  p_channel text,
  p_home_support text default null,
  p_next_week_focus text default null,
  p_type report_type default 'weekly',
  p_ttl_hours integer default 2160
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid;
  new_report_id uuid;
  new_token text;
  expires timestamptz;
  delivery_status text;
  sent timestamptz;
begin
  me := auth.uid();
  if me is null then
    raise exception 'authentication_required';
  end if;

  if p_channel is null or p_channel not in ('link', 'kakao', 'pdf') then
    raise exception 'invalid_delivery_channel';
  end if;

  if p_teacher_comment is null or btrim(p_teacher_comment) = '' then
    -- 자동 수집 데이터만으로는 보내지 않는다(화면 규칙과 같은 잣대를 서버에도 둔다).
    raise exception 'teacher_comment_required';
  end if;

  if not exists (
    select 1 from connections c
     where c.teacher_id = me
       and c.student_id = p_student_id
       and c.status = 'active'
  ) then
    raise exception 'not_connected_student';
  end if;

  -- ① 리포트 저장. 한도 초과면 여기서 트리거가 터지고 아래는 아무것도 일어나지 않는다.
  insert into reports (
    student_id, teacher_id, type, period_start, period_end,
    data, teacher_comment, home_support, next_week_focus, included_subjects, status
  )
  values (
    p_student_id, me, p_type, p_period_start, p_period_end,
    p_data, p_teacher_comment, nullif(btrim(coalesce(p_home_support, '')), ''),
    nullif(btrim(coalesce(p_next_week_focus, '')), ''), p_included_subjects, 'draft'
  )
  returning id into new_report_id;

  -- ② 링크 채널이면 토큰 발급 + 발송 상태 전이를 같은 자리에서 한다.
  if p_channel = 'link' then
    -- UUID 두 개 = 64자 hex ≈ 256비트 (create_report_share 와 같은 방식).
    new_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    expires := now() + make_interval(hours => greatest(1, coalesce(p_ttl_hours, 2160)));
    sent := now();
    update reports
       set share_token = new_token,
           share_expires_at = expires,
           status = 'sent',
           sent_at = sent
     where id = new_report_id;
    delivery_status := 'sent';
  else
    delivery_status := 'pending';
  end if;

  -- ③ 발송 이력. 실패하면 위의 저장·토큰까지 함께 롤백된다 — 이력 없는 발송이 생기지 않는다.
  insert into report_deliveries (report_id, channel, status, sent_at)
  values (new_report_id, p_channel, delivery_status, sent);

  return jsonb_build_object(
    'report_id', new_report_id,
    'channel', p_channel,
    'delivery_status', delivery_status,
    'token', new_token,
    'expires_at', expires
  );
end;
$$;

revoke all on function publish_report(uuid, date, date, jsonb, text, subject_code[], text, text, text, report_type, integer) from public;
revoke all on function publish_report(uuid, date, date, jsonb, text, subject_code[], text, text, text, report_type, integer) from anon;
grant execute on function publish_report(uuid, date, date, jsonb, text, subject_code[], text, text, text, report_type, integer) to authenticated;

comment on function publish_report(uuid, date, date, jsonb, text, subject_code[], text, text, text, report_type, integer) is
  '리포트 저장 + 토큰 발급 + 발송 상태 + 발송 이력을 한 트랜잭션으로. 부분 성공이 없다. '
  'active 연결된 학생만 대상(표 정책의 OR 첫 가지 우회를 닫는다). 20260821010000 참고.';
