import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type AppStateStatus,
  type StyleProp,
  type ViewStyle
} from "react-native";

import { colors, radii, spacing, typography } from "@ssamplanner/design-tokens";
import {
  FOCUS_DROWSINESS_THRESHOLDS,
  FOCUS_CAMERA_PRIVACY_COPY,
  FOCUS_CAMERA_TIMER_ONLY_COPY,
  getFocusCameraDecision,
  getFocusCameraFallbackTitle,
  type FocusDrowsinessResult,
  type FocusFaceSignals,
  type FocusAppState,
  type FocusCameraFallbackReason
} from "@ssamplanner/shared";
import { scheduleOnRN } from "react-native-worklets";
import type * as VisionCamera from "react-native-vision-camera";
import type { Frame } from "react-native-vision-camera";

type VisionCameraModule = Pick<
  typeof VisionCamera,
  "Camera" | "useCameraDevice" | "useCameraPermission" | "useFrameOutput"
>;

type FocusCameraProps = {
  active: boolean;
  onFocusCheck?: (check: FocusCheckEvent) => void;
  sessionId?: string;
  style?: StyleProp<ViewStyle>;
};

type PermissionGateProps = {
  style?: StyleProp<ViewStyle>;
};

export type FocusCheckEvent = FocusDrowsinessResult & {
  checkedAt: string;
};

type NativeMediaPipeFaceLandmarker = {
  isReady: () => boolean;
  scanFrame: (frame: Frame) => FocusFaceSignals | null;
};

const FOCUS_CHECK_INTERVAL_MS = 10_000;
const FOCUS_EYE_BLINK_SCORE = FOCUS_DROWSINESS_THRESHOLDS.eyeBlinkScore;
const FOCUS_PITCH_DOWN_DEG = FOCUS_DROWSINESS_THRESHOLDS.pitchDownDeg;
const FOCUS_ROLL_DEG = FOCUS_DROWSINESS_THRESHOLDS.rollDeg;
const FOCUS_YAW_DEG = FOCUS_DROWSINESS_THRESHOLDS.yawDeg;

declare global {
  // Installed by the custom native MediaPipe Face Landmarker module in dev-client builds.
  // The object accepts VisionCamera Frames inside the worklet and returns numeric signals only.
  var __SSAMPLANNER_MEDIAPIPE_FACE_LANDMARKER__: NativeMediaPipeFaceLandmarker | undefined;
  var __SSAMPLANNER_LAST_FOCUS_CHECK_MS__: number | undefined;
}

export function FocusCameraPanel({ active, onFocusCheck, sessionId, style }: FocusCameraProps) {
  const { cameraModule, nativeUnavailable } = useVisionCameraModule(active);

  if (!active) {
    return (
      <InfoCard
        style={style}
        title="집중 타이머가 멈춰 있어요"
        body="일시정지 중에는 카메라도 꺼져요. 다시 시작하면 권한과 기기 상태를 확인해요."
      />
    );
  }

  if (nativeUnavailable) {
    return <FallbackCard reason="unsupported_environment" style={style} />;
  }

  if (!cameraModule) {
    return <LoadingCard style={style} />;
  }

  return (
    <NativeVisionCameraPanel
      active={active}
      cameraModule={cameraModule}
      onFocusCheck={onFocusCheck}
      sessionId={sessionId}
      style={style}
    />
  );
}

export function FocusCameraPermissionGate({ style }: PermissionGateProps) {
  const { cameraModule, nativeUnavailable } = useVisionCameraModule(true);

  if (nativeUnavailable) {
    return <FallbackCard reason="unsupported_environment" style={style} />;
  }

  if (!cameraModule) {
    return <LoadingCard style={style} />;
  }

  return <NativePermissionGate cameraModule={cameraModule} style={style} />;
}

function NativeVisionCameraPanel({
  active,
  cameraModule,
  onFocusCheck,
  sessionId,
  style
}: FocusCameraProps & { cameraModule: VisionCameraModule }) {
  const [appState, setAppState] = useState<FocusAppState>(normalizeAppState(AppState.currentState));
  const [detectorReady, setDetectorReady] = useState(false);
  const [modelUnavailable, setModelUnavailable] = useState(false);
  const [latestCheck, setLatestCheck] = useState<FocusCheckEvent | null>(null);
  const device = cameraModule.useCameraDevice("front");
  const { canRequestPermission, hasPermission, requestPermission } = cameraModule.useCameraPermission();
  const detectionModelReady = !modelUnavailable && detectorReady;
  const decision = getFocusCameraDecision({
    appState,
    canRequestPermission,
    canUseNativeCamera: Platform.OS === "ios" || Platform.OS === "android",
    deviceAvailable: Boolean(device),
    hasPermission,
    detectionModelReady
  });
  const shouldMountPreview = active && decision.shouldMountCamera && Boolean(device);
  const CameraPreview = cameraModule.Camera;
  const frameOutput = cameraModule.useFrameOutput({
    pixelFormat: "yuv",
    targetResolution: { width: 320, height: 240 },
    dropFramesWhileBusy: true,
    onFrame(frame) {
      "worklet";
      const detector = globalThis.__SSAMPLANNER_MEDIAPIPE_FACE_LANDMARKER__;
      const nowMs = Date.now();
      const lastCheckAtMs = globalThis.__SSAMPLANNER_LAST_FOCUS_CHECK_MS__ ?? 0;

      if (!detector?.isReady()) {
        frame.dispose();
        scheduleOnRN(setModelUnavailable, true);
        return;
      }

      if (nowMs - lastCheckAtMs < FOCUS_CHECK_INTERVAL_MS) {
        frame.dispose();
        return;
      }

      globalThis.__SSAMPLANNER_LAST_FOCUS_CHECK_MS__ = nowMs;
      const signals = detector.scanFrame(frame);
      frame.dispose();

      if (!signals) {
        scheduleOnRN(setModelUnavailable, true);
        return;
      }

      const result = getDrowsinessFromSignalsOnWorklet(signals);
      scheduleOnRN(reportFocusCheck, result, new Date(nowMs).toISOString());
    }
  });

  function reportFocusCheck(result: FocusDrowsinessResult, checkedAt: string) {
    const check = { ...result, checkedAt };
    setLatestCheck(check);
    if (sessionId) {
      onFocusCheck?.(check);
    }
  }

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      setAppState(normalizeAppState(nextState));
    });

    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!active || modelUnavailable) {
      setDetectorReady(false);
      return;
    }

    setDetectorReady(isMediaPipeFaceLandmarkerReady());
    const intervalId = setInterval(() => {
      setDetectorReady(isMediaPipeFaceLandmarkerReady());
    }, 750);

    return () => clearInterval(intervalId);
  }, [active, modelUnavailable]);

  if (shouldMountPreview && device) {
    return (
      <View style={[styles.panel, styles.previewPanel, style]}>
        <View style={styles.previewFrame}>
          <CameraPreview
            device={device}
            isActive={true}
            outputs={[frameOutput]}
            resizeMode="cover"
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.previewBadge}>
            <View style={styles.liveDot} />
            <Text style={styles.previewBadgeText}>카메라 ON</Text>
          </View>
        </View>
        {latestCheck?.drowsy ? <DrowsyNudge reason={latestCheck.reason} /> : <FocusStatus latestCheck={latestCheck} />}
        <PrivacyNotice />
        <Text style={styles.helperText}>집중 세션 화면이 앞에 있을 때만 프리뷰가 켜져요.</Text>
      </View>
    );
  }

  return (
    <FallbackCard
      onRequestPermission={requestPermission}
      reason={decision.fallbackReason ?? "unsupported_environment"}
      style={style}
    />
  );
}

function isMediaPipeFaceLandmarkerReady(): boolean {
  try {
    return globalThis.__SSAMPLANNER_MEDIAPIPE_FACE_LANDMARKER__?.isReady() === true;
  } catch {
    return false;
  }
}

function getDrowsinessFromSignalsOnWorklet(signals: FocusFaceSignals): FocusDrowsinessResult {
  "worklet";

  if (!signals.facePresent) {
    return { drowsy: false, reason: "no_face", confidence: 0.2 };
  }

  const leftScore = signals.leftEyeBlinkScore;
  const rightScore = signals.rightEyeBlinkScore;
  const validLeft = typeof leftScore === "number" && Number.isFinite(leftScore);
  const validRight = typeof rightScore === "number" && Number.isFinite(rightScore);
  const blinkScoreCount = (validLeft ? 1 : 0) + (validRight ? 1 : 0);
  const averageBlinkScore = blinkScoreCount
    ? ((validLeft ? leftScore : 0) + (validRight ? rightScore : 0)) / blinkScoreCount
    : 0;

  if (averageBlinkScore >= FOCUS_EYE_BLINK_SCORE) {
    return {
      drowsy: true,
      reason: "eyes_closed",
      confidence: clamp01OnWorklet(averageBlinkScore)
    };
  }

  if (typeof signals.pitchDeg === "number" && signals.pitchDeg >= FOCUS_PITCH_DOWN_DEG) {
    return {
      drowsy: true,
      reason: "head_down",
      confidence: clamp01OnWorklet(signals.pitchDeg / 45)
    };
  }

  const rollDeg = signals.rollDeg ?? 0;
  const yawDeg = signals.yawDeg ?? 0;
  const maxSideAngle = Math.max(Math.abs(rollDeg), Math.abs(yawDeg));
  if (
    (typeof signals.rollDeg === "number" && Math.abs(signals.rollDeg) >= FOCUS_ROLL_DEG) ||
    (typeof signals.yawDeg === "number" && Math.abs(signals.yawDeg) >= FOCUS_YAW_DEG)
  ) {
    return {
      drowsy: true,
      reason: "head_tilted",
      confidence: clamp01OnWorklet(maxSideAngle / 50)
    };
  }

  return {
    drowsy: false,
    reason: "focused",
    confidence: clamp01OnWorklet(1 - averageBlinkScore)
  };
}

function clamp01OnWorklet(value: number): number {
  "worklet";

  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function DrowsyNudge({ reason }: { reason: FocusDrowsinessResult["reason"] }) {
  return (
    <View style={styles.nudgeCard}>
      <Text style={styles.nudgeTitle}>잠깐 숨 고르고 다시 가요</Text>
      <Text style={styles.nudgeBody}>
        {reason === "eyes_closed"
          ? "눈이 오래 감긴 신호가 잡혔어요. 물 한 모금 마시고 자세를 다시 잡아볼까요?"
          : "고개 각도가 흐트러진 신호가 잡혔어요. 화면을 보고 목을 편하게 세워요."}
      </Text>
    </View>
  );
}

function FocusStatus({ latestCheck }: { latestCheck: FocusCheckEvent | null }) {
  return (
    <View style={styles.statusCard}>
      <Text style={styles.statusTitle}>{latestCheck ? "방금 집중 신호를 확인했어요" : "집중 신호를 기다리고 있어요"}</Text>
      <Text style={styles.statusBody}>
        {latestCheck ? "졸음 신호가 없으면 조용히 타이머만 이어가요." : "첫 신호가 들어오면 숫자만 기록해요."}
      </Text>
    </View>
  );
}

function NativePermissionGate({
  cameraModule,
  style
}: PermissionGateProps & { cameraModule: VisionCameraModule }) {
  const { canRequestPermission, hasPermission, requestPermission } = cameraModule.useCameraPermission();

  if (hasPermission) {
    return (
      <InfoCard
        style={style}
        title="카메라 권한이 켜져 있어요"
        body="집중 세션 화면에서만 프리뷰가 켜지고, 앱이 뒤로 가면 바로 꺼져요."
      />
    );
  }

  return (
    <FallbackCard
      onRequestPermission={requestPermission}
      reason={canRequestPermission ? "permission_not_requested" : "permission_denied"}
      style={style}
    />
  );
}

function useVisionCameraModule(shouldLoad: boolean) {
  const [cameraModule, setCameraModule] = useState<VisionCameraModule | null>(null);
  const [nativeUnavailable, setNativeUnavailable] = useState(false);

  useEffect(() => {
    if (!shouldLoad || cameraModule || nativeUnavailable) return;

    let cancelled = false;
    void import("react-native-vision-camera")
      .then((loadedModule) => {
        if (!cancelled) {
          setCameraModule(loadedModule);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setNativeUnavailable(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [cameraModule, nativeUnavailable, shouldLoad]);

  return { cameraModule, nativeUnavailable };
}

function FallbackCard({
  onRequestPermission,
  reason,
  style
}: {
  onRequestPermission?: () => Promise<boolean>;
  reason: FocusCameraFallbackReason;
  style?: StyleProp<ViewStyle>;
}) {
  const isPermissionRequest = reason === "permission_not_requested";
  const isPermissionDenied = reason === "permission_denied";

  return (
    <View style={[styles.panel, style]}>
      <View style={styles.panelTop}>
        <View style={styles.iconBox}>
          <Text style={styles.iconText}>⌁</Text>
        </View>
        <View style={styles.titleWrap}>
          <Text style={styles.panelTitle}>{getFocusCameraFallbackTitle(reason)}</Text>
          <Text style={styles.panelBody}>{FOCUS_CAMERA_TIMER_ONLY_COPY}</Text>
        </View>
      </View>
      <PrivacyNotice />
      {isPermissionRequest ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => void onRequestPermission?.()}
          style={[styles.button, styles.brandButton]}
        >
          <Text style={styles.primaryButtonText}>카메라 허용</Text>
        </Pressable>
      ) : null}
      {isPermissionDenied ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => void Linking.openSettings()}
          style={[styles.button, styles.brandButton]}
        >
          <Text style={styles.primaryButtonText}>설정 열기</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function InfoCard({
  body,
  style,
  title
}: {
  body: string;
  style?: StyleProp<ViewStyle>;
  title: string;
}) {
  return (
    <View style={[styles.panel, style]}>
      <View style={styles.panelTop}>
        <View style={styles.iconBox}>
          <Text style={styles.iconText}>●</Text>
        </View>
        <View style={styles.titleWrap}>
          <Text style={styles.panelTitle}>{title}</Text>
          <Text style={styles.panelBody}>{body}</Text>
        </View>
      </View>
      <PrivacyNotice />
    </View>
  );
}

function LoadingCard({ style }: { style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.panel, style]}>
      <View style={styles.loadingRow}>
        <ActivityIndicator color={colors.flame} />
        <Text style={styles.panelTitle}>카메라 상태를 확인하고 있어요</Text>
      </View>
      <PrivacyNotice />
    </View>
  );
}

function PrivacyNotice() {
  return (
    <View style={styles.privacyNotice}>
      <Text style={styles.privacyTitle}>{FOCUS_CAMERA_PRIVACY_COPY}</Text>
      <Text style={styles.privacyBody}>프레임과 영상은 저장하거나 업로드하지 않아요.</Text>
    </View>
  );
}

function normalizeAppState(value: AppStateStatus): FocusAppState {
  return value === "active" || value === "background" || value === "inactive" || value === "extension"
    ? value
    : "unknown";
}

const styles = StyleSheet.create({
  panel: {
    gap: spacing.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.card,
    backgroundColor: colors.surface
  },
  previewPanel: {
    borderColor: colors.flame
  },
  panelTop: {
    flexDirection: "row",
    gap: spacing.md
  },
  titleWrap: {
    flex: 1,
    gap: spacing.xs
  },
  iconBox: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.button,
    backgroundColor: "#FFE8DF"
  },
  iconText: {
    color: colors.flame,
    fontSize: 18,
    fontWeight: "900"
  },
  panelTitle: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: "900",
    lineHeight: 24
  },
  panelBody: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 21
  },
  previewFrame: {
    height: 220,
    overflow: "hidden",
    borderRadius: radii.card,
    backgroundColor: colors.ink
  },
  previewBadge: {
    position: "absolute",
    top: spacing.md,
    left: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.chip,
    backgroundColor: "rgba(22, 26, 46, 0.78)"
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.success
  },
  previewBadgeText: {
    color: colors.surface,
    fontSize: 12,
    fontVariant: [typography.numericVariant],
    fontWeight: "900"
  },
  privacyNotice: {
    gap: spacing.xs,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: "#BFEFD7",
    borderRadius: radii.control,
    backgroundColor: "#F0FFF7"
  },
  privacyTitle: {
    color: "#087A47",
    fontSize: 14,
    fontWeight: "900",
    lineHeight: 20
  },
  privacyBody: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 19
  },
  helperText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 19
  },
  nudgeCard: {
    gap: spacing.xs,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: "#FFCDBD",
    borderRadius: radii.control,
    backgroundColor: "#FFF2ED"
  },
  nudgeTitle: {
    color: colors.flame,
    fontSize: 15,
    fontWeight: "900",
    lineHeight: 21
  },
  nudgeBody: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 19
  },
  statusCard: {
    gap: spacing.xs,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.control,
    backgroundColor: colors.canvas
  },
  statusTitle: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: "900",
    lineHeight: 20
  },
  statusBody: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 19
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm
  },
  button: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radii.button
  },
  brandButton: {
    backgroundColor: colors.brand
  },
  primaryButtonText: {
    color: colors.surface,
    fontSize: 14,
    fontWeight: "900"
  }
});
