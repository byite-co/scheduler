import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it } from "vitest";

import type { Database } from "./database.types";
import { assertNoLeakedTestUsers, deleteTestUsers } from "./rlsTestCleanup";

type ApiKey = { api_key: string; name: string };
type TestEnv = { accessToken: string; projectRef: string; url: string };

const env = loadTestEnv();
const describeIfRemote = env ? describe : describe.skip;

describeIfRemote("M4 homework_check_attempts — 실행 레코드 RLS/제약", () => {
  // 정리 실패는 finally 에서 throw 하면 원래 실패 원인을 덮어쓴다 → 여기서 따로 터뜨린다.
  afterAll(assertNoLeakedTestUsers);

  it("keeps attempts server-written, student-readable, and one-active-per-submission", async () => {
    if (!env) throw new Error("Missing Supabase test environment");

    const keys = await fetchApiKeys(env);
    const anonKey = getApiKey(keys, "anon");
    const serviceRoleKey = getApiKey(keys, "service_role");
    const admin = createClient<Database>(env.url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    const studentClient = createClient<Database>(env.url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    const otherStudentClient = createClient<Database>(env.url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    const teacherClient = createClient<Database>(env.url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const suffix = randomUUID();
    const password = `M4-attempt-${suffix}-12345678`;
    const teacherEmail = `teacher-${suffix}@m4-att.test`;
    const studentEmail = `student-${suffix}@m4-att.test`;
    const otherEmail = `other-${suffix}@m4-att.test`;
    let teacherId = "";
    let studentId = "";
    let otherId = "";

    try {
      const mk = async (email: string, role: "teacher" | "student", name: string, extra = {}) => {
        const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
        if (created.error) throw created.error;
        const id = created.data.user.id;
        assertOk(await admin.from("profiles").insert({ id, role, name, onboarded: true, ...extra }));
        return id;
      };
      const studentExtra = {
        grade: "고1",
        birth_date: "2010-03-01",
        guardian_consented_at: new Date().toISOString()
      };

      teacherId = await mk(teacherEmail, "teacher", "attempt teacher");
      studentId = await mk(studentEmail, "student", "attempt student", studentExtra);
      otherId = await mk(otherEmail, "student", "attempt other", studentExtra);

      const connection = await admin
        .from("connections")
        .insert({
          teacher_id: teacherId,
          student_id: studentId,
          status: "active",
          requested_by: studentId,
          activated_at: new Date().toISOString()
        })
        .select("id")
        .single();
      assertOk(connection);
      const connectionId = assertData(connection.data).id;
      // 사진 공개 ON — subs_teacher_read 와 같은 게이팅을 attempts 에서도 확인한다.
      assertOk(
        await admin
          .from("disclosure_settings")
          .insert({ connection_id: connectionId, share_homework_photos: true })
      );

      const todo = await admin
        .from("todos")
        .insert({
          student_id: studentId,
          connection_id: connectionId,
          title: "미적분 단원 마무리",
          scope_text: "쎈 112~118p, 115p 제외",
          subject: "math",
          source: "teacher",
          ai_check_enabled: true,
          locked: true,
          created_by: teacherId
        })
        .select("id")
        .single();
      assertOk(todo);
      const todoId = assertData(todo.data).id;

      const submission = await admin
        .from("homework_submissions")
        .insert({ todo_id: todoId, student_id: studentId, photo_paths: [`${studentId}/p1.jpg`, `${studentId}/p2.jpg`] })
        .select("id")
        .single();
      assertOk(submission);
      const submissionId = assertData(submission.data).id;

      await signIn(studentClient, studentEmail, password);
      await signIn(otherStudentClient, otherEmail, password);
      await signIn(teacherClient, teacherEmail, password);

      // ── (1) 학생은 attempt 에 직접 쓸 수 없다 ────────────────────────────
      const studentInsert = await studentClient.from("homework_check_attempts").insert({
        submission_id: submissionId,
        requested_by: studentId,
        photo_paths_snapshot: [`${studentId}/p1.jpg`],
        idempotency_key: `student-forged-${suffix}`
      });
      expect(studentInsert.error).toBeTruthy();

      // 서버가 만든 실행 레코드 — 스냅샷이 함께 고정된다.
      const started = await admin.rpc("start_homework_check_attempt", {
        p_submission_id: submissionId,
        p_requested_by: studentId,
        p_idempotency_key: `run-1-${suffix}`
      });
      assertOk(started);
      const attempt = assertData(started.data as Record<string, unknown> | null);
      expect(attempt.status).toBe("processing");
      // 스냅샷: 검사 시작 시점의 범위·사진이 고정돼야 한다.
      expect(attempt.scope_text_snapshot).toBe("쎈 112~118p, 115p 제외");
      expect(attempt.photo_paths_snapshot).toEqual([`${studentId}/p1.jpg`, `${studentId}/p2.jpg`]);
      expect(attempt.verdict).toBeNull();
      const attemptId = attempt.id as string;

      // UPDATE/DELETE 는 '오류'로 막히지 않는다 — Postgres RLS 는 해당 정책이 없으면
      // 대상 행을 하나도 선택하지 않아 **0행 처리로 조용히 끝난다**(INSERT 만 42501 을 낸다).
      // 그래서 오류 유무가 아니라 "값이 그대로인지"로 확인해야 한다.
      await studentClient
        .from("homework_check_attempts")
        .update({ status: "completed", verdict: "pass", reason: "학생이 위조" })
        .eq("id", attemptId);
      await studentClient.from("homework_check_attempts").delete().eq("id", attemptId);
      const afterForgery = await admin
        .from("homework_check_attempts")
        .select("status, verdict, reason")
        .eq("id", attemptId)
        .single();
      assertOk(afterForgery);
      expect(afterForgery.data).toMatchObject({ status: "processing", verdict: null, reason: null });

      // ── (2) 학생은 자기 제출의 attempt 를 읽을 수 있다 ───────────────────
      const mine = await studentClient
        .from("homework_check_attempts")
        .select("id, status, scope_text_snapshot")
        .eq("id", attemptId);
      assertOk(mine);
      expect(mine.data).toHaveLength(1);

      // ── (3) 남의 attempt 는 읽히지 않는다(빈 결과) ───────────────────────
      const notMine = await otherStudentClient
        .from("homework_check_attempts")
        .select("id")
        .eq("id", attemptId);
      assertOk(notMine);
      expect(notMine.data).toEqual([]);

      // ── (5) 한 제출에 진행 중인 검사는 하나만 ────────────────────────────
      const secondRun = await admin.rpc("start_homework_check_attempt", {
        p_submission_id: submissionId,
        p_requested_by: studentId,
        p_idempotency_key: `run-2-${suffix}`
      });
      expect(secondRun.error?.message ?? "").toContain("check_already_in_progress");

      // ── (4) 같은 idempotency_key 재전송은 새 실행을 만들지 않고 기존 것을 돌려준다 ──
      const retry = await admin.rpc("start_homework_check_attempt", {
        p_submission_id: submissionId,
        p_requested_by: studentId,
        p_idempotency_key: `run-1-${suffix}`
      });
      assertOk(retry);
      expect((retry.data as Record<string, unknown>).id).toBe(attemptId);
      const allForSubmission = await admin
        .from("homework_check_attempts")
        .select("id")
        .eq("submission_id", submissionId);
      assertOk(allForSubmission);
      expect(allForSubmission.data).toHaveLength(1); // 중복 실행이 생기지 않았다

      // 같은 키로 직접 INSERT 하면 유니크 제약이 막는다(서버 키로도).
      const dupInsert = await admin.from("homework_check_attempts").insert({
        submission_id: submissionId,
        requested_by: studentId,
        photo_paths_snapshot: [`${studentId}/p1.jpg`],
        idempotency_key: `run-1-${suffix}`
      });
      expect(dupInsert.error?.message ?? "").toMatch(/duplicate key|idempotency/i);

      // ── (6) completed 인데 결과가 아무것도 없음 → 거부 ───────────────────
      // 20260807030000 이후 "결과"는 판정 **또는** 관찰이다(관찰 전용 실행에는 verdict 가 없다).
      // 둘 다 없는 completed 는 여전히 거부돼야 한다 — 아니면 빈 완료가 성공으로 읽힌다.
      const completedWithoutResult = await admin
        .from("homework_check_attempts")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", attemptId);
      expect(completedWithoutResult.error?.message ?? "").toContain("attempts_completed_has_result");

      // 반대로 관찰만 있는 completed 는 허용돼야 한다(AI 는 판정하지 않는다).
      const completedWithObservation = await admin
        .from("homework_check_attempts")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          raw_ai_observation: { schema_version: "obs-1", images: [] },
          prompt_version: "obs-prompt-1",
          schema_version: "obs-1",
          scope_included: true,
          stop_reason: "end_turn",
          latency_ms: 1234
        })
        .eq("id", attemptId);
      assertOk(completedWithObservation);

      // 아래 단계들이 이 실행을 계속 쓰므로 열린 상태로 되돌린다(제약 검증만이 목적이었다).
      const reopen = await admin
        .from("homework_check_attempts")
        .update({ status: "processing", completed_at: null, raw_ai_observation: null })
        .eq("id", attemptId);
      assertOk(reopen);

      // ── (7) 사진 0개 / 10개 → 거부 ───────────────────────────────────────
      for (const [label, paths] of [
        ["0개", [] as string[]],
        ["10개", Array.from({ length: 10 }, (_, i) => `a/${i}.jpg`)]
      ] as const) {
        const bad = await admin.from("homework_check_attempts").insert({
          submission_id: submissionId,
          requested_by: studentId,
          photo_paths_snapshot: paths,
          idempotency_key: `photos-${label}-${suffix}`
        });
        expect(bad.error?.message ?? "", `사진 ${label}`).toContain("attempts_photo_count");
      }

      // 완료 기록 → homework_submissions.ai_* 캐시가 함께 갱신된다.
      const completed = await admin.rpc("complete_homework_check_attempt", {
        p_attempt_id: attemptId,
        p_verdict: "pass",
        p_confidence: 0.86,
        p_reason: "풀이 분량을 모두 채운 것으로 보여요.",
        p_model: "stub-deterministic",
        p_input_tokens: 1200,
        p_output_tokens: 80,
        p_estimated_cost_usd_micros: 4200
      });
      assertOk(completed);
      const done = assertData(completed.data as Record<string, unknown> | null);
      expect(done.status).toBe("completed");
      expect(done.verdict).toBe("pass");
      expect(done.completed_at).toBeTruthy();
      expect(done.estimated_cost_usd_micros).toBe(4200);

      const cached = await admin
        .from("homework_submissions")
        .select("ai_verdict, ai_confidence, ai_reason")
        .eq("id", submissionId)
        .single();
      assertOk(cached);
      expect(cached.data).toMatchObject({ ai_verdict: "pass" });

      // 완료 후에는 슬롯이 비므로 재검사가 가능하다 — 이전 판정은 남는다.
      const rerun = await admin.rpc("start_homework_check_attempt", {
        p_submission_id: submissionId,
        p_requested_by: studentId,
        p_idempotency_key: `run-3-${suffix}`
      });
      assertOk(rerun);
      const rerunId = (rerun.data as Record<string, unknown>).id as string;
      expect(rerunId).not.toBe(attemptId);
      const history = await admin
        .from("homework_check_attempts")
        .select("id")
        .eq("submission_id", submissionId);
      assertOk(history);
      expect(history.data).toHaveLength(2); // 이전 판정이 소실되지 않았다

      // 실패로 끝내면 슬롯이 다시 열린다.
      const failed = await admin.rpc("fail_homework_check_attempt", {
        p_attempt_id: rerunId,
        p_error_code: "upstream_timeout"
      });
      assertOk(failed);
      expect((failed.data as Record<string, unknown>).status).toBe("failed");
      const afterFail = await admin.rpc("start_homework_check_attempt", {
        p_submission_id: submissionId,
        p_requested_by: studentId,
        p_idempotency_key: `run-4-${suffix}`
      });
      assertOk(afterFail);

      // ── (7-b) 관찰 기록 경로를 **실제로 실행**한다 ────────────────────────
      // 🚨 이 실행 테스트가 없어서 record_homework_check_observation 이 2026-08-07 부터
      //    호출될 때마다 실패하는 것을 아무도 몰랐다(무형 리터럴 CASE → text → enum 대입 실패).
      //    스키마 테스트는 함수 존재·권한만 문자열로 확인한다 — 본문이 도는지는 검증하지 못한다.
      //    그래서 여기서는 반드시 **호출하고 결과 행까지** 확인한다.
      const observeId = (afterFail.data as Record<string, unknown>).id as string;
      const observed = await admin.rpc("record_homework_check_observation", {
        p_attempt_id: observeId,
        p_raw_observation: { prompt_version: "obs-prompt-1", schema_version: "1.0", images: [] },
        p_prompt_version: "obs-prompt-1",
        p_schema_version: "1.0",
        p_scope_included: true,
        p_stop_reason: "end_turn",
        p_model: "integration-no-ai-call",
        p_input_tokens: 2892,
        p_output_tokens: 130,
        p_cost_usd_micros: 3542,
        p_latency_ms: 1200
        // p_discard_reason 생략 = 폐기 아님(성공 경로).
      });
      assertOk(observed);
      const observedRow = assertData(observed.data as Record<string, unknown> | null);
      expect(observedRow.status).toBe("completed");
      expect(observedRow.prompt_version).toBe("obs-prompt-1");
      expect(observedRow.model).toBe("integration-no-ai-call");
      // 비용·토큰이 실제로 남아야 한다. 안 남으면 나간 돈을 나중에 셀 수 없다.
      expect(observedRow.estimated_cost_usd_micros).toBe(3542);
      expect(observedRow.input_tokens).toBe(2892);
      expect(observedRow.raw_ai_observation).toMatchObject({ schema_version: "1.0" });
      // 관찰은 판정이 아니다 — verdict 는 비어 있어야 한다.
      expect(observedRow.verdict).toBeNull();

      // 폐기 경로도 실행한다. 폐기는 failed 로 남되 **원본은 보관**한다.
      // 제출당 재검사 상한(3회)에 이미 닿았으므로 새 제출을 하나 만든다.
      const discardSubmission = await admin
        .from("homework_submissions")
        .insert({ todo_id: todoId, student_id: studentId, photo_paths: [`${studentId}/p3.jpg`] })
        .select("id")
        .single();
      assertOk(discardSubmission);
      const discardRun = await admin.rpc("start_homework_check_attempt", {
        p_submission_id: assertData(discardSubmission.data).id,
        p_requested_by: studentId,
        p_idempotency_key: `run-5-${suffix}`
      });
      assertOk(discardRun);
      const discarded = await admin.rpc("record_homework_check_observation", {
        p_attempt_id: (discardRun.data as Record<string, unknown>).id as string,
        p_raw_observation: { prompt_version: "obs-prompt-1", schema_version: "1.0", images: null },
        p_prompt_version: "obs-prompt-1",
        p_schema_version: "1.0",
        p_scope_included: true,
        p_stop_reason: "max_tokens",
        p_model: "integration-no-ai-call",
        p_input_tokens: 100,
        p_output_tokens: 10,
        p_cost_usd_micros: 200,
        p_latency_ms: 300,
        p_discard_reason: "stop_reason_not_end_turn: max_tokens"
      });
      assertOk(discarded);
      const discardedRow = assertData(discarded.data as Record<string, unknown> | null);
      expect(discardedRow.status).toBe("failed");
      expect(discardedRow.error_code).toBe("observation_discarded");
      expect(discardedRow.discard_reason).toContain("max_tokens");
      expect(discardedRow.raw_ai_observation).toBeTruthy(); // 폐기해도 원본은 남는다

      // 이미 마감된 attempt 에 다시 기록하면 거부된다(중복 기록 방지).
      const reRecord = await admin.rpc("record_homework_check_observation", {
        p_attempt_id: observeId,
        p_raw_observation: {},
        p_prompt_version: "obs-prompt-1",
        p_schema_version: "1.0",
        p_scope_included: true
        // 선택 인자는 생략한다 — 기본값이 null 이라 같은 요청이 된다.
      });
      expect(reRecord.error?.message ?? "").toContain("check_attempt_not_open");

      // ── (8) 과외쌤: 공개범위 안에서는 읽히고, 끄면 읽히지 않는다 ─────────
      const teacherSees = await teacherClient
        .from("homework_check_attempts")
        .select("id")
        .eq("submission_id", submissionId);
      assertOk(teacherSees);
      expect((teacherSees.data ?? []).length).toBeGreaterThan(0);

      assertOk(
        await admin
          .from("disclosure_settings")
          .update({ share_homework_photos: false })
          .eq("connection_id", connectionId)
      );
      const teacherBlocked = await teacherClient
        .from("homework_check_attempts")
        .select("id")
        .eq("submission_id", submissionId);
      assertOk(teacherBlocked);
      expect(teacherBlocked.data).toEqual([]); // 제출을 못 보면 검사 이력도 못 본다

      // 회귀: 학생은 여전히 자기 제출을 지울 수 있어야 한다(attempt cascade).
      // 가드 트리거를 DELETE 에도 걸면 여기서 막힌다 — 계정 탈퇴 cascade 도 함께 깨진다.
      assertOk(await studentClient.from("homework_submissions").delete().eq("id", submissionId));
      const cascaded = await admin
        .from("homework_check_attempts")
        .select("id")
        .eq("submission_id", submissionId);
      assertOk(cascaded);
      expect(cascaded.data).toEqual([]);
    } finally {
      await deleteTestUsers(admin, [studentId, otherId, teacherId]);
    }
  }, 90_000);
});

async function signIn(client: ReturnType<typeof createClient<Database>>, email: string, password: string): Promise<void> {
  const result = await client.auth.signInWithPassword({ email, password });
  if (result.error) throw result.error;
}

function loadTestEnv(): TestEnv | null {
  const envFile = readEnvFile(new URL("../../../.env.local", import.meta.url));
  const projectRef = process.env.SUPABASE_PROJECT_REF ?? envFile.SUPABASE_PROJECT_REF;
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN ?? envFile.SUPABASE_ACCESS_TOKEN;
  if (!projectRef || !accessToken) return null;
  return { accessToken, projectRef, url: `https://${projectRef}.supabase.co` };
}

function readEnvFile(url: URL): Record<string, string> {
  if (!existsSync(url)) return {};
  return Object.fromEntries(
    readFileSync(url, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^["']|["']$/g, "")];
      })
  );
}

async function fetchApiKeys(env: TestEnv): Promise<ApiKey[]> {
  const response = await fetch(`https://api.supabase.com/v1/projects/${env.projectRef}/api-keys`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${env.accessToken}` }
  });
  if (!response.ok) throw new Error(`Failed to fetch Supabase API keys: ${response.status}`);
  return response.json() as Promise<ApiKey[]>;
}

function getApiKey(keys: ApiKey[], name: "anon" | "service_role"): string {
  const key = keys.find((candidate) => candidate.name === name)?.api_key;
  if (!key) throw new Error(`Missing Supabase ${name} key`);
  return key;
}

function assertOk(result: { error: unknown }): void {
  if (result.error) throw result.error;
}

function assertData<T>(data: T | null): T {
  if (!data) throw new Error("Expected Supabase response data");
  return data;
}
