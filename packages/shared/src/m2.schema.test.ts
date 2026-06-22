import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const schema = readFileSync(new URL("../../../supabase/schema.sql", import.meta.url), "utf8");
const migration = readFileSync(
  new URL("../../../supabase/migrations/20260622010000_m2_home_planner_todos.sql", import.meta.url),
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
      expect(source).toContain("new.ai_check_enabled is distinct from old.ai_check_enabled");
    }
  });

  it("exposes anonymous peer ranking aggregates without returning peer identities", () => {
    expect(schema).toContain("create or replace function get_peer_study_ranking");
    expect(schema).toContain("returns table");
    expect(schema).toContain("peer_average_minutes");
    expect(schema).not.toContain("peer_name");
  });
});
