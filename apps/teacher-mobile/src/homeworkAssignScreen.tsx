import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";

import { colors, spacing } from "@ssamplanner/design-tokens";
import {
  SUBJECT_LABELS,
  TODO_SCOPE_TEXT_ERROR_MESSAGES,
  TODO_SCOPE_TEXT_MAX_LENGTH,
  countTodoScopeTextLength,
  isTodoScopeTextRequired,
  normalizeTodoScopeText,
  validateTodoScopeTextForSave,
  type SubjectCode
} from "@ssamplanner/shared";

import { useAuth } from "./auth";
import { homeworkStyles as styles } from "./homeworkStyles";
import { supabase } from "./supabaseClient";
import { EmptyState, PrimaryButton, screenStyles } from "./ui";

type StudentOption = {
  connectionId: string;
  studentId: string;
  name: string;
};

const SUBJECTS: SubjectCode[] = ["math", "english", "korean", "science", "social", "etc"];

export function HomeworkAssignScreen() {
  const { session, setMessage } = useAuth();
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [studentId, setStudentId] = useState("");
  const [title, setTitle] = useState("");
  const [scopeText, setScopeText] = useState("");
  const [subject, setSubject] = useState<SubjectCode>("math");
  const [dueDate, setDueDate] = useState("");
  const [aiCheckEnabled, setAiCheckEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadStudents = useCallback(async () => {
    if (!session) {
      setStudents([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const connectionsResult = await supabase
      .from("connections")
      .select("id, student_id")
      .eq("teacher_id", session.user.id)
      .eq("status", "active");
    const connections = connectionsResult.data ?? [];
    const studentIds = connections.map((connection) => connection.student_id);
    const profilesResult = studentIds.length
      ? await supabase.from("profiles").select("id, name").in("id", studentIds)
      : { data: [] as Array<{ id: string; name: string }> };
    const nameById = new Map((profilesResult.data ?? []).map((profile) => [profile.id, profile.name]));

    setStudents(
      connections.map((connection) => ({
        connectionId: connection.id,
        studentId: connection.student_id,
        name: nameById.get(connection.student_id) ?? "학생"
      }))
    );
    setMessage(connectionsResult.error?.message ?? null);
    setLoading(false);
  }, [session, setMessage]);

  useEffect(() => {
    void loadStudents();
  }, [loadStudents]);

  const selectedStudent = useMemo(
    () => students.find((student) => student.studentId === studentId) ?? null,
    [studentId, students]
  );
  const scopeRequired = isTodoScopeTextRequired({ aiCheckEnabled });
  const scopeCount = countTodoScopeTextLength(scopeText);
  const scopeError = validateTodoScopeTextForSave(scopeText, { aiCheckEnabled });

  async function assignHomework() {
    if (!session || !selectedStudent) {
      setMessage("연결된 학생을 선택해 주세요.");
      return;
    }
    if (!title.trim()) {
      setMessage("숙제 제목을 입력해 주세요.");
      return;
    }
    if (scopeError) {
      setMessage(TODO_SCOPE_TEXT_ERROR_MESSAGES[scopeError]);
      return;
    }

    setSaving(true);
    const { error } = await supabase.from("todos").insert({
      student_id: selectedStudent.studentId,
      connection_id: selectedStudent.connectionId,
      created_by: session.user.id,
      source: "teacher",
      title: title.trim(),
      scope_text: normalizeTodoScopeText(scopeText),
      subject,
      due_date: dueDate.trim() || null,
      ai_check_enabled: aiCheckEnabled,
      locked: true,
      status: "todo"
    });
    setSaving(false);
    setMessage(error?.message ?? "숙제를 출제했습니다.");

    if (!error) {
      setTitle("");
      setScopeText("");
      setDueDate("");
    }
  }

  return (
    <ScrollView style={screenStyles.screen} contentContainerStyle={screenStyles.content}>
      <Text style={screenStyles.heading}>숙제 출제</Text>
      <Text style={screenStyles.subtitle}>연결된 학생에게 제목, 검사 범위와 마감일을 지정해요.</Text>

      <View style={styles.card}>
        <Text style={styles.label}>학생 선택</Text>
        {!loading && students.length === 0 ? (
          <EmptyState title="연결된 학생이 없어요" body="학생 연결이 active가 되면 숙제를 낼 수 있어요." />
        ) : null}
        <View style={styles.actionRow}>
          {students.map((student) => {
            const selected = student.studentId === studentId;
            return (
              <Pressable
                key={student.studentId}
                onPress={() => setStudentId(student.studentId)}
                style={[styles.chip, selected && styles.chipSelected]}
              >
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{student.name}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>과목</Text>
        <View style={styles.actionRow}>
          {SUBJECTS.map((item) => {
            const selected = subject === item;
            return (
              <Pressable key={item} onPress={() => setSubject(item)} style={[styles.chip, selected && styles.chipSelected]}>
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{SUBJECT_LABELS[item]}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.label}>숙제 제목</Text>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="예: 미적분 단원 마무리 — 쎈 C단계"
          placeholderTextColor={colors.muted}
          style={styles.field}
        />

        <Text style={styles.label}>검사 범위 {scopeRequired ? "(필수)" : "(선택)"}</Text>
        <TextInput
          value={scopeText}
          onChangeText={setScopeText}
          placeholder="예: 쎈 112~118쪽, 115쪽 제외"
          placeholderTextColor={colors.muted}
          multiline
          style={[styles.field, styles.fieldMultiline]}
        />
        <Text style={styles.meta}>사진 검사 기준이 되는 교재·페이지·문제 번호를 적어 주세요.</Text>
        <Text style={[styles.meta, scopeCount > TODO_SCOPE_TEXT_MAX_LENGTH && { color: colors.danger }]}>
          공백 제외 {scopeCount} / {TODO_SCOPE_TEXT_MAX_LENGTH}자
        </Text>

        <Text style={styles.label}>마감일</Text>
        <TextInput
          value={dueDate}
          onChangeText={setDueDate}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={colors.muted}
          style={styles.field}
        />
      </View>

      <View style={styles.switchRow}>
        <View style={{ flex: 1, gap: spacing.xs }}>
          <Text style={styles.noticeTitle}>사진 검사 사용</Text>
          <Text style={styles.meta}>켜면 검사 범위가 필수예요. AI 결과는 과외쌤 앱에 표시하지 않습니다.</Text>
        </View>
        <Switch
          value={aiCheckEnabled}
          onValueChange={setAiCheckEnabled}
          trackColor={{ false: colors.line, true: colors.flame }}
        />
      </View>

      <PrimaryButton disabled={saving || loading || students.length === 0} onPress={() => void assignHomework()}>
        {saving ? "출제 중…" : "숙제 추가"}
      </PrimaryButton>
    </ScrollView>
  );
}
