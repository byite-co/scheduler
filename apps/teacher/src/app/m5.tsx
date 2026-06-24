"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";

import {
  SUBJECT_LABELS,
  aggregateWeeklyStudy,
  getStubReportDraft,
  isShareExpired
} from "@ssamplanner/shared";
import type { Database, SubjectCode } from "@ssamplanner/shared";

import { TeacherShell, type TeacherShellData } from "./m1";
import { supabase } from "./supabaseClient";

type ConnectionRow = Database["public"]["Tables"]["connections"]["Row"];
type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
type ReportRow = Database["public"]["Tables"]["reports"]["Row"];
type TeacherSessionRow = Database["public"]["Views"]["v_teacher_study_sessions"]["Row"];

const subjectOptions = Object.keys(SUBJECT_LABELS) as SubjectCode[];

function weekRange(now: Date): { start: string; end: string } {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export function TeacherReportBuilder() {
  const [session, setSession] = useState<Session | null>(null);
  const [students, setStudents] = useState<ProfileRow[]>([]);
  const [studentId, setStudentId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<TeacherSessionRow[]>([]);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [draft, setDraft] = useState("");
  const [included, setIncluded] = useState<SubjectCode[]>([]);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("세션 확인 중");

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
    const ids = ((connectionResult.data as Pick<ConnectionRow, "student_id">[] | null) ?? []).map((c) => c.student_id);
    const profileResult = ids.length
      ? await supabase.from("profiles").select("*").in("id", ids)
      : { data: [] as ProfileRow[] };
    setStudents(profileResult.data ?? []);
    setMessage(connectionResult.error?.message ?? "연결된 학생을 불러왔습니다.");
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const loadStudent = useCallback(async (id: string) => {
    setStudentId(id);
    setShareLink(null);
    const { start } = weekRange(new Date());
    const [sessionResult, reportResult] = await Promise.all([
      supabase.from("v_teacher_study_sessions").select("*").eq("student_id", id).gte("started_at", `${start}T00:00:00.000Z`),
      supabase.from("reports").select("*").eq("student_id", id).order("created_at", { ascending: false }).limit(10)
    ]);
    setSessions(sessionResult.data ?? []);
    setReports(reportResult.data ?? []);
  }, []);

  const aggregate = useMemo(() => {
    const { start } = weekRange(new Date());
    return aggregateWeeklyStudy(
      sessions.map((s) => ({ subject: s.subject, duration_sec: s.duration_sec ?? 0, started_at: s.started_at ?? `${start}T00:00:00.000Z` })),
      start
    );
  }, [sessions]);

  function generateDraft() {
    const student = students.find((s) => s.id === studentId);
    setDraft(
      getStubReportDraft({
        studentName: student?.name ?? "학생",
        totalMinutes: aggregate.totalMinutes,
        topSubject: aggregate.perSubjectMinutes[0]?.subject ?? null,
        completionRate: 0.8
      })
    );
    setIncluded(aggregate.perSubjectMinutes.map((row) => row.subject));
  }

  async function saveAndShare() {
    if (!session || !studentId) return;
    const { start, end } = weekRange(new Date());
    const inserted = await supabase
      .from("reports")
      .insert({
        student_id: studentId,
        teacher_id: session.user.id,
        type: "weekly",
        period_start: start,
        period_end: end,
        data: { totalMinutes: aggregate.totalMinutes, perDayMinutes: aggregate.perDayMinutes },
        ai_draft: draft,
        teacher_comment: draft,
        included_subjects: included,
        status: "draft"
      })
      .select("id")
      .single();
    if (inserted.error || !inserted.data) {
      setMessage(inserted.error?.message ?? "리포트 저장 실패");
      return;
    }
    const shared = await supabase.rpc("create_report_share", { p_report_id: inserted.data.id, p_ttl_hours: 168 });
    if (shared.error) {
      setMessage(shared.error.message);
      return;
    }
    const token = (shared.data as { token: string }).token;
    setShareLink(`/r/${token}`);
    setMessage("리포트를 저장하고 공유 링크를 발급했습니다.");
    await loadStudent(studentId);
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

  return (
    <TeacherShell
      active="/reports/weekly"
      title="주간 리포트"
      subtitle="이번 주 공부를 모아 학부모에게 보낼 리포트를 만들어요. (공개범위 적용)"
      data={shellData}
    >
      <section className="flex flex-wrap gap-2">
          {students.map((student) => (
            <button
              key={student.id}
              className={`whitespace-nowrap rounded-control px-3 py-2 text-sm font-bold ${
                studentId === student.id ? "bg-brand text-surface" : "border border-line bg-surface"
              }`}
              onClick={() => void loadStudent(student.id)}
              type="button"
            >
              {student.name}
            </button>
          ))}
          {!loading && students.length === 0 ? (
            <p className="text-sm font-bold text-muted">연결된(active) 학생이 없습니다.</p>
          ) : null}
        </section>

        {studentId ? (
          <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="grid gap-3 rounded-card border border-line bg-surface p-5">
              <h2 className="text-base font-extrabold">이번 주 공부 (공개범위 적용)</h2>
              <p className="font-mono text-sm font-bold text-muted">
                총 {Math.floor(aggregate.totalMinutes / 60)}시간 {aggregate.totalMinutes % 60}분
              </p>
              <div className="flex items-end gap-1" style={{ height: 96 }}>
                {aggregate.perDayMinutes.map((minutes, index) => {
                  const max = Math.max(1, ...aggregate.perDayMinutes);
                  return (
                    <div
                      key={index}
                      className="flex-1 rounded-t bg-brand"
                      style={{ height: 6 + (minutes / max) * 80 }}
                      title={`${minutes}분`}
                    />
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-2">
                {aggregate.perSubjectMinutes.map((row) => (
                  <span key={row.subject} className="rounded-chip border border-line px-3 py-1 text-sm font-bold">
                    {SUBJECT_LABELS[row.subject]} {row.minutes}분
                  </span>
                ))}
              </div>
              <button className="rounded-control border border-brand px-4 py-2 text-sm font-bold text-brand" onClick={generateDraft} type="button">
                AI 초안 생성 (미리보기)
              </button>
            </div>

            <div className="grid gap-3 rounded-card border border-line bg-surface p-5">
              <h2 className="text-base font-extrabold">담을 과목 · 코멘트</h2>
              <div className="flex flex-wrap gap-2">
                {subjectOptions.map((subject) => {
                  const on = included.includes(subject);
                  return (
                    <button
                      key={subject}
                      className={`rounded-control px-3 py-1 text-sm font-bold ${on ? "bg-brand text-surface" : "border border-line"}`}
                      onClick={() => setIncluded((prev) => (on ? prev.filter((s) => s !== subject) : [...prev, subject]))}
                      type="button"
                    >
                      {SUBJECT_LABELS[subject]}
                    </button>
                  );
                })}
              </div>
              <textarea
                className="min-h-28 rounded-control border border-line p-3 text-sm"
                onChange={(event) => setDraft(event.target.value)}
                placeholder="AI 초안을 생성하거나 직접 코멘트를 작성하세요."
                value={draft}
              />
              <button className="rounded-control bg-brand px-4 py-2 text-sm font-bold text-surface" onClick={() => void saveAndShare()} type="button">
                저장하고 공유 링크 발급
              </button>
              {shareLink ? (
                <p className="break-all rounded-control bg-canvas p-3 text-sm font-bold text-brand">
                  학부모 공유 링크: {shareLink}
                </p>
              ) : null}
            </div>
          </section>
        ) : null}

        {studentId && reports.length > 0 ? (
          <section className="grid gap-2">
            <h2 className="text-base font-extrabold">리포트 히스토리</h2>
            {reports.map((report) => (
              <div key={report.id} className="flex items-center justify-between rounded-control border border-line bg-surface px-4 py-3 text-sm">
                <span className="font-bold">
                  {report.period_start} ~ {report.period_end} · {report.status === "sent" ? "발송됨" : "초안"}
                </span>
                <span className="font-bold text-muted">
                  {report.share_token
                    ? isShareExpired(report.share_expires_at)
                      ? "링크 만료"
                      : "링크 활성"
                    : "링크 없음"}
                </span>
              </div>
            ))}
          </section>
        ) : null}
    </TeacherShell>
  );
}
