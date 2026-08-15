import { describe, expect, it } from "vitest";

import {
  NARRATIVE_FIELDS,
  buildParentReport,
  canSendReport,
  describeEmptyReport,
  describeMetricState,
  hasAnyReportContent,
  isChannelWired,
  normalizeDisclosure,
  type ParentReportInput
} from "./parentReport";

const ALL_OPEN = { share_study_time: true, share_homework_photos: true, share_focus_data: true };

function input(overrides: Partial<ParentReportInput> = {}): ParentReportInput {
  return {
    weekStart: "2026-08-09", // 일요일
    disclosure: ALL_OPEN,
    sessions: [],
    weeklyTrend: [{ weekStart: "2026-08-09", minutes: 0 }],
    todos: [],
    focusChecks: [],
    examRecords: [],
    ...overrides
  };
}

describe("공개범위 — 끈 항목은 리포트에 넣지 않는다", () => {
  it("공개하지 않은 항목은 hidden 이고 값이 붙지 않는다", () => {
    const data = buildParentReport(
      input({
        disclosure: { share_study_time: false, share_homework_photos: false, share_focus_data: false },
        // 데이터가 있어도 공개가 꺼져 있으면 값이 나가면 안 된다.
        sessions: [{ subject: "math", duration_sec: 3600, started_at: "2026-08-10T10:00:00.000Z" }],
        todos: [{ id: "t1", subject: "math", status: "done", due_date: "2026-08-10" }],
        focusChecks: [{ checked_at: "2026-08-10T10:00:00.000Z", drowsy: true }]
      })
    );
    expect(data.studyTime.state).toBe("hidden");
    expect(data.homework.state).toBe("hidden");
    expect(data.subjectRates.state).toBe("hidden");
    expect(data.focus.state).toBe("hidden");
    // hidden 이면 value 키 자체가 없어야 한다 — 있으면 화면이 실수로 읽는다.
    expect("value" in data.studyTime).toBe(false);
  });

  it("disclosure 행이 없으면 전부 비공개로 본다 (기본값이 공개가 되면 안 된다)", () => {
    expect(normalizeDisclosure(null)).toEqual({
      share_study_time: false,
      share_homework_photos: false,
      share_focus_data: false
    });
    expect(normalizeDisclosure({ share_study_time: true })).toEqual({
      share_study_time: true,
      share_homework_photos: false,
      share_focus_data: false
    });
  });

  it("집중도는 공부시간과 별개 스위치다", () => {
    const data = buildParentReport(
      input({
        disclosure: { share_study_time: true, share_homework_photos: true, share_focus_data: false },
        sessions: [{ subject: "math", duration_sec: 3600, started_at: "2026-08-10T10:00:00.000Z" }],
        weeklyTrend: [{ weekStart: "2026-08-09", minutes: 60 }],
        focusChecks: [{ checked_at: "2026-08-10T10:00:00.000Z", drowsy: true }]
      })
    );
    expect(data.studyTime.state).toBe("value");
    expect(data.focus.state).toBe("hidden");
  });
});

describe("0 과 기록 없음을 구분한다", () => {
  it("공개했지만 기록이 없으면 no_data (0 이 아니다)", () => {
    const data = buildParentReport(input());
    expect(data.studyTime.state).toBe("no_data");
    expect(data.homework.state).toBe("no_data");
    expect(data.focus.state).toBe("no_data");
  });

  it("숙제가 있고 하나도 안 했으면 0% 는 진짜 값이다", () => {
    const data = buildParentReport(
      input({ todos: [{ id: "t1", subject: "math", status: "todo", due_date: "2026-08-10" }] })
    );
    expect(data.homework.state).toBe("value");
    if (data.homework.state !== "value") throw new Error("unreachable");
    expect(data.homework.value).toEqual({ done: 0, total: 1, rate: 0 });
  });

  it("지난주 기록이 없으면 증감을 0 으로 만들지 않는다", () => {
    const data = buildParentReport(
      input({
        sessions: [{ subject: "math", duration_sec: 3600, started_at: "2026-08-10T10:00:00.000Z" }],
        weeklyTrend: [{ weekStart: "2026-08-09", minutes: 60 }]
      })
    );
    if (data.studyTime.state !== "value") throw new Error("unreachable");
    // 지난주 항목이 없다 → null. 0 으로 두면 "지난주와 같다"는 거짓이 된다.
    expect(data.studyTime.value.deltaMinutes).toBeNull();
  });

  it("지난주가 있으면 증감을 계산한다", () => {
    const data = buildParentReport(
      input({
        sessions: [{ subject: "math", duration_sec: 7200, started_at: "2026-08-10T10:00:00.000Z" }],
        weeklyTrend: [
          { weekStart: "2026-08-02", minutes: 60 },
          { weekStart: "2026-08-09", minutes: 120 }
        ]
      })
    );
    if (data.studyTime.state !== "value") throw new Error("unreachable");
    expect(data.studyTime.value.deltaMinutes).toBe(60);
  });

  it("상태마다 다른 문구를 준다 — 색·숫자만으로 전하지 않는다", () => {
    expect(describeMetricState("hidden")).toContain("공개");
    expect(describeMetricState("no_data")).toContain("기록");
    expect(describeMetricState("hidden")).not.toBe(describeMetricState("no_data"));
  });
});

describe("집계", () => {
  it("요일별 공부시간을 주 시작 기준으로 나눈다", () => {
    const data = buildParentReport(
      input({
        sessions: [
          { subject: "math", duration_sec: 1800, started_at: "2026-08-09T01:00:00.000Z" }, // 일
          { subject: "english", duration_sec: 3600, started_at: "2026-08-11T01:00:00.000Z" } // 화
        ],
        weeklyTrend: [{ weekStart: "2026-08-09", minutes: 90 }]
      })
    );
    if (data.studyTime.state !== "value") throw new Error("unreachable");
    expect(data.studyTime.value.perDayMinutes).toEqual([30, 0, 60, 0, 0, 0, 0]);
    expect(data.studyTime.value.totalMinutes).toBe(90);
  });

  it("집중률은 졸음이 아닌 확인의 비율이다", () => {
    const data = buildParentReport(
      input({
        focusChecks: [
          { checked_at: "2026-08-10T08:00:00.000Z", drowsy: false },
          { checked_at: "2026-08-10T08:01:00.000Z", drowsy: false },
          { checked_at: "2026-08-10T17:00:00.000Z", drowsy: true },
          { checked_at: "2026-08-10T17:05:00.000Z", drowsy: true }
        ]
      })
    );
    if (data.focus.state !== "value") throw new Error("unreachable");
    expect(data.focus.value.averageScore).toBe(50);
    expect(data.focus.value.drowsyCount).toBe(2);
    expect(data.focus.value.peakHour).toBe(17);
  });

  it("시험은 과목별로 묶고 날짜순으로 누적한다", () => {
    const data = buildParentReport(
      input({
        examRecords: [
          { id: "e2", subject: "math", exam_name: "6월 모의", taken_on: "2026-06-04", grade: 3, score: null, comment: null },
          { id: "e1", subject: "math", exam_name: "3월 모의", taken_on: "2026-03-05", grade: 5, score: null, comment: null },
          { id: "e3", subject: "english", exam_name: "중간", taken_on: "2026-05-01", grade: null, score: 88, comment: "듣기 보완" }
        ]
      })
    );
    expect(data.exams).toHaveLength(2);
    const math = data.exams.find((e) => e.subject === "math");
    expect(math?.points.map((p) => p.grade)).toEqual([5, 3]); // 날짜 오름차순
    expect(math?.latest.exam_name).toBe("6월 모의");
    // 등급이 없고 점수만 있어도 기록으로 남는다(성적을 강요하지 않는다).
    expect(data.exams.find((e) => e.subject === "english")?.latest.score).toBe(88);
  });

  it("담을 수 있는 과목은 실제 데이터가 있는 것만이다", () => {
    const data = buildParentReport(
      input({
        sessions: [{ subject: "math", duration_sec: 3600, started_at: "2026-08-10T10:00:00.000Z" }],
        weeklyTrend: [{ weekStart: "2026-08-09", minutes: 60 }],
        examRecords: [
          { id: "e1", subject: "science", exam_name: "단원평가", taken_on: "2026-08-05", grade: 2, score: null, comment: null }
        ]
      })
    );
    expect([...data.availableSubjects].sort()).toEqual(["math", "science"]);
  });
});

describe("빈 리포트", () => {
  it("담을 것이 하나도 없으면 그 사실을 알 수 있다", () => {
    const data = buildParentReport(input());
    expect(hasAnyReportContent(data)).toBe(false);
    // 왜 비었는지 구분해서 알려준다 — 공개 문제와 기록 문제는 대응이 다르다.
    expect(describeEmptyReport(data)).toContain("기록");
  });

  it("대부분 비공개면 공개범위 문제라고 알려준다", () => {
    const data = buildParentReport(
      input({ disclosure: { share_study_time: false, share_homework_photos: false, share_focus_data: false } })
    );
    expect(describeEmptyReport(data)).toContain("공개범위");
  });

  it("시험 기록만 있어도 리포트에 담을 것이 있다", () => {
    const data = buildParentReport(
      input({
        examRecords: [
          { id: "e1", subject: "math", exam_name: "6월 모의", taken_on: "2026-06-04", grade: 3, score: null, comment: null }
        ]
      })
    );
    expect(hasAnyReportContent(data)).toBe(true);
  });
});

describe("발송", () => {
  it("선생님 코멘트 없이는 보내지 않는다", () => {
    expect(canSendReport({ teacherComment: "", homeSupport: "a", nextWeekFocus: "b" })).toBe(false);
    expect(canSendReport({ teacherComment: "   ", homeSupport: "", nextWeekFocus: "" })).toBe(false);
    expect(canSendReport({ teacherComment: "잘했어요", homeSupport: "", nextWeekFocus: "" })).toBe(true);
  });

  it("글 세 칸이 모두 있다 — AI 초안이 붙을 자리다", () => {
    expect(NARRATIVE_FIELDS.map((f) => f.key)).toEqual(["teacherComment", "homeSupport", "nextWeekFocus"]);
  });

  it("연동된 채널과 아닌 채널을 구분한다 — 되는 척하면 안 된다", () => {
    expect(isChannelWired("link")).toBe(true);
    expect(isChannelWired("kakao")).toBe(false);
    expect(isChannelWired("pdf")).toBe(false);
  });
});
