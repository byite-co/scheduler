import { useCallback, useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { colors, radii, spacing, tints } from "@ssamplanner/design-tokens";
import {
  DEFAULT_TEACHER_STUDENT_SETTINGS,
  SUBJECT_LABELS,
  type Database,
  type SubjectCode
} from "@ssamplanner/shared";

import { useAuth } from "./auth";
import { managementStyles } from "./managementStyles";
import { supabase } from "./supabaseClient";
import { EmptyState, ErrorState, LoadingState, PrimaryButton, screenStyles } from "./ui";

type Connection = Database["public"]["Tables"]["connections"]["Row"];
type Disclosure = Database["public"]["Tables"]["disclosure_settings"]["Row"];

const SUBJECTS: SubjectCode[] = ["math", "english", "korean", "science", "social", "etc"];
const REPORT_CYCLES = [
  { label: "매주", value: "weekly" },
  { label: "격주", value: "biweekly" },
  { label: "사용 안 함", value: "none" }
] as const;
type ReportCycle = (typeof REPORT_CYCLES)[number]["value"];

const INACTIVE_CONNECTION_COPY: Record<Exclude<Connection["status"], "active">, { title: string; body: string }> = {
  pending: {
    title: "수락 대기 중",
    body: "연결 요청 화면에서 수락하거나 거절할 수 있어요."
  },
  rejected: {
    title: "거절된 연결 요청",
    body: "학생이 유효한 초대 코드로 다시 요청하면 확인 대기 상태로 돌아가요."
  },
  disconnected: {
    title: "연결 해제됨",
    body: "학생이 유효한 초대 코드로 다시 요청하면 확인 대기 상태로 돌아가요."
  }
};

export function StudentSettingsScreen() {
  const { connectionId } = useLocalSearchParams<{ connectionId?: string }>();
  const router = useRouter();
  const { session, setMessage } = useAuth();
  const [connection, setConnection] = useState<Connection | null>(null);
  const [studentName, setStudentName] = useState("학생");
  const [disclosure, setDisclosure] = useState<Disclosure | null>(null);
  const [subjects, setSubjects] = useState<SubjectCode[]>([]);
  const [reportCycle, setReportCycle] = useState<ReportCycle>("weekly");
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setLoadError(null);

    let connectionQuery = supabase
      .from("connections")
      .select("*")
      .eq("teacher_id", session.user.id);
    if (connectionId) {
      connectionQuery = connectionQuery.eq("id", connectionId);
    } else {
      connectionQuery = connectionQuery.eq("status", "active");
    }

    const connectionResult = await connectionQuery
      .order("created_at", { ascending: false })
      .limit(1);
    const selected = connectionResult.data?.[0] ?? null;
    setConnection(selected);

    if (!selected) {
      setDisclosure(null);
      setLoading(false);
      if (connectionResult.error) setMessage(connectionResult.error.message);
      return;
    }

    const [settingsResult, disclosureResult, profileResult] = await Promise.all([
      supabase.from("per_student_settings").select("*").eq("connection_id", selected.id).maybeSingle(),
      supabase.from("disclosure_settings").select("*").eq("connection_id", selected.id).maybeSingle(),
      supabase.from("profiles").select("name").eq("id", selected.student_id).maybeSingle()
    ]);
    setDisclosure(disclosureResult.data);
    setStudentName(profileResult.data?.name.trim() || "이름 미입력");
    setSubjects(
      settingsResult.data?.ai_check_subjects?.length
        ? settingsResult.data.ai_check_subjects
        : ([...DEFAULT_TEACHER_STUDENT_SETTINGS.aiCheckSubjects] as SubjectCode[])
    );
    const nextReportCycle = settingsResult.data?.report_cycle;
    setReportCycle(
      nextReportCycle === "biweekly" || nextReportCycle === "none" ? nextReportCycle : "weekly"
    );
    setLoading(false);

    const error = connectionResult.error ?? settingsResult.error ?? disclosureResult.error ?? profileResult.error;
    setLoadError(error?.message ?? null);
    setMessage(error?.message ?? null);
  }, [connectionId, session, setMessage]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!connection || connection.status !== "active") return;
    setBusy(true);
    const result = await supabase.from("per_student_settings").upsert({
      connection_id: connection.id,
      ai_check_subjects: subjects,
      report_cycle: reportCycle
    });
    setBusy(false);
    if (result.error) {
      setMessage(result.error.message);
      return;
    }
    await load();
    setMessage("설정을 저장했습니다.");
  }

  async function disconnect() {
    if (!connection || connection.status !== "active") return;
    setBusy(true);
    const result = await supabase
      .from("connections")
      .update({ status: "disconnected", activated_at: null })
      .eq("id", connection.id)
      .eq("teacher_id", session?.user.id ?? "");
    setBusy(false);
    if (result.error) {
      setMessage(result.error.message);
      return;
    }
    setConfirmDisconnect(false);
    setConnection({ ...connection, status: "disconnected", activated_at: null });
    setMessage("학생 연결을 해제했습니다.");
  }

  function toggleSubject(subject: SubjectCode) {
    setSubjects((current) =>
      current.includes(subject) ? current.filter((item) => item !== subject) : [...current, subject]
    );
  }

  if (loading) {
    return (
      <ScrollView style={screenStyles.screen} contentContainerStyle={screenStyles.content}>
        <Text style={screenStyles.heading}>학생별 설정</Text>
        <LoadingState label="학생 설정을 불러오는 중…" />
      </ScrollView>
    );
  }

  if (loadError) {
    return (
      <ScrollView style={screenStyles.screen} contentContainerStyle={screenStyles.content}>
        <Text style={screenStyles.heading}>학생별 설정</Text>
        <ErrorState body={loadError} onRetry={() => void load()} />
      </ScrollView>
    );
  }

  if (!connection) {
    return (
      <ScrollView style={screenStyles.screen} contentContainerStyle={screenStyles.content}>
        <EmptyState title="연결된 학생이 없어요" body="학생 연결을 수락하면 학생별 설정을 관리할 수 있어요." />
        <PrimaryButton onPress={() => router.replace("/students/requests")}>연결 요청 보기</PrimaryButton>
      </ScrollView>
    );
  }

  if (connection.status !== "active") {
    const copy = INACTIVE_CONNECTION_COPY[connection.status];
    return (
      <ScrollView style={screenStyles.screen} contentContainerStyle={screenStyles.content}>
        <Text style={screenStyles.heading}>학생별 설정</Text>
        <View style={styles.closedState}>
          <Text style={styles.closedTitle}>{copy.title}</Text>
          <Text style={styles.closedBody}>{copy.body}</Text>
        </View>
        <PrimaryButton onPress={() => router.replace("/students/requests")}>연결 상태 보기</PrimaryButton>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={screenStyles.screen} contentContainerStyle={screenStyles.content}>
      <Text style={screenStyles.heading}>{studentName} 학생 설정</Text>
      <Text style={screenStyles.subtitle}>이 학생에게만 적용되는 수업 설정이에요.</Text>

      <View style={managementStyles.card}>
        <Text style={managementStyles.cardTitle}>수업 설정</Text>
        <Text style={styles.settingLabel}>사진 검사 과목</Text>
        <View style={managementStyles.actionRow}>
          {SUBJECTS.map((subject) => {
            const selected = subjects.includes(subject);
            return (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected }}
                key={subject}
                onPress={() => toggleSubject(subject)}
                style={[managementStyles.chip, selected && managementStyles.chipSelected]}
              >
                <Text style={[managementStyles.chipText, selected && managementStyles.chipTextSelected]}>
                  {SUBJECT_LABELS[subject]}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.settingLabel}>리포트 주기</Text>
        <View style={managementStyles.actionRow}>
          {REPORT_CYCLES.map((cycle) => {
            const selected = reportCycle === cycle.value;
            return (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                key={cycle.value}
                onPress={() => setReportCycle(cycle.value)}
                style={[managementStyles.chip, selected && managementStyles.chipSelected]}
              >
                <Text style={[managementStyles.chipText, selected && managementStyles.chipTextSelected]}>
                  {cycle.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => void save()}
          style={managementStyles.secondaryButton}
        >
          <Text style={managementStyles.secondaryButtonText}>{busy ? "저장 중…" : "설정 저장"}</Text>
        </Pressable>
      </View>

      <View style={managementStyles.card}>
        <Text style={managementStyles.cardTitle}>학생 공개 범위</Text>
        <DisclosureRow label="공부 시간·과목" shared={disclosure?.share_study_time === true} />
        <DisclosureRow label="숙제·검사 사진" shared={disclosure?.share_homework_photos === true} />
        <DisclosureRow label="집중도·졸음 데이터" shared={disclosure?.share_focus_data === true} />
        <Text style={styles.readOnlyNotice}>학생 앱에서만 수정할 수 있습니다.</Text>
      </View>

      {confirmDisconnect ? (
        <View style={styles.disconnectConfirm}>
          <Text style={styles.disconnectTitle}>정말 연결을 해제할까요?</Text>
          <Text style={styles.disconnectBody}>학생 기록 열람이 중단됩니다. 학생은 초대 코드로 다시 요청할 수 있어요.</Text>
          <View style={managementStyles.actionRow}>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => setConfirmDisconnect(false)}
              style={[managementStyles.secondaryButton, styles.confirmButton]}
            >
              <Text style={managementStyles.secondaryButtonText}>취소</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => void disconnect()}
              style={[styles.disconnectButton, styles.confirmButton]}
            >
              <Text style={styles.disconnectButtonText}>{busy ? "해제 중…" : "연결 해제"}</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          onPress={() => setConfirmDisconnect(true)}
          style={styles.disconnectButton}
        >
          <Text style={styles.disconnectButtonText}>이 학생 연결 해제</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

function DisclosureRow({ label, shared }: { label: string; shared: boolean }) {
  return (
    <View style={styles.disclosureRow}>
      <Text style={styles.value}>{label}</Text>
      <Text style={[styles.disclosureStatus, shared ? styles.shared : styles.private]}>
        {shared ? "공개" : "비공개"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  closedBody: {
    color: colors.muted,
    fontSize: 15,
    fontWeight: "600",
    lineHeight: 22
  },
  closedState: {
    backgroundColor: tints.dangerSoft,
    borderColor: colors.danger,
    borderRadius: radii.card,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.xl
  },
  closedTitle: {
    color: colors.danger,
    fontSize: 20,
    fontWeight: "900"
  },
  confirmButton: {
    flex: 1
  },
  disclosureRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between"
  },
  disclosureStatus: {
    borderRadius: radii.chip,
    fontSize: 13,
    fontWeight: "900",
    overflow: "hidden",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  disconnectBody: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 20
  },
  disconnectButton: {
    alignItems: "center",
    backgroundColor: tints.dangerSoft,
    borderColor: colors.danger,
    borderRadius: radii.button,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 52,
    paddingHorizontal: spacing.lg
  },
  disconnectButtonText: {
    color: colors.danger,
    fontSize: 15,
    fontWeight: "900"
  },
  disconnectConfirm: {
    backgroundColor: tints.dangerSoft,
    borderColor: colors.danger,
    borderRadius: radii.card,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg
  },
  disconnectTitle: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: "900"
  },
  private: {
    backgroundColor: colors.canvas,
    color: colors.muted
  },
  readOnlyNotice: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: "700"
  },
  shared: {
    backgroundColor: tints.successSoft,
    color: colors.success
  },
  value: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: "700"
  },
  settingLabel: { color: colors.muted, fontSize: 14, fontWeight: "800" }
});
