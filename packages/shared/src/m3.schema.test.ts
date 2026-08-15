import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const schema = readFileSync(new URL("../../../supabase/schema.sql", import.meta.url), "utf8");
const migration = readFileSync(
  new URL("../../../supabase/migrations/20260623000000_m3_timer_sessions.sql", import.meta.url),
  "utf8"
);
const focusDetectionMigration = readFileSync(
  new URL("../../../supabase/migrations/20260623010000_m3_focus_detection.sql", import.meta.url),
  "utf8"
);
const focusPolicyMigration = readFileSync(
  new URL("../../../supabase/migrations/20260623011000_m3_focus_policy_helper.sql", import.meta.url),
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

  it("keeps focus checks as metadata-only student writes with disclosed teacher reads", () => {
    for (const source of [schema, focusDetectionMigration]) {
      expect(source).toContain("create policy focus_teacher_read_disclosed on focus_checks");
      expect(source).toContain("d.share_focus_data = true");
      expect(source).toContain("create or replace function save_focus_check");
      expect(source).toContain("create or replace view v_teacher_focus_checks");
      expect(source).toContain("case when d.share_focus_data then s.focus_score else null end as focus_score");
    }
    for (const source of [schema, focusPolicyMigration]) {
      expect(source).toContain("create or replace function can_teacher_read_focus_check");
      expect(source).toContain("create policy focus_teacher_read_disclosed on focus_checks");
      expect(source).toContain("can_teacher_read_focus_check(auth.uid(), focus_checks.session_id)");
    }
    // 🚨 뷰는 담당 학생 **전체**를 돌려준다. student_id 가 없으면 화면이 학생별로 좁힐 수 없어
    //    한 학생의 리포트에 다른 학생의 집중도가 섞인다(2026-08-15 실연동에서 재현).
    //    RLS 가 뚫린 게 아니라 "고를 수단이 없다"는 문제였고, 결과는 학부모에게 남의 아이 데이터다.
    expect(schema).toMatch(
      /create or replace view v_teacher_focus_checks[\s\S]*?s\.student_id[\s\S]*?from focus_checks/
    );
  });
});
