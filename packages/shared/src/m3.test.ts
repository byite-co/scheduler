import { describe, expect, it } from "vitest";

import {
  createTimerEndPatch,
  createTimerPausePatch,
  createTimerResumePatch,
  createTimerStartPayload,
  getTimerElapsedSeconds,
  getTimerState,
  sumTimerSecondsForDate
} from "./m3";

describe("M3 timer session state", () => {
  it("creates a running study session with selected subject and focus flag", () => {
    expect(
      createTimerStartPayload({
        studentId: "student-1",
        subject: "math",
        focusMode: true,
        now: "2026-06-23T00:00:00.000Z"
      })
    ).toEqual({
      student_id: "student-1",
      subject: "math",
      focus_mode: true,
      started_at: "2026-06-23T00:00:00.000Z",
      last_resumed_at: "2026-06-23T00:00:00.000Z",
      duration_sec: 0,
      timer_state: "running"
    });
  });

  it("accumulates only running time across pause and resume", () => {
    const runningSession = {
      started_at: "2026-06-23T00:00:00.000Z",
      ended_at: null,
      duration_sec: 120,
      timer_state: "running",
      last_resumed_at: "2026-06-23T00:05:00.000Z",
      focus_mode: false,
      subject: "english" as const
    };

    expect(getTimerState(runningSession)).toBe("running");
    expect(getTimerElapsedSeconds(runningSession, "2026-06-23T00:10:30.000Z")).toBe(450);

    const pausePatch = createTimerPausePatch(runningSession, "2026-06-23T00:10:30.000Z");
    expect(pausePatch).toEqual({
      duration_sec: 450,
      last_resumed_at: null,
      timer_state: "paused"
    });

    const pausedSession = {
      ...runningSession,
      ...pausePatch
    };
    expect(getTimerState(pausedSession)).toBe("paused");
    expect(getTimerElapsedSeconds(pausedSession, "2026-06-23T00:20:00.000Z")).toBe(450);
    expect(createTimerResumePatch("2026-06-23T00:20:00.000Z")).toEqual({
      last_resumed_at: "2026-06-23T00:20:00.000Z",
      timer_state: "running"
    });
  });

  it("finalizes duration and daily totals when the session ends", () => {
    const session = {
      started_at: "2026-06-23T01:00:00.000Z",
      ended_at: null,
      duration_sec: 1800,
      timer_state: "running",
      last_resumed_at: "2026-06-23T01:30:00.000Z",
      focus_mode: false,
      subject: "korean" as const
    };

    expect(createTimerEndPatch(session, "2026-06-23T02:00:00.000Z")).toEqual({
      ended_at: "2026-06-23T02:00:00.000Z",
      duration_sec: 3600,
      last_resumed_at: null,
      timer_state: "completed"
    });
    expect(
      sumTimerSecondsForDate(
        [
          { ...session, ended_at: "2026-06-23T02:00:00.000Z", duration_sec: 3600, timer_state: "completed", last_resumed_at: null },
          {
            started_at: "2026-06-22T02:00:00.000Z",
            ended_at: "2026-06-22T02:20:00.000Z",
            duration_sec: 1200,
            timer_state: "completed",
            last_resumed_at: null,
            focus_mode: false,
            subject: "math"
          }
        ],
        "2026-06-23T12:00:00.000Z"
      )
    ).toBe(3600);
  });
});
