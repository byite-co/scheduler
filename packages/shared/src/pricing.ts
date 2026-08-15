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

export function getTeacherMonthlySubscriptionAmount(
  activeConnectionCount: number
): number {
  if (!Number.isInteger(activeConnectionCount) || activeConnectionCount < 0) {
    throw new Error("activeConnectionCount must be a non-negative integer");
  }

  return activeConnectionCount * PRICE_PER_STUDENT_KRW;
}
