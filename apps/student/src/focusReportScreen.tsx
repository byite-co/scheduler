import { useCallback, useEffect, useMemo, useState } from "react";

import { Link, type Href } from "expo-router";
import { createClient } from "@supabase/supabase-js";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { colors, radii, spacing, typography } from "@ssamplanner/design-tokens";
import { FOCUS_CAMERA_PRIVACY_COPY } from "@ssamplanner/shared";
import type { Database } from "@ssamplanner/shared";

type StudySessionRow = Database["public"]["Tables"]["study_sessions"]["Row"];

const supabase = createClient<Database>(
  process.env.EXPO_PUBLIC_SUPABASE_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    "",
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    ""
);

export function FocusReportScreen({ mode }: { mode: "summary" | "report" }) {
  const [sessions, setSessions] = useState<StudySessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("집중 기록 확인 중");

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data: authData } = await supabase.auth.getSession();
    const userId = authData.session?.user.id;

    if (!userId) {
      setSessions([]);
      setMessage("로그인이 필요해요.");
      setLoading(false);
      return;
    }

    const result = await supabase
      .from("study_sessions")
      .select("*")
      .eq("student_id", userId)
      .eq("focus_mode", true)
      .not("ended_at", "is", null)
      .order("ended_at", { ascending: false })
      .limit(mode === "summary" ? 1 : 20);

    setSessions(result.data ?? []);
    setMessage(result.error?.message ?? "실제 집중 기록을 불러왔어요.");
    setLoading(false);
  }, [mode]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const latest = sessions[0] ?? null;
  const aggregate = useMemo(() => getAggregate(sessions), [sessions]);

  return (
    <ScrollView contentContainerStyle={styles.content} style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.kicker}>집중 모드</Text>
        <Text style={styles.title}>{mode === "summary" ? "집중 요약" : "집중 리포트"}</Text>
        <Text style={styles.body}>{mode === "summary" ? "방금 끝낸 세션의 숫자만 가볍게 확인해요." : "최근 집중 세션의 흐름을 숫자로만 모아봐요."}</Text>
      </View>

      <View style={styles.notice}>
        {loading ? <ActivityIndicator color={colors.flame} /> : null}
        <Text style={styles.noticeText}>{message}</Text>
      </View>

      <View style={styles.metricRow}>
        <Metric label="집중" value={formatScore(mode === "summary" ? latest?.focus_score : aggregate.focusScore)} tone="flame" />
        <Metric label="졸음" value={`${mode === "summary" ? latest?.drowsy_count ?? 0 : aggregate.drowsyCount}회`} />
        <Metric label="점검" value={`${mode === "summary" ? latest?.check_total ?? 0 : aggregate.checkTotal}회`} />
      </View>

      <View style={styles.privacyNotice}>
        <Text style={styles.privacyTitle}>{FOCUS_CAMERA_PRIVACY_COPY}</Text>
        <Text style={styles.privacyBody}>이 화면도 boolean 결과와 숫자 메타데이터만 보여줘요.</Text>
      </View>

      {sessions.length ? (
        <View style={styles.list}>
          {sessions.map((session) => (
            <View key={session.id} style={styles.sessionRow}>
              <View style={styles.sessionText}>
                <Text style={styles.sessionTitle}>{formatDate(session.ended_at ?? session.started_at)}</Text>
                <Text style={styles.sessionBody}>{formatDuration(session.duration_sec)} · 점검 {session.check_total ?? 0}회</Text>
              </View>
              <Text style={styles.sessionScore}>{formatScore(session.focus_score)}</Text>
            </View>
          ))}
        </View>
      ) : (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>아직 집중 기록이 없어요</Text>
          <Text style={styles.emptyBody}>집중 모드 타이머를 끝내면 여기에 숫자가 쌓여요.</Text>
        </View>
      )}

      <View style={styles.actions}>
        <Link href={"/focus/session" as Href} asChild>
          <Pressable accessibilityRole="button" style={[styles.button, styles.flameButton]}>
            <Text style={styles.primaryButtonText}>다시 집중하기</Text>
          </Pressable>
        </Link>
        <Link href={"/timer" as Href} asChild>
          <Pressable accessibilityRole="button" style={[styles.button, styles.neutralButton]}>
            <Text style={styles.buttonText}>타이머로 돌아가기</Text>
          </Pressable>
        </Link>
      </View>
    </ScrollView>
  );
}

function Metric({ label, tone, value }: { label: string; tone?: "flame"; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, tone === "flame" ? styles.metricValueFlame : null]}>{value}</Text>
    </View>
  );
}

function getAggregate(sessions: StudySessionRow[]) {
  const checkTotal = sessions.reduce((total, session) => total + (session.check_total ?? 0), 0);
  const drowsyCount = sessions.reduce((total, session) => total + (session.drowsy_count ?? 0), 0);

  return {
    checkTotal,
    drowsyCount,
    focusScore: checkTotal > 0 ? Math.round(((checkTotal - drowsyCount) / checkTotal) * 100) : null
  };
}

function formatScore(value: number | null | undefined): string {
  return typeof value === "number" ? `${Math.round(value)}%` : "-";
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("ko-KR", { month: "short", day: "numeric", weekday: "short" });
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) return "0분";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}분`;
  return `${Math.floor(minutes / 60)}시간 ${minutes % 60}분`;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.canvas
  },
  content: {
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
    width: "100%",
    maxWidth: 720,
    alignSelf: "center"
  },
  header: {
    gap: spacing.sm
  },
  kicker: {
    color: colors.flame,
    fontSize: 13,
    fontWeight: "900"
  },
  title: {
    color: colors.ink,
    fontSize: 32,
    fontWeight: "900",
    lineHeight: 38
  },
  body: {
    color: colors.muted,
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 23
  },
  notice: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.control,
    backgroundColor: colors.surface
  },
  noticeText: {
    flex: 1,
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 19
  },
  metricRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  metric: {
    flex: 1,
    minWidth: 96,
    gap: spacing.xs,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.control,
    backgroundColor: colors.surface
  },
  metricLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800"
  },
  metricValue: {
    color: colors.ink,
    fontSize: 24,
    fontVariant: [typography.numericVariant],
    fontWeight: "900"
  },
  metricValueFlame: {
    color: colors.flame
  },
  privacyNotice: {
    gap: spacing.xs,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: "#BFEFD7",
    borderRadius: radii.control,
    backgroundColor: "#F0FFF7"
  },
  privacyTitle: {
    color: "#087A47",
    fontSize: 14,
    fontWeight: "900",
    lineHeight: 20
  },
  privacyBody: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 19
  },
  list: {
    gap: spacing.sm
  },
  sessionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.control,
    backgroundColor: colors.surface
  },
  sessionText: {
    flex: 1,
    gap: spacing.xs
  },
  sessionTitle: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: "900"
  },
  sessionBody: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700"
  },
  sessionScore: {
    color: colors.flame,
    fontSize: 18,
    fontVariant: [typography.numericVariant],
    fontWeight: "900"
  },
  empty: {
    gap: spacing.xs,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.card,
    backgroundColor: colors.surface
  },
  emptyTitle: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: "900"
  },
  emptyBody: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 21
  },
  actions: {
    gap: spacing.sm
  },
  button: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radii.button
  },
  flameButton: {
    backgroundColor: colors.flame
  },
  neutralButton: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface
  },
  primaryButtonText: {
    color: colors.surface,
    fontSize: 15,
    fontWeight: "900"
  },
  buttonText: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: "900"
  }
});
