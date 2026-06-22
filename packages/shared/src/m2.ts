export type StudentHomeVariant = "tutored" | "self_study" | "zero";

export type HomeVariantInput = {
  activeConnectionCount: number;
  todoCount: number;
  timetableBlockCount: number;
  studySessionCount: number;
};

export type TodoLockState = {
  source: "self" | "teacher";
  locked: boolean;
};

export type StudySessionLike = {
  started_at: string;
  duration_sec: number;
};

export type StudyStreak = {
  count: number;
  studiedToday: boolean;
  missedToday: boolean;
  anchorDate: string | null;
  message: string;
};

export function getStudentHomeVariant(input: HomeVariantInput): StudentHomeVariant {
  if (input.activeConnectionCount > 0) return "tutored";

  const hasAnyStudentData =
    input.todoCount + input.timetableBlockCount + input.studySessionCount > 0;

  return hasAnyStudentData ? "self_study" : "zero";
}

export function shouldShowTeacherHomework(variant: StudentHomeVariant): boolean {
  return variant === "tutored";
}

export function shouldShowPeerRanking(variant: StudentHomeVariant): boolean {
  return variant === "self_study";
}

export function canStudentToggleTodoAiCheck(todo: TodoLockState): boolean {
  return todo.source === "self" && !todo.locked;
}

export function getDateKey(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toISOString().slice(0, 10);
}

export function sumStudySecondsForDate(
  sessions: StudySessionLike[],
  date: string | Date
): number {
  const dateKey = getDateKey(date);

  return sessions
    .filter((session) => getDateKey(session.started_at) === dateKey)
    .reduce((total, session) => total + Math.max(0, session.duration_sec), 0);
}

export function calculateStudyStreak(
  sessions: StudySessionLike[],
  asOf: string | Date = new Date()
): StudyStreak {
  const studiedDates = new Set(
    sessions
      .filter((session) => session.duration_sec > 0)
      .map((session) => getDateKey(session.started_at))
  );
  const today = getDateKey(asOf);
  const yesterday = shiftDateKey(today, -1);
  const studiedToday = studiedDates.has(today);
  const anchorDate = studiedToday ? today : studiedDates.has(yesterday) ? yesterday : null;

  if (!anchorDate) {
    return {
      count: 0,
      studiedToday: false,
      missedToday: !studiedToday,
      anchorDate: null,
      message: "괜찮아요. 오늘 한 번만 시작해도 다시 이어갈 수 있어요."
    };
  }

  let cursor = anchorDate;
  let count = 0;
  while (studiedDates.has(cursor)) {
    count += 1;
    cursor = shiftDateKey(cursor, -1);
  }

  return {
    count,
    studiedToday,
    missedToday: !studiedToday,
    anchorDate,
    message: studiedToday
      ? `${count}일째 이어가는 중이에요. 오늘 흐름이 좋아요.`
      : `${count}일 흐름이 남아 있어요. 오늘은 가볍게 다시 붙이면 충분해요.`
  };
}

export function shiftDateKey(dateKey: string, amount: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + amount)).toISOString().slice(0, 10);
}
