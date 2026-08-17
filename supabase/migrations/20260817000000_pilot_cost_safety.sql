-- 파일럿 전 서버면 마무리 — 비용 유실·이중 과금 경로를 닫는다.
--
-- 파일럿은 실사용 사진으로 **진짜 AI 과금**을 발생시킨다. 지금까지는 실사용자가 0명이라
-- 새는 경로가 있어도 금액이 0 이었지만, 파일럿부터는 그대로 돈이 된다.
--
-- ════════════════════════════════════════════════════════════════════════════
-- [1] 미종결 상태가 관찰 결과를 갖지 못하게 한다
-- ════════════════════════════════════════════════════════════════════════════
--
-- 20260816040000 이 양방향 등식을 단방향 두 개로 쪼개면서 **한 방향이 비었다**:
--     · status <> 'completed' or verdict is not null or raw_ai_observation is not null
--     · verdict is null or status = 'completed'
--   verdict 는 completed 에 묶였지만 raw_ai_observation 은 아무 상태에서나 가능하다.
--   즉 queued/processing 인 행이 관찰 결과를 들고 있을 수 있다 — "아직 도는 중인데 결과가
--   있다"는 모순된 행이고, 부분 기록이 완료된 관찰로 읽힐 수 있다.
--   (실행 테스트로 실제 삽입이 되는 것을 확인했다. 이 제약이 그 구멍을 닫는다.)
alter table homework_check_attempts
  drop constraint if exists attempts_observation_requires_settled;

alter table homework_check_attempts
  add constraint attempts_observation_requires_settled
    check (raw_ai_observation is null or status in ('completed', 'failed'));

-- ════════════════════════════════════════════════════════════════════════════
-- [2] 실패해도 이미 나간 비용은 기록한다
-- ════════════════════════════════════════════════════════════════════════════
--
-- [문제] fail_homework_check_attempt 는 status·error_code·completed_at 만 썼다.
--   AI 호출이 끝난 뒤 실패하면(기록 오류·검증 오류) **이미 나간 토큰·비용이 아무 데도
--   남지 않는다.** 2026-08-07~08-16 사이에 정확히 이 일이 벌어졌다(A1.6 §4).
--
-- [원칙] **어떤 경로로 끝나든 돈이 나갔으면 기록이 남는다.**
--   비용 집계는 attempts 표가 유일한 출처다. 여기 없으면 청구서와 대조할 방법이 없다.
--
-- [호환] 기존 2-인자 호출을 그대로 유지해야 한다(다른 실패 경로가 인자 없이 부른다).
--   그래서 새 인자는 전부 default null 이다. 다만 default 를 붙이면 **시그니처가 달라져**
--   create or replace 가 아니라 새 함수가 만들어지고, 옛 2-인자 함수가 남아 오버로드
--   모호성이 생긴다. 그래서 drop 후 재생성하고 권한을 다시 부여한다.
drop function if exists fail_homework_check_attempt(uuid, text);

create or replace function fail_homework_check_attempt(
  p_attempt_id uuid,
  p_error_code text,
  p_model text default null,
  p_input_tokens integer default null,
  p_output_tokens integer default null,
  p_cost_usd_micros bigint default null,
  p_latency_ms integer default null
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
     set status = 'failed',
         error_code = coalesce(nullif(btrim(p_error_code), ''), 'unknown'),
         -- 이미 기록된 값이 있으면 덮어쓰지 않는다(부분 성공 뒤 실패한 경우).
         model = coalesce(p_model, model),
         input_tokens = coalesce(p_input_tokens, input_tokens),
         output_tokens = coalesce(p_output_tokens, output_tokens),
         estimated_cost_usd_micros = coalesce(p_cost_usd_micros, estimated_cost_usd_micros),
         latency_ms = coalesce(p_latency_ms, latency_ms),
         completed_at = now(),
         updated_at = now()
   where id = p_attempt_id
     and status in ('queued', 'processing')
   returning * into result;
  if not found then
    raise exception 'check_attempt_not_open';
  end if;
  return result;
end;
$$;

comment on function fail_homework_check_attempt(uuid, text, text, integer, integer, bigint, integer) is
  '실행을 실패로 마감한다. 20260817000000: 이미 발생한 토큰·비용을 함께 기록한다 — 어떤 경로로 끝나든 나간 돈은 남아야 한다.';

revoke all on function fail_homework_check_attempt(uuid, text, text, integer, integer, bigint, integer) from public;
revoke all on function fail_homework_check_attempt(uuid, text, text, integer, integer, bigint, integer) from anon;
revoke all on function fail_homework_check_attempt(uuid, text, text, integer, integer, bigint, integer) from authenticated;
grant execute on function fail_homework_check_attempt(uuid, text, text, integer, integer, bigint, integer) to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- [3] AI 호출 권리를 한 번만 준다 (동시 요청 이중 과금 차단)
-- ════════════════════════════════════════════════════════════════════════════
--
-- [지금 막히는 것] 같은 idempotency_key 를 **순차로** 재전송하면 start 가 기존 행을
--   돌려주고, Edge Function 이 status 가 completed/failed 면 그대로 반환한다(이미 있는 가드).
--
-- [지금 안 막히는 것] 같은 키로 **동시에** 두 요청이 오는 경우다. 둘 다 같은 행을 받고
--   둘 다 status='processing' 을 보므로 **둘 다 AI 를 호출한다.** 사진 한 장에 돈이 두 번 나간다.
--   advisory lock 은 start 트랜잭션 안에서만 유효해 그 뒤의 AI 호출까지 직렬화하지 못한다.
--
-- [해결] AI 실행 권리를 행에 **1회만** 발급한다. ai_started_at 이 비어 있을 때만
--   조건부 UPDATE 로 채우고, 채운 쪽만 true 를 받는다. 진 쪽은 AI 를 부르지 않는다.
--   (UPDATE ... WHERE ai_started_at is null 은 행 잠금을 잡으므로 두 트랜잭션이 동시에
--    성공할 수 없다 — 뒤에 온 쪽은 갱신된 값을 다시 보고 조건에서 탈락한다.)
alter table homework_check_attempts
  add column if not exists ai_started_at timestamptz;

comment on column homework_check_attempts.ai_started_at is
  'AI 호출 권리를 가져간 시각. 비어 있을 때만 claim 이 성공한다 — 동시 요청이 같은 사진에 두 번 과금하지 않게 한다.';

create or replace function claim_homework_check_attempt(p_attempt_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed boolean := false;
begin
  update homework_check_attempts
     set ai_started_at = now(),
         updated_at = now()
   where id = p_attempt_id
     and status in ('queued', 'processing')
     and ai_started_at is null;

  get diagnostics claimed = row_count;
  return claimed;
end;
$$;

comment on function claim_homework_check_attempt(uuid) is
  'AI 호출 권리를 선점한다. true 를 받은 호출만 AI 를 부른다. 이미 선점됐거나 종결된 실행이면 false.';

revoke all on function claim_homework_check_attempt(uuid) from public;
revoke all on function claim_homework_check_attempt(uuid) from anon;
revoke all on function claim_homework_check_attempt(uuid) from authenticated;
grant execute on function claim_homework_check_attempt(uuid) to service_role;
