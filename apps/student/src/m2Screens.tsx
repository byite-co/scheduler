import { Children, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { Link, useLocalSearchParams, type Href } from "expo-router";
import type { Session } from "@supabase/supabase-js";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  useWindowDimensions
} from "react-native";

import { colors, meetsAA, radii, spacing, tints, typography } from "@ssamplanner/design-tokens";
import {
  PEER_RANKING_MIN_COHORT,
  SUBJECT_LABELS,
  calculateStudyStreak,
  canShowPeerRanking,
  canStudentToggleTodoAiCheck,
  getDateKey,
  getStudentHomeVariant,
  shouldShowConnectNudge,
  shouldShowPeerRanking,
  shouldShowTeacherHomework,
  sumStudySecondsForDate
} from "@ssamplanner/shared";
import type { Database, PeerRankingSnapshot, SubjectCode } from "@ssamplanner/shared";

import { supabase } from "./supabaseClient";

type ConnectionRow = Database["public"]["Tables"]["connections"]["Row"];
type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
type StudySessionRow = Database["public"]["Tables"]["study_sessions"]["Row"];
type TimetableBlockRow = Database["public"]["Tables"]["timetable_blocks"]["Row"];
type TodoRow = Database["public"]["Tables"]["todos"]["Row"];
type ActivityType = Database["public"]["Enums"]["activity_type"];
type PlannerView = "todos" | "timetable" | "calendar";

const subjectOptions = Object.keys(SUBJECT_LABELS) as SubjectCode[];
const dayLabels = ["일", "월", "화", "수", "목", "금", "토"] as const;
const AVATAR_COLORS = [colors.brand, colors.success, colors.warning, colors.muted] as const;
// 과목별 차트 색(데이터 카테고리용 — 토큰 팔레트, 불꽃 주황 제외).
const SUBJECT_CHART_COLORS = [colors.brand, colors.success, colors.warning, colors.muted, colors.ink] as const;

function getSubjectColor(code: string): string {
  const index = subjectOptions.indexOf(code as SubjectCode);
  return SUBJECT_CHART_COLORS[(index < 0 ? subjectOptions.length : index) % SUBJECT_CHART_COLORS.length];
}
const activityLabels: Record<ActivityType, string> = {
  school: "학교",
  academy: "학원",
  self: "자습",
  class: "수업"
};
// 활동 유형별 색(토큰 팔레트 — 데이터 카테고리용, 불꽃 주황 제외).
const activityColors: Record<ActivityType, string> = {
  school: colors.success,
  academy: colors.warning,
  self: colors.brand,
  class: colors.ink
};

// 배경색 위 텍스트를 AA(>=4.5) 충족하도록 흰색/잉크 중 선택.
function onColorText(background: string): string {
  return meetsAA(colors.surface, background) ? colors.surface : colors.ink;
}

function useStudentM2Data() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [connections, setConnections] = useState<ConnectionRow[]>([]);
  const [todos, setTodos] = useState<TodoRow[]>([]);
  const [timetableBlocks, setTimetableBlocks] = useState<TimetableBlockRow[]>([]);
  const [studySessions, setStudySessions] = useState<StudySessionRow[]>([]);
  const [peerRanking, setPeerRanking] = useState<PeerRankingSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("세션 확인 중");

  const refresh = useCallback(async (nextSession?: Session | null) => {
    const activeSession = nextSession ?? (await supabase.auth.getSession()).data.session;
    setSession(activeSession);

    if (!activeSession) {
      setProfile(null);
      setConnections([]);
      setTodos([]);
      setTimetableBlocks([]);
      setStudySessions([]);
      setPeerRanking(null);
      setMessage("가입 또는 로그인이 필요합니다.");
      setLoading(false);
      return;
    }

    setLoading(true);
    const userId = activeSession.user.id;
    const since = `${shiftDate(getDateKey(new Date()), -45)}T00:00:00.000Z`;
    const [profileResult, connectionsResult, todosResult, timetableResult, sessionsResult, peerResult] =
      await Promise.all([
        supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
        supabase
          .from("connections")
          .select("*")
          .eq("student_id", userId)
          .order("created_at", { ascending: false }),
        supabase
          .from("todos")
          .select("*")
          .eq("student_id", userId)
          .order("due_date", { ascending: true, nullsFirst: false })
          .order("created_at", { ascending: false }),
        supabase
          .from("timetable_blocks")
          .select("*")
          .eq("student_id", userId)
          .order("day_of_week", { ascending: true })
          .order("start_min", { ascending: true }),
        supabase
          .from("study_sessions")
          .select("*")
          .eq("student_id", userId)
          .gte("started_at", since)
          .order("started_at", { ascending: false }),
        supabase.rpc("get_peer_study_ranking", {
          p_days: 7,
          p_min_cohort: PEER_RANKING_MIN_COHORT
        })
      ]);

    setProfile(profileResult.data);
    setConnections(connectionsResult.data ?? []);
    setTodos(todosResult.data ?? []);
    setTimetableBlocks(timetableResult.data ?? []);
    setStudySessions(sessionsResult.data ?? []);
    setPeerRanking((peerResult.data?.[0] as PeerRankingSnapshot | undefined) ?? null);

    const firstError =
      profileResult.error ??
      connectionsResult.error ??
      todosResult.error ??
      timetableResult.error ??
      sessionsResult.error ??
      peerResult.error;
    setMessage(firstError?.message ?? "");
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
    connections,
    todos,
    timetableBlocks,
    studySessions,
    peerRanking,
    loading,
    message,
    refresh,
    setMessage
  };
}

export function StudentTodayM2Screen() {
  const data = useStudentM2Data();
  const todayKey = getDateKey(new Date());
  const activeConnections = data.connections.filter((connection) => connection.status === "active");
  const variant = getStudentHomeVariant({
    activeConnectionCount: activeConnections.length,
    todoCount: data.todos.length,
    timetableBlockCount: data.timetableBlocks.length,
    studySessionCount: data.studySessions.length
  });
  const todaysTodos = data.todos.filter((todo) => todo.due_date === todayKey || (!todo.due_date && todo.status === "todo"));
  const teacherTodos = todaysTodos.filter((todo) => todo.source === "teacher");
  const ownTodos = todaysTodos.filter((todo) => todo.source === "self");
  const doneCount = todaysTodos.filter((todo) => todo.status === "done").length;
  const todayStudySeconds = sumStudySecondsForDate(data.studySessions, new Date());
  const todayGoalSeconds = getTodayGoalSeconds(data.timetableBlocks);
  const streak = calculateStudyStreak(data.studySessions, new Date());
  const activeSession = data.studySessions.find((studySession) => !studySession.ended_at);

  async function toggleTodoStatus(todo: TodoRow) {
    const nextStatus = todo.status === "done" ? "todo" : "done";
    const { error } = await supabase.from("todos").update({ status: nextStatus }).eq("id", todo.id);
    data.setMessage(error ? error.message : nextStatus === "done" ? "완료로 저장했어요." : "다시 할 일로 돌렸어요.");
    await data.refresh();
  }

  if (!data.session) {
    return <AuthGate message={data.message} />;
  }

  const studentName = data.profile?.name?.trim() || "학생";
  const greeting =
    variant === "tutored" ? "오늘도 화이팅!" : variant === "self_study" ? "혼자서도 꾸준히" : "환영해요 👋";

  return (
    <AppShell
      activeTab="today"
      loading={data.loading}
      message={data.message}
      header={
        <HomeHeader
          dateLabel={formatKoreanDate(new Date())}
          greeting={greeting}
          name={studentName}
          streakCount={streak.count}
        />
      }
    >
      {shouldShowConnectNudge(activeConnections.length) ? <ConnectNudge /> : null}

      <HeroCard
        activeSession={activeSession}
        goalSeconds={todayGoalSeconds}
        studySeconds={todayStudySeconds}
        variant={variant}
      />

      {variant === "zero" ? (
        <ZeroTodoCard />
      ) : (
        <>
          <TodoCard
            emptyText="오늘 만든 할 일이 아직 없어요."
            onToggleStatus={toggleTodoStatus}
            title="내 할 일"
            todos={ownTodos}
          />

          {shouldShowTeacherHomework(variant) ? (
            <TeacherHomeworkCard onToggleStatus={toggleTodoStatus} todos={teacherTodos} />
          ) : null}

          {shouldShowPeerRanking(variant) ? <PeerRankingCard ranking={data.peerRanking} /> : null}

          {variant === "tutored" ? (
            <ClassCard
              activeConnections={activeConnections.length}
              doneCount={doneCount}
              totalCount={todaysTodos.length}
            />
          ) : null}
        </>
      )}
    </AppShell>
  );
}

export function StudentPlannerM2Screen({
  initialView,
  initialTodoId,
  composeTodo = false
}: {
  initialView?: PlannerView;
  initialTodoId?: string;
  composeTodo?: boolean;
} = {}) {
  const params = useLocalSearchParams<{ view?: string }>();
  const data = useStudentM2Data();
  const [view, setView] = useState<PlannerView>(initialView ?? parsePlannerView(params.view));

  useEffect(() => {
    setView(initialView ?? parsePlannerView(params.view));
  }, [initialView, params.view]);

  if (!data.session) {
    return <AuthGate message={data.message} />;
  }

  return (
    <AppShell activeTab="planner" loading={data.loading} message={data.message} title="플래너">
      <SegmentedControl
        options={[
          ["todos", "할 일"],
          ["timetable", "시간표"],
          ["calendar", "캘린더"]
        ]}
        value={view}
        onChange={setView}
      />

      {view === "todos" ? (
        <TodosPlanner composeTodo={composeTodo} data={data} initialTodoId={initialTodoId} />
      ) : null}
      {view === "timetable" ? <TimetablePlanner data={data} /> : null}
      {view === "calendar" ? <CalendarPlanner data={data} /> : null}
    </AppShell>
  );
}

function TodosPlanner({
  composeTodo,
  data,
  initialTodoId
}: {
  composeTodo?: boolean;
  data: ReturnType<typeof useStudentM2Data>;
  initialTodoId?: string;
}) {
  const [composing, setComposing] = useState(Boolean(composeTodo));
  const [editingId, setEditingId] = useState<string | null>(initialTodoId ?? null);
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState<SubjectCode>("math");
  const [dueDate, setDueDate] = useState(getDateKey(new Date()));
  const [aiCheckEnabled, setAiCheckEnabled] = useState(false);
  const editingTodo = data.todos.find((todo) => todo.id === editingId);
  const showForm = composing || Boolean(editingTodo);

  useEffect(() => {
    if (!editingTodo) return;
    setTitle(editingTodo.title);
    setSubject(editingTodo.subject ?? "etc");
    setDueDate(editingTodo.due_date ?? getDateKey(new Date()));
    setAiCheckEnabled(editingTodo.ai_check_enabled);
  }, [editingTodo]);

  function closeForm() {
    setEditingId(null);
    setComposing(false);
    setTitle("");
    setAiCheckEnabled(false);
  }

  async function saveTodo() {
    if (!data.session) return;
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      data.setMessage("할 일 제목을 입력해 주세요.");
      return;
    }

    if (editingTodo?.source === "teacher") {
      data.setMessage("선생님 숙제는 완료 상태만 바꿀 수 있어요.");
      return;
    }

    const payload = {
      title: trimmedTitle,
      subject,
      due_date: dueDate.trim() || null,
      ai_check_enabled: aiCheckEnabled
    };
    const result = editingTodo
      ? await supabase.from("todos").update(payload).eq("id", editingTodo.id)
      : await supabase.from("todos").insert({
          ...payload,
          student_id: data.session.user.id,
          source: "self",
          locked: false,
          status: "todo",
          created_by: data.session.user.id
        });

    data.setMessage(result.error ? result.error.message : editingTodo ? "할 일을 수정했어요." : "할 일을 추가했어요.");
    if (!result.error) {
      closeForm();
    }
    await data.refresh();
  }

  async function toggleTodoStatus(todo: TodoRow) {
    const nextStatus = todo.status === "done" ? "todo" : "done";
    const { error } = await supabase.from("todos").update({ status: nextStatus }).eq("id", todo.id);
    data.setMessage(error ? error.message : nextStatus === "done" ? "완료 처리했어요." : "다시 할 일로 돌렸어요.");
    await data.refresh();
  }

  async function toggleAiCheck(enabled: boolean) {
    if (!editingTodo || !canStudentToggleTodoAiCheck(editingTodo)) {
      setAiCheckEnabled(enabled);
      return;
    }
    setAiCheckEnabled(enabled);
  }

  async function deleteTodo() {
    if (!editingTodo || editingTodo.source === "teacher") {
      data.setMessage("선생님 숙제는 삭제할 수 없어요.");
      return;
    }
    const { error } = await supabase.from("todos").delete().eq("id", editingTodo.id);
    data.setMessage(error ? error.message : "할 일을 삭제했어요.");
    if (!error) closeForm();
    await data.refresh();
  }

  if (showForm) {
    const aiLocked = Boolean(editingTodo && !canStudentToggleTodoAiCheck(editingTodo));
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{editingTodo ? "할 일 수정" : "새 할 일"}</Text>
        <View style={styles.cardBody}>
          <InputRow label="제목" value={title} onChange={setTitle} placeholder="예: 수학 개념 복습 30분" />
          <InputRow label="마감일" value={dueDate} onChange={setDueDate} placeholder="YYYY-MM-DD" />
          <ChoiceRow
            label="과목"
            options={subjectOptions.map((option) => [option, SUBJECT_LABELS[option]])}
            value={subject}
            onChange={setSubject}
          />
          <ToggleRow
            label="AI 완료검사"
            value={aiCheckEnabled}
            onValueChange={(value) => void toggleAiCheck(value)}
            disabled={aiLocked}
          />
          <View style={styles.inlineActions}>
            <ActionButton label={editingTodo ? "수정 저장" : "추가"} onPress={() => void saveTodo()} tone="brand" />
            <ActionButton label="취소" onPress={closeForm} tone="neutral" />
            {editingTodo && editingTodo.source === "self" ? (
              <ActionButton label="삭제" onPress={() => void deleteTodo()} tone="danger" />
            ) : null}
          </View>
        </View>
      </View>
    );
  }

  const ownTodos = data.todos.filter((todo) => todo.source === "self");
  const teacherTodos = data.todos.filter((todo) => todo.source === "teacher");

  return (
    <>
      <WeekStrip studySessions={data.studySessions} todos={data.todos} />
      <StudyTimeBar sessions={data.studySessions} />

      {teacherTodos.length ? (
        <HomeCard title="선생님 숙제" right={<SoftTag tone="lock">편집 잠김</SoftTag>}>
          {teacherTodos.map((todo) => (
            <PlannerTodoRow key={todo.id} onToggle={toggleTodoStatus} todo={todo} />
          ))}
        </HomeCard>
      ) : null}

      <HomeCard title="내 플래너" right={<SoftTag tone="brand">직접 편집</SoftTag>}>
        {ownTodos.length ? (
          ownTodos.map((todo) => (
            <PlannerTodoRow key={todo.id} onEdit={() => setEditingId(todo.id)} onToggle={toggleTodoStatus} todo={todo} />
          ))
        ) : (
          <EmptyText>아직 내 할 일이 없어요.</EmptyText>
        )}
        <Pressable onPress={() => setComposing(true)} style={styles.addRow}>
          <Text style={styles.addRowText}>+ 할 일 추가</Text>
        </Pressable>
      </HomeCard>
    </>
  );
}

function PlannerTodoRow({
  onEdit,
  onToggle,
  todo
}: {
  onEdit?: () => void;
  onToggle: (todo: TodoRow) => Promise<void>;
  todo: TodoRow;
}) {
  const done = todo.status === "done";
  return (
    <View style={styles.todoRow}>
      <Pressable
        accessibilityRole="checkbox"
        onPress={() => void onToggle(todo)}
        style={[styles.checkbox, done ? styles.checkboxDone : null]}
      >
        {done ? <Text style={styles.checkboxMark}>✓</Text> : null}
      </Pressable>
      <Pressable disabled={!onEdit} onPress={() => onEdit?.()} style={styles.flex}>
        <Text style={[styles.todoRowTitle, done ? styles.todoRowTitleDone : null]} numberOfLines={1}>
          {todo.title}
        </Text>
      </Pressable>
      {todo.ai_check_enabled ? <SoftTag tone="brand">AI 검사</SoftTag> : null}
      <SoftTag tone="subject">{todo.subject ? SUBJECT_LABELS[todo.subject] : "기타"}</SoftTag>
    </View>
  );
}

function WeekStrip({ studySessions, todos }: { studySessions: StudySessionRow[]; todos: TodoRow[] }) {
  const todayKey = getDateKey(new Date());
  const offsetToMonday = (new Date(`${todayKey}T00:00:00.000Z`).getUTCDay() + 6) % 7;
  const monday = shiftDate(todayKey, -offsetToMonday);
  const labels = ["월", "화", "수", "목", "금", "토", "일"] as const;

  return (
    <View style={styles.weekStrip}>
      {labels.map((label, index) => {
        const day = shiftDate(monday, index);
        const isToday = day === todayKey;
        const hasItem =
          todos.some((todo) => todo.due_date === day) ||
          studySessions.some((session) => getDateKey(session.started_at) === day);
        return (
          <View key={day} style={styles.weekCol}>
            <Text style={styles.weekDow}>{label}</Text>
            <View style={[styles.weekDateBox, isToday ? styles.weekDateToday : null]}>
              <Text style={[styles.weekDate, isToday ? styles.weekDateTodayText : null]}>{Number(day.slice(8))}</Text>
            </View>
            <View style={[styles.weekDot, hasItem ? styles.weekDotOn : null]} />
          </View>
        );
      })}
    </View>
  );
}

function StudyTimeBar({ sessions }: { sessions: StudySessionRow[] }) {
  const todayKey = getDateKey(new Date());
  const bySubject = new Map<string, number>();
  for (const session of sessions) {
    if (getDateKey(session.started_at) !== todayKey) continue;
    const key = session.subject ?? "etc";
    bySubject.set(key, (bySubject.get(key) ?? 0) + Math.max(0, session.duration_sec));
  }
  const entries = [...bySubject.entries()].filter(([, seconds]) => seconds > 0);
  const total = entries.reduce((sum, [, seconds]) => sum + seconds, 0);

  return (
    <View style={styles.studyBarCard}>
      <View style={styles.studyBarHeader}>
        <Text style={styles.studyBarTitle}>🕐 공부 시간</Text>
        <Text style={styles.studyBarTotal}>{formatDuration(total)}</Text>
      </View>
      <View style={styles.studyBarTrack}>
        {total > 0
          ? entries.map(([sub, seconds]) => (
              <View key={sub} style={{ flex: seconds, backgroundColor: getSubjectColor(sub) }} />
            ))
          : null}
      </View>
      {entries.length ? (
        <View style={styles.studyBarLegend}>
          {entries.map(([sub, seconds]) => (
            <View key={sub} style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: getSubjectColor(sub) }]} />
              <Text style={styles.legendText}>
                {(SUBJECT_LABELS[sub as SubjectCode] ?? "기타")} {formatClock(seconds)}
              </Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.metaText}>오늘 기록이 아직 없어요.</Text>
      )}
    </View>
  );
}

function TimetablePlanner({ data }: { data: ReturnType<typeof useStudentM2Data> }) {
  const [mode, setMode] = useState<"day" | "week">("day");
  const [composing, setComposing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dayOfWeek, setDayOfWeek] = useState(new Date().getDay());
  const [type, setType] = useState<ActivityType>("self");
  const [label, setLabel] = useState("");
  const [startTime, setStartTime] = useState("17:00");
  const [endTime, setEndTime] = useState("18:00");
  const editingBlock = data.timetableBlocks.find((block) => block.id === editingId);

  useEffect(() => {
    if (!editingBlock) return;
    setDayOfWeek(editingBlock.day_of_week);
    setType(editingBlock.type);
    setLabel(editingBlock.label ?? "");
    setStartTime(formatMinutes(editingBlock.start_min));
    setEndTime(formatMinutes(editingBlock.end_min));
  }, [editingBlock]);

  async function saveBlock() {
    if (!data.session) return;
    const startMin = parseTime(startTime);
    const endMin = parseTime(endTime);

    if (startMin === null || endMin === null || endMin <= startMin) {
      data.setMessage("시간은 HH:MM 형식이고 종료가 시작보다 늦어야 해요.");
      return;
    }

    const payload = {
      student_id: data.session.user.id,
      type,
      day_of_week: dayOfWeek,
      start_min: startMin,
      end_min: endMin,
      label: label.trim() || activityLabels[type]
    };
    const result = editingBlock
      ? await supabase.from("timetable_blocks").update(payload).eq("id", editingBlock.id)
      : await supabase.from("timetable_blocks").insert(payload);

    data.setMessage(result.error ? result.error.message : editingBlock ? "시간표를 수정했어요." : "시간표를 추가했어요.");
    if (!result.error) {
      closeForm();
    }
    await data.refresh();
  }

  async function deleteBlock(block: TimetableBlockRow) {
    const { error } = await supabase.from("timetable_blocks").delete().eq("id", block.id);
    data.setMessage(error ? error.message : "시간표를 삭제했어요.");
    if (!error) closeForm();
    await data.refresh();
  }

  function closeForm() {
    setEditingId(null);
    setComposing(false);
    setLabel("");
  }

  const showForm = composing || Boolean(editingBlock);
  const hasLocked = data.timetableBlocks.some((block) => block.type === "class");

  if (showForm) {
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{editingBlock ? "활동 수정" : "새 활동"}</Text>
        <View style={styles.cardBody}>
          <ChoiceRow
            label="요일"
            options={dayLabels.map((day, index) => [index, day])}
            value={dayOfWeek}
            onChange={setDayOfWeek}
          />
          <ChoiceRow
            label="유형"
            options={(Object.keys(activityLabels) as ActivityType[]).map((option) => [option, activityLabels[option]])}
            value={type}
            onChange={setType}
          />
          <InputRow label="이름" value={label} onChange={setLabel} placeholder="예: 수학 학원" />
          <View style={styles.formGrid}>
            <InputRow label="시작" value={startTime} onChange={setStartTime} placeholder="17:00" />
            <InputRow label="종료" value={endTime} onChange={setEndTime} placeholder="18:00" />
          </View>
          <View style={styles.inlineActions}>
            <ActionButton label={editingBlock ? "수정 저장" : "추가"} onPress={() => void saveBlock()} tone="brand" />
            <ActionButton label="취소" onPress={closeForm} tone="neutral" />
            {editingBlock ? (
              <ActionButton label="삭제" onPress={() => void deleteBlock(editingBlock)} tone="danger" />
            ) : null}
          </View>
        </View>
      </View>
    );
  }

  const visibleBlocks = (
    mode === "day"
      ? data.timetableBlocks.filter((block) => block.day_of_week === dayOfWeek)
      : data.timetableBlocks
  )
    .slice()
    .sort((a, b) => a.day_of_week - b.day_of_week || a.start_min - b.start_min);

  return (
    <>
      <View style={styles.activityLegend}>
        {(Object.keys(activityLabels) as ActivityType[]).map((activity) => (
          <View key={activity} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: activityColors[activity] }]} />
            <Text style={styles.legendText}>{activityLabels[activity]}</Text>
          </View>
        ))}
        <Pressable onPress={() => setComposing(true)} style={styles.legendAdd}>
          <Text style={styles.legendAddText}>+ 활동 추가</Text>
        </Pressable>
      </View>

      {hasLocked ? (
        <View style={styles.lockBanner}>
          <Text style={styles.lockBannerText}>🔒 쌤 수업은 자동으로 연결돼요 (직접 수정 불가)</Text>
        </View>
      ) : null}

      <SegmentedControl
        options={[
          ["day", "일"],
          ["week", "주"]
        ]}
        value={mode}
        onChange={setMode}
      />

      {mode === "day" ? (
        <View style={styles.dayChips}>
          {dayLabels.map((day, index) => (
            <Pressable
              key={day}
              onPress={() => setDayOfWeek(index)}
              style={[styles.dayChip, dayOfWeek === index ? styles.dayChipActive : null]}
            >
              <Text style={[styles.dayChipText, dayOfWeek === index ? styles.dayChipTextActive : null]}>{day}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <HomeCard
        title={mode === "day" ? `${dayLabels[dayOfWeek]}요일 시간표` : "주간 시간표"}
        right={<Text style={styles.countBadge}>{`${visibleBlocks.length}개`}</Text>}
      >
        {visibleBlocks.length ? (
          visibleBlocks.map((block) => (
            <TimetableBlockCard
              block={block}
              key={block.id}
              onEdit={block.type === "class" ? undefined : () => setEditingId(block.id)}
              showDay={mode === "week"}
            />
          ))
        ) : (
          <EmptyText>아직 시간표가 없어요. ‘+ 활동 추가’로 만들어 보세요.</EmptyText>
        )}
      </HomeCard>
    </>
  );
}

function TimetableBlockCard({
  block,
  onEdit,
  showDay
}: {
  block: TimetableBlockRow;
  onEdit?: () => void;
  showDay?: boolean;
}) {
  const background = activityColors[block.type];
  const textColor = onColorText(background);
  const locked = block.type === "class";

  return (
    <Pressable disabled={!onEdit} onPress={() => onEdit?.()} style={[styles.blockCard, { backgroundColor: background }]}>
      <View style={styles.blockCardRow}>
        <Text style={[styles.blockCardLabel, { color: textColor }]} numberOfLines={1}>
          {showDay ? `${dayLabels[block.day_of_week]} · ` : ""}
          {block.label ?? activityLabels[block.type]}
        </Text>
        {locked ? <Text style={[styles.blockCardLock, { color: textColor }]}>🔒</Text> : null}
      </View>
      <Text style={[styles.blockCardTime, { color: textColor }]}>
        {formatMinutes(block.start_min)}–{formatMinutes(block.end_min)}
      </Text>
    </Pressable>
  );
}

function CalendarPlanner({ data }: { data: ReturnType<typeof useStudentM2Data> }) {
  const todayKey = getDateKey(new Date());
  const [selected, setSelected] = useState(todayKey);
  const cursor = new Date(`${todayKey}T00:00:00.000Z`);
  const year = cursor.getUTCFullYear();
  const month = cursor.getUTCMonth();
  const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;

  const secByDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const session of data.studySessions) {
      const key = getDateKey(session.started_at);
      map.set(key, (map.get(key) ?? 0) + Math.max(0, session.duration_sec));
    }
    return map;
  }, [data.studySessions]);

  const firstDow = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: Array<string | null> = [
    ...Array.from({ length: firstDow }, () => null),
    ...Array.from({ length: daysInMonth }, (_value, index) => `${monthPrefix}-${String(index + 1).padStart(2, "0")}`)
  ];
  const monthSeconds = [...secByDay.entries()]
    .filter(([day]) => day.startsWith(monthPrefix))
    .reduce((sum, [, seconds]) => sum + seconds, 0);
  const studiedDays = [...secByDay.entries()].filter(([day, seconds]) => day.startsWith(monthPrefix) && seconds > 0).length;

  const selectedTodos = data.todos.filter((todo) => todo.due_date === selected);
  const selectedBlocks = data.timetableBlocks.filter(
    (block) => block.day_of_week === new Date(`${selected}T00:00:00.000Z`).getUTCDay()
  );
  const weekdayLabels = ["일", "월", "화", "수", "목", "금", "토"] as const;

  return (
    <>
      <HomeCard
        title={`${year}년 ${month + 1}월`}
        right={
          <View style={styles.calLegend}>
            <View style={[styles.legendDot, { backgroundColor: colors.flame }]} />
            <Text style={styles.legendText}>오늘</Text>
          </View>
        }
      >
        <View style={styles.calWeekHeader}>
          {weekdayLabels.map((label) => (
            <Text key={label} style={styles.calWeekHeaderText}>
              {label}
            </Text>
          ))}
        </View>
        <View style={styles.calGrid}>
          {cells.map((day, index) => {
            if (!day) return <View key={`blank-${index}`} style={styles.calCell} />;
            const seconds = secByDay.get(day) ?? 0;
            const intensity = seconds > 3 * 3600 ? 2 : seconds > 0 ? 1 : 0;
            const isToday = day === todayKey;
            const isSelected = day === selected;
            const hasTodo = data.todos.some((todo) => todo.due_date === day);
            return (
              <Pressable key={day} onPress={() => setSelected(day)} style={styles.calCell}>
                <View
                  style={[
                    styles.calDay,
                    intensity === 1 ? styles.calDaySome : null,
                    intensity === 2 ? styles.calDayLots : null,
                    isToday ? styles.calDayToday : null,
                    isSelected ? styles.calDaySelected : null
                  ]}
                >
                  <Text style={[styles.calDayText, intensity === 2 ? styles.calDayTextStrong : null]}>
                    {Number(day.slice(8))}
                  </Text>
                </View>
                <View style={[styles.calTodoDot, hasTodo ? styles.calTodoDotOn : null]} />
              </Pressable>
            );
          })}
        </View>
      </HomeCard>

      <HomeCard
        title={`${Number(selected.slice(5, 7))}월 ${Number(selected.slice(8))}일${selected === todayKey ? " (오늘)" : ""}`}
        right={<Text style={styles.countBadge}>🕐 {formatDuration(secByDay.get(selected) ?? 0)}</Text>}
      >
        {selectedBlocks.map((block) => (
          <View key={block.id} style={styles.calRow}>
            <Text style={styles.calRowTime}>{formatMinutes(block.start_min)}</Text>
            <Text style={styles.calRowLabel}>{block.label ?? activityLabels[block.type]}</Text>
          </View>
        ))}
        {selectedTodos.map((todo) => (
          <View key={todo.id} style={styles.calRow}>
            <View style={[styles.legendDot, { backgroundColor: getSubjectColor(todo.subject ?? "etc") }]} />
            <Text
              style={[styles.calRowLabel, todo.status === "done" ? styles.todoRowTitleDone : null]}
              numberOfLines={1}
            >
              {todo.title}
            </Text>
          </View>
        ))}
        {!selectedBlocks.length && !selectedTodos.length ? <EmptyText>이 날 계획이 없어요.</EmptyText> : null}
        <Link href={"/todo/new" as Href} asChild>
          <Pressable style={styles.addRow}>
            <Text style={styles.addRowText}>+ 이 날 일정·할 일 추가</Text>
          </Pressable>
        </Link>
      </HomeCard>

      <View style={styles.statRow}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{studiedDays}일</Text>
          <Text style={styles.statLabel}>이 달 공부한 날</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{formatDuration(monthSeconds)}</Text>
          <Text style={styles.statLabel}>이 달 누적</Text>
        </View>
      </View>
    </>
  );
}

function HeroCard({
  activeSession,
  goalSeconds,
  studySeconds,
  variant
}: {
  activeSession?: StudySessionRow;
  goalSeconds: number;
  studySeconds: number;
  variant: "tutored" | "self_study" | "zero";
}) {
  const hasGoal = goalSeconds > 0;
  const progress = hasGoal ? Math.min(100, Math.round((studySeconds / goalSeconds) * 100)) : 0;
  const remaining = Math.max(0, goalSeconds - studySeconds);
  const isZero = variant === "zero";

  return (
    <View style={styles.hero}>
      <View style={styles.heroRow}>
        <View style={styles.ring}>
          <Text style={styles.ringValue}>{formatClock(studySeconds)}</Text>
          <Text style={styles.ringLabel}>{hasGoal ? formatHourLabel(goalSeconds) : "오늘"}</Text>
        </View>
        <View style={styles.heroInfo}>
          {isZero ? (
            <>
              <Text style={styles.heroTitle}>오늘 공부를 시작해볼까요?</Text>
              <Text style={styles.heroBody}>타이머를 켜면 공부 시간이 자동으로 쌓여요.</Text>
            </>
          ) : (
            <>
              <Text style={styles.heroEyebrow}>목표까지</Text>
              <Text style={styles.heroTitle}>{hasGoal ? formatDuration(remaining) : "목표 미설정"}</Text>
              <Text style={styles.heroBody}>
                {hasGoal ? `오늘 목표 · ${progress}% 달성` : "시간표를 넣으면 오늘 목표가 생겨요."}
              </Text>
            </>
          )}
        </View>
      </View>

      <View style={styles.heroActions}>
        <Link href={"/timer" as Href} asChild>
          <Pressable style={StyleSheet.flatten([styles.heroPrimary, styles.flameButton])}>
            <Text style={styles.heroPrimaryText}>{activeSession ? "▶ 타이머 열기" : "▶ 공부 시작"}</Text>
          </Pressable>
        </Link>
        {!isZero ? (
          <Link href={(activeSession?.focus_mode ? "/focus/session" : "/focus/intro") as Href} asChild>
            <Pressable style={styles.heroGhost}>
              <Text style={styles.heroGhostText}>
                {activeSession?.focus_mode ? "◎ 집중 타이머 이어서" : "◎ 집중 모드로 시작 · 졸음 점검"}
              </Text>
            </Pressable>
          </Link>
        ) : null}
      </View>
    </View>
  );
}

function HomeHeader({
  dateLabel,
  greeting,
  name,
  streakCount
}: {
  dateLabel: string;
  greeting: string;
  name: string;
  streakCount: number;
}) {
  return (
    <View style={styles.homeHeader}>
      <View style={styles.flex}>
        <Text style={styles.homeDate}>{dateLabel}</Text>
        <Text style={styles.homeGreeting}>
          {name}님, {greeting}
        </Text>
      </View>
      {streakCount > 0 ? (
        <View style={styles.streakChip}>
          <Text style={styles.streakChipText}>🔥 {streakCount}일</Text>
        </View>
      ) : null}
    </View>
  );
}

function ConnectNudge() {
  return (
    <Link href={"/onboarding/connect" as Href} asChild>
      <Pressable style={styles.nudge}>
        <Text style={styles.nudgeText}>🔥 선생님과 연결하면 숙제·리포트로 함께 관리해요</Text>
        <Text style={styles.nudgeArrow}>›</Text>
      </Pressable>
    </Link>
  );
}

function HomeCard({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>{title}</Text>
        {right ? <View style={styles.cardHeaderRight}>{right}</View> : null}
      </View>
      <View style={styles.cardBody}>{children}</View>
    </View>
  );
}

function SoftTag({
  children,
  tone
}: {
  children: ReactNode;
  tone: "subject" | "brand" | "lock";
}) {
  const boxStyle = tone === "brand" ? styles.tagBrand : tone === "lock" ? styles.tagLock : styles.tagSubject;
  const textStyle = tone === "brand" ? styles.tagBrandText : tone === "lock" ? styles.tagLockText : styles.tagSubjectText;
  return (
    <View style={[styles.tag, boxStyle]}>
      <Text style={[styles.tagText, textStyle]}>{children}</Text>
    </View>
  );
}

function StudyTodoRow({
  onToggleStatus,
  todo
}: {
  onToggleStatus: (todo: TodoRow) => Promise<void>;
  todo: TodoRow;
}) {
  const done = todo.status === "done";
  return (
    <Pressable onPress={() => void onToggleStatus(todo)} style={styles.todoRow}>
      <View style={[styles.checkbox, done ? styles.checkboxDone : null]}>
        {done ? <Text style={styles.checkboxMark}>✓</Text> : null}
      </View>
      <Text style={[styles.todoRowTitle, done ? styles.todoRowTitleDone : null]} numberOfLines={1}>
        {todo.title}
      </Text>
      {todo.ai_check_enabled ? <SoftTag tone="brand">AI 검사</SoftTag> : null}
      <SoftTag tone="subject">{todo.subject ? SUBJECT_LABELS[todo.subject] : "기타"}</SoftTag>
    </Pressable>
  );
}

function TodoCard({
  emptyText,
  onToggleStatus,
  title,
  todos
}: {
  emptyText: string;
  onToggleStatus: (todo: TodoRow) => Promise<void>;
  title: string;
  todos: TodoRow[];
}) {
  const done = todos.filter((todo) => todo.status === "done").length;
  return (
    <HomeCard
      title={title}
      right={todos.length ? <Text style={styles.countBadge}>{`${done}/${todos.length}`}</Text> : undefined}
    >
      {todos.length ? (
        todos.slice(0, 4).map((todo) => <StudyTodoRow key={todo.id} onToggleStatus={onToggleStatus} todo={todo} />)
      ) : (
        <EmptyText>{emptyText}</EmptyText>
      )}
      <Link href={"/planner" as Href} asChild>
        <Pressable style={styles.textLink}>
          <Text style={styles.textLinkLabel}>플래너에서 관리 ›</Text>
        </Pressable>
      </Link>
    </HomeCard>
  );
}

function TeacherHomeworkCard({
  onToggleStatus,
  todos
}: {
  onToggleStatus: (todo: TodoRow) => Promise<void>;
  todos: TodoRow[];
}) {
  const done = todos.filter((todo) => todo.status === "done").length;
  return (
    <HomeCard
      title="선생님 숙제"
      right={todos.length ? <Text style={styles.countBadge}>{`${done}/${todos.length}`}</Text> : undefined}
    >
      {todos.length ? (
        todos.slice(0, 4).map((todo) => <StudyTodoRow key={todo.id} onToggleStatus={onToggleStatus} todo={todo} />)
      ) : (
        <EmptyText>오늘 마감인 선생님 숙제는 없어요.</EmptyText>
      )}
    </HomeCard>
  );
}

function ZeroTodoCard() {
  return (
    <View style={styles.zeroCard}>
      <View style={styles.zeroIcon}>
        <Text style={styles.zeroIconText}>🗒️</Text>
      </View>
      <Text style={styles.zeroCardTitle}>아직 할 일이 없어요</Text>
      <Text style={styles.zeroCardBody}>오늘 공부할 것을 추가하고{"\n"}하나씩 체크해 보세요.</Text>
      <Link href={"/planner" as Href} asChild>
        <Pressable style={StyleSheet.flatten([styles.zeroButton, styles.brandButton])}>
          <Text style={styles.actionButtonPrimaryText}>+ 첫 할 일 추가</Text>
        </Pressable>
      </Link>
    </View>
  );
}

function PeerRankingCard({ ranking }: { ranking: PeerRankingSnapshot | null }) {
  const showRanking = canShowPeerRanking(ranking);

  return (
    <HomeCard title="지금 공부 중인 또래" right={<Text style={styles.countBadge}>익명</Text>}>
      {ranking && showRanking ? (
        <>
          <View style={styles.rankMeRow}>
            <View style={styles.rankMeBadge}>
              <Text style={styles.rankMeBadgeText}>나</Text>
            </View>
            <Text style={styles.rankMeName}>나의 순위</Text>
            <Text style={styles.rankMeValue}>상위 {ranking.rank_percentile}%</Text>
          </View>
          <View style={styles.rankRow}>
            <Text style={styles.rankRowLabel}>내 7일 공부</Text>
            <Text style={styles.rankRowValue}>{ranking.current_user_minutes}분</Text>
          </View>
          <View style={styles.rankRow}>
            <Text style={styles.rankRowLabel}>또래 평균</Text>
            <Text style={styles.rankRowValue}>{ranking.peer_average_minutes}분</Text>
          </View>
        </>
      ) : ranking ? (
        <EmptyText>
          또래 비교는 같은 학년 친구가 {ranking.min_cohort}명 이상 모이면 보여드려요. (지금 {ranking.peer_count + 1}명)
        </EmptyText>
      ) : (
        <EmptyText>같은 학년 집계를 만들 데이터가 아직 없어요.</EmptyText>
      )}
      <Text style={styles.privacyNote}>최소 {PEER_RANKING_MIN_COHORT}명 이상 모일 때만 익명 평균·백분위를 보여줘요.</Text>
    </HomeCard>
  );
}

function ClassCard({
  activeConnections,
  doneCount,
  totalCount
}: {
  activeConnections: number;
  doneCount: number;
  totalCount: number;
}) {
  const dots = AVATAR_COLORS.slice(0, Math.min(AVATAR_COLORS.length, Math.max(1, activeConnections)));
  return (
    <HomeCard
      title={`우리 반 ${activeConnections}명 공부 중`}
      right={totalCount ? <Text style={styles.countBadge}>{`${doneCount}/${totalCount}`}</Text> : undefined}
    >
      <View style={styles.avatarRow}>
        <View style={styles.avatarStack}>
          {dots.map((color) => (
            <View key={color} style={[styles.avatar, { backgroundColor: color }]} />
          ))}
        </View>
        <Text style={styles.classMeta}>선생님과 같은 플래너로 함께 공부하고 있어요.</Text>
      </View>
    </HomeCard>
  );
}

function AuthGate({ message }: { message: string }) {
  return (
    <ScrollView contentContainerStyle={styles.authContent} style={styles.screen}>
      <View style={styles.authPanel}>
        <Text style={styles.kicker}>쌤플래너</Text>
        <Text style={styles.pageTitle}>로그인이 필요해요</Text>
        <Text style={styles.bodyText}>{message}</Text>
        <View style={styles.inlineActions}>
          <Link href={"/signup" as Href} asChild>
            <Pressable style={StyleSheet.flatten([styles.actionButton, styles.brandButton])}>
              <Text style={styles.actionButtonPrimaryText}>가입·로그인</Text>
            </Pressable>
          </Link>
          <Link href={"/forgot" as Href} asChild>
            <Pressable style={StyleSheet.flatten([styles.actionButton, styles.neutralButton])}>
              <Text style={styles.actionButtonText}>비밀번호 찾기</Text>
            </Pressable>
          </Link>
        </View>
      </View>
    </ScrollView>
  );
}

type StudentTab = "today" | "planner" | "class" | "ai" | "records";

export function AppShell({
  activeTab,
  children,
  header,
  loading,
  message,
  subtitle,
  title
}: {
  activeTab: StudentTab;
  children: ReactNode;
  header?: ReactNode;
  loading: boolean;
  message: string;
  subtitle?: string;
  title?: string;
}) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={[styles.scrollContent, isTablet ? styles.scrollContentTablet : null]}>
        {header ?? (
          <View style={styles.pageHeader}>
            <View style={styles.flex}>
              <Text style={styles.pageTitle}>{title}</Text>
              {subtitle ? <Text style={styles.pageSubtitle}>{subtitle}</Text> : null}
            </View>
            {loading ? <ActivityIndicator color={colors.brand} /> : null}
          </View>
        )}
        {message ? (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>{message}</Text>
          </View>
        ) : null}
        {isTablet ? (
          <View style={styles.tabletGrid}>
            {Children.map(children, (child) => (child ? <View style={styles.tabletCell}>{child}</View> : null))}
          </View>
        ) : (
          children
        )}
      </ScrollView>
      <BottomNav active={activeTab} />
    </View>
  );
}

const STUDENT_TABS: Array<{ tab: StudentTab; href: string; label: string; icon: string }> = [
  { tab: "today", href: "/today", label: "오늘", icon: "🏠" },
  { tab: "planner", href: "/planner", label: "플래너", icon: "🗒️" },
  { tab: "class", href: "/class", label: "또래", icon: "👥" },
  { tab: "ai", href: "/ai", label: "AI추천", icon: "✨" },
  { tab: "records", href: "/records", label: "기록", icon: "📊" }
];

function BottomNav({ active }: { active: StudentTab }) {
  return (
    <View style={styles.bottomNav}>
      {STUDENT_TABS.map((item) => (
        <NavLink active={active === item.tab} href={item.href} icon={item.icon} key={item.tab} label={item.label} />
      ))}
    </View>
  );
}

function NavLink({
  active,
  href,
  icon,
  label
}: {
  active: boolean;
  href: string;
  icon: string;
  label: string;
}) {
  return (
    <Link href={href as Href} asChild>
      <Pressable style={styles.navItem}>
        <Text style={[styles.navIcon, active ? styles.navIconActive : null]}>{icon}</Text>
        <Text style={[styles.navText, active ? styles.navTextActive : null]}>{label}</Text>
      </Pressable>
    </Link>
  );
}

export function StudentClassScreen() {
  const data = useStudentM2Data();
  const activeConnections = data.connections.filter((connection) => connection.status === "active");
  const variant = getStudentHomeVariant({
    activeConnectionCount: activeConnections.length,
    todoCount: data.todos.length,
    timetableBlockCount: data.timetableBlocks.length,
    studySessionCount: data.studySessions.length
  });

  if (!data.session) {
    return <AuthGate message={data.message} />;
  }

  const tutored = variant === "tutored";

  return (
    <AppShell
      activeTab="class"
      loading={data.loading}
      message={data.message}
      subtitle={tutored ? "선생님과 연결된 친구들과 함께해요." : "같은 학년 친구들과 익명으로 비교해요."}
      title={tutored ? "우리 반" : "또래"}
    >
      {tutored ? (
        <ClassCard activeConnections={activeConnections.length} doneCount={0} totalCount={0} />
      ) : null}
      <PeerRankingCard ranking={data.peerRanking} />
      <RecentDaysCard sessions={data.studySessions} />
    </AppShell>
  );
}

function RecentDaysCard({ sessions }: { sessions: StudySessionRow[] }) {
  const todayKey = getDateKey(new Date());
  const days = Array.from({ length: 14 }, (_value, index) => shiftDate(todayKey, index - 13));
  const secByDay = new Map<string, number>();
  for (const session of sessions) {
    const key = getDateKey(session.started_at);
    secByDay.set(key, (secByDay.get(key) ?? 0) + Math.max(0, session.duration_sec));
  }
  const max = Math.max(1, ...days.map((day) => secByDay.get(day) ?? 0));

  return (
    <HomeCard title="최근 14일 공부 흐름" right={<Text style={styles.countBadge}>익명</Text>}>
      <View style={styles.recStrip}>
        {days.map((day) => {
          const seconds = secByDay.get(day) ?? 0;
          const ratio = seconds / max;
          const isToday = day === todayKey;
          // 높이는 실제 값에 비례(0이면 바닥의 옅은 stub). 색은 강도별 인디고, 오늘만(데이터 있을 때) 주황.
          const heightPct = seconds > 0 ? Math.max(24, Math.round(ratio * 100)) : 12;
          const fill =
            seconds === 0
              ? styles.recBarEmpty
              : isToday
                ? styles.recBarToday
                : ratio > 0.5
                  ? styles.recBarLots
                  : styles.recBarSome;
          return <View key={day} style={[styles.recBar, fill, { height: `${heightPct}%` }]} />;
        })}
      </View>
      <Text style={styles.privacyNote}>친구 개개인 정보는 보이지 않아요 — 익명 집계만 사용해요.</Text>
    </HomeCard>
  );
}

export function StudentRecordsScreen() {
  const data = useStudentM2Data();
  const [range, setRange] = useState<"day" | "week" | "month">("week");

  if (!data.session) {
    return <AuthGate message={data.message} />;
  }

  const todayKey = getDateKey(new Date());
  const offsetToMonday = (new Date(`${todayKey}T00:00:00.000Z`).getUTCDay() + 6) % 7;
  const monday = shiftDate(todayKey, -offsetToMonday);
  const weekDays = Array.from({ length: 7 }, (_value, index) => shiftDate(monday, index));
  const dayLabelsMon = ["월", "화", "수", "목", "금", "토", "일"] as const;

  const secByDay = new Map<string, number>();
  const secBySubject = new Map<string, number>();
  for (const session of data.studySessions) {
    const key = getDateKey(session.started_at);
    secByDay.set(key, (secByDay.get(key) ?? 0) + Math.max(0, session.duration_sec));
    if (weekDays.includes(key)) {
      const subjectKey = session.subject ?? "etc";
      secBySubject.set(subjectKey, (secBySubject.get(subjectKey) ?? 0) + Math.max(0, session.duration_sec));
    }
  }

  const weekTotal = weekDays.reduce((sum, day) => sum + (secByDay.get(day) ?? 0), 0);
  const prevWeekTotal = Array.from({ length: 7 }, (_value, index) => shiftDate(monday, index - 7)).reduce(
    (sum, day) => sum + (secByDay.get(day) ?? 0),
    0
  );
  const diff = weekTotal - prevWeekTotal;
  const streak = calculateStudyStreak(data.studySessions, new Date());
  const maxDay = Math.max(1, ...weekDays.map((day) => secByDay.get(day) ?? 0));
  const subjectEntries = [...secBySubject.entries()].filter(([, seconds]) => seconds > 0);
  const subjectTotal = subjectEntries.reduce((sum, [, seconds]) => sum + seconds, 0);

  return (
    <AppShell activeTab="records" loading={data.loading} message={data.message} title="공부 기록">
      <SegmentedControl
        options={[
          ["day", "일"],
          ["week", "주"],
          ["month", "월"]
        ]}
        value={range}
        onChange={setRange}
      />

      <View style={styles.statRow}>
        <View style={[styles.statCard, styles.statCardDark]}>
          <Text style={styles.statLabelInverse}>이번 주 공부시간</Text>
          <Text style={styles.statValueInverse}>{formatDuration(weekTotal)}</Text>
          <Text style={styles.statDelta}>
            지난주 {diff >= 0 ? "+" : "−"}
            {formatDuration(Math.abs(diff))}
          </Text>
        </View>
        <View style={[styles.statCard, styles.statCardFlame]}>
          <Text style={styles.statLabelFlame}>연속 기록</Text>
          <Text style={styles.statValueFlame}>{streak.count}일</Text>
          <Text style={styles.statLabel}>꾸준히 이어가요</Text>
        </View>
      </View>

      <HomeCard title="요일별 공부시간">
        <View style={styles.barChart}>
          {weekDays.map((day, index) => {
            const seconds = secByDay.get(day) ?? 0;
            // 값이 0이면 빈 막대(높이 0), 값이 있으면 실제 비례(아주 작은 값도 보이게 최소 8%).
            const ratio = seconds > 0 ? Math.max(0.08, seconds / maxDay) : 0;
            const isToday = day === todayKey;
            return (
              <View key={day} style={styles.barCol}>
                <View style={styles.barTrack}>
                  <View
                    style={[styles.barFill, isToday ? styles.barFillToday : null, { height: `${Math.round(ratio * 100)}%` }]}
                  />
                </View>
                <Text style={[styles.barLabel, isToday ? styles.barLabelToday : null]}>{dayLabelsMon[index]}</Text>
              </View>
            );
          })}
        </View>
      </HomeCard>

      <HomeCard title="과목별 비중">
        <View style={styles.studyBarTrack}>
          {subjectTotal > 0 ? (
            subjectEntries.map(([sub, seconds]) => (
              <View key={sub} style={{ flex: seconds, backgroundColor: getSubjectColor(sub) }} />
            ))
          ) : (
            <View style={[styles.flex, styles.studyBarEmpty]} />
          )}
        </View>
        {subjectEntries.length ? (
          <View style={styles.studyBarLegend}>
            {subjectEntries.map(([sub, seconds]) => (
              <View key={sub} style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: getSubjectColor(sub) }]} />
                <Text style={styles.legendText}>
                  {SUBJECT_LABELS[sub as SubjectCode] ?? "기타"} {Math.round((seconds / 3600) * 10) / 10}h
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={styles.metaText}>이번 주 기록이 아직 없어요.</Text>
        )}
      </HomeCard>
    </AppShell>
  );
}

function SegmentedControl<T extends string>({
  onChange,
  options,
  value
}: {
  onChange: (value: T) => void;
  options: Array<[T, string]>;
  value: T;
}) {
  return (
    <View style={styles.segmented}>
      {options.map(([option, label]) => (
        <Pressable
          key={option}
          onPress={() => onChange(option)}
          style={[styles.segmentButton, value === option ? styles.segmentButtonActive : null]}
        >
          <Text style={[styles.segmentText, value === option ? styles.segmentTextActive : null]}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function ChoiceRow<T extends string | number>({
  label,
  onChange,
  options,
  value
}: {
  label: string;
  onChange: (value: T) => void;
  options: Array<[T, string]>;
  value: T;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.choiceWrap}>
        {options.map(([option, optionLabel]) => (
          <Pressable
            key={String(option)}
            onPress={() => onChange(option)}
            style={[styles.choice, value === option ? styles.choiceActive : null]}
          >
            <Text style={[styles.choiceText, value === option ? styles.choiceTextActive : null]}>{optionLabel}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function InputRow({
  label,
  onChange,
  placeholder,
  value
}: {
  label: string;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        autoCapitalize="none"
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        style={styles.input}
        value={value}
      />
    </View>
  );
}

function ToggleRow({
  disabled = false,
  label,
  onValueChange,
  value
}: {
  disabled?: boolean;
  label: string;
  onValueChange: (value: boolean) => void;
  value: boolean;
}) {
  return (
    <View style={styles.switchRow}>
      <Text style={[styles.fieldLabel, disabled ? styles.mutedText : null]}>{label}</Text>
      <Switch
        disabled={disabled}
        onValueChange={onValueChange}
        thumbColor={colors.surface}
        trackColor={{ false: colors.line, true: colors.brand }}
        value={value}
      />
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
  tone: "brand" | "danger" | "flame" | "neutral";
}) {
  const buttonStyle =
    tone === "brand"
      ? styles.brandButton
      : tone === "danger"
        ? styles.dangerButton
        : tone === "flame"
          ? styles.flameButton
          : styles.neutralButton;
  const textStyle = tone === "neutral" ? styles.actionButtonText : styles.actionButtonPrimaryText;

  return (
    <Pressable onPress={onPress} style={[styles.actionButton, buttonStyle]}>
      <Text style={textStyle}>{label}</Text>
    </Pressable>
  );
}

function EmptyText({ children }: { children: ReactNode }) {
  return <Text style={styles.emptyText}>{children}</Text>;
}

function parsePlannerView(value: string | string[] | undefined): PlannerView {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate === "timetable" || candidate === "calendar" ? candidate : "todos";
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) return "0분";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (!hours) return `${minutes}분`;
  if (!minutes) return `${hours}시간`;
  return `${hours}시간 ${minutes}분`;
}

function formatClock(seconds: number): string {
  const safe = Math.max(0, seconds);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  return `${hours}:${minutes.toString().padStart(2, "0")}`;
}

function formatHourLabel(seconds: number): string {
  const hours = Math.round((seconds / 3600) * 10) / 10;
  return `/ ${hours % 1 === 0 ? hours : hours.toFixed(1)}시간`;
}

function formatKoreanDate(date: Date): string {
  const days = ["일", "월", "화", "수", "목", "금", "토"] as const;
  return `${date.getMonth() + 1}월 ${date.getDate()}일 ${days[date.getDay()]}요일`;
}

function getTodayGoalSeconds(blocks: TimetableBlockRow[]): number {
  const today = new Date().getDay();
  return blocks
    .filter((block) => block.day_of_week === today && (block.type === "self" || block.type === "class"))
    .reduce((total, block) => total + Math.max(0, block.end_min - block.start_min) * 60, 0);
}

function parseTime(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function formatMinutes(minutes: number): string {
  const hour = Math.floor(minutes / 60).toString().padStart(2, "0");
  const minute = (minutes % 60).toString().padStart(2, "0");
  return `${hour}:${minute}`;
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
  scrollContentTablet: {
    maxWidth: 1040,
    paddingHorizontal: spacing.xl
  },
  tabletGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-start",
    gap: spacing.lg
  },
  tabletCell: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "47%",
    minWidth: 300
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
  hero: {
    gap: spacing.lg,
    padding: spacing.xl,
    borderRadius: radii.card,
    backgroundColor: colors.ink
  },
  heroTop: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  heroTitle: {
    color: colors.surface,
    fontSize: 28,
    fontWeight: "900",
    lineHeight: 34
  },
  heroBody: {
    color: colors.surface,
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 22
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
    borderRadius: radii.control,
    backgroundColor: colors.canvas
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
    flex: 1,
    color: colors.ink,
    fontSize: 20,
    fontWeight: "900",
    lineHeight: 26
  },
  sectionBody: {
    gap: spacing.md
  },
  simpleTodoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.control,
    backgroundColor: colors.canvas
  },
  todoItem: {
    gap: spacing.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.control,
    backgroundColor: colors.canvas
  },
  todoMain: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md
  },
  todoActions: {
    gap: spacing.sm
  },
  itemTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  itemTitle: {
    flexShrink: 1,
    color: colors.ink,
    fontSize: 16,
    fontWeight: "900",
    lineHeight: 22
  },
  metaText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 18
  },
  bodyText: {
    color: colors.muted,
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 23
  },
  emptyText: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 21
  },
  mutedText: {
    color: colors.muted
  },
  flex: {
    flex: 1
  },
  checkButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.control,
    backgroundColor: colors.surface
  },
  checkText: {
    color: colors.brand,
    fontSize: 16,
    fontWeight: "900"
  },
  timeBadge: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.control,
    backgroundColor: colors.surface
  },
  timeBadgeText: {
    color: colors.brand,
    fontSize: 15,
    fontWeight: "900"
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
  chipWarning: {
    backgroundColor: colors.warning
  },
  chipFlame: {
    backgroundColor: colors.flame
  },
  chipText: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: "900"
  },
  chipFlameText: {
    color: colors.surface,
    fontSize: 12,
    fontWeight: "900"
  },
  inlineActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  inlineActionsCompact: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs
  },
  actionButton: {
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.button
  },
  brandButton: {
    backgroundColor: colors.brand
  },
  flameButton: {
    backgroundColor: colors.flame
  },
  dangerButton: {
    backgroundColor: colors.danger
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
  textLink: {
    alignSelf: "flex-start",
    paddingVertical: spacing.xs
  },
  textLinkLabel: {
    color: colors.brand,
    fontSize: 14,
    fontWeight: "900"
  },
  field: {
    gap: spacing.xs
  },
  fieldLabel: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: "900"
  },
  input: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.control,
    backgroundColor: colors.canvas,
    color: colors.ink,
    fontSize: 15,
    fontWeight: "800"
  },
  choiceWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  choice: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.chip,
    backgroundColor: colors.surface
  },
  choiceActive: {
    borderColor: colors.brand,
    backgroundColor: colors.brand
  },
  choiceText: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: "900"
  },
  choiceTextActive: {
    color: colors.surface
  },
  switchRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md
  },
  segmented: {
    flexDirection: "row",
    gap: spacing.xs,
    padding: spacing.xs,
    borderRadius: radii.button,
    backgroundColor: colors.canvas
  },
  segmentButton: {
    flex: 1,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.control
  },
  segmentButtonActive: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line
  },
  segmentText: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: "800"
  },
  segmentTextActive: {
    color: colors.ink,
    fontWeight: "900"
  },
  formGrid: {
    flexDirection: "row",
    gap: spacing.md
  },
  calendarDay: {
    flexDirection: "row",
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.line
  },
  calendarDate: {
    width: 82,
    gap: spacing.xs
  },
  calendarDayText: {
    color: colors.ink,
    fontSize: 17,
    fontWeight: "900"
  },
  calendarItems: {
    flex: 1,
    gap: spacing.xs
  },
  calendarItemText: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 19
  },
  zeroBand: {
    gap: spacing.sm,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.card,
    backgroundColor: colors.surface
  },
  zeroTitle: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: "900"
  },
  bottomNav: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.surface
  },
  navItem: {
    flex: 1,
    alignItems: "center",
    gap: 3,
    paddingVertical: spacing.xs
  },
  navIcon: {
    fontSize: 18,
    opacity: 0.45
  },
  navIconActive: {
    opacity: 1
  },
  navText: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "800"
  },
  navTextActive: {
    color: colors.brand
  },
  homeHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md
  },
  homeDate: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "800"
  },
  homeGreeting: {
    marginTop: spacing.xs,
    color: colors.ink,
    fontSize: 24,
    fontWeight: "900",
    lineHeight: 31
  },
  streakChip: {
    flexShrink: 0,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.chip,
    backgroundColor: tints.flameSoft
  },
  streakChipText: {
    color: colors.flame,
    fontSize: 13,
    fontWeight: "900"
  },
  nudge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: tints.flameNudgeBorder,
    borderRadius: radii.control,
    backgroundColor: tints.flameNudge
  },
  nudgeText: {
    flex: 1,
    color: colors.ink,
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 19
  },
  nudgeArrow: {
    color: colors.flame,
    fontSize: 18,
    fontWeight: "900"
  },
  heroRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg
  },
  ring: {
    width: 92,
    height: 92,
    borderRadius: 46,
    borderWidth: 6,
    borderColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center"
  },
  ringValue: {
    color: colors.surface,
    fontSize: 22,
    fontWeight: "900",
    fontVariant: [typography.numericVariant]
  },
  ringLabel: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 11,
    fontWeight: "800"
  },
  heroInfo: {
    flex: 1,
    gap: spacing.xs
  },
  heroEyebrow: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 13,
    fontWeight: "800"
  },
  heroActions: {
    gap: spacing.sm
  },
  heroPrimary: {
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.button
  },
  heroPrimaryText: {
    color: colors.surface,
    fontSize: 16,
    fontWeight: "900"
  },
  heroGhost: {
    alignItems: "center",
    paddingVertical: spacing.xs
  },
  heroGhostText: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 13,
    fontWeight: "800"
  },
  card: {
    gap: spacing.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.card,
    backgroundColor: colors.surface
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm
  },
  cardTitle: {
    flexShrink: 1,
    color: colors.ink,
    fontSize: 17,
    fontWeight: "900"
  },
  cardHeaderRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm
  },
  cardBody: {
    gap: spacing.sm
  },
  countBadge: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "900",
    fontVariant: [typography.numericVariant]
  },
  tag: {
    flexShrink: 0,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radii.chip
  },
  tagText: {
    fontSize: 11,
    fontWeight: "900"
  },
  tagSubject: {
    backgroundColor: colors.canvas
  },
  tagSubjectText: {
    color: colors.muted
  },
  tagBrand: {
    backgroundColor: tints.brandSoft
  },
  tagBrandText: {
    color: colors.brand
  },
  tagLock: {
    backgroundColor: tints.warningSoft
  },
  tagLockText: {
    color: tints.warningStrong
  },
  todoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.xs
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center"
  },
  checkboxDone: {
    borderColor: colors.success,
    backgroundColor: colors.success
  },
  checkboxMark: {
    color: colors.surface,
    fontSize: 13,
    fontWeight: "900"
  },
  todoRowTitle: {
    flex: 1,
    color: colors.ink,
    fontSize: 15,
    fontWeight: "800"
  },
  todoRowTitleDone: {
    color: colors.muted,
    textDecorationLine: "line-through"
  },
  zeroCard: {
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.line,
    borderStyle: "dashed",
    borderRadius: radii.card,
    backgroundColor: colors.surface
  },
  zeroIcon: {
    width: 56,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.control,
    backgroundColor: tints.brandSoft
  },
  zeroIconText: {
    fontSize: 24
  },
  zeroCardTitle: {
    color: colors.ink,
    fontSize: 17,
    fontWeight: "900"
  },
  zeroCardBody: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 21,
    textAlign: "center"
  },
  zeroButton: {
    marginTop: spacing.sm,
    minHeight: 48,
    alignSelf: "stretch",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.button
  },
  rankMeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radii.control,
    backgroundColor: tints.brandSoft
  },
  rankMeBadge: {
    width: 26,
    height: 26,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.chip,
    backgroundColor: colors.brand
  },
  rankMeBadgeText: {
    color: colors.surface,
    fontSize: 12,
    fontWeight: "900"
  },
  rankMeName: {
    flex: 1,
    color: colors.ink,
    fontSize: 14,
    fontWeight: "900"
  },
  rankMeValue: {
    color: colors.brand,
    fontSize: 14,
    fontWeight: "900"
  },
  rankRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.sm
  },
  rankRowLabel: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "800"
  },
  rankRowValue: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: "900",
    fontVariant: [typography.numericVariant]
  },
  privacyNote: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 18
  },
  avatarRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md
  },
  avatarStack: {
    flexDirection: "row"
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    marginRight: -8,
    borderWidth: 2,
    borderColor: colors.surface
  },
  classMeta: {
    flex: 1,
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 19
  },
  addRow: {
    paddingVertical: spacing.sm,
    alignItems: "center"
  },
  addRowText: {
    color: colors.brand,
    fontSize: 14,
    fontWeight: "900"
  },
  weekStrip: {
    flexDirection: "row",
    justifyContent: "space-between",
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.card,
    backgroundColor: colors.surface
  },
  weekCol: {
    flex: 1,
    alignItems: "center",
    gap: 4
  },
  weekDow: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "800"
  },
  weekDateBox: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.chip
  },
  weekDateToday: {
    backgroundColor: colors.brand
  },
  weekDate: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: "900",
    fontVariant: [typography.numericVariant]
  },
  weekDateTodayText: {
    color: colors.surface
  },
  weekDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: "transparent"
  },
  weekDotOn: {
    backgroundColor: colors.brand
  },
  studyBarCard: {
    gap: spacing.sm,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.card,
    backgroundColor: colors.surface
  },
  studyBarHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  studyBarTitle: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: "900"
  },
  studyBarTotal: {
    color: colors.brand,
    fontSize: 15,
    fontWeight: "900",
    fontVariant: [typography.numericVariant]
  },
  studyBarTrack: {
    flexDirection: "row",
    height: 12,
    borderRadius: radii.chip,
    overflow: "hidden",
    backgroundColor: colors.canvas
  },
  studyBarEmpty: {
    backgroundColor: colors.line
  },
  studyBarLegend: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs
  },
  legendDot: {
    width: 9,
    height: 9,
    borderRadius: 5
  },
  legendText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800"
  },
  activityLegend: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.card,
    backgroundColor: colors.surface
  },
  legendAdd: {
    marginLeft: "auto",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs
  },
  legendAddText: {
    color: colors.brand,
    fontSize: 13,
    fontWeight: "900"
  },
  lockBanner: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: tints.brandSoft,
    borderRadius: radii.control,
    backgroundColor: tints.brandSoft
  },
  lockBannerText: {
    color: colors.brand,
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 19
  },
  dayChips: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.xs
  },
  dayChip: {
    flex: 1,
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.control,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line
  },
  dayChipActive: {
    backgroundColor: colors.brand,
    borderColor: colors.brand
  },
  dayChipText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "900"
  },
  dayChipTextActive: {
    color: colors.surface
  },
  blockCard: {
    gap: 2,
    padding: spacing.md,
    borderRadius: radii.control
  },
  blockCardRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm
  },
  blockCardLabel: {
    flexShrink: 1,
    fontSize: 15,
    fontWeight: "900"
  },
  blockCardLock: {
    fontSize: 13
  },
  blockCardTime: {
    fontSize: 12,
    fontWeight: "800",
    fontVariant: [typography.numericVariant],
    opacity: 0.9
  },
  calLegend: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs
  },
  calWeekHeader: {
    flexDirection: "row"
  },
  calWeekHeaderText: {
    flex: 1,
    textAlign: "center",
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800"
  },
  calGrid: {
    flexDirection: "row",
    flexWrap: "wrap"
  },
  calCell: {
    width: `${100 / 7}%`,
    alignItems: "center",
    paddingVertical: 3,
    gap: 2
  },
  calDay: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.control
  },
  calDaySome: {
    backgroundColor: tints.brandSoft
  },
  calDayLots: {
    backgroundColor: colors.brand
  },
  calDayToday: {
    borderWidth: 2,
    borderColor: colors.flame
  },
  calDaySelected: {
    borderWidth: 2,
    borderColor: colors.brand
  },
  calDayText: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: "800",
    fontVariant: [typography.numericVariant]
  },
  calDayTextStrong: {
    color: colors.surface
  },
  calTodoDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: "transparent"
  },
  calTodoDotOn: {
    backgroundColor: colors.flame
  },
  calRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.xs
  },
  calRowTime: {
    width: 44,
    color: colors.muted,
    fontSize: 13,
    fontWeight: "900",
    fontVariant: [typography.numericVariant]
  },
  calRowLabel: {
    flex: 1,
    color: colors.ink,
    fontSize: 14,
    fontWeight: "800"
  },
  statRow: {
    flexDirection: "row",
    gap: spacing.md
  },
  statCard: {
    flex: 1,
    gap: spacing.xs,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.card,
    backgroundColor: colors.surface
  },
  statValue: {
    color: colors.ink,
    fontSize: 22,
    fontWeight: "900",
    fontVariant: [typography.numericVariant]
  },
  statLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800"
  },
  recStrip: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 3,
    height: 32
  },
  recBar: {
    flex: 1,
    borderRadius: 3,
    backgroundColor: tints.brandSoft
  },
  recBarEmpty: {
    backgroundColor: colors.line
  },
  recBarSome: {
    backgroundColor: tints.brandSoft
  },
  recBarLots: {
    backgroundColor: colors.brand
  },
  recBarToday: {
    backgroundColor: colors.flame
  },
  statCardDark: {
    borderColor: colors.ink,
    backgroundColor: colors.ink
  },
  statCardFlame: {
    borderColor: tints.flameNudgeBorder,
    backgroundColor: tints.flameNudge
  },
  statLabelInverse: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 12,
    fontWeight: "800"
  },
  statValueInverse: {
    color: colors.surface,
    fontSize: 22,
    fontWeight: "900",
    fontVariant: [typography.numericVariant]
  },
  statDelta: {
    color: colors.success,
    fontSize: 12,
    fontWeight: "800"
  },
  statLabelFlame: {
    color: colors.flame,
    fontSize: 12,
    fontWeight: "800"
  },
  statValueFlame: {
    color: colors.flame,
    fontSize: 22,
    fontWeight: "900",
    fontVariant: [typography.numericVariant]
  },
  barChart: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.sm,
    height: 132
  },
  barCol: {
    flex: 1,
    alignItems: "center",
    gap: spacing.xs
  },
  barTrack: {
    width: "70%",
    height: 104,
    justifyContent: "flex-end",
    borderRadius: radii.control,
    overflow: "hidden",
    backgroundColor: colors.canvas
  },
  barFill: {
    width: "100%",
    borderRadius: radii.control,
    backgroundColor: tints.brandSoft
  },
  barFillToday: {
    backgroundColor: colors.brand
  },
  barLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "800"
  },
  barLabelToday: {
    color: colors.brand
  }
});
