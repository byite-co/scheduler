import { describe, expect, it } from "vitest";

import { readSource, sliceBetween, sliceFrom } from "./testSource";

const schema = readSource(new URL("../../../supabase/schema.sql", import.meta.url));
const guards = readSource(new URL("../../../supabase/migrations/20260820000000_role_and_delete_guards.sql", import.meta.url));
const grants = readSource(new URL("../../../supabase/migrations/20260820010000_immutable_column_grants.sql", import.meta.url));
const rpcOnly = readSource(new URL("../../../supabase/migrations/20260820020000_connections_insert_via_rpc_only.sql", import.meta.url));

// ── ① 트리거로 막은 것 ───────────────────────────────────────────────────────
describe("불변 컬럼 — 트리거", () => {
  it("profiles.role 은 본인이 바꿀 수 없다", () => {
    for (const source of [guards, schema]) {
      expect(source).toContain("new.role is distinct from old.role");
      expect(source).toContain("role_is_not_self_assignable");
      expect(source).toContain("before update on profiles");
    }
  });

  it("role 트리거는 컬럼 권한이 아니다 — 프로필 upsert 가 role 을 매번 실어 보낸다", () => {
    // UPDATE(role) 을 회수하면 값이 같아도 막혀 프로필 저장이 깨진다.
    expect(guards).not.toMatch(/revoke update[^;]*profiles/);
    expect(schema).not.toMatch(/revoke update on table profiles/);
  });

  it("service_role·마이그레이션은 통과시킨다 — 역할 정정은 서버의 일이다", () => {
    const fn = sliceBetween(
      guards,
      "create or replace function guard_profile_immutable_fields",
      "drop trigger if exists guard_profile_immutable_fields_trigger"
    );
    expect(fn).toContain("if auth.uid() is null then");
    expect(fn).toContain("return new;");
  });

  it("학생은 선생님 숙제를 DELETE 로 없앨 수 없다", () => {
    for (const source of [guards, schema]) {
      expect(source).toContain("before delete on todos");
      expect(source).toContain("students_cannot_delete_teacher_todos");
      expect(source).toContain("old.source = 'teacher' and auth.uid() = old.student_id");
    }
  });

  it("DELETE 가드는 학생 본인의 self 숙제는 막지 않는다", () => {
    const fn = sliceBetween(
      guards,
      "create or replace function guard_locked_todo_delete",
      "drop trigger if exists guard_locked_todo_delete_trigger"
    );
    // source='self' 조건 없이 전부 막으면 학생이 자기 할 일을 못 지운다.
    expect(fn).toContain("old.source = 'teacher'");
  });
});

// ── ② 컬럼 권한으로 막은 것 ──────────────────────────────────────────────────
describe("불변 컬럼 — 컬럼 권한", () => {
  it("reports 는 status·sent_at 만 클라이언트가 UPDATE 한다", () => {
    for (const source of [grants, schema]) {
      expect(source).toContain("revoke update on table reports from authenticated");
      expect(source).toContain("grant update (status, sent_at) on table reports to authenticated");
    }
  });

  it("share_token·student_id·teacher_id 는 허용 목록에 없다", () => {
    const grant = sliceBetween(grants, "grant update (", "on table reports to authenticated");
    for (const column of ["share_token", "share_expires_at", "student_id", "teacher_id"]) {
      expect(grant, column).not.toContain(column);
    }
  });

  it("invite_codes 는 클라이언트가 UPDATE 할 수 없다 — 발급만 한다", () => {
    for (const source of [grants, schema]) {
      expect(source).toContain("revoke update on table invite_codes from authenticated");
      expect(source).toContain("revoke update on table invite_codes from anon");
    }
    // INSERT 는 남아 있어야 한다(코드 발급 화면).
    expect(grants).not.toMatch(/revoke insert[^;]*invite_codes/);
  });
});

// ── ③ 정책으로 막은 것 ──────────────────────────────────────────────────────
describe("불변 컬럼 — 정책", () => {
  it("lesson_fees 는 연결이 존재하는 학생에게만", () => {
    for (const source of [grants, schema]) {
      const policy = sliceFrom(source, "create policy fees_teacher_rw on lesson_fees", 700);
      expect(policy).toContain("exists (");
      expect(policy).toContain("c.student_id = lesson_fees.student_id");
    }
  });

  it("active 를 요구하지 않는다 — 연결이 끊겨도 미납 청구서에 접근해야 한다", () => {
    const policy = sliceBetween(
      grants,
      "create policy fees_teacher_rw on lesson_fees",
      "comment on policy fees_teacher_rw"
    );
    expect(policy).not.toContain("'active'");
  });

  it("컬럼 권한이 아니라 정책인 이유가 남아 있다", () => {
    // (a) INSERT 로도 뚫린다 (b) 모바일 upsert 가 student_id 를 매번 보낸다
    expect(grants).toContain("lessonFeesScreen.tsx:111");
    expect(grants).not.toMatch(/revoke update[^;]*lesson_fees/);
  });
});

// ── ④ 연결 생성 입구를 하나로 ────────────────────────────────────────────────
describe("연결 생성은 RPC 만", () => {
  it("학생의 직접 INSERT 정책을 없애고 권한도 회수한다", () => {
    for (const source of [rpcOnly, schema]) {
      expect(source).toContain("revoke insert on table connections from authenticated");
      expect(source).toContain("revoke insert on table connections from anon");
    }
    expect(rpcOnly).toContain("drop policy if exists conn_student_insert_pending on connections");
    // 미러에도 정책이 남아 있으면 안 된다.
    expect(schema).not.toContain("create policy conn_student_insert_pending");
  });

  it("이것이 A5 시도 제한의 우회 경로였음을 기록한다", () => {
    expect(rpcOnly).toContain("request_connection_by_invite");
    expect(rpcOnly).toContain("invite_code=null");
  });

  it("상태 전이 권한은 그대로 남는다 — 수락·거절·해제가 깨지면 안 된다", () => {
    expect(schema).toContain("grant update (status, activated_at) on table connections to authenticated");
  });
});

// ── ⑤ 마이그레이션 이력 ─────────────────────────────────────────────────────
describe("마이그레이션 파일 규칙", () => {
  it("A5.1 마이그레이션이 세 개 다 있다", () => {
    for (const source of [guards, grants, rpcOnly]) {
      expect(source.length).toBeGreaterThan(200);
    }
  });
});
