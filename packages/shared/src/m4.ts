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
  /**
   * AI_CHECK_RESULTS_ENABLED 가 꺼져 판정을 **가린** 상태.
   * `hasVerdict === false` 와 구분해야 한다 — 그건 "아직 검사 안 됨"이고, 이건 "안 보여준다"다.
   * 화면은 이 값이 true 면 판정 UI 대신 안내를 띄운다.
   */
  aiResultsHidden: boolean;
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
//
// aiResultsEnabled 는 **필수 인자**다. 기본값을 주면 새로 생기는 호출부가 조용히 판정을
// 노출할 수 있다. 필수로 두면 빼먹었을 때 타입 오류가 나서 CI 가 잡는다(fail-safe).
// 값은 보통 shared 의 AI_CHECK_RESULTS_ENABLED 를 그대로 넘긴다 — 테스트만 직접 지정한다.
export function getHomeworkResultView(
  submission: HomeworkSubmissionLike,
  options: { isTutored: boolean; aiResultsEnabled: boolean }
): HomeworkResultView {
  const verdict = submission.ai_verdict;
  const hasVerdict = verdict !== null && verdict !== undefined;
  const showTeacherSection = options.isTutored;
  const aiResultsHidden = !options.aiResultsEnabled;

  // 판정을 가릴 때는 verdict·확신도·reason 을 **여기서** 비운다. 화면에서 각각 감추면
  // 표시 지점이 늘어날 때마다 빠뜨릴 수 있다 — 이 함수를 통과한 값은 항상 안전해야 한다.
  if (aiResultsHidden) {
    return {
      hasVerdict: false,
      verdict: null,
      // "검사 대기 중" 은 곧 결과가 온다는 뜻이라 여기서 쓰면 안 된다.
      verdictLabel: "제출 완료",
      verdictTone: "muted",
      confidencePercent: null,
      reason: null,
      showTeacherSection,
      teacherStatus: showTeacherSection ? submission.teacher_status : null,
      teacherStatusLabel: showTeacherSection
        ? HOMEWORK_REVIEW_STATUS_LABELS[submission.teacher_status]
        : null,
      teacherComment: showTeacherSection ? submission.teacher_comment : null,
      // 재제출 요청은 선생님의 판단이라 AI 와 무관하다 → 그대로 유지한다.
      canRequestResubmit: showTeacherSection && canRequestResubmit(submission),
      aiResultsHidden: true
    };
  }

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
    canRequestResubmit: showTeacherSection && canRequestResubmit(submission),
    aiResultsHidden: false
  };
}

/**
 * 과외쌤 검사 화면의 AI 칸. 목록은 `getHomeworkResultView` 를 쓰지 않으므로 별도 관문이 필요하다.
 *
 * `show: false` 면 판정·확신도·사유가 **애초에 담기지 않는다**. 컴포넌트가 조건문을
 * 빠뜨려도 노출될 값이 없다.
 */
export type HomeworkAiDisplay =
  | { show: true; verdict: HomeworkVerdict | null; confidencePercent: number | null; reason: string | null }
  | { show: false };

export function getHomeworkAiDisplay(
  submission: { ai_verdict: HomeworkVerdict | null; ai_confidence: number | null; ai_reason: string | null },
  options: { aiResultsEnabled: boolean }
): HomeworkAiDisplay {
  if (!options.aiResultsEnabled) return { show: false };
  return {
    show: true,
    verdict: submission.ai_verdict,
    confidencePercent: getHomeworkConfidencePercent(submission.ai_confidence),
    reason: submission.ai_reason
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

// ── 숙제 사진 업로드 ────────────────────────────────────────────────────────
// 규칙은 DB·버킷에도 걸려 있고(20260806060000), 아래 상수·함수는 같은 규칙을 앱에서 미리
// 적용해 저장 전에 안내하기 위한 것이다. 갈라지면 앱이 통과시킨 파일을 서버가 거부한다.

/** 한 제출의 사진 장수. `subs_photo_count` 제약과 같은 값이어야 한다. */
export const HOMEWORK_PHOTO_MIN_COUNT = 1;
export const HOMEWORK_PHOTO_MAX_COUNT = 9;

/**
 * 업로드 파일 하나의 최대 바이트. 버킷의 `file_size_limit` 과 같은 값이어야 한다.
 *
 * 5MB 근거: Claude 비전은 이미지를 긴 변 ~1568px 로 리사이즈해서 읽는다. 그보다 큰 원본을
 * 올려도 판독 품질이 좋아지지 않고 업로드·저장 비용만 늘어난다. 앱은 업로드 전에 줄여 보내므로
 * 실제 파일은 보통 1MB 미만이고, 5MB 는 "클라이언트를 우회한 요청까지 막는 상한"이다.
 */
export const HOMEWORK_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

/** 리사이즈 목표 긴 변(px). Claude 비전이 내부적으로 줄이는 크기에 맞춘다. */
export const HOMEWORK_PHOTO_MAX_LONG_EDGE = 1568;

/** 리사이즈 후 JPEG 품질. 텍스트(문제 번호·풀이) 판독에 충분하면서 용량을 줄인다. */
export const HOMEWORK_PHOTO_JPEG_QUALITY = 0.8;

/** 버킷 `allowed_mime_types` 와 같아야 한다. HEIC 는 비전 API 가 못 읽어 제외 — 앱이 JPEG 로 변환한다. */
export const HOMEWORK_PHOTO_ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type HomeworkPhotoError =
  | "photo_count_out_of_range"
  | "photo_too_large"
  | "photo_mime_not_allowed";

export const HOMEWORK_PHOTO_ERROR_MESSAGES: Record<HomeworkPhotoError, string> = {
  photo_count_out_of_range: `사진은 ${HOMEWORK_PHOTO_MIN_COUNT}~${HOMEWORK_PHOTO_MAX_COUNT}장까지 올릴 수 있어요.`,
  photo_too_large: `사진 한 장이 너무 커요. ${Math.round(HOMEWORK_PHOTO_MAX_BYTES / (1024 * 1024))}MB 아래로 줄여 주세요.`,
  photo_mime_not_allowed: "JPG · PNG · WEBP 사진만 올릴 수 있어요."
};

export type HomeworkPhotoLike = {
  /** 바이트 수. 알 수 없으면 undefined — 그 경우 용량 검사는 건너뛰고 서버가 막는다. */
  bytes?: number;
  mimeType?: string | null;
};

export function isAllowedHomeworkPhotoMime(mimeType: string | null | undefined): boolean {
  if (!mimeType) return false;
  const normalized = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  return (HOMEWORK_PHOTO_ALLOWED_MIME_TYPES as readonly string[]).includes(normalized);
}

/** 업로드 직전 검증. 서버(버킷 제한 + subs_photo_count)와 같은 규칙이다. */
export function validateHomeworkPhotos(photos: HomeworkPhotoLike[]): HomeworkPhotoError | undefined {
  if (photos.length < HOMEWORK_PHOTO_MIN_COUNT || photos.length > HOMEWORK_PHOTO_MAX_COUNT) {
    return "photo_count_out_of_range";
  }
  for (const photo of photos) {
    if (!isAllowedHomeworkPhotoMime(photo.mimeType)) return "photo_mime_not_allowed";
    if (typeof photo.bytes === "number" && photo.bytes > HOMEWORK_PHOTO_MAX_BYTES) return "photo_too_large";
  }
  return undefined;
}

/**
 * Storage 경로. 첫 폴더가 학생 uid 여야 한다 —
 * Storage 정책(`(storage.foldername(name))[1] = auth.uid()`)과
 * 제출 가드(`photo_paths_must_be_in_own_folder`)가 그 규칙을 강제한다.
 *
 * 재제출마다 폴더가 달라지도록 submissionKey 를 끼운다. 같은 경로에 덮어쓰면 이전 제출의
 * 사진이 사라져 그 제출의 AI 판정 근거가 없어진다(attempt 는 경로 스냅샷만 갖는다).
 */
export function buildHomeworkPhotoPath(input: {
  studentId: string;
  todoId: string;
  submissionKey: string;
  index: number;
}): string {
  return `${input.studentId}/${input.todoId}/${input.submissionKey}/page-${input.index + 1}.jpg`;
}

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * base64 → 바이트. Storage 업로드에 쓴다.
 *
 * `atob` 을 쓰지 않는 이유: React Native(Hermes)에 있다는 보장이 없어 플랫폼마다 갈린다.
 * 순수 구현이면 웹·기기에서 같게 동작하고 단위 테스트로 확인할 수 있다.
 */
export function decodeBase64(base64: string): Uint8Array {
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, "");
  const byteLength = Math.floor((clean.length * 3) / 4);
  const bytes = new Uint8Array(byteLength);
  let buffer = 0;
  let bits = 0;
  let out = 0;

  for (const char of clean) {
    const value = BASE64_ALPHABET.indexOf(char);
    if (value < 0) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[out++] = (buffer >> bits) & 0xff;
    }
  }
  return out === byteLength ? bytes : bytes.subarray(0, out);
}

/** 촬영 안내 — AI 정확도가 촬영 품질에 직결된다. 카탈로그 C4 에는 안내가 없어 새로 만들었다. */
export const HOMEWORK_PHOTO_TIPS = [
  "페이지 번호가 보이게 찍어요 — 범위를 맞춰 보는 기준이에요.",
  "한 페이지씩 한 장으로 찍어요.",
  "밝은 곳에서 똑바로, 그림자 없이 찍어요."
] as const;

// ── AI 검사 실패 코드 → 사용자 메시지 ───────────────────────────────────────
//
// 원칙: **실패해도 학생을 막지 않는다.** AI 는 조수이므로 못 봤으면 과외쌤 수동 검사로 넘어간다.
// 문구에 "실패"를 앞세우지 않고 다음 행동을 알려 준다.

/**
 * Anthropic 호출에서 나오는 코드. Edge Function 이 `attempt.error_code` 에 남긴다.
 * supabase/functions/ai-homework-check/anthropic.ts 의 `CheckErrorCode` 와 **같은 집합**이어야
 * 한다(Deno 는 이 패키지를 import 할 수 없어 쌍둥이 구현이고, 스키마 테스트가 대조한다).
 */
export const ANTHROPIC_CHECK_ERROR_CODES = [
  "photos_missing",
  "photo_download_failed",
  "photo_too_large",
  "auth_failed",
  "rate_limited",
  "upstream_timeout",
  "upstream_error",
  "response_malformed",
  "unknown"
] as const;

export type AnthropicCheckErrorCode = (typeof ANTHROPIC_CHECK_ERROR_CODES)[number];

/**
 * 서버가 **판정 전에** 거절할 때의 코드(과금 권한·사용량 한도·구조적 전제).
 * Anthropic 오류가 아니므로 위 집합과 섞지 않는다 — 섞으면 Deno 쪽 쌍둥이에 없는 코드를
 * 억지로 넣어야 한다.
 *
 * ⚠️ 이 문구들이 사용자에게 보이려면 Edge Function 응답에 `errorCode` 가 들어 있어야 한다.
 *    예전에는 게이트·한도 응답이 `{ error }` 만 담았고 클라이언트는 `errorCode` 를 읽어서,
 *    한도 초과가 **한 번도 제대로 표시되지 않았다**(전부 `unknown` 으로 떨어졌다).
 *    스키마 테스트가 그 회귀를 막는다.
 */
export const HOMEWORK_CHECK_GATE_ERROR_CODES = [
  "premium_required",
  "connection_required",
  "check_limit_submission_exceeded",
  "check_limit_daily_exceeded",
  "check_limit_monthly_exceeded",
  "check_limit_photos_monthly_exceeded",
  "check_already_in_progress",
  "ai_check_disabled",
  "scope_text_required",
  "submission_not_found"
] as const;

export type HomeworkCheckGateErrorCode = (typeof HOMEWORK_CHECK_GATE_ERROR_CODES)[number];

export type HomeworkCheckErrorCode = AnthropicCheckErrorCode | HomeworkCheckGateErrorCode;

/**
 * AI 검사 사용량 한도. **DB 가 최종 권위**다(ai_check_max_* 함수).
 * 여기 값은 안내 문구·테스트를 위한 사본이고, 스키마 테스트가 마이그레이션과 대조한다.
 */
export const AI_CHECK_LIMITS = {
  windowDays: 30,
  maxPerSubmission: 3,
  maxPerDay: 8,
  // 20260816000000 재산정: 70 → 40 / 280 → 100.
  // 결제액이 아니라 실수령액(부가세 10% + 스토어 15% / PG 3% 제외) 기준으로 다시 잡았고,
  // 관찰 프롬프트 + 4분할로 사진 1장 원가가 약 3.5배가 된 것을 반영했다.
  maxPerWindow: 40,
  maxPhotosPerWindow: 100
} as const;

/**
 * AI 검사 원가 모델(µ$). 한도 산정과 예산 테스트가 같은 숫자를 쓰게 한다.
 * 지금 **실제로 도는 것** = Haiku 4.5 + 관찰 프롬프트(2,892토큰) + 4분할·10% 겹침.
 * 사진 1장이 1,568px 조각 4장이 되므로 사진 항이 원가를 지배한다.
 *
 * (Gemini 무분할이면 장당 약 0.6원이라 같은 한도가 예산의 9% 밖에 안 된다.
 *  모델이 확정되면 이 상수를 바꾸고 한도를 되돌리면 된다 — 지금은 도는 쪽에 맞춘다.)
 */
export const AI_CHECK_COST_MODEL = {
  /** 프롬프트 + 출력 (입력 $1/Mtok · 출력 $5/Mtok) */
  perCallMicroUsd: 2892 + 130 * 5,
  /** 4조각 × 1,600토큰 */
  perPhotoMicroUsd: 4 * 1600,
  krwPerMicroUsd: 1370 / 1_000_000,
  /** 실측(15.2원/장)이 토큰 계산(13.6원)보다 높다 — 출력이 더 길었다. 그만큼 여유를 둔다. */
  measurementMargin: 1.15,
  /** 원가 예산은 실수령액의 30%. 두 결제 경로 중 **낮은 쪽**(과외쌤)에 맞춘다. */
  budgetShare: 0.3
} as const;

export const HOMEWORK_CHECK_ERROR_MESSAGES: Record<HomeworkCheckErrorCode, string> = {
  photos_missing: "올린 사진을 찾지 못했어요. 사진을 다시 올려 제출해 주세요.",
  photo_download_failed: "사진을 읽는 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.",
  photo_too_large: "사진 용량이 너무 커요. 조금 더 작게 찍어 다시 올려 주세요.",
  // 키 문제는 사용자가 할 수 있는 게 없다 — 서버 문제임을 알리고 수동 검사로 넘긴다.
  auth_failed: "확인 중 문제가 생겼어요. 제출은 저장됐고, 선생님이 직접 확인해 주실 거예요.",
  rate_limited: "지금 확인 요청이 많아요. 잠시 후 다시 시도해 주세요.",
  upstream_timeout: "확인이 오래 걸려 멈췄어요. 제출은 저장됐어요. 다시 시도하거나 결과를 기다려 주세요.",
  upstream_error: "확인 중 문제가 생겼어요. 제출은 저장됐고, 선생님이 직접 확인해 주실 거예요.",
  response_malformed: "확인 결과를 읽지 못했어요. 제출은 저장됐고, 선생님이 직접 확인해 주실 거예요.",
  unknown: "확인 중 문제가 생겼어요. 제출은 저장됐고, 선생님이 직접 확인해 주실 거예요.",

  // ── 과금 권한 ──
  premium_required: "혼자 만든 할 일의 AI 검사는 프리미엄에서 쓸 수 있어요. 제출은 저장됐어요.",
  connection_required: "선생님과 연결되면 AI 검사를 쓸 수 있어요. 제출은 저장됐어요.",

  // ── 사용량 한도 ── 왜 막혔는지·얼마가 상한인지·언제 다시 되는지를 함께 알려준다.
  // 숫자를 빼면 "모두 사용했어요"만 남아서 사용자가 뭘 얼마나 썼는지 알 수 없다.
  // 한도가 40회/100장으로 줄어 이전보다 자주 닿으므로 더더욱 숫자를 밝힌다.
  check_limit_submission_exceeded: `이 제출은 검사 횟수(${AI_CHECK_LIMITS.maxPerSubmission}회)를 모두 사용했어요. 사진을 다시 찍어 새로 제출하면 검사할 수 있어요.`,
  check_limit_daily_exceeded: `오늘 검사 횟수(${AI_CHECK_LIMITS.maxPerDay}회)를 모두 사용했어요. 내일 다시 시도해 주세요. 제출은 저장됐어요.`,
  check_limit_monthly_exceeded: `최근 ${AI_CHECK_LIMITS.windowDays}일 검사 횟수(${AI_CHECK_LIMITS.maxPerWindow}회)를 모두 사용했어요. 가장 먼저 쓴 검사가 ${AI_CHECK_LIMITS.windowDays}일을 지나면 다시 쓸 수 있어요. 제출은 저장됐고, 선생님이 직접 확인해 주실 거예요.`,
  check_limit_photos_monthly_exceeded: `최근 ${AI_CHECK_LIMITS.windowDays}일 검사 사진(${AI_CHECK_LIMITS.maxPhotosPerWindow}장)을 모두 사용했어요. 한 번에 올리는 사진을 줄이면 더 오래 쓸 수 있어요. 제출은 저장됐고, 선생님이 직접 확인해 주실 거예요.`,

  // ── 구조적 전제 ──
  check_already_in_progress: "이미 검사가 진행 중이에요. 잠시 후 결과를 확인해 주세요.",
  ai_check_disabled: "이 숙제는 AI 검사를 쓰지 않아요. 제출은 저장됐어요.",
  scope_text_required: "검사할 범위가 없어요. 선생님께 범위를 확인해 주세요. 제출은 저장됐어요.",
  submission_not_found: "제출을 찾지 못했어요. 다시 제출해 주세요."
};

/**
 * 숙제 사진 업로드 한도. **DB 가 최종 권위**다(homework_photo_quota_* 함수).
 * 누적 총량이 아니라 최근 `windowDays` 일 업로드량에 걸린다 — 누적으로 걸면 보관 정리가
 * 붙기 전에 정상 사용자가 막힌다.
 */
export const HOMEWORK_PHOTO_QUOTA = {
  windowDays: 30,
  maxObjects: 1000,
  maxBytes: 1073741824,
  retentionDays: 180
} as const;

export function getHomeworkCheckErrorMessage(code: string | null | undefined): string {
  if (code && code in HOMEWORK_CHECK_ERROR_MESSAGES) {
    return HOMEWORK_CHECK_ERROR_MESSAGES[code as HomeworkCheckErrorCode];
  }
  return HOMEWORK_CHECK_ERROR_MESSAGES.unknown;
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
