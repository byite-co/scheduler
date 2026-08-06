-- 서버측 프리미엄 판정 + AI 검사 사용량 안전장치.
--
-- 지금까지 프리미엄 판정은 클라이언트에만 있었고(getFeatureGateState 가 status==='active' 만
-- 봤다) expires_at 을 무시했다. 서버측 구독 검증은 0곳이었다. 클라이언트 게이트는 우회
-- 가능하므로 유료 기능을 열기 전에 서버에서 판정해야 한다.

-- ── 구독 상태의 의미를 여기서 고정한다 ────────────────────────────────────────
-- 결제 사업자(App Store/Google Play/Stripe)의 원본 상태값을 그대로 쓰지 않고
-- **"지금 이용할 권리가 있는가"** 라는 하나의 의미로 정규화한다. 사업자마다 상태 이름과
-- 개수가 다르고, 원본을 그대로 분기하면 사업자를 추가할 때마다 판정 코드가 갈라진다.
--
--   active                            → 이용 권리 있음
--   past_due / paused / canceled / none → 이용 권리 없음
--
-- 자동 갱신을 취소했지만 결제 기간이 남은 경우(=사용자는 "해지"했다고 느끼지만 아직 쓸 수
-- 있는 기간)는 **status 를 active 로 두고 expires_at 까지 유지**한다. canceled 로 즉시
-- 바꾸면 이미 낸 돈만큼의 이용 권리를 빼앗는 것이 된다. 웹훅(작업 5b 이후) 구현 시 이
-- 원칙을 지켜야 한다.
--
-- expires_at IS NULL 은 "권리 없음"으로 본다(fail-closed). `expires_at > now()` 가 NULL 에
-- 대해 false 가 되는 것을 그대로 이용한다 — 만료일을 모르는 구독을 무기한 프리미엄으로
-- 취급하면 결제 버그가 곧 무료 이용이 된다.
create or replace function has_active_student_premium()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  -- 호출자 본인만 조회한다. student_id 를 인자로 받지 않는 이유: 남의 구독 상태를 물어볼
  -- 필요가 없고, 인자를 받으면 그 자체가 정보 노출 경로가 된다.
  -- SECURITY INVOKER 로 충분하다 — studsub_self 정책이 본인 행 SELECT 를 허용한다.
  -- (service_role 이 부르면 auth.uid() 가 null 이라 항상 false 다. 서버는 이 함수를
  --  '사용자 컨텍스트'로 호출해야 한다 — Edge Function 의 asUser 클라이언트.)
  select exists (
    select 1
      from student_subscriptions
     where student_id = auth.uid()
       and status = 'active'
       and expires_at > now()
  );
$$;

revoke all on function has_active_student_premium() from public;
revoke all on function has_active_student_premium() from anon;
grant execute on function has_active_student_premium() to authenticated;

comment on function has_active_student_premium() is
  '호출자(auth.uid())의 학생 프리미엄 이용 권리. status=active AND expires_at > now(). expires_at IS NULL 은 권리 없음(fail-closed).';

-- ── 사용량 안전장치 ──────────────────────────────────────────────────────────
-- 사용자에게 보이는 상품 한도가 아니라 **서버 안전장치**다. 폭주·버그·재시도 루프가
-- 그대로 과금으로 이어지는 것을 막는 것이 목적이므로 넉넉하게 잡는다.
--
-- 한도 확인과 슬롯 확보는 **같은 트랜잭션**에서 일어난다. 따로 하면 동시 요청이 각각
-- "아직 한도 안 넘었다"를 보고 둘 다 통과해 한도를 넘길 수 있다. 게다가 count 만으로는
-- READ COMMITTED 에서 동시 삽입을 막지 못하므로, 요청자 단위 advisory lock 으로
-- 직렬화한다(트랜잭션 종료 시 자동 해제).
create or replace function ai_check_max_attempts_per_submission() returns integer
  language sql immutable as $$ select 5 $$;
create or replace function ai_check_max_attempts_per_day() returns integer
  language sql immutable as $$ select 50 $$;

comment on function ai_check_max_attempts_per_submission() is
  '같은 제출 재검사 상한(서버 안전장치). 상품 한도가 아니다.';
comment on function ai_check_max_attempts_per_day() is
  '요청자 1인 하루 검사 상한(서버 안전장치). 상품 한도가 아니다.';

-- start_homework_check_attempt 확장: 구조적 전제 + 사용량 한도를 슬롯 확보와 원자적으로 검사.
--
-- ⚠️ 과금 권한(프리미엄/연결) 분기는 Edge Function 이 담당한다. 여기서 다시 판정하지 않는
--    이유는 규칙을 두 곳에 두면 갈라지기 때문이다(이 레포에서 반복해 겪은 문제).
--    **새로운 호출자를 추가한다면 반드시 그 앞에서 과금 권한을 검사해야 한다.**
--    구조적 전제(ai_check_enabled/scope_text)는 데이터 유효성이라 여기서도 막는다.
create or replace function start_homework_check_attempt(
  p_submission_id uuid,
  p_requested_by uuid,
  p_idempotency_key text
)
returns homework_check_attempts
language plpgsql
security definer
set search_path = public
as $$
declare
  sub homework_submissions%rowtype;
  todo_row todos%rowtype;
  snapshot_scope text;
  existing homework_check_attempts%rowtype;
  result homework_check_attempts%rowtype;
  attempts_for_submission integer;
  attempts_today integer;
begin
  select * into sub from homework_submissions where id = p_submission_id;
  if not found then
    raise exception 'homework_submission_not_found';
  end if;

  -- 같은 요청의 재전송이면 새로 만들지 않고 기존 실행을 돌려준다(중복 과금 방지).
  -- 한도 검사보다 앞에 둔다 — 재전송은 새 사용량이 아니다.
  select * into existing
    from homework_check_attempts
   where requested_by = p_requested_by and idempotency_key = p_idempotency_key;
  if found then
    return existing;
  end if;

  select * into todo_row from todos where id = sub.todo_id;
  if not found then
    raise exception 'homework_submission_not_found';
  end if;

  -- 구조적 전제: AI 검사가 꺼진 숙제나 범위 없는 숙제는 검사할 대상이 아니다.
  -- (todos_ai_check_needs_scope 제약이 있어 정상 경로에서는 둘이 함께 성립한다.)
  if not todo_row.ai_check_enabled then
    raise exception 'ai_check_disabled_for_todo';
  end if;
  if nullif(btrim(coalesce(todo_row.scope_text, '')), '') is null then
    raise exception 'scope_text_required_for_check';
  end if;

  -- 사용량 검사와 슬롯 확보를 직렬화한다. count 만으로는 동시 요청이 둘 다 통과할 수 있다.
  perform pg_advisory_xact_lock(hashtext('homework_check_attempt:' || p_requested_by::text));

  select count(*) into attempts_for_submission
    from homework_check_attempts
   where submission_id = p_submission_id;
  if attempts_for_submission >= ai_check_max_attempts_per_submission() then
    raise exception 'check_limit_submission_exceeded';
  end if;

  select count(*) into attempts_today
    from homework_check_attempts
   where requested_by = p_requested_by
     and created_at >= date_trunc('day', now());
  if attempts_today >= ai_check_max_attempts_per_day() then
    raise exception 'check_limit_daily_exceeded';
  end if;

  -- 검사 기준이 되는 범위는 todos.scope_text 다. 없으면 title 로 되돌아간다 —
  -- scope_text 도입 전 숙제는 범위를 title 에 적어 뒀다(앱의 getTodoScopeTextForDisplay 와 같은 규칙).
  snapshot_scope := nullif(btrim(coalesce(todo_row.scope_text, todo_row.title)), '');

  begin
    insert into homework_check_attempts (
      submission_id, requested_by, status,
      scope_text_snapshot, photo_paths_snapshot,
      idempotency_key, started_at
    ) values (
      p_submission_id, p_requested_by, 'processing',
      snapshot_scope, sub.photo_paths,
      p_idempotency_key, now()
    )
    returning * into result;
  exception
    when unique_violation then
      -- 경쟁 조건: 같은 idempotency_key 가 방금 들어왔다면 그 행을 돌려준다.
      select * into existing
        from homework_check_attempts
       where requested_by = p_requested_by and idempotency_key = p_idempotency_key;
      if found then
        return existing;
      end if;
      -- 그게 아니면 같은 제출에 이미 진행 중인 검사가 있다(부분 유니크 인덱스).
      raise exception 'check_already_in_progress';
  end;

  return result;
end;
$$;

revoke all on function start_homework_check_attempt(uuid, uuid, text) from public;
revoke all on function start_homework_check_attempt(uuid, uuid, text) from anon;
revoke all on function start_homework_check_attempt(uuid, uuid, text) from authenticated;
grant execute on function start_homework_check_attempt(uuid, uuid, text) to service_role;
