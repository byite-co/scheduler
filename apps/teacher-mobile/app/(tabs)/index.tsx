import { Link, useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { colors, spacing } from "@ssamplanner/design-tokens";

import { useAuth } from "../../src/auth";
import { statusFor, useTeacherStudents } from "../../src/teacherData";
import { EmptyState, ErrorState, LoadingState, PrimaryButton, screenStyles } from "../../src/ui";

export default function DashboardRoute() {
  const router = useRouter();
  const { profile } = useAuth();
  const { error, loading, refresh, students, todayLessonCount } = useTeacherStudents();
  const risk = students.filter((student) => statusFor(student).label === "주의");
  const pendingReviewCount = students.reduce((count, student) => count + student.pendingReviewCount, 0);

  if (loading) {
    return (
      <ScrollView style={screenStyles.screen} contentContainerStyle={screenStyles.content}>
        <Text style={screenStyles.heading}>대시보드</Text>
        <LoadingState label="대시보드를 불러오는 중…" />
      </ScrollView>
    );
  }

  if (error) {
    return (
      <ScrollView style={screenStyles.screen} contentContainerStyle={screenStyles.content}>
        <Text style={screenStyles.heading}>대시보드</Text>
        <ErrorState body={error} onRetry={() => void refresh()} />
      </ScrollView>
    );
  }

  if (!students.length) {
    return (
      <ScrollView style={screenStyles.screen} contentContainerStyle={screenStyles.content}>
        <Text style={screenStyles.heading}>대시보드</Text>
        <EmptyState title="아직 학생이 없어요" body="학생을 추가하면 진도·숙제·리포트를 바로 기록할 수 있어요." />
        <PrimaryButton onPress={() => router.push("/students/invite")}>학생 추가하기</PrimaryButton>
        <Text style={styles.title}>오늘 할 일</Text>
        <Pressable accessibilityRole="button" onPress={() => router.push("/tools")} style={styles.outlineButton}>
          <Text style={styles.outlineButtonText}>내 수업 일정 등록하기</Text>
        </Pressable>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={screenStyles.screen} contentContainerStyle={screenStyles.content}>
      <Text style={styles.date}>{new Date().toLocaleDateString("ko-KR")}</Text>
      <Text style={screenStyles.heading}>{profile?.name || "과외쌤"} 선생님</Text>
      <View style={styles.grid}>
        <Stat label="담당 학생" value={`${students.length}명`} />
        <Stat label="검사 대기" value={`${pendingReviewCount}건`} />
        <Stat label="오늘 수업" value={`${todayLessonCount}건`} />
        <Stat label="위험 학생" value={`${risk.length}명`} />
      </View>
      {risk.length ? (
        <View style={styles.card}>
          <Text style={styles.title}>집중 관리</Text>
          {risk.map((student) => (
            <Link key={student.id} href={{ pathname: "/student/[id]", params: { id: student.id } }}>
              <Text style={styles.row}>{student.name} · 이번 주 {student.weekMinutes}분 · 주의</Text>
            </Link>
          ))}
        </View>
      ) : null}
      <View style={styles.dark}>
        <Text style={styles.darkTitle}>검사 대기 {pendingReviewCount}건</Text>
        <Text style={styles.darkText}>AI 판정은 표시하지 않아요. 제출 사진을 직접 확인할 수 있어요.</Text>
        <View style={styles.homeworkLinks}>
          <Link href="/homework" style={styles.homeworkLink}>낸 숙제</Link>
          <Link href="/homework/review" style={styles.homeworkLink}>제출 검사</Link>
          <Link href="/homework/new" style={styles.homeworkLink}>+ 숙제 내기</Link>
        </View>
      </View>
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  date: { color: colors.muted, fontWeight: "700" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  stat: { width: "47%", backgroundColor: colors.surface, borderRadius: 18, padding: spacing.lg },
  label: { color: colors.muted, fontWeight: "700" },
  value: { fontSize: 28, fontWeight: "900", color: colors.ink },
  card: { backgroundColor: colors.surface, borderRadius: 18, padding: spacing.lg },
  title: { fontSize: 20, fontWeight: "900", color: colors.ink },
  row: { paddingVertical: 10, color: colors.ink, fontWeight: "700" },
  dark: { backgroundColor: colors.ink, borderRadius: 18, padding: spacing.xl, gap: spacing.sm },
  darkTitle: { fontSize: 20, fontWeight: "900", color: colors.surface },
  darkText: { color: colors.line },
  homeworkLinks: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  homeworkLink: {
    backgroundColor: colors.brand,
    borderRadius: 12,
    color: colors.surface,
    fontWeight: "900",
    overflow: "hidden",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  outlineButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.brand,
    borderRadius: 12,
    borderWidth: 1.5,
    justifyContent: "center",
    minHeight: 52,
    paddingHorizontal: spacing.lg
  },
  outlineButtonText: { color: colors.brand, fontSize: 16, fontWeight: "900" }
});
