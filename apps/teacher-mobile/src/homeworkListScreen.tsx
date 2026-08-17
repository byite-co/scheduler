import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";

import { colors } from "@ssamplanner/design-tokens";
import { SUBJECT_LABELS, getTodoScopeTextForDisplay, type Database, type SubjectCode } from "@ssamplanner/shared";

import { useAuth } from "./auth";
import { homeworkStyles as styles } from "./homeworkStyles";
import { supabase } from "./supabaseClient";
import { EmptyState, ErrorState, LoadingState, PrimaryButton, screenStyles } from "./ui";

type TodoRow = Pick<
  Database["public"]["Tables"]["todos"]["Row"],
  "id" | "student_id" | "title" | "subject" | "scope_text" | "due_date" | "status" | "created_at"
>;
type SubmissionRow = Pick<
  Database["public"]["Tables"]["homework_submissions"]["Row"],
  "id" | "todo_id" | "submitted_at" | "teacher_status" | "resubmit_requested"
>;
type HomeworkItem = TodoRow & {
  photoSharingAllowed: boolean;
  studentName: string;
  submission: SubmissionRow | null;
};

function submissionLabel(item: HomeworkItem) {
  if (!item.photoSharingAllowed) return "사진 비공개";
  if (!item.submission) return "미제출";
  if (item.submission.teacher_status === "confirmed") return "통과";
  if (item.submission.teacher_status === "rejected") return "미흡 · 재제출 요청";
  return "확인 대기";
}

function submissionStyle(item: HomeworkItem) {
  if (!item.photoSharingAllowed) return styles.statusPrivate;
  if (!item.submission) return styles.statusPending;
  if (item.submission.teacher_status === "confirmed") return styles.statusConfirmed;
  if (item.submission.teacher_status === "rejected") return styles.statusRejected;
  return styles.statusPending;
}

export function HomeworkListScreen() {
  const router = useRouter();
  const { session, setMessage } = useAuth();
  const [items, setItems] = useState<HomeworkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!session) {
      setItems([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadError(null);
    const todosResult = await supabase
      .from("todos")
      .select("id, student_id, title, subject, scope_text, due_date, status, created_at")
      .eq("created_by", session.user.id)
      .eq("source", "teacher")
      .order("created_at", { ascending: false });
    const todos = (todosResult.data ?? []) as TodoRow[];
    const studentIds = [...new Set(todos.map((todo) => todo.student_id))];
    const [connectionsResult, profilesResult] = await Promise.all([
      studentIds.length
        ? supabase
            .from("connections")
            .select("id, student_id")
            .eq("teacher_id", session.user.id)
            .eq("status", "active")
            .in("student_id", studentIds)
        : Promise.resolve({ data: [] as Array<{ id: string; student_id: string }>, error: null }),
      studentIds.length
        ? supabase.from("profiles").select("id, name").in("id", studentIds)
        : Promise.resolve({ data: [] as Array<{ id: string; name: string }>, error: null })
    ]);
    const connections = connectionsResult.data ?? [];
    const connectionIds = connections.map((connection) => connection.id);
    const disclosuresResult = connectionIds.length
      ? await supabase
          .from("disclosure_settings")
          .select("connection_id, share_homework_photos")
          .in("connection_id", connectionIds)
      : { data: [] as Array<{ connection_id: string; share_homework_photos: boolean }>, error: null };
    const disclosureByConnectionId = new Map(
      (disclosuresResult.data ?? []).map((disclosure) => [disclosure.connection_id, disclosure.share_homework_photos])
    );
    const sharingByStudentId = new Map(
      connections.map((connection) => [connection.student_id, disclosureByConnectionId.get(connection.id) === true])
    );
    const visibleTodoIds = todos
      .filter((todo) => sharingByStudentId.get(todo.student_id) === true)
      .map((todo) => todo.id);
    const submissionsResult = visibleTodoIds.length
      ? await supabase
          .from("homework_submissions")
          .select("id, todo_id, submitted_at, teacher_status, resubmit_requested")
          .in("todo_id", visibleTodoIds)
          .order("submitted_at", { ascending: false })
      : { data: [] as SubmissionRow[], error: null };
    const latestSubmissionByTodo = new Map<string, SubmissionRow>();
    for (const submission of submissionsResult.data ?? []) {
      if (!latestSubmissionByTodo.has(submission.todo_id)) {
        latestSubmissionByTodo.set(submission.todo_id, submission as SubmissionRow);
      }
    }
    const nameByStudentId = new Map((profilesResult.data ?? []).map((profile) => [profile.id, profile.name]));

    setItems(
      todos.map((todo) => ({
        ...todo,
        photoSharingAllowed: sharingByStudentId.get(todo.student_id) === true,
        studentName: nameByStudentId.get(todo.student_id)?.trim() || "이름 미입력",
        submission: latestSubmissionByTodo.get(todo.id) ?? null
      }))
    );
    const error =
      todosResult.error ?? connectionsResult.error ?? disclosuresResult.error ?? submissionsResult.error ?? profilesResult.error;
    setLoadError(error?.message ?? null);
    setMessage(error?.message ?? null);
    setLoading(false);
  }, [session, setMessage]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (loading) {
    return (
      <ScrollView style={screenStyles.screen} contentContainerStyle={screenStyles.content}>
        <Text style={screenStyles.heading}>낸 숙제</Text>
        <LoadingState label="숙제 목록을 불러오는 중…" />
      </ScrollView>
    );
  }

  if (loadError) {
    return (
      <ScrollView style={screenStyles.screen} contentContainerStyle={screenStyles.content}>
        <Text style={screenStyles.heading}>낸 숙제</Text>
        <ErrorState body={loadError} onRetry={() => void refresh()} />
      </ScrollView>
    );
  }

  return (
    <ScrollView style={screenStyles.screen} contentContainerStyle={screenStyles.content}>
      <Text style={screenStyles.heading}>낸 숙제</Text>
      <Text style={screenStyles.subtitle}>학생별 제출 여부와 과외쌤 확인 상태를 한눈에 봐요.</Text>
      <View style={styles.actionRow}>
        <View style={{ flex: 1 }}>
          <PrimaryButton onPress={() => router.push("/homework/new")}>+ 숙제 내기</PrimaryButton>
        </View>
        <Pressable style={styles.secondaryButton} onPress={() => router.push("/homework/review")}>
          <Text style={styles.secondaryButtonText}>제출 검사</Text>
        </Pressable>
      </View>

      {items.length === 0 ? (
        <EmptyState title="아직 낸 숙제가 없어요" body="연결된 학생에게 첫 숙제를 내면 제출 현황이 여기에 표시돼요." />
      ) : null}

      {items.map((item) => {
        const scope = getTodoScopeTextForDisplay(item);
        return (
          <View key={item.id} style={styles.card}>
            <View style={styles.actionRow}>
              <Text style={[styles.cardTitle, { flex: 1 }]}>{item.title}</Text>
              <View style={[styles.statusBadge, submissionStyle(item)]}>
                <Text style={[styles.statusText, { color: colors.ink }]}>{submissionLabel(item)}</Text>
              </View>
            </View>
            <Text style={styles.meta}>
              {item.studentName}
              {item.subject ? ` · ${SUBJECT_LABELS[item.subject as SubjectCode]}` : ""}
              {item.due_date ? ` · 마감 ${item.due_date}` : ""}
            </Text>
            {scope && scope !== item.title ? <Text style={styles.meta}>검사 범위 · {scope}</Text> : null}
            {!item.photoSharingAllowed ? (
              <Text style={styles.meta}>학생이 숙제 사진을 공개하지 않았어요. 제출 여부를 미제출로 추정하지 않습니다.</Text>
            ) : null}
            {item.photoSharingAllowed && !item.submission ? (
              <Text style={styles.meta}>학생이 제출하면 검사 화면에서 사진을 확인할 수 있어요.</Text>
            ) : null}
          </View>
        );
      })}
    </ScrollView>
  );
}
