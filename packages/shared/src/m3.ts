import type { SubjectCode } from "./subjects";

export type TimerState = "running" | "paused" | "completed";

export type TimerSessionLike = {
  started_at: string;
  ended_at: string | null;
  duration_sec: number;
  timer_state?: string | null;
  last_resumed_at?: string | null;
  focus_mode: boolean;
  subject?: SubjectCode | null;
};

export type TimerStartInput = {
  studentId: string;
  subject: SubjectCode;
  focusMode: boolean;
  now: string | Date;
};

export const TIMER_STATES = {
  running: "running",
  paused: "paused",
  completed: "completed"
} as const;

export function getTimerState(session: TimerSessionLike | null): TimerState {
  if (!session || session.ended_at) return TIMER_STATES.completed;
  return session.timer_state === TIMER_STATES.paused ? TIMER_STATES.paused : TIMER_STATES.running;
}

export function getTimerElapsedSeconds(
  session: TimerSessionLike,
  now: string | Date = new Date()
): number {
  const baseSeconds = Math.max(0, session.duration_sec);

  if (getTimerState(session) !== TIMER_STATES.running || !session.last_resumed_at) {
    return baseSeconds;
  }

  return baseSeconds + diffSeconds(session.last_resumed_at, now);
}

export function createTimerStartPayload(input: TimerStartInput) {
  const now = toIso(input.now);

  return {
    student_id: input.studentId,
    subject: input.subject,
    focus_mode: input.focusMode,
    started_at: now,
    last_resumed_at: now,
    duration_sec: 0,
    timer_state: TIMER_STATES.running
  };
}

export function createTimerPausePatch(
  session: TimerSessionLike,
  now: string | Date = new Date()
) {
  return {
    duration_sec: getTimerElapsedSeconds(session, now),
    last_resumed_at: null,
    timer_state: TIMER_STATES.paused
  };
}

export function createTimerResumePatch(now: string | Date = new Date()) {
  return {
    last_resumed_at: toIso(now),
    timer_state: TIMER_STATES.running
  };
}

export function createTimerEndPatch(
  session: TimerSessionLike,
  now: string | Date = new Date()
) {
  const endedAt = toIso(now);

  return {
    ended_at: endedAt,
    duration_sec: getTimerElapsedSeconds(session, endedAt),
    last_resumed_at: null,
    timer_state: TIMER_STATES.completed
  };
}

export function sumTimerSecondsForDate(
  sessions: TimerSessionLike[],
  date: string | Date,
  now: string | Date = new Date()
): number {
  const dateKey = toIso(date).slice(0, 10);

  return sessions
    .filter((session) => toIso(session.started_at).slice(0, 10) === dateKey)
    .reduce((total, session) => total + getTimerElapsedSeconds(session, now), 0);
}

function diffSeconds(from: string | Date, to: string | Date): number {
  return Math.max(0, Math.floor((new Date(to).getTime() - new Date(from).getTime()) / 1000));
}

function toIso(value: string | Date): string {
  return typeof value === "string" ? new Date(value).toISOString() : value.toISOString();
}
