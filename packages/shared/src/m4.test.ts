import { describe, expect, it } from "vitest";

import {
  canRequestResubmit,
  createTeacherReviewPatch,
  getHomeworkConfidencePercent,
  HOMEWORK_PHOTO_MAX_BYTES,
  HOMEWORK_PHOTO_MAX_COUNT,
  HOMEWORK_CHECK_ERROR_MESSAGES,
  buildHomeworkPhotoPath,
  decodeBase64,
  getAiCheckEntitlement,
  getHomeworkAiDisplay,
  getHomeworkCheckErrorMessage,
  getHomeworkResultView,
  getStubHomeworkVerdict,
  summarizeReviewQueue,
  validateHomeworkPhotos,
  type HomeworkSubmissionLike
} from "./m4";
import { AI_CHECK_RESULTS_ENABLED, getAiCheckPausedStudentNotice } from "./featureFlags";

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
      { isTutored: true, aiResultsEnabled: true }
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
      { isTutored: false, aiResultsEnabled: true }
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
      { isTutored: false, aiResultsEnabled: true }
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

// 🚨 가격 구조. 과외쌤이 낸 숙제는 학생 프리미엄 없이도 검사돼야 한다 — 틀리면
// "쌤이 돈을 냈는데 그 학생이 검사를 못 받는" 상황이 된다. 실제 게이트는 서버이고
// 이 테스트는 그 규칙을 고정한다.
describe("M4 AI check entitlement (과금 분기)", () => {
  it("allows teacher homework without student premium when a connection is active", () => {
    expect(
      getAiCheckEntitlement({ todoSource: "teacher", hasActiveConnection: true, hasStudentPremium: false })
    ).toEqual({ allowed: true, via: "teacher_connection" });
  });

  it("blocks teacher homework when the connection is gone", () => {
    expect(
      getAiCheckEntitlement({ todoSource: "teacher", hasActiveConnection: false, hasStudentPremium: false })
    ).toEqual({ allowed: false, error: "connection_required" });
  });

  it("still allows teacher homework for a premium student (premium is simply not required)", () => {
    expect(
      getAiCheckEntitlement({ todoSource: "teacher", hasActiveConnection: true, hasStudentPremium: true })
    ).toEqual({ allowed: true, via: "teacher_connection" });
  });

  it("requires student premium for self todos", () => {
    expect(
      getAiCheckEntitlement({ todoSource: "self", hasActiveConnection: false, hasStudentPremium: false })
    ).toEqual({ allowed: false, error: "premium_required" });
    expect(
      getAiCheckEntitlement({ todoSource: "self", hasActiveConnection: true, hasStudentPremium: false })
    ).toEqual({ allowed: false, error: "premium_required" });
  });

  it("allows self todos for a premium student", () => {
    expect(
      getAiCheckEntitlement({ todoSource: "self", hasActiveConnection: false, hasStudentPremium: true })
    ).toEqual({ allowed: true, via: "student_premium" });
  });
});

// 사진 업로드 규칙 — 서버(버킷 제한 + subs_photo_count)와 같아야 한다.
describe("M4 homework photo upload rules", () => {
  const jpeg = { bytes: 1024, mimeType: "image/jpeg" };

  it("accepts 1~9 image photos", () => {
    expect(validateHomeworkPhotos([jpeg])).toBeUndefined();
    expect(validateHomeworkPhotos(Array.from({ length: HOMEWORK_PHOTO_MAX_COUNT }, () => jpeg))).toBeUndefined();
  });

  it("rejects 0 and 10+ photos", () => {
    expect(validateHomeworkPhotos([])).toBe("photo_count_out_of_range");
    expect(validateHomeworkPhotos(Array.from({ length: HOMEWORK_PHOTO_MAX_COUNT + 1 }, () => jpeg))).toBe(
      "photo_count_out_of_range"
    );
  });

  it("rejects non-image and disallowed image types", () => {
    // HEIC 는 비전 API 가 못 읽어 버킷도 받지 않는다 — 앱이 업로드 전에 JPEG 로 바꾼다.
    for (const mimeType of ["application/pdf", "image/heic", "text/plain", null, undefined]) {
      expect(validateHomeworkPhotos([{ bytes: 1024, mimeType }]), String(mimeType)).toBe("photo_mime_not_allowed");
    }
    for (const mimeType of ["image/jpeg", "image/png", "image/webp", "image/jpeg; charset=binary", "IMAGE/JPEG"]) {
      expect(validateHomeworkPhotos([{ bytes: 1024, mimeType }]), mimeType).toBeUndefined();
    }
  });

  it("rejects a photo over the size limit and accepts one at the limit", () => {
    expect(validateHomeworkPhotos([{ bytes: HOMEWORK_PHOTO_MAX_BYTES, mimeType: "image/jpeg" }])).toBeUndefined();
    expect(validateHomeworkPhotos([{ bytes: HOMEWORK_PHOTO_MAX_BYTES + 1, mimeType: "image/jpeg" }])).toBe(
      "photo_too_large"
    );
  });

  it("skips the size check when the size is unknown (the server still enforces it)", () => {
    expect(validateHomeworkPhotos([{ mimeType: "image/jpeg" }])).toBeUndefined();
  });

  // 첫 폴더가 학생 uid 여야 Storage 정책과 제출 가드를 통과한다.
  it("builds a path inside the student's own folder, split per submission", () => {
    const path = buildHomeworkPhotoPath({
      studentId: "stu-1",
      todoId: "todo-9",
      submissionKey: "1700000000000",
      index: 0
    });
    expect(path).toBe("stu-1/todo-9/1700000000000/page-1.jpg");
    expect(path.startsWith("stu-1/")).toBe(true);
    // 제출마다 폴더가 갈려야 재제출이 이전 사진을 덮어쓰지 않는다.
    const other = buildHomeworkPhotoPath({
      studentId: "stu-1",
      todoId: "todo-9",
      submissionKey: "1700000000001",
      index: 0
    });
    expect(other).not.toBe(path);
  });
});

// atob 은 React Native 에 있다는 보장이 없어 순수 구현을 쓴다 → 그 구현을 테스트로 고정한다.
describe("M4 base64 decode (upload bytes)", () => {
  const encode = (bytes: number[]) => Buffer.from(bytes).toString("base64");

  it("decodes bytes exactly, including padding cases", () => {
    for (const sample of [[0], [0, 255], [1, 2, 3], [1, 2, 3, 4], [1, 2, 3, 4, 5], [72, 101, 108, 108, 111]]) {
      expect(Array.from(decodeBase64(encode(sample))), sample.join(",")).toEqual(sample);
    }
  });

  it("matches Buffer for a JPEG-like byte run", () => {
    const bytes = Array.from({ length: 300 }, (_, i) => (i * 7) % 256);
    expect(Array.from(decodeBase64(encode(bytes)))).toEqual(bytes);
  });

  it("ignores whitespace and data-URI prefixes are the caller's job", () => {
    const b64 = encode([1, 2, 3]);
    expect(Array.from(decodeBase64(`${b64.slice(0, 2)}\n${b64.slice(2)}`))).toEqual([1, 2, 3]);
  });
});

// AI 는 조수다 — 검사가 실패해도 학생을 막지 않고 과외쌤 수동 검사로 넘어간다.
// 그래서 문구가 "실패"를 앞세우지 않고 다음 행동을 알려 주는지 확인한다.
describe("M4 homework check error messages", () => {
  it("has a message for every error code", () => {
    for (const [code, message] of Object.entries(HOMEWORK_CHECK_ERROR_MESSAGES)) {
      expect(message, code).toBeTruthy();
      expect(message.length, code).toBeGreaterThan(10);
    }
  });

  it("falls back to a safe message for unknown codes", () => {
    expect(getHomeworkCheckErrorMessage(null)).toBe(HOMEWORK_CHECK_ERROR_MESSAGES.unknown);
    expect(getHomeworkCheckErrorMessage("something_new_from_the_server")).toBe(
      HOMEWORK_CHECK_ERROR_MESSAGES.unknown
    );
  });

  it("tells the student their submission was kept when the server side failed", () => {
    // 서버 문제로 막힌 경우 학생이 할 수 있는 게 없다 → 제출이 남았다는 사실을 알려야 한다.
    for (const code of ["auth_failed", "upstream_error", "response_malformed", "unknown"] as const) {
      expect(HOMEWORK_CHECK_ERROR_MESSAGES[code], code).toContain("제출은 저장");
    }
  });

  it("gives an actionable next step when the student can fix it", () => {
    expect(HOMEWORK_CHECK_ERROR_MESSAGES.photos_missing).toContain("다시 올려");
    expect(HOMEWORK_CHECK_ERROR_MESSAGES.photo_too_large).toContain("작게");
    expect(HOMEWORK_CHECK_ERROR_MESSAGES.rate_limited).toContain("잠시 후");
  });
});

// ── AI 판정 노출 차단 플래그 ─────────────────────────────────────────────────
// 2026-08-07 실사진 측정에서 다 푼 페이지를 "3·4·5번 미작성" 으로 confidence 0.95 에
// 단정했다. 재설계 전까지 판정을 사용자에게 보여주지 않는다.
describe("M4 AI 판정 노출 차단(AI_CHECK_RESULTS_ENABLED)", () => {
  it("defaults to off — 켜는 것은 제품 결정이라 기본값이 안전한 쪽이어야 한다", () => {
    expect(AI_CHECK_RESULTS_ENABLED).toBe(false);
  });

  it("strips verdict, confidence and reason from the result view", () => {
    const view = getHomeworkResultView(
      submission({ ai_verdict: "insufficient", ai_confidence: 0.95, ai_reason: "3번, 4번, 5번이 미작성 상태입니다." }),
      { isTutored: true, aiResultsEnabled: false }
    );
    expect(view.aiResultsHidden).toBe(true);
    expect(view.verdict).toBeNull();
    expect(view.hasVerdict).toBe(false);
    expect(view.confidencePercent).toBeNull();
    expect(view.reason).toBeNull();
    expect(view.verdictTone).toBe("muted");
    // "검사 대기 중" 은 곧 결과가 온다는 뜻이라 여기서 쓰면 안 된다.
    expect(view.verdictLabel).not.toContain("검사");
  });

  it("keeps the teacher section and resubmit flow intact when hidden", () => {
    // 재제출 요청은 선생님의 판단이라 AI 와 무관하다 → 막으면 정상 흐름이 끊긴다.
    const view = getHomeworkResultView(
      submission({ teacher_status: "rejected", teacher_comment: "다시 풀어볼까요", resubmit_requested: true }),
      { isTutored: true, aiResultsEnabled: false }
    );
    expect(view.showTeacherSection).toBe(true);
    expect(view.teacherComment).toBe("다시 풀어볼까요");
    expect(view.teacherStatusLabel).toBe("다시 제출 요청");
    expect(view.canRequestResubmit).toBe(true);
  });

  it("distinguishes hidden from not-yet-checked", () => {
    const notChecked = getHomeworkResultView(
      submission({ ai_verdict: null, ai_confidence: null, ai_reason: null }),
      { isTutored: false, aiResultsEnabled: true }
    );
    expect(notChecked.aiResultsHidden).toBe(false);
    expect(notChecked.verdictLabel).toBe("검사 대기 중");
  });

  it("gives the teacher queue nothing to render when hidden", () => {
    const hidden = getHomeworkAiDisplay(
      { ai_verdict: "pass", ai_confidence: 0.95, ai_reason: "빈칸 없이 완성된 상태입니다." },
      { aiResultsEnabled: false }
    );
    expect(hidden.show).toBe(false);
    // show: false 면 판정 값이 객체에 **아예 없어야** 한다 — 있으면 컴포넌트가 실수로 쓸 수 있다.
    expect(Object.keys(hidden)).toEqual(["show"]);

    const shown = getHomeworkAiDisplay(
      { ai_verdict: "pass", ai_confidence: 0.95, ai_reason: "빈칸 없이 완성된 상태입니다." },
      { aiResultsEnabled: true }
    );
    expect(shown).toEqual({
      show: true,
      verdict: "pass",
      confidencePercent: 95,
      reason: "빈칸 없이 완성된 상태입니다."
    });
  });

  it("tells solo students something true — 선생님이 확인한다고 할 수 없다", () => {
    const tutored = getAiCheckPausedStudentNotice({ isTutored: true });
    const solo = getAiCheckPausedStudentNotice({ isTutored: false });
    expect(tutored).toContain("선생님");
    // 혼공생에게는 확인해 줄 선생님이 없다.
    expect(solo).not.toContain("선생님");
    for (const notice of [tutored, solo]) {
      expect(notice).toContain("제출");
      // "실패" 로 읽히면 학생이 다시 제출하려 한다.
      expect(notice).not.toContain("실패");
    }
  });
});
