-- claim 고아 복구 — 크래시한 실행이 슬롯을 영구 점유하는 것을 막는다.
--
-- [문제] 20260817000000 의 claim 은 ai_started_at 이 **비어 있을 때만** 성공한다.
--   AI 호출 권리를 딱 한 번 주는 것이 목적이었지만, 권리를 가져간 요청이
--   크래시하면(Edge Function 타임아웃·프로세스 종료·네트워크 단절) 그 행은
--     status='processing' · ai_started_at 채워짐
--   상태로 **영구히** 남는다. 그러면:
--     · 같은 키 재시도 → claim 실패 → 409 check_already_in_progress
--     · 다른 키 재시도 → 부분 유니크 인덱스(one_active_idx)가 막아 check_already_in_progress
--   즉 그 제출은 **다시는 검사할 수 없다.** 아무도 돌고 있지 않은데 영원히 "진행 중"이다.
--
-- [해결 — 소유가 아니라 리스(lease)로 본다]
--   claim 은 "영구 소유권"이 아니라 **시한부 임차**다. 임차 기간이 지나고 여전히
--   미종결이면 다음 요청이 탈환할 수 있다.
--     탈환 가능 = status in ('queued','processing')
--                 AND (ai_started_at is null OR ai_started_at < now() - 임계)
--
-- [임계를 10분으로 잡는 근거]
--   · 정상 실행 시간: 사진 최대 9장 = 배치 3회, 배치당 수~수십초 → 최악 1~2분.
--   · Supabase Edge Function 벽시계 상한은 그보다 짧다(수십 초~수 분) — 살아 있는 실행이
--     10분을 넘길 수 없다. 즉 10분이 지났다면 그 실행은 확실히 죽었다.
--   · 너무 짧게 잡으면(예: 1분) 느린 실행이 아직 도는 중인데 두 번째 요청이 탈환해
--     **AI 를 두 번 부른다** — 막으려던 것을 스스로 다시 여는 셈이다.
--   · 너무 길게 잡으면(예: 1시간) 학생이 그동안 재시도를 못 한다.
--   10분은 "살아 있을 수 없다"와 "사용자가 기다릴 수 있다" 사이다.
--
-- [탈환해도 이전 비용은 지운다? — 아니다, 보존한다]
--   죽은 실행도 AI 를 이미 불렀을 수 있다. 그 토큰·비용은 **실제로 나간 돈**이라
--   탈환할 때 절대 지우거나 0 으로 되돌리지 않는다. 이 함수는 ai_started_at 과
--   updated_at 만 건드린다 — model·input_tokens·output_tokens·
--   estimated_cost_usd_micros·latency_ms 는 손대지 않는다.
--   (뒤이은 record/fail RPC 도 coalesce 라 기존 값을 덮지 않는다.)
--   결과적으로 한 attempt 에 1회차 비용이 남고 2회차 비용이 더해지지 않는 점은
--   한계로 남는다 — 정확한 누적이 필요해지면 별도 비용 원장이 필요하다(범위 밖).

create or replace function ai_check_claim_lease_minutes() returns integer
  language sql immutable as $$ select 10 $$;

comment on function ai_check_claim_lease_minutes() is
  'AI 호출 권리의 임차 시간(분). 이 시간이 지나고도 미종결이면 죽은 실행으로 보고 탈환을 허용한다.';

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
         -- 🚨 비용 컬럼은 건드리지 않는다. 죽은 실행이 이미 쓴 돈은 실제로 나간 돈이다.
   where id = p_attempt_id
     and status in ('queued', 'processing')
     and (
       ai_started_at is null
       -- 임차 만료: 아무도 돌고 있지 않다고 볼 수 있는 시점이 지났다.
       or ai_started_at < now() - make_interval(mins => ai_check_claim_lease_minutes())
     );

  get diagnostics claimed = row_count;
  return claimed;
end;
$$;

comment on function claim_homework_check_attempt(uuid) is
  'AI 호출 권리를 선점한다. 비어 있거나 임차가 만료된 경우에만 true. 20260817010000: 만료 기반 탈환 추가 — 크래시한 실행이 슬롯을 영구 점유하던 문제.';

revoke all on function claim_homework_check_attempt(uuid) from public;
revoke all on function claim_homework_check_attempt(uuid) from anon;
revoke all on function claim_homework_check_attempt(uuid) from authenticated;
grant execute on function claim_homework_check_attempt(uuid) to service_role;

revoke all on function ai_check_claim_lease_minutes() from public;
revoke all on function ai_check_claim_lease_minutes() from anon;
grant execute on function ai_check_claim_lease_minutes() to authenticated, service_role;
