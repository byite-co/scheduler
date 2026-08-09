-- 회원 탈퇴 FK 정리 2/2 — reports.teacher_id, invite_codes.used_by.
--
-- 20260809010000 을 적용한 뒤 원격을 전수 조회해 남은 NO ACTION 두 건을 더 찾았다.
-- 적용된 마이그레이션은 고치지 않는다(불변) — 그래서 파일을 나눴다.
--
-- 판단 기준은 앞 마이그레이션과 같다: **한 사용자의 탈퇴가 다른 사용자의 데이터를
-- 지우면 안 된다.** 그래서 CASCADE 가 아니라 SET NULL 이다.

-- ── reports.teacher_id ──────────────────────────────────────────────────────
-- 리포트는 **학생의 기록**이다(student_id 는 CASCADE). 과외쌤이 탈퇴해도 학생이 받은
-- 리포트가 사라지면 안 된다. 이미 nullable 이고 주석도 "학생 본인 리포트면 null" 이다.
alter table reports drop constraint reports_teacher_id_fkey;
alter table reports
  add constraint reports_teacher_id_fkey
  foreign key (teacher_id) references profiles(id) on delete set null;

comment on column reports.teacher_id is
  '작성한 과외쌤. 학생 본인 리포트이거나 과외쌤이 탈퇴하면 NULL — 리포트는 학생 것이라 남긴다.';

-- ── invite_codes.used_by ────────────────────────────────────────────────────
-- 초대코드 사용 이력. 사용자가 탈퇴하면 "누가 썼는지"만 지우고 코드 행은 남긴다.
alter table invite_codes drop constraint invite_codes_used_by_fkey;
alter table invite_codes
  add constraint invite_codes_used_by_fkey
  foreign key (used_by) references profiles(id) on delete set null;

comment on column invite_codes.used_by is
  '코드를 쓴 사람. 탈퇴하면 NULL — 코드 소진 이력은 남긴다.';

-- 이로써 profiles 를 참조하는 FK 중 ON DELETE 절이 없는 것은 0개가 된다.
-- 회귀 방어: m7.schema.test.ts 가 네 제약의 SET NULL 을 검사한다.
