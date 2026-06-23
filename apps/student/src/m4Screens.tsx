import { useCallback, useEffect, useMemo, useState } from "react";

import { router, useLocalSearchParams } from "expo-router";
import { createClient, type Session } from "@supabase/supabase-js";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { colors, radii, spacing, typography } from "@ssamplanner/design-tokens";
import {
  HOMEWORK_CHECK_DISCLAIMER,
  SUBJECT_LABELS,
  getHomeworkResultView,
  type HomeworkResultView,
  type HomeworkVerdictTone
} from "@ssamplanner/shared";
import type { Database, SubjectCode } from "@ssamplanner/shared";

type TodoRow = Database["public"]["Tables"]["todos"]["Row"];
type SubmissionRow = Database["public"]["Tables"]["homework_submissions"]["Row"];
type ConnectionRow = Database["public"]["Tables"]["connections"]["Row"];

const supabase = createClient<Database>(
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""
);

type SubmitState = "idle" | "uploading" | "checking" | "upload_failed" | "check_failed";

function useHomeworkData(todoId: string | undefined) {
  const [session, setSession] = useState<Session | null>(null);
  const [todo, setTodo] = useState<TodoRow | null>(null);
  const [submission, setSubmission] = useState<SubmissionRow | null>(null);
  const [isTutored, setIsTutored] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("숙제 정보를 불러오는 중");

  const refresh = useCallback(async () => {
    setLoading(true);
    const activeSession = (await supabase.auth.getSession()).data.session;
    setSession(activeSession);
    if (!activeSession) {
      setMessage("로그인이 필요해요.");
      setLoading(false);
      return;
    }
    if (!todoId) {
      setMessage("숙제를 찾을 수 없어요.");
      setLoading(false);
      return;
    }

    const userId = activeSession.user.id;
    const [todoResult, submissionResult, connectionResult] = await Promise.all([
      supabase.from("todos").select("*").eq("id", todoId).maybeSingle(),
      supabase
        .from("homework_submissions")
        .select("*")
        .eq("todo_id", todoId)
        .eq("student_id", userId)
        .order("submitted_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("connections")
        .select("id, status")
        .eq("student_id", userId)
        .eq("status", "active")
        .limit(1)
    ]);

    setTodo(todoResult.data ?? null);
    setSubmission(submissionResult.data ?? null);
    setIsTutored(((connectionResult.data as ConnectionRow[] | null) ?? []).length > 0);
    setMessage(todoResult.error?.message ?? "숙제 정보를 불러왔어요.");
    setLoading(false);
  }, [todoId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { session, todo, submission, isTutored, loading, message, refresh, setMessage };
}

export function HomeworkSubmitScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const todoId = typeof params.id === "string" ? params.id : undefined;
  const data = useHomeworkData(todoId);
  const [photoCount, setPhotoCount] = useState(1);
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [errorText, setErrorText] = useState<string | null>(null);

  const busy = submitState === "uploading" || submitState === "checking";

  async function submit() {
    if (!data.session || !todoId) return;
    setErrorText(null);
    setSubmitState("uploading");

    const userId = data.session.user.id;
    // NOTE(stub): 실제 사진 캡처/업로드는 디바이스 전용. 이 빌드에서는 첨부 장수만 경로 메타로 남긴다.
    // homework-photos 버킷/정책은 준비됨(20260624010000) — 실기기에서 바이트 업로드로 교체.
    const photoPaths = Array.from({ length: photoCount }, (_, index) => `${userId}/${todoId}/page-${index + 1}.jpg`);

    const inserted = await supabase
      .from("homework_submissions")
      .insert({ todo_id: todoId, student_id: userId, photo_paths: photoPaths })
      .select("id")
      .single();

    if (inserted.error || !inserted.data) {
      setSubmitState("upload_failed");
      setErrorText(inserted.error?.message ?? "제출을 저장하지 못했어요.");
      return;
    }

    setSubmitState("checking");
    const checked = await supabase.functions.invoke("ai-homework-check", {
      body: { submissionId: inserted.data.id }
    });

    if (checked.error) {
      // 제출 자체는 저장됨 — 검사만 실패(H3).
      setSubmitState("check_failed");
      setErrorText("AI 검사를 끝내지 못했어요. 다시 시도하거나 잠시 후 결과를 확인해요.");
      return;
    }

    await data.refresh();
    router.replace({ pathname: "/homework/[id]/result", params: { id: todoId } });
  }

  if (data.loading) return <CenterCard text={data.message} />;
  if (!data.session) return <CenterCard text="로그인이 필요해요." />;
  if (!data.todo) return <CenterCard text="숙제를 찾을 수 없어요." />;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.scrollContent}>
      <Text style={styles.kicker}>AI 완료검사</Text>
      <Text style={styles.title}>{data.todo.title}</Text>
      <Text style={styles.subtitle}>
        {data.todo.subject ? SUBJECT_LABELS[data.todo.subject as SubjectCode] : "과목 미지정"} · 채점이 아니라 “다 했는지” 확인해요
      </Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>제출 사진</Text>
        <Text style={styles.cardBody}>풀이를 찍은 사진을 첨부해요. (사진 캡처/업로드는 실기기 전용 — 이 미리보기에서는 장수만 기록)</Text>
        <View style={styles.stepperRow}>
          <Stepper label="−" disabled={busy || photoCount <= 0} onPress={() => setPhotoCount((n) => Math.max(0, n - 1))} />
          <Text style={styles.stepperValue}>{photoCount}장</Text>
          <Stepper label="+" disabled={busy || photoCount >= 9} onPress={() => setPhotoCount((n) => Math.min(9, n + 1))} />
        </View>
      </View>

      {submitState === "upload_failed" ? (
        <StatusBanner tone="danger" title="업로드 실패" body={errorText ?? "다시 시도해 주세요."} />
      ) : null}
      {submitState === "check_failed" ? (
        <StatusBanner tone="warning" title="검사 실패" body={errorText ?? "다시 시도해 주세요."} />
      ) : null}

      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={() => void submit()}
        style={[styles.primaryButton, busy ? styles.primaryButtonBusy : null]}
      >
        {busy ? (
          <View style={styles.row}>
            <ActivityIndicator color={colors.surface} />
            <Text style={styles.primaryButtonText}>{submitState === "uploading" ? "제출 중…" : "AI 검사 중…"}</Text>
          </View>
        ) : (
          <Text style={styles.primaryButtonText}>{submitState === "check_failed" ? "다시 검사" : "제출하고 검사 받기"}</Text>
        )}
      </Pressable>

      {submitState === "check_failed" ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            if (todoId) router.replace({ pathname: "/homework/[id]/result", params: { id: todoId } });
          }}
          style={styles.ghostButton}
        >
          <Text style={styles.ghostButtonText}>제출만 두고 나중에 결과 보기</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

export function HomeworkResultScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const todoId = typeof params.id === "string" ? params.id : undefined;
  const data = useHomeworkData(todoId);

  const view: HomeworkResultView | null = useMemo(
    () => (data.submission ? getHomeworkResultView(data.submission, { isTutored: data.isTutored }) : null),
    [data.submission, data.isTutored]
  );

  if (data.loading) return <CenterCard text={data.message} />;
  if (!data.submission || !view) return <CenterCard text="아직 제출 내역이 없어요." />;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.scrollContent}>
      <Text style={styles.kicker}>검사 결과</Text>
      <Text style={styles.title}>{data.todo?.title ?? "숙제"}</Text>

      <View style={[styles.card, styles.verdictCard]}>
        <View style={styles.row}>
          <Badge tone={view.verdictTone} label={view.verdictLabel} />
          {view.confidencePercent !== null ? (
            <Text style={styles.confidence}>확신도 {view.confidencePercent}%</Text>
          ) : null}
        </View>
        {view.reason ? <Text style={styles.reason}>{view.reason}</Text> : null}
        <Text style={styles.disclaimer}>{HOMEWORK_CHECK_DISCLAIMER}</Text>
      </View>

      {view.showTeacherSection ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>선생님 확인</Text>
          <Text style={styles.cardBody}>{view.teacherStatusLabel}</Text>
          {view.teacherComment ? <Text style={styles.teacherComment}>“{view.teacherComment}”</Text> : null}
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.cardBody}>혼자 공부 중이라 AI 검사 결과만 보여드려요.</Text>
        </View>
      )}

      {view.canRequestResubmit ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            if (todoId) router.replace({ pathname: "/homework/[id]/submit", params: { id: todoId } });
          }}
          style={styles.primaryButton}
        >
          <Text style={styles.primaryButtonText}>다시 제출하기</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

export function HomeworkDetailScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const todoId = typeof params.id === "string" ? params.id : undefined;
  const data = useHomeworkData(todoId);

  if (data.loading) return <CenterCard text={data.message} />;

  const waitingForTeacher =
    data.isTutored && data.submission?.ai_verdict != null && data.submission?.teacher_status === "pending";

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.scrollContent}>
      <Text style={styles.kicker}>숙제</Text>
      <Text style={styles.title}>{data.todo?.title ?? "숙제"}</Text>

      {!data.submission ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            if (todoId) router.push({ pathname: "/homework/[id]/submit", params: { id: todoId } });
          }}
          style={styles.primaryButton}
        >
          <Text style={styles.primaryButtonText}>숙제 제출하기</Text>
        </Pressable>
      ) : waitingForTeacher ? (
        <StatusBanner tone="muted" title="쌤 확인 전" body="AI 검사는 끝났어요. 선생님 확인을 기다리고 있어요." />
      ) : (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            if (todoId) router.push({ pathname: "/homework/[id]/result", params: { id: todoId } });
          }}
          style={styles.primaryButton}
        >
          <Text style={styles.primaryButtonText}>검사 결과 보기</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

function Stepper({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.stepper, disabled ? styles.stepperDisabled : null]}>
      <Text style={styles.stepperLabel}>{label}</Text>
    </Pressable>
  );
}

function Badge({ tone, label }: { tone: HomeworkVerdictTone; label: string }) {
  return (
    <View style={[styles.badge, badgeToneStyle(tone)]}>
      <Text style={[styles.badgeText, badgeTextToneStyle(tone)]}>{label}</Text>
    </View>
  );
}

function StatusBanner({ tone, title, body }: { tone: HomeworkVerdictTone; title: string; body: string }) {
  return (
    <View style={[styles.banner, badgeToneStyle(tone)]}>
      <Text style={[styles.bannerTitle, badgeTextToneStyle(tone)]}>{title}</Text>
      <Text style={styles.bannerBody}>{body}</Text>
    </View>
  );
}

function CenterCard({ text }: { text: string }) {
  return (
    <View style={styles.center}>
      <Text style={styles.centerText}>{text}</Text>
    </View>
  );
}

function badgeToneStyle(tone: HomeworkVerdictTone) {
  switch (tone) {
    case "success":
      return { backgroundColor: "#E6F7EF", borderColor: "#BFEFD7" };
    case "danger":
      return { backgroundColor: "#FDECEA", borderColor: "#F7C7C2" };
    case "warning":
      return { backgroundColor: "#FFF6E0", borderColor: "#F4E2A8" };
    default:
      return { backgroundColor: colors.canvas, borderColor: colors.line };
  }
}

function badgeTextToneStyle(tone: HomeworkVerdictTone) {
  switch (tone) {
    case "success":
      return { color: colors.success };
    case "danger":
      return { color: colors.danger };
    case "warning":
      return { color: colors.warning };
    default:
      return { color: colors.muted };
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  scrollContent: { padding: spacing.lg, gap: spacing.md },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, backgroundColor: colors.canvas },
  centerText: { color: colors.muted, fontSize: 15, fontWeight: "700" },
  kicker: { color: colors.flame, fontSize: 13, fontWeight: "900", letterSpacing: 0.4 },
  title: { color: colors.ink, fontSize: 22, fontWeight: "900", lineHeight: 28 },
  subtitle: { color: colors.muted, fontSize: 14, fontWeight: "700", lineHeight: 20 },
  card: {
    gap: spacing.sm,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.card,
    backgroundColor: colors.surface
  },
  verdictCard: { borderColor: colors.brand },
  cardTitle: { color: colors.ink, fontSize: 16, fontWeight: "900" },
  cardBody: { color: colors.muted, fontSize: 14, fontWeight: "700", lineHeight: 20 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  stepperRow: { flexDirection: "row", alignItems: "center", gap: spacing.lg, marginTop: spacing.xs },
  stepper: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.button,
    backgroundColor: colors.canvas,
    borderWidth: 1,
    borderColor: colors.line
  },
  stepperDisabled: { opacity: 0.4 },
  stepperLabel: { color: colors.ink, fontSize: 20, fontWeight: "900" },
  stepperValue: { color: colors.ink, fontSize: 18, fontWeight: "900", fontVariant: [typography.numericVariant] },
  primaryButton: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.button,
    backgroundColor: colors.brand,
    paddingHorizontal: spacing.xl
  },
  primaryButtonBusy: { opacity: 0.8 },
  primaryButtonText: { color: colors.surface, fontSize: 15, fontWeight: "900" },
  ghostButton: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  ghostButtonText: { color: colors.brand, fontSize: 14, fontWeight: "800" },
  confidence: { color: colors.muted, fontSize: 13, fontWeight: "800", fontVariant: [typography.numericVariant] },
  reason: { color: colors.ink, fontSize: 15, fontWeight: "700", lineHeight: 22 },
  disclaimer: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  teacherComment: { color: colors.ink, fontSize: 14, fontWeight: "800", lineHeight: 21 },
  badge: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radii.chip, borderWidth: 1 },
  badgeText: { fontSize: 14, fontWeight: "900" },
  banner: { gap: spacing.xs, padding: spacing.md, borderRadius: radii.control, borderWidth: 1 },
  bannerTitle: { fontSize: 14, fontWeight: "900" },
  bannerBody: { color: colors.muted, fontSize: 13, fontWeight: "700", lineHeight: 19 }
});
