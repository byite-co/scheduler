import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { colors, spacing, tints } from "@ssamplanner/design-tokens";
import type { Database } from "@ssamplanner/shared";

import { useAuth } from "./auth";
import { managementStyles as styles } from "./managementStyles";
import { supabase } from "./supabaseClient";
import { EmptyState, PrimaryButton, screenStyles } from "./ui";

type LessonRow = Database["public"]["Tables"]["lessons"]["Row"];
type LessonStatus = "done" | "absent" | "canceled";
type StudentOption = { id: string; name: string };

const STATUS_LABELS: Record<LessonStatus, string> = {
  done: "수업 완료",
  absent: "학생 결석",
  canceled: "수업 취소"
};

function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function minutesFromTime(value: string) {
  if (!value.trim()) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return undefined;
  return hour * 60 + minute;
}

function displayTime(value: number | null) {
  if (value === null) return "시간 미입력";
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function isValidDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return false;
  const expected = `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
  return expected === value;
}

export function LessonNotesScreen() {
  const { session, setMessage } = useAuth();
  const [lessons, setLessons] = useState<LessonRow[]>([]);
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [studentId, setStudentId] = useState("");
  const [taughtOn, setTaughtOn] = useState(today());
  const [status, setStatus] = useState<LessonStatus>("done");
  const [startedAt, setStartedAt] = useState("");
  const [duration, setDuration] = useState("");
  const [memo, setMemo] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    if (!session) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const [lessonsResult, connectionsResult] = await Promise.all([
      supabase.from("lessons").select("*").eq("teacher_id", session.user.id).order("taught_on", { ascending: false }).limit(50),
      supabase
        .from("connections")
        .select("student_id")
        .eq("teacher_id", session.user.id)
        .eq("status", "active")
    ]);
    const studentIds = (connectionsResult.data ?? []).map((connection) => connection.student_id);
    const profilesResult = studentIds.length
      ? await supabase.from("profiles").select("id, name").in("id", studentIds)
      : { data: [] as StudentOption[], error: null };

    setLessons(lessonsResult.data ?? []);
    setStudents((profilesResult.data ?? []) as StudentOption[]);
    const error = lessonsResult.error ?? connectionsResult.error ?? profilesResult.error;
    setMessage(error?.message ?? null);
    setLoading(false);
  }, [session, setMessage]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const nameByStudentId = useMemo(() => new Map(students.map((student) => [student.id, student.name])), [students]);
  const todayLessons = lessons.filter((lesson) => lesson.taught_on === today());

  async function addLesson() {
    if (!session || !studentId) {
      setMessage("학생을 선택해 주세요.");
      return;
    }
    if (!isValidDate(taughtOn)) {
      setMessage("수업일을 YYYY-MM-DD 형식으로 입력해 주세요.");
      return;
    }
    const startMinutes = minutesFromTime(startedAt);
    if (startMinutes === undefined) {
      setMessage("시작 시각을 HH:MM 형식으로 입력해 주세요.");
      return;
    }
    const durationMinutes = duration.trim() ? Number(duration) : null;
    if (durationMinutes !== null && (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 600)) {
      setMessage("수업 시간은 1~600분으로 입력해 주세요.");
      return;
    }
    if (memo.length > 200) {
      setMessage("수업 메모는 200자까지 입력할 수 있어요.");
      return;
    }

    setSaving(true);
    const { error } = await supabase.from("lessons").insert({
      teacher_id: session.user.id,
      student_id: studentId,
      taught_on: taughtOn,
      status,
      started_at_min: startMinutes,
      duration_min: durationMinutes,
      memo: memo.trim() || null
    });
    setSaving(false);
    setMessage(error?.message ?? "수업 회차와 메모를 기록했습니다.");
    if (!error) {
      setStartedAt("");
      setDuration("");
      setMemo("");
      await refresh();
    }
  }

  return (
    <ScrollView style={screenStyles.screen} contentContainerStyle={screenStyles.content}>
      <Text style={screenStyles.heading}>내 수업 노트</Text>
      <Text style={screenStyles.subtitle}>수업 회차·결석·취소와 200자 메모를 가볍게 기록해요.</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>오늘 수업</Text>
        {todayLessons.length === 0 ? <Text style={styles.meta}>오늘 기록된 수업이 없어요.</Text> : null}
        {todayLessons.map((lesson) => (
          <View key={lesson.id} style={styles.row}>
            <View style={{ flex: 1, gap: spacing.xs }}>
              <Text style={styles.cardTitle}>{displayTime(lesson.started_at_min)} · {nameByStudentId.get(lesson.student_id) ?? "학생"}</Text>
              <Text style={styles.meta}>{STATUS_LABELS[lesson.status as LessonStatus]}{lesson.duration_min ? ` · ${lesson.duration_min}분` : ""}</Text>
            </View>
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>수업 기록 추가</Text>
        {!loading && students.length === 0 ? (
          <EmptyState title="연결된 학생이 없어요" body="active 연결 학생이 생기면 수업 회차를 기록할 수 있어요." />
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
        <Text style={styles.label}>수업 상태</Text>
        <View style={styles.actionRow}>
          {(Object.keys(STATUS_LABELS) as LessonStatus[]).map((item) => {
            const selected = status === item;
            return (
              <Pressable key={item} onPress={() => setStatus(item)} style={[styles.chip, selected && styles.chipSelected]}>
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{STATUS_LABELS[item]}</Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.label}>수업일</Text>
        <TextInput value={taughtOn} onChangeText={setTaughtOn} placeholder="YYYY-MM-DD" placeholderTextColor={colors.muted} style={styles.field} />
        <View style={styles.actionRow}>
          <View style={{ flex: 1, gap: spacing.sm }}>
            <Text style={styles.label}>시작 시각</Text>
            <TextInput value={startedAt} onChangeText={setStartedAt} placeholder="선택 · 16:00" placeholderTextColor={colors.muted} style={styles.field} />
          </View>
          <View style={{ flex: 1, gap: spacing.sm }}>
            <Text style={styles.label}>수업 시간(분)</Text>
            <TextInput value={duration} onChangeText={setDuration} keyboardType="number-pad" placeholder="선택 · 90" placeholderTextColor={colors.muted} style={styles.field} />
          </View>
        </View>
        <Text style={styles.label}>수업 메모</Text>
        <TextInput value={memo} onChangeText={setMemo} multiline maxLength={200} placeholder="진도·정산·다음 수업 준비 메모" placeholderTextColor={colors.muted} style={[styles.field, styles.fieldMultiline]} />
        <Text style={styles.meta}>{memo.length}/200자</Text>
        <PrimaryButton disabled={saving || students.length === 0} onPress={() => void addLesson()}>
          {saving ? "기록 중…" : "수업 기록 저장"}
        </PrimaryButton>
      </View>

      {!loading && lessons.length === 0 ? (
        <EmptyState title="아직 수업 노트가 없어요" body="수업 완료·결석·취소와 메모를 남기면 최근 기록이 여기에 쌓여요." />
      ) : null}

      {lessons.map((lesson) => (
        <View key={lesson.id} style={styles.card}>
          <View style={[styles.actionRow, { alignItems: "center" }]}>
            <View style={{ flex: 1, gap: spacing.xs }}>
              <Text style={styles.cardTitle}>{nameByStudentId.get(lesson.student_id) ?? "학생"}</Text>
              <Text style={styles.meta}>{lesson.taught_on} · {displayTime(lesson.started_at_min)}{lesson.duration_min ? ` · ${lesson.duration_min}분` : ""}</Text>
            </View>
            <View style={[styles.chip, { backgroundColor: lesson.status === "done" ? tints.successSoft : lesson.status === "absent" ? tints.warningSoft : tints.dangerSoft }]}>
              <Text style={styles.chipText}>{STATUS_LABELS[lesson.status as LessonStatus]}</Text>
            </View>
          </View>
          {lesson.memo ? <Text style={{ color: colors.ink, fontSize: 15, fontWeight: "700", lineHeight: 22 }}>{lesson.memo}</Text> : null}
        </View>
      ))}
    </ScrollView>
  );
}
