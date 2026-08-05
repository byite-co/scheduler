import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { PRICE_PER_STUDENT_KRW } from "./pricing";

const schema = readFileSync(new URL("../../../supabase/schema.sql", import.meta.url), "utf8");
const migration = readFileSync(
  new URL("../../../supabase/migrations/20260626000000_m6_billing.sql", import.meta.url),
  "utf8"
);
const securityMigration = readFileSync(
  new URL(
    "../../../supabase/migrations/20260805000000_security_todo_allowlist_and_mock_premium_revoke.sql",
    import.meta.url
  ),
  "utf8"
);
const teacherRevokeMigration = readFileSync(
  new URL(
    "../../../supabase/migrations/20260806000000_security_revoke_teacher_mock_subscription.sql",
    import.meta.url
  ),
  "utf8"
);

describe("M6 billing schema coverage", () => {
  it("computes invoices from active connections × the single price source", () => {
    for (const source of [schema, migration]) {
      expect(source).toContain("create or replace function price_per_student_krw");
      expect(source).toContain("create or replace function generate_teacher_invoice");
      expect(source).toContain("active_count * price_per_student_krw()");
      expect(source).toContain("status = 'active'");
    }
  });

  it("keeps the SQL price source in sync with the TS constant", () => {
    expect(schema).toContain(`select ${PRICE_PER_STUDENT_KRW}`);
    expect(migration).toContain(`select ${PRICE_PER_STUDENT_KRW}`);
  });

  it("marks webhook stand-ins as dev mocks to be replaced by edge functions", () => {
    expect(migration).toContain("mock_set_teacher_subscription");
    expect(migration).toContain("mock_set_student_subscription");
    expect(migration).toContain("billing-stripe / iap-webhook");
  });

  // SECURITY: 프리미엄 상태를 만드는 mock RPC 가 클라이언트 롤에 열려 있으면
  // 사용자가 스스로 프리미엄이 될 수 있고, 서버측 프리미엄 검증이 전부 무의미해진다.
  it("keeps the student premium mock RPC unreachable from client roles", () => {
    for (const source of [schema, securityMigration]) {
      expect(source).toContain(
        "revoke execute on function mock_set_student_subscription(sub_status, timestamptz) from authenticated"
      );
      expect(source).toContain(
        "revoke execute on function mock_set_student_subscription(sub_status, timestamptz) from anon"
      );
      // 서버 키(service_role) 경로만 남긴다 — 클라이언트에는 내려가지 않는다.
      expect(source).toContain(
        "grant execute on function mock_set_student_subscription(sub_status, timestamptz) to service_role"
      );
    }
    // authenticated 에 execute 를 다시 주는 구문이 살아 있으면 회귀.
    expect(schema).not.toContain(
      "grant execute on function mock_set_student_subscription(sub_status, timestamptz) to authenticated"
    );
  });

  // SECURITY: 과외쌤 구독 mock RPC 도 같은 구멍이었다 — 과외쌤이 스스로 앱 구독료를
  // active 로 만들 수 있었고, 앱 구독료는 주 수입원이라 매출에 직접 영향이 있다.
  it("keeps the teacher billing mock RPC unreachable from client roles", () => {
    for (const source of [schema, teacherRevokeMigration]) {
      expect(source).toContain(
        "revoke execute on function mock_set_teacher_subscription(sub_status) from authenticated"
      );
      expect(source).toContain("revoke execute on function mock_set_teacher_subscription(sub_status) from anon");
      expect(source).toContain("grant execute on function mock_set_teacher_subscription(sub_status) to service_role");
    }
    expect(schema).not.toContain(
      "grant execute on function mock_set_teacher_subscription(sub_status) to authenticated"
    );
  });

  // 두 mock RPC 의 권한 형태가 갈라지면 한쪽만 다시 열리는 사고를 놓친다.
  it("applies the same revoke pattern to both subscription mocks", () => {
    for (const fn of ["mock_set_student_subscription", "mock_set_teacher_subscription"]) {
      for (const role of ["anon", "authenticated"]) {
        expect(schema).toMatch(new RegExp(`revoke execute on function ${fn}\\([^)]*\\) from ${role}`));
      }
      expect(schema).toMatch(new RegExp(`grant execute on function ${fn}\\([^)]*\\) to service_role`));
    }
  });

  // 앱 코드가 mock RPC 를 다시 호출하면 403 이 나고 화면이 깨진다.
  it("keeps mock subscription RPCs out of both app bundles", () => {
    for (const file of [
      "../../../apps/student/src/m6Screens.tsx",
      "../../../apps/teacher/src/app/m6.tsx"
    ]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source).not.toContain('rpc("mock_set_student_subscription"');
      expect(source).not.toContain('rpc("mock_set_teacher_subscription"');
    }
  });
});
