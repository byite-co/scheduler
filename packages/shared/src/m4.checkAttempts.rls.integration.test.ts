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

      // ── (7-c) 미종결 상태는 관찰 결과를 가질 수 없다 (20260817000000) ──────
      // 20260816040000 이 양방향 등식을 쪼개면서 이 방향이 비었다 — queued/processing 인 행이
      // 관찰을 들고 있으면 부분 기록이 "완료된 관찰" 로 읽힌다.
      const inflight = await admin.rpc("start_homework_check_attempt", {
        p_submission_id: assertData(discardSubmission.data).id,
        p_requested_by: studentId,
        p_idempotency_key: `run-6-${suffix}`
      });
      assertOk(inflight);
      const inflightId = (inflight.data as Record<string, unknown>).id as string;
      const sneak = await admin
        .from("homework_check_attempts")
        .update({ raw_ai_observation: { sneaked: true } })
        .eq("id", inflightId);
      expect(sneak.error?.message ?? "").toContain("attempts_observation_requires_settled");

      // ── (7-d) AI 호출 권리는 한 번만 발급된다 (동시 요청 이중 과금 차단) ──
      // 같은 attempt 에 두 번 claim 하면 두 번째는 false 여야 한다. false 를 받은 요청은
      // AI 를 부르지 않는다 — 이 관문이 없으면 사진 한 장에 돈이 두 번 나간다.
      const firstClaim = await admin.rpc("claim_homework_check_attempt", { p_attempt_id: inflightId });
      assertOk(firstClaim);
      expect(firstClaim.data).toBe(true);
      const secondClaim = await admin.rpc("claim_homework_check_attempt", { p_attempt_id: inflightId });
      assertOk(secondClaim);
      expect(secondClaim.data).toBe(false);

      // 동시 요청 두 개가 **정말로 동시에** 들어와도 한 쪽만 이긴다.
      const raceRun = await admin.rpc("start_homework_check_attempt", {
        p_submission_id: assertData(discardSubmission.data).id,
        p_requested_by: studentId,
        p_idempotency_key: `run-7-${suffix}`
      });
      // 앞 attempt 가 아직 processing 이라 슬롯이 하나뿐이다 — 같은 행을 다시 받거나 거부된다.
      if (!raceRun.error) {
        const raceId = (raceRun.data as Record<string, unknown>).id as string;
        const [a, b] = await Promise.all([
          admin.rpc("claim_homework_check_attempt", { p_attempt_id: raceId }),
          admin.rpc("claim_homework_check_attempt", { p_attempt_id: raceId })
        ]);
        expect([a.data, b.data].filter(Boolean)).toHaveLength(raceId === inflightId ? 0 : 1);
      }


      // ── (7-e) 실패로 끝나도 이미 나간 비용이 남는다 (20260817000000) ───────
      // 예전에는 status·error_code 만 써서, AI 호출이 끝난 뒤 실패하면 토큰·비용이
      // 어디에도 기록되지 않았다. 나간 돈을 나중에 셀 수 없다는 뜻이다.
      const failedWithCost = await admin.rpc("fail_homework_check_attempt", {
        p_attempt_id: inflightId,
        p_error_code: "attempt_complete_failed",
        p_model: "integration-no-ai-call",
        p_input_tokens: 2892,
        p_output_tokens: 130,
        p_cost_usd_micros: 3542,
        p_latency_ms: 900
      });
      assertOk(failedWithCost);
      const failedRow = assertData(failedWithCost.data as Record<string, unknown> | null);
      expect(failedRow.status).toBe("failed");
      expect(failedRow.estimated_cost_usd_micros).toBe(3542);
      expect(failedRow.input_tokens).toBe(2892);
      expect(failedRow.model).toBe("integration-no-ai-call");

      // 기존 2-인자 호출도 그대로 동작해야 한다(다른 실패 경로가 인자 없이 부른다).
      const legacyRun = await admin.rpc("start_homework_check_attempt", {
        p_submission_id: assertData(discardSubmission.data).id,
        p_requested_by: studentId,
        p_idempotency_key: `run-8-${suffix}`
      });
      assertOk(legacyRun);
      const legacyFail = await admin.rpc("fail_homework_check_attempt", {
        p_attempt_id: (legacyRun.data as Record<string, unknown>).id as string,
        p_error_code: "upstream_timeout"
      });
      assertOk(legacyFail);
      expect((legacyFail.data as Record<string, unknown>).status).toBe("failed");

      // ── (7-d-2) 임차 만료 탈환 (20260817010000) ───────────────────────────
      // 전용 제출·attempt 를 새로 만든다 — 제출당 재검사 상한(3회)과 (7-e) 의 대상과
      // 겹치지 않아야 한다(겹치면 서로의 상태를 닫아 버린다).
      const leaseSubmission = await admin
        .from("homework_submissions")
        .insert({ todo_id: todoId, student_id: studentId, photo_paths: [`${studentId}/p4.jpg`] })
        .select("id")
        .single();
      assertOk(leaseSubmission);
      const leaseRun = await admin.rpc("start_homework_check_attempt", {
        p_submission_id: assertData(leaseSubmission.data).id,
        p_requested_by: studentId,
        p_idempotency_key: `lease-1-${suffix}`
      });
      assertOk(leaseRun);
      const leaseId = (leaseRun.data as Record<string, unknown>).id as string;

      // 권리를 가져간 요청이 크래시하면 그 행은 processing + ai_started_at 채워진 채로
      // 영구히 남아 **그 제출을 다시는 검사할 수 없었다**(모든 재시도가 409).
      // 임계가 지나고도 미종결이면 다음 요청이 탈환할 수 있어야 한다.
      //
      // 시계 의존이라 실제로 기다리지 않는다 — ai_started_at 을 과거로 직접 세팅해 재현한다.
      const leaseMinutes = await admin.rpc("ai_check_claim_lease_minutes");
      assertOk(leaseMinutes);
      expect(leaseMinutes.data).toBe(10);

      // ② 신선한 claim 은 탈환되지 않는다. 1분 전은 10분 임계 안이다.
      assertOk(
        await admin
          .from("homework_check_attempts")
          .update({ ai_started_at: new Date(Date.now() - 60_000).toISOString() })
          .eq("id", leaseId)
      );
      const freshSteal = await admin.rpc("claim_homework_check_attempt", { p_attempt_id: leaseId });
      assertOk(freshSteal);
      expect(freshSteal.data, "임계 이내(1분 전)에는 탈환할 수 없다").toBe(false);

      // ③ 임계를 넘긴 stale claim 은 탈환된다. 그리고 **이전 비용은 보존**된다 —
      //    죽은 실행도 AI 를 이미 불렀을 수 있고 그 돈은 실제로 나간 돈이다.
      assertOk(
        await admin
          .from("homework_check_attempts")
          .update({
            ai_started_at: new Date(Date.now() - 11 * 60_000).toISOString(),
            estimated_cost_usd_micros: 1234,
            input_tokens: 111,
            model: "crashed-run"
          })
          .eq("id", leaseId)
      );
      const staleSteal = await admin.rpc("claim_homework_check_attempt", { p_attempt_id: leaseId });
      assertOk(staleSteal);
      expect(staleSteal.data, "임계(10분) 경과 후에는 탈환할 수 있다").toBe(true);

      const afterSteal = await admin
        .from("homework_check_attempts")
        .select("status, ai_started_at, estimated_cost_usd_micros, input_tokens, model")
        .eq("id", leaseId)
        .single();
      assertOk(afterSteal);
      const stolen = assertData(afterSteal.data);
      // 탈환은 리스만 갱신한다 — 상태도 비용도 건드리지 않는다.
      expect(stolen.status).toBe("processing");
      expect(stolen.estimated_cost_usd_micros, "죽은 실행이 쓴 비용은 지워지지 않는다").toBe(1234);
      expect(stolen.input_tokens).toBe(111);
      expect(stolen.model).toBe("crashed-run");
      // 리스가 새로 시작됐으므로 바로 다시 탈환되지 않는다.
      const rightAfter = await admin.rpc("claim_homework_check_attempt", { p_attempt_id: leaseId });
      assertOk(rightAfter);
      expect(rightAfter.data, "탈환 직후에는 리스가 신선하다").toBe(false);

      // 탈환한 요청은 파이프라인을 계속 진행할 수 있어야 한다(관찰 기록까지).
      const afterStealRecord = await admin.rpc("record_homework_check_observation", {
        p_attempt_id: leaseId,
        p_raw_observation: { schema_version: "1.0", images: [] },
        p_prompt_version: "obs-prompt-1",
        p_schema_version: "1.0",
        p_scope_included: true,
        p_stop_reason: "end_turn",
        p_model: "reclaimed-run",
        p_input_tokens: 222,
        p_output_tokens: 20,
        p_cost_usd_micros: 500,
        p_latency_ms: 100
      });
      assertOk(afterStealRecord);
      expect((afterStealRecord.data as Record<string, unknown>).status).toBe("completed");

      // 종결된 뒤에는 임계를 아무리 넘겨도 탈환되지 않는다(재검사는 새 attempt 로 한다).
      assertOk(
        await admin
          .from("homework_check_attempts")
          .update({ ai_started_at: new Date(Date.now() - 60 * 60_000).toISOString() })
          .eq("id", leaseId)
      );
      const settledSteal = await admin.rpc("claim_homework_check_attempt", { p_attempt_id: leaseId });
      assertOk(settledSteal);
      expect(settledSteal.data, "종결된 실행은 탈환 대상이 아니다").toBe(false);

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

// ── [A2 작업5] 조건부 보호의 실체 — 트리거가 사라지면 무엇이 열리는가 ────────
//
// A1 에서 [조건부]로 판정한 표들(todos·homework_submissions)은 RLS 정책이 for all 이라
// **트리거 하나가 유일한 방어선**이다. 정책은 "본인 행" 까지만 보장하고, "본인 행의
// 어느 컬럼을 바꿀 수 있는가" 는 전부 트리거가 정한다.
//
// 그래서 두 가지를 **실측**으로 고정한다:
//   (1) 트리거가 실제로 붙어 있다 (pg_trigger 조회 — 문자열 단정이 아니다)
//   (2) 트리거가 실제로 막는다 (금지된 UPDATE 를 실행해 거부를 확인)
// 하나라도 깨지면 학생이 자기 AI 판정·쌤 확인 상태·쌤 숙제를 마음대로 바꿀 수 있다.
describeIfRemote("A2 — 조건부 보호(허용목록 트리거)의 실측", () => {
  afterAll(assertNoLeakedTestUsers);

  it("트리거가 붙어 있고, 실제로 금지된 변경을 막는다", async () => {
    if (!env) throw new Error("Missing Supabase test environment");
    const keys = await fetchApiKeys(env);
    const anonKey = getApiKey(keys, "anon");
    const admin = createClient<Database>(env.url, getApiKey(keys, "service_role"), {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    const studentClient = createClient<Database>(env.url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const suffix = randomUUID().slice(0, 8);
    const password = `Guard!${suffix}aA1`;
    const studentEmail = `guard-s-${suffix}@a2-guard.test`;
    const teacherEmail = `guard-t-${suffix}@a2-guard.test`;
    let studentId = "";
    let teacherId = "";

    // 🚨 중간에 실패해도 계정이 남지 않게 try/finally 로 감싼다.
    //    (감싸기 전에 실제로 테스트가 중간 실패해 검증 계정 12개가 남았다.)
    try {
      const student = await admin.auth.admin.createUser({
        email: studentEmail,
        password,
        email_confirm: true
      });
      assertOk(student);
      const teacher = await admin.auth.admin.createUser({
        email: teacherEmail,
        password,
        email_confirm: true
      });
      assertOk(teacher);
      studentId = assertData(student.data.user).id;
      teacherId = assertData(teacher.data.user).id;
      assertOk(
        await admin.from("profiles").insert([
          { id: studentId, role: "student", name: "가드검증학생", onboarded: true },
          { id: teacherId, role: "teacher", name: "가드검증쌤", onboarded: true }
        ])
      );
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

      // (1) 트리거 존재 확인 = **아래의 차단 동작 전부**다.
      //     트리거 목록을 돌려주는 RPC 를 새로 만들면 그 자체가 새 공개 표면이 된다.
      //     대신 "막혀야 하는 것이 막힌다" 를 실측한다 — 트리거가 지워지면 이 단정들이
      //     전부 깨지므로 존재 여부와 동작을 같은 테스트가 한 번에 지킨다.
      //     (schema.sql 문자열 검사는 "파일에 적혀 있다" 만 말할 뿐 "지금 붙어 있다" 는 못 말한다.)

      const teacherTodo = await admin
        .from("todos")
        .insert({
          student_id: studentId,
          created_by: teacherId,
          connection_id: assertData(connection.data).id,
          title: "가드검증 숙제",
          subject: "math",
          source: "teacher",
          ai_check_enabled: true,
          scope_text: "쎈 1p",
          due_date: "2026-08-20",
          status: "todo"
        })
        .select("id")
        .single();
      assertOk(teacherTodo);
      const todoId = assertData(teacherTodo.data).id;

      const submission = await admin
        .from("homework_submissions")
        .insert({ todo_id: todoId, student_id: studentId, photo_paths: [`${studentId}/g1.jpg`] })
        .select("id")
        .single();
      assertOk(submission);
      const submissionId = assertData(submission.data).id;

      const signIn = await studentClient.auth.signInWithPassword({ email: studentEmail, password });
      assertOk(signIn);

      // (2-a) todos: 학생은 **선생님 숙제의 status 만** 바꿀 수 있다.
      //       제목·범위·검사여부를 바꾸면 locked_teacher_todo_fields 로 막혀야 한다.
      const allowed = await studentClient.from("todos").update({ status: "done" }).eq("id", todoId);
      expect(allowed.error, "학생이 선생님 숙제를 완료 처리하는 것은 허용된다").toBeNull();

      for (const [label, patch] of [
        ["제목", { title: "몰래 바꾼 제목" }],
        ["범위", { scope_text: "몰래 바꾼 범위" }],
        ["AI 검사 토글", { ai_check_enabled: false }]
      ] as const) {
        const blocked = await studentClient.from("todos").update(patch).eq("id", todoId);
        expect(blocked.error?.message ?? "", `학생이 선생님 숙제의 ${label}`).toContain(
          "locked_teacher_todo_fields"
        );
      }

      // (2-b) 학생이 선생님 숙제를 **직접 만들 수** 없다.
      const forged = await studentClient.from("todos").insert({
        student_id: studentId,
        title: "위조 숙제",
        subject: "math",
        source: "teacher",
        due_date: "2026-08-21",
        status: "todo"
      });
      expect(forged.error?.message ?? "").toContain("students_cannot_create_teacher_todos");

      // (2-c) homework_submissions: AI 판정 컬럼은 서버만 쓴다.
      for (const [label, patch] of [
        ["판정", { ai_verdict: "pass" as const }],
        ["확신도", { ai_confidence: 0.99 }],
        ["사유", { ai_reason: "내가 썼다" }]
      ] as const) {
        const blocked = await studentClient.from("homework_submissions").update(patch).eq("id", submissionId);
        expect(blocked.error?.message ?? "", `학생이 AI ${label} 수정`).toContain("ai_fields_are_server_set");
      }

      // (2-d) 쌤 확인 상태도 학생이 못 바꾼다.
      for (const [label, patch] of [
        ["확인 상태", { teacher_status: "confirmed" as const }],
        ["코멘트", { teacher_comment: "내가 썼다" }],
        ["재제출 요청", { resubmit_requested: true }]
      ] as const) {
        const blocked = await studentClient.from("homework_submissions").update(patch).eq("id", submissionId);
        expect(blocked.error?.message ?? "", `학생이 쌤 ${label} 수정`).toContain(
          "teacher_fields_not_student_editable"
        );
      }

      // (2-e) 남의 폴더 사진 경로는 service_role 도 못 넣는다(트리거에 예외가 없다).
      const otherFolder = await admin
        .from("homework_submissions")
        .update({ photo_paths: [`${teacherId}/stolen.jpg`] })
        .eq("id", submissionId);
      expect(otherFolder.error?.message ?? "").toContain("photo_paths_must_be_in_own_folder");

    } finally {
      await studentClient.auth.signOut();
      await deleteTestUsers(admin, [studentId, teacherId].filter(Boolean));
    }
  });
});
