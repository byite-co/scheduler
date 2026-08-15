-- 대기 중인 연결 요청의 학생 이름 조회.
--
-- [문제] profiles_connected_read 는 status='active' 인 연결만 허용한다. 그래서 과외쌤이
--   pending 요청을 볼 때 학생 프로필을 못 읽고 화면에 UUID 앞자리만 뜬다.
--   과외쌤이 **누가 요청했는지 모르는 채로** 수락/거절을 눌러야 한다.
--
-- [왜 RLS 를 넓히지 않는가] profiles_connected_read 에 pending 을 추가하면 프로필 행 전체가
--   열린다 — birth_date(만14세 미만 판단용 생년월일), target_univ 까지. 아직 연결되지도 않은
--   사람에게 그것까지 줄 이유가 없다. 정책은 컬럼 단위로 못 자르므로 전용 함수로 좁힌다.
--
-- [무엇을 돌려주는가 — 수락/거절 결정에 꼭 필요한 것만]
--   · student_name  — 없으면 결정 자체가 불가능하다. 이 함수의 존재 이유다.
--   · student_grade — 동명이인 구분용. 초대 코드를 여러 명에게 뿌린 뒤 '김민준' 요청이 둘 오면
--                     이름만으로는 못 고른다. 학생이 직접 적은 '고3' 수준의 값이라 민감도가 낮다.
--   · requested_at  — 오래된 요청과 방금 온 요청을 구분한다. connections.created_at 이고
--                     과외쌤은 conn_party_read 로 이미 읽을 수 있다 — 새로 여는 정보가 아니다.
--   빼는 것: birth_date · target_univ(결정과 무관), avatar_url(얼굴 사진. 이름+학년으로 판단이
--   서므로 아직 남인 사람의 사진까지 열 이유가 없다), student_id(과외쌤이 connections 에서
--   이미 읽는다 — 여기서 다시 줄 필요가 없다).
--
-- [왜 security definer 인가] invoker 로는 **동작 자체가 불가능하다.**
--   함수 본문이 읽어야 하는 건 아직 active 가 아닌 학생의 profiles 행인데, invoker 권한이면
--   호출자에게 profiles RLS 가 그대로 걸려 profiles_connected_read 가 0행을 준다.
--   즉 지금 문제를 그대로 재현한다. 그래서 definer 로 RLS 를 우회하되,
--   **권한 검사를 함수 안에서 직접 한다** — teacher_id = auth.uid() 그리고 status = 'pending'.
--
-- [남의 연결 ID 를 넣으면] 예외를 던지지 않고 **0행을 준다.**
--   'not_authorized' 처럼 사유를 구분해 알려주면 "그 ID 가 존재하긴 한다"는 사실이 샌다.
--   없는 ID · 남의 연결 · active · rejected · 학생이 호출 — 전부 똑같이 0행이라 구분이 불가능하다.
--
-- [active/rejected 를 왜 빼는가] 이 함수의 창구는 pending 한 순간뿐이다.
--   active 가 되면 profiles_connected_read 가 이미 전체 프로필을 열어 주므로 필요가 없고,
--   rejected 는 과외쌤이 거절한 상대다 — 거절한 사람의 이름을 계속 보여줄 이유가 없다.
--
-- 인자를 생략하면 내 pending 요청 전체, 주면 그 한 건만. 목록 화면이 N+1 호출을 하지 않도록
-- 한 함수로 둘 다 처리한다(권한 검사가 한 곳에만 있어야 어긋나지 않는다).
create or replace function pending_connection_requests(p_connection_id uuid default null)
returns table (
  connection_id uuid,
  student_name  text,
  student_grade text,
  requested_at  timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, p.name, p.grade, c.created_at
  from connections c
  join profiles p on p.id = c.student_id
  where c.teacher_id = auth.uid()      -- 로그아웃(anon)이면 auth.uid() 가 null 이라 0행이다
    and c.status = 'pending'
    and (p_connection_id is null or c.id = p_connection_id)
  order by c.created_at desc
$$;

comment on function pending_connection_requests(uuid) is
  '내 pending 연결 요청의 학생 이름·학년. 권한 밖이면 사유 구분 없이 0행(존재 여부도 숨긴다).';

revoke all on function pending_connection_requests(uuid) from public;
revoke all on function pending_connection_requests(uuid) from anon;
grant execute on function pending_connection_requests(uuid) to authenticated;
