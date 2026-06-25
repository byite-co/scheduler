export type FocusAppState = "active" | "background" | "inactive" | "extension" | "unknown";

export type FocusCameraFallbackReason =
  | "permission_not_requested"
  | "permission_denied"
  | "unsupported_environment"
  | "background"
  | "model_unavailable";

export type FocusCameraDecision =
  | {
      fallbackReason: null;
      mode: "camera";
      shouldMountCamera: true;
    }
  | {
      fallbackReason: FocusCameraFallbackReason;
      mode: "timer_only";
      shouldMountCamera: false;
    };

export type FocusCameraDecisionInput = {
  appState: FocusAppState;
  canUseNativeCamera: boolean;
  deviceAvailable: boolean;
  hasPermission: boolean;
  canRequestPermission: boolean;
  detectionModelReady?: boolean;
};

export type FocusLandmarkPoint = {
  x: number;
  y: number;
  z?: number;
};

export type FocusFaceSignals = {
  facePresent: boolean;
  leftEyeBlinkScore: number | null;
  rightEyeBlinkScore: number | null;
  pitchDeg: number | null;
  yawDeg: number | null;
  rollDeg: number | null;
  // 하품 보조 신호(blendshape jawOpen). 선택값 — 없으면 졸음 판단에서 무시.
  jawOpenScore?: number | null;
};

export type FocusDrowsinessResult = {
  drowsy: boolean;
  reason: "eyes_closed" | "head_down" | "head_tilted" | "no_face" | "focused";
  confidence: number;
};

export type FocusSessionSummary = {
  checkTotal: number;
  drowsyCount: number;
  focusScore: number | null;
};

export type MediaPipeBlendshapeCategory = {
  categoryName: string;
  score: number;
};

export type MediaPipeFaceLandmarkerLikeResult = {
  faceBlendshapes?: Array<{ categories?: MediaPipeBlendshapeCategory[] }>;
  facialTransformationMatrixes?: Array<{ data?: ArrayLike<number> }>;
  faceLandmarks?: FocusLandmarkPoint[][];
};

export const FOCUS_CAMERA_PRIVACY_COPY = "영상은 기기를 떠나지 않아요";
export const FOCUS_CAMERA_TIMER_ONLY_COPY = "졸음 기능만 잠시 쉬고, 타이머는 계속 정상 동작해요.";

export const FOCUS_DROWSINESS_THRESHOLDS = {
  eyeBlinkScore: 0.62,
  pitchDownDeg: 22,
  rollDeg: 34,
  yawDeg: 38
} as const;

export function getFocusCameraDecision(input: FocusCameraDecisionInput): FocusCameraDecision {
  if (input.appState !== "active") {
    return timerOnly("background");
  }

  if (!input.canUseNativeCamera || !input.deviceAvailable) {
    return timerOnly("unsupported_environment");
  }

  if (!input.hasPermission) {
    return timerOnly(input.canRequestPermission ? "permission_not_requested" : "permission_denied");
  }

  if (input.detectionModelReady === false) {
    return timerOnly("model_unavailable");
  }

  return {
    fallbackReason: null,
    mode: "camera",
    shouldMountCamera: true
  };
}

export function getFocusCameraFallbackTitle(reason: FocusCameraFallbackReason): string {
  switch (reason) {
    case "permission_not_requested":
      return "카메라 권한이 필요해요";
    case "permission_denied":
      return "카메라 권한이 꺼져 있어요";
    case "background":
      return "앱이 앞에 있을 때만 카메라가 켜져요";
    case "model_unavailable":
      return "졸음 감지는 이 기기에서 잠시 쉴게요";
    case "unsupported_environment":
      return "이 환경에서는 카메라 프리뷰를 쓸 수 없어요";
  }
}

function timerOnly(fallbackReason: FocusCameraFallbackReason): FocusCameraDecision {
  return {
    fallbackReason,
    mode: "timer_only",
    shouldMountCamera: false
  };
}

export function getDrowsinessFromSignals(
  signals: FocusFaceSignals,
  thresholds = FOCUS_DROWSINESS_THRESHOLDS
): FocusDrowsinessResult {
  if (!signals.facePresent) {
    return { drowsy: false, reason: "no_face", confidence: 0.2 };
  }

  const blinkScores = [signals.leftEyeBlinkScore, signals.rightEyeBlinkScore].filter(
    (score): score is number => typeof score === "number" && Number.isFinite(score)
  );
  const averageBlinkScore = blinkScores.length
    ? blinkScores.reduce((total, score) => total + score, 0) / blinkScores.length
    : 0;

  if (averageBlinkScore >= thresholds.eyeBlinkScore) {
    return {
      drowsy: true,
      reason: "eyes_closed",
      confidence: clamp01(averageBlinkScore)
    };
  }

  if (typeof signals.pitchDeg === "number" && signals.pitchDeg >= thresholds.pitchDownDeg) {
    return {
      drowsy: true,
      reason: "head_down",
      confidence: clamp01(signals.pitchDeg / 45)
    };
  }

  const maxSideAngle = Math.max(Math.abs(signals.rollDeg ?? 0), Math.abs(signals.yawDeg ?? 0));
  if (
    (typeof signals.rollDeg === "number" && Math.abs(signals.rollDeg) >= thresholds.rollDeg) ||
    (typeof signals.yawDeg === "number" && Math.abs(signals.yawDeg) >= thresholds.yawDeg)
  ) {
    return {
      drowsy: true,
      reason: "head_tilted",
      confidence: clamp01(maxSideAngle / 50)
    };
  }

  return {
    drowsy: false,
    reason: "focused",
    confidence: clamp01(1 - averageBlinkScore)
  };
}

export function getFocusSummaryAfterCheck(
  current: FocusSessionSummary,
  drowsy: boolean
): FocusSessionSummary {
  const checkTotal = Math.max(0, current.checkTotal) + 1;
  const drowsyCount = Math.max(0, current.drowsyCount) + (drowsy ? 1 : 0);

  return {
    checkTotal,
    drowsyCount,
    focusScore: Math.round(((checkTotal - drowsyCount) / checkTotal) * 100)
  };
}

export function getFocusSummaryFromChecks(checks: Array<{ drowsy: boolean }>): FocusSessionSummary {
  const checkTotal = checks.length;
  const drowsyCount = checks.filter((check) => check.drowsy).length;

  return {
    checkTotal,
    drowsyCount,
    focusScore: checkTotal > 0 ? Math.round(((checkTotal - drowsyCount) / checkTotal) * 100) : null
  };
}

export function getSignalsFromMediaPipeFaceLandmarker(
  result: MediaPipeFaceLandmarkerLikeResult | null
): FocusFaceSignals {
  if (!result?.faceLandmarks?.length) {
    return {
      facePresent: false,
      leftEyeBlinkScore: null,
      rightEyeBlinkScore: null,
      pitchDeg: null,
      yawDeg: null,
      rollDeg: null
    };
  }

  const categories = result.faceBlendshapes?.[0]?.categories ?? [];
  const matrix = result.facialTransformationMatrixes?.[0]?.data;
  const rotation = matrix ? getEulerDegreesFromMatrix(matrix) : { pitchDeg: null, yawDeg: null, rollDeg: null };

  return {
    facePresent: true,
    leftEyeBlinkScore: findBlendshapeScore(categories, "eyeBlinkLeft"),
    rightEyeBlinkScore: findBlendshapeScore(categories, "eyeBlinkRight"),
    jawOpenScore: findBlendshapeScore(categories, "jawOpen"),
    ...rotation
  };
}

function findBlendshapeScore(categories: MediaPipeBlendshapeCategory[], name: string): number | null {
  const match = categories.find((category) => category.categoryName === name);
  return match ? match.score : null;
}

function getEulerDegreesFromMatrix(matrix: ArrayLike<number>) {
  if (matrix.length < 16) {
    return { pitchDeg: null, yawDeg: null, rollDeg: null };
  }

  const m00 = matrix[0] ?? 1;
  const m10 = matrix[4] ?? 0;
  const m11 = matrix[5] ?? 1;
  const m12 = matrix[6] ?? 0;
  const m20 = matrix[8] ?? 0;
  const m21 = matrix[9] ?? 0;
  const m22 = matrix[10] ?? 1;
  const sy = Math.sqrt(m00 * m00 + m10 * m10);
  const singular = sy < 0.000001;
  const pitch = singular ? Math.atan2(-m12, m11) : Math.atan2(m21, m22);
  const yaw = Math.atan2(-m20, sy);
  const roll = singular ? 0 : Math.atan2(m10, m00);

  return {
    pitchDeg: radiansToDegrees(pitch),
    yawDeg: radiansToDegrees(yaw),
    rollDeg: radiansToDegrees(roll)
  };
}

function radiansToDegrees(value: number): number {
  return Math.round((value * 180) / Math.PI);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

// ============================================================================
// 2단계: 졸음 판단(시간/개인화/디바운스 기반 순수 상태 리듀서)
// 1단계 신호(FocusFaceSignals)를 시간 순서로 받아 "지금 졸고 있는가"를 판단한다.
// 모든 임계값·시간은 아래 상수로 분리 — 나중에 조정이 쉽도록.
// ============================================================================

export const FOCUS_DROWSINESS_RULES = {
  // 규칙3: 개인 기준선 학습 구간(처음 N ms)과 최소 샘플 수.
  calibrationMs: 75_000,
  minCalibrationSamples: 15,
  // 규칙5: 권장 샘플 간격(웹 루프 throttle). 의심일 때 더 자주 본다(구조만).
  sampleIntervalMs: 100,
  intervalFocusedMs: 1_500,
  intervalSuspectMs: 600,
  // 규칙1: 정상 깜빡임 무시 / 지속 감김 졸음 신호 구분.
  blinkIgnoreMs: 400,
  eyesClosedMs: 1_000,
  // 규칙3: 개인 기준 눈뜸 대비 이 비율 미만이면 '감김'으로 본다.
  eyeCloseRatio: 0.55,
  // 규칙2,3: 개인 기준 pitch 대비 추가로 이만큼 숙이면 머리 숙임.
  headDownDeg: 12,
  headDownSustainMs: 1_200,
  // 규칙2: 하품(jawOpen) 보조 신호 임계.
  yawnScore: 0.5,
  // 종합 점수 임계.
  suspectScore: 0.5,
  drowsyScore: 0.8,
  // 규칙5: 연속 N회 같은 결과일 때만 상태 전환(깜빡임에 펄럭이지 않게).
  debounceSamples: 3,
  // 규칙4: 이 밝기(0~1) 미만이면 '측정 어려움'.
  brightnessFloor: 0.12
} as const;

// 임계값은 호출 측(테스트 등)에서 자유롭게 덮어쓸 수 있도록 number로 넓힌다.
export type FocusDrowsinessRules = { -readonly [K in keyof typeof FOCUS_DROWSINESS_RULES]: number };

export type FocusDrowsinessVerdict =
  | "calibrating"
  | "focused"
  | "suspect"
  | "drowsy"
  | "measuring_difficult";

export type FocusDrowsinessSample = {
  atMs: number;
  signals: FocusFaceSignals;
  // 0~1 밝기(선택). 없으면 밝기 기반 '측정 어려움' 판단은 생략하고 얼굴 유무만 본다.
  brightness?: number | null;
};

export type FocusDrowsinessState = {
  startedAtMs: number | null;
  // 규칙3: 기준선 학습 누적.
  calibCount: number;
  eyeOpenSum: number;
  pitchSum: number;
  baselineEyeOpen: number | null;
  baselinePitch: number | null;
  // 규칙1/2: 지속 시간 추적.
  eyesClosedSinceMs: number | null;
  headDownSinceMs: number | null;
  // 규칙5: 디바운스용 최근 원시 판정.
  recent: FocusDrowsinessVerdict[];
  // 외부에 노출되는 안정화된 결과 + 근거.
  verdict: FocusDrowsinessVerdict;
  score: number;
  reasons: string[];
  recommendedIntervalMs: number;
};

export function initFocusDrowsinessState(): FocusDrowsinessState {
  return {
    startedAtMs: null,
    calibCount: 0,
    eyeOpenSum: 0,
    pitchSum: 0,
    baselineEyeOpen: null,
    baselinePitch: null,
    eyesClosedSinceMs: null,
    headDownSinceMs: null,
    recent: [],
    verdict: "calibrating",
    score: 0,
    reasons: [],
    recommendedIntervalMs: FOCUS_DROWSINESS_RULES.sampleIntervalMs
  };
}

// 눈 감김 점수(0=뜸, 1=감음)에서 "눈 뜬 정도"(0~1, 클수록 뜸)를 만든다.
export function getEyeOpennessFromSignals(signals: FocusFaceSignals): number | null {
  const scores = [signals.leftEyeBlinkScore, signals.rightEyeBlinkScore].filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value)
  );
  if (!scores.length) return null;
  const avgBlink = scores.reduce((sum, value) => sum + value, 0) / scores.length;
  return clamp01(1 - avgBlink);
}

export function reduceFocusDrowsiness(
  state: FocusDrowsinessState,
  sample: FocusDrowsinessSample,
  rules: FocusDrowsinessRules = FOCUS_DROWSINESS_RULES
): FocusDrowsinessState {
  const startedAtMs = state.startedAtMs ?? sample.atMs;
  const elapsed = sample.atMs - startedAtMs;
  const next: FocusDrowsinessState = { ...state, startedAtMs };

  // 규칙4: 얼굴 미검출/너무 어두움 → 측정 어려움(졸음으로 오판 금지). 시간 누적 초기화.
  const tooDark = typeof sample.brightness === "number" && sample.brightness < rules.brightnessFloor;
  if (!sample.signals.facePresent || tooDark) {
    next.eyesClosedSinceMs = null;
    next.headDownSinceMs = null;
    next.recent = [];
    next.verdict = "measuring_difficult";
    next.score = 0;
    next.reasons = [!sample.signals.facePresent ? "얼굴이 보이지 않아요" : "주변이 너무 어두워요"];
    next.recommendedIntervalMs = rules.intervalFocusedMs;
    return next;
  }

  const openness = getEyeOpennessFromSignals(sample.signals);
  const pitch = typeof sample.signals.pitchDeg === "number" ? sample.signals.pitchDeg : null;

  // 규칙3: 기준선 학습 단계.
  const calibrating =
    elapsed < rules.calibrationMs || state.calibCount + 1 < rules.minCalibrationSamples;
  if (state.baselineEyeOpen === null) {
    if (openness !== null) {
      next.calibCount = state.calibCount + 1;
      next.eyeOpenSum = state.eyeOpenSum + openness;
      next.pitchSum = state.pitchSum + (pitch ?? 0);
    }
    if (!calibrating && next.calibCount >= rules.minCalibrationSamples) {
      next.baselineEyeOpen = next.eyeOpenSum / next.calibCount;
      next.baselinePitch = next.pitchSum / next.calibCount;
    } else {
      next.verdict = "calibrating";
      next.score = 0;
      next.reasons = ["평소 상태를 익히는 중이에요"];
      next.recommendedIntervalMs = rules.sampleIntervalMs;
      return next;
    }
  }

  const baselineEyeOpen = next.baselineEyeOpen ?? 0.8;
  const baselinePitch = next.baselinePitch ?? 0;

  // 규칙1: 개인 기준 대비 눈뜸이 비율 미만이면 '감김' 시작 시각 기록(짧으면 깜빡임으로 무시됨).
  const closing = openness !== null && openness <= baselineEyeOpen * rules.eyeCloseRatio;
  next.eyesClosedSinceMs = closing ? state.eyesClosedSinceMs ?? sample.atMs : null;

  // 규칙2,3: 개인 기준 pitch 대비 더 숙이면 머리 숙임(아래=양의 pitch, 기존 단일프레임 로직과 동일 방향).
  const headDown = pitch !== null && pitch - baselinePitch >= rules.headDownDeg;
  next.headDownSinceMs = headDown ? state.headDownSinceMs ?? sample.atMs : null;

  // 규칙2: 신호 합산 점수.
  const reasons: string[] = [];
  let eyeContribution = 0;
  if (next.eyesClosedSinceMs !== null) {
    const closedMs = sample.atMs - next.eyesClosedSinceMs;
    if (closedMs >= rules.eyesClosedMs) {
      eyeContribution = 0.6 + clamp01((closedMs - rules.eyesClosedMs) / 2_000) * 0.3;
      reasons.push("눈을 오래 감고 있어요");
    } else if (closedMs >= rules.blinkIgnoreMs) {
      eyeContribution = 0.25;
      reasons.push("눈이 길게 감겨요");
    }
    // closedMs < blinkIgnoreMs → 정상 깜빡임으로 무시(0).
  }

  let headContribution = 0;
  if (next.headDownSinceMs !== null) {
    const downMs = sample.atMs - next.headDownSinceMs;
    headContribution = downMs >= rules.headDownSustainMs ? 0.4 : 0.15;
    reasons.push("고개가 숙여졌어요");
  }

  const jawOpen = sample.signals.jawOpenScore;
  let yawnContribution = 0;
  if (typeof jawOpen === "number" && jawOpen >= rules.yawnScore) {
    yawnContribution = 0.2;
    reasons.push("하품 신호가 있어요");
  }

  const score = clamp01(eyeContribution + headContribution + yawnContribution);
  const raw: FocusDrowsinessVerdict =
    score >= rules.drowsyScore ? "drowsy" : score >= rules.suspectScore ? "suspect" : "focused";

  // 규칙5: 디바운스 — 최근 N회가 모두 같은 원시 판정일 때만 상태 전환.
  const recent = [...state.recent, raw].slice(-rules.debounceSamples);
  next.recent = recent;
  let verdict = state.verdict === "calibrating" || state.verdict === "measuring_difficult" ? "focused" : state.verdict;
  if (recent.length >= rules.debounceSamples && recent.every((value) => value === raw)) {
    verdict = raw;
  }

  next.verdict = verdict;
  next.score = score;
  next.reasons = reasons.length ? reasons : ["집중하고 있어요"];
  next.recommendedIntervalMs = verdict === "suspect" || verdict === "drowsy" ? rules.intervalSuspectMs : rules.intervalFocusedMs;
  return next;
}

export function getFocusDrowsinessLabel(verdict: FocusDrowsinessVerdict): string {
  switch (verdict) {
    case "calibrating":
      return "기준 학습 중";
    case "focused":
      return "집중 중";
    case "suspect":
      return "졸음 의심";
    case "drowsy":
      return "졸음";
    case "measuring_difficult":
      return "측정 어려움";
  }
}

// ============================================================================
// 3단계: 넛지(부드러운 인앱 안내) + 세션 기록 집계
// 넛지는 "졸음 확정"에서만, 쿨다운으로 도배 방지. 기록은 숫자/판정만(이미지 X).
// ============================================================================

export const FOCUS_NUDGE_RULES = {
  // 한 번 뜨면 이 시간 동안 다시 뜨지 않음(도배 방지).
  cooldownMs: 180_000,
  // 넛지 표시 유지 시간.
  visibleMs: 8_000,
  // 졸음 체크를 기록하는 주기(주기적 표본).
  checkIntervalMs: 10_000
} as const;

export const FOCUS_NUDGE_MESSAGES = [
  "잠깐 졸았나요? 가볍게 스트레칭 어때요?",
  "눈이 무거워 보여요. 30초만 일어나 볼까요?",
  "잠깐 창밖 한 번 보고 다시 가볍게 시작해요."
] as const;

export type FocusNudgeState = {
  lastShownAtMs: number | null;
  messageIndex: number;
};

export function initFocusNudgeState(): FocusNudgeState {
  return { lastShownAtMs: null, messageIndex: 0 };
}

// 졸음 확정 + 쿨다운 경과일 때만 넛지를 띄운다. 졸음의심(suspect)·그 외는 띄우지 않는다.
export function shouldShowFocusNudge(
  verdict: FocusDrowsinessVerdict,
  state: FocusNudgeState,
  nowMs: number,
  cooldownMs: number = FOCUS_NUDGE_RULES.cooldownMs
): boolean {
  if (verdict !== "drowsy") return false;
  if (state.lastShownAtMs !== null && nowMs - state.lastShownAtMs < cooldownMs) return false;
  return true;
}

export function getFocusNudgeMessage(
  state: FocusNudgeState,
  messages: readonly string[] = FOCUS_NUDGE_MESSAGES
): string {
  return messages[state.messageIndex % messages.length] ?? messages[0];
}

// 넛지를 띄운 뒤 상태 갱신(마지막 표시 시각 + 다음 메시지로 회전).
export function markFocusNudgeShown(
  state: FocusNudgeState,
  nowMs: number,
  messageCount: number = FOCUS_NUDGE_MESSAGES.length
): FocusNudgeState {
  return { lastShownAtMs: nowMs, messageIndex: (state.messageIndex + 1) % Math.max(1, messageCount) };
}

export type FocusCheckDecision = { record: boolean; drowsy: boolean };

// 주기적 체크: 측정 가능한 판정만 기록한다(기준학습/측정어려움 제외). 졸음 확정만 drowsy로 집계.
export function verdictToFocusCheck(verdict: FocusDrowsinessVerdict): FocusCheckDecision {
  if (verdict === "drowsy") return { record: true, drowsy: true };
  if (verdict === "focused" || verdict === "suspect") return { record: true, drowsy: false };
  return { record: false, drowsy: false };
}
