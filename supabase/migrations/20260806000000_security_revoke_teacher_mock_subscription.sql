-- SECURITY: mock_set_teacher_subscription 실행 권한 회수.
--
-- 20260805000000 에서 학생 프리미엄 mock RPC(mock_set_student_subscription)를 막았는데,
-- 과외쌤 쪽 mock RPC 에 **완전히 같은 구멍**이 남아 있었다.
-- 라이브 확인(잘못된 enum 으로 부작용 없이 판별):
--   · mock_set_teacher_subscription  → 22P02 (인자 검증까지 진입 = 실행 가능)  ← 구멍
--   · mock_set_student_subscription  → 42501 permission denied (정상 차단)     ← 대조군
-- authenticated 뿐 아니라 anon 에서도 22P02 가 나왔다. 원본 마이그레이션의
-- `revoke all from public` 은 Supabase 기본 권한(ALTER DEFAULT PRIVILEGES)으로 부여된
-- 롤별 grant 를 제거하지 못하므로, anon/authenticated 를 명시적으로 회수해야 한다.
--
-- 영향: 과외쌤이 스스로 앱 구독료를 active 로 만들 수 있었다. 앱 구독료가 주 수입원이므로
-- 매출에 직접 영향이 있다(학생 프리미엄과 달리 "우리에게 내는 돈"이다).
--
-- 20260805000000 과 동일한 패턴을 의도적으로 반복한다 — 두 mock RPC 의 권한 형태를
-- 같게 유지해야 나중에 한쪽만 다시 열리는 일을 알아채기 쉽다.

-- ⚠️ 회수 후 이 함수는 사실상 사용 불가가 된다. 대상 과외쌤을 auth.uid() 로 정하는 구조라
--    service_role(auth.uid() is null)로 부르면 'authentication_required' 로 실패한다.
--    grant 를 남기는 것은 권한 상태를 명시적으로 문서화하는 의미이며, 실제 개발/테스트용
--    구독 상태 생성은 아래 방법을 쓴다(신규 SQL 불필요):
--      service_role 키로 teacher_subscriptions 직접 upsert (service_role 은 RLS 우회)
--    → scripts/dev-set-subscription.mjs 가 이 경로를 감싼다. 문서: docs/PROJECT-GUIDE.md
--    영구 대체는 실연동 Edge Function(billing-stripe)이며 별도 작업이다.
revoke execute on function mock_set_teacher_subscription(sub_status) from public;
revoke execute on function mock_set_teacher_subscription(sub_status) from anon;
revoke execute on function mock_set_teacher_subscription(sub_status) from authenticated;
grant execute on function mock_set_teacher_subscription(sub_status) to service_role;

-- 학생 쪽도 anon 회수가 실제로 적용됐는지 재확인(멱등 — 이미 회수돼 있으면 무해).
-- 두 함수의 권한 형태를 이 마이그레이션 이후 동일하게 고정한다.
revoke execute on function mock_set_student_subscription(sub_status, timestamptz) from public;
revoke execute on function mock_set_student_subscription(sub_status, timestamptz) from anon;
revoke execute on function mock_set_student_subscription(sub_status, timestamptz) from authenticated;
grant execute on function mock_set_student_subscription(sub_status, timestamptz) to service_role;
