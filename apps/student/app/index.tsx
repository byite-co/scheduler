import { colors, radii, shadows, spacing } from "@ssamplanner/design-tokens";
import {
  PRICE_STUDENT_PREMIUM_KRW,
  SUBJECT_LABELS
} from "@ssamplanner/shared";
import { StyleSheet, Text, View } from "react-native";

const subjectPreview = [SUBJECT_LABELS.math, SUBJECT_LABELS.english, SUBJECT_LABELS.korean];

export default function StudentHomeScreen() {
  return (
    <View style={styles.screen}>
      <View style={styles.panel}>
        <Text style={styles.eyebrow}>학생 앱</Text>
        <Text style={styles.title}>오늘 공부를 바로 시작해요</Text>
        <Text style={styles.body}>
          아직 등록된 할 일이 없어요. 오늘의 공부 시간이 차곡차곡 쌓입니다.
        </Text>

        <View style={styles.metricRow}>
          <View style={styles.metric}>
            <Text style={styles.metricValue}>0분</Text>
            <Text style={styles.metricLabel}>오늘 공부</Text>
          </View>
          <View style={styles.metric}>
            <Text style={styles.metricValue}>0개</Text>
            <Text style={styles.metricLabel}>할 일</Text>
          </View>
        </View>

        <View style={styles.subjectRow}>
          {subjectPreview.map((subject) => (
            <Text key={subject} style={styles.chip}>
              {subject}
            </Text>
          ))}
        </View>

        <Text style={styles.price}>
          프리미엄 기준 월 {PRICE_STUDENT_PREMIUM_KRW.toLocaleString("ko-KR")}원
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: "center",
    backgroundColor: colors.canvas,
    padding: spacing.xl
  },
  panel: {
    gap: spacing.lg,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.card,
    backgroundColor: colors.surface,
    boxShadow: shadows.soft
  },
  eyebrow: {
    color: colors.brand,
    fontSize: 13,
    fontWeight: "700"
  },
  title: {
    color: colors.ink,
    fontSize: 28,
    fontWeight: "800",
    lineHeight: 34
  },
  body: {
    color: colors.muted,
    fontSize: 16,
    lineHeight: 24
  },
  metricRow: {
    flexDirection: "row",
    gap: spacing.md
  },
  metric: {
    flex: 1,
    padding: spacing.lg,
    borderRadius: radii.control,
    backgroundColor: colors.canvas
  },
  metricValue: {
    color: colors.ink,
    fontSize: 22,
    fontVariant: ["tabular-nums"],
    fontWeight: "800"
  },
  metricLabel: {
    marginTop: spacing.xs,
    color: colors.muted,
    fontSize: 13
  },
  subjectRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  chip: {
    overflow: "hidden",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.chip,
    backgroundColor: colors.brand,
    color: colors.surface,
    fontSize: 13,
    fontWeight: "700"
  },
  price: {
    color: colors.ink,
    fontSize: 14,
    fontVariant: ["tabular-nums"],
    fontWeight: "700"
  }
});
