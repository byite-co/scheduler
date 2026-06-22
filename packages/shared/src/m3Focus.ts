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

export const FOCUS_CAMERA_PRIVACY_COPY = "영상은 기기를 떠나지 않아요";
export const FOCUS_CAMERA_TIMER_ONLY_COPY = "졸음 기능만 잠시 쉬고, 타이머는 계속 정상 동작해요.";

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
