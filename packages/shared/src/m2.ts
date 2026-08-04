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

export const PEER_RANKING_MIN_COHORT = 5;

export type PeerRankingSnapshot = {
  peer_count: number;
  min_cohort: number;
  can_show_peer_ranking: boolean;
  current_user_minutes: number;
  peer_average_minutes: number | null;
  rank_percentile: number | null;
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

// 연결 입구(connect nudge)는 오직 "연결 상태"로만 결정한다 — 공부 데이터 유무와 무관.
// 연결 안 된 학생(active 연결 0)은 제로/혼공 어느 상태든 항상 노출, 과외생은 숨김.
export function shouldShowConnectNudge(activeConnectionCount: number): boolean {
  return activeConnectionCount === 0;
}

export function canStudentToggleTodoAiCheck(todo: TodoLockState): boolean {
  return todo.source === "self" && !todo.locked;
}

export type StudentTodoRowAction = "open_homework" | "toggle_only";

// 할일 행 탭 정책(카탈로그 C2 홈·C5 플래너):
// 선생님 숙제는 체크박스(완료 토글) 밖 영역이 숙제 상세(/homework/[id]) 진입이다.
// 카탈로그가 모든 선생님 숙제 행에 제출 어포던스를 두므로 AI 검사 여부와 무관하게 열린다.
// 내(self) 할 일은 제출 개념이 없어 토글/편집만 한다 — 혼공(AI 단독) 검사 진입은 별도 과제.
export function getStudentTodoRowAction(todo: { source: "self" | "teacher" }): StudentTodoRowAction {
  return todo.source === "teacher" ? "open_homework" : "toggle_only";
}

export function canShowPeerRanking(
  ranking: PeerRankingSnapshot | null
): ranking is PeerRankingSnapshot & {
  can_show_peer_ranking: true;
  peer_average_minutes: number;
  rank_percentile: number;
} {
  return Boolean(
    ranking?.can_show_peer_ranking &&
      ranking.peer_count + 1 >= ranking.min_cohort &&
      ranking.peer_average_minutes !== null &&
      ranking.rank_percentile !== null
  );
}

export function getDateKey(value: string | Date): string {
  // TODO(M8): switch streak/day bucketing to Asia/Seoul midnight before launch.
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
