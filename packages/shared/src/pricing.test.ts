import { describe, expect, it } from "vitest";

import {
  PRICE_PER_STUDENT_KRW,
  PRICE_STUDENT_PREMIUM_KRW,
  getTeacherMonthlySubscriptionAmount
} from "./pricing";

describe("pricing constants", () => {
  it("uses the approved student and per-active-connection price", () => {
    // 2026-08-10 인상. 값을 바꾸려면 DB 함수 price_per_student_krw() 도 함께 바꿔야 한다
    // (m6.schema.test.ts 가 두 값을 대조한다).
    expect(PRICE_STUDENT_PREMIUM_KRW).toBe(8900);
    expect(PRICE_PER_STUDENT_KRW).toBe(4900);
  });

  it("calculates teacher app subscription separately from lesson fees", () => {
    // 학생 수 × 단가. 여러 학생 수로 확인한다 — 상수만 바꾸고 계산이 어긋나면 여기서 잡힌다.
    expect(getTeacherMonthlySubscriptionAmount(0)).toBe(0);
    expect(getTeacherMonthlySubscriptionAmount(1)).toBe(4900);
    expect(getTeacherMonthlySubscriptionAmount(3)).toBe(14700);
    expect(getTeacherMonthlySubscriptionAmount(10)).toBe(49000);
  });

  it("rejects invalid active connection counts", () => {
    expect(() => getTeacherMonthlySubscriptionAmount(-1)).toThrow(
      "non-negative integer"
    );
    expect(() => getTeacherMonthlySubscriptionAmount(1.5)).toThrow(
      "non-negative integer"
    );
  });
});
