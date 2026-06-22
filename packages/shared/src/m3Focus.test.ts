import { describe, expect, it } from "vitest";

import {
  FOCUS_CAMERA_PRIVACY_COPY,
  getFocusCameraDecision,
  getFocusCameraFallbackTitle
} from "./m3Focus";

const readyInput = {
  appState: "active" as const,
  canUseNativeCamera: true,
  deviceAvailable: true,
  hasPermission: true,
  canRequestPermission: false
};

describe("M3 focus camera fallback", () => {
  it("mounts the preview only when the app is foregrounded, supported, and authorized", () => {
    expect(getFocusCameraDecision(readyInput)).toEqual({
      fallbackReason: null,
      mode: "camera",
      shouldMountCamera: true
    });
  });

  it("falls back to timer-only while backgrounded or inactive", () => {
    expect(getFocusCameraDecision({ ...readyInput, appState: "background" })).toMatchObject({
      fallbackReason: "background",
      mode: "timer_only",
      shouldMountCamera: false
    });
    expect(getFocusCameraDecision({ ...readyInput, appState: "inactive" })).toMatchObject({
      fallbackReason: "background",
      mode: "timer_only",
      shouldMountCamera: false
    });
  });

  it("does not expose ranking-style camera state when permission is denied or the environment is unsupported", () => {
    expect(
      getFocusCameraDecision({
        ...readyInput,
        hasPermission: false,
        canRequestPermission: false
      })
    ).toMatchObject({
      fallbackReason: "permission_denied",
      mode: "timer_only",
      shouldMountCamera: false
    });

    expect(getFocusCameraDecision({ ...readyInput, canUseNativeCamera: false })).toMatchObject({
      fallbackReason: "unsupported_environment",
      mode: "timer_only",
      shouldMountCamera: false
    });
  });

  it("keeps a timer-only path for future on-device model load failures", () => {
    expect(getFocusCameraDecision({ ...readyInput, detectionModelReady: false })).toEqual({
      fallbackReason: "model_unavailable",
      mode: "timer_only",
      shouldMountCamera: false
    });
  });

  it("keeps privacy copy explicit and separate from camera preview availability", () => {
    expect(FOCUS_CAMERA_PRIVACY_COPY).toBe("영상은 기기를 떠나지 않아요");
    expect(getFocusCameraFallbackTitle("permission_not_requested")).toBe("카메라 권한이 필요해요");
  });
});
