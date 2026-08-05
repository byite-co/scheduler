import { describe, expect, it } from "vitest";

import {
  PEER_RANKING_MIN_COHORT,
  TODO_SCOPE_TEXT_MAX_LENGTH,
  calculateStudyStreak,
  canShowPeerRanking,
  canStudentEditTodoScopeText,
  canStudentToggleTodoAiCheck,
  countTodoScopeTextLength,
  getStudentHomeVariant,
  getStudentTodoRowAction,
  normalizeTodoScopeText,
  shouldShowConnectNudge,
  shouldShowPeerRanking,
  shouldShowTeacherHomework,
  sumStudySecondsForDate,
  validateTodoScopeText
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

// 이 규칙들은 DB(todos_scope_text_len 제약 + 정규화 트리거)와 같아야 한다.
// 갈라지면 앱이 통과시킨 값을 DB 가 거부해 날 오류가 사용자에게 그대로 보인다.
describe("M2 AI check scope text (todos.scope_text)", () => {
  it("normalizes blank input to null so '범위 없음' has one representation", () => {
    for (const blank of ["", "   ", "\t\n ", null, undefined]) {
      expect(normalizeTodoScopeText(blank)).toBeNull();
    }
  });

  it("trims surrounding whitespace but keeps the entered scope verbatim", () => {
    expect(normalizeTodoScopeText("  쎈 112~118p, 115p 제외  ")).toBe("쎈 112~118p, 115p 제외");
  });

  it("counts length excluding whitespace, matching the DB constraint", () => {
    expect(countTodoScopeTextLength("쎈 112~118p")).toBe("쎈112~118p".length);
    expect(countTodoScopeTextLength("가 ".repeat(10))).toBe(10);
  });

  it("accepts the limit and rejects one character past it", () => {
    expect(validateTodoScopeText("가".repeat(TODO_SCOPE_TEXT_MAX_LENGTH))).toBeUndefined();
    expect(validateTodoScopeText("가".repeat(TODO_SCOPE_TEXT_MAX_LENGTH + 1))).toBe("scope_text_too_long");
  });

  it("does not count whitespace toward the limit", () => {
    // 공백을 세면 이 값이 상한을 넘는다고 잘못 판단한다.
    expect(validateTodoScopeText("가 ".repeat(TODO_SCOPE_TEXT_MAX_LENGTH))).toBeUndefined();
  });

  it("treats blank input as valid — it simply means no scope", () => {
    expect(validateTodoScopeText("")).toBeUndefined();
    expect(validateTodoScopeText(null)).toBeUndefined();
  });

  it("lets students edit their own scope but not teacher-assigned scope", () => {
    expect(canStudentEditTodoScopeText({ source: "self" })).toBe(true);
    // 학생이 교사 숙제의 범위를 바꿀 수 있으면 검사 기준을 자기에게 유리하게 좁힐 수 있다.
    expect(canStudentEditTodoScopeText({ source: "teacher" })).toBe(false);
  });
});
