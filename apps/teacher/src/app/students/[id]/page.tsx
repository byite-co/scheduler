"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import type { Session } from "@supabase/supabase-js";

import { SUBJECT_LABELS, aggregateWeeklyStudy } from "@ssamplanner/shared";
import type { Database, SubjectCode } from "@ssamplanner/shared";

import { ClipboardList, FileText, ListTodo } from "lucide-react";

import { EmptyStatePanel, TeacherShell, type TeacherShellData } from "../../m1";
import { supabase } from "../../supabaseClient";

type TodoRow = Database["public"]["Tables"]["todos"]["Row"];
type ReportRow = Database["public"]["Tables"]["reports"]["Row"];
type TeacherSessionRow = Database["public"]["Views"]["v_teacher_study_sessions"]["Row"];

type Tab = "plan" | "records" | "weakness" | "reports";

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "plan", label: "플랜·숙제" },
  { key: "records", label: "기록" },
  { key: "weakness", label: "약점" },
  { key: "reports", label: "리포트" }
];

function weekStartKey(): string {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  return start.toISOString().slice(0, 10);
}

export default function StudentDetailPage() {
  const params = useParams<{ id: string }>();
  const studentId = typeof params.id === "string" ? params.id : "";
  const [tab, setTab] = useState<Tab>("plan");
  const [session, setSession] = useState<Session | null>(null);
  const [name, setName] = useState("학생");
  const [todos, setTodos] = useState<TodoRow[]>([]);
  const [sessions, setSessions] = useState<TeacherSessionRow[]>([]);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("불러오는 중");

  const refresh = useCallback(async () => {
    setLoading(true);
    const active = (await supabase.auth.getSession()).data.session;
    setSession(active);
    if (!active || !studentId) {
      setMessage(active ? "학생을 찾을 수 없어요." : "로그인이 필요합니다.");
      setLoading(false);
      return;
    }
    const since = `${weekStartKey()}T00:00:00.000Z`;
    // 모두 기존 RLS/공개범위 게이팅 안에서 읽기만 한다(데이터·정책 무변경).
    const [profileRes, todoRes, sessionRes, reportRes] = await Promise.all([
      supabase.from("profiles").select("name").eq("id", studentId).maybeSingle(),
      supabase.from("todos").select("*").eq("student_id", studentId).order("created_at", { ascending: false }).limit(50),
      supabase.from("v_teacher_study_sessions").select("*").eq("student_id", studentId).gte("started_at", since),
      supabase.from("reports").select("*").eq("student_id", studentId).order("created_at", { ascending: false }).limit(10)
    ]);
    setName(profileRes.data?.name ?? "학생");
    setTodos(todoRes.data ?? []);
    setSessions(sessionRes.data ?? []);
    setReports(reportRes.data ?? []);
    setMessage(todoRes.error?.message ?? "");
    setLoading(false);
  }, [studentId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const aggregate = useMemo(
    () =>
      aggregateWeeklyStudy(
        sessions.map((s) => ({ subject: s.subject, duration_sec: s.duration_sec ?? 0, started_at: s.started_at ?? `${weekStartKey()}T00:00:00.000Z` })),
        weekStartKey()
      ),
    [sessions]
  );

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

  const weakest = aggregate.perSubjectMinutes.length
    ? aggregate.perSubjectMinutes[aggregate.perSubjectMinutes.length - 1]
    : null;

  return (
    <TeacherShell
      active="/students"
      title={name}
      subtitle="학생 상세 — 공개 범위 안에서만 보여요."
      data={shellData}
      actions={
        <a href="/homework/new" className="rounded-button bg-brand px-4 py-2 text-sm font-extrabold text-white">
          + 숙제 내기
        </a>
      }
    >
      <div className="flex flex-wrap gap-2 border-b border-line pb-3">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={`rounded-control px-3 py-2 text-sm font-bold ${
              tab === item.key ? "bg-brand text-white" : "text-muted hover:bg-canvas hover:text-ink"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "plan" ? (
        <section className="grid gap-2">
          {todos.length === 0 ? (
            <EmptyStatePanel
              icon={<ListTodo className="h-6 w-6 text-brand" strokeWidth={2} />}
              title="아직 등록된 할 일·숙제가 없어요"
              body="‘+ 숙제 내기’로 이 학생에게 숙제를 내면 여기 플랜·숙제에 쌓여요."
              ctaHref="/homework/new"
              ctaLabel="숙제 내기"
            />
          ) : (
            todos.map((todo) => (
              <div
                key={todo.id}
                className="flex items-center justify-between gap-3 rounded-control border border-line bg-surface px-4 py-3 text-sm"
              >
                <span className="font-bold">{todo.title}</span>
                <span className="flex items-center gap-2">
                  {todo.subject ? (
                    <span className="rounded-chip bg-canvas px-2 py-0.5 text-xs font-bold text-muted">
                      {SUBJECT_LABELS[todo.subject as SubjectCode]}
                    </span>
                  ) : null}
                  <span className="rounded-chip bg-canvas px-2 py-0.5 text-xs font-bold text-muted">
                    {todo.source === "teacher" ? "숙제" : "개인"}
                  </span>
                  <span
                    className={`rounded-chip px-2 py-0.5 text-xs font-extrabold ${
                      todo.status === "done" ? "bg-success/10 text-success" : "bg-warning/10 text-warning"
                    }`}
                  >
                    {todo.status === "done" ? "완료" : "진행"}
                  </span>
                </span>
              </div>
            ))
          )}
        </section>
      ) : null}

      {tab === "records" ? (
        aggregate.totalMinutes === 0 ? (
          <EmptyStatePanel
            icon={<ClipboardList className="h-6 w-6 text-brand" strokeWidth={2} />}
            title="공개된 공부 기록이 아직 없어요"
            body="학생이 공부 시간을 공개하면 이번 주 요일별 기록이 여기에 표시돼요."
          />
        ) : (
          <section className="grid gap-3 rounded-card border border-line bg-surface p-5 shadow-[0_16px_40px_rgba(22,26,46,0.08)]">
            <p className="font-mono text-lg font-extrabold">
              이번 주 공부 {Math.floor(aggregate.totalMinutes / 60)}시간 {aggregate.totalMinutes % 60}분
            </p>
            <div className="flex items-end gap-1" style={{ height: 96 }}>
              {aggregate.perDayMinutes.map((minutes, index) => {
                const max = Math.max(1, ...aggregate.perDayMinutes);
                return (
                  <div
                    key={["일", "월", "화", "수", "목", "금", "토"][index]}
                    className="flex-1 rounded-t bg-brand"
                    style={{ height: 6 + (minutes / max) * 80 }}
                  />
                );
              })}
            </div>
          </section>
        )
      ) : null}

      {tab === "weakness" ? (
        <section className="grid gap-2 rounded-card border border-line bg-surface p-5">
          <h2 className="text-base font-extrabold">약점 신호</h2>
          {weakest ? (
            <p className="text-sm font-bold text-muted">
              이번 주 가장 적게 한 과목은 <span className="text-ink">{SUBJECT_LABELS[weakest.subject]}</span>({weakest.minutes}분)
              이에요. 숙제로 보완해 보세요.
            </p>
          ) : (
            <p className="text-sm font-bold text-muted">과목별 기록이 모이면 약점을 짚어 드려요.</p>
          )}
        </section>
      ) : null}

      {tab === "reports" ? (
        <section className="grid gap-2">
          {reports.length === 0 ? (
            <EmptyStatePanel
              icon={<FileText className="h-6 w-6 text-brand" strokeWidth={2} />}
              title="아직 발행한 리포트가 없어요"
              body="주간 리포트를 만들면 학부모에게 공유할 수 있어요."
              ctaHref="/reports/weekly"
              ctaLabel="주간 리포트 만들기"
            />
          ) : (
            <>
              <a href="/reports/weekly" className="text-sm font-extrabold text-brand">
                + 주간 리포트 만들기
              </a>
              {reports.map((report) => (
                <div
                  key={report.id}
                  className="flex items-center justify-between rounded-control border border-line bg-surface px-4 py-3 text-sm"
                >
                  <span className="font-bold">
                    {report.period_start} ~ {report.period_end}
                  </span>
                  <span className="font-bold text-muted">{report.status === "sent" ? "발송됨" : "초안"}</span>
                </div>
              ))}
            </>
          )}
        </section>
      ) : null}
    </TeacherShell>
  );
}
