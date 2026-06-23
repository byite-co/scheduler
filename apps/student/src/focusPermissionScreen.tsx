import { Link, type Href } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { colors, radii, spacing } from "@ssamplanner/design-tokens";

import { FocusCameraPermissionGate } from "./focusCamera";

export function FocusPermissionScreen() {
  return (
    <ScrollView contentContainerStyle={styles.content} style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.kicker}>집중 모드</Text>
        <Text style={styles.title}>카메라 권한 확인</Text>
        <Text style={styles.body}>
          권한이 없어도 기본 타이머와 플래너는 계속 쓸 수 있어요. 카메라 프리뷰는 집중 세션 화면에서만 켜져요.
        </Text>
      </View>

      <FocusCameraPermissionGate />

      <View style={styles.actions}>
        <Link href={"/focus/session" as Href} asChild>
          <Pressable accessibilityRole="button" style={StyleSheet.flatten([styles.button, styles.brandButton])}>
            <Text style={styles.primaryButtonText}>집중 세션으로 가기</Text>
          </Pressable>
        </Link>
        <Link href={"/timer" as Href} asChild>
          <Pressable accessibilityRole="button" style={StyleSheet.flatten([styles.button, styles.neutralButton])}>
            <Text style={styles.buttonText}>타이머만 계속 쓰기</Text>
          </Pressable>
        </Link>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.canvas
  },
  content: {
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
    width: "100%",
    maxWidth: 720,
    alignSelf: "center"
  },
  header: {
    gap: spacing.sm
  },
  kicker: {
    color: colors.flame,
    fontSize: 13,
    fontWeight: "900"
  },
  title: {
    color: colors.ink,
    fontSize: 32,
    fontWeight: "900",
    lineHeight: 38
  },
  body: {
    color: colors.muted,
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 23
  },
  actions: {
    gap: spacing.sm
  },
  button: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radii.button
  },
  brandButton: {
    backgroundColor: colors.brand
  },
  neutralButton: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface
  },
  primaryButtonText: {
    color: colors.surface,
    fontSize: 15,
    fontWeight: "900"
  },
  buttonText: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: "900"
  }
});
