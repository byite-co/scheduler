-- 폐기된 관찰의 원본 보관을 제약이 막고 있던 것을 고친다.
--
-- [어떻게 발견했나] 20260816030000 으로 enum 캐스팅을 고친 뒤, 관찰 기록 경로를 **실제로
--   실행하는** 통합 테스트를 추가했다. 성공 경로는 통과했는데 **폐기 경로가 죽었다**:
--     new row for relation "homework_check_attempts" violates check constraint
--     "attempts_completed_has_result"
--   캐스팅 버그에 가려 여태 아무도 여기까지 도달하지 못했다.
--
-- [모순] 같은 마이그레이션(20260807030000) 안에서 함수와 제약이 서로를 부정한다.
--   · 함수: 폐기 시 status='failed' 로 두고 raw_ai_observation 은 **그대로 저장**한다.
--     주석에도 "폐기한 원본도 남긴다 — 무엇이 왜 폐기됐는지 못 보면 프롬프트를 고칠 근거가
--     없다" 라고 적혀 있다.
--   · 제약: (status = 'completed') = (verdict is not null or raw_ai_observation is not null)
--     **양방향**이라 "결과가 있으면 반드시 completed" 도 강제한다.
--     → failed + raw 있음 = false = true → 위반. 폐기 경로는 성공할 수 없다.
--
-- [영향] 검증에 실패한 AI 응답(형식 오류·stop_reason 이상 등)의 원본이 **하나도 남지 않는다.**
--   Edge Function 은 이 RPC 가 실패하면 fail_homework_check_attempt 로 넘기므로
--   attempt 는 error_code='attempt_complete_failed' 로만 남고 원본은 사라진다.
--   관찰 재설계의 목적 자체가 "폐기해도 원본을 보고 프롬프트를 고친다" 였는데 그게 불가능했다.
--
-- [고치는 방향] 양방향 등식을 **의도대로 두 개의 단방향 제약**으로 쪼갠다.
--   1) completed 면 결과가 하나는 있어야 한다  (원래 지키려던 것)
--   2) verdict 는 completed 일 때만 존재한다   (원래 지키려던 것)
--   raw_ai_observation 은 failed 에도 있을 수 있다 — 그게 폐기 기록이다.
--   ⚠️ 옛 이름(attempts_verdict_only_when_completed)은 20260807030000 이 이미 드롭했다.
--      되살리면 "그 제약이 없어야 한다"는 기존 단정과 충돌하므로 새 이름을 쓴다.

alter table homework_check_attempts
  drop constraint if exists attempts_completed_has_result;

alter table homework_check_attempts
  add constraint attempts_completed_has_result
    check (status <> 'completed' or verdict is not null or raw_ai_observation is not null);

alter table homework_check_attempts
  drop constraint if exists attempts_verdict_requires_completed;

alter table homework_check_attempts
  add constraint attempts_verdict_requires_completed
    check (verdict is null or status = 'completed');
