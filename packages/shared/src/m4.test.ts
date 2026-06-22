import { describe, expect, it } from "vitest";

import {
  canRequestResubmit,
  createTeacherReviewPatch,
  getHomeworkConfidencePercent,
  getHomeworkResultView,
  getStubHomeworkVerdict,
  summarizeReviewQueue,
  type HomeworkSubmissionLike
} from "./m4";

function submission(overrides: Partial<HomeworkSubmissionLike> = {}): HomeworkSubmissionLike {
  return {
    ai_verdict: "pass",
    ai_confidence: 0.86,
    ai_reason: "사진 2장 확인",
    teacher_status: "pending",
    teacher_comment: null,
    resubmit_requested: false,
    ...overrides
  };
}

describe("M4 stub verdict (채점 아님, 완료 확인)", () => {
  it("returns ambiguous when no photos were submitted", () => {
    expect(getStubHomeworkVerdict({ photoCount: 0 })).toMatchObject({ verdict: "ambiguous" });
  });

  it("returns insufficient when explicitly marked low effort", () => {
    expect(getStubHomeworkVerdict({ photoCount: 2, markedLowEffort: true })).toMatchObject({
      verdict: "insufficient"
    });
  });

  it("returns pass for a normal submission and is deterministic", () => {
    const first = getStubHomeworkVerdict({ photoCount: 3 });
    const second = getStubHomeworkVerdict({ photoCount: 3 });
    expect(first).toEqual(second);
    expect(first.verdict).toBe("pass");
    expect(first.confidence).toBeGreaterThan(0.5);
  });
});

describe("M4 result view — tutored vs solo", () => {
  it("includes teacher section for tutored students", () => {
    const view = getHomeworkResultView(
      submission({ teacher_status: "rejected", teacher_comment: "다시 풀어볼까요", resubmit_requested: true }),
      { isTutored: true }
    );
    expect(view.showTeacherSection).toBe(true);
    expect(view.teacherStatusLabel).toBe("다시 제출 요청");
    expect(view.teacherComment).toBe("다시 풀어볼까요");
    expect(view.canRequestResubmit).toBe(true);
    expect(view.verdictLabel).toBe("통과");
  });

  it("hides any teacher mention for solo (혼공) students — AI only", () => {
    const view = getHomeworkResultView(
      submission({ teacher_status: "rejected", teacher_comment: "쌤 코멘트", resubmit_requested: true }),
      { isTutored: false }
    );
    expect(view.showTeacherSection).toBe(false);
    expect(view.teacherStatus).toBeNull();
    expect(view.teacherStatusLabel).toBeNull();
    expect(view.teacherComment).toBeNull();
    expect(view.canRequestResubmit).toBe(false);
  });

  it("represents the not-yet-checked state", () => {
    const view = getHomeworkResultView(
      submission({ ai_verdict: null, ai_confidence: null, ai_reason: null }),
      { isTutored: false }
    );
    expect(view.hasVerdict).toBe(false);
    expect(view.verdictLabel).toBe("검사 대기 중");
    expect(view.verdictTone).toBe("muted");
    expect(view.confidencePercent).toBeNull();
  });
});

describe("M4 teacher review patch + queue", () => {
  it("confirm clears resubmit, reject requests resubmit", () => {
    expect(createTeacherReviewPatch("confirm", "  좋아요  ")).toEqual({
      teacher_status: "confirmed",
      teacher_comment: "좋아요",
      resubmit_requested: false
    });
    expect(createTeacherReviewPatch("reject")).toEqual({
      teacher_status: "rejected",
      teacher_comment: null,
      resubmit_requested: true
    });
  });

  it("canRequestResubmit follows rejected/resubmit flags", () => {
    expect(canRequestResubmit(submission({ teacher_status: "confirmed" }))).toBe(false);
    expect(canRequestResubmit(submission({ teacher_status: "rejected" }))).toBe(true);
    expect(canRequestResubmit(submission({ resubmit_requested: true }))).toBe(true);
  });

  it("summarizes the review queue by verdict and pending", () => {
    expect(
      summarizeReviewQueue([
        { ai_verdict: "pass", teacher_status: "pending" },
        { ai_verdict: "insufficient", teacher_status: "rejected" },
        { ai_verdict: "ambiguous", teacher_status: "pending" },
        { ai_verdict: null, teacher_status: "pending" }
      ])
    ).toEqual({
      total: 4,
      awaitingTeacher: 3,
      pass: 1,
      insufficient: 1,
      ambiguous: 1,
      unchecked: 1
    });
  });

  it("formats confidence as a percent", () => {
    expect(getHomeworkConfidencePercent(0.864)).toBe(86);
    expect(getHomeworkConfidencePercent(null)).toBeNull();
    expect(getHomeworkConfidencePercent(2)).toBe(100);
  });
});
