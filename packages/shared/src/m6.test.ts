import { describe, expect, it } from "vitest";

import {
  PRICE_PER_STUDENT_KRW,
  buildInvoiceDraft,
  formatKrw,
  getStudentPremiumState,
  getTeacherBillingState,
  summarizeLessonFees
} from "./m6";
import { getTeacherMonthlySubscriptionAmount } from "./pricing";

describe("M6 app subscription billing (active connections × price)", () => {
  it("invoice amount equals active count × single price constant", () => {
    expect(buildInvoiceDraft(3, "2026-06")).toEqual({
      period: "2026-06",
      student_count: 3,
      amount: 3 * PRICE_PER_STUDENT_KRW,
      status: "open"
    });
    expect(buildInvoiceDraft(3, "2026-06").amount).toBe(getTeacherMonthlySubscriptionAmount(3));
  });

  it("drops to a lower amount when a student disconnects (count decreases)", () => {
    expect(buildInvoiceDraft(2, "2026-07").amount).toBeLessThan(buildInvoiceDraft(3, "2026-07").amount);
    expect(buildInvoiceDraft(0, "2026-07").amount).toBe(0);
  });

  it("formats KRW", () => {
    expect(formatKrw(8700)).toBe("₩8,700");
  });
});

describe("M6 dunning / subscription state", () => {
  it("active is unrestricted; past_due restricts but can recover", () => {
    expect(getTeacherBillingState("active")).toMatchObject({ active: true, restricted: false });
    expect(getTeacherBillingState("past_due")).toMatchObject({ active: false, restricted: true, canRecover: true, tone: "danger" });
    expect(getTeacherBillingState("paused")).toMatchObject({ restricted: true, canRecover: true });
    expect(getTeacherBillingState("canceled")).toMatchObject({ restricted: true, canRecover: true });
    expect(getTeacherBillingState("none")).toMatchObject({ restricted: true });
  });
});

describe("M6 student premium gating state", () => {
  it("active + not expired = premium", () => {
    const now = "2026-06-23T00:00:00.000Z";
    expect(getStudentPremiumState("active", "2026-07-01T00:00:00.000Z", now).isPremium).toBe(true);
    expect(getStudentPremiumState("active", "2026-06-01T00:00:00.000Z", now).isPremium).toBe(false);
    expect(getStudentPremiumState("none", null, now).isPremium).toBe(false);
    expect(getStudentPremiumState("active", null, now).isPremium).toBe(true);
  });
});

describe("M6 lesson fees (manual tracker, NOT payment)", () => {
  it("summarizes paid/unpaid without processing money", () => {
    expect(
      summarizeLessonFees([
        { amount: 300000, paid: true },
        { amount: 300000, paid: false },
        { amount: 150000, paid: false }
      ])
    ).toEqual({ totalAmount: 750000, paidAmount: 300000, unpaidAmount: 450000, unpaidCount: 2 });
  });
});
