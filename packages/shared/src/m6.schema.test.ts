import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { PRICE_PER_STUDENT_KRW } from "./pricing";

const schema = readFileSync(new URL("../../../supabase/schema.sql", import.meta.url), "utf8");
const migration = readFileSync(
  new URL("../../../supabase/migrations/20260626000000_m6_billing.sql", import.meta.url),
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
});
