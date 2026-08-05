import { describe, expect, it } from "vitest";

import {
  PEER_RANKING_MIN_COHORT,
  TODO_SCOPE_TEXT_ERROR_MESSAGES,
  TODO_SCOPE_TEXT_MAX_LENGTH,
  calculateStudyStreak,
  canShowPeerRanking,
  canStudentEditTodoScopeText,
  canStudentToggleTodoAiCheck,
  countTodoScopeTextLength,
  getStudentHomeVariant,
  getStudentTodoRowAction,
  getTodoScopeTextForDisplay,
  isTodoScopeTextRequired,
  normalizeTodoScopeText,
  shouldShowConnectNudge,
  shouldShowPeerRanking,
  shouldShowTeacherHomework,
  sumStudySecondsForDate,
  validateTodoScopeText,
  validateTodoScopeTextForSave
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

// AI 검사를 켜 놓고 범위를 비우면 AI 가 "무엇과" 대조할지 알 수 없다 → 필수.
describe("M2 scope text requirement (AI check on)", () => {
  it("requires scope only when the AI check is on", () => {
    expect(isTodoScopeTextRequired({ aiCheckEnabled: true })).toBe(true);
    expect(isTodoScopeTextRequired({ aiCheckEnabled: false })).toBe(false);
  });

  it("blocks an empty scope when the AI check is on", () => {
    for (const blank of ["", "   ", null, undefined]) {
      expect(validateTodoScopeTextForSave(blank, { aiCheckEnabled: true })).toBe("scope_text_required");
    }
  });

  it("allows an empty scope when the AI check is off", () => {
    expect(validateTodoScopeTextForSave("", { aiCheckEnabled: false })).toBeUndefined();
    expect(validateTodoScopeTextForSave(null, { aiCheckEnabled: false })).toBeUndefined();
  });

  it("still enforces the length limit regardless of the AI check", () => {
    const tooLong = "가".repeat(TODO_SCOPE_TEXT_MAX_LENGTH + 1);
    expect(validateTodoScopeTextForSave(tooLong, { aiCheckEnabled: true })).toBe("scope_text_too_long");
    expect(validateTodoScopeTextForSave(tooLong, { aiCheckEnabled: false })).toBe("scope_text_too_long");
  });

  it("accepts a filled scope with the AI check on", () => {
    expect(validateTodoScopeTextForSave("쎈 112~118p, 115p 제외", { aiCheckEnabled: true })).toBeUndefined();
  });

  it("has a message for every error so neither app invents its own wording", () => {
    for (const key of ["scope_text_required", "scope_text_too_long"] as const) {
      expect(TODO_SCOPE_TEXT_ERROR_MESSAGES[key]).toBeTruthy();
    }
  });
});

// scope_text 도입 전 숙제는 범위를 title 에 적었고, 마이그레이션은 ai_check_enabled 인 행만
// 복사했다 → AI 검사가 꺼진 옛 행은 scope_text 가 비어 있다. 빈칸을 보여주면 "범위가 사라졌다"가 된다.
describe("M2 scope text display fallback", () => {
  it("prefers scope_text when present", () => {
    expect(getTodoScopeTextForDisplay({ scope_text: "쎈 112~118p", title: "수학 숙제" })).toBe("쎈 112~118p");
  });

  it("falls back to title when scope_text is missing or blank", () => {
    expect(getTodoScopeTextForDisplay({ scope_text: null, title: "수학 p.116~118" })).toBe("수학 p.116~118");
    expect(getTodoScopeTextForDisplay({ scope_text: "   ", title: "수학 p.116~118" })).toBe("수학 p.116~118");
    expect(getTodoScopeTextForDisplay({ title: "수학 p.116~118" })).toBe("수학 p.116~118");
  });

  it("trims the stored scope so display matches what the DB normalized", () => {
    expect(getTodoScopeTextForDisplay({ scope_text: "  기출 21~30번  ", title: "무시됨" })).toBe("기출 21~30번");
  });
});
