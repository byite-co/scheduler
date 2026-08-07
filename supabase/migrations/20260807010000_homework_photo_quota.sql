-- 숙제 사진 업로드에 서버측 한도를 건다.
--
-- [왜] 기존 정책은 "자기 폴더인가"만 봤다. 그래서 인증만 되면
--   ① 5MB 파일을 개수 제한 없이 올릴 수 있고
--   ② homework_submissions 행을 만들지 않아도 되며(파일만 쌓기)
--   ③ 계정을 지워도 파일이 남는다.
--   비용이 발생하는데 게이트가 하나도 없던 유일한 기능이었다.
--
-- [설계 판단 — 누적 상한이 아니라 이동 창(rolling window)이다]
--   "계정당 총 N MB" 로 걸면, 보관 정리(cleanup)가 붙기 전에 **정상 사용자가 막힌다**.
--   하루 6장씩 쓰는 학생은 몇 년 뒤 반드시 상한에 닿고, 그때 업로드가 실패한다.
--   그래서 상한을 **최근 30일 업로드량**에 건다. 이건 누적이 아니라 속도 제한이라
--   장기 사용자를 막지 않으면서 버스트 남용을 막는다.
--   ⚠️ 누적 총량은 여전히 무제한이다 — 보관 정리 작업이 붙어야 닫힌다(아래 주석 참조).
--
-- [한도 근거]
--   사진 1장은 클라이언트가 긴 변 1568px · JPEG q0.8 로 줄여 올린다(≈ 1MB 이하).
--   정상 사용 최대치: 하루 2건 제출 × 9장 = 18장/일 → 30일 540장 ≈ 540MB.
--   여기에 약 2배 여유를 둬서 1,000장 / 1 GiB 로 잡았다. 정상 사용은 닿지 않는다.

-- ── 한도 상수 ────────────────────────────────────────────────────────────────
create or replace function homework_photo_quota_window_days() returns integer
  language sql immutable as $$ select 30 $$;
create or replace function homework_photo_quota_objects() returns integer
  language sql immutable as $$ select 1000 $$;
create or replace function homework_photo_quota_bytes() returns bigint
  language sql immutable as $$ select 1073741824 $$;  -- 1 GiB

comment on function homework_photo_quota_window_days() is
  '사진 업로드 한도를 계산하는 이동 창(일). 누적이 아니라 속도 제한이다.';
comment on function homework_photo_quota_objects() is
  '학생 1인이 최근 창 안에 올릴 수 있는 사진 장수 상한.';
comment on function homework_photo_quota_bytes() is
  '학생 1인이 최근 창 안에 올릴 수 있는 총 바이트 상한.';

-- ── 업로드 허용 판정 ─────────────────────────────────────────────────────────
--
-- ⚠️ security definer 가 **필수**다. storage.objects 의 정책 안에서 같은 테이블을
--    조회하는데, invoker 로 두면 정책이 자기 자신을 다시 평가해
--    "infinite recursion detected in policy" 가 난다.
--    마이그레이션은 postgres 로 실행되고 postgres 는 rolbypassrls = true 라
--    definer 안에서는 RLS 가 적용되지 않는다(확인함).
--
-- ⚠️ 인자로 student_id 를 받지 않는다. auth.uid() 만 본다 —
--    has_active_student_premium() 과 같은 이유다(임의 id 를 받으면 그 자체가
--    남의 사용량을 캐내는 경로가 된다).
create or replace function homework_photo_upload_allowed(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, storage
as $$
declare
  parts   text[] := storage.foldername(p_name);
  v_uid   uuid   := auth.uid();
  v_todo  uuid;
  v_objs  integer;
  v_bytes bigint;
  v_since timestamptz := now() - make_interval(days => homework_photo_quota_window_days());
begin
  if v_uid is null then
    return false;
  end if;

  -- 경로 규약: {student_id}/{todo_id}/{submission_key}/page-N.jpg → 폴더 3단.
  -- (storage.foldername 은 마지막 파일명을 뺀 배열을 준다. 폴더가 없으면 빈 배열이고
  --  array_length(빈 배열, 1) 은 0 이 아니라 NULL 이다 — coalesce 가 필요하다.)
  if coalesce(array_length(parts, 1), 0) <> 3 then
    return false;
  end if;
  if parts[1] is distinct from v_uid::text then
    return false;
  end if;

  -- 제출 기록 없이 파일만 쌓는 경로를 막는다.
  --
  -- homework_submissions 행을 요구할 수는 없다 — 클라이언트는 사진을 먼저 올리고
  -- 그 경로들로 제출 행을 만든다(uploadHomeworkPhotos → insert). 순서를 뒤집으면
  -- 정상 업로드가 전부 막힌다.
  -- 대신 경로의 todo_id 가 **내 할 일로 실재**할 것을 요구한다. 임의 경로에 파일을
  -- 쏟아붓는 경로는 이걸로 닫힌다.
  begin
    v_todo := parts[2]::uuid;
  exception when invalid_text_representation then
    return false;
  end;

  if not exists (select 1 from public.todos where id = v_todo and student_id = v_uid) then
    return false;
  end if;

  -- 최근 창의 사용량. **지금 올리는 행은 세지 않는다** — 업로드 시점에 metadata.size 가
  -- 채워졌다고 보장할 수 없다. 그래서 초과분은 최대 파일 1개(버킷 상한 5MB)만큼이다.
  select count(*)::integer,
         coalesce(sum(coalesce((metadata->>'size')::bigint, 0)), 0)
    into v_objs, v_bytes
  from storage.objects
  where bucket_id = 'homework-photos'
    and (storage.foldername(name))[1] = v_uid::text
    and created_at >= v_since;

  if v_objs >= homework_photo_quota_objects() then
    return false;
  end if;
  if v_bytes >= homework_photo_quota_bytes() then
    return false;
  end if;

  return true;
end;
$$;

comment on function homework_photo_upload_allowed(text) is
  '숙제 사진 업로드 허용 판정. 경로 규약 + 내 할 일 실재 + 최근 30일 사용량 한도. RLS 정책에서 호출한다.';

revoke all on function homework_photo_upload_allowed(text) from public;
revoke all on function homework_photo_upload_allowed(text) from anon;
grant execute on function homework_photo_upload_allowed(text) to authenticated;

-- 사용량 조회(안내 UI 용). 호출자 자신만 볼 수 있다.
create or replace function homework_photo_usage()
returns table (window_days integer, objects integer, bytes bigint, max_objects integer, max_bytes bigint)
language sql
stable
security definer
set search_path = public, storage
as $$
  select homework_photo_quota_window_days(),
         count(*)::integer,
         coalesce(sum(coalesce((metadata->>'size')::bigint, 0)), 0)::bigint,
         homework_photo_quota_objects(),
         homework_photo_quota_bytes()
  from storage.objects
  where bucket_id = 'homework-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and created_at >= now() - make_interval(days => homework_photo_quota_window_days())
$$;

comment on function homework_photo_usage() is
  '호출자의 최근 창 사진 사용량과 상한. 인자를 받지 않는다(남의 사용량 조회 방지).';

revoke all on function homework_photo_usage() from public;
revoke all on function homework_photo_usage() from anon;
grant execute on function homework_photo_usage() to authenticated;

-- ── INSERT 정책 교체 ─────────────────────────────────────────────────────────
-- 기존 정책은 "자기 폴더"만 봤다. 판정을 함수로 옮겨 한도까지 함께 강제한다.
drop policy if exists homework_photos_student_insert on storage.objects;
create policy homework_photos_student_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'homework-photos'
    and homework_photo_upload_allowed(name)
  );

-- ── 보관 정리(retention) ─────────────────────────────────────────────────────
--
-- ⚠️ 여기서 실제 삭제는 하지 않는다. storage.objects 행을 지워도 **실제 파일(S3)은
--    남는다** — 삭제는 Storage API 를 거쳐야 한다. 그래서 이 함수는 "지울 대상 목록"만
--    돌려주고, 삭제는 service_role 로 Storage API 를 호출하는 작업이 담당한다.
--    (계정 탈퇴 시 파일 정리도 같은 수단이 필요하다 → 한 번에 만드는 게 맞다.)
create or replace function homework_photo_retention_days() returns integer
  language sql immutable as $$ select 180 $$;

comment on function homework_photo_retention_days() is
  '숙제 사진 보관 기간(일). 판정 결과는 homework_check_attempts 에 남으므로 사진이 지워져도 이력은 보존된다.';

create or replace function homework_photos_expired_paths(p_limit integer default 1000)
returns table (path text, created_at timestamptz)
language sql
stable
security definer
set search_path = public, storage
as $$
  select name, created_at
  from storage.objects
  where bucket_id = 'homework-photos'
    and created_at < now() - make_interval(days => homework_photo_retention_days())
  order by created_at
  limit greatest(1, least(coalesce(p_limit, 1000), 10000))
$$;

comment on function homework_photos_expired_paths(integer) is
  '보관 기간이 지난 사진 경로 목록. 실제 삭제는 Storage API 가 필요하다(행만 지우면 파일이 남는다). service_role 전용.';

revoke all on function homework_photos_expired_paths(integer) from public;
revoke all on function homework_photos_expired_paths(integer) from anon;
revoke all on function homework_photos_expired_paths(integer) from authenticated;
grant execute on function homework_photos_expired_paths(integer) to service_role;
