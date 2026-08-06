import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const schema = readFileSync(new URL("../../../supabase/schema.sql", import.meta.url), "utf8");
const migration = readFileSync(
  new URL("../../../supabase/migrations/20260622010000_m2_home_planner_todos.sql", import.meta.url),
  "utf8"
);
const privacyMigration = readFileSync(
  new URL("../../../supabase/migrations/20260622011000_m2_peer_ranking_privacy.sql", import.meta.url),
  "utf8"
);
const securityMigration = readFileSync(
  new URL(
    "../../../supabase/migrations/20260805000000_security_todo_allowlist_and_mock_premium_revoke.sql",
    import.meta.url
  ),
  "utf8"
);
const scopeTextMigration = readFileSync(
  new URL("../../../supabase/migrations/20260806010000_todos_scope_text.sql", import.meta.url),
  "utf8"
);
const scopeTrimFixMigration = readFileSync(
  new URL("../../../supabase/migrations/20260806020000_fix_scope_text_whitespace_trim.sql", import.meta.url),
  "utf8"
);
const aiCheckNeedsScopeMigration = readFileSync(
  new URL("../../../supabase/migrations/20260806030000_todos_ai_check_needs_scope.sql", import.meta.url),
  "utf8"
);

// 트리거 함수는 마이그레이션이 쌓이며 통째로 교체된다. "현재 유효한" 정의는 schema.sql 과 그
// 함수를 마지막으로 고친 마이그레이션에만 있다 — 과거 파일은 그 시점의 내용을 그대로 보존해야
// 한다(적용된 마이그레이션을 고치면 레포 이력과 실제 DB 가 어긋난다).
const CURRENT_TRIGGER_SOURCES = [schema, scopeTrimFixMigration];

describe("M2 Supabase schema coverage", () => {
  it("keeps todos, timetable blocks, and study sessions available for live M2 screens", () => {
    expect(schema).toContain("create table todos");
    expect(schema).toContain("create table timetable_blocks");
    expect(schema).toContain("create table study_sessions");
    expect(schema).toContain("create policy todos_student_rw");
    expect(schema).toContain("create policy tt_student_rw");
    expect(schema).toContain("create policy sessions_student_rw");
  });

  it("guards locked teacher todos in schema and migration", () => {
    for (const source of [schema, migration]) {
      expect(source).toContain("create or replace function guard_student_todo_source_lock");
      expect(source).toContain("students_cannot_create_teacher_todos");
      expect(source).toContain("locked_teacher_todo_fields");
    }
  });

  // SECURITY: 학생의 todos UPDATE 는 허용 목록이어야 한다.
  // 금지 목록이면 새 컬럼(scope_text 등)이 "열린 채로" 추가되어 같은 사고가 반복된다.
  it("restricts student todo updates with an allowlist, not a denylist", () => {
    for (const source of [schema, securityMigration, scopeTextMigration, scopeTrimFixMigration]) {
      // 교사 숙제는 완료 체크(status) 하나만 허용 — 이 목록은 지금까지 한 번도 늘지 않았다.
      expect(source).toContain("student_editable := array['status']");
      // 허용 컬럼을 제거한 '나머지 전체'를 비교 → 목록에 없는 컬럼은 자동 잠김.
      expect(source).toContain("to_jsonb(old) - student_editable");
      expect(source).toContain("to_jsonb(new) - student_editable");
      expect(source).toContain("old_frozen is distinct from new_frozen");
    }
    // 내가 만든 할 일은 내용 편집까지 허용. scope_text 가 여기 추가됐다(20260806010000).
    for (const source of [...CURRENT_TRIGGER_SOURCES, scopeTextMigration]) {
      expect(source).toContain(
        "student_editable := array['title', 'subject', 'due_date', 'status', 'ai_check_enabled', 'scope_text']"
      );
    }
    // 구 금지 목록 방식이 남아 있으면 회귀.
    expect(schema).not.toContain("new.ai_check_enabled is distinct from old.ai_check_enabled");
  });

  // scope_text 는 "AI 가 제출 사진과 대조할 기준"이다. 클라이언트 검증만 두면 PostgREST 직접
  // 호출로 우회되므로, 상한과 '빈 문자열 → NULL' 불변식이 DB 에 있어야 한다.
  it("stores the AI check scope in its own column with DB-enforced limits", () => {
    for (const source of [schema, scopeTextMigration]) {
      expect(source).toContain("todos_scope_text_len");
      // 공백을 제외한 글자 수 기준 500자. 하한 1 = "빈 문자열은 저장되지 않는다"는 불변식.
      expect(source).toContain("length(regexp_replace(scope_text, '\\s', '', 'g')) between 1 and 500");
    }
    // 정규화는 허용 목록 비교보다 먼저 일어나야 하고(무변경이 오탐으로 막히지 않게),
    // CHECK 제약과 같은 \s 클래스를 써야 한다. btrim(v) 은 인자가 하나면 space 만 지우므로
    // 탭·개행뿐인 입력이 NULL 이 되지 않고 제약 위반으로 거부된다(20260806020000 에서 잡힌 버그).
    for (const source of CURRENT_TRIGGER_SOURCES) {
      expect(source).toContain("new.scope_text := nullif(regexp_replace(new.scope_text, '^\\s+|\\s+$', '', 'g'), '')");
      expect(source).not.toContain("nullif(btrim(new.scope_text), '')");
    }
    expect(schema).toContain("scope_text    text");
    // 이전은 title 전체 복사만 한다 — 문장 패턴으로 범위를 추출하면 잘못 분리돼도 발견하기 어렵다.
    expect(scopeTextMigration).toContain("set scope_text = title");
    // title 을 잘라내거나 다시 쓰면 양쪽 앱 목록 표시가 깨진다.
    expect(scopeTextMigration).not.toMatch(/update todos[\s\S]*?set title/);
  });

  // AI 검사를 켜 놓고 범위를 비우면 AI 가 "무엇과" 대조할지 알 수 없다 → DB 가 막아야 한다.
  // UI 만 막으면 PostgREST 직접 호출로 우회된다.
  it("requires a scope whenever the AI check is enabled", () => {
    for (const source of [schema, aiCheckNeedsScopeMigration]) {
      expect(source).toContain("todos_ai_check_needs_scope");
      expect(source).toContain("check (ai_check_enabled = false or scope_text is not null)");
    }
    // 위반 행의 범위를 title 로 자동 채우면 AI 의 대조 기준이 사람 모르게 바뀐다.
    expect(aiCheckNeedsScopeMigration).not.toMatch(/update\s+todos[\s\S]*?set\s+scope_text\s*=\s*title/);
  });

  // 검사 범위(title)·과목·마감일이 교사 숙제 허용 목록에 절대 들어가지 않아야 한다.
  // 주석에도 그 단어들이 등장하므로, SQL 라인 주석을 제거한 코드만 검사한다.
  it("keeps teacher homework scope fields out of the student allowlist", () => {
    for (const source of [securityMigration, scopeTextMigration, schema]) {
      const code = source.replace(/--[^\n]*/g, "");
      const branchStart = code.indexOf("if old.source = 'teacher' then");
      const teacherBranch = code.slice(branchStart, code.indexOf("else", branchStart));

      expect(teacherBranch).toContain("array['status']");
      // scope_text 가 여기 들어가면 학생이 AI 검사 기준을 스스로 좁힐 수 있다.
      for (const field of ["scope_text", "title", "due_date", "subject", "ai_check_enabled", "locked"]) {
        expect(teacherBranch).not.toContain(field);
      }
    }
  });

  it("exposes anonymous peer ranking aggregates without returning peer identities", () => {
    expect(schema).toContain("create or replace function get_peer_study_ranking");
    expect(schema).toContain("returns table");
    expect(schema).toContain("can_show_peer_ranking boolean");
    expect(schema).toContain("min_cohort integer");
    expect(schema).toContain("peer_average_minutes");
    expect(schema).toContain("else null::integer");
    expect(privacyMigration).toContain("greatest(5, coalesce(p_min_cohort, 5))");
    expect(privacyMigration).toContain("mine.cohort_count >= limits.min_cohort");
    expect(schema).not.toContain("peer_name");
  });
});
