import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  AI_CHECK_LIMITS,
  ANTHROPIC_CHECK_ERROR_CODES,
  HOMEWORK_CHECK_ERROR_MESSAGES,
  HOMEWORK_CHECK_GATE_ERROR_CODES,
  HOMEWORK_PHOTO_QUOTA
} from "./m4";

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
    // 판정 입력은 서버가 DB 에서 읽은 스냅샷뿐이다. 실연동 후에도 body 에서 읽는 것은
    // ID 와 idempotency 키뿐이어야 한다 — 판정에 영향을 주는 값이 추가되면 회귀.
    const bodyReads = [...edgeFunction.matchAll(/body\?\.(\w+)/g)].map((m) => m[1]);
    expect([...new Set(bodyReads)].sort()).toEqual(["idempotencyKey", "submissionId"]);
  });

  it("does not reveal whether someone else's submission exists", () => {
    // "없음"과 "권한 없음"이 구분되면 남의 submission_id 로 존재 여부를 알아낼 수 있다.
    expect(edgeFunction).toContain("const NOT_FOUND");
    // DB 예외 원문을 그대로 흘리면 다른 행의 정보가 섞일 수 있다.
    expect(edgeFunction).not.toContain("detail: startError?.message");
  });
});

// Deno 런타임은 이 패키지를 import 할 수 없어 Edge Function 에 쌍둥이 정의가 있다.
// 두 곳이 갈라지면 서버가 보낸 error_code 에 대응하는 사용자 문구가 없어진다.
describe("M4 edge function ↔ shared 대조", () => {
  const anthropicModule = readFileSync(
    new URL("../../../supabase/functions/ai-homework-check/anthropic.ts", import.meta.url),
    "utf8"
  );

  it("keeps the CheckErrorCode set identical on both sides", () => {
    const denoCodes = [...anthropicModule.matchAll(/^\s*\|\s*"([a-z_]+)"/gm)].map((m) => m[1]);
    expect(denoCodes.length).toBeGreaterThan(5);
    // Anthropic 호출에서 나오는 코드만 대조한다. 게이트·한도 코드는 판정 **전에** 나오므로
    // anthropic.ts 에 있을 수가 없다 — 한 집합으로 묶으면 없는 코드를 억지로 넣어야 한다.
    expect([...denoCodes].sort()).toEqual([...ANTHROPIC_CHECK_ERROR_CODES].sort());
  });

  it("has a user-facing message for every code either side can emit", () => {
    const messages = Object.keys(HOMEWORK_CHECK_ERROR_MESSAGES);
    for (const code of [...ANTHROPIC_CHECK_ERROR_CODES, ...HOMEWORK_CHECK_GATE_ERROR_CODES]) {
      expect(messages, code).toContain(code);
    }
  });

  it("actually sends errorCode on gate and limit rejections", () => {
    // 회귀 방어. 게이트·한도 응답이 { error } 만 담으면 클라이언트(body.errorCode)가 코드를
    // 못 읽어 전부 "확인 중 문제가 생겼어요"(unknown)로 표시된다. 실제로 그 상태였고,
    // 그래서 한도 안내가 한 번도 보이지 않았다.
    expect(edgeFunction).toContain("errorCode: code");
    // 에러 응답은 fail() 을 거쳐야 한다 — 직접 Response 를 만들면 errorCode 가 빠진다.
    // (fail() 본체 1건과 check_failed 1건만 허용. check_failed 는 errorCode 를 직접 담는다.)
    const rawErrorResponses = [...edgeFunction.matchAll(/JSON\.stringify\(\{ error: /g)].length;
    expect(rawErrorResponses, "fail() 을 우회한 에러 응답이 있다").toBeLessThanOrEqual(2);

    // 서버가 내보내는 게이트·한도 코드가 shared 목록과 어긋나면 문구 없는 코드가 생긴다.
    for (const code of HOMEWORK_CHECK_GATE_ERROR_CODES) {
      expect(edgeFunction, code).toContain(`"${code}"`);
    }
  });

  it("keeps the AI as an assistant, not a grader", () => {
    // 제품 원칙 §3-2. 프롬프트가 정답 채점을 하지 않는다고 못박아야 한다.
    expect(anthropicModule).toContain("정답 여부를 판정하지 않습니다");
    expect(anthropicModule).toContain("확신할 수 없는 것을 단정하지 않습니다");
    expect(anthropicModule).toContain("추측으로 채우지 않습니다");
    // 페이지 번호가 안 보이면 억지 판정 금지.
    expect(anthropicModule).toContain("페이지 확인 어려움");
  });

  it("keeps pricing in integer micros so costs can be summed without drift", () => {
    expect(anthropicModule).toContain("INPUT_MICROS_PER_MTOK");
    expect(anthropicModule).toContain("OUTPUT_MICROS_PER_MTOK");
    expect(anthropicModule).toContain("estimateCostUsdMicros");
  });

  it("sets a timeout and an image size ceiling", () => {
    expect(anthropicModule).toContain("REQUEST_TIMEOUT_MS");
    expect(anthropicModule).toContain("MAX_TOTAL_IMAGE_BYTES");
    expect(anthropicModule).toContain("AbortController");
  });

  it("verifies snapshot photos exist before calling the model", () => {
    expect(edgeFunction).toContain("downloadSnapshotImages");
    expect(edgeFunction).toContain("photos_missing");
    // 라이브 값이 아니라 스냅샷을 봐야 한다.
    expect(edgeFunction).toContain("attempt.photo_paths_snapshot");
    expect(edgeFunction).toContain("attempt.scope_text_snapshot");
    // 실패는 반드시 attempt 에 남겨 슬롯을 비운다 — 안 그러면 재시도가 영구히 막힌다.
    expect(edgeFunction).toContain("fail_homework_check_attempt");
  });

  it("no longer contains the stub verdict", () => {
    expect(edgeFunction).not.toContain("getStubHomeworkVerdict");
    expect(edgeFunction).not.toContain("stub-deterministic");
  });
});

// ── 숙제 사진 업로드 한도(20260807010000) ────────────────────────────────────
// 조사에서 "비용이 발생하는데 게이트가 하나도 없는" 유일한 기능으로 확인된 곳이다.
describe("M4 homework photo upload quota", () => {
  const quotaMigration = readFileSync(
    new URL("../../../supabase/migrations/20260807010000_homework_photo_quota.sql", import.meta.url),
    "utf8"
  );

  it("enforces the quota in the storage INSERT policy, not only in the client", () => {
    for (const source of [schema, quotaMigration]) {
      expect(source).toContain("create policy homework_photos_student_insert on storage.objects");
      expect(source).toContain("homework_photo_upload_allowed(name)");
    }
  });

  it("keeps the shared quota copy in sync with the DB (DB is authoritative)", () => {
    // 함수 이름까지 묶어서 본다 — 값만 보면 우연히 같은 숫자를 쓰는 다른 상수에 걸린다
    // (ai_check_window_days 도 30 이다). schema.sql 은 CRLF 라 \s+ 로 잇는다.
    const quotaDef = (name: string, value: number) =>
      new RegExp(`${name}\\(\\) returns \\w+\\s+language sql immutable as \\$\\$ select ${value} \\$\\$`);
    for (const source of [schema, quotaMigration]) {
      expect(source).toMatch(quotaDef("homework_photo_quota_window_days", HOMEWORK_PHOTO_QUOTA.windowDays));
      expect(source).toMatch(quotaDef("homework_photo_quota_objects", HOMEWORK_PHOTO_QUOTA.maxObjects));
      expect(source).toMatch(quotaDef("homework_photo_quota_bytes", HOMEWORK_PHOTO_QUOTA.maxBytes));
      expect(source).toMatch(quotaDef("homework_photo_retention_days", HOMEWORK_PHOTO_QUOTA.retentionDays));
    }
  });

  it("uses security definer so the policy does not recurse into itself", () => {
    // invoker 로 두면 storage.objects 정책이 자기 자신을 다시 평가해
    // "infinite recursion detected in policy" 가 난다.
    const fnStart = quotaMigration.indexOf("create or replace function homework_photo_upload_allowed");
    const definerAt = quotaMigration.indexOf("security definer", fnStart);
    expect(fnStart).toBeGreaterThan(0);
    expect(definerAt).toBeGreaterThan(fnStart);
  });

  it("takes no student_id argument so nobody can probe another student's usage", () => {
    expect(quotaMigration).toContain("create or replace function homework_photo_usage()");
    expect(quotaMigration).toContain("auth.uid()::text");
    expect(quotaMigration).not.toMatch(/homework_photo_usage\(\s*p_/);
  });

  it("requires the path to belong to an existing todo of the caller", () => {
    // 제출 행은 요구할 수 없다(사진이 먼저 올라간다) — 대신 내 할 일 실재를 요구한다.
    for (const source of [schema, quotaMigration]) {
      expect(source).toContain("from public.todos");
      expect(source).toContain("student_id = v_uid");
    }
  });

  it("guards the empty-array array_length trap", () => {
    // 폴더가 없는 이름이면 storage.foldername 이 빈 배열을 주고
    // array_length(빈 배열, 1) 은 0 이 아니라 NULL 이다.
    expect(quotaMigration).toContain("coalesce(array_length(parts, 1), 0)");
  });

  it("does not pretend SQL alone can delete the files", () => {
    // storage.objects 행만 지우면 실제 파일은 남는다. 목록만 돌려주고 삭제는 Storage API 가 한다.
    expect(quotaMigration).toContain("homework_photos_expired_paths");
    expect(quotaMigration).toContain("grant execute on function homework_photos_expired_paths(integer) to service_role");
    expect(quotaMigration).toContain("revoke all on function homework_photos_expired_paths(integer) from authenticated");
  });
});

// ── AI 검사 한도 재산정(20260807020000) ──────────────────────────────────────
describe("M4 AI check limits rebalance", () => {
  const limitsMigration = readFileSync(
    new URL("../../../supabase/migrations/20260807020000_ai_check_limits_rebalance.sql", import.meta.url),
    "utf8"
  );

  it("keeps the shared limit copy in sync with the DB (DB is authoritative)", () => {
    // schema.sql 은 CRLF 다 — 줄바꿈에 무관하게 \s+ 로 잇는다.
    const limitDef = (name: string, value: number) =>
      new RegExp(`${name}\\(\\) returns integer\\s+language sql immutable as \\$\\$ select ${value} \\$\\$`);
    for (const source of [schema, limitsMigration]) {
      expect(source).toMatch(limitDef("ai_check_max_attempts_per_submission", AI_CHECK_LIMITS.maxPerSubmission));
      expect(source).toMatch(limitDef("ai_check_max_attempts_per_day", AI_CHECK_LIMITS.maxPerDay));
      expect(source).toMatch(limitDef("ai_check_max_attempts_per_month", AI_CHECK_LIMITS.maxPerWindow));
      expect(source).toMatch(limitDef("ai_check_max_photos_per_month", AI_CHECK_LIMITS.maxPhotosPerWindow));
      expect(source).toMatch(limitDef("ai_check_window_days", AI_CHECK_LIMITS.windowDays));
    }
  });

  it("adds a window limit so the daily limit cannot be spent every day", () => {
    // 하루 한도만 있으면 하루 최대치 × 30일을 쓸 수 있다. 그게 기존 구멍이었다.
    expect(AI_CHECK_LIMITS.maxPerDay * AI_CHECK_LIMITS.windowDays).toBeGreaterThan(AI_CHECK_LIMITS.maxPerWindow);
  });

  it("caps photos as well as calls, because cost is dominated by image tokens", () => {
    for (const source of [schema, limitsMigration]) {
      expect(source).toContain("check_limit_photos_monthly_exceeded");
      // 지금 요청할 사진까지 더해서 봐야 마지막 요청이 상한을 넘기지 않는다.
      expect(source).toContain("photos_window + photos_requested > ai_check_max_photos_per_month()");
    }
  });

  it("keeps the worst-case monthly cost inside 30% of student revenue", () => {
    // 실측(2026-08-06): 프롬프트 936토큰 · 사진 1장 ≈ 1,600토큰 · 출력 ≤130토큰,
    // Haiku 단가 입력 $1/Mtok · 출력 $5/Mtok, 환율 약 1,370원/$.
    const KRW_PER_MICRO_USD = 1370 / 1_000_000;
    const perCallMicros = 936 + 130 * 5; // 프롬프트 + 출력
    const perPhotoMicros = 1600;
    const worstKrw =
      (AI_CHECK_LIMITS.maxPerWindow * perCallMicros + AI_CHECK_LIMITS.maxPhotosPerWindow * perPhotoMicros) *
      KRW_PER_MICRO_USD;
    expect(worstKrw).toBeLessThanOrEqual(2900 * 0.3);
  });

  it("checks the window limits before the daily limit", () => {
    // 창이 소진됐는데 "오늘 다 썼어요"라고 하면 사용자가 내일 다시 시도해 또 막힌다.
    const fnStart = limitsMigration.indexOf("create or replace function start_homework_check_attempt");
    const monthAt = limitsMigration.indexOf("check_limit_monthly_exceeded", fnStart);
    const dayAt = limitsMigration.indexOf("check_limit_daily_exceeded", fnStart);
    const insertAt = limitsMigration.indexOf("insert into homework_check_attempts", fnStart);
    expect(monthAt).toBeGreaterThan(fnStart);
    expect(monthAt).toBeLessThan(dayAt);
    expect(dayAt).toBeLessThan(insertAt);
  });

  it("still checks limits inside the slot-acquiring transaction", () => {
    expect(limitsMigration).toContain("pg_advisory_xact_lock");
    const lockAt = limitsMigration.indexOf("pg_advisory_xact_lock");
    const insertAt = limitsMigration.indexOf("insert into homework_check_attempts", lockAt);
    expect(insertAt).toBeGreaterThan(lockAt);
  });
});
