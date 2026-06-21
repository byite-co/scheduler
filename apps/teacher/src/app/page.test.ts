import { describe, expect, it } from "vitest";

import { getTeacherMonthlySubscriptionAmount } from "@ssamplanner/shared";

describe("teacher dashboard math", () => {
  it("uses active connected students for the app subscription", () => {
    expect(getTeacherMonthlySubscriptionAmount(4)).toBe(11600);
  });
});
