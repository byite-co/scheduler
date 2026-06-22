// Edge Function: iap-webhook (STUB — not yet deployed)
// RevenueCat/IAP 웹훅 → student_subscriptions 갱신(프리미엄 활성/만료).
//
// ⚠️ 실제 RevenueCat/스토어 키가 필요하므로 키 준비 전까지는 배포하지 않는다.
//    개발 중에는 mock_set_student_subscription RPC가 이 웹훅을 대신한다.
//
// 실연동 시 할 일:
//  1) RevenueCat 서명/공유 시크릿 검증.
//  2) service_role 클라이언트로 student_subscriptions.status / expires_at 갱신.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve(() => {
  return new Response(JSON.stringify({ stub: true, error: "iap-webhook not configured (no keys yet)" }), {
    status: 501,
    headers: { "Content-Type": "application/json" }
  });
});
