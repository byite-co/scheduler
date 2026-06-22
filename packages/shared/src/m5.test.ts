import { describe, expect, it } from "vitest";

import {
  aggregateWeeklyStudy,
  createPlannerTodosFromRecommendation,
  getFeatureGateState,
  getSharedReportStatusCopy,
  getStubReportDraft,
  getStubStudyRecommendation,
  isShareExpired
} from "./m5";

describe("M5 study recommendation stub", () => {
  it("recommends +2h over recent hours, clamped 2..15, deterministic", () => {
    const recs = getStubStudyRecommendation({
      recentMinutesBySubject: { math: 180, english: 0 },
      subjects: ["math", "english"]
    });
    expect(recs).toEqual([
      { subject: "math", recommendedHours: 5, reason: expect.stringContaining("최근 주 3시간") },
      { subject: "english", recommendedHours: 2, reason: expect.stringContaining("최근 주 0시간") }
    ]);
    expect(getStubStudyRecommendation({ recentMinutesBySubject: { math: 180 }, subjects: ["math"] })).toEqual(recs.slice(0, 1));
  });
});

describe("M5 weekly aggregate for report charts", () => {
  it("buckets minutes by day and subject within the week", () => {
    const weekStart = "2026-06-21"; // Sunday
    const aggregate = aggregateWeeklyStudy(
      [
        { subject: "math", duration_sec: 3600, started_at: "2026-06-21T10:00:00.000Z" },
        { subject: "math", duration_sec: 1800, started_at: "2026-06-22T10:00:00.000Z" },
        { subject: "english", duration_sec: 3600, started_at: "2026-06-22T12:00:00.000Z" },
        { subject: "math", duration_sec: 3600, started_at: "2026-07-01T12:00:00.000Z" } // out of week
      ],
      weekStart
    );
    expect(aggregate.totalMinutes).toBe(150);
    expect(aggregate.perDayMinutes).toEqual([60, 90, 0, 0, 0, 0, 0]);
    expect(aggregate.perSubjectMinutes).toEqual([
      { subject: "math", minutes: 90 },
      { subject: "english", minutes: 60 }
    ]);
  });
});

describe("M5 report draft stub", () => {
  it("summarizes hours and completion deterministically", () => {
    const draft = getStubReportDraft({ studentName: "지민", totalMinutes: 150, topSubject: "math", completionRate: 0.8 });
    expect(draft).toContain("2시간 30분");
    expect(draft).toContain("80%");
    expect(draft).toContain("수학");
  });
});

describe("M5 feature gating (free=ad unlock / premium=unlimited)", () => {
  it("premium is always unlocked", () => {
    expect(getFeatureGateState({ feature: "report", isPremium: true, unlocks: [] })).toMatchObject({
      unlocked: true,
      canUnlockByAd: false
    });
  });

  it("free user is locked until an active ad unlock exists", () => {
    const now = "2026-06-23T00:00:00.000Z";
    expect(getFeatureGateState({ feature: "ai_rec", isPremium: false, unlocks: [], now })).toMatchObject({
      unlocked: false,
      canUnlockByAd: true
    });
    expect(
      getFeatureGateState({
        feature: "ai_rec",
        isPremium: false,
        unlocks: [{ feature: "ai_rec", expires_at: "2026-06-24T00:00:00.000Z" }],
        now
      })
    ).toMatchObject({ unlocked: true, canUnlockByAd: false });
    expect(
      getFeatureGateState({
        feature: "ai_rec",
        isPremium: false,
        unlocks: [{ feature: "ai_rec", expires_at: "2026-06-22T00:00:00.000Z" }],
        now
      })
    ).toMatchObject({ unlocked: false });
  });
});

describe("M5 share link expiry + status copy", () => {
  it("treats past expiry as expired and null as never-expiring", () => {
    const now = "2026-06-23T00:00:00.000Z";
    expect(isShareExpired("2026-06-22T00:00:00.000Z", now)).toBe(true);
    expect(isShareExpired("2026-06-24T00:00:00.000Z", now)).toBe(false);
    expect(isShareExpired(null, now)).toBe(false);
  });

  it("maps shared report status to parent-facing copy", () => {
    expect(getSharedReportStatusCopy("expired").title).toContain("만료");
    expect(getSharedReportStatusCopy("not_found").title).toContain("찾을 수 없");
    expect(getSharedReportStatusCopy("ok").title).toBe("주간 리포트");
  });
});

describe("M5 plan reflection", () => {
  it("turns recommendations into self todos", () => {
    const todos = createPlannerTodosFromRecommendation(
      [{ subject: "math", recommendedHours: 5, reason: "x" }],
      "student-1",
      "2026-06-30"
    );
    expect(todos).toEqual([
      {
        student_id: "student-1",
        title: "수학 주 5시간 공부",
        subject: "math",
        source: "self",
        ai_check_enabled: false,
        due_date: "2026-06-30",
        created_by: "student-1"
      }
    ]);
  });
});
