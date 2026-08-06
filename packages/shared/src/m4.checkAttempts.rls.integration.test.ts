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

      // ── (6) completed 인데 verdict 없음 → 거부 ───────────────────────────
      const completedWithoutVerdict = await admin
        .from("homework_check_attempts")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", attemptId);
      expect(completedWithoutVerdict.error?.message ?? "").toContain("attempts_verdict_only_when_completed");

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
