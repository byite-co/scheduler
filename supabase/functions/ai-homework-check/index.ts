// Edge Function: ai-homework-check
// 숙제 제출 사진 → AI 완료검사 → {verdict, confidence, reason}. 채점이 아니라 "다 했는지" 확인.
//
// ⚠️ 현재는 STUB(고정/결정적 응답)다. Anthropic 키 없이 동작하며, 플로우 완성을 위한 미리보기다.
//    키 준비 후 `callAnthropicVision()`을 채워 실제 비전 호출로 교체한다(서버 키는 함수 env로만).
//
// 권한 모델(M4):
//  - 호출자는 본인 제출만 검사할 수 있다(JWT로 소유 검증, RLS로 강제).
//  - AI 판정 결과는 "서버 권위적"이라 service_role RPC를 통해서만 기록한다.
//    (학생/과외쌤은 ai_* 컬럼과 homework_check_attempts를 직접 못 쓴다 — RLS + 가드 트리거)
//
// 실행 레코드(20260806040000): homework_check_attempts가 원본이다. 세 단계로 기록한다.
//   1) start_homework_check_attempt    — 슬롯 확보 + 범위·사진 스냅샷 고정 + 중복 요청 차단
//   2) complete_homework_check_attempt — 판정 기록 + homework_submissions.ai_* 캐시 갱신
//   3) fail_homework_check_attempt     — 실패 기록(슬롯을 비워 재시도 가능하게)
// apply_homework_ai_verdict는 DEPRECATED다 — attempt 없이 ai_*만 덮어써서 이력이 남지 않는다.
//
// 작업 5(실연동)에서 바뀌는 곳은 getStubHomeworkVerdict() 호출과, complete에 넘기는
// model/input_tokens/output_tokens/estimated_cost_usd_micros 값뿐이다. 나머지 배선은 그대로 쓴다.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

type Verdict = "pass" | "insufficient" | "ambiguous";

type StubResult = { verdict: Verdict; confidence: number; reason: string };

// shared/m4.ts의 getStubHomeworkVerdict와 동일한 결정적 로직(런타임이 Deno라 인라인).
function getStubHomeworkVerdict(photoCount: number, markedLowEffort: boolean): StubResult {
  const count = Math.max(0, Math.floor(photoCount));
  if (count === 0) {
    return {
      verdict: "ambiguous",
      confidence: 0.4,
      reason: "제출된 사진이 없어 완료 여부를 확인하기 어려워요. (자동 점검 미리보기)"
    };
  }
  if (markedLowEffort) {
    return {
      verdict: "insufficient",
      confidence: 0.72,
      reason: "일부 분량이 빠진 것으로 보여요. 남은 부분을 채워 다시 제출해볼까요? (자동 점검 미리보기)"
    };
  }
  return {
    verdict: "pass",
    confidence: 0.86,
    reason: `사진 ${count}장에서 풀이 분량을 모두 채운 것으로 보여요. (자동 점검 미리보기)`
  };
}

const jsonHeaders = { "Content-Type": "application/json" } as const;

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers: jsonHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "missing_authorization" }), { status: 401, headers: jsonHeaders });
  }

  let submissionId: string | undefined;
  let markedLowEffort = false;
  let idempotencyKey: string | undefined;
  try {
    const body = await req.json();
    submissionId = body?.submissionId;
    markedLowEffort = Boolean(body?.markedLowEffort);
    idempotencyKey = typeof body?.idempotencyKey === "string" ? body.idempotencyKey.trim() : undefined;
  } catch {
    return new Response(JSON.stringify({ error: "invalid_body" }), { status: 400, headers: jsonHeaders });
  }
  if (!submissionId) {
    return new Response(JSON.stringify({ error: "missing_submission_id" }), { status: 400, headers: jsonHeaders });
  }
  // 키를 안 보내는 구버전 클라이언트도 중복 과금은 막아야 한다. 제출 ID로 결정적 키를 만들면
  // **같은 제출에 대한 네트워크 재시도**가 자동으로 같은 attempt 로 합쳐진다.
  // (랜덤 UUID 로 대체하면 재시도마다 새 실행이 생겨 실연동에서 중복 과금이 된다.)
  const effectiveIdempotencyKey = idempotencyKey && idempotencyKey.length > 0 ? idempotencyKey : `submission:${submissionId}`;

  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // 1) 호출자 권한으로 제출 소유 검증 + 사진 수 확인(RLS가 본인 것만 허용).
  const asUser = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: submission, error: readError } = await asUser
    .from("homework_submissions")
    .select("id, photo_paths")
    .eq("id", submissionId)
    .maybeSingle();

  if (readError) {
    return new Response(JSON.stringify({ error: "read_failed", detail: readError.message }), {
      status: 403,
      headers: jsonHeaders
    });
  }
  if (!submission) {
    return new Response(JSON.stringify({ error: "submission_not_found" }), { status: 404, headers: jsonHeaders });
  }

  const { data: userData } = await asUser.auth.getUser();
  const requestedBy = userData?.user?.id;
  if (!requestedBy) {
    return new Response(JSON.stringify({ error: "unauthenticated" }), { status: 401, headers: jsonHeaders });
  }

  const asService = createClient(url, serviceKey, { auth: { persistSession: false } });

  // 2) 실행 슬롯 확보 + 스냅샷 고정. 같은 요청 재전송이면 기존 attempt가 그대로 돌아온다.
  //    같은 제출에 이미 진행 중인 검사가 있으면 check_already_in_progress로 막힌다.
  const { data: attempt, error: startError } = await asService.rpc("start_homework_check_attempt", {
    p_submission_id: submissionId,
    p_requested_by: requestedBy,
    p_idempotency_key: effectiveIdempotencyKey
  });

  if (startError || !attempt) {
    const alreadyRunning = (startError?.message ?? "").includes("check_already_in_progress");
    return new Response(
      JSON.stringify({ error: alreadyRunning ? "check_already_in_progress" : "attempt_start_failed", detail: startError?.message }),
      { status: alreadyRunning ? 409 : 500, headers: jsonHeaders }
    );
  }

  // 이미 끝난 실행을 재전송한 경우엔 그 결과를 그대로 돌려준다(다시 판정하지 않는다 = 중복 과금 없음).
  if (attempt.status === "completed" || attempt.status === "failed") {
    return new Response(JSON.stringify({ stub: true, reused: true, attempt }), { status: 200, headers: jsonHeaders });
  }

  // 3) STUB 판정. 라이브 값이 아니라 **스냅샷**을 본다 — 검사 시작 후 사진이 바뀌어도
  //    판정 근거와 기록이 어긋나지 않아야 한다.
  //    (실연동 시: const result = await callAnthropicVision(attempt.photo_paths_snapshot, attempt.scope_text_snapshot);)
  const snapshotPaths: unknown = attempt.photo_paths_snapshot;
  const photoCount = Array.isArray(snapshotPaths) ? snapshotPaths.length : 0;

  let result: StubResult;
  try {
    result = getStubHomeworkVerdict(photoCount, markedLowEffort);
  } catch (error) {
    await asService.rpc("fail_homework_check_attempt", {
      p_attempt_id: attempt.id,
      p_error_code: "verdict_computation_failed"
    });
    return new Response(JSON.stringify({ error: "verdict_failed", detail: String(error) }), {
      status: 500,
      headers: jsonHeaders
    });
  }

  // 4) 완료 기록 + homework_submissions.ai_* 캐시 갱신(구버전 앱 호환).
  //    실연동에서는 model/토큰/비용을 실제 응답값으로 채운다 — 지금은 스텁이라 비용 0이다.
  const { data: completed, error: writeError } = await asService.rpc("complete_homework_check_attempt", {
    p_attempt_id: attempt.id,
    p_verdict: result.verdict,
    p_confidence: result.confidence,
    p_reason: result.reason,
    p_model: "stub-deterministic",
    p_input_tokens: 0,
    p_output_tokens: 0,
    p_estimated_cost_usd_micros: 0
  });

  if (writeError) {
    await asService.rpc("fail_homework_check_attempt", {
      p_attempt_id: attempt.id,
      p_error_code: "attempt_complete_failed"
    });
    return new Response(JSON.stringify({ error: "write_failed", detail: writeError.message }), {
      status: 500,
      headers: jsonHeaders
    });
  }

  return new Response(JSON.stringify({ stub: true, verdict: result, attempt: completed }), {
    status: 200,
    headers: jsonHeaders
  });
});
