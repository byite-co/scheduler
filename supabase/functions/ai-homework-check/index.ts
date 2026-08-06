// Edge Function: ai-homework-check
// 숙제 제출 사진 → AI 완료검사 → {verdict, confidence, reason}. 채점이 아니라 "다 했는지" 확인.
//
// Claude 비전 실연동(작업 5b-2). 서버 키는 Supabase 함수 시크릿(ANTHROPIC_API_KEY)에서만 읽는다.
// 판정 로직·프롬프트·요금 계산은 ./anthropic.ts 에 있다.
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
// 사진은 photo_paths_snapshot 을 service_role 로 내려받는다 — 그 과정이 "경로가 실제로
// 존재하는지" 검증도 겸한다(본인 폴더의 없는 파일을 가리키는 제출이 가능하다).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

import { CheckError, callAnthropicVision, type CheckErrorCode, type VisionResult } from "./anthropic.ts";

// 시크릿이 없을 때의 대비값. 실제 값은 함수 시크릿(ANTHROPIC_MODEL)에서 온다.
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const PHOTO_BUCKET = "homework-photos";

// packages/shared 의 AI_CHECK_RESULTS_ENABLED 와 **같은 값이어야 한다**.
// Deno 는 그 패키지를 import 할 수 없어 쌍둥이 상수이고, 스키마 테스트가 두 값을 대조한다
// (이 파일의 과금 분기와 shared 헬퍼를 대조하는 것과 같은 방식).
//
// 이건 2차 방어선이다. 플래그가 꺼져 있으면 학생 앱이 애초에 호출하지 않지만,
// 구버전 클라이언트·직접 호출은 여기서 막아야 비용이 0 이 된다.
const AI_CHECK_RESULTS_ENABLED = false;

// Anthropic 비전이 읽을 수 있는 형식만. 버킷 allowed_mime_types 와 같아야 한다.
const VISION_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000; // 한 번에 넘기는 인자 수 제한을 피한다
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * 스냅샷 경로의 사진을 내려받는다. **경로 존재 검증을 겸한다** — 다운로드가 실패하면
 * photos_missing 으로 끝내고, 없는 파일을 가리키는 제출로 AI 를 호출하지 않는다.
 */
async function downloadSnapshotImages(
  service: SupabaseClient,
  paths: string[]
): Promise<Array<{ mediaType: string; base64: string }>> {
  if (paths.length === 0) throw new CheckError("photos_missing", "스냅샷 경로가 비어 있다");

  const images: Array<{ mediaType: string; base64: string }> = [];
  for (const path of paths) {
    const { data, error } = await service.storage.from(PHOTO_BUCKET).download(path);
    if (error || !data) {
      // 객체가 없으면 여기서 걸린다(버킷 정책은 service_role 을 막지 않는다).
      throw new CheckError("photos_missing", `다운로드 실패: ${path}`);
    }
    const mediaType = VISION_MEDIA_TYPES.has(data.type) ? data.type : "image/jpeg";
    try {
      images.push({ mediaType, base64: toBase64(new Uint8Array(await data.arrayBuffer())) });
    } catch (error) {
      throw new CheckError("photo_download_failed", error instanceof Error ? error.message : String(error));
    }
  }
  return images;
}

const jsonHeaders = { "Content-Type": "application/json" } as const;

// 존재하지 않는 제출과 권한 없는 제출을 **같은 응답**으로 합친다. 구분해서 알려주면
// 남의 submission_id를 넣어 보며 다른 학생의 데이터 존재 여부를 알아낼 수 있다.
const NOT_FOUND = "submission_not_found" as const;

// 클라이언트(getHomeworkCheckErrorMessage)는 body.errorCode 로 안내 문구를 고른다.
// 예전에는 게이트·한도 응답이 { error } 만 담아 errorCode 가 항상 undefined 였고,
// 그 결과 "한도 초과"가 "확인 중 문제가 생겼어요"라는 일반 문구로 표시됐다.
// 두 필드를 함께 담아 그 구멍을 막는다(error 는 기존 호출부 호환용으로 유지).
function fail(code: string, status: number, extra?: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ error: code, errorCode: code, ...extra }), { status, headers: jsonHeaders });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return fail("method_not_allowed", 405);
  }

  // 판정을 보여주지 않는 동안은 **아무것도 하지 않는다.**
  // 여기서 끝내야 attempt 슬롯도, 사진 다운로드도, Anthropic 호출도 일어나지 않는다
  // (한도 카운터도 소모되지 않는다). 제출 자체는 클라이언트가 이미 저장했으므로 영향 없다.
  if (!AI_CHECK_RESULTS_ENABLED) {
    return new Response(JSON.stringify({ error: "ai_check_paused", errorCode: "ai_check_paused" }), {
      status: 503,
      headers: jsonHeaders
    });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return fail("missing_authorization", 401);
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
    return fail("invalid_body", 400);
  }
  if (!submissionId) {
    return fail("missing_submission_id", 400);
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
    return fail("unauthenticated", 401);
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
    return fail(NOT_FOUND, 404);
  }
  // 3) 학생 본인 소유 확인. RLS로도 걸러지지만 명시적으로 한 번 더 본다.
  if (!submission || submission.student_id !== requestedBy) {
    return fail(NOT_FOUND, 404);
  }

  const todo = (Array.isArray(submission.todos) ? submission.todos[0] : submission.todos) as
    | { id: string; source: string; ai_check_enabled: boolean; scope_text: string | null; connection_id: string | null }
    | null
    | undefined;
  if (!todo) {
    return fail(NOT_FOUND, 404);
  }

  // 4) AI 검사 대상인지. 범위가 없으면 AI가 무엇과 대조할지 알 수 없다.
  if (!todo.ai_check_enabled) {
    return fail("ai_check_disabled", 409);
  }
  if (!todo.scope_text || todo.scope_text.trim().length === 0) {
    return fail("scope_text_required", 409);
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
      return fail("connection_required", 403);
    }
  } else {
    // has_active_student_premium()은 auth.uid()만 본다 → 반드시 사용자 컨텍스트로 호출한다.
    // (service_role로 부르면 auth.uid()가 null이라 언제나 false다.)
    const { data: isPremium, error: premiumError } = await asUser.rpc("has_active_student_premium");
    if (premiumError) {
      return fail("premium_check_failed", 500);
    }
    if (!isPremium) {
      // 작업 6의 UI가 이 코드를 보고 프리미엄 안내를 띄운다 — 명확히 구분해서 알려준다.
      return fail("premium_required", 402);
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
    // DB 예외 → [클라이언트 코드, HTTP]. 한도는 429, 구조적 전제 위반은 409.
    // 표로 두는 이유: 한도가 4종(제출당·하루·30일 호출·30일 사진)이라 삼항 중첩으로는
    // 새 한도를 넣을 때 실수하기 쉽다.
    const DB_ERROR_MAP: Array<[needle: string, code: string, status: number]> = [
      ["check_already_in_progress", "check_already_in_progress", 409],
      ["check_limit_submission_exceeded", "check_limit_submission_exceeded", 429],
      ["check_limit_monthly_exceeded", "check_limit_monthly_exceeded", 429],
      ["check_limit_photos_monthly_exceeded", "check_limit_photos_monthly_exceeded", 429],
      ["check_limit_daily_exceeded", "check_limit_daily_exceeded", 429],
      ["ai_check_disabled_for_todo", "ai_check_disabled", 409],
      ["scope_text_required_for_check", "scope_text_required", 409],
      ["homework_submission_not_found", NOT_FOUND, 404]
    ];
    const hit = DB_ERROR_MAP.find(([needle]) => message.includes(needle));
    return hit ? fail(hit[1], hit[2]) : fail("attempt_start_failed", 500);
  }

  // 이미 끝난 실행을 재전송한 경우엔 그 결과를 그대로 돌려준다(다시 판정하지 않는다 = 중복 과금 없음).
  if (attempt.status === "completed" || attempt.status === "failed") {
    return new Response(JSON.stringify({ reused: true, attempt }), { status: 200, headers: jsonHeaders });
  }

  // 8) 판정. 라이브 값이 아니라 **스냅샷**을 본다 — 검사 시작 후 사진·범위가 바뀌어도
  //    판정 근거와 기록이 어긋나지 않아야 한다.
  const snapshotPaths: unknown = attempt.photo_paths_snapshot;
  const paths = Array.isArray(snapshotPaths) ? (snapshotPaths as string[]) : [];

  // 실패는 반드시 attempt 에 남기고 슬롯을 비운다. 남기지 않으면 processing 이 영원히 남아
  // 재시도가 check_already_in_progress 로 막힌다.
  const failAttempt = async (code: CheckErrorCode) => {
    await asService.rpc("fail_homework_check_attempt", { p_attempt_id: attempt.id, p_error_code: code });
  };

  let result: VisionResult;
  try {
    // 8-1) 사진을 service_role 로 내려받는다. photo_paths 가 실제로 존재하는지 확인하는
    //      단계이기도 하다 — 본인 폴더의 '없는 파일'을 가리키는 제출이 가능하기 때문이다.
    const images = await downloadSnapshotImages(asService, paths);

    // 8-2) Claude 비전 호출. 채점이 아니라 "다 했는지" 확인이다.
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) throw new CheckError("auth_failed", "ANTHROPIC_API_KEY 미설정");
    result = await callAnthropicVision({
      apiKey,
      model: Deno.env.get("ANTHROPIC_MODEL") ?? DEFAULT_MODEL,
      scopeText: typeof attempt.scope_text_snapshot === "string" ? attempt.scope_text_snapshot : null,
      images
    });
  } catch (error) {
    const code: CheckErrorCode = error instanceof CheckError ? error.code : "unknown";
    await failAttempt(code);
    // 앱은 이 코드로 안내 문구를 고르고, 과외쌤 수동 검사로 넘어간다. 원문은 흘리지 않는다.
    return new Response(JSON.stringify({ error: "check_failed", errorCode: code }), {
      status: code === "rate_limited" ? 429 : 502,
      headers: jsonHeaders
    });
  }

  // 9) 완료 기록 + homework_submissions.ai_* 캐시 갱신(구버전 앱 호환).
  const { data: completed, error: writeError } = await asService.rpc("complete_homework_check_attempt", {
    p_attempt_id: attempt.id,
    p_verdict: result.verdict,
    p_confidence: result.confidence,
    p_reason: result.reason,
    p_model: result.model,
    p_input_tokens: result.inputTokens,
    p_output_tokens: result.outputTokens,
    p_estimated_cost_usd_micros: result.estimatedCostUsdMicros
  });

  if (writeError) {
    await asService.rpc("fail_homework_check_attempt", {
      p_attempt_id: attempt.id,
      p_error_code: "attempt_complete_failed"
    });
    return fail("write_failed", 500, { detail: writeError.message });
  }

  return new Response(JSON.stringify({ stub: true, verdict: result, attempt: completed }), {
    status: 200,
    headers: jsonHeaders
  });
});
