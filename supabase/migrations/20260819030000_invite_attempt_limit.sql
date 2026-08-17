-- 작업 3 — 초대 코드 추측 방어 (사용측).
--
-- [무엇이 문제였나]
--   request_connection_by_invite 에는 시도 제한이 전혀 없었다. 실측: 한 계정으로 연속 30회
--   오입력이 모두 통과했고(전부 invite_code_not_found), 차단된 시도는 0회였다.
--   생성 엔트로피(32자 알파벳 6자리 ≈ 2^30, #48)는 전수 탐색을 막지만, 유효한 코드가 N개 있을 때
--   추측 1회의 성공 확률은 N/2^30 이고 **시도 횟수에 비용이 없으면** 그 확률을 무한히 곱할 수 있다.
--   방어의 본체는 사용측이다.
--
-- [왜 함수의 반환 형태를 바꿔야 했나 — 실측 근거]
--   시도를 기록하려면 실패해도 그 기록이 커밋돼야 한다. 그런데 PostgREST 는 요청 하나를
--   트랜잭션 하나로 돌리므로, 함수가 `raise exception` 으로 끝나면 **직전에 넣은 시도 기록까지
--   함께 롤백된다.** 측정으로 확인했다:
--       기록 후 raise 하는 함수  → 호출 뒤 기록 0행
--       기록 후 값을 반환하는 함수 → 호출 뒤 기록 1행
--   즉 "실패 시 예외" 와 "실패를 세는 것" 은 동시에 성립하지 않는다. 그래서 **사용자 입력 실패는
--   예외가 아니라 결과값**으로 돌려준다. 이 함수만 바꾸고 다른 우회 경로를 남기지 않는다
--   (옛 함수를 남겨 두면 공격자는 그걸 부른다).
--
--   authentication_required·student_profile_required 는 계속 raise 한다 — 사용자의 입력 실수가
--   아니라 호출 자체가 잘못된 경우이고, 셀 필요가 없다.
--
-- [추측한 코드 자체는 저장하지 않는다]
--   방어에 필요한 것은 "몇 번 틀렸나" 뿐이다. 입력값을 남기면 운 좋게 맞힌 코드가 표에 남는다.

-- ── 시도 기록 ───────────────────────────────────────────────────────────────
create table if not exists invite_attempts (
  id           bigint generated always as identity primary key,
  student_id   uuid not null references profiles(id) on delete cascade,
  outcome      text not null,
  attempted_at timestamptz not null default now(),
  constraint invite_attempts_outcome_check
    check (outcome in ('success', 'not_found', 'already_used', 'invalid_format'))
);

create index if not exists invite_attempts_student_time_idx
  on invite_attempts (student_id, attempted_at desc);

-- 클라이언트는 이 표를 직접 만지지 않는다. RPC(security definer)만 쓴다.
-- 정책을 0개로 두는 것에 더해 권한도 회수한다 — 정책만 비워 두면 나중에 누가 조회용 정책을
-- for all 로 붙이는 순간 쓰기까지 열린다(A1 의 ad_unlocks 가 그랬다).
alter table invite_attempts enable row level security;
revoke all on table invite_attempts from anon;
revoke all on table invite_attempts from authenticated;

comment on table invite_attempts is
  '초대 코드 입력 시도(계정당). 추측 공격 속도 제한용. 입력한 코드 자체는 저장하지 않는다.';

-- ── 임계값 ──────────────────────────────────────────────────────────────────
create or replace function invite_attempt_window_minutes() returns integer
language sql immutable as $$ select 10 $$;

create or replace function invite_attempt_max_failures() returns integer
language sql immutable as $$ select 10 $$;

comment on function invite_attempt_window_minutes() is '초대 코드 시도 집계 창(분).';
comment on function invite_attempt_max_failures() is
  '집계 창 안에서 허용하는 최대 실패 횟수. 초과하면 창이 지날 때까지 일시 차단.';

revoke all on function invite_attempt_window_minutes() from public, anon;
revoke all on function invite_attempt_max_failures() from public, anon;
grant execute on function invite_attempt_window_minutes() to authenticated, service_role;
grant execute on function invite_attempt_max_failures() to authenticated, service_role;

-- ── 반환 형태가 바뀌므로 drop 후 재생성한다 (replace 로는 불가) ──────────────
drop function if exists request_connection_by_invite(text);

create function request_connection_by_invite(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_code text;
  invite_row invite_codes%rowtype;
  existing_row connections%rowtype;
  result_row connections%rowtype;
  student uuid;
  window_start timestamptz;
  failures int;
  oldest timestamptz;
  outcome_reason text;
begin
  student := auth.uid();
  if student is null then
    raise exception 'authentication_required';
  end if;

  if not current_role_is('student') then
    raise exception 'student_profile_required';
  end if;

  window_start := now() - make_interval(mins => invite_attempt_window_minutes());

  -- 창 밖의 기록은 쓸모가 없다. 호출한 학생 것만 지운다(인덱스 한 번). 스케줄러가 필요 없다.
  delete from invite_attempts
   where student_id = student
     and attempted_at < window_start;

  select count(*), min(attempted_at)
    into failures, oldest
    from invite_attempts
   where student_id = student
     and outcome <> 'success'
     and attempted_at >= window_start;

  if failures >= invite_attempt_max_failures() then
    -- 차단된 시도는 기록하지 않는다. 기록하면 계속 두드리는 동안 창이 갱신돼 영구 차단이 된다.
    return jsonb_build_object(
      'ok', false,
      'reason', 'rate_limited',
      'retry_after_seconds',
        greatest(1, ceil(extract(epoch from (oldest + make_interval(mins => invite_attempt_window_minutes())) - now()))::int)
    );
  end if;

  normalized_code := upper(regexp_replace(coalesce(p_code, ''), '[\s-]+', '', 'g'));

  if normalized_code !~ '^[A-Z0-9]{6,8}$' then
    insert into invite_attempts (student_id, outcome) values (student, 'invalid_format');
    return jsonb_build_object('ok', false, 'reason', 'invalid_format');
  end if;

  select *
    into invite_row
    from invite_codes
   where code = normalized_code
     and (expires_at is null or expires_at > now())
   for update;

  if not found then
    insert into invite_attempts (student_id, outcome) values (student, 'not_found');
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if invite_row.used_by is not null and invite_row.used_by <> student then
    insert into invite_attempts (student_id, outcome) values (student, 'already_used');
    return jsonb_build_object('ok', false, 'reason', 'already_used');
  end if;

  select *
    into existing_row
    from connections
   where teacher_id = invite_row.teacher_id
     and student_id = student
   for update;

  if found then
    if existing_row.status in ('rejected', 'disconnected') then
      update connections
         set status = 'pending',
             invite_code = normalized_code,
             requested_by = student,
             created_at = now(),
             activated_at = null
       where id = existing_row.id
      returning * into result_row;
      outcome_reason := 'reopened';
    else
      result_row := existing_row;
      outcome_reason := 'existing';
    end if;
  else
    insert into connections (teacher_id, student_id, status, invite_code, requested_by)
    values (invite_row.teacher_id, student, 'pending', normalized_code, student)
    returning * into result_row;
    outcome_reason := 'created';
  end if;

  update invite_codes
     set used_by = student
   where code = normalized_code
     and used_by is null;

  insert into disclosure_settings (connection_id)
  values (result_row.id)
  on conflict (connection_id) do nothing;

  insert into invite_attempts (student_id, outcome) values (student, 'success');

  return jsonb_build_object('ok', true, 'reason', outcome_reason, 'connection', to_jsonb(result_row));
end;
$$;

revoke all on function request_connection_by_invite(text) from public;
revoke all on function request_connection_by_invite(text) from anon;
grant execute on function request_connection_by_invite(text) to authenticated;

comment on function request_connection_by_invite(text) is
  '초대 코드로 연결 요청. 사용자 입력 실패는 예외가 아니라 {ok:false, reason} 으로 돌려준다 '
  '— 예외로 끝내면 시도 기록이 같은 트랜잭션에서 롤백돼 속도 제한을 셀 수 없다. 20260819030000 참고.';
