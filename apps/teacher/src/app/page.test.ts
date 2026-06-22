import { describe, expect, it } from "vitest";

import { M1_ROUTE_MANIFEST, getTeacherMonthlySubscriptionAmount } from "@ssamplanner/shared";

describe("teacher dashboard math", () => {
  it("uses active connected students for the app subscription", () => {
    expect(getTeacherMonthlySubscriptionAmount(4)).toBe(11600);
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
