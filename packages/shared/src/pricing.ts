// 가격 상수 — **여기가 유일한 TS 출처다.**
//
// 같은 값이 DB 함수 price_per_student_krw() 에도 있고(서버가 청구 금액을 계산한다),
// m6.schema.test.ts 가 두 값을 대조한다. **한쪽만 바꾸면 CI 가 잡는다.**
//
// 2026-08-10 인상: 학생 2,900 → 8,900 / 과외쌤 학생당 2,900 → 4,900.
//   시장 조사(유사 서비스 콴다 프리미엄 월 18,500원)와 원가 분석에 따른 결정이다.
//   ⚠️ 수업료(학생 → 과외쌤)는 우리가 관여하지 않는다. 여기 값과 무관하다.
export const PRICE_STUDENT_PREMIUM_KRW = 8900;
export const PRICE_PER_STUDENT_KRW = 4900;

// ── 실수령액 ────────────────────────────────────────────────────────────────
//
// 결제액은 우리 돈이 아니다. 원가 예산을 결제액 기준으로 잡으면 실제로는 예산을 넘는다.
//   · 부가세 10% — 정부 몫. 소비자 표시가에 포함돼 있으므로 나눠서 뺀다.
//   · 앱스토어 수수료 15% — 학생 프리미엄은 모바일 인앱결제다(중소사업자 프로그램 기준).
//   · 웹 PG 수수료 3% — 과외쌤 구독은 웹 결제다.
// 스토어·PG 모두 부가세를 뺀 금액에 수수료를 매긴다.
export const VAT_RATE = 0.1;
export const APP_STORE_FEE_RATE = 0.15;
export const WEB_PG_FEE_RATE = 0.03;

function netOf(grossKrw: number, feeRate: number): number {
  return Math.round((grossKrw / (1 + VAT_RATE)) * (1 - feeRate));
}

/** 학생 프리미엄 1건의 월 실수령액. 8,900 → 부가세 제외 8,091 → 스토어 15% 제외 = 6,877원. */
export function getStudentPremiumNetKrw(): number {
  return netOf(PRICE_STUDENT_PREMIUM_KRW, APP_STORE_FEE_RATE);
}

/** 과외쌤 구독 학생 1인분의 월 실수령액. 4,900 → 부가세 제외 4,455 → PG 3% 제외 = 4,321원. */
export function getTeacherPerStudentNetKrw(): number {
  return netOf(PRICE_PER_STUDENT_KRW, WEB_PG_FEE_RATE);
}

export function getTeacherMonthlySubscriptionAmount(
  activeConnectionCount: number
): number {
  if (!Number.isInteger(activeConnectionCount) || activeConnectionCount < 0) {
    throw new Error("activeConnectionCount must be a non-negative integer");
  }

  return activeConnectionCount * PRICE_PER_STUDENT_KRW;
}
