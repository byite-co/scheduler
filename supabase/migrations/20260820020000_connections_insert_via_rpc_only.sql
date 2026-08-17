-- A5.1 — 연결 생성을 RPC 한 곳으로 모은다. (A5 시도 제한의 우회 경로 차단)
--
-- [무엇이 문제였나]
--   conn_student_insert_pending 은 `student_id = auth.uid() and requested_by = auth.uid()
--   and status = 'pending'` 만 확인한다. **teacher_id 를 확인하지 않고, 초대 코드를 요구하지도
--   않는다.** 실측: 학생이 임의의 교사 UUID 로 pending 연결을 직접 INSERT 했다
--   (`status=pending`, `invite_code=null` 로 행 생성됨).
--
--   이것이 A5 에서 만든 시도 제한을 무의미하게 만들 수 있는 경로다. A5 는
--   request_connection_by_invite 를 유일한 입구로 가정하고 그 안에 제한을 넣었는데,
--   표에 직접 INSERT 하는 길이 열려 있었다. 그 길에는
--     · 초대 코드 검증이 없다 (만료·사용여부 확인 없음)
--     · 시도 기록도 제한도 없다
--     · disclosure_settings 행이 생기지 않는다
--   가 모두 해당한다.
--
--   ⚠️ 실제 위험도는 "교사 UUID 를 알아야 한다" 로 제한된다. profiles RLS 는 연결된 교사만
--   읽게 하므로 모르는 교사의 UUID 는 사실상 추측 불가(2^122)다. 그래서 이것은 지금 당장
--   악용 가능한 구멍이라기보다 **제한을 우회하는 두 번째 입구**다. 입구가 둘이면 한쪽에만
--   방어를 걸어 둔 것이 의미를 잃는다.
--
-- [해결]
--   클라이언트의 connections INSERT 를 없앤다. 연결 생성은 request_connection_by_invite
--   (security definer) 하나만 한다 — 코드 검증·시도 제한·공개범위 행 생성이 모두 그 안에 있다.
--
-- [무엇이 깨지지 않는가 — 먼저 확인했다]
--   클라이언트 코드에 connections 직접 INSERT 는 **한 곳도 없다**(apps/student·apps/teacher·
--   apps/teacher-mobile 전수 확인). 통합 테스트의 연결 생성은 전부 admin(service_role)이라
--   영향이 없다. definer 함수는 소유자 권한으로 돌므로 영향이 없다.

drop policy if exists conn_student_insert_pending on connections;

revoke insert on table connections from authenticated;
revoke insert on table connections from anon;

comment on table connections is
  '연결. 생성은 request_connection_by_invite(security definer) 만 한다 — 클라이언트 INSERT 권한 없음. '
  '상태 전이는 status·activated_at 컬럼만(20260819000000). 20260820020000 참고.';
