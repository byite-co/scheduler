import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { colors, radii, spacing, tints } from "@ssamplanner/design-tokens";

export function BrandMark() {
  return <View style={styles.brandMark}><Text style={styles.brandText}>쌤</Text></View>;
}

export function Field({ label, value, onChangeText, secureTextEntry = false, autoCapitalize = "none", placeholder }: {
  label: string; value: string; onChangeText: (value: string) => void; secureTextEntry?: boolean; autoCapitalize?: "none" | "words"; placeholder?: string;
}) {
  return <View style={styles.fieldWrap}><Text style={styles.label}>{label}</Text><TextInput style={styles.field} value={value} onChangeText={onChangeText} secureTextEntry={secureTextEntry} autoCapitalize={autoCapitalize} autoCorrect={false} placeholder={placeholder} placeholderTextColor={colors.muted} /></View>;
}

export function PrimaryButton({ children, onPress, disabled = false }: { children: ReactNode; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.primaryButton, (pressed || disabled) && styles.pressed]}><Text style={styles.primaryText}>{children}</Text></Pressable>;
}

export function TextButton({ children, onPress }: { children: ReactNode; onPress: () => void }) {
  return <Pressable accessibilityRole="button" onPress={onPress} hitSlop={8}><Text style={styles.textButton}>{children}</Text></Pressable>;
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return <View style={styles.empty}><Text style={styles.emptyTitle}>{title}</Text><Text style={styles.emptyBody}>{body}</Text></View>;
}

export const screenStyles = StyleSheet.create({ screen: { flex: 1, backgroundColor: colors.canvas }, content: { flexGrow: 1, padding: spacing.xl, gap: spacing.lg }, heading: { color: colors.ink, fontSize: 32, fontWeight: "800", letterSpacing: -1 }, subtitle: { color: colors.muted, fontSize: 17, fontWeight: "600", lineHeight: 25 }, error: { color: colors.danger, fontSize: 14, fontWeight: "600" }, linkRow: { flexDirection: "row", justifyContent: "center", gap: spacing.xs, flexWrap: "wrap" }, muted: { color: colors.muted, fontSize: 15, fontWeight: "600" } });

const styles = StyleSheet.create({
  brandMark: { width: 82, height: 82, borderRadius: 25, backgroundColor: colors.brand, justifyContent: "center", alignItems: "center" },
  brandText: { color: colors.surface, fontSize: 30, fontWeight: "900" },
  fieldWrap: { gap: spacing.sm }, label: { color: colors.ink, fontSize: 15, fontWeight: "700" },
  field: { minHeight: 58, borderWidth: 1.5, borderColor: colors.line, borderRadius: radii.button, paddingHorizontal: spacing.lg, color: colors.ink, fontSize: 17, backgroundColor: colors.surface },
  primaryButton: { minHeight: 58, alignItems: "center", justifyContent: "center", borderRadius: radii.button, backgroundColor: colors.brand, paddingHorizontal: spacing.lg, shadowColor: colors.brand, shadowOpacity: 0.18, shadowRadius: 16, shadowOffset: { width: 0, height: 8 } },
  primaryText: { color: colors.surface, fontSize: 18, fontWeight: "800" }, pressed: { opacity: 0.65 }, textButton: { color: colors.brand, fontSize: 15, fontWeight: "800", paddingVertical: spacing.sm },
  empty: { backgroundColor: tints.brandSoft, borderRadius: radii.card, padding: spacing.xl, alignItems: "center", gap: spacing.sm }, emptyTitle: { color: colors.ink, fontSize: 18, fontWeight: "800" }, emptyBody: { color: colors.muted, textAlign: "center", lineHeight: 21, fontWeight: "600" }
});
