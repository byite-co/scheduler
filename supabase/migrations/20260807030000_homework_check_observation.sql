-- AI 채점표시 **관찰** 결과 저장 (재설계 1단계).
--
-- [왜] 이전 설계는 AI 에게 전역 판정(pass/insufficient)을 시켰고, 그 판정을
--   homework_check_attempts.verdict 에 "확정 사실"로 저장했다. 실사진 측정에서 다 푼
--   페이지를 "3·4·5번 미작성"으로 confidence 0.95 에 단정했으므로, AI 출력은 확정 사실이
--   아니라 **원본 관찰**로만 저장해야 한다.
--
-- [이 마이그레이션이 하는 일]
--   1. raw_ai_observation(jsonb) — 모델이 돌려준 원본 JSON 을 버전 정보와 함께 그대로 보관
--   2. 실행 로깅 컬럼 — prompt_version / schema_version / scope_included / stop_reason /
--      latency_ms / discard_reason
--   3. verdict CHECK 완화 — 관찰만 저장한 완료 행에는 verdict 가 없다
--   4. record_homework_check_observation() — 관찰 기록 전용 RPC(service_role)
--
-- [이 마이그레이션이 하지 않는 일 — 의도된 것]
--   · 표시에서 상태를 계산하지 않는다(2단계).
--   · 페이지 범위 누락을 계산하지 않는다(3단계).
--   · homework_submissions.ai_* 캐시를 건드리지 않는다. 관찰은 판정이 아니므로 화면에
--     보여줄 값이 없다(노출은 AI_CHECK_RESULTS_ENABLED 로 차단된 상태를 유지한다).
--   · 기존 verdict / confidence / reason 컬럼과 데이터를 지우지 않는다.

alter table homework_check_attempts
  -- AI 원본. 확정 사실이 아니다 — 서버 계산값과 사람 확인값은 다음 단계에서 별도 컬럼에 둔다.
  add column if not exists raw_ai_observation jsonb,
  -- 어느 프롬프트/스키마에서 나온 관찰인지. **이게 없으면 A/B 비교가 불가능하다.**
  add column if not exists prompt_version text,
  add column if not exists schema_version text,
  -- 검사 범위를 요청에 넣었는지. 범위 포함 여부는 A/B 대상이라 반드시 남긴다.
  add column if not exists scope_included boolean,
  -- 정상 관찰로 인정한 근거. end_turn 이 아니면 폐기하므로 그 값도 기록해 둔다.
  add column if not exists stop_reason text,
  add column if not exists latency_ms integer,
  -- 검증 실패로 폐기한 이유(관찰을 고쳐 살리지 않는다).
  add column if not exists discard_reason text;

comment on column homework_check_attempts.raw_ai_observation is
  'AI 관찰 원본 JSON + 호출별 로그. 확정 사실이 아니다 — 서버 계산은 2단계.';
comment on column homework_check_attempts.discard_reason is
  '서버 의미 검증 실패 사유. 실패는 고쳐 살리지 않고 사람 확인으로 넘긴다.';

alter table homework_check_attempts
  add constraint attempts_latency_non_negative
    check (latency_ms is null or latency_ms >= 0);

-- verdict CHECK 완화.
--
-- 예전 규칙은 "완료면 반드시 verdict 가 있다"였다. 관찰 전용 실행에는 verdict 가 없으므로
-- 그대로 두면 관찰을 저장할 수 없다. 불변식 자체는 유지한다 —
-- **완료된 실행에는 판정이든 관찰이든 결과가 하나는 있어야 한다.**
alter table homework_check_attempts
  drop constraint attempts_verdict_only_when_completed;
alter table homework_check_attempts
  add constraint attempts_completed_has_result
    check ((status = 'completed') = (verdict is not null or raw_ai_observation is not null));

-- ── 관찰 기록 RPC ────────────────────────────────────────────────────────────
--
-- 성공(폐기 사유 없음) → status='completed', raw_ai_observation 저장.
-- 폐기(폐기 사유 있음) → status='failed', 원본은 그대로 남기고 discard_reason 을 적는다.
--   폐기한 원본도 보관하는 이유: 무엇이 왜 폐기됐는지 못 보면 프롬프트를 고칠 근거가 없다.
--
-- ⚠️ 두 경우 모두 homework_submissions.ai_* 를 건드리지 않는다.
--    관찰은 판정이 아니므로 화면에 캐시할 값이 없다.
create or replace function record_homework_check_observation(
  p_attempt_id uuid,
  p_raw_observation jsonb,
  p_prompt_version text,
  p_schema_version text,
  p_scope_included boolean,
  p_stop_reason text default null,
  p_model text default null,
  p_input_tokens integer default null,
  p_output_tokens integer default null,
  p_cost_usd_micros bigint default null,
  p_latency_ms integer default null,
  p_discard_reason text default null
)
returns homework_check_attempts
language plpgsql
security definer
set search_path = public
as $$
declare
  result homework_check_attempts%rowtype;
begin
  update homework_check_attempts
     set status              = case when p_discard_reason is null then 'completed' else 'failed' end,
         raw_ai_observation  = p_raw_observation,
         prompt_version      = p_prompt_version,
         schema_version      = p_schema_version,
         scope_included      = p_scope_included,
         stop_reason          = p_stop_reason,
         model               = coalesce(p_model, model),
         input_tokens        = coalesce(p_input_tokens, input_tokens),
         output_tokens       = coalesce(p_output_tokens, output_tokens),
         estimated_cost_usd_micros = coalesce(p_cost_usd_micros, estimated_cost_usd_micros),
         latency_ms          = p_latency_ms,
         discard_reason      = p_discard_reason,
         -- error_code 는 status='failed' 일 때만 허용된다(attempts_error_only_when_failed).
         error_code          = case when p_discard_reason is null then null else 'observation_discarded' end,
         completed_at        = now(),
         updated_at          = now()
   where id = p_attempt_id
     and status in ('queued', 'processing')
  returning * into result;

  if not found then
    raise exception 'check_attempt_not_open';
  end if;

  return result;
end;
$$;

comment on function record_homework_check_observation(
  uuid, jsonb, text, text, boolean, text, text, integer, integer, bigint, integer, text
) is
  'AI 관찰 원본을 기록한다. 폐기 사유가 있으면 failed 로 남기고 원본도 함께 보관한다. ai_* 캐시는 건드리지 않는다.';

revoke all on function record_homework_check_observation(
  uuid, jsonb, text, text, boolean, text, text, integer, integer, bigint, integer, text
) from public;
revoke all on function record_homework_check_observation(
  uuid, jsonb, text, text, boolean, text, text, integer, integer, bigint, integer, text
) from anon;
revoke all on function record_homework_check_observation(
  uuid, jsonb, text, text, boolean, text, text, integer, integer, bigint, integer, text
) from authenticated;
grant execute on function record_homework_check_observation(
  uuid, jsonb, text, text, boolean, text, text, integer, integer, bigint, integer, text
) to service_role;

-- complete_homework_check_attempt(판정 기록)은 2단계에서 정리한다. 지금 지우면 옛 경로가
-- 남은 코드에서 깨지고, 되돌릴 때 근거가 없어진다.
comment on function complete_homework_check_attempt(
  uuid, submission_verdict, numeric, text, text, integer, integer, bigint
) is
  'DEPRECATED(2026-08-07): 전역 판정 경로. 관찰 설계에서는 record_homework_check_observation 을 쓴다.';
