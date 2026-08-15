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

// ── pending 요청의 학생 이름 (20260815040000) ────────────────────────────────
// profiles RLS 는 active 연결만 허용한다. 그래서 과외쌤이 pending 요청에서 학생 이름을
// 못 보고 UUID 앞자리만 봤다 — 누가 요청했는지 모르는 채로 수락/거절을 눌러야 했다.
describe("대기 중인 연결 요청의 학생 이름 RPC", () => {
  const migration = readFileSync(
    new URL("../../../supabase/migrations/20260815040000_pending_request_student_name.sql", import.meta.url),
    "utf8"
  );
  const screen = readFileSync(new URL("../../../apps/teacher/src/app/m1.tsx", import.meta.url), "utf8");

  it("RLS 를 넓히지 않는다 — profiles 정책은 여전히 active 만 허용한다", () => {
    // pending 을 정책에 넣으면 birth_date·target_univ 까지 통째로 열린다.
    expect(schema).toContain("create policy profiles_connected_read on profiles for select using (");
    const policy = schema.slice(
      schema.indexOf("create policy profiles_connected_read"),
      schema.indexOf("create policy profiles_connected_read") + 400
    );
    expect(policy).toContain("c.status='active'");
    expect(policy).not.toContain("pending");
  });

  it("최소 필드만 돌려준다 — 생년월일·목표대학·사진은 없다", () => {
    for (const source of [schema, migration]) {
      expect(source).toContain("create or replace function pending_connection_requests");
      const fn = source.slice(
        source.indexOf("create or replace function pending_connection_requests"),
        source.indexOf("comment on function pending_connection_requests")
      );
      expect(fn).toContain("connection_id uuid");
      expect(fn).toContain("student_name  text");
      expect(fn).toContain("student_grade text");
      expect(fn).toContain("requested_at  timestamptz");
      for (const leak of ["birth_date", "target_univ", "avatar_url", "guardian_consented_at"]) {
        expect(fn, leak).not.toContain(leak);
      }
    }
  });

  it("security definer 이고 권한 검사를 함수 안에서 한다", () => {
    // invoker 로는 동작 자체가 불가능하다(호출자에게 profiles RLS 가 그대로 걸린다).
    // 대신 definer 는 검사를 스스로 해야 한다 — teacher 본인 + pending 두 가지 모두.
    for (const source of [schema, migration]) {
      const fn = source.slice(
        source.indexOf("create or replace function pending_connection_requests"),
        source.indexOf("comment on function pending_connection_requests")
      );
      expect(fn).toContain("security definer");
      expect(fn).toContain("set search_path = public");
      expect(fn).toContain("c.teacher_id = auth.uid()");
      expect(fn).toContain("c.status = 'pending'");
      // 사유를 구분해 던지면 "그 ID 가 존재한다"는 사실이 샌다 — 전부 0행으로 통일한다.
      expect(fn).not.toContain("raise exception");
    }
  });

  it("anon 은 실행할 수 없다", () => {
    expect(migration).toContain("revoke all on function pending_connection_requests(uuid) from anon");
    expect(migration).toContain("grant execute on function pending_connection_requests(uuid) to authenticated");
  });

  it("화면이 실제로 이 RPC 를 쓴다 — 안 쓰면 UUID 가 그대로 남는다", () => {
    expect(screen).toContain('supabase.rpc("pending_connection_requests")');
    expect(screen).toContain("formatPendingRequestLabel");
  });
});
