// M6 — 수익화. ★ 두 모듈은 완전히 별개다:
//   (A) 앱 구독료: 과외쌤이 *우리에게* 내는 돈(Stripe). 월 = active 연결 수 × PRICE_PER_STUDENT_KRW.
//   (B) 수업·수업료: 학생이 *과외쌤에게* 내는 과외비. 결제 처리 아님 — 수기 트래커일 뿐.
// 가격은 pricing.ts 상수로만 계산한다(하드코딩 산재 금지).

import { PRICE_PER_STUDENT_KRW, getTeacherMonthlySubscriptionAmount } from "./pricing";

export type SubStatus = "none" | "active" | "past_due" | "canceled" | "paused";

export type BillingTone = "success" | "warning" | "danger" | "muted";

export type TeacherBillingState = {
  status: SubStatus;
  active: boolean;
  restricted: boolean; // 기능 제한 여부(미납/해지/일시정지/미구독)
  canRecover: boolean; // 결제수단 업데이트/재구독으로 복구 가능
  label: string;
  tone: BillingTone;
  reason: string;
};

export function getTeacherBillingState(status: SubStatus): TeacherBillingState {
  switch (status) {
    case "active":
      return { status, active: true, restricted: false, canRecover: false, label: "이용 중", tone: "success", reason: "정상 구독 중이에요." };
    case "past_due":
      return {
        status,
        active: false,
        restricted: true,
        canRecover: true,
        label: "미납",
        tone: "danger",
        reason: "결제에 실패했어요. 결제수단을 업데이트하면 바로 복구돼요."
      };
    case "paused":
      return { status, active: false, restricted: true, canRecover: true, label: "일시정지", tone: "warning", reason: "구독이 일시정지 상태예요." };
    case "canceled":
      return { status, active: false, restricted: true, canRecover: true, label: "해지됨", tone: "muted", reason: "구독이 해지되었어요. 다시 시작할 수 있어요." };
    default:
      // "앱 구독을 시작하면 학생 관리 기능이 열려요" 를 지웠다 — **어떤 서버 게이트도
      // teacher_subscriptions 를 보지 않는다**(A0 §3-15). 학생 관리는 구독과 무관하게
      // 열려 있어 저 문장은 허위였다. 중립적인 상태 표시만 남긴다.
      // (restricted 는 값을 유지한다 — 소비하는 화면이 있고, 문구 작업 범위를 넘는다.)
      return { status, active: false, restricted: true, canRecover: true, label: "구독 없음", tone: "muted", reason: "현재 구독 중이 아니에요." };
  }
}

export type InvoiceDraft = {
  period: string;
  student_count: number;
  amount: number;
  status: "open";
};

// 앱 구독료 인보이스 초안: 월 청구 = active 연결 수 × 단가.
export function buildInvoiceDraft(activeConnectionCount: number, period: string): InvoiceDraft {
  return {
    period,
    student_count: activeConnectionCount,
    amount: getTeacherMonthlySubscriptionAmount(activeConnectionCount),
    status: "open"
  };
}

export function formatKrw(amount: number): string {
  return `₩${amount.toLocaleString("ko-KR")}`;
}

export type StudentPremiumState = {
  isPremium: boolean;
  label: string;
};

export type StudentSubscriptionLike = {
  status: SubStatus;
  expires_at: string | null;
};

/**
 * 학생 프리미엄 "이용 권리" 판정 — DB 의 `has_active_student_premium()` 과 **같은 규칙**이다.
 *   `status = 'active' AND expires_at > now()`
 *
 * ⚠️ 실제 게이트는 서버(Edge Function + DB 함수)다. 이 함수는 **안내용**이다 — 클라이언트
 *    판정은 우회 가능하므로 이 결과로 과금 결정을 하면 안 된다. 화면 표시만 정한다.
 *
 * `expires_at IS NULL` 은 **권리 없음**으로 본다(fail-closed). DB 의 `expires_at > now()` 가
 * NULL 에 대해 false 인 것과 맞춘 것이다. 만료일을 모르는 구독을 무기한 프리미엄으로 다루면
 * 결제 버그가 곧 무료 이용이 된다.
 *
 * 상태 의미는 사업자 원본값이 아니라 "이용 권리"로 정규화한다:
 *   `active` → 권리 있음 / `past_due`·`paused`·`canceled`·`none` → 권리 없음.
 *   자동 갱신을 취소했지만 결제 기간이 남았으면 `status=active` 를 만료일까지 유지한다.
 */
export function hasActiveStudentPremium(
  subscription: StudentSubscriptionLike | null | undefined,
  now: string | Date = new Date()
): boolean {
  if (!subscription || subscription.status !== "active") return false;
  if (!subscription.expires_at) return false;
  const nowMs = (typeof now === "string" ? new Date(now) : now).getTime();
  const expiresMs = new Date(subscription.expires_at).getTime();
  return Number.isFinite(expiresMs) && expiresMs > nowMs;
}

export function getStudentPremiumState(
  status: SubStatus,
  expiresAt: string | null,
  now: string | Date = new Date()
): StudentPremiumState {
  const isPremium = hasActiveStudentPremium({ status, expires_at: expiresAt }, now);
  return { isPremium, label: isPremium ? "프리미엄" : "무료" };
}

// (B) 수업·수업료 = 수기 트래커. 결제 처리 아님(앱 구독료와 절대 섞지 않음).
export type LessonFeeLike = {
  amount: number;
  paid: boolean;
};

export type LessonFeeSummary = {
  totalAmount: number;
  paidAmount: number;
  unpaidAmount: number;
  unpaidCount: number;
};

export function summarizeLessonFees(fees: LessonFeeLike[]): LessonFeeSummary {
  return fees.reduce<LessonFeeSummary>(
    (acc, fee) => {
      const amount = Math.max(0, Math.round(fee.amount));
      acc.totalAmount += amount;
      if (fee.paid) acc.paidAmount += amount;
      else {
        acc.unpaidAmount += amount;
        acc.unpaidCount += 1;
      }
      return acc;
    },
    { totalAmount: 0, paidAmount: 0, unpaidAmount: 0, unpaidCount: 0 }
  );
}

// 단가 상수 재노출(화면에서 단일 출처로 사용).
export { PRICE_PER_STUDENT_KRW };
