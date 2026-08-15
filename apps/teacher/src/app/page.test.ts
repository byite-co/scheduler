import { describe, expect, it } from "vitest";

import { M1_ROUTE_MANIFEST, PRICE_PER_STUDENT_KRW, getTeacherMonthlySubscriptionAmount } from "@ssamplanner/shared";

describe("teacher dashboard math", () => {
  it("uses active connected students for the app subscription", () => {
    // 금액을 박아 두면 단가가 바뀔 때마다 여기서 깨진다(2026-08-10 인상 때 실제로 깨졌다).
    // 검사하려는 건 "학생 수 × 단가"라는 규칙이지 특정 금액이 아니다.
    expect(getTeacherMonthlySubscriptionAmount(4)).toBe(4 * PRICE_PER_STUDENT_KRW);
    expect(getTeacherMonthlySubscriptionAmount(4)).toBe(19600);
  });

  it("includes M1 teacher auth and connection routes", () => {
    expect(M1_ROUTE_MANIFEST.teacher).toEqual(
      expect.arrayContaining([
        "/login",
        "/signup",
        "/onboarding/profile",
        "/onboarding/first-student",
        "/students/invite",
        "/students/requests",
        "/students/demo/settings"
      ])
    );
  });
});
