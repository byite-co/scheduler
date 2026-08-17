import { useCallback, useEffect, useState } from "react";
import { Image, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";

import { colors, radii, spacing, tints } from "@ssamplanner/design-tokens";
import {
  SUBJECT_LABELS,
  createTeacherReviewPatch,
  getTodoScopeTextForDisplay,
  type Database,
  type SubjectCode
} from "@ssamplanner/shared";

import { useAuth } from "./auth";
import { homeworkStyles as styles } from "./homeworkStyles";
import { supabase } from "./supabaseClient";
import { EmptyState, ErrorState, LoadingState, PrimaryButton, screenStyles } from "./ui";

type SubmissionRow = Pick<
  Database["public"]["Tables"]["homework_submissions"]["Row"],
  | "id"
  | "todo_id"
  | "student_id"
  | "photo_paths"
  | "submitted_at"
  | "teacher_status"
  | "teacher_comment"
  | "resubmit_requested"
>;
type TodoInfo = Pick<
  Database["public"]["Tables"]["todos"]["Row"],
  "id" | "title" | "scope_text" | "subject"
>;
type ReviewItem = SubmissionRow & {
  studentName: string;
  todoTitle: string;
  todoScopeText: string;
  todoSubject: SubjectCode | null;
  signedPhotoUrls: string[];
};
type BlockedStudent = { id: string; name: string };

function reviewStatusLabel(status: SubmissionRow["teacher_status"]) {
  if (status === "confirmed") return "통과";
  if (status === "rejected") return "미흡 · 재제출 요청";
  return "확인 대기";
}

function reviewStatusStyle(status: SubmissionRow["teacher_status"]) {
  if (status === "confirmed") return styles.statusConfirmed;
  if (status === "rejected") return styles.statusRejected;
  return styles.statusPending;
}

export function HomeworkReviewScreen() {
  const router = useRouter();
  const { session, setMessage } = useAuth();
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [blockedStudents, setBlockedStudents] = useState<BlockedStudent[]>([]);
  const [comments, setComments] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!session) {
      setItems([]);
      setBlockedStudents([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadError(null);
    const connectionsResult = await supabase
      .from("connections")
      .select("id, student_id")
      .eq("teacher_id", session.user.id)
      .eq("status", "active");
    const connections = connectionsResult.data ?? [];
    const connectionIds = connections.map((connection) => connection.id);
    const studentIds = connections.map((connection) => connection.student_id);
    const [disclosuresResult, profilesResult] = await Promise.all([
      connectionIds.length
        ? supabase
            .from("disclosure_settings")
            .select("connection_id, share_homework_photos")
            .in("connection_id", connectionIds)
        : Promise.resolve({ data: [] as Array<{ connection_id: string; share_homework_photos: boolean }>, error: null }),
      studentIds.length
        ? supabase.from("profiles").select("id, name").in("id", studentIds)
        : Promise.resolve({ data: [] as Array<{ id: string; name: string }>, error: null })
    ]);
    const nameByStudentId = new Map((profilesResult.data ?? []).map((profile) => [profile.id, profile.name]));
    const disclosureByConnectionId = new Map(
      (disclosuresResult.data ?? []).map((disclosure) => [disclosure.connection_id, disclosure.share_homework_photos])
    );
    const sharedStudentIds = connections
      .filter((connection) => disclosureByConnectionId.get(connection.id) === true)
      .map((connection) => connection.student_id);
    const privateStudents = connections
      .filter((connection) => disclosureByConnectionId.get(connection.id) !== true)
      .map((connection) => ({
        id: connection.student_id,
        name: nameByStudentId.get(connection.student_id)?.trim() || "이름 미입력"
      }));
    setBlockedStudents(privateStudents);

    const submissionsResult = sharedStudentIds.length
      ? await supabase
          .from("homework_submissions")
          .select(
            "id, todo_id, student_id, photo_paths, submitted_at, teacher_status, teacher_comment, resubmit_requested"
          )
          .in("student_id", sharedStudentIds)
          .order("submitted_at", { ascending: false })
          .limit(50)
      : { data: [] as SubmissionRow[], error: null };
    const submissions = (submissionsResult.data ?? []) as SubmissionRow[];
    const todoIds = [...new Set(submissions.map((submission) => submission.todo_id))];
    const todosResult = todoIds.length
      ? await supabase.from("todos").select("id, title, scope_text, subject").in("id", todoIds)
      : { data: [] as TodoInfo[], error: null };
    const todoById = new Map((todosResult.data ?? []).map((todo) => [todo.id, todo as TodoInfo]));

    const allPaths = submissions.flatMap((submission) => submission.photo_paths);
    const signedUrlByPath = new Map<string, string>();
    let signingError: string | null = null;
    if (allPaths.length) {
      const signedResult = await supabase.storage.from("homework-photos").createSignedUrls(allPaths, 600);
      signingError = signedResult.error?.message ?? null;
      (signedResult.data ?? []).forEach((signedPhoto, index) => {
        const path = allPaths[index];
        if (path && signedPhoto.signedUrl) signedUrlByPath.set(path, signedPhoto.signedUrl);
      });
    }

    const nextItems = submissions.map((submission) => {
      const todo = todoById.get(submission.todo_id);
      return {
        ...submission,
        studentName: nameByStudentId.get(submission.student_id)?.trim() || "이름 미입력",
        todoTitle: todo?.title ?? "숙제",
        todoScopeText: todo ? getTodoScopeTextForDisplay(todo) : "",
        todoSubject: (todo?.subject ?? null) as SubjectCode | null,
        signedPhotoUrls: submission.photo_paths
          .map((path) => signedUrlByPath.get(path))
          .filter((url): url is string => Boolean(url))
      };
    });
    setItems(nextItems);
    setComments(Object.fromEntries(nextItems.map((item) => [item.id, item.teacher_comment ?? ""])));
    const error =
      connectionsResult.error ?? disclosuresResult.error ?? profilesResult.error ?? submissionsResult.error ?? todosResult.error;
    setLoadError(error?.message ?? null);
    setMessage(error?.message ?? signingError);
    setLoading(false);
  }, [session, setMessage]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function review(item: ReviewItem, action: "confirm" | "reject") {
    setSavingId(item.id);
    const patch = createTeacherReviewPatch(action, comments[item.id]);
    const { error } = await supabase.from("homework_submissions").update(patch).eq("id", item.id);
    setSavingId(null);
    if (error) {
      setMessage(error.message);
      return;
    }
    await refresh();
    setMessage(action === "confirm" ? "통과로 확인했습니다." : "미흡으로 표시하고 재제출을 요청했습니다.");
  }

  if (loading) {
    return (
      <ScrollView style={screenStyles.screen} contentContainerStyle={screenStyles.content}>
        <Text style={screenStyles.heading}>숙제 검사</Text>
        <LoadingState label="제출 내역을 불러오는 중…" />
      </ScrollView>
    );
  }

  if (loadError) {
    return (
      <ScrollView style={screenStyles.screen} contentContainerStyle={screenStyles.content}>
        <Text style={screenStyles.heading}>숙제 검사</Text>
        <ErrorState body={loadError} onRetry={() => void refresh()} />
      </ScrollView>
    );
  }

  return (
    <ScrollView style={screenStyles.screen} contentContainerStyle={screenStyles.content}>
      <Text style={screenStyles.heading}>숙제 검사</Text>
      <Text style={screenStyles.subtitle}>AI 판정 없이 제출 사진을 직접 보고 ‘다 했는지’를 확인해요.</Text>
      <View style={styles.actionRow}>
        <View style={{ flex: 1 }}>
          <PrimaryButton onPress={() => router.push("/homework/new")}>+ 숙제 내기</PrimaryButton>
        </View>
        <Pressable style={styles.secondaryButton} onPress={() => router.push("/homework")}>
          <Text style={styles.secondaryButtonText}>낸 숙제</Text>
        </Pressable>
      </View>

      {blockedStudents.map((student) => (
        <View key={student.id} style={styles.notice}>
          <Text style={styles.noticeTitle}>{student.name} 학생의 숙제 사진은 비공개예요</Text>
          <Text style={styles.meta}>학생이 숙제 사진을 공개하지 않았어요. 공개 범위는 학생 앱에서만 수정할 수 있습니다.</Text>
        </View>
      ))}

      {items.length === 0 ? (
        <EmptyState
          title="아직 검사할 제출이 없어요"
          body="학생이 숙제를 제출하고 사진 공개를 허용하면 여기에서 직접 확인할 수 있어요."
        />
      ) : null}

      {items.map((item) => (
        <View key={item.id} style={styles.card}>
          <View style={styles.actionRow}>
            <View style={{ flex: 1, gap: spacing.xs }}>
              <Text style={styles.cardTitle}>{item.todoTitle}</Text>
              <Text style={styles.meta}>
                {item.studentName}
                {item.todoSubject ? ` · ${SUBJECT_LABELS[item.todoSubject]}` : ""}
                {` · ${new Date(item.submitted_at).toLocaleDateString("ko-KR")}`}
              </Text>
            </View>
            <View style={[styles.statusBadge, reviewStatusStyle(item.teacher_status)]}>
              <Text style={[styles.statusText, { color: colors.ink }]}>{reviewStatusLabel(item.teacher_status)}</Text>
            </View>
          </View>

          {item.todoScopeText && item.todoScopeText !== item.todoTitle ? (
            <Text style={styles.meta}>검사 범위 · {item.todoScopeText}</Text>
          ) : null}

          {item.signedPhotoUrls.length === 0 ? (
            <View style={styles.notice}>
              <Text style={styles.noticeTitle}>열 수 있는 제출 사진이 없어요</Text>
              <Text style={styles.meta}>사진이 삭제됐거나 서명 URL을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.</Text>
            </View>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
              {item.signedPhotoUrls.map((url, index) => (
                <Image
                  key={`${item.id}-${index}`}
                  source={{ uri: url }}
                  accessibilityLabel={`${item.studentName} 학생 숙제 사진 ${index + 1}`}
                  style={{ width: 220, height: 220, borderRadius: radii.button, backgroundColor: tints.brandSoft }}
                  resizeMode="cover"
                />
              ))}
            </ScrollView>
          )}

          <Text style={styles.label}>과외쌤 메모</Text>
          <TextInput
            value={comments[item.id] ?? ""}
            onChangeText={(value) => setComments((current) => ({ ...current, [item.id]: value }))}
            placeholder="학생에게 전달할 확인 의견"
            placeholderTextColor={colors.muted}
            multiline
            style={[styles.field, styles.fieldMultiline]}
          />
          <View style={styles.actionRow}>
            <Pressable
              disabled={savingId === item.id}
              onPress={() => void review(item, "reject")}
              style={[styles.secondaryButton, { borderColor: colors.danger }]}
            >
              <Text style={[styles.secondaryButtonText, { color: colors.danger }]}>미흡 · 재제출 요청</Text>
            </Pressable>
            <Pressable
              disabled={savingId === item.id}
              onPress={() => void review(item, "confirm")}
              style={[styles.secondaryButton, { backgroundColor: colors.brand, borderColor: colors.brand }]}
            >
              <Text style={[styles.secondaryButtonText, { color: colors.surface }]}>통과</Text>
            </Pressable>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}
