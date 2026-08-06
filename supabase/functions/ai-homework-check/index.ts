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

// 결정적 STUB 판정. 스냅샷의 사진 수만 본다.
//
// ⚠️ 예전에는 클라이언트가 보내는 markedLowEffort 플래그로 pass ↔ insufficient 를 뒤집었다.
//    그건 **클라이언트가 AI 판정을 정하는 경로**라서 제거했다. 판정 입력은 서버가 DB에서
//    읽은 것(스냅샷)만이어야 한다. 힌트로 저장만 하는 선택지도 있었지만, 쓰이지 않는 컬럼을
//    늘리는 대신 실연동에서 필요해지면 그때 설계하는 편이 낫다고 판단했다.
function getStubHomeworkVerdict(photoCount: number): StubResult {
  const count = Math.max(0, Math.floor(photoCount));
  if (count === 0) {
    return {
      verdict: "ambiguous",
      confidence: 0.4,
      reason: "제출된 사진이 없어 완료 여부를 확인하기 어려워요. (자동 점검 미리보기)"
    };
  }
  return {
    verdict: "pass",
    confidence: 0.86,
    reason: `사진 ${count}장에서 풀이 분량을 모두 채운 것으로 보여요. (자동 점검 미리보기)`
  };
}

const jsonHeaders = { "Content-Type": "application/json" } as const;

// 존재하지 않는 제출과 권한 없는 제출을 **같은 응답**으로 합친다. 구분해서 알려주면
// 남의 submission_id를 넣어 보며 다른 학생의 데이터 존재 여부를 알아낼 수 있다.
const NOT_FOUND = "submission_not_found" as const;

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers: jsonHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "missing_authorization" }), { status: 401, headers: jsonHeaders });
  }

  // 클라이언트에서 받는 것은 **ID와 idempotency 키뿐**이다. 범위·학생 ID·사진 경로는 절대
  // 받지 않는다 — 받으면 그게 곧 판정 기준을 클라이언트가 정하는 경로가 된다. 나머지는 전부
  // DB에서 직접 읽는다.
  let submissionId: string | undefined;
  let idempotencyKey: string | undefined;
  try {
    const body = await req.json();
    submissionId = body?.submissionId;
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

  const asUser = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });

  // 1) JWT 검증.
  const { data: userData } = await asUser.auth.getUser();
  const requestedBy = userData?.user?.id;
  if (!requestedBy) {
    return new Response(JSON.stringify({ error: "unauthenticated" }), { status: 401, headers: jsonHeaders });
  }

  // 2) 호출자 RLS로 제출 + 숙제를 함께 읽는다. RLS가 본인 것만 허용하므로 이 조회 자체가
  //    소유 검증이다.
  //
  // ⚠️ 남의 submission_id를 넣었을 때 "없음"과 "권한 없음"을 구분해서 알려주면 다른 학생의
  //    데이터 존재 여부가 드러난다. 그래서 두 경우를 **하나의 응답**으로 합친다(NOT_FOUND).
  const { data: submission, error: readError } = await asUser
    .from("homework_submissions")
    .select("id, student_id, photo_paths, todos!inner(id, source, ai_check_enabled, scope_text, connection_id)")
    .eq("id", submissionId)
    .maybeSingle();

  if (readError) {
    return new Response(JSON.stringify({ error: NOT_FOUND }), { status: 404, headers: jsonHeaders });
  }
  // 3) 학생 본인 소유 확인. RLS로도 걸러지지만 명시적으로 한 번 더 본다.
  if (!submission || submission.student_id !== requestedBy) {
    return new Response(JSON.stringify({ error: NOT_FOUND }), { status: 404, headers: jsonHeaders });
  }

  const todo = (Array.isArray(submission.todos) ? submission.todos[0] : submission.todos) as
    | { id: string; source: string; ai_check_enabled: boolean; scope_text: string | null; connection_id: string | null }
    | null
    | undefined;
  if (!todo) {
    return new Response(JSON.stringify({ error: NOT_FOUND }), { status: 404, headers: jsonHeaders });
  }

  // 4) AI 검사 대상인지. 범위가 없으면 AI가 무엇과 대조할지 알 수 없다.
  if (!todo.ai_check_enabled) {
    return new Response(JSON.stringify({ error: "ai_check_disabled" }), { status: 409, headers: jsonHeaders });
  }
  if (!todo.scope_text || todo.scope_text.trim().length === 0) {
    return new Response(JSON.stringify({ error: "scope_text_required" }), { status: 409, headers: jsonHeaders });
  }

  // 5) 과금 권한 분기 — 가격 구조상 가장 중요한 부분이다.
  //
  //    source='teacher' → 과외쌤이 이미 앱 구독료를 내고 있다. 학생 프리미엄을 요구하면
  //                       "쌤이 돈을 냈는데 그 학생이 검사를 못 받는" 상황이 된다.
  //                       active 연결이면 충분하다.
  //    source='self'    → 학생 본인의 프리미엄이 필요하다.
  if (todo.source === "teacher") {
    const { data: connection, error: connError } = await asUser
      .from("connections")
      .select("id")
      .eq("student_id", requestedBy)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();
    if (connError || !connection) {
      return new Response(JSON.stringify({ error: "connection_required" }), { status: 403, headers: jsonHeaders });
    }
  } else {
    // has_active_student_premium()은 auth.uid()만 본다 → 반드시 사용자 컨텍스트로 호출한다.
    // (service_role로 부르면 auth.uid()가 null이라 언제나 false다.)
    const { data: isPremium, error: premiumError } = await asUser.rpc("has_active_student_premium");
    if (premiumError) {
      return new Response(JSON.stringify({ error: "premium_check_failed" }), { status: 500, headers: jsonHeaders });
    }
    if (!isPremium) {
      // 작업 6의 UI가 이 코드를 보고 프리미엄 안내를 띄운다 — 명확히 구분해서 알려준다.
      return new Response(JSON.stringify({ error: "premium_required" }), { status: 402, headers: jsonHeaders });
    }
  }

  const asService = createClient(url, serviceKey, { auth: { persistSession: false } });

  // 6+7) 사용량 한도 확인과 슬롯 확보는 **한 트랜잭션 안에서** 일어난다(RPC 내부).
  //      따로 하면 동시 요청이 각각 "아직 한도 안 넘었다"를 보고 둘 다 통과할 수 있다.
  //      한도 초과로 거부되면 슬롯도 만들어지지 않는다(같은 트랜잭션이 롤백된다).
  const { data: attempt, error: startError } = await asService.rpc("start_homework_check_attempt", {
    p_submission_id: submissionId,
    p_requested_by: requestedBy,
    p_idempotency_key: effectiveIdempotencyKey
  });

  if (startError || !attempt) {
    // DB가 올린 예외를 사용자에게 의미 있는 코드로 옮긴다. detail(원문)은 흘리지 않는다 —
    // 원문에 다른 행의 정보가 섞일 수 있다.
    const message = startError?.message ?? "";
    const mapped: { error: string; status: number } = message.includes("check_already_in_progress")
      ? { error: "check_already_in_progress", status: 409 }
      : message.includes("check_limit_submission_exceeded")
        ? { error: "check_limit_submission_exceeded", status: 429 }
        : message.includes("check_limit_daily_exceeded")
          ? { error: "check_limit_daily_exceeded", status: 429 }
          : message.includes("ai_check_disabled_for_todo")
            ? { error: "ai_check_disabled", status: 409 }
            : message.includes("scope_text_required_for_check")
              ? { error: "scope_text_required", status: 409 }
              : message.includes("homework_submission_not_found")
                ? { error: NOT_FOUND, status: 404 }
                : { error: "attempt_start_failed", status: 500 };
    return new Response(JSON.stringify({ error: mapped.error }), { status: mapped.status, headers: jsonHeaders });
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
    result = getStubHomeworkVerdict(photoCount);
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
