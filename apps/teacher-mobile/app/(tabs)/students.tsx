import { Link, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { colors, radii, spacing } from "@ssamplanner/design-tokens";

import { AppIcon } from "../../src/icons";
import { statusFor, useTeacherStudents } from "../../src/teacherData";
import { EmptyState, screenStyles } from "../../src/ui";

const FILTERS = ["전체", "주의", "양호", "비공개"] as const;

export default function StudentsRoute() {
  const router = useRouter();
  const { students, loading } = useTeacherStudents();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("전체");
  const rows = useMemo(
    () => students.filter((student) => {
      const matchesFilter = filter === "전체" || statusFor(student).label === filter;
      return matchesFilter && student.name.includes(query);
    }),
    [filter, query, students]
  );

  if (loading) return null;

  return (
    <ScrollView style={screenStyles.screen} contentContainerStyle={screenStyles.content}>
      <View style={styles.headingRow}>
        <Text style={screenStyles.heading}>학생 관리</Text>
        <Pressable
          accessibilityLabel="학생 초대"
          accessibilityRole="button"
          onPress={() => router.push("/students/invite")}
          style={styles.addButton}
        >
          <Text style={styles.addButtonText}>＋</Text>
        </Pressable>
      </View>

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="이름 · 학년 · 과목 검색"
        style={styles.search}
      />

      <View style={styles.filters}>
        {FILTERS.map((item) => (
          <Pressable key={item} onPress={() => setFilter(item)}>
            <Text style={[styles.filter, filter === item && styles.selected]}>{item}</Text>
          </Pressable>
        ))}
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={() => router.push("/students/requests")}
        style={styles.requestsButton}
      >
        <View style={styles.requestsCopy}>
          <AppIcon name="mail" color={colors.brand} />
          <View style={styles.requestsText}>
            <Text style={styles.requestsTitle}>연결 요청 관리</Text>
            <Text style={styles.requestsDescription}>대기·거절·연결 해제 상태를 확인해요.</Text>
          </View>
        </View>
        <Text style={styles.chevron}>›</Text>
      </Pressable>

      {!students.length ? (
        <EmptyState title="아직 연결된 학생이 없어요" body="우측 상단 + 버튼으로 학생을 초대해 연결해 보세요." />
      ) : null}

      {rows.map((student) => (
        <Link
          key={student.id}
          href={{ pathname: "/student/[id]", params: { id: student.id } }}
          style={styles.item}
        >
          <View>
            <Text style={styles.name}>{student.name}</Text>
            <Text style={styles.meta}>{student.grade ?? "학년 미설정"}</Text>
          </View>
          <Text style={{ color: statusFor(student).color, fontWeight: "900" }}>
            {student.disclosure?.share_study_time ? statusFor(student).label : "학생이 공개하지 않았어요"}
          </Text>
        </Link>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  addButton: {
    alignItems: "center",
    backgroundColor: colors.brand,
    borderRadius: radii.button,
    height: 54,
    justifyContent: "center",
    width: 54
  },
  addButtonText: {
    color: colors.surface,
    fontSize: 32,
    fontWeight: "500",
    lineHeight: 36
  },
  chevron: {
    color: colors.muted,
    fontSize: 28
  },
  filter: {
    color: colors.muted,
    fontWeight: "800",
    padding: 10
  },
  filters: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  headingRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between"
  },
  item: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    flexDirection: "row",
    justifyContent: "space-between",
    padding: spacing.lg
  },
  meta: {
    color: colors.muted
  },
  name: {
    color: colors.ink,
    fontSize: 20,
    fontWeight: "900"
  },
  requestsButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: radii.button,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 72,
    padding: spacing.lg
  },
  requestsCopy: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 1,
    gap: spacing.md
  },
  requestsDescription: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "600"
  },
  requestsText: {
    flexShrink: 1,
    gap: spacing.xs
  },
  requestsTitle: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: "900"
  },
  search: {
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: radii.button,
    borderWidth: 1,
    minHeight: 58,
    paddingHorizontal: spacing.lg
  },
  selected: {
    color: colors.brand
  }
});
