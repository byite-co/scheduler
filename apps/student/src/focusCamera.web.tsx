import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle
} from "react-native";

import { colors, radii, spacing } from "@ssamplanner/design-tokens";
import {
  FOCUS_CAMERA_PRIVACY_COPY,
  FOCUS_CAMERA_TIMER_ONLY_COPY,
  getFocusCameraFallbackTitle
} from "@ssamplanner/shared";

type FocusCameraProps = {
  active: boolean;
  style?: StyleProp<ViewStyle>;
};

type PermissionGateProps = {
  style?: StyleProp<ViewStyle>;
};

export function FocusCameraPanel({ active, style }: FocusCameraProps) {
  return (
    <FallbackCard
      body={
        active
          ? FOCUS_CAMERA_TIMER_ONLY_COPY
          : "일시정지 중에는 카메라도 꺼져요. 다시 시작하면 지원 여부를 확인해요."
      }
      style={style}
      title={active ? getFocusCameraFallbackTitle("unsupported_environment") : "집중 타이머가 멈춰 있어요"}
    />
  );
}

export function FocusCameraPermissionGate({ style }: PermissionGateProps) {
  return (
    <FallbackCard
      body="웹과 Expo Go에서는 카메라 프리뷰를 켜지 않고 타이머만 계속 쓸 수 있어요."
      style={style}
      title={getFocusCameraFallbackTitle("unsupported_environment")}
    />
  );
}

function FallbackCard({
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
          <Text style={styles.iconText}>⌁</Text>
        </View>
        <View style={styles.titleWrap}>
          <Text style={styles.panelTitle}>{title}</Text>
          <Text style={styles.panelBody}>{body}</Text>
        </View>
      </View>
      <View style={styles.privacyNotice}>
        <Text style={styles.privacyTitle}>{FOCUS_CAMERA_PRIVACY_COPY}</Text>
        <Text style={styles.privacyBody}>프레임과 영상은 저장하거나 업로드하지 않아요.</Text>
      </View>
      <Pressable accessibilityRole="button" disabled style={[styles.button, styles.disabledButton]}>
        <Text style={styles.disabledButtonText}>타이머만 계속 쓰기</Text>
      </Pressable>
    </View>
  );
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
  button: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radii.button
  },
  disabledButton: {
    backgroundColor: colors.canvas
  },
  disabledButtonText: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: "900"
  }
});
