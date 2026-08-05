-- AI 숙제검사가 대조할 "검사 범위" 전용 컬럼(todos.scope_text) 추가.
--
-- 배경: 지금은 범위를 todos.title 에 적는 구조라, 목록에 보이는 할 일 이름과
-- AI 대조 기준이 한 칸에 섞여 있다. AI 가 무엇을 기준으로 대조할지 불명확하고,
-- 제목을 다듬으면 검사 기준이 함께 바뀌는 부작용이 있다.
--
-- scope_text 의 의미:
--   "AI 가 제출 사진과 대조할 기준이 되는, 사용자가 입력한 수행 범위 원문"
--   예) '쎈 112~118p, 115p 제외' / '영단어 Day 12~14' / '기출 21~30번, 26번 제외'
--   title(목록에 보이는 할 일 이름)과 역할이 다르다. 일반 메모로 쓰지 않는다.
--
-- 교사 숙제와 학생 개인 할 일에서 의미는 동일하고, 수정 권한만 다르다:
--   source='teacher' → 교사만 수정 (학생 불가)
--   source='self'    → 학생이 수정 가능
--
-- 이번 마이그레이션은 스키마 확장까지다. UI 는 건드리지 않는다.

alter table todos add column scope_text text;

comment on column todos.scope_text is
  'AI 숙제검사가 제출 사진과 대조할 기준이 되는 수행 범위 원문. title(목록에 보이는 할 일 이름)과 역할이 다르며 일반 메모가 아니다. 공백 제외 500자 이내, 빈 문자열은 NULL 로 정규화된다.';

-- 길이 상한은 DB 에서 강제한다. 클라이언트 검증만 두면 PostgREST 직접 호출로 그대로 우회된다
-- (이 레포에서 이미 같은 유형의 사고를 겪었다 — mock 구독 RPC 가 클라이언트에 열려 있었다).
--
-- 공백을 제외한 글자 수 기준. Postgres 의 \s 는 [[:space:]] 와 같다.
-- 하한 1: 빈 문자열은 아래 트리거가 NULL 로 정규화하므로 여기까지 도달하지 않는다.
--         트리거가 사라지거나 우회되면 곧바로 드러나도록 불변식을 제약으로 못박아 둔다.
alter table todos add constraint todos_scope_text_len
  check (scope_text is null or length(regexp_replace(scope_text, '\s', '', 'g')) between 1 and 500);

-- 기존 데이터 이전: AI 검사가 켜진 행에만 title 전체를 복사한다.
--
-- ⚠️ 제목에서 범위를 자동으로 분리(문장 패턴 추출)하지 않는다. 잘못 분리되면 AI 가 틀린
--    기준으로 대조하게 되고, 그 오류는 사람이 발견하기 매우 어렵다. 전체 복사는 적어도
--    "사람이 보면 바로 아는" 상태로 남는다.
-- ⚠️ title 은 그대로 남긴다. 잘라내거나 다시 쓰지 않는다 — 양쪽 앱의 목록 표시가 title 을 쓴다.
do $$
declare
  copied bigint;
  skipped bigint;
begin
  update todos
     set scope_text = title
   where ai_check_enabled = true
     and scope_text is null
     and length(regexp_replace(title, '\s', '', 'g')) between 1 and 500;
  get diagnostics copied = row_count;

  -- 상한을 넘는 제목은 위 제약 때문에 복사할 수 없다. 조용히 잘라 넣지 않고 NULL 로 남긴다
  -- (자동 절단은 AI 의 대조 기준을 사람 모르게 바꿔버린다). 사람이 직접 범위를 입력해야 한다.
  select count(*) into skipped
    from todos
   where ai_check_enabled = true and scope_text is null;

  raise notice 'scope_text 이전: % 행 복사, % 행 미복사(제목이 공백 제외 500자 초과이거나 공백뿐)',
    copied, skipped;
end $$;

-- 트리거 갱신 두 가지:
--   (1) 빈 문자열 → NULL 정규화를 함수 맨 앞에 추가.
--   (2) source='self' 허용 목록에 scope_text 추가.
--       source='teacher' 허용 목록은 그대로 array['status'] 다 → scope_text 는 허용 목록에
--       없으므로 학생에게 자동으로 잠긴다. 20260805000000 에서 금지 목록을 허용 목록으로
--       바꿔 둔 덕분에, 이 새 컬럼은 "열린 채로" 추가되지 않는다.
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
  -- 별도 트리거로 분리하지 않고 이 함수 맨 앞에 둔 이유:
  --   · 같은 테이블의 BEFORE 트리거는 이름 알파벳순으로 실행된다 → 순서가 이름에 의존해 깨지기 쉽다.
  --   · 아래 INSERT 분기는 early return 하므로, INSERT 에도 적용되려면 그보다 앞이어야 한다.
  --   · 허용 목록 비교보다 먼저 정규화돼야 '' → NULL 같은 실질적 무변경이 오탐으로 막히지 않는다.
  new.scope_text := nullif(btrim(new.scope_text), '');

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
