import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const schema = readFileSync(new URL("../../../supabase/schema.sql", import.meta.url), "utf8");
const migration = readFileSync(
  new URL("../../../supabase/migrations/20260623000000_m3_timer_sessions.sql", import.meta.url),
  "utf8"
);

describe("M3 timer session schema coverage", () => {
  it("stores timer state needed for start, pause, resume, and end", () => {
    for (const source of [schema, migration]) {
      expect(source).toContain("timer_state");
      expect(source).toContain("last_resumed_at");
      expect(source).toContain("'running', 'paused', 'completed'");
    }
  });

  it("keeps timer sessions under student-owned RLS", () => {
    expect(schema).toContain("create policy sessions_student_rw on study_sessions for all");
    expect(schema).toContain("using (student_id = auth.uid()) with check (student_id = auth.uid())");
  });
});
