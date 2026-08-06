-- AI 숙제검사 "실행 레코드" 테이블.
--
-- 지금까지 AI 판정은 homework_submissions 의 ai_verdict/ai_confidence/ai_reason 세 컬럼에
-- 덮어쓰기됐다. 그래서:
--   · 재검사하면 이전 판정이 소실된다
--   · 상태(대기/처리중/완료/실패) 구분이 없다 — ai_verdict IS NULL 이 "아직"의 유일한 표현이고
--     처리중/실패는 클라이언트 로컬 state 뿐이라 앱을 껐다 켜면 사라진다
--   · 같은 제출로 여러 번 호출해도 막는 장치가 없다 → 실연동 시 중복 과금
--   · AI 가 어떤 범위·어떤 사진을 보고 판정했는지 기록이 없다
--   · 사용량·비용 측정이 불가능하다
--
-- 이건 감사 로그가 아니라 AI 호출의 실행 레코드다. Anthropic 실연동 전에 있어야 한다.
--
-- ── 전환 기간 ────────────────────────────────────────────────────────────────
-- homework_check_attempts 가 원본(source of truth)이고,
-- homework_submissions.ai_* 는 "최신 완료 결과의 복사본"(구버전 앱 호환용)이다.
-- 두 앱이 새 테이블을 읽도록 전환한 뒤에 ai_* 제거 여부를 결정한다. 지금 지우면 학생 앱과
-- 과외쌤 웹이 동시에 깨진다.

-- 실행 상태. ambiguous 는 '판정 결과'이므로 여기 섞지 않는다(verdict 로 간다).
-- queued 는 지금 쓰이지 않는다 — 현재 실행은 동기(Edge Function 요청-응답)라 곧바로
-- processing 으로 들어간다. 나중에 비동기 워커를 붙일 때를 위해 상태값만 미리 둔다.
create type check_attempt_status as enum ('queued', 'processing', 'completed', 'failed');

create table homework_check_attempts (
  id                        uuid primary key default gen_random_uuid(),
  submission_id             uuid not null references homework_submissions(id) on delete cascade,
  -- profiles 참조에 ON DELETE 절을 빼면 계정 삭제가 막힌다(todos.created_by 로 이미 겪었다 —
  -- 테스트 계정 55건이 원격에 쌓였던 원인). 이 레포의 계정 탈퇴 정책은 전체 cascade 다.
  requested_by              uuid not null references profiles(id) on delete cascade,
  status                    check_attempt_status not null default 'queued',
  -- 스냅샷: 검사 시작 후 학생이 사진이나 범위를 바꾸면 AI 가 본 자료와 화면에 보이는 자료가
  -- 달라진다. 검사 슬롯을 확보하는 순간 범위·사진 경로를 함께 고정한다.
  scope_text_snapshot       text,
  photo_paths_snapshot      text[] not null,
  verdict                   submission_verdict,   -- 완료 전에는 NULL
  confidence                numeric,
  reason                    text,
  idempotency_key           text not null,
  model                     text,
  input_tokens              integer,
  output_tokens             integer,
  -- 비용은 부동소수점으로 두면 합산할 때 오차가 쌓인다 → 정수(마이크로달러)로 저장한다.
  estimated_cost_usd_micros bigint,
  error_code                text,
  created_at                timestamptz not null default now(),
  started_at                timestamptz,
  completed_at              timestamptz,
  updated_at                timestamptz not null default now(),

  -- 동일 요청 재전송 방지. 실연동에서 이게 없으면 네트워크 재시도가 곧 중복 과금이다.
  constraint homework_check_attempts_idempotency_key
    unique (requested_by, idempotency_key),
  constraint attempts_idempotency_key_not_blank
    check (btrim(idempotency_key) <> ''),
  -- verdict 는 완료일 때만 있고, 완료면 반드시 있다(양방향).
  constraint attempts_verdict_only_when_completed
    check ((status = 'completed') = (verdict is not null)),
  -- 사진 1~9개. array_length 는 빈 배열에 NULL 을 돌려주므로 coalesce 가 없으면
  -- `NULL between 1 and 9` → NULL → 제약이 통과해 버린다(0개가 그대로 들어간다).
  constraint attempts_photo_count
    check (coalesce(array_length(photo_paths_snapshot, 1), 0) between 1 and 9),
  constraint attempts_confidence_range
    check (confidence is null or confidence between 0 and 1),
  constraint attempts_tokens_non_negative
    check (coalesce(input_tokens, 0) >= 0 and coalesce(output_tokens, 0) >= 0),
  constraint attempts_cost_non_negative
    check (coalesce(estimated_cost_usd_micros, 0) >= 0),
  constraint attempts_error_only_when_failed
    check (status = 'failed' or error_code is null),
  -- 끝난 실행에는 끝난 시각이 있고, 안 끝난 실행에는 없다.
  constraint attempts_completed_at_matches_status
    check ((status in ('completed', 'failed')) = (completed_at is not null))
);

-- 한 제출에 진행 중(queued/processing)인 검사는 동시에 하나만.
-- 부분 유니크 인덱스로 강제한다(같은 방식이 sessions_student_active_timer_idx 에 이미 쓰인다).
create unique index homework_check_attempts_one_active_idx
  on homework_check_attempts (submission_id)
  where status in ('queued', 'processing');

create index homework_check_attempts_submission_created_idx
  on homework_check_attempts (submission_id, created_at desc);
create index homework_check_attempts_requested_by_idx
  on homework_check_attempts (requested_by, created_at desc);

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- 읽기만 열고 쓰기 정책은 두지 않는다 → anon/authenticated 의 INSERT/UPDATE/DELETE 는
-- 통과할 정책이 없어 전부 거부된다. service_role 은 RLS 를 우회한다.
alter table homework_check_attempts enable row level security;

-- 학생: 자기 제출의 attempt 읽기만.
create policy attempts_student_read on homework_check_attempts for select using (
  exists (
    select 1 from homework_submissions s
    where s.id = homework_check_attempts.submission_id
      and s.student_id = auth.uid()
  )
);

-- 과외쌤: subs_teacher_read 와 **같은 조건**(active 연결 + share_homework_photos).
-- 제출을 볼 수 없는 과외쌤이 그 제출의 검사 이력을 보면 공개범위가 무의미해진다.
create policy attempts_teacher_read on homework_check_attempts for select using (
  exists (
    select 1
    from homework_submissions s
    join connections c on c.student_id = s.student_id
    join disclosure_settings d on d.connection_id = c.id
    where s.id = homework_check_attempts.submission_id
      and c.teacher_id = auth.uid()
      and c.status = 'active'
      and d.share_homework_photos
  )
);

-- 이중 잠금: RLS 가 1차 방어선이고, 이 트리거는 나중에 누가 실수로 쓰기 정책을 추가해도
-- 인증 세션의 쓰기가 조용히 통과하지 않게 한다(guard_homework_submission_fields 와 같은 원칙).
--
-- ⚠️ DELETE 에는 걸지 않는다. 학생이 자기 제출을 지우면 attempt 가 cascade 로 지워지는데,
--    cascade 는 호출자 컨텍스트(auth.uid() 존재)에서 실행된다. DELETE 를 막으면 학생이
--    자기 제출을 못 지우고 계정 탈퇴(delete_my_account)의 전체 cascade 도 깨진다.
create or replace function guard_homework_check_attempt_writes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    raise exception 'check_attempts_are_server_written';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_homework_check_attempt_writes_trigger on homework_check_attempts;
create trigger guard_homework_check_attempt_writes_trigger
before insert or update on homework_check_attempts
for each row execute function guard_homework_check_attempt_writes();

-- ── 실행 라이프사이클 RPC (service_role 전용) ────────────────────────────────
-- requested_by 를 auth.uid() 로 유도하지 않고 인자로 받는다. service_role 은 auth.uid() 가
-- null 이라 유도형으로 만들면 호출 자체가 불가능해진다(mock 구독 RPC 에서 겪은 문제).

-- 1) 검사 슬롯 확보 + 스냅샷 고정.
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
  snapshot_scope text;
  existing homework_check_attempts%rowtype;
  result homework_check_attempts%rowtype;
begin
  select * into sub from homework_submissions where id = p_submission_id;
  if not found then
    raise exception 'homework_submission_not_found';
  end if;

  -- 같은 요청의 재전송이면 새로 만들지 않고 기존 실행을 돌려준다(중복 과금 방지).
  select * into existing
    from homework_check_attempts
   where requested_by = p_requested_by and idempotency_key = p_idempotency_key;
  if found then
    return existing;
  end if;

  -- 검사 기준이 되는 범위는 todos.scope_text 다. 없으면 title 로 되돌아간다 —
  -- scope_text 도입 전 숙제는 범위를 title 에 적어 뒀다(앱의 getTodoScopeTextForDisplay 와 같은 규칙).
  select nullif(btrim(coalesce(t.scope_text, t.title)), '')
    into snapshot_scope
    from todos t
   where t.id = sub.todo_id;

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

-- 2) 완료 기록 + homework_submissions 캐시 갱신.
create or replace function complete_homework_check_attempt(
  p_attempt_id uuid,
  p_verdict submission_verdict,
  p_confidence numeric,
  p_reason text,
  p_model text default null,
  p_input_tokens integer default null,
  p_output_tokens integer default null,
  p_estimated_cost_usd_micros bigint default null
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
     set status = 'completed',
         verdict = p_verdict,
         confidence = case when p_confidence is null then null else greatest(0, least(1, p_confidence)) end,
         reason = p_reason,
         model = p_model,
         input_tokens = p_input_tokens,
         output_tokens = p_output_tokens,
         estimated_cost_usd_micros = p_estimated_cost_usd_micros,
         completed_at = now(),
         updated_at = now()
   where id = p_attempt_id
     and status in ('queued', 'processing')
   returning * into result;
  if not found then
    raise exception 'check_attempt_not_open';
  end if;

  -- 전환 기간: ai_* 는 "최신 완료 결과의 복사본"이다. 원본은 이 attempt 행이다.
  update homework_submissions
     set ai_verdict = result.verdict,
         ai_confidence = result.confidence,
         ai_reason = result.reason
   where id = result.submission_id;

  return result;
end;
$$;

-- 3) 실패 기록. 실패해도 슬롯을 비워 재시도가 가능해야 한다.
create or replace function fail_homework_check_attempt(
  p_attempt_id uuid,
  p_error_code text
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

revoke all on function start_homework_check_attempt(uuid, uuid, text) from public;
revoke all on function start_homework_check_attempt(uuid, uuid, text) from anon;
revoke all on function start_homework_check_attempt(uuid, uuid, text) from authenticated;
grant execute on function start_homework_check_attempt(uuid, uuid, text) to service_role;

revoke all on function complete_homework_check_attempt(uuid, submission_verdict, numeric, text, text, integer, integer, bigint) from public;
revoke all on function complete_homework_check_attempt(uuid, submission_verdict, numeric, text, text, integer, integer, bigint) from anon;
revoke all on function complete_homework_check_attempt(uuid, submission_verdict, numeric, text, text, integer, integer, bigint) from authenticated;
grant execute on function complete_homework_check_attempt(uuid, submission_verdict, numeric, text, text, integer, integer, bigint) to service_role;

revoke all on function fail_homework_check_attempt(uuid, text) from public;
revoke all on function fail_homework_check_attempt(uuid, text) from anon;
revoke all on function fail_homework_check_attempt(uuid, text) from authenticated;
grant execute on function fail_homework_check_attempt(uuid, text) to service_role;

comment on table homework_check_attempts is
  'AI 숙제검사 실행 레코드(원본). homework_submissions.ai_* 는 최신 완료 결과의 복사본이다.';
comment on column homework_check_attempts.scope_text_snapshot is
  '검사 시작 시점의 범위. 이후 학생이 범위를 바꿔도 AI 가 본 기준은 여기 남는다.';
comment on column homework_check_attempts.photo_paths_snapshot is
  '검사 시작 시점의 사진 경로. 이후 사진이 바뀌어도 AI 가 본 자료는 여기 남는다.';
comment on column homework_check_attempts.estimated_cost_usd_micros is
  '마이크로달러(1e-6 USD) 정수. 부동소수점 합산 오차를 피하려고 정수로 저장한다.';

-- ── apply_homework_ai_verdict 처리 ───────────────────────────────────────────
-- 확장하지 않고 그대로 두되 deprecated 로 표시한다. 이유:
--   · 인자가 submission_id 라 "어느 실행이 완료됐는지" 알 수 없다. attempt 를 기록하려면
--     attempt_id 가 필요하고, 그러면 사실상 새 함수다.
--   · 이 함수가 attempt 를 스스로 만들게 하면 스냅샷도 idempotency_key 도 없는 반쪽 기록이
--     생긴다 — 테이블을 만든 목적이 사라진다.
--   · 지금 지우거나 시그니처를 바꾸면 이 함수를 부르는 경로가 조용히 깨진다. 전환 기간에는
--     남겨 두고, 호출자를 complete_homework_check_attempt 로 옮긴 뒤 제거를 판단한다.
-- 남아 있는 동안은 "attempt 없이 ai_* 를 쓸 수 있는 경로"이기도 하다. service_role 만
-- 호출할 수 있어 감수 가능하지만, 전환이 끝나면 지워야 한다.
comment on function apply_homework_ai_verdict(uuid, submission_verdict, numeric, text) is
  'DEPRECATED(20260806040000): attempt 기록 없이 ai_* 만 덮어쓴다. complete_homework_check_attempt 를 쓸 것. 전환 후 제거 예정.';
