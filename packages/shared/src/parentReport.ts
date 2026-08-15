// 학부모 주간 리포트 (B7) — 데이터 조립 규칙.
//
// [이 파일이 지키는 두 가지 원칙]
//
// 1. **"기록 없음"과 "0"은 다르다.** 학생이 앱을 안 쓴 것과 공부를 안 한 것은 다른 사실이고,
//    학부모에게 0으로 보여주면 거짓말이 된다. 게다가 세 번째 상태가 하나 더 있다 —
//    **학생이 공개하지 않은 항목**. 그래서 모든 자동 수집 항목은 3상태다:
//      · hidden    — 학생이 공개범위를 껐다 (리포트에 항목 자체를 넣지 않는다)
//      · no_data   — 공개했지만 기록이 없다 ("아직 기록이 없어요")
//      · value     — 실제 값 (0 도 값이다)
//
//    ⚠️ 이 구분을 안 하면 `share_study_time=false` 인 학생의 리포트가
//    "이번 주 0시간 공부"로 나간다. 공개를 끈 것뿐인데 학부모는 아이가 안 했다고 읽는다.
//
// 2. **공개범위는 서버가 강제한다.** v_teacher_study_sessions / v_teacher_focus_checks 뷰가
//    이미 disclosure_settings 를 걸고 있어 끈 항목은 행 자체가 안 온다.
//    여기서는 그 "행이 없음"을 hidden 인지 no_data 인지 **구분하기 위해** 공개 설정을 함께 받는다.
//    (뷰만 믿으면 둘을 구분할 수 없다.)
import { SUBJECT_LABELS, type SubjectCode } from "./subjects";

// ── 3상태 값 ─────────────────────────────────────────────────────────────────
export type ReportMetric<T> =
  | { state: "hidden" }
  | { state: "no_data" }
  | { state: "value"; value: T };

export const HIDDEN: ReportMetric<never> = { state: "hidden" };
export const NO_DATA: ReportMetric<never> = { state: "no_data" };
export function metricValue<T>(value: T): ReportMetric<T> {
  return { state: "value", value };
}

/** 화면·미리보기 공통 문구. 상태를 색이나 숫자만으로 전하지 않기 위한 단일 출처. */
export function describeMetricState(state: ReportMetric<unknown>["state"]): string {
  if (state === "hidden") return "학생이 공개하지 않은 항목이에요";
  if (state === "no_data") return "아직 기록이 없어요";
  return "";
}

// ── 공개 설정 ────────────────────────────────────────────────────────────────
export type DisclosureLike = {
  share_study_time: boolean;
  share_homework_photos: boolean;
  share_focus_data: boolean;
};

/** 연결은 있는데 disclosure 행이 없을 수 있다 → 그때는 "가장 보수적으로" 전부 비공개로 본다. */
export function normalizeDisclosure(row: Partial<DisclosureLike> | null | undefined): DisclosureLike {
  return {
    share_study_time: row?.share_study_time === true,
    share_homework_photos: row?.share_homework_photos === true,
    share_focus_data: row?.share_focus_data === true
  };
}

// ── 입력 ─────────────────────────────────────────────────────────────────────
export type ReportStudySessionLike = { subject: SubjectCode | null; duration_sec: number | null; started_at: string | null };
export type TodoLike = { id: string; subject: SubjectCode | null; status: string; due_date: string | null };
export type FocusCheckLike = { checked_at: string; drowsy: boolean };
export type ExamRecordLike = {
  id: string;
  subject: SubjectCode;
  exam_name: string;
  taken_on: string;
  grade: number | null;
  score: number | null;
  comment: string | null;
};

export type WeeklyTrendPoint = { weekStart: string; minutes: number };

export type ParentReportInput = {
  weekStart: string; // YYYY-MM-DD (일요일 기준, weekRange 와 같은 규칙)
  disclosure: DisclosureLike;
  /** 이번 주 세션. 공개가 꺼져 있으면 뷰가 빈 배열을 준다 — 그래서 disclosure 를 함께 본다. */
  sessions: ReportStudySessionLike[];
  /** 최근 N주 주간 합계(이번 주 포함, 오름차순). 추이 그래프용. */
  weeklyTrend: WeeklyTrendPoint[];
  /** 이번 주 마감인 선생님 숙제. */
  todos: TodoLike[];
  focusChecks: FocusCheckLike[];
  examRecords: ExamRecordLike[];
};

// ── 출력 ─────────────────────────────────────────────────────────────────────
export type StudyTimeBlock = {
  totalMinutes: number;
  perDayMinutes: number[];
  /** 지난주 대비 증감(분). 지난주 기록이 없으면 null — 0 으로 표시하면 "변화 없음"으로 읽힌다. */
  deltaMinutes: number | null;
  trend: WeeklyTrendPoint[];
};
export type HomeworkBlock = { done: number; total: number; rate: number };
export type SubjectRateRow = { subject: SubjectCode; label: string; done: number; total: number; rate: number };
export type FocusBlock = {
  averageScore: number | null;
  drowsyCount: number;
  perDayDrowsy: number[];
  peakHour: number | null;
};
export type ExamTrendPoint = { takenOn: string; grade: number | null; score: number | null; examName: string };
export type ExamBlock = { subject: SubjectCode; label: string; latest: ExamRecordLike; points: ExamTrendPoint[] };

export type ParentReportData = {
  studyTime: ReportMetric<StudyTimeBlock>;
  homework: ReportMetric<HomeworkBlock>;
  subjectRates: ReportMetric<SubjectRateRow[]>;
  focus: ReportMetric<FocusBlock>;
  /** 시험은 공개범위 대상이 아니다 — 과외쌤이 직접 적은 기록이다. 없으면 항목 자체를 숨긴다. */
  exams: ExamBlock[];
  /** 리포트에 담을 수 있는 과목(데이터가 실제로 있는 것만). */
  availableSubjects: SubjectCode[];
};

const MINUTE = 60;

function minutesOf(session: ReportStudySessionLike): number {
  return Math.max(0, Math.round((session.duration_sec ?? 0) / MINUTE));
}

/** 이번 주 공부 블록. 공개가 꺼졌으면 hidden, 켜졌는데 세션이 하나도 없으면 no_data. */
function buildStudyTime(input: ParentReportInput): ReportMetric<StudyTimeBlock> {
  if (!input.disclosure.share_study_time) return HIDDEN;
  if (input.sessions.length === 0 && input.weeklyTrend.every((p) => p.minutes === 0)) return NO_DATA;

  const start = new Date(`${input.weekStart}T00:00:00.000Z`).getTime();
  const perDay = [0, 0, 0, 0, 0, 0, 0];
  let total = 0;
  for (const session of input.sessions) {
    const minutes = minutesOf(session);
    if (minutes === 0 || !session.started_at) continue;
    const dayIndex = Math.floor((new Date(session.started_at).getTime() - start) / 86_400_000);
    if (dayIndex < 0 || dayIndex > 6) continue;
    perDay[dayIndex] += minutes;
    total += minutes;
  }

  // 지난주가 추이에 없으면 증감을 만들지 않는다. 0 으로 두면 "지난주와 같다"는 거짓이 된다.
  const trend = input.weeklyTrend;
  const previous = trend.length >= 2 ? trend[trend.length - 2] : null;
  return metricValue({
    totalMinutes: total,
    perDayMinutes: perDay,
    deltaMinutes: previous ? total - previous.minutes : null,
    trend
  });
}

/**
 * 숙제 이행률. 공개범위는 share_homework_photos 를 쓴다 —
 * 사진을 공개하지 않는 학생의 숙제 수행 여부까지 학부모에게 보내지 않는다.
 */
function buildHomework(input: ParentReportInput): ReportMetric<HomeworkBlock> {
  if (!input.disclosure.share_homework_photos) return HIDDEN;
  if (input.todos.length === 0) return NO_DATA;
  const done = input.todos.filter((t) => t.status === "done").length;
  const total = input.todos.length;
  return metricValue({ done, total, rate: total === 0 ? 0 : done / total });
}

function buildSubjectRates(input: ParentReportInput): ReportMetric<SubjectRateRow[]> {
  if (!input.disclosure.share_homework_photos) return HIDDEN;
  const withSubject = input.todos.filter((t) => t.subject);
  if (withSubject.length === 0) return NO_DATA;

  const map = new Map<SubjectCode, { done: number; total: number }>();
  for (const todo of withSubject) {
    const subject = todo.subject as SubjectCode;
    const row = map.get(subject) ?? { done: 0, total: 0 };
    row.total += 1;
    if (todo.status === "done") row.done += 1;
    map.set(subject, row);
  }
  return metricValue(
    [...map.entries()]
      .map(([subject, row]) => ({
        subject,
        label: SUBJECT_LABELS[subject],
        done: row.done,
        total: row.total,
        rate: row.total === 0 ? 0 : row.done / row.total
      }))
      .sort((a, b) => b.total - a.total)
  );
}

function buildFocus(input: ParentReportInput): ReportMetric<FocusBlock> {
  if (!input.disclosure.share_focus_data) return HIDDEN;
  if (input.focusChecks.length === 0) return NO_DATA;

  const start = new Date(`${input.weekStart}T00:00:00.000Z`).getTime();
  const perDayDrowsy = [0, 0, 0, 0, 0, 0, 0];
  const hourCount = new Map<number, number>();
  let drowsy = 0;
  for (const check of input.focusChecks) {
    const at = new Date(check.checked_at);
    const dayIndex = Math.floor((at.getTime() - start) / 86_400_000);
    if (!check.drowsy) continue;
    drowsy += 1;
    if (dayIndex >= 0 && dayIndex <= 6) perDayDrowsy[dayIndex] += 1;
    const hour = at.getUTCHours();
    hourCount.set(hour, (hourCount.get(hour) ?? 0) + 1);
  }
  const peak = [...hourCount.entries()].sort((a, b) => b[1] - a[1])[0];
  // 집중률은 "졸음이 아닌 확인 비율". 확인이 있는데 졸음이 0 이면 100% 가 정상 값이다.
  const averageScore = Math.round(((input.focusChecks.length - drowsy) / input.focusChecks.length) * 100);
  return metricValue({
    averageScore,
    drowsyCount: drowsy,
    perDayDrowsy,
    peakHour: peak ? peak[0] : null
  });
}

/** 시험은 과목별로 묶고, 기록이 있는 과목만 낸다(없는 주는 항목 자체를 숨긴다). */
function buildExams(records: ExamRecordLike[]): ExamBlock[] {
  const map = new Map<SubjectCode, ExamRecordLike[]>();
  for (const record of records) {
    const list = map.get(record.subject) ?? [];
    list.push(record);
    map.set(record.subject, list);
  }
  return [...map.entries()]
    .map(([subject, list]) => {
      const sorted = [...list].sort((a, b) => a.taken_on.localeCompare(b.taken_on));
      return {
        subject,
        label: SUBJECT_LABELS[subject],
        latest: sorted[sorted.length - 1],
        points: sorted.map((r) => ({
          takenOn: r.taken_on,
          grade: r.grade,
          score: r.score,
          examName: r.exam_name
        }))
      };
    })
    .sort((a, b) => b.latest.taken_on.localeCompare(a.latest.taken_on));
}

export function buildParentReport(input: ParentReportInput): ParentReportData {
  const studyTime = buildStudyTime(input);
  const subjectRates = buildSubjectRates(input);

  // 담을 수 있는 과목 = 실제로 데이터가 있는 과목의 합집합.
  // 데이터가 없는 과목을 토글에 띄우면 켜도 아무것도 안 나오는 빈 항목이 된다.
  const subjects = new Set<SubjectCode>();
  if (input.disclosure.share_study_time) {
    for (const s of input.sessions) if (s.subject && minutesOf(s) > 0) subjects.add(s.subject);
  }
  if (subjectRates.state === "value") for (const row of subjectRates.value) subjects.add(row.subject);
  for (const exam of input.examRecords) subjects.add(exam.subject);

  return {
    studyTime,
    homework: buildHomework(input),
    subjectRates,
    focus: buildFocus(input),
    exams: buildExams(input.examRecords),
    availableSubjects: [...subjects]
  };
}

/**
 * 리포트에 보여줄 것이 하나라도 있는가.
 *
 * 전부 hidden/no_data 면 "빈 그릇"이 된다 — 그럴 땐 화면이 왜 비었는지 설명해야지,
 * 빈 카드를 늘어놓으면 안 된다.
 */
export function hasAnyReportContent(data: ParentReportData): boolean {
  return (
    data.studyTime.state === "value" ||
    data.homework.state === "value" ||
    data.subjectRates.state === "value" ||
    data.focus.state === "value" ||
    data.exams.length > 0
  );
}

/** 비어 있는 이유를 사람이 읽을 수 있게. 공개 문제인지 기록 문제인지 구분해 알려준다. */
export function describeEmptyReport(data: ParentReportData): string {
  const hiddenCount = [data.studyTime, data.homework, data.subjectRates, data.focus].filter(
    (m) => m.state === "hidden"
  ).length;
  if (hiddenCount >= 3) {
    return "학생이 공개범위를 대부분 꺼 둬서 담을 내용이 없어요. 학생에게 공개 범위를 확인해 달라고 요청해 보세요.";
  }
  if (hiddenCount > 0) {
    return "이번 주 기록이 아직 없고, 일부 항목은 학생이 공개하지 않았어요. 시험 기록이나 코멘트만으로도 보낼 수 있어요.";
  }
  return "이번 주 기록이 아직 없어요. 시험 기록을 추가하거나 코멘트만으로도 리포트를 보낼 수 있어요.";
}

// ── 글 세 칸 ─────────────────────────────────────────────────────────────────
//
// 이번 단계에서는 **과외쌤이 직접 쓴다.** AI 초안은 다음 단계에서 이 칸을 채우는 방식으로 붙는다
// (칸 구조를 먼저 고정해 두면 AI 를 붙일 때 화면을 다시 만들 필요가 없다).
export type ReportNarrative = {
  teacherComment: string;
  homeSupport: string;
  nextWeekFocus: string;
};

export const EMPTY_NARRATIVE: ReportNarrative = { teacherComment: "", homeSupport: "", nextWeekFocus: "" };

export const NARRATIVE_FIELDS = [
  { key: "teacherComment", label: "선생님 코멘트", placeholder: "이번 주 아이의 변화를 한두 문장으로 적어 주세요." },
  { key: "homeSupport", label: "가정에서 도와주시면", placeholder: "가정에서 도와주실 수 있는 것을 적어 주세요." },
  { key: "nextWeekFocus", label: "다음 주 방향", placeholder: "다음 주에 집중할 것을 적어 주세요." }
] as const satisfies ReadonlyArray<{ key: keyof ReportNarrative; label: string; placeholder: string }>;

/** 발송하려면 최소한 선생님 코멘트는 있어야 한다. 빈 리포트를 학부모에게 보내지 않는다. */
export function canSendReport(narrative: ReportNarrative): boolean {
  return narrative.teacherComment.trim().length > 0;
}

// ── 발송 상태 ────────────────────────────────────────────────────────────────
//
// 실제 카톡/PDF 연동은 이번 범위가 아니다. 상태만 기록한다 —
// 나중에 연동을 붙일 때 "무엇을 언제 어떤 경로로 보냈는지"가 이미 남아 있어야 한다.
export const REPORT_DELIVERY_CHANNELS = ["link", "kakao", "pdf"] as const;
export type ReportDeliveryChannel = (typeof REPORT_DELIVERY_CHANNELS)[number];

export const REPORT_DELIVERY_CHANNEL_LABELS: Record<ReportDeliveryChannel, string> = {
  link: "공유 링크",
  kakao: "카카오톡",
  pdf: "PDF"
};

export const REPORT_DELIVERY_STATUSES = ["pending", "sent", "failed"] as const;
export type ReportDeliveryStatus = (typeof REPORT_DELIVERY_STATUSES)[number];

export const REPORT_DELIVERY_STATUS_LABELS: Record<ReportDeliveryStatus, string> = {
  pending: "발송 대기",
  sent: "발송됨",
  failed: "발송 실패"
};

/** 아직 실연동이 없는 채널인지. 화면이 "되는 척"하지 않게 하려는 것이다. */
export function isChannelWired(channel: ReportDeliveryChannel): boolean {
  return channel === "link";
}
