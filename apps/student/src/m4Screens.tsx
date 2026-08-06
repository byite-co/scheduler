import { useCallback, useEffect, useMemo, useState } from "react";

import { router, useLocalSearchParams } from "expo-router";
import type { Session } from "@supabase/supabase-js";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { colors, radii, spacing, tints, typography } from "@ssamplanner/design-tokens";
import {
  AI_CHECK_RESULTS_ENABLED,
  HOMEWORK_CHECK_DISCLAIMER,
  HOMEWORK_PHOTO_ERROR_MESSAGES,
  HOMEWORK_PHOTO_MAX_COUNT,
  HOMEWORK_PHOTO_TIPS,
  SUBJECT_LABELS,
  getAiCheckPausedStudentNotice,
  getHomeworkCheckErrorMessage,
  getHomeworkResultView,
  getTodoScopeTextForDisplay,
  validateHomeworkPhotos,
  type HomeworkResultView,
  type HomeworkVerdictTone
} from "@ssamplanner/shared";
import type { Database, SubjectCode } from "@ssamplanner/shared";

import { AppIcon } from "./icons";
import {
  pickHomeworkPhotos,
  removeHomeworkPhotos,
  uploadHomeworkPhotos,
  type PickSource,
  type PickedPhoto
} from "./homeworkPhotos";
import { supabase } from "./supabaseClient";

type TodoRow = Database["public"]["Tables"]["todos"]["Row"];
type SubmissionRow = Database["public"]["Tables"]["homework_submissions"]["Row"];
type ConnectionRow = Database["public"]["Tables"]["connections"]["Row"];

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
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [errorText, setErrorText] = useState<string | null>(null);

  const busy = submitState === "uploading" || submitState === "checking";

  async function addPhotos(source: PickSource) {
    setErrorText(null);
    try {
      const picked = await pickHomeworkPhotos(source, HOMEWORK_PHOTO_MAX_COUNT - photos.length);
      if (picked.length === 0) return;
      // 서버(버킷 제한 + subs_photo_count)와 같은 규칙을 미리 적용해 고른 직후에 알려준다.
      const invalid = validateHomeworkPhotos([...photos, ...picked]);
      if (invalid) {
        setErrorText(HOMEWORK_PHOTO_ERROR_MESSAGES[invalid]);
        return;
      }
      setPhotos((current) => [...current, ...picked]);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "사진을 불러오지 못했어요.");
    }
  }

  function removePhotoAt(index: number) {
    setPhotos((current) => current.filter((_, i) => i !== index));
  }

  async function submit() {
    if (!data.session || !todoId) return;
    setErrorText(null);

    const invalid = validateHomeworkPhotos(photos);
    if (invalid) {
      setErrorText(HOMEWORK_PHOTO_ERROR_MESSAGES[invalid]);
      return;
    }

    setSubmitState("uploading");
    const userId = data.session.user.id;

    // 제출마다 폴더를 나눈다 — 재제출이 이전 제출의 사진을 덮어쓰면 그 제출의 AI 판정 근거가
    // 사라진다(attempt 는 경로 스냅샷만 갖는다).
    const submissionKey = `${Date.now()}`;
    let uploadedPaths: string[] = [];
    try {
      const uploaded = await uploadHomeworkPhotos({
        studentId: userId,
        todoId,
        submissionKey,
        photos
      });
      uploadedPaths = uploaded.map((item) => item.path);
    } catch (error) {
      setSubmitState("upload_failed");
      setErrorText(error instanceof Error ? error.message : "사진을 올리지 못했어요.");
      return;
    }

    const inserted = await supabase
      .from("homework_submissions")
      .insert({ todo_id: todoId, student_id: userId, photo_paths: uploadedPaths })
      .select("id")
      .single();

    if (inserted.error || !inserted.data) {
      // 제출 레코드가 안 생겼으면 올린 파일은 아무것도 가리키지 않는 고아가 된다 → 되돌린다.
      await removeHomeworkPhotos(uploadedPaths);
      setSubmitState("upload_failed");
      setErrorText(inserted.error?.message ?? "제출을 저장하지 못했어요.");
      return;
    }

    // 판정 노출이 꺼져 있으면 **호출하지 않는다** — 보여주지 않을 결과에 돈을 쓸 이유가 없다.
    // (호출을 막는 것이 비용 0 의 조건이다. Edge Function 도 같은 플래그로 스스로 거절하지만,
    //  그건 우회·구버전 클라이언트용 2차 방어선이다.)
    if (!AI_CHECK_RESULTS_ENABLED) {
      await data.refresh();
      router.replace({ pathname: "/homework/[id]/result", params: { id: todoId } });
      return;
    }

    setSubmitState("checking");
    const checked = await supabase.functions.invoke("ai-homework-check", {
      body: { submissionId: inserted.data.id, idempotencyKey: `${inserted.data.id}:${submissionKey}` }
    });

    if (checked.error) {
      // 제출 자체는 저장됐다 — 검사만 실패(H3). AI 는 조수이므로 여기서 막지 않고
      // 과외쌤 수동 검사로 넘어간다. 서버가 준 errorCode 로 안내 문구를 고른다.
      let code: string | null = null;
      try {
        // functions.invoke 는 non-2xx 를 error 로 주고 본문은 context 에 담는다.
        const body = await (checked.error as { context?: Response }).context?.json();
        code = typeof body?.errorCode === "string" ? body.errorCode : null;
      } catch {
        code = null;
      }
      setSubmitState("check_failed");
      setErrorText(getHomeworkCheckErrorMessage(code));
      return;
    }

    await data.refresh();
    router.replace({ pathname: "/homework/[id]/result", params: { id: todoId } });
  }

  if (data.loading) return <CenterCard text={data.message} />;
  if (!data.session) return <CenterCard text="로그인이 필요해요." />;
  if (!data.todo) return <CenterCard text="숙제를 찾을 수 없어요." />;

  const subjectLabel = data.todo.subject ? SUBJECT_LABELS[data.todo.subject as SubjectCode] : "과목 미지정";

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.scrollContent}>
      <BackHeader
        eyebrow={data.isTutored ? "선생님 숙제" : AI_CHECK_RESULTS_ENABLED ? "AI 완료검사" : "숙제 기록"}
        title="숙제 제출"
      />

      <View style={styles.metaRow}>
        <SubjectChip label={subjectLabel} />
        <Text style={styles.metaText}>{data.isTutored ? "쌤 · 마감 오늘" : "스스로 점검"}</Text>
      </View>

      <View style={styles.rangeCard}>
        <Text style={styles.rangeLabel}>검사 범위</Text>
        {/* scope_text 우선, 없으면 title 로 되돌아간다(scope_text 도입 전 숙제는 범위를 title 에 적었다). */}
        <Text style={styles.rangeValue}>{getTodoScopeTextForDisplay(data.todo)}</Text>
      </View>

      <Text style={styles.sectionLabel}>푼 사진을 올려주세요</Text>
      {/* 카탈로그 C4 에는 촬영 안내가 없다. AI 정확도가 촬영 품질에 직결되므로 새로 넣었다.
          주황은 "지금/시작/연속/긴급" 전용이라 쓰지 않고 중립 톤으로 둔다. */}
      <View style={styles.tipCard}>
        {HOMEWORK_PHOTO_TIPS.map((tip) => (
          <View key={tip} style={styles.tipRow}>
            <AppIcon name="camera" size={14} color={colors.muted} />
            <Text style={styles.tipText}>{tip}</Text>
          </View>
        ))}
      </View>
      <PhotoSlots
        busy={busy}
        photos={photos}
        onPickCamera={() => void addPhotos("camera")}
        onPickLibrary={() => void addPhotos("library")}
        onRemove={removePhotoAt}
      />

      {submitState === "upload_failed" ? (
        <StatusBanner tone="danger" title="업로드 실패" body={errorText ?? "다시 시도해 주세요."} />
      ) : null}
      {submitState === "check_failed" ? (
        <StatusBanner tone="warning" title="검사 실패" body={errorText ?? "다시 시도해 주세요."} />
      ) : null}
      {/* 사진 선택·검증 단계의 안내는 submitState 가 idle 인 채로 생긴다. 여기서 보여주지 않으면
          "장수 초과"·"권한 없음" 같은 메시지가 화면에 아예 나타나지 않는다. */}
      {submitState === "idle" && errorText ? (
        <StatusBanner tone="warning" title="사진을 확인해 주세요" body={errorText} />
      ) : null}
      {submitState === "idle" && !errorText ? (
        <View style={styles.infoBanner}>
          <AppIcon name={AI_CHECK_RESULTS_ENABLED ? "ai" : "check"} size={16} color={colors.brand} />
          <Text style={styles.infoBannerText}>
            {AI_CHECK_RESULTS_ENABLED
              ? `AI 1차 확인 · 사진이 잘 보여요. ${data.isTutored ? "제출하면 선생님이 최종 확인해요." : "제출하면 바로 결과를 보여드려요."}`
              : // AI 안내를 그대로 두면 오지 않을 결과를 기다리게 된다.
                `사진이 잘 보여요. ${data.isTutored ? "제출하면 선생님이 확인해요." : "제출하면 사진이 그대로 저장돼요."}`}
          </Text>
        </View>
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
          <Text style={styles.primaryButtonText}>
            {submitState === "check_failed" ? "다시 검사" : "✈ 제출하기"}
          </Text>
        )}
      </Pressable>

      {data.isTutored && submitState === "idle" ? (
        <View style={styles.noteBanner}>
          <Text style={styles.noteBannerText}>⏱ 제출 후 ‘쌤 확인 전’ 상태가 돼요</Text>
        </View>
      ) : null}

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
    () =>
      data.submission
        ? getHomeworkResultView(data.submission, {
            isTutored: data.isTutored,
            aiResultsEnabled: AI_CHECK_RESULTS_ENABLED
          })
        : null,
    [data.submission, data.isTutored]
  );

  if (data.loading) return <CenterCard text={data.message} />;
  if (!data.submission || !view) return <CenterCard text="아직 제출 내역이 없어요." />;

  const headline =
    view.verdictTone === "success"
      ? "잘했어요!"
      : view.verdictTone === "warning"
        ? "조금만 더 보완하면 돼요"
        : view.verdictTone === "danger"
          ? "다시 한 번 해볼까요"
          : "확인했어요";
  const ringIconName = view.verdictTone === "success" ? "check" : "alert";
  const ringIconColor =
    view.verdictTone === "success" ? colors.success : view.verdictTone === "danger" ? colors.danger : colors.warning;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.scrollContent}>
      {/* 검사를 안 한 상태에서 "검사 결과" 라고 하면 결과가 있는 줄 알고 찾게 된다. */}
      <BackHeader
        eyebrow={view.aiResultsHidden ? "제출 내역" : "검사 결과"}
        title={data.todo?.title ?? "숙제"}
      />

      {/* 판정을 가린 상태에서는 등급처럼 보이는 히어로·확신도·사유를 전부 빼고 제출 사실만 알린다.
          view 쪽에서 이미 verdict/confidence/reason 이 비워져 있으므로 여기서 새는 값은 없다. */}
      {view.aiResultsHidden ? (
        <View style={styles.verdictHero}>
          <View style={[styles.verdictRing, verdictRingStyle("muted")]}>
            <AppIcon name="check" size={34} color={colors.muted} />
          </View>
          <Text style={styles.verdictHeadline}>제출됐어요</Text>
          <Text style={styles.verdictSub}>
            {(data.todo?.subject ? SUBJECT_LABELS[data.todo.subject as SubjectCode] : "")} · {view.verdictLabel}
          </Text>
        </View>
      ) : (
        <View style={styles.verdictHero}>
          <View style={[styles.verdictRing, verdictRingStyle(view.verdictTone)]}>
            <AppIcon name={ringIconName} size={34} color={ringIconColor} />
          </View>
          <Text style={styles.verdictHeadline}>{headline}</Text>
          <Text style={styles.verdictSub}>
            {(data.todo?.subject ? SUBJECT_LABELS[data.todo.subject as SubjectCode] : "")} · {view.verdictLabel}
          </Text>
          {view.confidencePercent !== null ? (
            <Text style={styles.verdictConfidence}>AI 확신도 {view.confidencePercent}%</Text>
          ) : null}
        </View>
      )}

      {view.aiResultsHidden ? (
        <View style={styles.reasonCard}>
          <Text style={styles.reasonCardBody}>{getAiCheckPausedStudentNotice({ isTutored: data.isTutored })}</Text>
        </View>
      ) : view.reason ? (
        <View style={[styles.reasonCard, badgeToneStyle(view.verdictTone)]}>
          <Text style={[styles.reasonCardTitle, badgeTextToneStyle(view.verdictTone)]}>
            {view.verdictTone === "success" ? "확인됐어요" : "부족한 부분"}
          </Text>
          <Text style={styles.reasonCardBody}>{view.reason}</Text>
        </View>
      ) : null}

      {view.showTeacherSection ? (
        <View style={styles.teacherCard}>
          <View style={styles.teacherAvatar}>
            <Text style={styles.teacherAvatarText}>쌤</Text>
          </View>
          <View style={styles.flex}>
            <Text style={styles.teacherCardLabel}>선생님 코멘트</Text>
            <Text style={styles.teacherCardBody}>{view.teacherComment ? view.teacherComment : view.teacherStatusLabel}</Text>
          </View>
        </View>
      ) : view.aiResultsHidden ? null : (
        <Text style={styles.aiOnlyNote}>혼자 공부 중이라 AI 검사 결과만 보여드려요.</Text>
      )}

      {/* "확인했어요" 라는 뜻이라, 아무 확인도 하지 않은 상태에서 붙이면 거짓말이 된다. */}
      {view.aiResultsHidden ? null : <Text style={styles.disclaimer}>{HOMEWORK_CHECK_DISCLAIMER}</Text>}

      {view.canRequestResubmit ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            if (todoId) router.replace({ pathname: "/homework/[id]/submit", params: { id: todoId } });
          }}
          style={styles.primaryButton}
        >
          <Text style={styles.primaryButtonText}>↻ 다시 제출하기</Text>
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
  if (!data.session) return <CenterCard text="로그인이 필요해요." />;
  if (!data.todo) return <CenterCard text="숙제를 찾을 수 없어요." />;

  // 판정 노출이 꺼져 있으면 ai_verdict 가 채워지지 않으므로(호출 자체를 안 한다) 이 조건이
  // 영원히 false 가 된다 → 제출했는데 '쌤 확인 대기' 안내가 사라진다. 제출 존재로 판단한다.
  const waitingForTeacher = AI_CHECK_RESULTS_ENABLED
    ? data.isTutored && data.submission?.ai_verdict != null && data.submission?.teacher_status === "pending"
    : data.isTutored && data.submission != null && data.submission.teacher_status === "pending";

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.scrollContent}>
      <BackHeader eyebrow="숙제" title={data.todo?.title ?? "숙제"} />

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


function BackHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <View style={styles.backHeader}>
      <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.backBtn}>
        <Text style={styles.backBtnText}>‹</Text>
      </Pressable>
      <View style={styles.flex}>
        <Text style={styles.headerEyebrow}>{eyebrow}</Text>
        <Text style={styles.headerTitle}>{title}</Text>
      </View>
    </View>
  );
}

function SubjectChip({ label }: { label: string }) {
  return (
    <View style={styles.subjectChip}>
      <Text style={styles.subjectChipText}>{label}</Text>
    </View>
  );
}

function PhotoSlots({
  busy,
  photos,
  onPickCamera,
  onPickLibrary,
  onRemove
}: {
  busy: boolean;
  photos: PickedPhoto[];
  onPickCamera: () => void;
  onPickLibrary: () => void;
  onRemove: (index: number) => void;
}) {
  return (
    <>
      <View style={styles.slotRow}>
        {photos.map((photo, index) => (
          <Pressable
            accessibilityLabel={`${index + 1}번째 사진 빼기`}
            disabled={busy}
            key={`${photo.uri}-${index}`}
            onPress={() => onRemove(index)}
            style={styles.slotFilled}
          >
            {/* 고른 사진을 바로 보여준다 — 업로드 전에는 로컬 URI 다(서명 URL 불필요). */}
            <Image source={{ uri: photo.uri }} style={styles.slotImage} />
            <View style={styles.slotRemoveBadge}>
              <Text style={styles.slotRemoveText}>×</Text>
            </View>
          </Pressable>
        ))}
        {photos.length < HOMEWORK_PHOTO_MAX_COUNT ? (
          <Pressable accessibilityLabel="사진 추가" disabled={busy} onPress={onPickCamera} style={styles.slotAdd}>
            <Text style={styles.slotAddText}>＋{"\n"}촬영</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.slotActions}>
        <Pressable
          accessibilityRole="button"
          disabled={busy || photos.length >= HOMEWORK_PHOTO_MAX_COUNT}
          onPress={onPickLibrary}
          style={styles.ghostButton}
        >
          <Text style={styles.ghostButtonText}>갤러리에서 고르기</Text>
        </Pressable>
        <Text style={styles.slotCountText}>
          {photos.length} / {HOMEWORK_PHOTO_MAX_COUNT}장
        </Text>
      </View>
    </>
  );
}

function verdictRingStyle(tone: HomeworkVerdictTone) {
  switch (tone) {
    case "success":
      return { backgroundColor: tints.successSoft };
    case "danger":
      return { backgroundColor: tints.dangerSoft };
    case "warning":
      return { backgroundColor: tints.warningSoft };
    default:
      return { backgroundColor: colors.canvas };
  }
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
      return { backgroundColor: tints.successSoft, borderColor: tints.successBorder };
    case "danger":
      return { backgroundColor: tints.dangerSoft, borderColor: tints.dangerBorder };
    case "warning":
      return { backgroundColor: tints.warningSoft, borderColor: tints.warningBorder };
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
  scrollContent: { padding: spacing.lg, gap: spacing.md, width: "100%", maxWidth: 720, alignSelf: "center" },
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
  bannerBody: { color: colors.muted, fontSize: 13, fontWeight: "700", lineHeight: 19 },
  flex: { flex: 1 },
  backHeader: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.chip,
    backgroundColor: colors.canvas
  },
  backBtnText: { color: colors.ink, fontSize: 22, fontWeight: "900" },
  headerEyebrow: { color: colors.muted, fontSize: 12, fontWeight: "800" },
  headerTitle: { color: colors.ink, fontSize: 22, fontWeight: "900", lineHeight: 28 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  metaText: { color: colors.muted, fontSize: 13, fontWeight: "800" },
  subjectChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.chip,
    backgroundColor: tints.brandSoft
  },
  subjectChipText: { color: colors.brand, fontSize: 12, fontWeight: "900" },
  rangeCard: {
    gap: spacing.xs,
    padding: spacing.lg,
    borderRadius: radii.card,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line
  },
  rangeLabel: { color: colors.muted, fontSize: 12, fontWeight: "800" },
  rangeValue: { color: colors.ink, fontSize: 16, fontWeight: "900", lineHeight: 22 },
  sectionLabel: { color: colors.ink, fontSize: 15, fontWeight: "900", marginTop: spacing.xs },
  slotRow: { flexDirection: "row", gap: spacing.sm },
  slotFilled: {
    flex: 1,
    aspectRatio: 1,
    maxWidth: 110,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.control,
    backgroundColor: colors.canvas
  },
  slotIcon: { fontSize: 26 },
  slotAdd: {
    flex: 1,
    aspectRatio: 1,
    maxWidth: 110,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.control,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.line,
    backgroundColor: colors.surface
  },
  slotAddText: { color: colors.muted, fontSize: 13, fontWeight: "900", textAlign: "center", lineHeight: 18 },
  slotImage: { width: "100%", height: "100%", borderRadius: radii.control },
  slotRemoveBadge: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 11,
    backgroundColor: colors.ink
  },
  slotRemoveText: { color: colors.surface, fontSize: 14, fontWeight: "900", lineHeight: 16 },
  slotActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm
  },
  slotCountText: { color: colors.muted, fontSize: 12, fontWeight: "800" },
  tipCard: {
    gap: spacing.xs,
    padding: spacing.md,
    borderRadius: radii.control,
    backgroundColor: colors.canvas
  },
  tipRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  tipText: { color: colors.muted, fontSize: 12, fontWeight: "700", flex: 1 },
  infoBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.control,
    backgroundColor: tints.brandSoft
  },
  infoBannerText: { flex: 1, color: colors.brand, fontSize: 13, fontWeight: "800", lineHeight: 19 },
  noteBanner: {
    padding: spacing.md,
    borderRadius: radii.control,
    backgroundColor: tints.warningSoft
  },
  noteBannerText: { color: tints.warningStrong, fontSize: 13, fontWeight: "800" },
  verdictHero: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.lg },
  verdictRing: {
    width: 112,
    height: 112,
    borderRadius: 56,
    alignItems: "center",
    justifyContent: "center"
  },
  verdictRingText: { fontSize: 44, fontWeight: "900" },
  verdictHeadline: { color: colors.ink, fontSize: 24, fontWeight: "900", textAlign: "center" },
  verdictSub: { color: colors.muted, fontSize: 14, fontWeight: "800", textAlign: "center" },
  verdictConfidence: { color: colors.muted, fontSize: 13, fontWeight: "800", fontVariant: [typography.numericVariant] },
  reasonCard: { gap: spacing.xs, padding: spacing.lg, borderRadius: radii.card, borderWidth: 1 },
  reasonCardTitle: { fontSize: 14, fontWeight: "900" },
  reasonCardBody: { color: colors.ink, fontSize: 14, fontWeight: "700", lineHeight: 21 },
  teacherCard: {
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface
  },
  teacherAvatar: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.chip,
    backgroundColor: tints.brandSoft
  },
  teacherAvatarText: { color: colors.brand, fontSize: 14, fontWeight: "900" },
  teacherCardLabel: { color: colors.muted, fontSize: 12, fontWeight: "800" },
  teacherCardBody: { color: colors.ink, fontSize: 14, fontWeight: "800", lineHeight: 21 },
  aiOnlyNote: { color: colors.muted, fontSize: 13, fontWeight: "700", textAlign: "center" }
});
