// Edge Function: ai-homework-check
// 숙제 제출 사진 → AI 완료검사 → {verdict, confidence, reason}. 채점이 아니라 "다 했는지" 확인.
//
// ⚠️ 현재는 STUB(고정/결정적 응답)다. Anthropic 키 없이 동작하며, 플로우 완성을 위한 미리보기다.
//    키 준비 후 `callAnthropicVision()`을 채워 실제 비전 호출로 교체한다(서버 키는 함수 env로만).
//
// 권한 모델(M4):
//  - 호출자는 본인 제출만 검사할 수 있다(JWT로 소유 검증, RLS로 강제).
//  - AI 판정 결과는 "서버 권위적"이라 service_role로 apply_homework_ai_verdict RPC를 통해서만 기록한다.
//    (학생/과외쌤은 ai_* 컬럼을 직접 못 쓴다 — guard_homework_submission_fields 트리거)

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
  try {
    const body = await req.json();
    submissionId = body?.submissionId;
    markedLowEffort = Boolean(body?.markedLowEffort);
  } catch {
    return new Response(JSON.stringify({ error: "invalid_body" }), { status: 400, headers: jsonHeaders });
  }
  if (!submissionId) {
    return new Response(JSON.stringify({ error: "missing_submission_id" }), { status: 400, headers: jsonHeaders });
  }

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

  const photoCount = Array.isArray(submission.photo_paths) ? submission.photo_paths.length : 0;

  // 2) STUB 판정. (실연동 시: const result = await callAnthropicVision(submission.photo_paths);)
  const result = getStubHomeworkVerdict(photoCount, markedLowEffort);

  // 3) 서버 권위적 기록: service_role로 RPC 호출(ai_* 직접 쓰기는 트리거가 막음).
  const asService = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: updated, error: writeError } = await asService.rpc("apply_homework_ai_verdict", {
    p_submission_id: submissionId,
    p_verdict: result.verdict,
    p_confidence: result.confidence,
    p_reason: result.reason
  });

  if (writeError) {
    return new Response(JSON.stringify({ error: "write_failed", detail: writeError.message }), {
      status: 500,
      headers: jsonHeaders
    });
  }

  return new Response(JSON.stringify({ stub: true, verdict: result, submission: updated }), {
    status: 200,
    headers: jsonHeaders
  });
});
