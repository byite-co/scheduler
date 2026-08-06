import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const schema = readFileSync(new URL("../../../supabase/schema.sql", import.meta.url), "utf8");
const migration = readFileSync(
  new URL("../../../supabase/migrations/20260624000000_m4_homework_ai_check.sql", import.meta.url),
  "utf8"
);
const attemptsMigration = readFileSync(
  new URL("../../../supabase/migrations/20260806040000_homework_check_attempts.sql", import.meta.url),
  "utf8"
);
const edgeFunction = readFileSync(
  new URL("../../../supabase/functions/ai-homework-check/index.ts", import.meta.url),
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

// AI 판정을 submissions 의 세 컬럼에 덮어쓰면 재검사 때 이전 판정이 사라지고, 상태·중복호출·
// 사용량을 알 수 없다. homework_check_attempts 가 실행 레코드의 원본이다.
describe("M4 homework_check_attempts (실행 레코드)", () => {
  it("records each AI run with its own status and result columns", () => {
    for (const source of [schema, attemptsMigration]) {
      expect(source).toContain("create table homework_check_attempts");
      // 실행 상태와 판정 결과는 다른 축이다 — ambiguous 는 verdict 쪽에만 있어야 한다.
      expect(source).toContain("create type check_attempt_status as enum ('queued', 'processing', 'completed', 'failed')");
      expect(source).toContain("idempotency_key");
      expect(source).toContain("estimated_cost_usd_micros");
    }
    expect(schema).not.toMatch(/check_attempt_status as enum[^;]*ambiguous/);
  });

  it("freezes the scope and photo paths at check time", () => {
    // 검사 시작 후 학생이 사진·범위를 바꾸면 AI 가 본 자료와 화면이 달라진다.
    for (const source of [schema, attemptsMigration]) {
      expect(source).toContain("scope_text_snapshot");
      expect(source).toContain("photo_paths_snapshot");
    }
    expect(attemptsMigration).toContain("snapshot_scope, sub.photo_paths");
  });

  it("enforces the execution invariants in the database", () => {
    for (const source of [schema, attemptsMigration]) {
      // 동일 요청 재전송 방지 — 실연동에서 이게 없으면 재시도가 곧 중복 과금이다.
      expect(source).toContain("unique (requested_by, idempotency_key)");
      // 한 제출에 진행 중인 검사는 하나만(부분 유니크 인덱스).
      expect(source).toContain("homework_check_attempts_one_active_idx");
      expect(source).toContain("where status in ('queued', 'processing')");
      // completed 일 때만 verdict 가 있다(양방향).
      expect(source).toContain("check ((status = 'completed') = (verdict is not null))");
      // 사진 1~9개. coalesce 가 없으면 빈 배열의 array_length 가 NULL 이라 제약이 통과해 버린다.
      expect(source).toContain("check (coalesce(array_length(photo_paths_snapshot, 1), 0) between 1 and 9)");
    }
  });

  it("keeps attempts read-only for clients and writable only by the server", () => {
    for (const source of [schema, attemptsMigration]) {
      expect(source).toContain("alter table homework_check_attempts enable row level security");
      expect(source).toContain("create policy attempts_student_read on homework_check_attempts for select");
      expect(source).toContain("create policy attempts_teacher_read on homework_check_attempts for select");
      expect(source).toContain("check_attempts_are_server_written");
      // 과외쌤 읽기는 subs_teacher_read 와 같은 게이팅이어야 한다 — 제출을 못 보면 이력도 못 본다.
      expect(source).toContain("d.share_homework_photos");
      // 쓰기 정책이 생기면 클라이언트가 실행 레코드를 위조할 수 있다.
      expect(source).not.toMatch(/create policy attempts_\w+ on homework_check_attempts for (all|insert|update|delete)/);
      // 라이프사이클 RPC 는 service_role 전용.
      for (const fn of [
        "start_homework_check_attempt",
        "complete_homework_check_attempt",
        "fail_homework_check_attempt"
      ]) {
        expect(source).toContain(`create or replace function ${fn}`);
        expect(source).toMatch(new RegExp(`revoke all on function ${fn}\\([^)]*\\) from authenticated`));
        expect(source).toMatch(new RegExp(`grant execute on function ${fn}\\([^)]*\\) to service_role`));
      }
    }
  });

  it("does not block cascade deletes from the guard trigger", () => {
    // cascade DELETE 는 호출자 컨텍스트(auth.uid() 존재)에서 실행된다. DELETE 까지 막으면
    // 학생이 자기 제출을 못 지우고 계정 탈퇴의 전체 cascade 도 깨진다.
    for (const source of [schema, attemptsMigration]) {
      expect(source).toContain("before insert or update on homework_check_attempts");
      expect(source).not.toContain("before insert or update or delete on homework_check_attempts");
    }
  });

  it("wires the stub edge function through the attempt lifecycle", () => {
    // 스텁이 attempt 를 쓰지 않으면 스키마가 미검증으로 남고, 실연동 때 스키마와 AI 연동을
    // 동시에 디버깅해야 한다.
    expect(edgeFunction).toContain("start_homework_check_attempt");
    expect(edgeFunction).toContain("complete_homework_check_attempt");
    expect(edgeFunction).toContain("fail_homework_check_attempt");
    // 판정은 라이브 값이 아니라 스냅샷을 봐야 한다.
    expect(edgeFunction).toContain("attempt.photo_paths_snapshot");
    // DEPRECATED 경로로 되돌아가면 이력이 남지 않는다.
    expect(edgeFunction).not.toContain('rpc("apply_homework_ai_verdict"');
  });

  it("marks apply_homework_ai_verdict deprecated instead of silently keeping two write paths", () => {
    expect(attemptsMigration).toContain("comment on function apply_homework_ai_verdict");
    expect(attemptsMigration).toContain("DEPRECATED");
  });
});
