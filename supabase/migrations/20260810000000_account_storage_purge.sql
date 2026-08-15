-- 계정 탈퇴 시 Storage 사진 정리 — 대기열과 조회 함수.
--
-- [문제] delete_my_account() 는 auth.users 한 행을 지우고 DB 를 cascade 로 정리한다.
--   그런데 **Storage 파일은 남는다.** storage.objects 행을 지워도 실제 S3 객체는 그대로다 —
--   삭제는 Storage API 를 거쳐야 하고, 그건 Postgres 트랜잭션 안에서 할 수 없다.
--   "탈퇴했는데 내 숙제 사진이 서버에 남아 있다"는 상태로 출시할 수 없다.
--
-- [설계] 두 겹으로 만든다.
--   1) **트리거가 대기열에 넣는다.** profiles 가 지워질 때 무조건 한 행을 남긴다.
--      Edge Function 을 안 거치고 RPC 를 직접 부르거나 관리자가 계정을 지워도,
--      "이 사용자의 파일을 지워야 한다"는 사실이 반드시 기록된다.
--      → 어떤 경로로 지워도 **조용히 새지 않는다.**
--   2) **Edge Function(account-delete) 이 실제로 지운다.** 지운 뒤 대기열 행을 완료 처리한다.
--      실패하면 행이 pending 으로 남고 attempts/last_error 가 쌓인다 → 사람이 볼 수 있다.
--
-- [왜 트리거만으로는 안 되는가] Storage API 호출이 SQL 에서 불가능하다.
-- [왜 Edge Function 만으로는 안 되는가] 클라이언트가 함수를 안 부르고 RPC 만 부르면
--   파일이 조용히 남는다. 트리거는 그 구멍을 막는다.
--
-- ⚠️ 이 대기열은 **profiles 를 참조하지 않는다.** 참조하면 계정이 지워질 때 대기열 행도
--    함께 사라져서 존재 의미가 없어진다.

create table if not exists storage_purge_queue (
  id           uuid primary key default gen_random_uuid(),
  -- FK 없음(의도적). 이 행은 사용자가 사라진 뒤에도 살아 있어야 한다.
  user_id      uuid not null,
  bucket_id    text not null,
  -- 지울 대상 폴더. 항상 '<user_id>/' 형태다 — 남의 파일을 지우지 않기 위한 유일한 기준.
  prefix       text not null,
  status       text not null default 'pending',
  attempts     integer not null default 0,
  deleted_count integer not null default 0,
  last_error   text,
  created_at   timestamptz not null default now(),
  completed_at timestamptz,

  constraint storage_purge_queue_status_check
    check (status in ('pending', 'done', 'failed')),
  -- prefix 가 user_id 로 시작하지 않으면 남의 파일을 지우게 된다. DB 에서 막는다.
  constraint storage_purge_queue_prefix_scoped
    check (prefix = user_id::text || '/'),
  constraint storage_purge_queue_attempts_non_negative
    check (attempts >= 0 and deleted_count >= 0)
);

create index if not exists storage_purge_queue_pending_idx
  on storage_purge_queue (status, created_at)
  where status <> 'done';

comment on table storage_purge_queue is
  '탈퇴한 사용자의 Storage 파일 정리 대기열. 실제 삭제는 Edge Function(account-delete)이 한다.';

-- 서버 전용. 클라이언트가 읽거나 쓸 이유가 없다(탈퇴한 사용자의 흔적이다).
alter table storage_purge_queue enable row level security;
-- 정책을 하나도 만들지 않는다 = authenticated/anon 은 아무것도 못 한다.
-- service_role 은 RLS 를 우회하므로 Edge Function 만 접근한다.

-- ── 삭제 시 대기열 적재 트리거 ───────────────────────────────────────────────
create or replace function enqueue_storage_purge_on_profile_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into storage_purge_queue (user_id, bucket_id, prefix)
  values (old.id, 'homework-photos', old.id::text || '/');
  return old;
exception when others then
  -- 대기열 적재 실패로 탈퇴 자체를 막지 않는다. 사용자의 삭제 요구가 우선이다.
  -- 대신 경고를 남겨 로그에서 추적할 수 있게 한다.
  raise warning 'enqueue_storage_purge_on_profile_delete failed for %: %', old.id, sqlerrm;
  return old;
end;
$$;

drop trigger if exists enqueue_storage_purge_on_profile_delete_trigger on profiles;
create trigger enqueue_storage_purge_on_profile_delete_trigger
before delete on profiles
for each row execute function enqueue_storage_purge_on_profile_delete();

-- ── Edge Function 이 쓰는 조회·기록 함수 ─────────────────────────────────────
--
-- Storage API 의 list() 는 폴더 단위 페이지네이션이라 하위 경로를 빠뜨리기 쉽다.
-- storage.objects 를 직접 조회하면 **정확히** 그 사용자의 객체만 얻는다.
create or replace function storage_paths_for_prefix(p_bucket text, p_prefix text)
returns table (path text)
language sql
stable
security definer
set search_path = public, storage
as $$
  select name
  from storage.objects
  where bucket_id = p_bucket
    -- like 는 _ 와 % 가 와일드카드다. prefix 는 'uuid/' 라 둘 다 없지만,
    -- 폴더 첫 조각을 직접 비교하는 편이 의도가 분명하고 우회 여지가 없다.
    and (storage.foldername(name))[1] = rtrim(p_prefix, '/')
  order by name
$$;

comment on function storage_paths_for_prefix(text, text) is
  '한 사용자 폴더의 Storage 객체 경로 목록. service_role 전용 — 삭제 대상을 정확히 좁히는 용도.';

revoke all on function storage_paths_for_prefix(text, text) from public;
revoke all on function storage_paths_for_prefix(text, text) from anon;
revoke all on function storage_paths_for_prefix(text, text) from authenticated;
grant execute on function storage_paths_for_prefix(text, text) to service_role;

create or replace function complete_storage_purge(
  p_id uuid,
  p_deleted_count integer,
  p_error text default null
)
returns storage_purge_queue
language plpgsql
security definer
set search_path = public
as $$
declare
  result storage_purge_queue%rowtype;
begin
  update storage_purge_queue
     set status        = case when p_error is null then 'done' else 'failed' end,
         attempts      = attempts + 1,
         deleted_count = deleted_count + greatest(coalesce(p_deleted_count, 0), 0),
         last_error    = p_error,
         completed_at  = case when p_error is null then now() else null end
   where id = p_id
  returning * into result;

  if not found then
    raise exception 'purge_row_not_found';
  end if;
  return result;
end;
$$;

comment on function complete_storage_purge(uuid, integer, text) is
  '정리 결과 기록. 실패는 status=failed 로 남겨 사람이 볼 수 있게 한다(조용히 사라지지 않는다).';

revoke all on function complete_storage_purge(uuid, integer, text) from public;
revoke all on function complete_storage_purge(uuid, integer, text) from anon;
revoke all on function complete_storage_purge(uuid, integer, text) from authenticated;
grant execute on function complete_storage_purge(uuid, integer, text) to service_role;
