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

// ── todos.scope_text ─────────────────────────────────────────────────────────
// AI 숙제검사가 제출 사진과 대조할 "수행 범위 원문". title(목록에 보이는 할 일 이름)과
// 역할이 다르다. 예) '쎈 112~118p, 115p 제외'. 일반 메모로 쓰지 않는다.
//
// DB(todos_scope_text_len 제약 + 정규화 트리거)가 최종 방어선이고, 아래 함수들은 같은 규칙을
// 앱에서 미리 적용해 사용자에게 안내를 보여주기 위한 것이다. 규칙이 갈라지면 앱이 통과시킨
// 값을 DB 가 거부해 날 오류가 그대로 노출되므로, 두 규칙은 같아야 한다.

/** 공백을 제외한 글자 수 기준 상한. DB 제약과 같은 값이어야 한다. */
export const TODO_SCOPE_TEXT_MAX_LENGTH = 500;

// Postgres 의 \s([[:space:]])와 맞추기 위해 ASCII 공백만 제거한다.
// JS 의 \s 는 유니코드 공백(U+00A0 NBSP, U+3000 등)까지 포함해 DB 보다 더 많이 지운다 → 앱이
// 더 짧게 세어 "통과"시킨 값을 DB 가 거부하게 된다. 더 적게 지워서 앱이 먼저 거부하는 편이 안전하다.
const ASCII_WHITESPACE = /[ \t\n\v\f\r]/g;

/** 빈 문자열·공백뿐인 입력은 NULL 로 저장한다 — DB 트리거와 같은 규칙. */
export function normalizeTodoScopeText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** 공백을 제외한 글자 수 — 사용자에게 남은 글자수를 보여줄 때도 쓴다. */
export function countTodoScopeTextLength(value: string): number {
  return value.replace(ASCII_WHITESPACE, "").length;
}

export type TodoScopeTextError = "scope_text_too_long" | "scope_text_required";

/** 두 앱이 같은 문구를 쓰도록 shared 에 둔다(SUBJECT_LABELS 등과 같은 방식). */
export const TODO_SCOPE_TEXT_ERROR_MESSAGES: Record<TodoScopeTextError, string> = {
  scope_text_required: "AI 완료검사를 켜면 검사 범위를 입력해야 해요.",
  scope_text_too_long: `검사 범위는 공백을 빼고 ${TODO_SCOPE_TEXT_MAX_LENGTH}자까지 쓸 수 있어요.`
};

export function validateTodoScopeText(value: string | null | undefined): TodoScopeTextError | undefined {
  const normalized = normalizeTodoScopeText(value);
  if (normalized && countTodoScopeTextLength(normalized) > TODO_SCOPE_TEXT_MAX_LENGTH) {
    return "scope_text_too_long";
  }
  return undefined;
}

// AI 완료검사를 켜면 범위가 필수다 — 범위가 없으면 AI 가 "무엇과" 대조할지 알 수 없고,
// 사진만 보고 판정하게 되어 검사가 사실상 무의미해진다. 끄면 선택 입력이다.
//
// ※ DB 제약(ai_check_enabled=true → scope_text not null)은 아직 걸지 않았다. 기존 행 중
//    AI 검사가 켜져 있는데 범위가 빈 것이 있을 수 있어, UI 전환이 끝난 뒤 별도로 넣는다.
export function isTodoScopeTextRequired(input: { aiCheckEnabled: boolean }): boolean {
  return input.aiCheckEnabled;
}

/** 저장 직전 검증 — 필수 여부까지 함께 본다. 두 앱이 같은 규칙을 쓰게 하려고 shared 에 둔다. */
export function validateTodoScopeTextForSave(
  value: string | null | undefined,
  input: { aiCheckEnabled: boolean }
): TodoScopeTextError | undefined {
  const normalized = normalizeTodoScopeText(value);
  if (!normalized) return isTodoScopeTextRequired(input) ? "scope_text_required" : undefined;
  return validateTodoScopeText(normalized);
}

/**
 * 화면에 보여줄 "검사 범위" — scope_text 우선, 없으면 title 로 되돌아간다.
 *
 * scope_text 도입(20260806010000) 전에 만들어진 할 일은 범위를 title 에 적어 뒀다. 그 마이그레이션은
 * `ai_check_enabled = true` 인 행만 title 을 복사했으므로, **AI 검사가 꺼진 옛 행은 아직 scope_text 가
 * 비어 있다.** 그런 행에서 빈칸을 보여주면 "범위가 사라졌다"로 보이므로 title 로 대체한다.
 */
export function getTodoScopeTextForDisplay(todo: { scope_text?: string | null; title: string }): string {
  return normalizeTodoScopeText(todo.scope_text) ?? todo.title;
}

// 범위의 '의미'는 교사 숙제와 개인 할 일에서 동일하고, 수정 권한만 다르다.
// teacher 숙제의 범위는 출제자(교사)의 것이므로 학생이 바꿀 수 없다 — 바꿀 수 있으면
// 학생이 검사 기준을 자기에게 유리하게 좁힐 수 있다. DB 허용 목록도 같은 규칙이다.
export function canStudentEditTodoScopeText(todo: { source: "self" | "teacher" }): boolean {
  return todo.source === "self";
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
