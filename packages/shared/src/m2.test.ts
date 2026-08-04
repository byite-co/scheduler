import { describe, expect, it } from "vitest";

import {
  PEER_RANKING_MIN_COHORT,
  calculateStudyStreak,
  canShowPeerRanking,
  canStudentToggleTodoAiCheck,
  getStudentHomeVariant,
  getStudentTodoRowAction,
  shouldShowConnectNudge,
  shouldShowPeerRanking,
  shouldShowTeacherHomework,
  sumStudySecondsForDate
} from "./m2";

describe("M2 student home branching", () => {
  it("uses active connections as the tutored branch", () => {
    const variant = getStudentHomeVariant({
      activeConnectionCount: 1,
      todoCount: 0,
      timetableBlockCount: 0,
      studySessionCount: 0
    });

    expect(variant).toBe("tutored");
    expect(shouldShowTeacherHomework(variant)).toBe(true);
    expect(shouldShowPeerRanking(variant)).toBe(false);
  });

  it("uses self-study when the student has data but no active connection", () => {
    const variant = getStudentHomeVariant({
      activeConnectionCount: 0,
      todoCount: 2,
      timetableBlockCount: 0,
      studySessionCount: 0
    });

    expect(variant).toBe("self_study");
    expect(shouldShowTeacherHomework(variant)).toBe(false);
    expect(shouldShowPeerRanking(variant)).toBe(true);
  });

  it("uses zero when there is no connection and no planner data", () => {
    expect(
      getStudentHomeVariant({
        activeConnectionCount: 0,
        todoCount: 0,
        timetableBlockCount: 0,
        studySessionCount: 0
      })
    ).toBe("zero");
  });

  it("shows the connect nudge purely by connection status, not by data presence", () => {
    // 연결 안 됨 → 데이터 유무와 무관하게 항상 노출(제로/혼공 모두).
    expect(shouldShowConnectNudge(0)).toBe(true);
    // 연결됨(과외생) → 숨김.
    expect(shouldShowConnectNudge(1)).toBe(false);
    expect(shouldShowConnectNudge(2)).toBe(false);
  });
});

describe("M2 todo AI-check lock", () => {
  it("lets students toggle AI checks only on their own unlocked todos", () => {
    expect(canStudentToggleTodoAiCheck({ source: "self", locked: false })).toBe(true);
    expect(canStudentToggleTodoAiCheck({ source: "self", locked: true })).toBe(false);
    expect(canStudentToggleTodoAiCheck({ source: "teacher", locked: true })).toBe(false);
  });
});

describe("M2 peer ranking privacy", () => {
  it("hides ranking aggregates until the minimum cohort is met", () => {
    expect(PEER_RANKING_MIN_COHORT).toBe(5);
    expect(
      canShowPeerRanking({
        peer_count: 2,
        min_cohort: PEER_RANKING_MIN_COHORT,
        can_show_peer_ranking: false,
        current_user_minutes: 80,
        peer_average_minutes: null,
        rank_percentile: null
      })
    ).toBe(false);
  });

  it("shows ranking only when the DB flag and aggregate fields are present", () => {
    expect(
      canShowPeerRanking({
        peer_count: 4,
        min_cohort: PEER_RANKING_MIN_COHORT,
        can_show_peer_ranking: true,
        current_user_minutes: 120,
        peer_average_minutes: 90,
        rank_percentile: 75
      })
    ).toBe(true);
  });
});

describe("M2 streak and study totals", () => {
  const sessions = [
    { started_at: "2026-06-18T10:00:00.000Z", duration_sec: 1800 },
    { started_at: "2026-06-19T10:00:00.000Z", duration_sec: 0 },
    { started_at: "2026-06-20T10:00:00.000Z", duration_sec: 2400 },
    { started_at: "2026-06-21T10:00:00.000Z", duration_sec: 3600 },
    { started_at: "2026-06-22T10:00:00.000Z", duration_sec: 1200 }
  ];

  it("sums only the requested day", () => {
    expect(sumStudySecondsForDate(sessions, "2026-06-22T23:59:59.000Z")).toBe(1200);
  });

  it("counts consecutive study days ending today", () => {
    expect(calculateStudyStreak(sessions, "2026-06-22T12:00:00.000Z")).toMatchObject({
      count: 3,
      studiedToday: true,
      missedToday: false,
      anchorDate: "2026-06-22"
    });
  });

  it("keeps a non-shaming recovery tone when today is missed", () => {
    const streak = calculateStudyStreak(sessions, "2026-06-23T12:00:00.000Z");

    expect(streak).toMatchObject({
      count: 3,
      studiedToday: false,
      missedToday: true,
      anchorDate: "2026-06-22"
    });
    expect(streak.message).toContain("가볍게");
    expect(streak.message).not.toContain("실패");
  });
});

describe("M2 todo row tap policy (homework entry)", () => {
  it("opens homework detail for teacher todos regardless of AI check", () => {
    expect(getStudentTodoRowAction({ source: "teacher" })).toBe("open_homework");
  });

  it("keeps self todos on toggle/edit only (no homework entry)", () => {
    expect(getStudentTodoRowAction({ source: "self" })).toBe("toggle_only");
  });
});
