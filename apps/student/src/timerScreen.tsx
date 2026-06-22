import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { Link, useLocalSearchParams, type Href } from "expo-router";
import { createClient, type Session } from "@supabase/supabase-js";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from "react-native";

import { colors, radii, spacing, typography } from "@ssamplanner/design-tokens";
import {
  SUBJECT_LABELS,
  FOCUS_CAMERA_PRIVACY_COPY,
  calculateStudyStreak,
  createTimerEndPatch,
  createTimerPausePatch,
  createTimerResumePatch,
  createTimerStartPayload,
  getDateKey,
  getTimerElapsedSeconds,
  getTimerState,
  sumTimerSecondsForDate
} from "@ssamplanner/shared";
import type { Database, SubjectCode } from "@ssamplanner/shared";

import { FocusCameraPanel } from "./focusCamera";

type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
type StudySessionRow = Database["public"]["Tables"]["study_sessions"]["Row"];
type TimetableBlockRow = Database["public"]["Tables"]["timetable_blocks"]["Row"];

const supabase = createClient<Database>(
  process.env.EXPO_PUBLIC_SUPABASE_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    "",
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    ""
);

const subjectOptions = Object.keys(SUBJECT_LABELS) as SubjectCode[];

function useTimerData() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [studySessions, setStudySessions] = useState<StudySessionRow[]>([]);
  const [timetableBlocks, setTimetableBlocks] = useState<TimetableBlockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("세션 확인 중");

  const refresh = useCallback(async (nextSession?: Session | null) => {
    const activeSession = nextSession ?? (await supabase.auth.getSession()).data.session;
    setSession(activeSession);

    if (!activeSession) {
      setProfile(null);
      setStudySessions([]);
      setTimetableBlocks([]);
      setMessage("가입 또는 로그인이 필요합니다.");
      setLoading(false);
      return;
    }

    setLoading(true);
    const userId = activeSession.user.id;
    const since = `${shiftDate(getDateKey(new Date()), -14)}T00:00:00.000Z`;
    const [profileResult, sessionsResult, timetableResult] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      supabase
        .from("study_sessions")
        .select("*")
        .eq("student_id", userId)
        .gte("started_at", since)
        .order("started_at", { ascending: false }),
      supabase
        .from("timetable_blocks")
        .select("*")
        .eq("student_id", userId)
        .order("day_of_week", { ascending: true })
        .order("start_min", { ascending: true })
    ]);

    setProfile(profileResult.data);
    setStudySessions(sessionsResult.data ?? []);
    setTimetableBlocks(timetableResult.data ?? []);
    setMessage(profileResult.error?.message ?? sessionsResult.error?.message ?? timetableResult.error?.message ?? "타이머 데이터 동기화 완료");
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      void refresh(nextSession);
    });

    return () => data.subscription.unsubscribe();
  }, [refresh]);

  return {
    session,
    profile,
    studySessions,
    timetableBlocks,
    loading,
    message,
    refresh,
    setMessage
  };
}

export function StudentTimerScreen({ focusEntry = false }: { focusEntry?: boolean } = {}) {
  const params = useLocalSearchParams<{ focus?: string }>();
  const data = useTimerData();
  const [selectedSubject, setSelectedSubject] = useState<SubjectCode>("math");
  const [now, setNow] = useState(new Date());
  const activeTimer = data.studySessions.find((studySession) => !studySession.ended_at && getTimerState(studySession) !== "completed");
  const timerState = getTimerState(activeTimer ?? null);
  const elapsedSeconds = activeTimer ? getTimerElapsedSeconds(activeTimer, now) : 0;
  const sessionsWithLiveTimer = useMemo(
    () =>
      data.studySessions.map((studySession) =>
        activeTimer && studySession.id === activeTimer.id
          ? { ...studySession, duration_sec: elapsedSeconds }
          : studySession
      ),
    [activeTimer, data.studySessions, elapsedSeconds]
  );
  const todaySeconds = sumTimerSecondsForDate(sessionsWithLiveTimer, now, now);
  const todayGoalSeconds = getTodayGoalSeconds(data.timetableBlocks);
  const streak = calculateStudyStreak(sessionsWithLiveTimer, now);
  const weeklyDays = getRecentStudyDays(sessionsWithLiveTimer, now);
  const focusIntent = focusEntry || params.focus === "1";

  useEffect(() => {
    if (activeTimer?.subject) {
      setSelectedSubject(activeTimer.subject);
    }
  }, [activeTimer?.subject]);

  useEffect(() => {
    if (timerState !== "running") return;

    const intervalId = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(intervalId);
  }, [timerState]);

  async function startTimer(focusMode: boolean) {
    if (!data.session) {
      data.setMessage("로그인 후 타이머를 시작할 수 있어요.");
      return;
    }
    if (activeTimer) {
      data.setMessage("이미 진행 중인 타이머가 있어요.");
      return;
    }

    const result = await supabase.from("study_sessions").insert(
      createTimerStartPayload({
        studentId: data.session.user.id,
        subject: selectedSubject,
        focusMode,
        now: new Date()
      })
    );
    data.setMessage(result.error ? result.error.message : focusMode ? "집중 모드 세션을 시작했어요." : "공부 타이머를 시작했어요.");
    await data.refresh();
  }

  async function pauseTimer() {
    if (!activeTimer || timerState !== "running") return;

    const { error } = await supabase
      .from("study_sessions")
      .update(createTimerPausePatch(activeTimer, new Date()))
      .eq("id", activeTimer.id);
    data.setMessage(error ? error.message : "일시정지했어요.");
    await data.refresh();
  }

  async function resumeTimer() {
    if (!activeTimer || timerState !== "paused") return;

    const { error } = await supabase
      .from("study_sessions")
      .update(createTimerResumePatch(new Date()))
      .eq("id", activeTimer.id);
    data.setMessage(error ? error.message : "다시 시작했어요.");
    await data.refresh();
  }

  async function endTimer() {
    if (!activeTimer) return;

    const { error } = await supabase
      .from("study_sessions")
      .update(createTimerEndPatch(activeTimer, new Date()))
      .eq("id", activeTimer.id);
    data.setMessage(error ? error.message : "세션을 종료하고 오늘 누적에 반영했어요.");
    await data.refresh();
  }

  if (!data.session) {
    return <AuthGate message={data.message} />;
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.pageHeader}>
          <View>
            <Text style={styles.kicker}>쌤플래너</Text>
            <Text style={styles.pageTitle}>타이머</Text>
            <Text style={styles.pageSubtitle}>
              {data.profile?.name ? `${data.profile.name}님의 오늘 공부` : "과목을 고르고 공부 시간을 기록해요"}
            </Text>
          </View>
          {data.loading ? <ActivityIndicator color={colors.brand} /> : <Chip tone="success">live</Chip>}
        </View>

        <View style={styles.notice}>
          <Text style={styles.noticeText}>{data.message}</Text>
        </View>

        <View style={[styles.timerCard, timerState === "running" ? styles.timerCardRunning : null]}>
          <View style={styles.timerTop}>
            <Chip tone={activeTimer?.focus_mode ? "flame" : "brand"}>
              {activeTimer?.focus_mode ? "집중 모드" : `${SUBJECT_LABELS[selectedSubject]} · ${timerState === "paused" ? "일시정지" : "기록"}`}
            </Chip>
            {focusIntent && !activeTimer ? <Chip tone="flame">집중 시작 준비</Chip> : null}
          </View>
          <Text style={[styles.timerDigits, timerState === "running" ? styles.timerDigitsRunning : null]}>
            {formatClock(elapsedSeconds)}
          </Text>
          <Text style={styles.timerCaption}>
            {activeTimer
              ? timerState === "paused"
                ? "멈춘 구간은 누적하지 않아요."
                : "타이머가 오늘 누적에 실시간으로 반영돼요."
              : "과목을 선택하고 시작하면 오늘 기록으로 저장돼요."}
          </Text>

          <SubjectPicker disabled={Boolean(activeTimer)} value={selectedSubject} onChange={setSelectedSubject} />

          <View style={styles.inlineActions}>
            {!activeTimer ? (
              <>
                <ActionButton label="공부 시작" onPress={() => void startTimer(false)} tone="flame" />
                <ActionButton label="집중 모드 시작" onPress={() => void startTimer(true)} tone="neutral" />
              </>
            ) : timerState === "running" ? (
              <>
                <ActionButton label="일시정지" onPress={() => void pauseTimer()} tone="brand" />
                <ActionButton label="종료" onPress={() => void endTimer()} tone="flame" />
              </>
            ) : (
              <>
                <ActionButton label="다시 시작" onPress={() => void resumeTimer()} tone="flame" />
                <ActionButton label="종료" onPress={() => void endTimer()} tone="neutral" />
              </>
            )}
          </View>
        </View>

        {activeTimer?.focus_mode ? (
          <FocusCameraPanel active={timerState === "running"} />
        ) : focusIntent ? (
          <FocusIntroCard onStart={() => void startTimer(true)} />
        ) : null}

        <View style={styles.metricRow}>
          <Metric label="오늘 공부" value={formatDuration(todaySeconds)} />
          <Metric label="목표" value={todayGoalSeconds > 0 ? formatDuration(todayGoalSeconds) : "미설정"} />
          <Metric label="연속" value={`${streak.count}일`} />
        </View>

        <Section title="최근 7일" badge="실제 기록">
          <View style={styles.weekGrid}>
            {weeklyDays.map((day) => (
              <View key={day.dateKey} style={styles.weekItem}>
                <View style={styles.weekBarTrack}>
                  <View style={[styles.weekBarFill, { height: `${day.ratio}%` }]} />
                </View>
                <Text style={styles.weekLabel}>{day.label}</Text>
                <Text style={styles.weekMinutes}>{Math.round(day.seconds / 60)}분</Text>
              </View>
            ))}
          </View>
        </Section>

      </ScrollView>
      <BottomNav />
    </View>
  );
}

function FocusIntroCard({ onStart }: { onStart: () => void }) {
  return (
    <View style={styles.focusIntro}>
      <View style={styles.focusIntroIcon}>
        <Text style={styles.focusIntroIconText}>●</Text>
      </View>
      <Text style={styles.focusIntroTitle}>즐기 싫지 않게 지켜봐 주는 공부 친구예요</Text>
      <Text style={styles.focusIntroBody}>
        집중 세션에서만 카메라 프리뷰를 켜고, 앱이 뒤로 가면 바로 꺼요.
      </Text>
      <View style={styles.focusPrivacy}>
        <Text style={styles.focusPrivacyTitle}>{FOCUS_CAMERA_PRIVACY_COPY}</Text>
        <Text style={styles.focusPrivacyBody}>프레임과 영상은 저장하거나 업로드하지 않아요.</Text>
      </View>
      <View style={styles.inlineActions}>
        <ActionButton label="카메라 허용하고 집중 모드 켜기" onPress={onStart} tone="flame" />
        <Link href={"/focus/permission" as Href} asChild>
          <Pressable style={[styles.actionButton, styles.neutralButton]}>
            <Text style={styles.actionButtonText}>권한 먼저 보기</Text>
          </Pressable>
        </Link>
      </View>
    </View>
  );
}

function SubjectPicker({
  disabled,
  onChange,
  value
}: {
  disabled: boolean;
  onChange: (value: SubjectCode) => void;
  value: SubjectCode;
}) {
  return (
    <View style={styles.subjectWrap}>
      {subjectOptions.map((subject) => (
        <Pressable
          disabled={disabled}
          key={subject}
          onPress={() => onChange(subject)}
          style={[styles.subjectChip, value === subject ? styles.subjectChipActive : null, disabled ? styles.subjectChipDisabled : null]}
        >
          <Text style={[styles.subjectChipText, value === subject ? styles.subjectChipTextActive : null]}>
            {SUBJECT_LABELS[subject]}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function AuthGate({ message }: { message: string }) {
  return (
    <ScrollView contentContainerStyle={styles.authContent} style={styles.screen}>
      <View style={styles.authPanel}>
        <Text style={styles.kicker}>쌤플래너</Text>
        <Text style={styles.pageTitle}>로그인이 필요해요</Text>
        <Text style={styles.bodyText}>{message}</Text>
        <Link href={"/signup" as Href} asChild>
          <Pressable style={[styles.actionButton, styles.brandButton]}>
            <Text style={styles.actionButtonPrimaryText}>가입·로그인</Text>
          </Pressable>
        </Link>
      </View>
    </ScrollView>
  );
}

function Section({ badge, children, title }: { badge?: string; children: ReactNode; title: string }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {badge ? <Chip tone="brand">{badge}</Chip> : null}
      </View>
      {children}
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

function Chip({ children, tone }: { children: ReactNode; tone: "brand" | "success" | "flame" }) {
  const style = tone === "success" ? styles.chipSuccess : tone === "flame" ? styles.chipFlame : styles.chipBrand;
  const textStyle = tone === "flame" || tone === "success" ? styles.chipStrongText : styles.chipText;

  return (
    <View style={[styles.chip, style]}>
      <Text style={textStyle}>{children}</Text>
    </View>
  );
}

function ActionButton({
  label,
  onPress,
  tone
}: {
  label: string;
  onPress: () => void;
  tone: "brand" | "flame" | "neutral";
}) {
  const buttonStyle = tone === "brand" ? styles.brandButton : tone === "flame" ? styles.flameButton : styles.neutralButton;
  const textStyle = tone === "neutral" ? styles.actionButtonText : styles.actionButtonPrimaryText;

  return (
    <Pressable onPress={onPress} style={[styles.actionButton, buttonStyle]}>
      <Text style={textStyle}>{label}</Text>
    </Pressable>
  );
}

function BottomNav() {
  return (
    <View style={styles.bottomNav}>
      <NavLink href="/today" label="오늘" />
      <NavLink href="/planner" label="플래너" />
      <NavLink active href="/timer" label="타이머" />
    </View>
  );
}

function NavLink({ active = false, href, label }: { active?: boolean; href: string; label: string }) {
  return (
    <Link href={href as Href} asChild>
      <Pressable style={[styles.navItem, active ? styles.navItemActive : null]}>
        <Text style={[styles.navText, active ? styles.navTextActive : null]}>{label}</Text>
      </Pressable>
    </Link>
  );
}

function getTodayGoalSeconds(blocks: TimetableBlockRow[]): number {
  const today = new Date().getDay();
  return blocks
    .filter((block) => block.day_of_week === today && (block.type === "self" || block.type === "class"))
    .reduce((total, block) => total + Math.max(0, block.end_min - block.start_min) * 60, 0);
}

function getRecentStudyDays(sessions: StudySessionRow[], now: Date) {
  const today = getDateKey(now);
  const days = Array.from({ length: 7 }, (_value, index) => shiftDate(today, index - 6));
  const totals = days.map((dateKey) => {
    const seconds = sumTimerSecondsForDate(sessions, `${dateKey}T12:00:00.000Z`, now);
    return {
      dateKey,
      label: dateKey.slice(5),
      seconds,
      ratio: 0
    };
  });
  const maxSeconds = Math.max(...totals.map((day) => day.seconds), 1);

  return totals.map((day) => ({
    ...day,
    ratio: Math.max(8, Math.round((day.seconds / maxSeconds) * 100))
  }));
}

function formatClock(seconds: number): string {
  const normalized = Math.max(0, seconds);
  const hours = Math.floor(normalized / 3600);
  const minutes = Math.floor((normalized % 3600) / 60);
  const remainingSeconds = normalized % 60;

  return hours > 0
    ? `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`
    : `${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) return "0분";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (!hours) return `${minutes}분`;
  if (!minutes) return `${hours}시간`;
  return `${hours}시간 ${minutes}분`;
}

function shiftDate(dateKey: string, amount: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + amount)).toISOString().slice(0, 10);
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.canvas
  },
  scrollContent: {
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: 96,
    width: "100%",
    maxWidth: 920,
    alignSelf: "center"
  },
  authContent: {
    flexGrow: 1,
    justifyContent: "center",
    padding: spacing.xl
  },
  authPanel: {
    gap: spacing.lg,
    width: "100%",
    maxWidth: 520,
    alignSelf: "center",
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.card,
    backgroundColor: colors.surface
  },
  pageHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md
  },
  kicker: {
    color: colors.brand,
    fontSize: 13,
    fontWeight: "800"
  },
  pageTitle: {
    marginTop: spacing.xs,
    color: colors.ink,
    fontSize: 32,
    fontWeight: "900",
    lineHeight: 38
  },
  pageSubtitle: {
    marginTop: spacing.xs,
    color: colors.muted,
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 22
  },
  notice: {
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.control,
    backgroundColor: colors.surface
  },
  noticeText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 19
  },
  timerCard: {
    gap: spacing.lg,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.ink,
    borderRadius: radii.card,
    backgroundColor: colors.ink
  },
  timerCardRunning: {
    borderColor: colors.flame
  },
  timerTop: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  timerDigits: {
    color: colors.surface,
    fontSize: 64,
    fontVariant: [typography.numericVariant],
    fontWeight: "900",
    lineHeight: 72
  },
  timerDigitsRunning: {
    color: colors.flame
  },
  timerCaption: {
    color: colors.surface,
    fontSize: 15,
    fontWeight: "800",
    lineHeight: 22
  },
  focusIntro: {
    gap: spacing.md,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.card,
    backgroundColor: colors.surface
  },
  focusIntroIcon: {
    width: 56,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.card,
    backgroundColor: colors.flame
  },
  focusIntroIconText: {
    color: colors.surface,
    fontSize: 18,
    fontWeight: "900"
  },
  focusIntroTitle: {
    color: colors.ink,
    fontSize: 24,
    fontWeight: "900",
    lineHeight: 31
  },
  focusIntroBody: {
    color: colors.muted,
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 23
  },
  focusPrivacy: {
    gap: spacing.xs,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: "#BFEFD7",
    borderRadius: radii.control,
    backgroundColor: "#F0FFF7"
  },
  focusPrivacyTitle: {
    color: "#087A47",
    fontSize: 14,
    fontWeight: "900",
    lineHeight: 20
  },
  focusPrivacyBody: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 19
  },
  subjectWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  subjectChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.chip,
    backgroundColor: colors.surface
  },
  subjectChipActive: {
    borderColor: colors.flame,
    backgroundColor: colors.flame
  },
  subjectChipDisabled: {
    opacity: 0.85
  },
  subjectChipText: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: "900"
  },
  subjectChipTextActive: {
    color: colors.surface
  },
  inlineActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  actionButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radii.button
  },
  brandButton: {
    backgroundColor: colors.brand
  },
  flameButton: {
    backgroundColor: colors.flame
  },
  neutralButton: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface
  },
  actionButtonText: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: "900"
  },
  actionButtonPrimaryText: {
    color: colors.surface,
    fontSize: 14,
    fontWeight: "900"
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
    fontSize: 20,
    fontVariant: [typography.numericVariant],
    fontWeight: "900"
  },
  section: {
    gap: spacing.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.card,
    backgroundColor: colors.surface
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md
  },
  sectionTitle: {
    color: colors.ink,
    fontSize: 20,
    fontWeight: "900",
    lineHeight: 26
  },
  bodyText: {
    color: colors.muted,
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 23
  },
  chip: {
    flexShrink: 0,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.chip
  },
  chipBrand: {
    backgroundColor: colors.canvas
  },
  chipSuccess: {
    backgroundColor: colors.success
  },
  chipFlame: {
    backgroundColor: colors.flame
  },
  chipText: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: "900"
  },
  chipStrongText: {
    color: colors.surface,
    fontSize: 12,
    fontWeight: "900"
  },
  weekGrid: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.sm,
    minHeight: 148
  },
  weekItem: {
    flex: 1,
    alignItems: "center",
    gap: spacing.xs
  },
  weekBarTrack: {
    width: "100%",
    height: 88,
    justifyContent: "flex-end",
    overflow: "hidden",
    borderRadius: radii.control,
    backgroundColor: colors.canvas
  },
  weekBarFill: {
    width: "100%",
    borderRadius: radii.control,
    backgroundColor: colors.brand
  },
  weekLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "800"
  },
  weekMinutes: {
    color: colors.ink,
    fontSize: 11,
    fontWeight: "900"
  },
  bottomNav: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    justifyContent: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.surface
  },
  navItem: {
    minWidth: 88,
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.chip
  },
  navItemActive: {
    backgroundColor: colors.canvas
  },
  navText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "900"
  },
  navTextActive: {
    color: colors.brand
  }
});
