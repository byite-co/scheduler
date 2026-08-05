-- SECURITY: 두 개의 권한 상승 구멍을 막는다.
--
-- [1] 교사 숙제 변조 — 금지 목록(denylist) → 허용 목록(allowlist) 전환
--     기존 guard_student_todo_source_lock 은 "바꾸면 안 되는 컬럼 6개"만 검사했다:
--       ai_check_enabled / locked / source / connection_id / created_by / student_id
--     그 결과 학생이 교사 숙제의 title·subject·due_date 를 바꿀 수 있었다(실계정 확인).
--     title 이 사실상 "검사 범위"이므로, 범위를 좁혀놓고 AI 검사를 통과받는 우회가 가능했다.
--     금지 목록은 새 컬럼(예: scope_text)을 추가할 때 목록 갱신을 잊으면 같은 사고가 반복된다.
--     → 허용 목록으로 뒤집어 기본이 "잠김"이 되게 한다. 비교는 to_jsonb(row) - allowlist 로
--       수행하므로, 앞으로 어떤 컬럼이 추가돼도 목록에 명시하지 않는 한 자동으로 잠긴다.
--
-- [2] mock 프리미엄 RPC — 일반 사용자가 스스로 프리미엄이 될 수 있었다
--     mock_set_student_subscription 은 security definer 인데 authenticated 에 execute 권한이
--     있었다(실계정 프로브 확인: 권한 거부된 함수는 42501, 이 함수는 인자 검증까지 진입).
--     서버측 프리미엄 검증을 아무리 만들어도 이 문이 열려 있으면 무의미하다.
--
-- 교사(active 연결) 권한과 서비스롤 경로는 이번에 좁히지 않는다(기존 동작 유지).

-- ============================================================================
-- [1] todos 학생 수정 허용 목록
-- ============================================================================
create or replace function guard_student_todo_source_lock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- 학생 본인이 UPDATE 할 수 있는 컬럼(이 목록에 없으면 전부 잠김 = default-deny).
  student_editable text[];
  old_frozen jsonb;
  new_frozen jsonb;
begin
  if tg_op = 'INSERT' then
    -- 학생은 교사 숙제를 만들 수 없다.
    if auth.uid() = new.student_id and new.source = 'teacher' then
      raise exception 'students_cannot_create_teacher_todos';
    end if;
    if new.source = 'teacher' then
      new.locked := true;
    end if;
    return new;
  end if;

  -- UPDATE: 소유 학생 본인의 수정만 이 게이트를 통과한다.
  -- 교사(todos_teacher_rw, active 연결)와 서비스롤(auth.uid() is null)은 해당 없음 → 권한 유지.
  if auth.uid() = old.student_id then
    if old.source = 'teacher' then
      -- 교사 숙제: 완료 체크만. 범위(title)·과목·마감일을 포함해 그 외 전부 금지.
      student_editable := array['status'];
    else
      -- 내가 만든 할 일: 내용 편집 + 완료 체크 + AI 검사 토글.
      student_editable := array['title', 'subject', 'due_date', 'status', 'ai_check_enabled'];
    end if;

    -- 허용 컬럼을 제거한 나머지가 하나라도 다르면 거부.
    -- id/student_id/connection_id/source/created_by/created_at/locked 는 어느 쪽에도 없으므로 항상 잠김.
    old_frozen := to_jsonb(old) - student_editable;
    new_frozen := to_jsonb(new) - student_editable;

    if old_frozen is distinct from new_frozen then
      if old.source = 'teacher' then
        -- 기존 계약 유지: 앱/테스트가 이 메시지를 문자열로 확인한다.
        raise exception 'locked_teacher_todo_fields';
      else
        raise exception 'locked_self_todo_fields';
      end if;
    end if;
  end if;

  if new.source = 'teacher' then
    new.locked := true;
  end if;

  return new;
end;
$$;

drop trigger if exists guard_student_todo_source_lock_trigger on todos;
create trigger guard_student_todo_source_lock_trigger
before insert or update on todos
for each row execute function guard_student_todo_source_lock();

-- ============================================================================
-- [2] mock 프리미엄 RPC 실행 권한 회수
-- ============================================================================
-- 클라이언트가 도달할 수 있는 롤(anon/authenticated/public)에서 전부 회수한다.
--
-- ⚠️ 회수 후 이 함수는 사실상 사용 불가가 된다. 대상 학생을 auth.uid() 로 정하는 구조라
--    service_role(auth.uid() is null)로 부르면 'authentication_required' 로 실패한다.
--    grant 를 남기는 것은 "권한 상태를 명시적으로 문서화"하는 의미이며, 실제 개발/테스트용
--    프리미엄 상태 생성은 아래 방법을 쓴다(신규 SQL 불필요):
--      service_role 키로 student_subscriptions 직접 upsert (service_role 은 RLS 우회)
--    영구 대체는 실연동 Edge Function(iap-webhook)이며 별도 작업이다.
--    → 학생 앱의 mock 구독 토글 UI(m6Screens.tsx)는 이 회수로 동작하지 않게 된다(의도된 결과, 보고 참조).
revoke execute on function mock_set_student_subscription(sub_status, timestamptz) from public;
revoke execute on function mock_set_student_subscription(sub_status, timestamptz) from anon;
revoke execute on function mock_set_student_subscription(sub_status, timestamptz) from authenticated;
grant execute on function mock_set_student_subscription(sub_status, timestamptz) to service_role;
