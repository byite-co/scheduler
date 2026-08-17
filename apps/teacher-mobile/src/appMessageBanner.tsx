import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, radii, spacing } from "@ssamplanner/design-tokens";

import { useAuth } from "./auth";
import { toUserMessage } from "./userMessage";

export function AppMessageBanner() {
  const { message, setMessage } = useAuth();
  const insets = useSafeAreaInsets();

  if (!message) return null;

  return (
    <View accessibilityRole="alert" style={[styles.banner, { top: insets.top + spacing.sm }]}>
      <Text style={styles.message}>{toUserMessage(message)}</Text>
      <Pressable accessibilityLabel="안내 닫기" accessibilityRole="button" onPress={() => setMessage(null)}>
        <Text style={styles.close}>닫기</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    alignItems: "center",
    backgroundColor: colors.ink,
    borderRadius: radii.button,
    flexDirection: "row",
    gap: spacing.md,
    left: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    position: "absolute",
    right: spacing.lg,
    zIndex: 100
  },
  close: {
    color: colors.surface,
    fontSize: 13,
    fontWeight: "900"
  },
  message: {
    color: colors.surface,
    flex: 1,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20
  }
});
