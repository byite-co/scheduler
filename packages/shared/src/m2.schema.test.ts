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
    for (const source of [schema, securityMigration]) {
      // 교사 숙제는 완료 체크(status) 하나만 허용.
      expect(source).toContain("student_editable := array['status']");
      // 내가 만든 할 일은 내용 편집까지 허용.
      expect(source).toContain(
        "student_editable := array['title', 'subject', 'due_date', 'status', 'ai_check_enabled']"
      );
      // 허용 컬럼을 제거한 '나머지 전체'를 비교 → 목록에 없는 컬럼은 자동 잠김.
      expect(source).toContain("to_jsonb(old) - student_editable");
      expect(source).toContain("to_jsonb(new) - student_editable");
      expect(source).toContain("old_frozen is distinct from new_frozen");
    }
    // 구 금지 목록 방식이 남아 있으면 회귀.
    expect(schema).not.toContain("new.ai_check_enabled is distinct from old.ai_check_enabled");
  });

  // 검사 범위(title)·과목·마감일이 교사 숙제 허용 목록에 절대 들어가지 않아야 한다.
  // 주석에도 그 단어들이 등장하므로, SQL 라인 주석을 제거한 코드만 검사한다.
  it("keeps teacher homework scope fields out of the student allowlist", () => {
    const code = securityMigration.replace(/--[^\n]*/g, "");
    const branchStart = code.indexOf("if old.source = 'teacher' then");
    const teacherBranch = code.slice(branchStart, code.indexOf("else", branchStart));

    expect(teacherBranch).toContain("array['status']");
    for (const field of ["title", "due_date", "subject", "ai_check_enabled", "locked"]) {
      expect(teacherBranch).not.toContain(field);
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
