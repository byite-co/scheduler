-- 숙제 사진 실제 업로드를 위한 서버측 강제.
--
-- 지금까지 제출은 스텁이었다 — photo_paths 에 경로 문자열만 넣고 실제 파일은 Storage 에
-- 올라가지 않았다. AI 가 판정할 사진이 없었다는 뜻이다.
--
-- 클라이언트 검증은 안내용이고 우회 가능하다. 서버에서 막아야 하는 것 세 가지:
--   (1) 파일 용량·형식  → 버킷 설정
--   (2) 과외쌤 열람 범위 → Storage RLS 정책
--   (3) 경로 위조·장수   → homework_submissions 가드

-- ── (1) 버킷 제한 ────────────────────────────────────────────────────────────
-- 용량 5MB: Claude 비전은 이미지를 긴 변 ~1568px 로 리사이즈해서 읽으므로 그보다 큰 원본을
-- 올려도 판독 품질이 좋아지지 않고 업로드·저장 비용만 늘어난다. 앱은 업로드 전에 긴 변
-- 1568px / JPEG q0.8 로 줄여 보내므로 실제 파일은 보통 1MB 미만이다. 5MB 는 "클라이언트를
-- 우회한 요청까지 막는 상한"이다(9장 × 5MB = 45MB 가 한 제출의 최악값).
--
-- MIME: Claude 비전이 읽을 수 있는 것만 허용한다. HEIC 는 제외 — iOS 원본 형식이지만
-- 비전 API 가 못 읽으므로 앱이 업로드 전에 JPEG 로 변환한다. 버킷이 HEIC 를 받아 주면
-- "올라갔는데 AI 가 못 읽는 사진"이 생긴다.
update storage.buckets
   set file_size_limit = 5242880,  -- 5 * 1024 * 1024
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
 where id = 'homework-photos';

-- ── (2) 과외쌤 열람 ──────────────────────────────────────────────────────────
-- 버킷이 private 이라 서명 URL 이 필요하고, 서명 URL 발급은 그 객체에 SELECT 권한이 있어야
-- 된다. 지금까지 과외쌤에게는 SELECT 정책이 없어 사진을 볼 수 없었다.
--
-- 서버 경유(Edge Function)로 발급하는 방법도 있지만 Storage RLS 정책으로 택했다:
--   · 게이팅 조건을 subs_teacher_read 와 **완전히 같은 식**으로 쓸 수 있다 → 규칙이 한 곳에만
--     있고 갈라지지 않는다(이 레포에서 반복해 겪은 문제).
--   · 서버 왕복이 없어 과외쌤 앱이 createSignedUrl 을 직접 부를 수 있다.
--   · 선언적이라 통합 테스트로 검증된다 — Edge Function 경유는 배포 없이 검증할 수 없다.
--
-- 경로 규칙은 `${studentUid}/${todoId}/page-N.jpg` 이므로 첫 폴더가 학생 uid 다.
drop policy if exists homework_photos_teacher_select on storage.objects;
create policy homework_photos_teacher_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'homework-photos'
    and exists (
      select 1
        from connections c
        join disclosure_settings d on d.connection_id = c.id
       where c.teacher_id = auth.uid()
         and c.student_id::text = (storage.foldername(name))[1]
         and c.status = 'active'
         and d.share_homework_photos
    )
  );

-- ── (3) 제출 경로·장수 강제 ──────────────────────────────────────────────────
-- 사진 1~9장. array_length 는 빈 배열에 NULL 을 주므로 coalesce 가 없으면 0장이 통과한다
-- (homework_check_attempts 에서 이미 겪은 함정).
alter table homework_submissions
  add constraint subs_photo_count
  check (coalesce(array_length(photo_paths, 1), 0) between 1 and 9);

-- 경로가 남의 폴더를 가리키면 Storage 정책이 업로드는 막아도 "제출 레코드가 남의 사진을
-- 가리키는" 상태는 만들 수 있다. 그러면 과외쌤 검사 화면에 다른 학생의 사진이 뜬다.
-- 제출자 본인 폴더만 허용한다.
create or replace function guard_homework_submission_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    if tg_op = 'INSERT'
      and (new.ai_verdict is not null or new.ai_confidence is not null or new.ai_reason is not null) then
      raise exception 'ai_fields_are_server_set';
    end if;
    if tg_op = 'UPDATE'
      and (new.ai_verdict is distinct from old.ai_verdict
        or new.ai_confidence is distinct from old.ai_confidence
        or new.ai_reason is distinct from old.ai_reason) then
      raise exception 'ai_fields_are_server_set';
    end if;
  end if;
  if tg_op = 'UPDATE' and auth.uid() = new.student_id then
    if new.teacher_status is distinct from old.teacher_status
      or new.teacher_comment is distinct from old.teacher_comment
      or new.resubmit_requested is distinct from old.resubmit_requested then
      raise exception 'teacher_fields_not_student_editable';
    end if;
  end if;

  -- 모든 사진 경로는 제출 학생의 폴더(`${student_id}/...`) 안이어야 한다.
  -- service_role 도 예외로 두지 않는다 — 서버 코드의 실수도 같은 사고를 만든다.
  if exists (
    select 1
      from unnest(new.photo_paths) as p
     where p is null
        or p not like new.student_id::text || '/%'
  ) then
    raise exception 'photo_paths_must_be_in_own_folder';
  end if;

  return new;
end;
$$;

comment on constraint subs_photo_count on homework_submissions is
  '사진 1~9장. coalesce 없이 array_length 를 쓰면 빈 배열(NULL)이 통과한다.';
