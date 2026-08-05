-- BUGFIX: scope_text 정규화가 탭·개행을 공백으로 취급하지 않아, "공백뿐인 입력"이
-- NULL 로 정규화되지 않고 CHECK 제약 위반(23514)으로 거부됐다.
--
-- 원인: Postgres 의 btrim(string) 은 인자가 하나면 **space(' ')만** 제거한다.
--   btrim(E'\t\n ')  →  E'\t\n'   (탭·개행이 남는다)
--   nullif(E'\t\n', '')  →  E'\t\n'  (NULL 이 아니다)
--   → CHECK: length(regexp_replace(E'\t\n', '\s', '', 'g')) = 0, 0 between 1 and 500 = false → 거부
--
-- 반면 앱 쪽 헬퍼(packages/shared/src/m2.ts 의 normalizeTodoScopeText)는 JS 의 .trim() 을
-- 쓰므로 모든 공백을 제거한다. 즉 앱은 "빈 값"으로 보고 통과시키는데 DB 가 거부했다 —
-- 20260806010000 주석이 경고한 "DB 와 앱 규칙이 갈라지면 날 오류가 사용자에게 보인다"가
-- 바로 이 형태로 실현됐다. 실제 계정 검증에서 HTTP 400 으로 잡혔다.
--
-- 수정: CHECK 제약이 쓰는 것과 같은 \s 클래스로 앞뒤 공백을 제거한다. 한 함수 안에서
-- 두 곳이 같은 공백 정의를 쓰게 되므로 다시 갈라지지 않는다.
--   regexp_replace(v, '^\s+|\s+$', '', 'g')  →  \s = [[:space:]] (space·tab·CR·LF·FF·VT)
--
-- 20260806010000 은 이미 원격에 적용됐으므로 그 파일을 고치지 않는다. 적용된 마이그레이션의
-- 내용을 바꾸면 레포의 이력과 실제 DB 상태가 어긋나고, "새 DB 에서는 되는데 운영에서는
-- 안 되는" 종류의 사고를 만든다. 함수만 교체하는 후속 마이그레이션으로 수렴시킨다.
--
-- 컬럼·제약·데이터 이전은 그대로다 — 이 마이그레이션은 함수 본문만 바꾼다.
create or replace function guard_student_todo_source_lock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  student_editable text[];
  old_frozen jsonb;
  new_frozen jsonb;
begin
  -- 빈 문자열·공백뿐인 입력은 NULL 로 정규화한다. "범위 없음"을 표현하는 값은 하나여야
  -- 한다 — '' 와 NULL 이 섞이면 AI 검사 분기가 두 값을 모두 다뤄야 한다.
  --
  -- 앞뒤 공백 제거에 btrim(v) 을 쓰면 안 된다 — 인자가 하나면 space 만 지우고 탭·개행이
  -- 남는다. CHECK 제약과 같은 \s 클래스를 써야 두 규칙이 갈라지지 않는다.
  --
  -- 별도 트리거로 분리하지 않고 이 함수 맨 앞에 둔 이유:
  --   · 같은 테이블의 BEFORE 트리거는 이름 알파벳순으로 실행된다 → 순서가 이름에 의존해 깨지기 쉽다.
  --   · 아래 INSERT 분기는 early return 하므로, INSERT 에도 적용되려면 그보다 앞이어야 한다.
  --   · 허용 목록 비교보다 먼저 정규화돼야 '' → NULL 같은 실질적 무변경이 오탐으로 막히지 않는다.
  new.scope_text := nullif(regexp_replace(new.scope_text, '^\s+|\s+$', '', 'g'), '');

  if tg_op = 'INSERT' then
    if auth.uid() = new.student_id and new.source = 'teacher' then
      raise exception 'students_cannot_create_teacher_todos';
    end if;
    if new.source = 'teacher' then
      new.locked := true;
    end if;
    return new;
  end if;

  if auth.uid() = old.student_id then
    if old.source = 'teacher' then
      student_editable := array['status'];
    else
      student_editable := array['title', 'subject', 'due_date', 'status', 'ai_check_enabled', 'scope_text'];
    end if;

    old_frozen := to_jsonb(old) - student_editable;
    new_frozen := to_jsonb(new) - student_editable;

    if old_frozen is distinct from new_frozen then
      if old.source = 'teacher' then
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
