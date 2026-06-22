import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const schema = readFileSync(new URL("../../../supabase/schema.sql", import.meta.url), "utf8");

describe("M1 Supabase schema coverage", () => {
  it("keeps the connection handshake states and invite tables in schema.sql", () => {
    expect(schema).toContain("create table invite_codes");
    expect(schema).toContain("create table connections");
    expect(schema).toContain("create type connection_status");
    expect(schema).toContain("'pending','active','rejected'");
  });

  it("keeps disclosure RLS student-controlled and teacher-read-only", () => {
    expect(schema).toContain("create table disclosure_settings");
    expect(schema).toContain("create policy disclosure_student_rw");
    expect(schema).toContain("create policy disclosure_teacher_read");
    expect(schema).toContain("c.student_id=auth.uid()");
    expect(schema).toContain("c.teacher_id=auth.uid()");
  });

  it("uses the teacher study-session view to enforce share_study_time", () => {
    expect(schema).toContain("create or replace view v_teacher_study_sessions");
    expect(schema).toContain("d.share_study_time = true");
    expect(schema).toContain("c.teacher_id = auth.uid()");
  });

  it("keeps live M1 invite RPC and guardian consent persistence in schema.sql", () => {
    expect(schema).toContain("guardian_consented_at");
    expect(schema).toContain("create or replace function request_connection_by_invite");
    expect(schema).toContain("status in ('rejected', 'disconnected')");
    expect(schema).toContain("grant execute on function request_connection_by_invite(text) to authenticated");
  });
});
