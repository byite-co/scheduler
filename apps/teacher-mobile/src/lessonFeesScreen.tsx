import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { colors, spacing } from "@ssamplanner/design-tokens";
import { formatKrw, summarizeLessonFees, type Database } from "@ssamplanner/shared";

import { useAuth } from "./auth";
import { managementStyles as styles } from "./managementStyles";
import { supabase } from "./supabaseClient";
import { EmptyState, PrimaryButton, screenStyles } from "./ui";

type LessonFeeRow = Database["public"]["Tables"]["lesson_fees"]["Row"];
type LessonRow = Pick<Database["public"]["Tables"]["lessons"]["Row"], "student_id" | "taught_on" | "status">;
type StudentOption = { id: string; name: string };

function currentPeriod() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function periodForDate(value: string) {
  return value.slice(0, 7);
}

export function LessonFeesScreen() {
  const { session, setMessage } = useAuth();
  const [fees, setFees] = useState<LessonFeeRow[]>([]);
  const [lessons, setLessons] = useState<LessonRow[]>([]);
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [studentId, setStudentId] = useState("");
  const [period, setPeriod] = useState(currentPeriod());
  const [amount, setAmount] = useState("");
  const [plannedSessions, setPlannedSessions] = useState("");
  const [memo, setMemo] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    if (!session) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const [feesResult, connectionsResult, lessonsResult] = await Promise.all([
      supabase.from("lesson_fees").select("*").eq("teacher_id", session.user.id).order("period", { ascending: false }),
      supabase
        .from("connections")
        .select("student_id")
        .eq("teacher_id", session.user.id)
        .eq("status", "active"),
      supabase
        .from("lessons")
        .select("student_id, taught_on, status")
        .eq("teacher_id", session.user.id)
        .order("taught_on", { ascending: false })
        .limit(500)
    ]);
    const studentIds = (connectionsResult.data ?? []).map((connection) => connection.student_id);
    const profilesResult = studentIds.length
      ? await supabase.from("profiles").select("id, name").in("id", studentIds)
      : { data: [] as StudentOption[], error: null };

    setFees(feesResult.data ?? []);
    setLessons((lessonsResult.data ?? []) as LessonRow[]);
    setStudents((profilesResult.data ?? []) as StudentOption[]);
    const error = feesResult.error ?? connectionsResult.error ?? lessonsResult.error ?? profilesResult.error;
    setMessage(error?.message ?? null);
    setLoading(false);
  }, [session, setMessage]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const summary = useMemo(
    () => summarizeLessonFees(
      fees
        .filter((fee) => fee.period === currentPeriod())
        .map((fee) => ({ amount: fee.amount, paid: fee.paid }))
    ),
    [fees]
  );
  const nameByStudentId = useMemo(() => new Map(students.map((student) => [student.id, student.name])), [students]);

  async function saveMonthlyFee() {
    if (!session || !studentId) {
      setMessage("학생을 선택해 주세요.");
      return;
    }
    const periodMatch = /^(\d{4})-(\d{2})$/.exec(period);
    if (!periodMatch || Number(periodMatch[2]) < 1 || Number(periodMatch[2]) > 12) {
      setMessage("정산 월을 YYYY-MM 형식으로 입력해 주세요.");
      return;
    }
    const monthlyAmount = Number(amount.replace(/,/g, ""));
    if (!Number.isInteger(monthlyAmount) || monthlyAmount < 0) {
      setMessage("월 정액 수업료를 원 단위 숫자로 입력해 주세요.");
      return;
    }
    const planned = plannedSessions.trim() ? Number(plannedSessions) : null;
    if (planned !== null && (!Number.isInteger(planned) || planned < 1 || planned > 60)) {
      setMessage("예정 회차는 1~60회로 입력해 주세요.");
      return;
    }

    setSaving(true);
    const { error } = await supabase.from("lesson_fees").upsert(
      {
        teacher_id: session.user.id,
        student_id: studentId,
        period,
        amount: monthlyAmount,
        planned_sessions: planned,
        memo: memo.trim() || null
      },
      { onConflict: "teacher_id,student_id,period" }
    );
    setSaving(false);
    setMessage(error?.message ?? "월 수업료 기록을 저장했습니다.");
    if (!error) {
      setAmount("");
      setPlannedSessions("");
      setMemo("");
      await refresh();
    }
  }

  async function togglePaid(fee: LessonFeeRow) {
    const { error } = await supabase
      .from("lesson_fees")
      .update({ paid: !fee.paid, paid_at: fee.paid ? null : new Date().toISOString() })
      .eq("id", fee.id);
    setMessage(error?.message ?? null);
    if (!error) await refresh();
  }

  function lessonCounts(fee: LessonFeeRow) {
    const matching = lessons.filter(
      (lesson) => lesson.student_id === fee.student_id && periodForDate(lesson.taught_on) === fee.period
    );
    return {
      done: matching.filter((lesson) => lesson.status === "done").length,
      absent: matching.filter((lesson) => lesson.status === "absent").length,
      canceled: matching.filter((lesson) => lesson.status === "canceled").length
    };
  }

  return (
    <ScrollView style={screenStyles.screen} contentContainerStyle={screenStyles.content}>
      <Text style={screenStyles.heading}>수업료 관리</Text>
      <Text style={screenStyles.subtitle}>학생이 과외쌤에게 내는 월 정액 수업료를 수기로 기록해요.</Text>
      <View style={styles.notice}>
        <Text style={styles.noticeTitle}>결제 기능이 아닌 수기 트래커예요</Text>
        <Text style={styles.meta}>앱 구독료와 별개이며, 회차 × 단가로 계산하지 않습니다.</Text>
      </View>

      <View style={styles.actionRow}>
        <Stat label="이번 달 정액 합계" value={formatKrw(summary.totalAmount)} />
        <Stat label="받음" value={formatKrw(summary.paidAmount)} />
        <Stat label={`미수 ${summary.unpaidCount}건`} value={formatKrw(summary.unpaidAmount)} />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>월 수업료 기록</Text>
        {!loading && students.length === 0 ? (
          <EmptyState title="연결된 학생이 없어요" body="active 연결 학생이 생기면 수업료를 기록할 수 있어요." />
        ) : null}
        <Text style={styles.label}>학생</Text>
        <View style={styles.actionRow}>
          {students.map((student) => {
            const selected = studentId === student.id;
            return (
              <Pressable key={student.id} onPress={() => setStudentId(student.id)} style={[styles.chip, selected && styles.chipSelected]}>
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{student.name}</Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.label}>정산 월</Text>
        <TextInput value={period} onChangeText={setPeriod} placeholder="YYYY-MM" placeholderTextColor={colors.muted} style={styles.field} />
        <Text style={styles.label}>월 정액 수업료</Text>
        <TextInput value={amount} onChangeText={setAmount} keyboardType="number-pad" placeholder="예: 480000" placeholderTextColor={colors.muted} style={styles.field} />
        <Text style={styles.label}>이번 달 예정 회차</Text>
        <TextInput value={plannedSessions} onChangeText={setPlannedSessions} keyboardType="number-pad" placeholder="선택 · 예: 8" placeholderTextColor={colors.muted} style={styles.field} />
        <Text style={styles.label}>메모</Text>
        <TextInput value={memo} onChangeText={setMemo} placeholder="정산 관련 메모(선택)" placeholderTextColor={colors.muted} style={styles.field} />
        <PrimaryButton disabled={saving || students.length === 0} onPress={() => void saveMonthlyFee()}>
          {saving ? "저장 중…" : "월 수업료 저장"}
        </PrimaryButton>
      </View>

      {!loading && fees.length === 0 ? (
        <EmptyState title="아직 수업료 기록이 없어요" body="학생별 월 정액과 예정 회차를 저장하면 여기에 표시돼요." />
      ) : null}

      {fees.map((fee) => {
        const counts = lessonCounts(fee);
        const progress = fee.planned_sessions ? `${counts.done}/${fee.planned_sessions}회` : `${counts.done}회 진행`;
        return (
          <View key={fee.id} style={styles.card}>
            <View style={[styles.actionRow, { alignItems: "center" }]}>
              <View style={{ flex: 1, gap: spacing.xs }}>
                <Text style={styles.cardTitle}>{nameByStudentId.get(fee.student_id) ?? "학생"} · {fee.period}</Text>
                <Text style={styles.meta}>
                  {progress}
                  {counts.absent ? ` · 결석 ${counts.absent}회` : ""}
                  {counts.canceled ? ` · 취소 ${counts.canceled}회` : ""}
                </Text>
              </View>
              <Text style={{ color: colors.ink, fontSize: 20, fontWeight: "900" }}>{formatKrw(fee.amount)}</Text>
            </View>
            {fee.memo ? <Text style={styles.meta}>{fee.memo}</Text> : null}
            <Pressable style={styles.secondaryButton} onPress={() => void togglePaid(fee)}>
              <Text style={[styles.secondaryButtonText, { color: fee.paid ? colors.success : colors.warning }]}>
                {fee.paid ? "받음 · 미수금으로 변경" : "미수금 · 받음으로 변경"}
              </Text>
            </Pressable>
          </View>
        );
      })}
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}
