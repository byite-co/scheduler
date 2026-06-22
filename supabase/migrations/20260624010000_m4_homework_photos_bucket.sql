-- M4: 숙제 제출 사진 버킷(비공개). 학생은 자기 폴더(${uid}/...)만 관리한다.
-- (집중 모드 졸음 영상 버킷은 만들지 않는다 — 온디바이스 전용.)
-- 과외쌤의 사진 열람은 공개범위 + 서명 URL을 통한 서버 경유로 추후 강화한다(메타데이터/판정은 RLS로 이미 보호).

insert into storage.buckets (id, name, public)
values ('homework-photos', 'homework-photos', false)
on conflict (id) do nothing;

drop policy if exists homework_photos_student_insert on storage.objects;
create policy homework_photos_student_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'homework-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists homework_photos_student_select on storage.objects;
create policy homework_photos_student_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'homework-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists homework_photos_student_delete on storage.objects;
create policy homework_photos_student_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'homework-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
