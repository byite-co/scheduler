-- 지시 밖 결함 (A5 에서 발견) — 연결의 신원 컬럼을 교사가 바꿀 수 있었다.
--
-- [무엇이 문제였나]
--   conn_teacher_update_status 는 `using (teacher_id = auth.uid()) with check (teacher_id = auth.uid())` 다.
--   teacher_id 만 본다. 그래서 교사는 자기 연결의 **student_id 를 임의의 학생 UUID 로 바꿀 수 있었다.**
--
--     update connections set student_id = '<남의 학생>', status = 'active' where id = '<내 연결>';
--
--   초대 코드도, 학생의 수락도 필요 없다. 실측(A5 보고서)으로 확인된 결과:
--     · v_teacher_study_sessions 로 그 학생의 학습기록 열람 (0건 → 1건)
--     · 그 학생의 profiles 행 열람 (1건)
--     · 그 학생에게 숙제(todos) 출제 성공
--     · 그 학생에 대한 리포트 생성 성공
--     · per_student_settings 생성 성공
--
-- [왜 RLS 로 못 막는가]
--   `with check` 는 UPDATE **후** 행만 본다. OLD 를 참조할 수 없으므로 "student_id 가 바뀌지
--   않았다" 를 정책으로 표현할 수 없다. 그래서 **컬럼 단위 권한**으로 막는다 — 권한 층은
--   RLS 보다 먼저 평가되고, 우회할 표현식이 없다.
--
-- [무엇이 깨지지 않는가]
--   클라이언트가 연결에 대해 실제로 쓰는 컬럼은 status 와 activated_at 뿐이다
--   (수락·거절: teacher web m1.tsx / teacher-mobile connectionRequestsScreen.tsx,
--    연결 해제: teacher-mobile studentSettingsScreen.tsx).
--   request_connection_by_invite 는 security definer 라 소유자 권한으로 돌아 영향이 없다.
--   테스트의 admin 클라이언트는 service_role 이라 영향이 없다.

revoke update on table connections from authenticated;
revoke update on table connections from anon;

-- 상태 전이에 필요한 두 컬럼만 되돌려 준다. teacher_id·student_id·invite_code·requested_by·
-- created_at·id 는 이제 클라이언트가 UPDATE 할 수 없다.
grant update (status, activated_at) on table connections to authenticated;

comment on policy conn_teacher_update_status on connections is
  '교사 본인의 연결만 상태 전이. 신원 컬럼(student_id 등) 변경은 컬럼 단위 권한으로 막는다 '
  '— with check 는 OLD 를 볼 수 없어 정책으로는 표현할 수 없다. 20260819000000 참고.';
