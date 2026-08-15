import { useCallback, useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { colors, radii, spacing, tints } from "@ssamplanner/design-tokens";
import { DEFAULT_TEACHER_STUDENT_SETTINGS, SUBJECT_LABELS, type Database } from "@ssamplanner/shared";

import { useAuth } from "./auth";
import { managementStyles } from "./managementStyles";
import { supabase } from "./supabaseClient";
import { EmptyState, PrimaryButton, screenStyles } from "./ui";

type Connection = Database["public"]["Tables"]["connections"]["Row"];
type StudentSettings = Database["public"]["Tables"]["per_student_settings"]["Row"];
type Disclosure = Database["public"]["Tables"]["disclosure_settings"]["Row"];

export function StudentSettingsScreen() {
  const { connectionId } = useLocalSearchParams<{ connectionId?: string }>();
  const router = useRouter();
  const { session, setMessage } = useAuth();
  const [connection, setConnection] = useState<Connection | null>(null);
  const [studentName, setStudentName] = useState("학생");
  const [settings, setSettings] = useState<StudentSettings | null>(null);
  const [disclosure, setDisclosure] = useState<Disclosure | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true);

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
      setSettings(null);
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
    setSettings(settingsResult.data);
    setDisclosure(disclosureResult.data);
    setStudentName(profileResult.data?.name ?? "학생");
    setLoading(false);

    const error = connectionResult.error ?? settingsResult.error ?? disclosureResult.error ?? profileResult.error;
    if (error) setMessage(error.message);
  }, [connectionId, session, setMessage]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!connection || connection.status !== "active") return;
    setBusy(true);
    const result = await supabase.from("per_student_settings").upsert({
      connection_id: connection.id,
      ai_check_subjects:
        settings?.ai_check_subjects ??
        (DEFAULT_TEACHER_STUDENT_SETTINGS.aiCheckSubjects as Database["public"]["Enums"]["subject_code"][]),
      report_cycle: settings?.report_cycle ?? DEFAULT_TEACHER_STUDENT_SETTINGS.reportCycle
    });
    setBusy(false);
    setMessage(result.error?.message ?? "설정을 저장했습니다.");
    if (!result.error) await load();
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

  if (loading) return null;

  if (!connection) {
    return (
      <ScrollView style={screenStyles.screen} contentContainerStyle={screenStyles.content}>
        <EmptyState title="연결된 학생이 없어요" body="학생 연결을 수락하면 학생별 설정을 관리할 수 있어요." />
        <PrimaryButton onPress={() => router.replace("/students/requests")}>연결 요청 보기</PrimaryButton>
      </ScrollView>
    );
  }

  if (connection.status !== "active") {
    return (
      <ScrollView style={screenStyles.screen} contentContainerStyle={screenStyles.content}>
        <Text style={screenStyles.heading}>학생별 설정</Text>
        <View style={styles.closedState}>
          <Text style={styles.closedTitle}>{connection.status === "disconnected" ? "연결 해제됨" : "현재 연결되지 않음"}</Text>
          <Text style={styles.closedBody}>학생이 유효한 초대 코드로 다시 요청하면 pending 상태로 돌아갑니다.</Text>
        </View>
        <PrimaryButton onPress={() => router.replace("/students/requests")}>연결 상태 보기</PrimaryButton>
      </ScrollView>
    );
  }

  const subjectLabels = (settings?.ai_check_subjects ?? []).map((subject) => SUBJECT_LABELS[subject]);

  return (
    <ScrollView style={screenStyles.screen} contentContainerStyle={screenStyles.content}>
      <Text style={screenStyles.heading}>{studentName} 학생 설정</Text>
      <Text style={screenStyles.subtitle}>이 학생에게만 적용되는 수업 설정이에요.</Text>

      <View style={managementStyles.card}>
        <Text style={managementStyles.cardTitle}>수업 설정</Text>
        <Text style={styles.value}>AI 검사 과목: {subjectLabels.join(", ") || "기본값"}</Text>
        <Text style={styles.value}>리포트 주기: {settings?.report_cycle ?? "weekly"}</Text>
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
  }
});
