import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const schema = readFileSync(new URL("../../../supabase/schema.sql", import.meta.url), "utf8");
const migration = readFileSync(
  new URL("../../../supabase/migrations/20260624000000_m4_homework_ai_check.sql", import.meta.url),
  "utf8"
);

describe("M4 homework AI-check schema coverage", () => {
  it("keeps AI verdict writes server-authoritative (service_role only)", () => {
    for (const source of [schema, migration]) {
      expect(source).toContain("create or replace function apply_homework_ai_verdict");
      expect(source).toContain("grant execute on function apply_homework_ai_verdict");
      expect(source).toContain("to service_role");
      expect(source).toContain(
        "revoke all on function apply_homework_ai_verdict(uuid, submission_verdict, numeric, text) from authenticated"
      );
    }
  });

  it("guards ai_* and teacher_* fields against the wrong actors", () => {
    for (const source of [schema, migration]) {
      expect(source).toContain("function guard_homework_submission_fields");
      expect(source).toContain("ai_fields_are_server_set");
      expect(source).toContain("teacher_fields_not_student_editable");
      expect(source).toContain("guard_homework_submission_fields_trigger");
    }
  });
});
