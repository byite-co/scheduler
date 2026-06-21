import { describe, expect, it } from "vitest";

import {
  PRICE_PER_STUDENT_KRW,
  PRICE_STUDENT_PREMIUM_KRW,
  getTeacherMonthlySubscriptionAmount
} from "./pricing";

describe("pricing constants", () => {
  it("uses the approved student and per-active-connection price", () => {
    expect(PRICE_STUDENT_PREMIUM_KRW).toBe(2900);
    expect(PRICE_PER_STUDENT_KRW).toBe(2900);
  });

  it("calculates teacher app subscription separately from lesson fees", () => {
    expect(getTeacherMonthlySubscriptionAmount(0)).toBe(0);
    expect(getTeacherMonthlySubscriptionAmount(3)).toBe(8700);
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
