import { useCallback, useEffect, useMemo, useState } from "react";

import { Link, type Href } from "expo-router";
import type { Session } from "@supabase/supabase-js";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { colors, radii, spacing, tints, typography } from "@ssamplanner/design-tokens";
import {
  SUBJECT_LABELS,
  aggregateWeeklyStudy,
  createPlannerTodosFromRecommendation,
  getDateKey,
  getFeatureGateState,
  getStubReportDraft,
  getStubStudyRecommendation,
  type FeatureGateState,
  type StudyRecommendation,
  type UnlockFeature
} from "@ssamplanner/shared";
import type { Database, SubjectCode } from "@ssamplanner/shared";

import { supabase } from "./supabaseClient";
import { AppShell } from "./m2Screens";

type StudySessionRow = Database["public"]["Tables"]["study_sessions"]["Row"];
type AdUnlockRow = Database["public"]["Tables"]["ad_unlocks"]["Row"];

const AD_UNLOCK_HOURS = 24;
const subjectOptions = Object.keys(SUBJECT_LABELS) as SubjectCode[];

function startOfWeekKey(date: Date): string {
  const copy = new Date(`${getDateKey(date)}T00:00:00.000Z`);
  copy.setUTCDate(copy.getUTCDate() - copy.getUTCDay());
  return getDateKey(copy);
}

function useGatedFeature(feature: UnlockFeature) {
  const [session, setSession] = useState<Session | null>(null);
  const [sessions, setSessions] = useState<StudySessionRow[]>([]);
  const [gate, setGate] = useState<FeatureGateState | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("불러오는 중");

  const refresh = useCallback(async () => {
    setLoading(true);
    const active = (await supabase.auth.getSession()).data.session;
    setSession(active);
    if (!active) {
      setMessage("로그인이 필요해요.");
      setLoading(false);
      return;
    }
    const userId = active.user.id;
    const weekStart = startOfWeekKey(new Date());
    const [sessionResult, subResult, unlockResult] = await Promise.all([
      supabase
        .from("study_sessions")
        .select("*")
        .eq("student_id", userId)
        .gte("started_at", `${weekStart}T00:00:00.000Z`),
      supabase.from("student_subscriptions").select("status").eq("student_id", userId).maybeSingle(),
      supabase.from("ad_unlocks").select("feature, expires_at").eq("student_id", userId).eq("feature", feature)
    ]);
    setSessions(sessionResult.data ?? []);
    setGate(
      getFeatureGateState({
        feature,
        isPremium: subResult.data?.status === "active",
        unlocks: ((unlockResult.data as AdUnlockRow[] | null) ?? []).map((u) => ({ feature: u.feature, expires_at: u.expires_at }))
      })
    );
    // 성공 시에는 안내 문구를 비워 잔여 텍스트가 보이지 않게 한다(에러만 노출).
    setMessage(sessionResult.error?.message ?? "");
    setLoading(false);
  }, [feature]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function watchAdToUnlock() {
    if (!session) return;
    // NOTE(mock): 실제 리워드 광고 SDK 대신, 시청 완료를 가정하고 언락을 기록한다.
    const expires = new Date(Date.now() + AD_UNLOCK_HOURS * 3_600_000).toISOString();
    const { error } = await supabase
      .from("ad_unlocks")
      .insert({ student_id: session.user.id, feature, expires_at: expires });
    setMessage(error ? error.message : "광고 보상으로 잠시 열렸어요. (모의 광고)");
    if (!error) await refresh();
  }

  return { session, sessions, gate, loading, message, refresh, watchAdToUnlock, setMessage };
}

function GateNotice({ gate, onWatchAd }: { gate: FeatureGateState; onWatchAd: () => void }) {
  return (
    <View style={styles.gateWrap}>
      <View style={styles.lockPreview}>
        <View style={styles.lockBadge}>
          <Text style={styles.lockBadgeText}>🔒</Text>
        </View>
        <Text style={styles.lockTitle}>준비됐어요</Text>
        <Text style={styles.lockHint}>{gate.reason}</Text>
      </View>
      {gate.canUnlockByAd ? (
        <Pressable accessibilityRole="button" onPress={onWatchAd} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>📺 광고 보고 무료로 열기</Text>
        </Pressable>
      ) : null}
      <Link href={"/subscribe" as Href} asChild>
        <Pressable accessibilityRole="button" style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>월 구독하고 광고 없이 무제한</Text>
        </Pressable>
      </Link>
      <Text style={styles.gateHint}>광고 없이 매주 받고 싶다면? 월 구독 →</Text>
    </View>
  );
}

export function AiRecommendationScreen() {
  const data = useGatedFeature("ai_rec");
  const [recommendations, setRecommendations] = useState<StudyRecommendation[]>([]);
  const [reflected, setReflected] = useState(false);

  const recentMinutesBySubject = useMemo(() => {
    const map: Partial<Record<SubjectCode, number>> = {};
    for (const s of data.sessions) {
      if (!s.subject) continue;
      map[s.subject] = (map[s.subject] ?? 0) + Math.round(s.duration_sec / 60);
    }
    return map;
  }, [data.sessions]);

  function generate() {
    const subjects = subjectOptions.filter((subject) => (recentMinutesBySubject[subject] ?? 0) > 0);
    setRecommendations(
      getStubStudyRecommendation({ recentMinutesBySubject, subjects: subjects.length ? subjects : ["math", "english"] })
    );
    setReflected(false);
  }

  async function reflectToPlanner() {
    if (!data.session || recommendations.length === 0) return;
    const userId = data.session.user.id;
    const due = getDateKey(new Date(Date.now() + 6 * 86_400_000));
    const todos = createPlannerTodosFromRecommendation(recommendations, userId, due);
    const weekStart = startOfWeekKey(new Date());
    const { error } = await supabase.from("todos").insert(todos);
    await supabase.from("ai_recommendations").upsert(
      recommendations.map((rec) => ({
        student_id: userId,
        week_start: weekStart,
        subject: rec.subject,
        recommended_hours: rec.recommendedHours,
        reason: rec.reason
      })),
      { onConflict: "student_id,week_start,subject" }
    );
    data.setMessage(error ? error.message : `${todos.length}개 할 일을 플래너에 반영했어요.`);
    if (!error) setReflected(true);
  }

  return (
    <AppShell
      activeTab="ai"
      loading={data.loading}
      message={data.message}
      title="AI 공부량 추천"
      subtitle="이번 주, 이만큼 어때요?"
    >
      {data.loading ? null : !data.gate ? (
        <View style={styles.card}>
          <Text style={styles.cardBody}>로그인이 필요해요.</Text>
        </View>
      ) : !data.gate.unlocked ? (
        <GateNotice gate={data.gate} onWatchAd={() => void data.watchAdToUnlock()} />
      ) : (
        <View style={styles.stack}>
          <Pressable accessibilityRole="button" onPress={generate} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>추천 받기</Text>
          </Pressable>
          {recommendations.map((rec) => (
            <View key={rec.subject} style={styles.card}>
              <Text style={styles.cardTitle}>
                {SUBJECT_LABELS[rec.subject]} · 주 {rec.recommendedHours}시간
              </Text>
              <Text style={styles.cardBody}>{rec.reason}</Text>
            </View>
          ))}
          {recommendations.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              disabled={reflected}
              onPress={() => void reflectToPlanner()}
              style={[styles.secondaryButton, reflected ? styles.disabledButton : null]}
            >
              <Text style={styles.secondaryButtonText}>{reflected ? "반영 완료" : "플래너에 반영"}</Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </AppShell>
  );
}

export function MyReportScreen() {
  const data = useGatedFeature("report");

  const aggregate = useMemo(() => {
    const weekStart = startOfWeekKey(new Date());
    return aggregateWeeklyStudy(
      data.sessions.map((s) => ({ subject: s.subject, duration_sec: s.duration_sec, started_at: s.started_at })),
      weekStart
    );
  }, [data.sessions]);

  const draft = useMemo(
    () =>
      getStubReportDraft({
        studentName: "나",
        totalMinutes: aggregate.totalMinutes,
        topSubject: aggregate.perSubjectMinutes[0]?.subject ?? null,
        completionRate: 0.8
      }),
    [aggregate]
  );

  const maxDay = Math.max(1, ...aggregate.perDayMinutes);
  const dayLabels = ["일", "월", "화", "수", "목", "금", "토"];

  if (data.loading) return <Center text={data.message} />;
  if (!data.gate) return <Center text="로그인이 필요해요." />;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>나의 주간 리포트</Text>
      <Text style={styles.subtitle}>공부시간 · 약점 · 성적 추이</Text>

      {!data.gate.unlocked ? (
        <GateNotice gate={data.gate} onWatchAd={() => void data.watchAdToUnlock()} />
      ) : (
        <>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>총 {Math.floor(aggregate.totalMinutes / 60)}시간 {aggregate.totalMinutes % 60}분</Text>
            <View style={styles.chartRow}>
              {aggregate.perDayMinutes.map((minutes, index) => (
                <View key={dayLabels[index]} style={styles.chartCol}>
                  <View style={[styles.bar, { height: 8 + (minutes / maxDay) * 96 }]} />
                  <Text style={styles.barLabel}>{dayLabels[index]}</Text>
                </View>
              ))}
            </View>
          </View>

          {aggregate.perSubjectMinutes.map((row) => (
            <View key={row.subject} style={styles.subjectRow}>
              <Text style={styles.subjectName}>{SUBJECT_LABELS[row.subject]}</Text>
              <Text style={styles.subjectMinutes}>{row.minutes}분</Text>
            </View>
          ))}

          <View style={styles.card}>
            <Text style={styles.cardTitle}>이번 주 한 줄</Text>
            <Text style={styles.cardBody}>{draft}</Text>
          </View>
        </>
      )}
    </ScrollView>
  );
}

function Center({ text }: { text: string }) {
  return (
    <View style={styles.center}>
      <Text style={styles.centerText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: spacing.lg, gap: spacing.md, width: "100%", maxWidth: 720, alignSelf: "center" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, backgroundColor: colors.canvas },
  stack: { gap: spacing.md },
  centerText: { color: colors.muted, fontSize: 15, fontWeight: "700" },
  kicker: { color: colors.muted, fontSize: 13, fontWeight: "800", letterSpacing: 0.2 },
  title: { color: colors.ink, fontSize: 22, fontWeight: "900", lineHeight: 28 },
  notice: { color: colors.muted, fontSize: 13, fontWeight: "700" },
  card: { gap: spacing.sm, padding: spacing.lg, borderWidth: 1, borderColor: colors.line, borderRadius: radii.card, backgroundColor: colors.surface },
  cardTitle: { color: colors.ink, fontSize: 16, fontWeight: "900" },
  cardBody: { color: colors.muted, fontSize: 14, fontWeight: "700", lineHeight: 21 },
  gateCard: { gap: spacing.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.line, borderRadius: radii.card, backgroundColor: colors.surface },
  gateTitle: { color: colors.ink, fontSize: 16, fontWeight: "900" },
  gateHint: { color: colors.muted, fontSize: 13, fontWeight: "700" },
  primaryButton: { minHeight: 52, alignItems: "center", justifyContent: "center", borderRadius: radii.button, backgroundColor: colors.brand, paddingHorizontal: spacing.xl },
  primaryButtonText: { color: colors.surface, fontSize: 15, fontWeight: "900" },
  secondaryButton: { minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: radii.button, borderWidth: 1, borderColor: colors.brand },
  secondaryButtonText: { color: colors.brand, fontSize: 15, fontWeight: "900" },
  disabledButton: { opacity: 0.5 },
  chartRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", height: 120, marginTop: spacing.sm },
  chartCol: { alignItems: "center", gap: spacing.xs, flex: 1 },
  bar: { width: 16, borderRadius: 6, backgroundColor: colors.brand },
  barLabel: { color: colors.muted, fontSize: 12, fontWeight: "800" },
  subjectRow: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.line },
  subjectName: { color: colors.ink, fontSize: 14, fontWeight: "800" },
  subjectMinutes: { color: colors.muted, fontSize: 14, fontWeight: "800", fontVariant: [typography.numericVariant] },
  subtitle: { color: colors.muted, fontSize: 14, fontWeight: "700", lineHeight: 20 },
  gateWrap: { gap: spacing.md },
  lockPreview: {
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.xl,
    borderRadius: radii.card,
    backgroundColor: tints.brandSoft
  },
  lockBadge: {
    width: 56,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 28,
    backgroundColor: colors.surface
  },
  lockBadgeText: { fontSize: 24 },
  lockTitle: { color: colors.ink, fontSize: 17, fontWeight: "900" },
  lockHint: { color: colors.muted, fontSize: 13, fontWeight: "700", textAlign: "center", lineHeight: 19 }
});
