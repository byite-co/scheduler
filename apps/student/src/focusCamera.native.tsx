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
  FOCUS_CAMERA_PRIVACY_COPY,
  FOCUS_CAMERA_TIMER_ONLY_COPY,
  getFocusCameraDecision,
  getFocusCameraFallbackTitle,
  type FocusAppState,
  type FocusCameraFallbackReason
} from "@ssamplanner/shared";
import type * as VisionCamera from "react-native-vision-camera";

type VisionCameraModule = Pick<
  typeof VisionCamera,
  "Camera" | "useCameraDevice" | "useCameraPermission"
>;

type FocusCameraProps = {
  active: boolean;
  style?: StyleProp<ViewStyle>;
};

type PermissionGateProps = {
  style?: StyleProp<ViewStyle>;
};

export function FocusCameraPanel({ active, style }: FocusCameraProps) {
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

  return <NativeVisionCameraPanel active={active} cameraModule={cameraModule} style={style} />;
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
  style
}: FocusCameraProps & { cameraModule: VisionCameraModule }) {
  const [appState, setAppState] = useState<FocusAppState>(normalizeAppState(AppState.currentState));
  const device = cameraModule.useCameraDevice("front");
  const { canRequestPermission, hasPermission, requestPermission } = cameraModule.useCameraPermission();
  const decision = getFocusCameraDecision({
    appState,
    canRequestPermission,
    canUseNativeCamera: Platform.OS === "ios" || Platform.OS === "android",
    deviceAvailable: Boolean(device),
    hasPermission
  });
  const shouldMountPreview = active && decision.shouldMountCamera && Boolean(device);
  const CameraPreview = cameraModule.Camera;

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      setAppState(normalizeAppState(nextState));
    });

    return () => subscription.remove();
  }, []);

  if (shouldMountPreview && device) {
    return (
      <View style={[styles.panel, styles.previewPanel, style]}>
        <View style={styles.previewFrame}>
          <CameraPreview
            device={device}
            isActive={true}
            resizeMode="cover"
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.previewBadge}>
            <View style={styles.liveDot} />
            <Text style={styles.previewBadgeText}>카메라 ON</Text>
          </View>
        </View>
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
