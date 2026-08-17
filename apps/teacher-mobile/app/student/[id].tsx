import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { colors, spacing } from "@ssamplanner/design-tokens";

import { managementStyles } from "../../src/managementStyles";
import { useTeacherStudents } from "../../src/teacherData";
import { EmptyState, ErrorState, LoadingState, PrimaryButton, screenStyles } from "../../src/ui";

const DETAIL_TABS = ["요약", "플랜·숙제", "공부 기록", "약점"] as const;
type DetailTab = (typeof DETAIL_TABS)[number];

export default function StudentDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { error, loading, refresh, students } = useTeacherStudents();
  const [activeTab, setActiveTab] = useState<DetailTab>("요약");

  if (loading) {
    return (
      <ScrollView style={screenStyles.screen} contentContainerStyle={screenStyles.content}>
        <LoadingState label="학생 정보를 불러오는 중…" />
      </ScrollView>
    );
  }

  if (error) {
    return (
      <ScrollView style={screenStyles.screen} contentContainerStyle={screenStyles.content}>
        <ErrorState body={error} onRetry={() => void refresh()} />
      </ScrollView>
    );
  }

  const student = students.find((item) => item.id === id);
  if (!student) {
    return (
      <View style={screenStyles.content}>
        <EmptyState title="학생을 찾을 수 없어요" body="연결 상태를 확인해 주세요." />
      </View>
    );
  }

  const selectedStudent = student;
  const studyTimeShared = student.disclosure?.share_study_time === true;
  const homeworkShared = student.disclosure?.share_homework_photos === true;

  function renderStudyTime() {
    if (!studyTimeShared) {
      return (
        <EmptyState
          title="학생이 공부 기록을 공개하지 않았어요"
          body="공개 범위가 변경되면 주간 공부시간이 표시돼요. 공개 범위는 학생 앱에서만 바꿀 수 있어요."
        />
      );
    }

    return (
      <View style={styles.card}>
        <Text style={styles.title}>주간 공부시간</Text>
        <Text style={styles.big}>
          {Math.floor(selectedStudent.weekMinutes / 60)}시간 {selectedStudent.weekMinutes % 60}분
        </Text>
        {selectedStudent.weekMinutes === 0 ? <Text style={styles.note}>이번 주에 기록된 공부시간이 없어요.</Text> : null}
      </View>
    );
  }

  function renderHomework() {
    if (!homeworkShared) {
      return (
        <EmptyState
          title="학생이 숙제 사진을 공개하지 않았어요"
          body="제출 정보와 사진을 표시하지 않아요. 공개 범위는 학생 앱에서만 바꿀 수 있어요."
        />
      );
    }

    return (
      <View style={styles.card}>
        <Text style={styles.title}>숙제 제출</Text>
        <Text style={styles.big}>{selectedStudent.submittedCount}건</Text>
        <Text style={styles.note}>AI 판정은 표시하지 않고 제출 여부만 보여요.</Text>
      </View>
    );
  }

  function renderTabContent() {
    if (activeTab === "공부 기록") return renderStudyTime();

    if (activeTab === "플랜·숙제") {
      return (
        <View style={styles.section}>
          {renderHomework()}
          <PrimaryButton
            onPress={() => router.push({ pathname: "/homework/new", params: { studentId: selectedStudent.id } })}
          >
            이 학생에게 숙제 내기
          </PrimaryButton>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/homework")}
            style={managementStyles.secondaryButton}
          >
            <Text style={managementStyles.secondaryButtonText}>낸 숙제 보기</Text>
          </Pressable>
        </View>
      );
    }

    if (activeTab === "약점") {
      return (
        <EmptyState
          title="표시할 약점 정보가 없어요"
          body="과외쌤 앱에는 AI 판정을 표시하지 않아요. 학생의 제출 사진은 숙제 검사에서 직접 확인해 주세요."
        />
      );
    }

    return (
      <View style={styles.section}>
        {renderStudyTime()}
        {renderHomework()}
      </View>
    );
  }

  return (
    <ScrollView style={screenStyles.screen} contentContainerStyle={screenStyles.content}>
      <Text style={screenStyles.heading}>{student.name}</Text>
      <Text style={screenStyles.subtitle}>
        {student.grade ?? "학년 미설정"} · 공개 범위 안에서만 표시해요.
      </Text>
      <Pressable
        accessibilityRole="button"
        style={managementStyles.secondaryButton}
        onPress={() => router.push({
          pathname: "/students/settings",
          params: { connectionId: student.connection.id }
        })}
      >
        <Text style={managementStyles.secondaryButtonText}>학생별 설정</Text>
      </Pressable>

      <View style={styles.tabs}>
        {DETAIL_TABS.map((tab) => {
          const selected = activeTab === tab;
          return (
            <Pressable accessibilityRole="tab" key={tab} onPress={() => setActiveTab(tab)}>
              <Text style={[styles.tab, selected && styles.active]}>{tab}</Text>
            </Pressable>
          );
        })}
      </View>
      {renderTabContent()}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  active: {
    backgroundColor: colors.ink,
    color: colors.surface,
    fontWeight: "900"
  },
  big: {
    color: colors.brand,
    fontSize: 29,
    fontWeight: "900"
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    gap: 8,
    padding: spacing.xl
  },
  note: {
    color: colors.muted,
    fontWeight: "600"
  },
  tab: {
    backgroundColor: colors.surface,
    borderRadius: 99,
    color: colors.muted,
    fontWeight: "800",
    paddingHorizontal: 15,
    paddingVertical: 9
  },
  tabs: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  title: {
    color: colors.ink,
    fontSize: 20,
    fontWeight: "900"
  },
  section: { gap: spacing.lg }
});
