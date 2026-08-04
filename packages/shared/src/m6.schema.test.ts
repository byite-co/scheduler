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
});
