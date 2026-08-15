import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { colors, radii, spacing, tints } from "@ssamplanner/design-tokens";
import {
  DEFAULT_TEACHER_STUDENT_SETTINGS,
  formatInviteCode,
  formatPendingRequestLabel,
  indexPendingRequests,
  type Database,
  type PendingConnectionRequest
} from "@ssamplanner/shared";

import { useAuth } from "./auth";
import { managementStyles } from "./managementStyles";
import { supabase } from "./supabaseClient";
import { EmptyState, PrimaryButton, screenStyles } from "./ui";

type Connection = Database["public"]["Tables"]["connections"]["Row"];
type ConnectionStatus = Database["public"]["Enums"]["connection_status"];
type StudentProfile = Pick<Database["public"]["Tables"]["profiles"]["Row"], "id" | "name" | "grade">;
type ConnectionWithStudent = Connection & { student: StudentProfile | null };

const STATUS_COPY: Record<ConnectionStatus, { label: string; description: string }> = {
  pending: {
    label: "확인 대기",
    description: "수락하거나 거절해 주세요."
  },
  active: {
    label: "연결됨",
    description: "학생 목록과 학생별 설정에서 관리할 수 있어요."
  },
  rejected: {
    label: "거절됨",
    description: "학생이 유효한 초대 코드로 다시 요청할 수 있어요."
  },
  disconnected: {
    label: "연결 해제됨",
    description: "학생이 유효한 초대 코드로 다시 요청할 수 있어요."
  }
};

function statusStyle(status: ConnectionStatus) {
  if (status === "active") return styles.statusActive;
  if (status === "rejected" || status === "disconnected") return styles.statusClosed;
  return styles.statusPending;
}

function connectionLabel(
  connection: ConnectionWithStudent,
  pendingByConnectionId: Map<string, PendingConnectionRequest>
) {
  if (connection.status === "pending") {
    const request = pendingByConnectionId.get(connection.id);
    return request ? formatPendingRequestLabel(request) : "학생 정보를 볼 수 없음";
  }
  if (connection.status === "active") {
    return connection.student
      ? formatPendingRequestLabel({
          student_name: connection.student.name,
          student_grade: connection.student.grade
        })
      : "학생 정보를 볼 수 없음";
  }
  if (connection.status === "rejected") return "거절된 연결 요청";
  return "연결 해제된 기록";
}

export function ConnectionRequestsScreen() {
  const router = useRouter();
  const { session, setMessage } = useAuth();
  const [connections, setConnections] = useState<ConnectionWithStudent[]>([]);
  const [pendingByConnectionId, setPendingByConnectionId] = useState(
    () => new Map<string, PendingConnectionRequest>()
  );
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadConnections = useCallback(async () => {
    if (!session) return;
    const [connectionsResult, pendingResult] = await Promise.all([
      supabase
        .from("connections")
        .select("*, student:profiles!connections_student_id_fkey(id,name,grade)")
        .eq("teacher_id", session.user.id)
        .order("created_at", { ascending: false }),
      supabase.rpc("pending_connection_requests")
    ]);
    setConnections((connectionsResult.data ?? []) as ConnectionWithStudent[]);
    setPendingByConnectionId(indexPendingRequests(pendingResult.data));
    const error = connectionsResult.error ?? pendingResult.error;
    if (error) setMessage(error.message);
  }, [session, setMessage]);

  useEffect(() => {
    void loadConnections();
  }, [loadConnections]);

  const pending = useMemo(
    () => connections.filter((connection) => connection.status === "pending"),
    [connections]
  );
  const history = useMemo(
    () => connections.filter((connection) => connection.status !== "pending"),
    [connections]
  );

  async function decide(connection: ConnectionWithStudent, accept: boolean) {
    setBusyId(connection.id);
    const patch = accept
      ? { status: "active" as const, activated_at: new Date().toISOString() }
      : { status: "rejected" as const, activated_at: null };
    const result = await supabase.from("connections").update(patch).eq("id", connection.id);
    if (result.error) {
      setMessage(result.error.message);
      setBusyId(null);
      return;
    }

    if (accept) {
      const settings = await supabase.from("per_student_settings").upsert({
        connection_id: connection.id,
        ai_check_subjects: DEFAULT_TEACHER_STUDENT_SETTINGS.aiCheckSubjects as Database["public"]["Enums"]["subject_code"][],
        report_cycle: DEFAULT_TEACHER_STUDENT_SETTINGS.reportCycle
      });
      if (settings.error) {
        setMessage(settings.error.message);
        setBusyId(null);
        return;
      }
    }

    setMessage(accept ? "연결을 수락했습니다." : "연결을 거절했습니다.");
    setBusyId(null);
    await loadConnections();
  }

  return (
    <ScrollView style={screenStyles.screen} contentContainerStyle={screenStyles.content}>
      <View style={styles.headingRow}>
        <View style={styles.headingCopy}>
          <Text style={screenStyles.heading}>연결 요청</Text>
          <Text style={screenStyles.subtitle}>학생이 초대 코드를 입력하면 여기에서 확인해요.</Text>
        </View>
        <Pressable
          accessibilityLabel="학생 초대"
          accessibilityRole="button"
          onPress={() => router.push("/students/invite")}
          style={styles.addButton}
        >
          <Text style={styles.addButtonText}>＋</Text>
        </Pressable>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>확인할 요청 {pending.length}건</Text>
        {pending.length === 0 ? (
          <EmptyState title="대기 중인 요청이 없어요" body="초대 코드를 학생에게 보내면 요청이 도착해요." />
        ) : null}
        {pending.map((connection) => (
          <ConnectionCard
            busy={busyId === connection.id}
            connection={connection}
            key={connection.id}
            pendingByConnectionId={pendingByConnectionId}
            onAccept={() => void decide(connection, true)}
            onReject={() => void decide(connection, false)}
          />
        ))}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>최근 연결 상태</Text>
        {history.length === 0 ? (
          <Text style={styles.historyEmpty}>수락·거절·연결 해제된 내역이 아직 없어요.</Text>
        ) : null}
        {history.map((connection) => (
          <ConnectionCard
            connection={connection}
            key={connection.id}
            pendingByConnectionId={pendingByConnectionId}
          />
        ))}
      </View>

      <PrimaryButton onPress={() => router.push("/students/invite")}>새 학생 초대하기</PrimaryButton>
    </ScrollView>
  );
}

function ConnectionCard({
  busy = false,
  connection,
  pendingByConnectionId,
  onAccept,
  onReject
}: {
  busy?: boolean;
  connection: ConnectionWithStudent;
  pendingByConnectionId: Map<string, PendingConnectionRequest>;
  onAccept?: () => void;
  onReject?: () => void;
}) {
  const copy = STATUS_COPY[connection.status];
  const inviteCode = connection.invite_code ? formatInviteCode(connection.invite_code) : "초대 코드 없음";

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.studentCopy}>
          <Text style={styles.studentLabel}>{connectionLabel(connection, pendingByConnectionId)}</Text>
          <Text style={styles.meta}>{inviteCode}</Text>
        </View>
        <Text style={[styles.status, statusStyle(connection.status)]}>{copy.label}</Text>
      </View>
      <Text style={styles.description}>{copy.description}</Text>
      {connection.status === "pending" ? (
        <View style={managementStyles.actionRow}>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={onReject}
            style={[managementStyles.secondaryButton, styles.actionButton]}
          >
            <Text style={managementStyles.secondaryButtonText}>거절</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={onAccept}
            style={[styles.acceptButton, styles.actionButton, busy && styles.disabled]}
          >
            <Text style={styles.acceptButtonText}>{busy ? "처리 중…" : "수락"}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  acceptButton: {
    alignItems: "center",
    backgroundColor: colors.brand,
    borderRadius: radii.button,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: spacing.lg
  },
  acceptButtonText: {
    color: colors.surface,
    fontSize: 15,
    fontWeight: "900"
  },
  actionButton: {
    flex: 1
  },
  addButton: {
    alignItems: "center",
    backgroundColor: colors.brand,
    borderRadius: radii.button,
    height: 52,
    justifyContent: "center",
    width: 52
  },
  addButtonText: {
    color: colors.surface,
    fontSize: 30,
    lineHeight: 34
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: radii.card,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg
  },
  cardHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between"
  },
  description: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 20
  },
  disabled: {
    opacity: 0.6
  },
  headingCopy: {
    flex: 1,
    gap: spacing.sm
  },
  headingRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between"
  },
  historyEmpty: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: "600"
  },
  meta: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700"
  },
  section: {
    gap: spacing.md
  },
  sectionTitle: {
    color: colors.ink,
    fontSize: 20,
    fontWeight: "900"
  },
  status: {
    borderRadius: radii.chip,
    fontSize: 13,
    fontWeight: "900",
    overflow: "hidden",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  statusActive: {
    backgroundColor: tints.successSoft,
    color: colors.success
  },
  statusClosed: {
    backgroundColor: tints.dangerSoft,
    color: colors.danger
  },
  statusPending: {
    backgroundColor: tints.warningSoft,
    color: colors.warning
  },
  studentCopy: {
    flexShrink: 1,
    gap: spacing.xs
  },
  studentLabel: {
    color: colors.ink,
    fontSize: 17,
    fontWeight: "900"
  }
});
