-- 작업 2 — 연결 수락을 한 트랜잭션으로 묶는다.
--
-- [무엇이 문제였나]
--   수락은 두 개의 쓰기다: per_student_settings 행 생성 + connections.status → active.
--   두 앱이 이것을 클라이언트에서 순차로 했고, 순서가 서로 달라서 부분 실패 결과도 달랐다.
--
--     teacher-mobile (connectionRequestsScreen.tsx:142→157)  설정 먼저 → 상태 나중
--       상태 UPDATE 가 실패하면: **pending 인데 설정 행만 있는 고아 설정**이 남는다.
--
--     teacher web (m1.tsx:1222→1225)                          상태 먼저 → 설정 나중
--       설정 upsert 가 실패하면: **active 인데 설정 행이 없는 연결**이 남는다.
--       더 나쁜 것은 web 이 그 upsert 의 error 를 아예 읽지 않았다는 점이다 —
--       실패해도 "연결을 수락했습니다" 가 뜬다. 조용한 실패다.
--
--   어느 쪽이든 화면은 "수락됨" 이라고 말하고 데이터는 반쪽이다. 네트워크가 끊기는 순간,
--   앱이 죽는 순간, 두 번째 쓰기가 RLS 에 걸리는 순간마다 재현된다.
--
-- [해결]
--   두 쓰기를 함수 하나에 넣는다. plpgsql 함수 본문은 단일 트랜잭션이므로 둘 다 커밋되거나
--   둘 다 롤백된다. 중간 상태가 존재할 수 없다.
--
-- [기본값을 SQL 에 복제하지 않는다]
--   per_student_settings 의 컬럼 기본값(ai_check_subjects '{}', report_cycle 'weekly')이
--   packages/shared 의 DEFAULT_TEACHER_STUDENT_SETTINGS 와 이미 같다. 그래서 컬럼을 명시하지
--   않고 기본값에 맡긴다 — 값을 두 곳에 적으면 언젠가 갈라진다.
--
-- [disclosure_settings 는 만들지 않는다]
--   공개범위 행은 request_connection_by_invite(요청 시점)에서 만든다. 여기서 또 만들면
--   share_study_time 기본값 true 로 **공개를 켜 주는** 일이 되므로 손대지 않는다.
--   행이 없으면 교사에게 아무것도 안 보인다 — 실패 방향이 안전한 쪽이다.

create or replace function accept_connection_request(p_connection_id uuid)
returns connections
language plpgsql
security definer
set search_path = public
as $$
declare
  conn connections%rowtype;
begin
  if auth.uid() is null then
    raise exception 'authentication_required';
  end if;

  -- 잠그고 읽는다. 동시에 두 번 눌러도 하나만 전이한다.
  select * into conn from connections where id = p_connection_id for update;

  if not found then
    raise exception 'connection_not_found';
  end if;

  -- 권한: 이 연결의 교사 본인만. security definer 라 RLS 가 적용되지 않으므로
  -- 여기서 직접 확인해야 한다.
  if conn.teacher_id <> auth.uid() then
    raise exception 'not_connection_teacher';
  end if;

  -- 멱등: 이미 active 면 오류가 아니다. 설정 행이 없을 수 있으니(과거 부분 실패의 잔재)
  -- 보정만 하고 같은 행을 돌려준다. 재호출이 안전해야 클라이언트가 재시도할 수 있다.
  if conn.status = 'active' then
    insert into per_student_settings (connection_id)
    values (conn.id)
    on conflict (connection_id) do nothing;
    return conn;
  end if;

  if conn.status <> 'pending' then
    -- rejected·disconnected 를 수락으로 되살리지 않는다. 그 경로는 학생이 코드를 다시
    -- 넣어 request_connection_by_invite 를 통과해야 한다(= 학생의 재동의).
    raise exception 'connection_not_pending';
  end if;

  insert into per_student_settings (connection_id)
  values (conn.id)
  on conflict (connection_id) do nothing;

  update connections
     set status = 'active',
         activated_at = now()
   where id = conn.id
  returning * into conn;

  return conn;
end;
$$;

revoke all on function accept_connection_request(uuid) from public;
revoke all on function accept_connection_request(uuid) from anon;
grant execute on function accept_connection_request(uuid) to authenticated;

comment on function accept_connection_request(uuid) is
  '연결 수락: per_student_settings 생성 + status→active 를 한 트랜잭션으로. '
  '해당 연결의 교사 본인만, 멱등. 클라이언트 2단계 수락(고아 설정/설정 없는 active)을 대체한다.';
