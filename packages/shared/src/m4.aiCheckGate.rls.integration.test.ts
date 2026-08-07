import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it } from "vitest";

import type { Database } from "./database.types";
import { AI_CHECK_LIMITS, getAiCheckEntitlement } from "./m4";
import { assertNoLeakedTestUsers, deleteTestUsers } from "./rlsTestCleanup";

type ApiKey = { api_key: string; name: string };
type TestEnv = { accessToken: string; projectRef: string; url: string };

const env = loadTestEnv();
const describeIfRemote = env ? describe : describe.skip;

// 서버측 게이트 검증. Edge Function 은 미배포라 배포 없이 확인 가능한 범위 —
// DB 의 프리미엄 판정·사용량 한도·원자성 — 을 실계정으로 검증한다.
// 과금 분기 규칙 자체는 getAiCheckEntitlement 단위 테스트(m4.test.ts)가 고정하고,
// 여기서는 그 규칙에 넣을 **입력(연결/프리미엄 상태)** 이 DB 에서 올바르게 나오는지 본다.
describeIfRemote("M4 서버측 AI 검사 게이트", () => {
  afterAll(assertNoLeakedTestUsers);

  it("gates by todo source, expiry, connection, and usage limits", async () => {
    if (!env) throw new Error("Missing Supabase test environment");

    const keys = await fetchApiKeys(env);
    const anonKey = getApiKey(keys, "anon");
    const serviceRoleKey = getApiKey(keys, "service_role");
    const admin = createClient<Database>(env.url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    const anonClient = createClient<Database>(env.url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    const studentClient = createClient<Database>(env.url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    const soloClient = createClient<Database>(env.url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const suffix = randomUUID();
    const password = `M4-gate-${suffix}-12345678`;
    const teacherEmail = `teacher-${suffix}@m4-gate.test`;
    const studentEmail = `student-${suffix}@m4-gate.test`;
    const soloEmail = `solo-${suffix}@m4-gate.test`;
    let teacherId = "";
    let studentId = "";
    let soloId = "";

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

      teacherId = await mk(teacherEmail, "teacher", "gate teacher");
      studentId = await mk(studentEmail, "student", "gate student", studentExtra);
      soloId = await mk(soloEmail, "student", "gate solo", studentExtra);

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

      await signIn(studentClient, studentEmail, password);
      await signIn(soloClient, soloEmail, password);

      // ── (8) anon 은 프리미엄 판정 함수를 부를 수 없다 ─────────────────────
      const anonCall = await anonClient.rpc("has_active_student_premium");
      expect(anonCall.error).toBeTruthy();

      // ── 프리미엄 없는 학생: 판정이 false ─────────────────────────────────
      const noSub = await studentClient.rpc("has_active_student_premium");
      assertOk(noSub);
      expect(noSub.data).toBe(false);

      // (1) 프리미엄 아닌 학생 + source='teacher' → **허용되어야 한다**(가장 중요).
      // 과외쌤이 이미 앱 구독료를 냈으므로 학생 프리미엄을 요구하면 가격 구조 위반이다.
      const conn = await studentClient
        .from("connections")
        .select("id")
        .eq("student_id", studentId)
        .eq("status", "active")
        .limit(1)
        .maybeSingle();
      assertOk(conn);
      expect(
        getAiCheckEntitlement({
          todoSource: "teacher",
          hasActiveConnection: Boolean(conn.data),
          hasStudentPremium: noSub.data === true
        })
      ).toEqual({ allowed: true, via: "teacher_connection" });

      // 실제로 검사 슬롯까지 확보되는지 확인한다(구조적 전제 + 한도 통과).
      const teacherTodo = await admin
        .from("todos")
        .insert({
          student_id: studentId,
          connection_id: connectionId,
          title: "미적분 단원 마무리",
          scope_text: "쎈 112~118p",
          subject: "math",
          source: "teacher",
          ai_check_enabled: true,
          locked: true,
          created_by: teacherId
        })
        .select("id")
        .single();
      assertOk(teacherTodo);
      const teacherSubmission = await admin
        .from("homework_submissions")
        .insert({ todo_id: assertData(teacherTodo.data).id, student_id: studentId, photo_paths: [`${studentId}/p1.jpg`] })
        .select("id")
        .single();
      assertOk(teacherSubmission);
      const teacherSubmissionId = assertData(teacherSubmission.data).id;

      const teacherRun = await admin.rpc("start_homework_check_attempt", {
        p_submission_id: teacherSubmissionId,
        p_requested_by: studentId,
        p_idempotency_key: `teacher-run-${suffix}`
      });
      assertOk(teacherRun);
      expect((teacherRun.data as Record<string, unknown>).status).toBe("processing");

      // (2) 프리미엄 아닌 학생 + source='self' → 거부.
      const soloNoSub = await soloClient.rpc("has_active_student_premium");
      assertOk(soloNoSub);
      expect(
        getAiCheckEntitlement({ todoSource: "self", hasActiveConnection: false, hasStudentPremium: soloNoSub.data === true })
      ).toEqual({ allowed: false, error: "premium_required" });

      // (3) 프리미엄 학생 + source='self' → 성공.
      assertOk(
        await admin.from("student_subscriptions").upsert({
          student_id: soloId,
          status: "active",
          provider: "iap",
          expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString()
        })
      );
      const soloPremium = await soloClient.rpc("has_active_student_premium");
      assertOk(soloPremium);
      expect(soloPremium.data).toBe(true);
      expect(
        getAiCheckEntitlement({ todoSource: "self", hasActiveConnection: false, hasStudentPremium: true })
      ).toEqual({ allowed: true, via: "student_premium" });

      // (4) 만료된 프리미엄(status=active, expires_at 과거) → 거부.
      assertOk(
        await admin
          .from("student_subscriptions")
          .update({ expires_at: new Date(Date.now() - 86_400_000).toISOString() })
          .eq("student_id", soloId)
      );
      const expired = await soloClient.rpc("has_active_student_premium");
      assertOk(expired);
      expect(expired.data).toBe(false);

      // expires_at 이 비어 있으면 만료일을 모르는 구독 → fail-closed.
      assertOk(await admin.from("student_subscriptions").update({ expires_at: null }).eq("student_id", soloId));
      const noExpiry = await soloClient.rpc("has_active_student_premium");
      assertOk(noExpiry);
      expect(noExpiry.data).toBe(false);

      // active 아닌 상태는 만료일이 남아 있어도 권리가 없다.
      for (const status of ["past_due", "paused", "canceled", "none"] as const) {
        assertOk(
          await admin
            .from("student_subscriptions")
            .update({ status, expires_at: new Date(Date.now() + 86_400_000).toISOString() })
            .eq("student_id", soloId)
        );
        const judged = await soloClient.rpc("has_active_student_premium");
        assertOk(judged);
        expect(judged.data, status).toBe(false);
      }

      // (5) 연결이 끊긴 학생 + source='teacher' → 거부.
      assertOk(await admin.from("connections").update({ status: "disconnected" }).eq("id", connectionId));
      const goneConn = await studentClient
        .from("connections")
        .select("id")
        .eq("student_id", studentId)
        .eq("status", "active")
        .limit(1)
        .maybeSingle();
      assertOk(goneConn);
      expect(goneConn.data).toBeNull();
      expect(
        getAiCheckEntitlement({ todoSource: "teacher", hasActiveConnection: false, hasStudentPremium: false })
      ).toEqual({ allowed: false, error: "connection_required" });

      // (6) 남의 submission_id → 존재 여부가 드러나지 않는다.
      // 학생 RLS 로는 남의 제출이 "없는 것"과 구별되지 않는다(둘 다 빈 결과).
      const someoneElses = await soloClient
        .from("homework_submissions")
        .select("id")
        .eq("id", teacherSubmissionId)
        .maybeSingle();
      assertOk(someoneElses);
      expect(someoneElses.data).toBeNull();
      const nonExistent = await soloClient
        .from("homework_submissions")
        .select("id")
        .eq("id", randomUUID())
        .maybeSingle();
      assertOk(nonExistent);
      expect(nonExistent.data).toBeNull(); // 남의 것과 없는 것이 같은 응답

      // 구조적 전제: AI 검사가 꺼진 숙제는 검사 대상이 아니다.
      const offTodo = await admin
        .from("todos")
        .insert({
          student_id: soloId,
          title: "AI 검사 꺼진 할 일",
          subject: "math",
          source: "self",
          ai_check_enabled: false,
          created_by: soloId
        })
        .select("id")
        .single();
      assertOk(offTodo);
      const offSubmission = await admin
        .from("homework_submissions")
        .insert({ todo_id: assertData(offTodo.data).id, student_id: soloId, photo_paths: [`${soloId}/p1.jpg`] })
        .select("id")
        .single();
      assertOk(offSubmission);
      const offRun = await admin.rpc("start_homework_check_attempt", {
        p_submission_id: assertData(offSubmission.data).id,
        p_requested_by: soloId,
        p_idempotency_key: `off-${suffix}`
      });
      expect(offRun.error?.message ?? "").toContain("ai_check_disabled_for_todo");

      // ── (7) 한도 초과 → 거부, 슬롯이 점유되지 않는다 ──────────────────────
      // 같은 제출 재검사 상한. 이미 1건이 processing 이므로 완료 후 나머지를 만든다.
      // 값을 하드코딩하면 한도를 바꿀 때 테스트가 조용히 의미를 잃는다 —
      // shared 사본을 쓰고, 그 사본이 DB 와 같은지는 스키마 테스트가 지킨다.
      const limitPerSubmission = AI_CHECK_LIMITS.maxPerSubmission;
      let openAttemptId = (teacherRun.data as Record<string, unknown>).id as string;
      for (let i = 1; i < limitPerSubmission; i++) {
        assertOk(
          await admin.rpc("complete_homework_check_attempt", {
            p_attempt_id: openAttemptId,
            p_verdict: "pass",
            p_confidence: 0.9,
            p_reason: "ok"
          })
        );
        const next = await admin.rpc("start_homework_check_attempt", {
          p_submission_id: teacherSubmissionId,
          p_requested_by: studentId,
          p_idempotency_key: `teacher-run-${suffix}-${i}`
        });
        assertOk(next);
        openAttemptId = (next.data as Record<string, unknown>).id as string;
      }
      assertOk(
        await admin.rpc("complete_homework_check_attempt", {
          p_attempt_id: openAttemptId,
          p_verdict: "pass",
          p_confidence: 0.9,
          p_reason: "ok"
        })
      );

      const beforeOver = await admin
        .from("homework_check_attempts")
        .select("id")
        .eq("submission_id", teacherSubmissionId);
      assertOk(beforeOver);
      expect(beforeOver.data).toHaveLength(limitPerSubmission);

      const overLimit = await admin.rpc("start_homework_check_attempt", {
        p_submission_id: teacherSubmissionId,
        p_requested_by: studentId,
        p_idempotency_key: `teacher-run-${suffix}-over`
      });
      expect(overLimit.error?.message ?? "").toContain("check_limit_submission_exceeded");

      // 슬롯이 점유되지 않았는지 — 행 수가 그대로여야 한다(트랜잭션이 롤백됐다).
      const afterOver = await admin
        .from("homework_check_attempts")
        .select("id, status")
        .eq("submission_id", teacherSubmissionId);
      assertOk(afterOver);
      expect(afterOver.data).toHaveLength(limitPerSubmission);
      expect((afterOver.data ?? []).some((row) => row.status === "processing")).toBe(false);

      // ── (8) 30일 창 호출 한도 → 거부 ──────────────────────────────────────
      // 하루 한도만 있으면 매일 최대치를 쓸 수 있어 누적을 못 막는다. 창 한도를 확인한다.
      //
      // 과거분은 직접 INSERT 로 만든다(RPC 를 70번 부르면 느리고, created_at 을 과거로
      // 둘 수도 없다). 가드 트리거는 auth.uid() 가 null 인 service_role 쓰기를 허용한다.
      const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
      const backfill = (count: number, requestedBy: string, submissionId: string, photos: number, tag: string) =>
        Array.from({ length: count }, (_, i) => ({
          submission_id: submissionId,
          requested_by: requestedBy,
          status: "completed" as const,
          verdict: "pass" as const,
          confidence: 0.9,
          reason: "backfill",
          scope_text_snapshot: "쎈 112~118p",
          photo_paths_snapshot: Array.from({ length: photos }, (_, p) => `${requestedBy}/page-${p + 1}.jpg`),
          idempotency_key: `${tag}-${i}`,
          // 창 안이지만 오늘은 아니어야 한다 — 오늘로 두면 하루 한도가 먼저 걸려 무엇을
          // 검증하는지 알 수 없게 된다.
          created_at: daysAgo(5),
          started_at: daysAgo(5),
          // status in ('completed','failed') 이면 completed_at 이 반드시 있어야 한다(CHECK).
          completed_at: daysAgo(5)
        }));

      assertOk(
        await admin
          .from("homework_check_attempts")
          .insert(backfill(AI_CHECK_LIMITS.maxPerWindow, studentId, teacherSubmissionId, 1, `win-${suffix}`))
      );

      // 재검사 상한에 걸리지 않도록 새 제출을 만든다.
      const freshTodo = await admin
        .from("todos")
        .insert({
          student_id: studentId,
          connection_id: connectionId,
          title: "다음 단원",
          scope_text: "쎈 119~125p",
          subject: "math",
          source: "teacher",
          ai_check_enabled: true,
          locked: true,
          created_by: teacherId
        })
        .select("id")
        .single();
      assertOk(freshTodo);
      const freshSubmission = await admin
        .from("homework_submissions")
        .insert({
          todo_id: assertData(freshTodo.data).id,
          student_id: studentId,
          photo_paths: [`${studentId}/page-1.jpg`]
        })
        .select("id")
        .single();
      assertOk(freshSubmission);

      const overWindow = await admin.rpc("start_homework_check_attempt", {
        p_submission_id: assertData(freshSubmission.data).id,
        p_requested_by: studentId,
        p_idempotency_key: `win-over-${suffix}`
      });
      // 창 한도를 하루 한도보다 먼저 봐야 한다 — "오늘 다 썼어요"라고 하면 내일 또 막힌다.
      expect(overWindow.error?.message ?? "").toContain("check_limit_monthly_exceeded");

      // ── (9) 30일 창 사진 장수 한도 → 경계에서 정확히 갈린다 ────────────────
      // 원가는 사진 토큰이 지배하므로 호출 수만 제한하면 예산을 못 지킨다.
      const soloTodo = await admin
        .from("todos")
        .insert({
          student_id: soloId,
          title: "혼공 수학",
          scope_text: "쎈 30~38p",
          subject: "math",
          source: "self",
          ai_check_enabled: true,
          created_by: soloId
        })
        .select("id")
        .single();
      assertOk(soloTodo);
      const soloTodoId = assertData(soloTodo.data).id;

      const makeSoloSubmission = async (photos: number) => {
        const row = await admin
          .from("homework_submissions")
          .insert({
            todo_id: soloTodoId,
            student_id: soloId,
            photo_paths: Array.from({ length: photos }, (_, p) => `${soloId}/page-${p + 1}.jpg`)
          })
          .select("id")
          .single();
        assertOk(row);
        return assertData(row.data).id;
      };

      // 상한 280 에 딱 1장 모자란 279장을 창 안에 쌓는다(9장 × 31회).
      const perRow = 9;
      const rows = Math.floor((AI_CHECK_LIMITS.maxPhotosPerWindow - 1) / perRow); // 31
      const filledPhotos = rows * perRow; // 279
      expect(filledPhotos).toBeLessThan(AI_CHECK_LIMITS.maxPhotosPerWindow);
      expect(rows).toBeLessThan(AI_CHECK_LIMITS.maxPerWindow); // 호출 한도가 먼저 걸리면 안 된다

      const anchorSubmission = await makeSoloSubmission(perRow);
      assertOk(
        await admin
          .from("homework_check_attempts")
          .insert(backfill(rows, soloId, anchorSubmission, perRow, `pho-${suffix}`))
      );

      // 9장을 더 요청하면 279 + 9 = 288 > 280 → 거부.
      const overPhotos = await admin.rpc("start_homework_check_attempt", {
        p_submission_id: await makeSoloSubmission(perRow),
        p_requested_by: soloId,
        p_idempotency_key: `pho-over-${suffix}`
      });
      expect(overPhotos.error?.message ?? "").toContain("check_limit_photos_monthly_exceeded");

      // 1장이면 279 + 1 = 280 → 정확히 상한이라 통과해야 한다.
      // (경계를 >= 로 쓰면 여기서 막힌다 — 정상 사용을 한 장 앞에서 끊는 실수다.)
      const atPhotoBoundary = await admin.rpc("start_homework_check_attempt", {
        p_submission_id: await makeSoloSubmission(1),
        p_requested_by: soloId,
        p_idempotency_key: `pho-edge-${suffix}`
      });
      assertOk(atPhotoBoundary);
      expect((atPhotoBoundary.data as Record<string, unknown>).status).toBe("processing");
    } finally {
      await deleteTestUsers(admin, [studentId, soloId, teacherId]);
    }
  }, 180_000);
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
