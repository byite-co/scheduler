// Edge Function: billing-stripe (STUB — not yet deployed)
// Stripe 웹훅 수신 → teacher_subscriptions / billing_invoices 갱신, 미납(past_due) 처리.
//
// ⚠️ 실제 Stripe 키/서명 검증이 필요하므로 키 준비 전까지는 배포하지 않는다.
//    개발 중에는 mock_set_teacher_subscription RPC가 이 웹훅의 상태 전이를 대신한다.
//    월 청구 = active 연결 수 × price_per_student_krw() (generate_teacher_invoice).
//
// 실연동 시 할 일:
//  1) STRIPE_WEBHOOK_SECRET로 서명 검증.
//  2) event.type별로 service_role 클라이언트로 teacher_subscriptions.status 갱신
//     (active / past_due / canceled / paused).
//  3) invoice.paid / payment_failed → billing_invoices.status 갱신.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve(() => {
  return new Response(JSON.stringify({ stub: true, error: "billing-stripe not configured (no keys yet)" }), {
    status: 501,
    headers: { "Content-Type": "application/json" }
  });
});
