import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { Link, useLocalSearchParams, type Href } from "expo-router";
import { createClient, type Session } from "@supabase/supabase-js";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View
} from "react-native";

import { colors, radii, spacing, typography } from "@ssamplanner/design-tokens";
import {
  SUBJECT_LABELS,
  calculateStudyStreak,
  canStudentToggleTodoAiCheck,
  getDateKey,
  getStudentHomeVariant,
  shouldShowPeerRanking,
  shouldShowTeacherHomework,
  sumStudySecondsForDate
} from "@ssamplanner/shared";
import type { Database, SubjectCode } from "@ssamplanner/shared";

type ConnectionRow = Database["public"]["Tables"]["connections"]["Row"];
type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
type StudySessionRow = Database["public"]["Tables"]["study_sessions"]["Row"];
type TimetableBlockRow = Database["public"]["Tables"]["timetable_blocks"]["Row"];
type TodoRow = Database["public"]["Tables"]["todos"]["Row"];
type ActivityType = Database["public"]["Enums"]["activity_type"];
type PlannerView = "todos" | "timetable" | "calendar";

type PeerRanking = {
  peer_count: number;
  current_user_minutes: number;
  peer_average_minutes: number;
  rank_percentile: number;
};

const supabase = createClient<Database>(
  process.env.EXPO_PUBLIC_SUPABASE_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    "",
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    ""
);

const subjectOptions = Object.keys(SUBJECT_LABELS) as SubjectCode[];
const dayLabels = ["일", "월", "화", "수", "목", "금", "토"] as const;
const activityLabels: Record<ActivityType, string> = {
  school: "학교",
  academy: "학원",
  self: "자습",
  class: "수업"
};

function useStudentM2Data() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [connections, setConnections] = useState<ConnectionRow[]>([]);
  const [todos, setTodos] = useState<TodoRow[]>([]);
  const [timetableBlocks, setTimetableBlocks] = useState<TimetableBlockRow[]>([]);
  const [studySessions, setStudySessions] = useState<StudySessionRow[]>([]);
  const [peerRanking, setPeerRanking] = useState<PeerRanking | null>(null);
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
        supabase.rpc("get_peer_study_ranking", { p_days: 7 })
      ]);

    setProfile(profileResult.data);
    setConnections(connectionsResult.data ?? []);
    setTodos(todosResult.data ?? []);
    setTimetableBlocks(timetableResult.data ?? []);
    setStudySessions(sessionsResult.data ?? []);
    setPeerRanking((peerResult.data?.[0] as PeerRanking | undefined) ?? null);

    const firstError =
      profileResult.error ??
      connectionsResult.error ??
      todosResult.error ??
      timetableResult.error ??
      sessionsResult.error ??
      peerResult.error;
    setMessage(firstError?.message ?? "Supabase와 동기화됐어요.");
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

  async function toggleStudySession(focusMode: boolean) {
    if (!data.session) {
      data.setMessage("로그인 후 공부를 시작할 수 있어요.");
      return;
    }

    if (activeSession) {
      const now = new Date();
      const started = new Date(activeSession.started_at);
      const duration_sec = Math.max(activeSession.duration_sec, Math.floor((now.getTime() - started.getTime()) / 1000));
      const { error } = await supabase
        .from("study_sessions")
        .update({ ended_at: now.toISOString(), duration_sec })
        .eq("id", activeSession.id);
      data.setMessage(error ? error.message : "공부 시간을 저장했어요.");
      await data.refresh();
      return;
    }

    const { error } = await supabase.from("study_sessions").insert({
      student_id: data.session.user.id,
      started_at: new Date().toISOString(),
      duration_sec: 0,
      focus_mode: focusMode,
      subject: "etc"
    });
    data.setMessage(error ? error.message : focusMode ? "집중 모드를 시작했어요." : "공부를 시작했어요.");
    await data.refresh();
  }

  async function toggleTodoStatus(todo: TodoRow) {
    const nextStatus = todo.status === "done" ? "todo" : "done";
    const { error } = await supabase.from("todos").update({ status: nextStatus }).eq("id", todo.id);
    data.setMessage(error ? error.message : nextStatus === "done" ? "완료로 저장했어요." : "다시 할 일로 돌렸어요.");
    await data.refresh();
  }

  if (!data.session) {
    return <AuthGate message={data.message} />;
  }

  return (
    <AppShell
      activeTab="today"
      loading={data.loading}
      message={data.message}
      subtitle={variant === "tutored" ? "과외쌤과 연결됨" : variant === "self_study" ? "혼자쓰기 모드" : "첫 공부를 기다리는 중"}
      title={variant === "self_study" ? "혼자쓰기 학생" : "오늘"}
    >
      <HeroCard
        activeSession={activeSession}
        goalSeconds={todayGoalSeconds}
        onFocus={() => void toggleStudySession(true)}
        onStart={() => void toggleStudySession(false)}
        streakMessage={streak.message}
        streakCount={streak.count}
        studySeconds={todayStudySeconds}
        variant={variant}
      />

      {variant === "zero" ? (
        <ZeroHomeState />
      ) : (
        <>
          <TodoPanel
            emptyText="오늘 직접 만든 할 일이 아직 없어요."
            onToggleStatus={toggleTodoStatus}
            title="오늘 할 일"
            todos={ownTodos}
          />

          {shouldShowTeacherHomework(variant) ? (
            <TodoPanel
              emptyText="오늘 마감인 선생님 숙제는 없어요."
              onToggleStatus={toggleTodoStatus}
              title="선생님 숙제"
              todos={teacherTodos}
            />
          ) : null}

          {shouldShowPeerRanking(variant) ? (
            <PeerRankingCard ranking={data.peerRanking} />
          ) : null}

          {variant === "tutored" ? (
            <ClassCard activeConnections={activeConnections.length} doneCount={doneCount} totalCount={todaysTodos.length} />
          ) : null}
        </>
      )}
    </AppShell>
  );
}

export function StudentPlannerM2Screen({
  initialView,
  initialTodoId
}: {
  initialView?: PlannerView;
  initialTodoId?: string;
} = {}) {
  const params = useLocalSearchParams<{ view?: string }>();
  const data = useStudentM2Data();
  const [view, setView] = useState<PlannerView>(initialView ?? parsePlannerView(params.view));
  const activeConnections = data.connections.filter((connection) => connection.status === "active");
  const variant = getStudentHomeVariant({
    activeConnectionCount: activeConnections.length,
    todoCount: data.todos.length,
    timetableBlockCount: data.timetableBlocks.length,
    studySessionCount: data.studySessions.length
  });

  useEffect(() => {
    setView(initialView ?? parsePlannerView(params.view));
  }, [initialView, params.view]);

  if (!data.session) {
    return <AuthGate message={data.message} />;
  }

  return (
    <AppShell
      activeTab="planner"
      loading={data.loading}
      message={data.message}
      subtitle={variant === "tutored" ? "선생님 숙제와 개인 계획을 함께 정리" : "개인 계획 중심"}
      title="플래너"
    >
      {variant === "zero" ? <PlannerZeroState /> : null}

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
        <TodosPlanner data={data} initialTodoId={initialTodoId} />
      ) : null}
      {view === "timetable" ? <TimetablePlanner data={data} /> : null}
      {view === "calendar" ? <CalendarPlanner data={data} /> : null}
    </AppShell>
  );
}

function TodosPlanner({
  data,
  initialTodoId
}: {
  data: ReturnType<typeof useStudentM2Data>;
  initialTodoId?: string;
}) {
  const [editingId, setEditingId] = useState<string | null>(initialTodoId ?? null);
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState<SubjectCode>("math");
  const [dueDate, setDueDate] = useState(getDateKey(new Date()));
  const [aiCheckEnabled, setAiCheckEnabled] = useState(false);
  const editingTodo = data.todos.find((todo) => todo.id === editingId);

  useEffect(() => {
    if (!editingTodo) return;
    setTitle(editingTodo.title);
    setSubject(editingTodo.subject ?? "etc");
    setDueDate(editingTodo.due_date ?? getDateKey(new Date()));
    setAiCheckEnabled(editingTodo.ai_check_enabled);
  }, [editingTodo]);

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
      setEditingId(null);
      setTitle("");
      setAiCheckEnabled(false);
    }
    await data.refresh();
  }

  async function toggleTodoStatus(todo: TodoRow) {
    const nextStatus = todo.status === "done" ? "todo" : "done";
    const { error } = await supabase.from("todos").update({ status: nextStatus }).eq("id", todo.id);
    data.setMessage(error ? error.message : nextStatus === "done" ? "완료 처리했어요." : "다시 할 일로 돌렸어요.");
    await data.refresh();
  }

  async function toggleAiCheck(todo: TodoRow, enabled: boolean) {
    if (!canStudentToggleTodoAiCheck(todo)) {
      data.setMessage("선생님 숙제의 AI 검사 여부는 선생님이 정한 값으로 잠겨 있어요.");
      return;
    }

    const { error } = await supabase.from("todos").update({ ai_check_enabled: enabled }).eq("id", todo.id);
    data.setMessage(error ? error.message : enabled ? "AI 검사를 켰어요." : "AI 검사를 껐어요.");
    await data.refresh();
  }

  async function deleteTodo(todo: TodoRow) {
    if (todo.source === "teacher") {
      data.setMessage("선생님 숙제는 삭제할 수 없어요.");
      return;
    }

    const { error } = await supabase.from("todos").delete().eq("id", todo.id);
    data.setMessage(error ? error.message : "할 일을 삭제했어요.");
    await data.refresh();
  }

  return (
    <>
      <Section title={editingTodo ? "할 일 수정" : "첫 할 일 추가"} badge={editingTodo ? "수정 중" : "개인"}>
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
          onValueChange={setAiCheckEnabled}
          disabled={Boolean(editingTodo && !canStudentToggleTodoAiCheck(editingTodo))}
        />
        <View style={styles.inlineActions}>
          <ActionButton label={editingTodo ? "수정 저장" : "할 일 추가"} onPress={() => void saveTodo()} tone="brand" />
          {editingTodo ? (
            <ActionButton
              label="새로 작성"
              onPress={() => {
                setEditingId(null);
                setTitle("");
                setAiCheckEnabled(false);
              }}
              tone="neutral"
            />
          ) : null}
        </View>
      </Section>

      <Section title="할 일 목록" badge={`${data.todos.filter((todo) => todo.status === "todo").length}개 남음`}>
        {data.todos.length ? (
          data.todos.map((todo) => (
            <TodoItem
              key={todo.id}
              todo={todo}
              onDelete={deleteTodo}
              onEdit={(selected) => setEditingId(selected.id)}
              onToggleAi={toggleAiCheck}
              onToggleStatus={toggleTodoStatus}
            />
          ))
        ) : (
          <EmptyText>아직 할 일이 없어요. 위에서 첫 할 일을 추가해 보세요.</EmptyText>
        )}
      </Section>
    </>
  );
}

function TimetablePlanner({ data }: { data: ReturnType<typeof useStudentM2Data> }) {
  const [mode, setMode] = useState<"day" | "week">("day");
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
      setEditingId(null);
      setLabel("");
    }
    await data.refresh();
  }

  async function deleteBlock(block: TimetableBlockRow) {
    const { error } = await supabase.from("timetable_blocks").delete().eq("id", block.id);
    data.setMessage(error ? error.message : "시간표를 삭제했어요.");
    await data.refresh();
  }

  const visibleBlocks =
    mode === "day"
      ? data.timetableBlocks.filter((block) => block.day_of_week === dayOfWeek)
      : data.timetableBlocks;

  return (
    <>
      <Section title={editingBlock ? "시간표 수정" : "시간표 블록 추가"} badge={mode === "day" ? dayLabels[dayOfWeek] : "주간"}>
        <SegmentedControl
          options={[
            ["day", "일"],
            ["week", "주"]
          ]}
          value={mode}
          onChange={setMode}
        />
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
          <ActionButton label={editingBlock ? "수정 저장" : "블록 추가"} onPress={() => void saveBlock()} tone="brand" />
          {editingBlock ? <ActionButton label="새로 작성" onPress={() => setEditingId(null)} tone="neutral" /> : null}
        </View>
      </Section>

      <Section title={mode === "day" ? `${dayLabels[dayOfWeek]}요일 시간표` : "주간 시간표"} badge={`${visibleBlocks.length}개`}>
        {visibleBlocks.length ? (
          visibleBlocks.map((block) => (
            <TimetableItem
              block={block}
              key={block.id}
              onDelete={deleteBlock}
              onEdit={(selected) => setEditingId(selected.id)}
            />
          ))
        ) : (
          <EmptyText>아직 시간표 블록이 없어요.</EmptyText>
        )}
      </Section>
    </>
  );
}

function CalendarPlanner({ data }: { data: ReturnType<typeof useStudentM2Data> }) {
  const days = useMemo(() => {
    const today = getDateKey(new Date());
    return Array.from({ length: 7 }, (_value, index) => shiftDate(today, index));
  }, []);

  return (
    <Section title="7일 캘린더" badge={`${data.todos.length}개 할 일`}>
      {days.map((day) => {
        const todos = data.todos.filter((todo) => todo.due_date === day);
        const sessions = data.studySessions.filter((session) => getDateKey(session.started_at) === day);
        const blocks = data.timetableBlocks.filter((block) => block.day_of_week === new Date(`${day}T00:00:00.000Z`).getUTCDay());
        const studySeconds = sessions.reduce((total, session) => total + Math.max(0, session.duration_sec), 0);

        return (
          <View key={day} style={styles.calendarDay}>
            <View style={styles.calendarDate}>
              <Text style={styles.calendarDayText}>{day.slice(5)}</Text>
              <Text style={styles.metaText}>{formatDuration(studySeconds)} 기록</Text>
            </View>
            <View style={styles.calendarItems}>
              {todos.slice(0, 3).map((todo) => (
                <Text key={todo.id} style={styles.calendarItemText}>
                  {todo.status === "done" ? "완료" : "예정"} · {todo.title}
                </Text>
              ))}
              {blocks.slice(0, 2).map((block) => (
                <Text key={block.id} style={styles.calendarItemText}>
                  {formatMinutes(block.start_min)} · {block.label ?? activityLabels[block.type]}
                </Text>
              ))}
              {!todos.length && !blocks.length ? <Text style={styles.metaText}>계획 없음</Text> : null}
            </View>
          </View>
        );
      })}
    </Section>
  );
}

function HeroCard({
  activeSession,
  goalSeconds,
  onFocus,
  onStart,
  streakCount,
  streakMessage,
  studySeconds,
  variant
}: {
  activeSession?: StudySessionRow;
  goalSeconds: number;
  onFocus: () => void;
  onStart: () => void;
  streakCount: number;
  streakMessage: string;
  studySeconds: number;
  variant: "tutored" | "self_study" | "zero";
}) {
  const progress = goalSeconds > 0 ? Math.min(100, Math.round((studySeconds / goalSeconds) * 100)) : 0;

  return (
    <View style={styles.hero}>
      <View style={styles.heroTop}>
        <Chip tone="flame">연속 {streakCount}일</Chip>
        <Chip tone={variant === "tutored" ? "success" : "brand"}>
          {variant === "tutored" ? "연결형" : variant === "self_study" ? "개인형" : "첫 시작"}
        </Chip>
      </View>
      <Text style={styles.heroTitle}>
        {activeSession ? "지금 공부 중이에요" : variant === "zero" ? "첫 공부를 가볍게 시작해요" : "오늘도 한 번만 시작해요"}
      </Text>
      <Text style={styles.heroBody}>{streakMessage}</Text>
      <View style={styles.metricRow}>
        <Metric label="오늘 공부" value={formatDuration(studySeconds)} />
        <Metric label="목표" value={goalSeconds > 0 ? formatDuration(goalSeconds) : "미설정"} />
        <Metric label="달성" value={goalSeconds > 0 ? `${progress}%` : "-"} />
      </View>
      <View style={styles.inlineActions}>
        <ActionButton label={activeSession ? "공부 끝내기" : "공부 시작"} onPress={onStart} tone="flame" />
        <ActionButton label={activeSession?.focus_mode ? "집중 끝내기" : "집중 모드"} onPress={onFocus} tone="neutral" />
      </View>
    </View>
  );
}

function TodoPanel({
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
  return (
    <Section title={title} badge={`${todos.filter((todo) => todo.status === "done").length}/${todos.length}`}>
      {todos.length ? (
        todos.slice(0, 4).map((todo) => (
          <View key={todo.id} style={styles.simpleTodoRow}>
            <Pressable onPress={() => void onToggleStatus(todo)} style={styles.checkButton}>
              <Text style={styles.checkText}>{todo.status === "done" ? "완" : "□"}</Text>
            </Pressable>
            <View style={styles.flex}>
              <Text style={styles.itemTitle}>{todo.title}</Text>
              <Text style={styles.metaText}>
                {todo.due_date ?? "마감 없음"} · {todo.ai_check_enabled ? "AI 검사" : "기본 완료"}
              </Text>
            </View>
            <Chip tone={todo.source === "teacher" ? "success" : "brand"}>
              {todo.subject ? SUBJECT_LABELS[todo.subject] : "기타"}
            </Chip>
          </View>
        ))
      ) : (
        <EmptyText>{emptyText}</EmptyText>
      )}
      <Link href={"/planner" as Href} asChild>
        <Pressable style={styles.textLink}>
          <Text style={styles.textLinkLabel}>플래너에서 관리</Text>
        </Pressable>
      </Link>
    </Section>
  );
}

function TodoItem({
  todo,
  onDelete,
  onEdit,
  onToggleAi,
  onToggleStatus
}: {
  todo: TodoRow;
  onDelete: (todo: TodoRow) => Promise<void>;
  onEdit: (todo: TodoRow) => void;
  onToggleAi: (todo: TodoRow, enabled: boolean) => Promise<void>;
  onToggleStatus: (todo: TodoRow) => Promise<void>;
}) {
  const aiToggleAllowed = canStudentToggleTodoAiCheck(todo);

  return (
    <View style={styles.todoItem}>
      <View style={styles.todoMain}>
        <Pressable onPress={() => void onToggleStatus(todo)} style={styles.checkButton}>
          <Text style={styles.checkText}>{todo.status === "done" ? "완" : "□"}</Text>
        </Pressable>
        <View style={styles.flex}>
          <View style={styles.itemTitleRow}>
            <Text style={styles.itemTitle}>{todo.title}</Text>
            {todo.locked ? <Chip tone="warning">잠금</Chip> : null}
          </View>
          <Text style={styles.metaText}>
            {todo.due_date ?? "마감 없음"} · {todo.source === "teacher" ? "선생님 숙제" : "개인 할 일"}
          </Text>
        </View>
        <Chip tone={todo.source === "teacher" ? "success" : "brand"}>
          {todo.subject ? SUBJECT_LABELS[todo.subject] : "기타"}
        </Chip>
      </View>
      <View style={styles.todoActions}>
        <View style={styles.switchRow}>
          <Text style={[styles.metaText, !aiToggleAllowed ? styles.mutedText : null]}>
            {aiToggleAllowed ? "AI 검사" : "AI 검사 잠금"}
          </Text>
          <Switch
            disabled={!aiToggleAllowed}
            onValueChange={(enabled) => void onToggleAi(todo, enabled)}
            thumbColor={colors.surface}
            trackColor={{ false: colors.line, true: colors.brand }}
            value={todo.ai_check_enabled}
          />
        </View>
        <View style={styles.inlineActionsCompact}>
          {todo.source === "self" ? <ActionButton label="수정" onPress={() => onEdit(todo)} tone="neutral" /> : null}
          {todo.source === "self" ? <ActionButton label="삭제" onPress={() => void onDelete(todo)} tone="danger" /> : null}
        </View>
      </View>
    </View>
  );
}

function TimetableItem({
  block,
  onDelete,
  onEdit
}: {
  block: TimetableBlockRow;
  onDelete: (block: TimetableBlockRow) => Promise<void>;
  onEdit: (block: TimetableBlockRow) => void;
}) {
  return (
    <View style={styles.simpleTodoRow}>
      <View style={styles.timeBadge}>
        <Text style={styles.timeBadgeText}>{dayLabels[block.day_of_week]}</Text>
      </View>
      <View style={styles.flex}>
        <Text style={styles.itemTitle}>{block.label ?? activityLabels[block.type]}</Text>
        <Text style={styles.metaText}>
          {formatMinutes(block.start_min)}-{formatMinutes(block.end_min)} · {activityLabels[block.type]}
        </Text>
      </View>
      <View style={styles.inlineActionsCompact}>
        <ActionButton label="수정" onPress={() => onEdit(block)} tone="neutral" />
        <ActionButton label="삭제" onPress={() => void onDelete(block)} tone="danger" />
      </View>
    </View>
  );
}

function PeerRankingCard({ ranking }: { ranking: PeerRanking | null }) {
  return (
    <Section title="또래 랭킹" badge="익명 집계">
      {ranking ? (
        <View style={styles.metricRow}>
          <Metric label="내 7일 공부" value={`${ranking.current_user_minutes}분`} />
          <Metric label="또래 평균" value={`${ranking.peer_average_minutes}분`} />
          <Metric label="상위" value={`${ranking.rank_percentile}%`} />
        </View>
      ) : (
        <EmptyText>같은 학년 집계를 만들 데이터가 아직 없어요.</EmptyText>
      )}
      <Text style={styles.metaText}>개별 친구 이름 없이 같은 학년의 공부 시간 집계만 보여줘요.</Text>
    </Section>
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
  return (
    <Section title={`우리 반 ${activeConnections}명 공부 중`} badge={totalCount ? `${doneCount}/${totalCount}` : "대기"}>
      <Text style={styles.bodyText}>선생님과 연결된 상태예요. 선생님 숙제와 개인 공부를 같은 플래너에서 관리합니다.</Text>
    </Section>
  );
}

function ZeroHomeState() {
  return (
    <Section title="아직 오늘 계획이 없어요" badge="제로">
      <Text style={styles.bodyText}>대단한 계획보다 첫 한 줄이 더 좋아요. 10분짜리 할 일 하나만 만들어도 오늘 화면이 살아납니다.</Text>
      <Link href={"/planner" as Href} asChild>
        <Pressable style={[styles.actionButton, styles.brandButton]}>
          <Text style={styles.actionButtonPrimaryText}>첫 할 일 추가</Text>
        </Pressable>
      </Link>
    </Section>
  );
}

function PlannerZeroState() {
  return (
    <View style={styles.zeroBand}>
      <Text style={styles.zeroTitle}>첫 플래너를 만드는 중</Text>
      <Text style={styles.bodyText}>할 일 하나나 시간표 블록 하나를 저장하면 홈이 혼공 상태로 바뀝니다.</Text>
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
        <View style={styles.inlineActions}>
          <Link href={"/signup" as Href} asChild>
            <Pressable style={[styles.actionButton, styles.brandButton]}>
              <Text style={styles.actionButtonPrimaryText}>가입·로그인</Text>
            </Pressable>
          </Link>
          <Link href={"/forgot" as Href} asChild>
            <Pressable style={[styles.actionButton, styles.neutralButton]}>
              <Text style={styles.actionButtonText}>비밀번호 찾기</Text>
            </Pressable>
          </Link>
        </View>
      </View>
    </ScrollView>
  );
}

function AppShell({
  activeTab,
  children,
  loading,
  message,
  subtitle,
  title
}: {
  activeTab: "today" | "planner";
  children: ReactNode;
  loading: boolean;
  message: string;
  subtitle: string;
  title: string;
}) {
  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.pageHeader}>
          <View>
            <Text style={styles.kicker}>쌤플래너</Text>
            <Text style={styles.pageTitle}>{title}</Text>
            <Text style={styles.pageSubtitle}>{subtitle}</Text>
          </View>
          {loading ? <ActivityIndicator color={colors.brand} /> : <Chip tone="success">live</Chip>}
        </View>
        <View style={styles.notice}>
          <Text style={styles.noticeText}>{message}</Text>
        </View>
        {children}
      </ScrollView>
      <BottomNav active={activeTab} />
    </View>
  );
}

function BottomNav({ active }: { active: "today" | "planner" }) {
  return (
    <View style={styles.bottomNav}>
      <NavLink active={active === "today"} href="/today" label="오늘" />
      <NavLink active={active === "planner"} href="/planner" label="플래너" />
      <NavLink active={false} href="/onboarding/connect/status" label="연결" />
    </View>
  );
}

function NavLink({ active, href, label }: { active: boolean; href: string; label: string }) {
  return (
    <Link href={href as Href} asChild>
      <Pressable style={[styles.navItem, active ? styles.navItemActive : null]}>
        <Text style={[styles.navText, active ? styles.navTextActive : null]}>{label}</Text>
      </Pressable>
    </Link>
  );
}

function Section({ badge, children, title }: { badge?: string; children: ReactNode; title: string }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {badge ? <Chip tone="brand">{badge}</Chip> : null}
      </View>
      <View style={styles.sectionBody}>{children}</View>
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

function Chip({ children, tone }: { children: ReactNode; tone: "brand" | "success" | "warning" | "flame" }) {
  const style =
    tone === "success"
      ? styles.chipSuccess
      : tone === "warning"
        ? styles.chipWarning
        : tone === "flame"
          ? styles.chipFlame
          : styles.chipBrand;
  const textStyle = tone === "flame" ? styles.chipFlameText : styles.chipText;

  return (
    <View style={[styles.chip, style]}>
      <Text style={textStyle}>{children}</Text>
    </View>
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
    gap: spacing.sm,
    padding: spacing.xs,
    borderRadius: radii.button,
    backgroundColor: colors.surface
  },
  segmentButton: {
    flex: 1,
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.control
  },
  segmentButtonActive: {
    backgroundColor: colors.brand
  },
  segmentText: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: "900"
  },
  segmentTextActive: {
    color: colors.surface
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
