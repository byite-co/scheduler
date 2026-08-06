// M4 — AI 완료검사(플래그십)의 순수 로직.
// "채점이 아니라 다 했는지 확인": 통과(pass)/미흡(insufficient)/애매(ambiguous) + 확신도 + 사유.
// 과외생은 선생님 코멘트 포함, 혼공생은 AI 단독(선생님 언급 없음).

export type HomeworkVerdict = "pass" | "insufficient" | "ambiguous";
export type HomeworkReviewStatus = "pending" | "confirmed" | "rejected";

export type HomeworkSubmissionLike = {
  ai_verdict: HomeworkVerdict | null;
  ai_confidence: number | null;
  ai_reason: string | null;
  teacher_status: HomeworkReviewStatus;
  teacher_comment: string | null;
  resubmit_requested: boolean;
  photo_paths?: string[] | null;
};

export type StubVerdictInput = {
  photoCount: number;
  markedLowEffort?: boolean;
};

export type StubVerdictResult = {
  verdict: HomeworkVerdict;
  confidence: number;
  reason: string;
};

export type HomeworkResultView = {
  hasVerdict: boolean;
  verdict: HomeworkVerdict | null;
  verdictLabel: string;
  verdictTone: HomeworkVerdictTone;
  confidencePercent: number | null;
  reason: string | null;
  // 과외생만 선생님 영역 노출. 혼공생은 AI 단독.
  showTeacherSection: boolean;
  teacherStatus: HomeworkReviewStatus | null;
  teacherStatusLabel: string | null;
  teacherComment: string | null;
  canRequestResubmit: boolean;
};

export type HomeworkVerdictTone = "success" | "warning" | "danger" | "muted";

export type TeacherReviewAction = "confirm" | "reject";

export const HOMEWORK_VERDICT_LABELS: Record<HomeworkVerdict, string> = {
  pass: "통과",
  insufficient: "미흡",
  ambiguous: "애매"
};

export const HOMEWORK_VERDICT_TONES: Record<HomeworkVerdict, HomeworkVerdictTone> = {
  pass: "success",
  insufficient: "danger",
  ambiguous: "warning"
};

export const HOMEWORK_REVIEW_STATUS_LABELS: Record<HomeworkReviewStatus, string> = {
  pending: "쌤 확인 전",
  confirmed: "쌤 확인 완료",
  rejected: "다시 제출 요청"
};

// AI 검사가 "채점"으로 읽히지 않도록 결과 카피에 항상 붙이는 안내.
export const HOMEWORK_CHECK_DISCLAIMER = "점수가 아니라 '다 했는지'를 확인했어요.";

// 키 준비 전까지 쓰는 결정적 스텁 판정(고정 응답). 프레임/사진 내용 분석 아님.
// 실연동 시 supabase Edge Function `ai-homework-check`(Anthropic 비전)로 교체한다.
export function getStubHomeworkVerdict(input: StubVerdictInput): StubVerdictResult {
  const photoCount = Math.max(0, Math.floor(input.photoCount));

  if (photoCount === 0) {
    return {
      verdict: "ambiguous",
      confidence: 0.4,
      reason: "제출된 사진이 없어 완료 여부를 확인하기 어려워요. (자동 점검 미리보기)"
    };
  }

  if (input.markedLowEffort) {
    return {
      verdict: "insufficient",
      confidence: 0.72,
      reason: "일부 분량이 빠진 것으로 보여요. 남은 부분을 채워 다시 제출해볼까요? (자동 점검 미리보기)"
    };
  }

  return {
    verdict: "pass",
    confidence: 0.86,
    reason: `사진 ${photoCount}장에서 풀이 분량을 모두 채운 것으로 보여요. (자동 점검 미리보기)`
  };
}

export function getHomeworkConfidencePercent(confidence: number | null): number | null {
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) return null;
  return Math.round(clamp01(confidence) * 100);
}

export function canRequestResubmit(submission: HomeworkSubmissionLike): boolean {
  return submission.teacher_status === "rejected" || submission.resubmit_requested;
}

// isTutored: 과외생(active 연결 보유) = true → 선생님 코멘트 포함.
// 혼공생 = false → AI 단독(선생님 언급 없음).
export function getHomeworkResultView(
  submission: HomeworkSubmissionLike,
  options: { isTutored: boolean }
): HomeworkResultView {
  const verdict = submission.ai_verdict;
  const hasVerdict = verdict !== null && verdict !== undefined;
  const showTeacherSection = options.isTutored;

  return {
    hasVerdict,
    verdict: verdict ?? null,
    verdictLabel: hasVerdict ? HOMEWORK_VERDICT_LABELS[verdict as HomeworkVerdict] : "검사 대기 중",
    verdictTone: hasVerdict ? HOMEWORK_VERDICT_TONES[verdict as HomeworkVerdict] : "muted",
    confidencePercent: getHomeworkConfidencePercent(submission.ai_confidence),
    reason: submission.ai_reason,
    showTeacherSection,
    teacherStatus: showTeacherSection ? submission.teacher_status : null,
    teacherStatusLabel: showTeacherSection
      ? HOMEWORK_REVIEW_STATUS_LABELS[submission.teacher_status]
      : null,
    teacherComment: showTeacherSection ? submission.teacher_comment : null,
    canRequestResubmit: showTeacherSection && canRequestResubmit(submission)
  };
}

// 과외쌤 검사 액션 → homework_submissions 패치(teacher_* 전용).
export function createTeacherReviewPatch(
  action: TeacherReviewAction,
  comment?: string | null
): {
  teacher_status: HomeworkReviewStatus;
  teacher_comment: string | null;
  resubmit_requested: boolean;
} {
  const trimmed = comment?.trim() ? comment.trim() : null;

  if (action === "reject") {
    return { teacher_status: "rejected", teacher_comment: trimmed, resubmit_requested: true };
  }

  return { teacher_status: "confirmed", teacher_comment: trimmed, resubmit_requested: false };
}

export type ReviewQueueItemLike = {
  ai_verdict: HomeworkVerdict | null;
  teacher_status: HomeworkReviewStatus;
};

export type ReviewQueueSummary = {
  total: number;
  awaitingTeacher: number;
  pass: number;
  insufficient: number;
  ambiguous: number;
  unchecked: number;
};

// 과외쌤 숙제 검사 큐 요약(통과/애매/미흡 카운트 + 확인 대기).
export function summarizeReviewQueue(items: ReviewQueueItemLike[]): ReviewQueueSummary {
  const summary: ReviewQueueSummary = {
    total: items.length,
    awaitingTeacher: 0,
    pass: 0,
    insufficient: 0,
    ambiguous: 0,
    unchecked: 0
  };

  for (const item of items) {
    if (item.teacher_status === "pending") summary.awaitingTeacher += 1;
    if (item.ai_verdict === "pass") summary.pass += 1;
    else if (item.ai_verdict === "insufficient") summary.insufficient += 1;
    else if (item.ai_verdict === "ambiguous") summary.ambiguous += 1;
    else summary.unchecked += 1;
  }

  return summary;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

// ── AI 검사 과금 권한 ────────────────────────────────────────────────────────
// 🚨 가격 구조의 핵심. 모든 AI 요청에 학생 프리미엄을 요구하면 안 된다.
//
//   source='teacher' → 과외쌤이 이미 앱 구독료를 내고 있다. 학생 프리미엄 **불필요**.
//                      active 연결이면 충분하다. 이걸 틀리면 "쌤이 돈을 냈는데 그 학생이
//                      검사를 못 받는" 상황이 된다.
//   source='self'    → 학생 본인의 프리미엄 **필요**.
//
// 실제 게이트는 Edge Function(서버)이다. 이 함수는 그 규칙을 **단위 테스트 가능한 형태로
// 고정**해 두기 위한 것이다 — Deno 런타임은 이 패키지를 import 할 수 없어 Edge Function 에
// 같은 분기가 인라인되어 있고, 두 곳이 갈라지지 않도록 스키마 테스트가 대조한다.
// (getStubHomeworkVerdict 도 같은 이유로 쌍둥이 구현을 유지한다.)
export type AiCheckEntitlementInput = {
  todoSource: "self" | "teacher";
  hasActiveConnection: boolean;
  hasStudentPremium: boolean;
};

export type AiCheckEntitlement =
  | { allowed: true; via: "teacher_connection" | "student_premium" }
  | { allowed: false; error: "connection_required" | "premium_required" };

export function getAiCheckEntitlement(input: AiCheckEntitlementInput): AiCheckEntitlement {
  if (input.todoSource === "teacher") {
    return input.hasActiveConnection
      ? { allowed: true, via: "teacher_connection" }
      : { allowed: false, error: "connection_required" };
  }
  return input.hasStudentPremium
    ? { allowed: true, via: "student_premium" }
    : { allowed: false, error: "premium_required" };
}
