-- 탈퇴 Storage 대기열 처리기 — 큐에 쌓이기만 하던 것을 실제로 비운다.
--
-- [현재 상태] `storage_purge_queue` 는 프로필 삭제 BEFORE 트리거가 채운다
--   (enqueue_storage_purge_on_profile_delete). 그런데 큐를 비우는 것은
--   `account-delete` Edge Function **안에서 인라인으로만** 일어난다. 그 함수를 거치지 않고
--   `delete_my_account()` RPC 만 부르면(또는 인라인 처리가 실패하면) 행이 pending 으로
--   영구히 남고 **사진은 Storage 에 그대로 남는다.** "탈퇴하면 지웁니다" 가 거짓이 된다.
--
-- 이 마이그레이션은 **독립 처리기가 안전하게 큐를 비울 수 있도록** 세 가지를 더한다.
--
-- ════════════════════════════════════════════════════════════════════════════
-- [1] 감사 로그 — 무엇을 언제 지웠는지
-- ════════════════════════════════════════════════════════════════════════════
--
-- 지금은 `deleted_count`(합계)와 `last_error`(마지막 오류) 뿐이라 "무엇을" 지웠는지 알 수 없다.
-- 개인정보 삭제는 나중에 "정말 지웠나" 를 증명해야 하는 종류의 일이다. 큐 행은 지워질 수도
-- 있으므로(정리·재적재) 로그는 **별도 표**에 남긴다.
--
-- ⚠️ 경로에는 학생 UUID 가 들어 있다. 그래서 이 표는 클라이언트에 **정책 0개**다 —
--    service_role 만 읽고 쓴다. RLS 를 켜 두는 이유는 정책 없는 표에 대한 기본 거부를 얻기 위함이다.
create table if not exists storage_purge_log (
  id            uuid primary key default gen_random_uuid(),
  queue_id      uuid,                       -- FK 없음: 큐 행이 사라져도 로그는 남아야 한다
  user_id       uuid not null,
  bucket_id     text not null,
  prefix        text not null,
  -- 이번 시도에서 실제로 삭제된 경로. 0건이면 빈 배열(무엇도 못 지웠다는 사실도 기록이다).
  deleted_paths text[] not null default '{}',
  attempt_no    integer not null,
  outcome       text not null,
  error         text,
  ran_at        timestamptz not null default now(),

  constraint storage_purge_log_outcome_check
    check (outcome in ('deleted', 'nothing_to_delete', 'failed')),
  constraint storage_purge_log_attempt_positive check (attempt_no >= 1)
);

create index if not exists storage_purge_log_user_idx on storage_purge_log (user_id, ran_at desc);
create index if not exists storage_purge_log_queue_idx on storage_purge_log (queue_id);

comment on table storage_purge_log is
  '탈퇴 Storage 삭제 감사 로그. 큐 행이 사라져도 남는다(FK 없음). 경로에 UUID 가 있어 클라이언트 정책 0개.';

alter table storage_purge_log enable row level security;
-- 정책을 만들지 않는다 = 클라이언트 전면 거부. service_role 은 RLS 를 우회한다.

-- ════════════════════════════════════════════════════════════════════════════
-- [2] 재시도 — 실패를 조용히 버리지 않는다
-- ════════════════════════════════════════════════════════════════════════════
--
-- [before] complete_storage_purge 는 오류가 오면 **즉시** status='failed' 로 못 박았다.
--   일시적 실패(네트워크·Storage 5xx)와 영구 실패(권한·잘못된 경로)를 구분하지 못하고,
--   한 번 실패하면 아무도 다시 시도하지 않는다 → 사진이 남는다.
--
-- [after] 최대 시도 횟수까지는 pending 으로 되돌려 다음 실행이 집는다. 그 횟수를 넘기면
--   failed 로 굳히고 **행을 지우지 않는다** — 사람이 볼 수 있게 남겨 둔다.
--   5회로 잡은 이유: 일시적 장애는 몇 분~몇 시간이면 풀린다. 5회를 넘겨도 실패한다면
--   재시도로 해결되는 문제가 아니라 사람이 봐야 하는 문제다.
create or replace function storage_purge_max_attempts() returns integer
  language sql immutable as $$ select 5 $$;

comment on function storage_purge_max_attempts() is
  '탈퇴 Storage 삭제 최대 시도 횟수. 넘기면 failed 로 굳히고 행을 보존한다(사람이 본다).';

-- ════════════════════════════════════════════════════════════════════════════
-- [3] 선점(claim) — 동시 실행이 같은 행을 두 번 처리하지 않게
-- ════════════════════════════════════════════════════════════════════════════
--
-- 처리기를 두 번 부르거나 스케줄과 수동 실행이 겹치면 두 실행이 같은 pending 행을 집는다.
-- 삭제는 멱등이라 파일이 두 번 지워져도 결과는 같지만, 시도 횟수와 로그가 이중 계상되고
-- 같은 행에 대한 complete 호출이 경쟁한다.
--
-- claimed_at 을 조건부 UPDATE 로 채워 **한 실행만** 그 행을 가져간다(A2.1 의 리스와 같은 논리).
-- 임차가 만료되면(처리기가 죽었을 때) 다음 실행이 탈환한다 — 그러지 않으면 크래시 한 번에
-- 그 행이 영구히 처리 불가가 된다.
alter table storage_purge_queue
  add column if not exists claimed_at timestamptz;

comment on column storage_purge_queue.claimed_at is
  '처리기가 이 행을 가져간 시각. 임차가 만료되면 다음 실행이 탈환한다(처리기 크래시 복구).';

create or replace function storage_purge_lease_minutes() returns integer
  language sql immutable as $$ select 10 $$;

/**
 * pending 행을 최대 p_limit 개 선점해 돌려준다.
 * 같은 행을 두 실행이 동시에 가져갈 수 없다 — for update skip locked 로 경쟁을 피하고,
 * claimed_at 을 채워 다음 실행이 즉시 다시 집지 못하게 한다.
 */
create or replace function claim_storage_purge_batch(p_limit integer default 20)
returns setof storage_purge_queue
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidates as (
    select q.id
    from storage_purge_queue q
    where q.status = 'pending'
      and q.attempts < storage_purge_max_attempts()
      and (
        q.claimed_at is null
        or q.claimed_at < now() - make_interval(mins => storage_purge_lease_minutes())
      )
    order by q.created_at
    limit greatest(1, least(coalesce(p_limit, 20), 200))
    -- 다른 트랜잭션이 잡고 있는 행은 건너뛴다. 기다리면 두 처리기가 서로를 막는다.
    for update skip locked
  )
  update storage_purge_queue q
     set claimed_at = now()
   where q.id in (select id from candidates)
  returning q.*;
end;
$$;

comment on function claim_storage_purge_batch(integer) is
  'pending 삭제 작업을 선점한다. 동시 실행이 같은 행을 두 번 처리하지 않게 한다. service_role 전용.';

revoke all on function claim_storage_purge_batch(integer) from public;
revoke all on function claim_storage_purge_batch(integer) from anon;
revoke all on function claim_storage_purge_batch(integer) from authenticated;
grant execute on function claim_storage_purge_batch(integer) to service_role;

revoke all on function storage_purge_max_attempts() from public;
revoke all on function storage_purge_max_attempts() from anon;
grant execute on function storage_purge_max_attempts() to authenticated, service_role;
revoke all on function storage_purge_lease_minutes() from public;
revoke all on function storage_purge_lease_minutes() from anon;
grant execute on function storage_purge_lease_minutes() to authenticated, service_role;

-- ── complete_storage_purge 재정의 (재시도 + 감사 로그) ───────────────────────
--
-- 시그니처는 그대로다 — account-delete Edge Function 이 이미 이 인자로 부른다.
-- 인자를 하나 늘려(삭제된 경로) 로그를 남기되 default 를 줘서 기존 2·3인자 호출을 살린다.
-- ⚠️ default 를 붙이면 시그니처가 달라져 옛 3인자 함수가 남는다 → drop 후 재생성한다.
drop function if exists complete_storage_purge(uuid, integer, text);

create or replace function complete_storage_purge(
  p_id uuid,
  p_deleted_count integer,
  p_error text default null,
  p_deleted_paths text[] default null
)
returns storage_purge_queue
language plpgsql
security definer
set search_path = public
as $$
declare
  result storage_purge_queue%rowtype;
  next_attempts integer;
begin
  select attempts + 1 into next_attempts from storage_purge_queue where id = p_id;
  if next_attempts is null then
    raise exception 'storage_purge_queue_row_not_found';
  end if;

  update storage_purge_queue
     set status = case
                    when p_error is null then 'done'
                    -- 아직 재시도 여력이 있으면 pending 으로 돌려보낸다(조용히 버리지 않는다).
                    when next_attempts < storage_purge_max_attempts() then 'pending'
                    else 'failed'
                  end,
         attempts      = next_attempts,
         deleted_count = deleted_count + greatest(coalesce(p_deleted_count, 0), 0),
         last_error    = p_error,
         -- 재시도로 돌아갈 때는 선점을 풀어 다음 실행이 바로 집을 수 있게 한다.
         claimed_at    = case when p_error is null then claimed_at else null end,
         completed_at  = case when p_error is null then now() else null end
   where id = p_id
  returning * into result;

  -- 감사 로그. 실패도 남긴다 — 무엇을 못 지웠는지가 더 중요하다.
  insert into storage_purge_log (queue_id, user_id, bucket_id, prefix, deleted_paths, attempt_no, outcome, error)
  values (
    result.id, result.user_id, result.bucket_id, result.prefix,
    coalesce(p_deleted_paths, '{}'),
    next_attempts,
    case
      when p_error is not null then 'failed'
      when coalesce(p_deleted_count, 0) > 0 then 'deleted'
      else 'nothing_to_delete'
    end,
    p_error
  );

  return result;
end;
$$;

comment on function complete_storage_purge(uuid, integer, text, text[]) is
  '삭제 시도 결과를 기록한다. 20260818000000: 재시도(최대 5회) + 감사 로그(storage_purge_log). 실패 행은 지우지 않고 남긴다.';

revoke all on function complete_storage_purge(uuid, integer, text, text[]) from public;
revoke all on function complete_storage_purge(uuid, integer, text, text[]) from anon;
revoke all on function complete_storage_purge(uuid, integer, text, text[]) from authenticated;
grant execute on function complete_storage_purge(uuid, integer, text, text[]) to service_role;
