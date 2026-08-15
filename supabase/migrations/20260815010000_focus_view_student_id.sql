-- v_teacher_focus_checks 에 student_id 를 노출한다.
--
-- [왜] 뷰가 session_id 와 teacher_id 만 주고 **student_id 를 주지 않았다.**
--   그래서 과외쌤이 "이 학생의 집중 기록"만 뽑을 수단이 없었고, 학부모 리포트를 만들 때
--   **다른 학생의 집중도가 섞여 들어갔다**(실연동 검증에서 재현: 기록이 없는 학생의
--   리포트에 다른 학생의 졸음 2회·집중률 50% 가 그대로 표시됨).
--
--   RLS 는 뚫리지 않았다 — 담당 학생들의 행만 보였다. 문제는 "그 안에서 학생을 고를 수
--   없다"는 것이었고, 결과적으로 **학부모에게 남의 아이 데이터를 보낼 뻔했다.**
--
-- [왜 컬럼 추가로 푸는가] 클라이언트가 study_sessions 를 다시 조회해 session_id 를 학생별로
--   묶는 방법도 있지만, 그건 화면마다 반복되고 한 곳만 빠뜨려도 같은 사고가 난다.
--   필터 기준을 뷰가 직접 제공하는 것이 맞다.
--
-- ⚠️ create or replace view 는 기존 컬럼의 이름·순서·타입을 바꿀 수 없다.
--    그래서 student_id 를 **맨 뒤에** 붙인다(기존 소비자 영향 없음).
--    공개범위 조건(share_focus_data)은 그대로 유지한다.
create or replace view v_teacher_focus_checks as
  select
    fc.id,
    fc.session_id,
    fc.checked_at,
    fc.drowsy,
    c.teacher_id,
    s.student_id
  from focus_checks fc
  join study_sessions s on s.id = fc.session_id
  join connections c on c.student_id = s.student_id and c.status = 'active'
  join disclosure_settings d on d.connection_id = c.id
  where d.share_focus_data = true
    and c.teacher_id = auth.uid();

grant select on v_teacher_focus_checks to authenticated;

comment on view v_teacher_focus_checks is
  '과외쌤이 볼 수 있는 집중 확인 기록. share_focus_data 를 켠 active 연결만. student_id 로 학생을 좁힐 수 있어야 리포트에 남의 데이터가 섞이지 않는다.';
