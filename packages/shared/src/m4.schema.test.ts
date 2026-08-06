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

// 서버측 프리미엄 판정 + 사용량 안전장치(20260806050000).
// 클라이언트 게이트는 우회 가능하므로 판정은 서버에 있어야 한다.
describe("M4 server-side AI check gate", () => {
  const gateMigration = readFileSync(
    new URL("../../../supabase/migrations/20260806050000_server_side_ai_check_gate.sql", import.meta.url),
    "utf8"
  );

  it("judges premium from the caller only, with expiry, and blocks anon", () => {
    for (const source of [schema, gateMigration]) {
      expect(source).toContain("create or replace function has_active_student_premium()");
      // 임의 student_id 를 인자로 받으면 그 자체가 남의 상태를 묻는 경로가 된다.
      expect(source).toContain("has_active_student_premium()");
      expect(source).toContain("where student_id = auth.uid()");
      // status 만 보면 만료된 구독이 통과한다.
      expect(source).toContain("and status = 'active'");
      expect(source).toContain("and expires_at > now()");
      // student_subscriptions 에 본인 SELECT 정책이 있으므로 DEFINER 가 필요 없다.
      expect(source).toContain("security invoker");
      expect(source).toContain("revoke all on function has_active_student_premium() from anon");
      expect(source).toContain("grant execute on function has_active_student_premium() to authenticated");
    }
    // 인자를 받는 형태로 되돌아가면 회귀.
    expect(schema).not.toMatch(/has_active_student_premium\(\s*p_/);
  });

  it("checks usage limits inside the slot-acquiring transaction", () => {
    for (const source of [schema, gateMigration]) {
      expect(source).toContain("ai_check_max_attempts_per_submission()");
      expect(source).toContain("ai_check_max_attempts_per_day()");
      expect(source).toContain("check_limit_submission_exceeded");
      expect(source).toContain("check_limit_daily_exceeded");
      // count 만으로는 동시 요청이 둘 다 통과할 수 있다 → 요청자 단위 직렬화가 필요하다.
      expect(source).toContain("pg_advisory_xact_lock");
      // 한도 검사는 INSERT 와 같은 함수(=같은 트랜잭션) 안에 있어야 한다.
      const fnStart = source.indexOf("create or replace function start_homework_check_attempt");
      const insertAt = source.indexOf("insert into homework_check_attempts", fnStart);
      const limitAt = source.indexOf("check_limit_daily_exceeded", fnStart);
      expect(limitAt).toBeGreaterThan(fnStart);
      expect(limitAt).toBeLessThan(insertAt);
    }
  });

  it("blocks checks for todos without AI check or scope", () => {
    for (const source of [schema, gateMigration]) {
      expect(source).toContain("ai_check_disabled_for_todo");
      expect(source).toContain("scope_text_required_for_check");
    }
  });

  // Deno 런타임은 이 패키지를 import 할 수 없어 Edge Function 에 같은 분기가 인라인돼 있다.
  // 두 곳이 갈라지지 않도록 대조한다(getAiCheckEntitlement 가 shared 쪽 원본).
  it("mirrors the pricing branch in the edge function and gates before the slot", () => {
    // 과외쌤 숙제는 연결만 보고, 개인 할 일은 프리미엄을 본다.
    expect(edgeFunction).toContain('todo.source === "teacher"');
    expect(edgeFunction).toContain("connection_required");
    expect(edgeFunction).toContain("has_active_student_premium");
    expect(edgeFunction).toContain("premium_required");
    // 게이트가 슬롯 확보보다 앞이어야 한다 — 뒤면 막힌 요청이 슬롯을 점유한다.
    // (헤더 주석에도 함수 이름이 나오므로 '실제 호출' 문자열로 위치를 비교한다.)
    const slotCall = edgeFunction.indexOf('asService.rpc("start_homework_check_attempt"');
    expect(slotCall).toBeGreaterThan(0);
    expect(edgeFunction.indexOf('"premium_required"')).toBeLessThan(slotCall);
    expect(edgeFunction.indexOf('"connection_required"')).toBeLessThan(slotCall);
    // 프리미엄 판정은 반드시 사용자 컨텍스트(asUser)로 — service_role 은 auth.uid() 가 null 이다.
    expect(edgeFunction).toContain('asUser.rpc("has_active_student_premium")');
  });

  it("does not trust client-supplied judgment inputs", () => {
    // 범위·학생 ID·사진 경로를 클라이언트에서 받으면 판정 기준을 클라이언트가 정하게 된다.
    // (주석에는 설명이 남아 있어도 되므로 '실제로 body 에서 읽는' 형태만 검사한다.)
    expect(edgeFunction).not.toContain("body?.scopeText");
    expect(edgeFunction).not.toContain("body?.studentId");
    expect(edgeFunction).not.toContain("body?.photoPaths");
    // markedLowEffort 는 pass ↔ insufficient 를 뒤집던 클라이언트 플래그였다 → 제거.
    expect(edgeFunction).not.toContain("body?.markedLowEffort");
    // 판정 함수는 스냅샷의 사진 수만 받는다(클라이언트 힌트를 인자로 되살리면 회귀).
    expect(edgeFunction).toContain("function getStubHomeworkVerdict(photoCount: number): StubResult");
  });

  it("does not reveal whether someone else's submission exists", () => {
    // "없음"과 "권한 없음"이 구분되면 남의 submission_id 로 존재 여부를 알아낼 수 있다.
    expect(edgeFunction).toContain("const NOT_FOUND");
    // DB 예외 원문을 그대로 흘리면 다른 행의 정보가 섞일 수 있다.
    expect(edgeFunction).not.toContain("detail: startError?.message");
  });
});
