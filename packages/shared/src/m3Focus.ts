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
