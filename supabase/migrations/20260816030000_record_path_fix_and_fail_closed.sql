-- AI 검사 기록 경로 복구 + 이중 방어의 fail-open 수정.
--
-- ════════════════════════════════════════════════════════════════════════════
-- [1] record_homework_check_observation — enum 캐스팅 (기록이 항상 실패하던 버그)
-- ════════════════════════════════════════════════════════════════════════════
--
-- [증상] 이 함수는 **호출될 때마다** 실패했다:
--     column "status" is of type check_attempt_status but expression is of type text
--   A1.5 검증에서 service_role 로 직접 불러 재현했다.
--
-- [원인] 20260807030000:87
--     set status = case when p_discard_reason is null then 'completed' else 'failed' end
--   CASE 의 두 분기가 모두 무형(unknown) 리터럴이라 결과 타입이 **text** 로 정해진다.
--   Postgres 는 text → enum 을 암시적으로 캐스팅하지 않으므로 대입에서 죽는다.
--   (`select pg_typeof(case when true then 'completed' else 'failed' end)` → text 로 실측)
--   단일 리터럴 대입(`set status = 'completed'`)은 unknown 이 대상 타입으로 해석돼 잘 된다 —
--   그래서 같은 파일의 다른 UPDATE 는 멀쩡하고 이 한 줄만 깨졌다.
--
-- [영향] 2026-08-07 이후 AI 검사의 **관찰 기록이 한 번도 저장되지 않았다.**
--   Edge Function 은 이 RPC 가 실패하면 fail_homework_check_attempt 로 넘겨 attempt 를
--   'failed' 로 마감한다 — 겉으로는 "AI 검사 실패"로만 보여서 원인이 드러나지 않았다.
--   AI 호출은 그 **전에** 끝나므로 비용은 이미 나갔고, 그 결과만 버려졌다.
--
-- [왜 안 잡혔나] 이 함수를 **실행하는** 테스트가 없었다. 스키마 테스트는 함수 존재·권한을
--   문자열로 확인할 뿐이라 본문이 도는지는 검증하지 않는다.
--   이 마이그레이션과 함께 실행 테스트를 추가한다(m4.checkAttempts.rls.integration.test.ts).
--
-- 고치는 방법은 분기마다 명시 캐스팅을 붙이는 것이다. 한쪽만 캐스팅해도 CASE 전체가
-- 그 타입으로 해석되지만, **둘 다** 적어 둔다 — 나중에 분기를 추가하는 사람이
-- 캐스팅 없는 리터럴을 넣어 같은 사고를 반복하지 않게 하려는 것이다.
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
     set status              = case
                                 when p_discard_reason is null then 'completed'::check_attempt_status
                                 else 'failed'::check_attempt_status
                               end,
         raw_ai_observation  = p_raw_observation,
         prompt_version      = p_prompt_version,
         schema_version      = p_schema_version,
         scope_included      = p_scope_included,
         stop_reason         = p_stop_reason,
         model               = coalesce(p_model, model),
         input_tokens        = coalesce(p_input_tokens, input_tokens),
         output_tokens       = coalesce(p_output_tokens, output_tokens),
         estimated_cost_usd_micros = coalesce(p_cost_usd_micros, estimated_cost_usd_micros),
         latency_ms          = p_latency_ms,
         discard_reason      = p_discard_reason,
         -- error_code 는 status='failed' 일 때만 허용된다(attempts_error_only_when_failed).
         -- 이쪽은 text 컬럼이라 캐스팅이 필요 없다.
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
  'AI 관찰 원본을 기록한다. 폐기 사유가 있으면 failed 로 남기고 원본도 함께 보관한다. ai_* 캐시는 건드리지 않는다. (20260816030000: enum 캐스팅 누락으로 항상 실패하던 것을 고침)';

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

-- ════════════════════════════════════════════════════════════════════════════
-- [2] apply_homework_ai_verdict — 이중 방어를 fail-closed 로
-- ════════════════════════════════════════════════════════════════════════════
--
-- [before — 20260816020000]
--     if coalesce(auth.role(), 'service_role') <> 'service_role' then ... end if;
--   auth.role() 이 null 이면 통과시킨다. "모르면 열린다"는 방향이라 fail-open 이다.
--   지금은 PostgREST 가 항상 role 클레임을 넣어 주므로 실제로 뚫리지는 않지만,
--   클레임 형식이 바뀌거나 다른 경로가 생기면 조용히 열린다.
--
-- [after] **클레임의 존재 여부**로 갈라 API 경로에서는 언제나 닫히게 한다.
--   · request.jwt.claims(또는 구형 request.jwt.claim.role)가 있다 = API 요청이다
--       → role 이 service_role 이 아니면 거부. 값을 못 읽어도 거부(모르면 닫힌다).
--   · 둘 다 없다 = PostgREST 를 거치지 않은 직접 DB 접속(psql·Management API·마이그레이션)
--       → 허용. 이 경로는 이미 DB 자격증명이 필요해 새로 여는 문이 아니고,
--         막으면 운영 점검·데이터 보정이 불가능해진다.
create or replace function apply_homework_ai_verdict(
  p_submission_id uuid,
  p_verdict submission_verdict,
  p_confidence numeric,
  p_reason text
)
returns homework_submissions
language plpgsql
security definer
set search_path = public
as $$
declare
  result_row homework_submissions%rowtype;
  jwt_claims text := nullif(current_setting('request.jwt.claims', true), '');
  jwt_role   text := nullif(current_setting('request.jwt.claim.role', true), '');
begin
  -- API 를 거쳐 들어온 요청이면(클레임이 하나라도 있으면) service_role 만 통과시킨다.
  if (jwt_claims is not null or jwt_role is not null)
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service_role_required';
  end if;

  update homework_submissions
    set ai_verdict = p_verdict,
        ai_confidence = case
          when p_confidence is null then null
          else greatest(0, least(1, p_confidence))
        end,
        ai_reason = p_reason
    where id = p_submission_id
    returning * into result_row;

  if not found then
    raise exception 'homework_submission_not_found';
  end if;

  return result_row;
end;
$$;

comment on function apply_homework_ai_verdict(uuid, submission_verdict, numeric, text) is
  'DEPRECATED(20260806040000): attempt 기록 없이 ai_* 만 덮어쓴다. complete_homework_check_attempt 를 쓸 것. 20260816020000 anon 회수, 20260816030000 호출 주체 검증을 fail-closed 로.';

revoke all on function apply_homework_ai_verdict(uuid, submission_verdict, numeric, text) from public;
revoke all on function apply_homework_ai_verdict(uuid, submission_verdict, numeric, text) from anon;
revoke all on function apply_homework_ai_verdict(uuid, submission_verdict, numeric, text) from authenticated;
grant execute on function apply_homework_ai_verdict(uuid, submission_verdict, numeric, text) to service_role;
