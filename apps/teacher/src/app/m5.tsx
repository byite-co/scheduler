"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";

import {
  EMPTY_NARRATIVE,
  LESSON_STATUSES,
  LESSON_STATUS_LABELS,
  NARRATIVE_FIELDS,
  REPORT_DELIVERY_CHANNELS,
  REPORT_DELIVERY_CHANNEL_LABELS,
  REPORT_DELIVERY_STATUS_LABELS,
  SUBJECT_LABELS,
  buildLessonBlock,
  buildParentReport,
  buildTeacherBranding,
  canSendReport,
  describeEmptyReport,
  describeLessonBlock,
  describeMetricState,
  getReportGating,
  getReportQuotaState,
  getTeacherBillingState,
  hasAnyReportContent,
  isChannelWired,
  isReportQuotaError,
  isShareExpired,
  normalizeDisclosure,
  type ExamRecordLike,
  type LessonBlock,
  type LessonStatus,
  type ParentReportData,
  type ReportDeliveryChannel,
  type ReportMetric,
  type ReportNarrative,
  type SubStatus,
  type TeacherBranding
} from "@ssamplanner/shared";
import type { Database, SubjectCode } from "@ssamplanner/shared";

import { TeacherShell, type TeacherShellData } from "./m1";
import { supabase } from "./supabaseClient";

type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
type ReportRow = Database["public"]["Tables"]["reports"]["Row"];

const subjectOptions = Object.keys(SUBJECT_LABELS) as SubjectCode[];
/** 추이 그래프에 그릴 주 수. B7 은 6개 막대다. */
const TREND_WEEKS = 6;

function weekRange(now: Date): { start: string; end: string } {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

function shiftWeeks(dateKey: string, weeks: number): string {
  const d = new Date(`${dateKey}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
}

function formatHm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}시간 ${m}분` : `${m}분`;
}

/**
 * 값이 없는 항목의 공통 표현.
 *
 * 🚨 **여기서 0 을 그리면 안 된다.** hidden(공개 안 함)과 no_data(기록 없음)는 서로 다르고,
 *    둘 다 "0시간 공부"와 다르다. 카드를 통째로 이 안내로 바꾼다.
 */
function MetricFallback({ metric, title }: { metric: ReportMetric<unknown>; title: string }) {
  const tone = metric.state === "hidden" ? "border-line bg-canvas" : "border-dashed border-line bg-surface";
  return (
    <div className={`grid gap-1 rounded-card border p-5 ${tone}`}>
      <h3 className="text-sm font-extrabold text-ink">{title}</h3>
      <p className="text-sm font-bold text-muted">{describeMetricState(metric.state)}</p>
      {metric.state === "hidden" ? (
        <p className="text-xs font-bold text-muted">공개 범위는 학생만 바꿀 수 있어요. 리포트에는 넣지 않아요.</p>
      ) : null}
    </div>
  );
}

function Card({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grid gap-3 rounded-card border border-line bg-surface p-5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-extrabold text-ink">{title}</h3>
        {right}
      </div>
      {children}
    </div>
  );
}

function Bars({ values, labels, tone }: { values: number[]; labels: string[]; tone: "brand" | "flame" }) {
  const max = Math.max(1, ...values);
  const color = tone === "brand" ? "bg-brand" : "bg-flame";
  return (
    <div className="grid gap-1">
      <div className="flex items-end gap-1" style={{ height: 96 }}>
        {values.map((value, index) => (
          <div key={index} className="flex flex-1 flex-col items-center justify-end gap-1">
            <span className="text-[10px] font-bold text-muted">{value > 0 ? value : ""}</span>
            <div
              className={`w-full rounded-t ${color} ${value === 0 ? "opacity-25" : ""}`}
              style={{ height: 4 + (value / max) * 72 }}
              title={`${value}`}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-1">
        {labels.map((label, index) => (
          <span key={index} className="flex-1 text-center text-[10px] font-bold text-muted">
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** 등급 추이 — 등급은 1이 가장 좋으므로 **위아래를 뒤집어** 그린다. */
function GradeTrend({ points }: { points: Array<{ takenOn: string; grade: number | null; examName: string }> }) {
  const graded = points.filter((p) => p.grade !== null);
  if (graded.length === 0) {
    return <p className="text-sm font-bold text-muted">등급을 적은 시험이 아직 없어요. 점수만 기록돼 있어요.</p>;
  }
  return (
    <div className="grid gap-1">
      <div className="flex items-end gap-2" style={{ height: 80 }}>
        {graded.map((point, index) => (
          <div key={index} className="flex flex-1 flex-col items-center justify-end gap-1">
            <span className="rounded-chip bg-brand px-2 py-0.5 text-[10px] font-extrabold text-surface">
              {point.grade}등급
            </span>
            <div className="w-full rounded-t bg-brand" style={{ height: 8 + ((10 - (point.grade ?? 9)) / 9) * 56 }} />
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        {graded.map((point, index) => (
          <span key={index} className="flex-1 truncate text-center text-[10px] font-bold text-muted">
            {point.takenOn.slice(5)}
          </span>
        ))}
      </div>
    </div>
  );
}

export function TeacherReportBuilder() {
  const [session, setSession] = useState<Session | null>(null);
  const [students, setStudents] = useState<ProfileRow[]>([]);
  const [studentId, setStudentId] = useState<string | null>(null);
  const [report, setReport] = useState<ParentReportData | null>(null);
  const [narrative, setNarrative] = useState<ReportNarrative>(EMPTY_NARRATIVE);
  const [included, setIncluded] = useState<SubjectCode[]>([]);
  const [history, setHistory] = useState<ReportRow[]>([]);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<Array<{ channel: string; status: string; error: string | null }>>([]);
  const [examForm, setExamForm] = useState({ subject: "math" as SubjectCode, exam_name: "", taken_on: "", grade: "", score: "", comment: "" });
  const [lessonForm, setLessonForm] = useState({ taught_on: "", status: "done" as LessonStatus, memo: "" });
  const [lessons, setLessons] = useState<ReportMetric<LessonBlock>>({ state: "no_data" });
  const [branding, setBranding] = useState<TeacherBranding | null>(null);
  const [subStatus, setSubStatus] = useState<SubStatus>("none");
  const [quotaUsed, setQuotaUsed] = useState(0);
  const [activeCount, setActiveCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("세션 확인 중");

  const week = useMemo(() => weekRange(new Date()), []);

  const refresh = useCallback(async () => {
    setLoading(true);
    const active = (await supabase.auth.getSession()).data.session;
    setSession(active);
    if (!active) {
      setMessage("로그인이 필요합니다.");
      setLoading(false);
      return;
    }
    const connectionResult = await supabase
      .from("connections")
      .select("student_id")
      .eq("teacher_id", active.user.id)
      .eq("status", "active");
    const ids = (connectionResult.data ?? []).map((c) => c.student_id as string);
    setActiveCount(ids.length);
    const [profileResult, meResult, subResult, usageResult] = await Promise.all([
      ids.length ? supabase.from("profiles").select("*").in("id", ids) : Promise.resolve({ data: [] as ProfileRow[] }),
      // 브랜딩 값은 설정 화면이 이미 저장한다(profiles.name / bio / subjects). 여기서는 읽기만 한다.
      supabase.from("profiles").select("name, bio, subjects").eq("id", active.user.id).maybeSingle(),
      // ⚠️ 과외쌤 구독이다. 학생 프리미엄(student_subscriptions)과 다른 테이블이다.
      supabase.from("teacher_subscriptions").select("status").eq("teacher_id", active.user.id).maybeSingle(),
      supabase.rpc("report_monthly_usage", { p_teacher_id: active.user.id })
    ]);
    setStudents(profileResult.data ?? []);
    setBranding(buildTeacherBranding(meResult.data as never));
    setSubStatus(((subResult.data as { status?: SubStatus } | null)?.status ?? "none") as SubStatus);
    setQuotaUsed(typeof usageResult.data === "number" ? usageResult.data : 0);
    setMessage(connectionResult.error?.message ?? "");
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const loadStudent = useCallback(
    async (id: string) => {
      setStudentId(id);
      setShareLink(null);
      setDeliveries([]);
      setNarrative(EMPTY_NARRATIVE);

      const trendStart = shiftWeeks(week.start, -(TREND_WEEKS - 1));

      // ⚠️ 공개범위는 뷰가 서버에서 강제한다(v_teacher_* 가 disclosure_settings 를 건다).
      //    그런데 뷰만 보면 "공개 안 함"과 "기록 없음"이 둘 다 빈 배열이라 구분이 안 된다.
      //    그래서 disclosure_settings 를 **함께** 읽어 상태를 가른다.
      const [sessionsResult, trendResult, todosResult, focusResult, examsResult, disclosureResult, historyResult] =
        await Promise.all([
          supabase
            .from("v_teacher_study_sessions")
            .select("subject, duration_sec, started_at")
            .eq("student_id", id)
            .gte("started_at", `${week.start}T00:00:00.000Z`)
            .lte("started_at", `${week.end}T23:59:59.999Z`),
          supabase
            .from("v_teacher_study_sessions")
            .select("duration_sec, started_at")
            .eq("student_id", id)
            .gte("started_at", `${trendStart}T00:00:00.000Z`),
          supabase
            .from("todos")
            .select("id, subject, status, due_date")
            .eq("student_id", id)
            .eq("source", "teacher")
            .gte("due_date", week.start)
            .lte("due_date", week.end),
          // 🚨 student_id 필터가 **반드시** 있어야 한다. 뷰는 담당 학생 전체를 돌려주므로
          //    빼먹으면 다른 학생의 집중도가 이 학생 리포트에 섞여 학부모에게 나간다
          //    (실연동 검증에서 실제로 재현됐다 — 20260815010000 에서 뷰에 student_id 를 추가한 이유).
          supabase
            .from("v_teacher_focus_checks")
            .select("checked_at, drowsy")
            .eq("student_id", id)
            .gte("checked_at", `${week.start}T00:00:00.000Z`)
            .lte("checked_at", `${week.end}T23:59:59.999Z`),
          supabase
            .from("exam_records")
            .select("id, subject, exam_name, taken_on, grade, score, comment")
            .eq("student_id", id)
            .order("taken_on", { ascending: true }),
          supabase
            .from("connections")
            .select("id, disclosure_settings(share_study_time, share_homework_photos, share_focus_data)")
            .eq("teacher_id", session?.user.id ?? "")
            .eq("student_id", id)
            .eq("status", "active")
            .maybeSingle(),
          supabase.from("reports").select("*").eq("student_id", id).order("created_at", { ascending: false }).limit(10)
        ]);

      // 회차는 **이번 달** 기준이다(주간 리포트지만 학부모가 묻는 건 "이번 달 몇 번"이다).
      const monthStart = `${week.start.slice(0, 7)}-01`;
      const [lessonResult, feeResult] = await Promise.all([
        supabase
          .from("lessons")
          .select("taught_on, status")
          .eq("student_id", id)
          .gte("taught_on", monthStart),
        // 예정 회차는 월 단위 약속이라 lesson_fees 에 있다(금액과 같은 주기).
        supabase
          .from("lesson_fees")
          .select("planned_sessions")
          .eq("student_id", id)
          .eq("teacher_id", session?.user.id ?? "")
          .eq("period", week.start.slice(0, 7))
          .maybeSingle()
      ]);
      setLessons(
        buildLessonBlock(
          (lessonResult.data ?? []) as never,
          (feeResult.data as { planned_sessions: number | null } | null)?.planned_sessions
        )
      );

      // 주간 추이: 세션을 주 시작일로 묶는다. 기록이 없는 주도 0 으로 **자리를 만든다** —
      // 막대가 빠지면 그 주가 없는 것처럼 보인다(추이는 연속이어야 읽힌다).
      const buckets = new Map<string, number>();
      for (let i = TREND_WEEKS - 1; i >= 0; i -= 1) buckets.set(shiftWeeks(week.start, -i), 0);
      for (const row of trendResult.data ?? []) {
        const startedAt = (row as { started_at: string | null }).started_at;
        if (!startedAt) continue;
        const d = new Date(startedAt);
        d.setUTCHours(0, 0, 0, 0);
        d.setUTCDate(d.getUTCDate() - d.getUTCDay());
        const key = d.toISOString().slice(0, 10);
        if (!buckets.has(key)) continue;
        buckets.set(key, (buckets.get(key) ?? 0) + Math.round(((row as { duration_sec: number | null }).duration_sec ?? 0) / 60));
      }

      const disclosureRaw = (disclosureResult.data as { disclosure_settings: unknown } | null)?.disclosure_settings;
      const disclosureRow = Array.isArray(disclosureRaw) ? disclosureRaw[0] : disclosureRaw;

      const built = buildParentReport({
        weekStart: week.start,
        disclosure: normalizeDisclosure(disclosureRow as never),
        sessions: (sessionsResult.data ?? []) as never,
        weeklyTrend: [...buckets.entries()].map(([weekStart, minutes]) => ({ weekStart, minutes })),
        todos: (todosResult.data ?? []) as never,
        focusChecks: (focusResult.data ?? []) as never,
        examRecords: (examsResult.data ?? []) as ExamRecordLike[]
      });
      setReport(built);
      setIncluded(built.availableSubjects);
      setHistory(historyResult.data ?? []);
    },
    [session, week]
  );

  async function addExam() {
    if (!session || !studentId) return;
    if (!examForm.exam_name.trim() || !examForm.taken_on) {
      setMessage("시험 이름과 본 날짜는 필요해요.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.from("exam_records").insert({
      teacher_id: session.user.id,
      student_id: studentId,
      subject: examForm.subject,
      exam_name: examForm.exam_name.trim(),
      taken_on: examForm.taken_on,
      // 빈 문자열을 0 으로 보내면 "0점"이 된다. 안 적은 것은 null 이어야 한다.
      grade: examForm.grade ? Number(examForm.grade) : null,
      score: examForm.score ? Number(examForm.score) : null,
      comment: examForm.comment.trim() || null
    });
    setBusy(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    setExamForm({ subject: examForm.subject, exam_name: "", taken_on: "", grade: "", score: "", comment: "" });
    setMessage("시험 기록을 추가했어요.");
    await loadStudent(studentId);
  }

  async function addLesson() {
    if (!session || !studentId) return;
    if (!lessonForm.taught_on) {
      setMessage("수업 날짜는 필요해요.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.from("lessons").insert({
      teacher_id: session.user.id,
      student_id: studentId,
      taught_on: lessonForm.taught_on,
      status: lessonForm.status,
      memo: lessonForm.memo.trim() || null
    });
    setBusy(false);
    if (error) {
      // 같은 날 같은 시각 중복은 실수다(연타·중복 저장).
      setMessage(error.code === "23505" ? "같은 날짜에 이미 기록이 있어요." : error.message);
      return;
    }
    setLessonForm({ taught_on: "", status: "done", memo: "" });
    setMessage("수업 회차를 기록했어요.");
    await loadStudent(studentId);
  }

  async function saveAndSend(channel: ReportDeliveryChannel) {
    if (!session || !studentId || !report) return;
    if (!canSendReport(narrative)) {
      setMessage("선생님 코멘트는 채워 주세요. 자동 수집 데이터만으로는 보내지 않아요.");
      return;
    }
    if (quota.exceeded) {
      setMessage(quota.notice ?? "이번 달 발급 한도를 다 썼어요.");
      return;
    }
    setBusy(true);

    const inserted = await supabase
      .from("reports")
      .insert({
        student_id: studentId,
        teacher_id: session.user.id,
        type: "weekly",
        period_start: week.start,
        period_end: week.end,
        // 발송 시점의 값을 그대로 굳힌다 — 나중에 학생 기록이 바뀌어도 보낸 리포트는 그대로여야 한다.
        // 무료 플랜은 자동 그래프를 안 쓰므로 스냅샷에도 넣지 않는다(학부모 웹뷰가 그리면 안 된다).
        data: { ...(gating.autoGraphs ? report : {}), lessons, branding, gating: gating.mode } as never,
        teacher_comment: narrative.teacherComment,
        home_support: narrative.homeSupport || null,
        next_week_focus: narrative.nextWeekFocus || null,
        included_subjects: included,
        status: "draft"
      })
      .select("id")
      .single();
    if (inserted.error || !inserted.data) {
      setBusy(false);
      // 한도는 DB 트리거가 최종적으로 막는다(화면만 막으면 직접 호출로 우회된다).
      setMessage(
        isReportQuotaError(inserted.error?.message)
          ? (quota.notice ?? `이번 달 발급 한도(${quota.quota}건)를 다 썼어요.`)
          : (inserted.error?.message ?? "리포트 저장 실패")
      );
      return;
    }
    setQuotaUsed((n) => n + 1);
    const reportId = inserted.data.id as string;

    // 링크만 실제로 발급된다. 카톡·PDF 는 아직 연동이 없어 **pending 으로만** 남긴다 —
    // 되는 척하면 과외쌤이 보냈다고 믿는다.
    let deliveryStatus: "pending" | "sent" | "failed" = "pending";
    let deliveryError: string | null = null;
    if (channel === "link") {
      // 만료는 DB 기본값(90일)을 쓴다. 여기서 168시간을 넘기면 학부모가 일주일 안에 못 열었을 때
      // 링크가 죽는다 — 그 문의는 전부 과외쌤에게 돌아온다.
      const shared = await supabase.rpc("create_report_share", { p_report_id: reportId });
      if (shared.error) {
        deliveryStatus = "failed";
        deliveryError = shared.error.message;
      } else {
        deliveryStatus = "sent";
        setShareLink(`/r/${(shared.data as { token: string }).token}`);
        await supabase.from("reports").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", reportId);
      }
    }

    await supabase.from("report_deliveries").insert({
      report_id: reportId,
      channel,
      status: deliveryStatus,
      error: deliveryError,
      sent_at: deliveryStatus === "sent" ? new Date().toISOString() : null
    });

    const { data: deliveryRows } = await supabase
      .from("report_deliveries")
      .select("channel, status, error")
      .eq("report_id", reportId);
    setDeliveries((deliveryRows ?? []) as never);

    setBusy(false);
    setMessage(
      deliveryStatus === "sent"
        ? "리포트를 저장하고 공유 링크를 발급했어요."
        : deliveryStatus === "failed"
          ? `발송 실패: ${deliveryError}`
          : `${REPORT_DELIVERY_CHANNEL_LABELS[channel]} 연동 전이라 발송 대기로만 기록했어요.`
    );
    await loadStudent(studentId);
  }

  // 발급된 링크를 즉시 죽인다. 리포트 본문은 남는다(이력·재발급 가능).
  async function revokeShare(reportId: string) {
    if (!window.confirm("이 링크를 끊으면 학부모가 더 이상 볼 수 없어요. 계속할까요?")) return;
    setBusy(true);
    const { error } = await supabase.rpc("revoke_report_share", { p_report_id: reportId });
    setBusy(false);
    setMessage(error ? `링크 끊기 실패: ${error.message}` : "링크를 끊었어요. 필요하면 다시 발급할 수 있어요.");
    if (!error) {
      setShareLink(null);
      if (studentId) await loadStudent(studentId);
    }
  }

  const shellData: TeacherShellData = {
    session,
    loading,
    message,
    profile: null,
    setMessage,
    refresh: async () => {
      await refresh();
    }
  };
  const student = students.find((s) => s.id === studentId);
  const dayLabels = ["일", "월", "화", "수", "목", "금", "토"];
  // ⚠️ 과외쌤 구독이다(teacher_subscriptions). 학생 프리미엄과 혼동하면 안 된다.
  const gating = getReportGating(getTeacherBillingState(subStatus).active);
  const quota = getReportQuotaState(quotaUsed, activeCount);

  return (
    <TeacherShell
      active="/reports/weekly"
      title="주간 학부모 리포트"
      subtitle={`${week.start} ~ ${week.end} · 공부량·수행은 자동, 코멘트만 작성하면 돼요. (공개범위 적용)`}
      data={shellData}
    >
      <section className="flex flex-wrap gap-2">
        {students.map((s) => (
          <button
            key={s.id}
            className={`whitespace-nowrap rounded-control px-3 py-2 text-sm font-bold ${
              studentId === s.id ? "bg-brand text-surface" : "border border-line bg-surface"
            }`}
            onClick={() => void loadStudent(s.id)}
            type="button"
          >
            {s.name}
          </button>
        ))}
        {!loading && students.length === 0 ? (
          <p className="text-sm font-bold text-muted">연결된(active) 학생이 없습니다.</p>
        ) : null}
      </section>

      {studentId && report ? (
        <section className="grid gap-4 lg:grid-cols-[1.4fr_0.6fr]">
          {/* ── 왼쪽: 자동 수집 + 글 세 칸 ── */}
          <div className="grid gap-4">
            {!hasAnyReportContent(report) ? (
              <div className="grid gap-2 rounded-card border border-dashed border-line bg-surface p-6">
                <h2 className="text-base font-extrabold">아직 담을 자동 기록이 없어요</h2>
                <p className="text-sm font-bold text-muted">{describeEmptyReport(report)}</p>
              </div>
            ) : null}

            {/* 요금제 안내 — 무료가 무엇을 못 하는지 명확히 알린다. */}
            <div
              className={`flex flex-wrap items-center justify-between gap-2 rounded-card border p-4 ${
                gating.autoGraphs ? "border-line bg-surface" : "border-line bg-canvas"
              }`}
            >
              <span className="flex items-center gap-2 text-sm font-extrabold text-ink">
                <span
                  className={`rounded-chip px-2 py-1 text-xs font-extrabold ${
                    gating.autoGraphs ? "bg-brand text-surface" : "bg-canvas text-muted"
                  }`}
                >
                  {gating.label}
                </span>
                {gating.notice}
              </span>
              {/*
                "구독 시작" 버튼을 지웠다. /billing 에는 결제 수단이 없어(웹 PG 미연동)
                누르면 상태 표시 화면으로만 이동했다 — 뒤에 결제가 없는 구매 유도 CTA 다.
                요금제 상태 표시(칩 + 안내)는 남는다. /billing 은 좌측 내비게이션으로 여전히
                도달한다 — 새 진입점을 만들지 않았다.
              */}
            </div>

            {/* 수업 회차 — 공개범위 대상이 아니다(과외쌤 자신의 기록). */}
            <div className="grid gap-4 md:grid-cols-2">
              {lessons.state === "value" ? (
                <Card title="이번 달 수업">
                  <p className="font-mono text-3xl font-extrabold text-ink">{describeLessonBlock(lessons.value)}</p>
                  <p className="text-sm font-bold text-muted">
                    {lessons.value.absent > 0
                      ? "결석은 진행 회차에 넣지 않고 따로 적어요."
                      : "과외쌤이 직접 기록한 회차예요."}
                  </p>
                </Card>
              ) : (
                <MetricFallback metric={lessons} title="이번 달 수업" />
              )}
            </div>

            {gating.autoGraphs ? (
            <div className="grid gap-4 md:grid-cols-2">
              {report.studyTime.state === "value" ? (
                <Card
                  title="주간 공부시간 추이"
                  right={
                    report.studyTime.value.deltaMinutes === null ? (
                      <span className="rounded-chip bg-canvas px-2 py-1 text-xs font-bold text-muted">지난주 기록 없음</span>
                    ) : (
                      <span className="rounded-chip bg-canvas px-2 py-1 text-xs font-extrabold text-brand">
                        {report.studyTime.value.deltaMinutes >= 0 ? "+" : ""}
                        {formatHm(Math.abs(report.studyTime.value.deltaMinutes))}
                      </span>
                    )
                  }
                >
                  <p className="font-mono text-lg font-extrabold text-ink">{formatHm(report.studyTime.value.totalMinutes)}</p>
                  <Bars
                    values={report.studyTime.value.trend.map((p) => p.minutes)}
                    labels={report.studyTime.value.trend.map((p) => p.weekStart.slice(5).replace("-", "/"))}
                    tone="brand"
                  />
                </Card>
              ) : (
                <MetricFallback metric={report.studyTime} title="주간 공부시간 추이" />
              )}

              {report.homework.state === "value" ? (
                <Card title="숙제 이행률">
                  <p className="font-mono text-3xl font-extrabold text-brand">
                    {Math.round(report.homework.value.rate * 100)}%
                  </p>
                  <p className="text-sm font-bold text-muted">
                    {report.homework.value.done} / {report.homework.value.total} 완료 / 전체
                  </p>
                </Card>
              ) : (
                <MetricFallback metric={report.homework} title="숙제 이행률" />
              )}

              {report.subjectRates.state === "value" ? (
                <Card title="과목별 수행률">
                  <div className="grid gap-2">
                    {report.subjectRates.value.map((row) => (
                      <div key={row.subject} className="grid gap-1">
                        <div className="flex justify-between text-sm font-bold">
                          <span>{row.label}</span>
                          <span className="font-mono">{Math.round(row.rate * 100)}%</span>
                        </div>
                        <div className="h-2 rounded-chip bg-canvas">
                          <div className="h-2 rounded-chip bg-brand" style={{ width: `${Math.round(row.rate * 100)}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              ) : (
                <MetricFallback metric={report.subjectRates} title="과목별 수행률" />
              )}

              {report.focus.state === "value" ? (
                <Card
                  title="이번 주 집중도"
                  right={
                    <span className="rounded-chip bg-canvas px-2 py-1 text-xs font-bold text-muted">학생 공유 동의</span>
                  }
                >
                  <div className="flex items-baseline gap-3">
                    <p className="font-mono text-3xl font-extrabold text-flame">{report.focus.value.averageScore}%</p>
                    <p className="text-sm font-bold text-muted">
                      졸음 {report.focus.value.drowsyCount}회
                      {report.focus.value.peakHour !== null ? ` · 주로 ${report.focus.value.peakHour}시` : ""}
                    </p>
                  </div>
                  <Bars values={report.focus.value.perDayDrowsy} labels={dayLabels} tone="flame" />
                  <p className="text-xs font-bold text-muted">집중 모드 세션 후 집계 · 실시간 아님</p>
                </Card>
              ) : (
                <MetricFallback metric={report.focus} title="이번 주 집중도" />
              )}
            </div>
            ) : null}

            {/* 시험 기록이 없는 주는 항목 자체를 숨긴다(빈 카드를 늘어놓지 않는다). */}
            {report.exams.length > 0 ? (
              <div className="grid gap-4 md:grid-cols-2">
                {report.exams.map((exam) => (
                  <Card
                    key={exam.subject}
                    title={`${exam.label} 등급 추이`}
                    right={
                      exam.latest.grade !== null ? (
                        <span className="rounded-chip bg-ink px-2 py-1 text-xs font-extrabold text-surface">
                          {exam.latest.grade}등급
                        </span>
                      ) : exam.latest.score !== null ? (
                        <span className="rounded-chip bg-ink px-2 py-1 text-xs font-extrabold text-surface">
                          {exam.latest.score}점
                        </span>
                      ) : null
                    }
                  >
                    <GradeTrend points={exam.points} />
                    <p className="text-xs font-bold text-muted">
                      최근: {exam.latest.exam_name} ({exam.latest.taken_on})
                      {exam.latest.comment ? ` · ${exam.latest.comment}` : ""}
                    </p>
                  </Card>
                ))}
              </div>
            ) : null}

            {/* ── 글 세 칸 (1단계: 과외쌤이 직접 작성) ── */}
            <div className="grid gap-3 rounded-card border border-line bg-surface p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-extrabold">학부모에게 전할 말</h2>
                <span className="rounded-chip bg-canvas px-2 py-1 text-xs font-bold text-muted">
                  AI 초안은 다음 단계
                </span>
              </div>
              {NARRATIVE_FIELDS.map((field) => (
                <label key={field.key} className="grid gap-1">
                  <span className="text-sm font-extrabold text-ink">
                    {field.label}
                    {field.key === "teacherComment" ? <span className="text-danger"> *</span> : null}
                  </span>
                  <textarea
                    className="min-h-20 rounded-control border border-line p-3 text-sm"
                    onChange={(event) => setNarrative((prev) => ({ ...prev, [field.key]: event.target.value }))}
                    placeholder={field.placeholder}
                    value={narrative[field.key]}
                  />
                </label>
              ))}
            </div>
          </div>

          {/* ── 오른쪽: 브랜딩 · 과목 토글 · 회차/시험 입력 · 발송 ── */}
          <div className="grid content-start gap-4">
            {/* 쌤 브랜딩 — 값은 설정 화면이 저장한다. 리포트 상단에 이 이름이 들어간다. */}
            {branding ? (
              <div className="grid gap-2 rounded-card border border-line bg-surface p-5">
                <h3 className="text-sm font-extrabold">쌤 브랜딩</h3>
                <p className="text-xs font-bold text-muted">리포트 상단에 이름·소개가 들어가요.</p>
                <div className="flex items-center gap-3 rounded-control border border-line p-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-control bg-ink text-sm font-extrabold text-surface">
                    {branding.initial}
                  </span>
                  <span className="grid gap-0.5">
                    <span className="text-sm font-extrabold text-ink">
                      {branding.name}
                      {branding.subjectLabel ? ` ${branding.subjectLabel}` : ""}
                    </span>
                    <span className="text-xs font-bold text-muted">{branding.bio ?? "소개가 아직 없어요."}</span>
                  </span>
                </div>
                <a href="/settings" className="text-xs font-extrabold text-brand">
                  설정에서 수정 →
                </a>
              </div>
            ) : null}

            {/* 발급 한도 — 보내려는 순간 막히면 늦으므로 미리 보여준다. */}
            <div className="grid gap-2 rounded-card border border-line bg-surface p-5">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-extrabold">이번 달 리포트</h3>
                <span className={`text-xs font-extrabold ${quota.exceeded ? "text-danger" : "text-muted"}`}>
                  {quota.label}
                </span>
              </div>
              <div className="h-2 rounded-chip bg-canvas">
                <div
                  className={`h-2 rounded-chip ${quota.exceeded ? "bg-danger" : "bg-brand"}`}
                  style={{ width: `${Math.min(100, Math.round((quota.used / quota.quota) * 100))}%` }}
                />
              </div>
              {quota.notice ? (
                <p className={`text-xs font-bold ${quota.exceeded ? "text-danger" : "text-muted"}`}>{quota.notice}</p>
              ) : null}
            </div>

            <div className="grid gap-2 rounded-card border border-line bg-surface p-5">
              <h3 className="text-sm font-extrabold">수업 회차 기록</h3>
              <p className="text-xs font-bold text-muted">
                날짜만 있으면 돼요. 결석도 남겨야 학부모가 알 수 있어요.
              </p>
              <input
                className="rounded-control border border-line px-3 py-2 text-sm"
                onChange={(e) => setLessonForm((f) => ({ ...f, taught_on: e.target.value }))}
                type="date"
                value={lessonForm.taught_on}
              />
              <div className="flex gap-2">
                {LESSON_STATUSES.map((s) => (
                  <button
                    key={s}
                    className={`flex-1 rounded-control px-3 py-2 text-sm font-bold ${
                      lessonForm.status === s ? "bg-brand text-surface" : "border border-line"
                    }`}
                    onClick={() => setLessonForm((f) => ({ ...f, status: s }))}
                    type="button"
                  >
                    {LESSON_STATUS_LABELS[s]}
                  </button>
                ))}
              </div>
              <input
                className="rounded-control border border-line px-3 py-2 text-sm"
                onChange={(e) => setLessonForm((f) => ({ ...f, memo: e.target.value }))}
                placeholder="메모(선택)"
                value={lessonForm.memo}
              />
              <button
                className="rounded-control border border-brand px-4 py-2 text-sm font-extrabold text-brand disabled:opacity-50"
                disabled={busy}
                onClick={() => void addLesson()}
                type="button"
              >
                회차 추가
              </button>
            </div>

            <div className="grid gap-2 rounded-card border border-line bg-surface p-5">
              <h3 className="text-sm font-extrabold">리포트에 넣을 과목</h3>
              {report.availableSubjects.length === 0 ? (
                <p className="text-sm font-bold text-muted">이번 주 담을 과목 데이터가 없어요.</p>
              ) : null}
              {subjectOptions.map((subject) => {
                const available = report.availableSubjects.includes(subject);
                const on = included.includes(subject);
                return (
                  <label
                    key={subject}
                    className={`flex items-center justify-between gap-2 rounded-control border px-3 py-2 text-sm font-bold ${
                      available ? "border-line" : "border-line opacity-50"
                    }`}
                  >
                    <span>
                      {SUBJECT_LABELS[subject]}
                      {available ? "" : <span className="ml-1 text-xs font-bold text-muted">기록 없음</span>}
                    </span>
                    <input
                      checked={on}
                      disabled={!available}
                      onChange={() =>
                        setIncluded((prev) => (on ? prev.filter((s) => s !== subject) : [...prev, subject]))
                      }
                      type="checkbox"
                    />
                  </label>
                );
              })}
            </div>

            <div className="grid gap-2 rounded-card border border-line bg-surface p-5">
              <h3 className="text-sm font-extrabold">시험 기록 추가</h3>
              <p className="text-xs font-bold text-muted">과목·이름·날짜만 있으면 돼요. 점수·등급은 선택이에요.</p>
              <select
                className="rounded-control border border-line px-3 py-2 text-sm"
                onChange={(e) => setExamForm((f) => ({ ...f, subject: e.target.value as SubjectCode }))}
                value={examForm.subject}
              >
                {subjectOptions.map((s) => (
                  <option key={s} value={s}>
                    {SUBJECT_LABELS[s]}
                  </option>
                ))}
              </select>
              <input
                className="rounded-control border border-line px-3 py-2 text-sm"
                onChange={(e) => setExamForm((f) => ({ ...f, exam_name: e.target.value }))}
                placeholder="시험 이름 (예: 6월 모의고사)"
                value={examForm.exam_name}
              />
              <input
                className="rounded-control border border-line px-3 py-2 text-sm"
                onChange={(e) => setExamForm((f) => ({ ...f, taken_on: e.target.value }))}
                type="date"
                value={examForm.taken_on}
              />
              <div className="flex gap-2">
                <input
                  className="w-full rounded-control border border-line px-3 py-2 text-sm"
                  max={9}
                  min={1}
                  onChange={(e) => setExamForm((f) => ({ ...f, grade: e.target.value }))}
                  placeholder="등급(선택)"
                  type="number"
                  value={examForm.grade}
                />
                <input
                  className="w-full rounded-control border border-line px-3 py-2 text-sm"
                  max={100}
                  min={0}
                  onChange={(e) => setExamForm((f) => ({ ...f, score: e.target.value }))}
                  placeholder="점수(선택)"
                  type="number"
                  value={examForm.score}
                />
              </div>
              <input
                className="rounded-control border border-line px-3 py-2 text-sm"
                onChange={(e) => setExamForm((f) => ({ ...f, comment: e.target.value }))}
                placeholder="한 줄 코멘트(선택)"
                value={examForm.comment}
              />
              <button
                className="rounded-control border border-brand px-4 py-2 text-sm font-extrabold text-brand disabled:opacity-50"
                disabled={busy}
                onClick={() => void addExam()}
                type="button"
              >
                시험 기록 추가
              </button>
            </div>

            <div className="grid gap-2 rounded-card border border-line bg-surface p-5">
              <h3 className="text-sm font-extrabold">학부모에게 보내기</h3>
              {!canSendReport(narrative) ? (
                <p className="text-xs font-bold text-muted">선생님 코멘트를 채우면 보낼 수 있어요.</p>
              ) : null}
              {REPORT_DELIVERY_CHANNELS.map((channel) => (
                <button
                  key={channel}
                  className={`rounded-control px-4 py-2 text-sm font-extrabold disabled:opacity-50 ${
                    channel === "link" ? "bg-brand text-surface" : "border border-line text-ink"
                  }`}
                  disabled={busy || !canSendReport(narrative) || quota.exceeded}
                  onClick={() => void saveAndSend(channel)}
                  type="button"
                >
                  {REPORT_DELIVERY_CHANNEL_LABELS[channel]}
                  {isChannelWired(channel) ? "" : " (연동 전 · 상태만 기록)"}
                </button>
              ))}
              {shareLink ? (
                <p className="break-all rounded-control bg-canvas p-3 text-xs font-bold text-brand">
                  학부모 공유 링크: {shareLink}
                </p>
              ) : null}
              {deliveries.length > 0 ? (
                <div className="grid gap-1 border-t border-line pt-2">
                  {deliveries.map((d, index) => (
                    <p key={index} className="text-xs font-bold text-muted">
                      {REPORT_DELIVERY_CHANNEL_LABELS[d.channel as ReportDeliveryChannel]} ·{" "}
                      {REPORT_DELIVERY_STATUS_LABELS[d.status as keyof typeof REPORT_DELIVERY_STATUS_LABELS]}
                      {d.error ? ` — ${d.error}` : ""}
                    </p>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      {studentId && history.length > 0 ? (
        <section className="grid gap-2">
          <h2 className="text-base font-extrabold">리포트 히스토리</h2>
          {history.map((r) => (
            <div
              key={r.id}
              className="flex items-center justify-between rounded-control border border-line bg-surface px-4 py-3 text-sm"
            >
              <span className="font-bold">
                {r.period_start} ~ {r.period_end} · {r.status === "sent" ? "발송됨" : "초안"}
              </span>
              <span className="flex items-center gap-2 font-bold text-muted">
                {r.share_token ? (isShareExpired(r.share_expires_at) ? "링크 만료" : "링크 활성") : "링크 없음"}
                {/* 링크가 잘못 퍼졌을 때 회수할 수단. 없으면 만료(90일)를 기다리는 것 말고 할 게 없다. */}
                {r.share_token && !isShareExpired(r.share_expires_at) ? (
                  <button
                    className="rounded-control border border-line px-2 py-1 text-xs font-bold text-danger disabled:opacity-50"
                    disabled={busy}
                    onClick={() => void revokeShare(r.id)}
                    type="button"
                  >
                    링크 끊기
                  </button>
                ) : null}
              </span>
            </div>
          ))}
        </section>
      ) : null}

      {studentId && student ? (
        <p className="text-xs font-bold text-muted">
          {student.name} · 이 리포트는 학생이 공개한 항목만 담아요. 공개 범위는 학생만 바꿀 수 있어요.
        </p>
      ) : null}
    </TeacherShell>
  );
}
