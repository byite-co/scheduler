-- A5.1 — OLD-불가시성 클래스 ①: 트리거로 막아야 하는 것.
--
-- [이 클래스가 무엇인가]
--   UPDATE 정책이 소유자만 확인하고(`using/with check` 에 소유 컬럼만 나오고), 그 행에
--   **불변이어야 할 다른 컬럼**이 있으면 소유자가 그 컬럼을 자유롭게 바꿀 수 있다.
--   `with check` 는 UPDATE 후 행만 보고 OLD 를 참조할 수 없으므로 "이 컬럼은 안 바뀌었다" 를
--   정책으로 표현할 방법이 없다. A5 의 connections.student_id 가 이 클래스의 첫 사례였다.
--
-- [왜 여기서는 컬럼 권한이 아니라 트리거인가 — 클라이언트 실사용을 먼저 확인했다]
--   컬럼 권한 회수는 "그 컬럼이 UPDATE 문에 등장하는 것" 자체를 막는다. 값이 같아도 막힌다.
--   그런데 세 앱의 프로필 저장은 모두 upsert 이고 role 을 **매번 같은 값으로** 실어 보낸다:
--       apps/student/src/m1Screens.tsx:401       role: "student"
--       apps/teacher/src/app/m1.tsx:602, :672    role: "teacher"
--       apps/teacher-mobile/src/authScreens.tsx:256, profileSettingsScreen.tsx:46
--   upsert 는 충돌 시 UPDATE 로 내려가므로 UPDATE(role) 을 회수하면 **프로필 저장이 깨진다.**
--   이번 작업은 apps/ 를 건드릴 수 없고, 애초에 화면을 고칠 이유도 없다 —
--   막아야 하는 것은 "role 을 실어 보내는 것" 이 아니라 "role 을 **바꾸는** 것" 이다.
--   그건 OLD 를 볼 수 있는 트리거만 표현할 수 있다.
--
--   이 레포에 이미 같은 도구가 있다(guard_homework_submission_fields,
--   guard_student_todo_source_lock) — 같은 관용구를 따른다.

-- ── ① profiles.role 승격 차단 ────────────────────────────────────────────────
-- 실측: 학생이 `update profiles set role='teacher' where id = auth.uid()` 로
--       role=teacher 가 됐다(영향 1행, 조회값 teacher). 교사가 되면 초대 코드를 발급하고
--       학생 연결을 받을 수 있다 — 권한 상승이다.
create or replace function guard_profile_immutable_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 클라이언트 세션이 없으면(service_role·마이그레이션·트리거) 통과시킨다.
  -- 역할 부여·정정은 서버의 일이다.
  if auth.uid() is null then
    return new;
  end if;

  if new.role is distinct from old.role then
    raise exception 'role_is_not_self_assignable';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_profile_immutable_fields_trigger on profiles;
create trigger guard_profile_immutable_fields_trigger
  before update on profiles
  for each row execute function guard_profile_immutable_fields();

comment on function guard_profile_immutable_fields() is
  'profiles.role 은 본인이 바꿀 수 없다. 정책으로는 표현 불가(with check 가 OLD 를 못 본다)이고, '
  '컬럼 권한 회수로는 프로필 upsert 가 깨진다(role 을 같은 값으로 매번 보낸다). 20260820000000 참고.';

-- ── ② 잠긴 선생님 숙제의 DELETE 차단 ────────────────────────────────────────
-- 실측: guard_student_todo_source_lock 이 INSERT·UPDATE 만 다뤄서
--       학생이 locked=true 인 teacher 숙제를 **DELETE 로 지울 수 있었다**(남은 행 0건).
--       UPDATE 로 locked 를 못 푸는 것은 맞았지만, 지우는 데는 locked 를 풀 필요가 없었다.
create or replace function guard_locked_todo_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return old;
  end if;

  -- 선생님이 낸 숙제는 낸 사람이 거둔다. 학생은 상태(done/todo)만 바꿀 수 있다
  -- — guard_student_todo_source_lock 의 student_editable 목록과 같은 방침이다.
  if old.source = 'teacher' and auth.uid() = old.student_id then
    raise exception 'students_cannot_delete_teacher_todos';
  end if;

  return old;
end;
$$;

drop trigger if exists guard_locked_todo_delete_trigger on todos;
create trigger guard_locked_todo_delete_trigger
  before delete on todos
  for each row execute function guard_locked_todo_delete();

comment on function guard_locked_todo_delete() is
  '학생은 source=teacher 숙제를 삭제할 수 없다. UPDATE 쪽 잠금(guard_student_todo_source_lock)에 '
  'DELETE 대응이 없어서 지우는 것으로 우회됐다. 20260820000000 참고.';
