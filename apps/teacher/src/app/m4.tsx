"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";

import {
  HOMEWORK_REVIEW_STATUS_LABELS,
  HOMEWORK_VERDICT_LABELS,
  SUBJECT_LABELS,
  createTeacherReviewPatch,
  getHomeworkConfidencePercent,
  summarizeReviewQueue,
  type HomeworkVerdict,
  type HomeworkVerdictTone
} from "@ssamplanner/shared";
import type { Database, SubjectCode } from "@ssamplanner/shared";

import { TeacherShell, type TeacherShellData } from "./m1";
import { supabase } from "./supabaseClient";

type SubmissionRow = Database["public"]["Tables"]["homework_submissions"]["Row"];
type TodoRow = Database["public"]["Tables"]["todos"]["Row"];
type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];

type ReviewItem = SubmissionRow & {
  todoTitle: string;
  todoSubject: SubjectCode | null;
  studentName: string;
};

const VERDICT_TONES: Record<HomeworkVerdict, HomeworkVerdictTone> = {
  pass: "success",
  insufficient: "danger",
  ambiguous: "warning"
};

export function TeacherHomeworkReview() {
  const [session, setSession] = useState<Session | null>(null);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [comments, setComments] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("세션 확인 중");

  const refresh = useCallback(async () => {
    setLoading(true);
    const activeSession = (await supabase.auth.getSession()).data.session;
    setSession(activeSession);
    if (!activeSession) {
      setItems([]);
      setMessage("로그인이 필요합니다.");
      setLoading(false);
      return;
    }

    // RLS subs_teacher_read: active 연결 + 학생이 사진 공개(share_homework_photos)한 제출만 보인다.
    const submissionResult = await supabase
      .from("homework_submissions")
      .select("*")
      .order("submitted_at", { ascending: false })
      .limit(50);

    const submissions = submissionResult.data ?? [];
    const todoIds = [...new Set(submissions.map((s) => s.todo_id))];
    const studentIds = [...new Set(submissions.map((s) => s.student_id))];

    const [todosResult, profilesResult] = await Promise.all([
      todoIds.length
        ? supabase.from("todos").select("id, title, subject").in("id", todoIds)
        : Promise.resolve({ data: [] as Pick<TodoRow, "id" | "title" | "subject">[] }),
      studentIds.length
        ? supabase.from("profiles").select("id, name").in("id", studentIds)
        : Promise.resolve({ data: [] as Pick<ProfileRow, "id" | "name">[] })
    ]);

    const todoById = new Map((todosResult.data ?? []).map((t) => [t.id, t]));
    const nameById = new Map((profilesResult.data ?? []).map((p) => [p.id, p.name]));

    setItems(
      submissions.map((submission) => ({
        ...submission,
        todoTitle: todoById.get(submission.todo_id)?.title ?? "숙제",
        todoSubject: (todoById.get(submission.todo_id)?.subject ?? null) as SubjectCode | null,
        studentName: nameById.get(submission.student_id) ?? "학생"
      }))
    );
    setMessage(submissionResult.error?.message ?? "");
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const summary = useMemo(
    () => summarizeReviewQueue(items.map((item) => ({ ai_verdict: item.ai_verdict as HomeworkVerdict | null, teacher_status: item.teacher_status }))),
    [items]
  );

  async function review(item: ReviewItem, action: "confirm" | "reject") {
    const patch = createTeacherReviewPatch(action, comments[item.id]);
    const { error } = await supabase.from("homework_submissions").update(patch).eq("id", item.id);
    setMessage(error ? error.message : action === "confirm" ? "확인 처리했습니다." : "다시 제출을 요청했습니다.");
    if (!error) await refresh();
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
      active="/homework/review"
      title="숙제 검사"
      subtitle="채점이 아니라 “다 했는지” 확인이에요. 학생이 사진을 공개한 제출만 보입니다."
      data={shellData}
      actions={
        <a href="/homework/new" className="rounded-button bg-brand px-4 py-2 text-sm font-extrabold text-white">
          + 숙제 내기
        </a>
      }
    >
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SummaryCard label="확인 대기" value={summary.awaitingTeacher} tone="warning" />
        <SummaryCard label="통과" value={summary.pass} tone="success" />
        <SummaryCard label="미흡" value={summary.insufficient} tone="danger" />
        <SummaryCard label="애매" value={summary.ambiguous} tone="warning" />
      </section>

      <section className="flex flex-col gap-4">
          {!loading && items.length === 0 ? (
            <div className="rounded-card border border-line bg-surface p-6 text-sm font-bold text-muted">
              아직 검사할 제출이 없습니다.
            </div>
          ) : null}

          {items.map((item) => {
            const verdict = item.ai_verdict as HomeworkVerdict | null;
            const confidence = getHomeworkConfidencePercent(item.ai_confidence);
            return (
              <article key={item.id} className="grid gap-3 rounded-card border border-line bg-surface p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-base font-extrabold">{item.todoTitle}</p>
                    <p className="text-sm font-bold text-muted">
                      {item.studentName}
                      {item.todoSubject ? ` · ${SUBJECT_LABELS[item.todoSubject]}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {verdict ? <VerdictBadge verdict={verdict} /> : <span className="text-sm font-bold text-muted">검사 대기</span>}
                    {confidence !== null ? (
                      <span className="font-mono text-sm font-bold text-muted">확신도 {confidence}%</span>
                    ) : null}
                  </div>
                </div>

                {item.ai_reason ? <p className="text-sm font-semibold text-ink">{item.ai_reason}</p> : null}

                <p className="text-xs font-bold text-muted">
                  현재 상태: {HOMEWORK_REVIEW_STATUS_LABELS[item.teacher_status]}
                  {item.teacher_comment ? ` · “${item.teacher_comment}”` : ""}
                </p>

                <label className="grid gap-1">
                  <span className="text-xs font-bold text-muted">한 줄 코멘트(선택)</span>
                  <input
                    className="rounded-control border border-line px-3 py-2 text-sm"
                    onChange={(event) => setComments((prev) => ({ ...prev, [item.id]: event.target.value }))}
                    placeholder="예: p.118 풀이를 마저 채워볼까요"
                    value={comments[item.id] ?? ""}
                  />
                </label>

                <div className="flex flex-wrap gap-2">
                  <button
                    className="rounded-control bg-brand px-4 py-2 text-sm font-bold text-surface"
                    onClick={() => void review(item, "confirm")}
                    type="button"
                  >
                    확인 완료
                  </button>
                  <button
                    className="rounded-control border border-danger px-4 py-2 text-sm font-bold text-danger"
                    onClick={() => void review(item, "reject")}
                    type="button"
                  >
                    다시 제출 요청
                  </button>
                </div>
              </article>
            );
          })}
      </section>

      {!session && !loading ? (
        <p className="text-sm font-bold text-muted">로그인 후 연결된 학생의 검사 큐를 볼 수 있습니다.</p>
      ) : null}
    </TeacherShell>
  );
}

export function TeacherHomeworkAssign() {
  const [session, setSession] = useState<Session | null>(null);
  const [students, setStudents] = useState<Array<{ connectionId: string; studentId: string; name: string }>>([]);
  const [studentId, setStudentId] = useState("");
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState<SubjectCode>("math");
  const [dueDate, setDueDate] = useState("");
  const [aiCheck, setAiCheck] = useState(true);
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
    const connRes = await supabase
      .from("connections")
      .select("id, student_id")
      .eq("teacher_id", active.user.id)
      .eq("status", "active");
    const conns = connRes.data ?? [];
    const ids = conns.map((c) => c.student_id);
    const profRes = ids.length
      ? await supabase.from("profiles").select("id, name").in("id", ids)
      : { data: [] as Array<{ id: string; name: string }> };
    const nameById = new Map((profRes.data ?? []).map((p) => [p.id, p.name]));
    setStudents(conns.map((c) => ({ connectionId: c.id, studentId: c.student_id, name: nameById.get(c.student_id) ?? "학생" })));
    setMessage(connRes.error?.message ?? "");
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function assign() {
    if (!session || !studentId) return;
    const conn = students.find((s) => s.studentId === studentId);
    if (!conn) return;
    if (!title.trim()) {
      setMessage("숙제 제목을 입력해 주세요.");
      return;
    }
    // teacher-todo: todos_teacher_rw 정책(active 연결)으로 허용. 학생은 잠금(locked).
    const { error } = await supabase.from("todos").insert({
      student_id: studentId,
      connection_id: conn.connectionId,
      source: "teacher",
      title: title.trim(),
      subject,
      due_date: dueDate.trim() || null,
      ai_check_enabled: aiCheck,
      locked: true,
      status: "todo",
      created_by: session.user.id
    });
    setMessage(error ? error.message : "숙제를 출제했어요.");
    if (!error) setTitle("");
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
      active="/homework/review"
      title="숙제 출제"
      subtitle="연결된 학생에게 숙제를 내요. AI 완료검사 여부는 출제할 때 정해요(학생은 잠금)."
      data={shellData}
    >
      <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <section className="grid gap-3 rounded-card border border-line bg-surface p-5">
          <h2 className="text-base font-extrabold">학생 선택</h2>
          <div className="flex flex-wrap gap-2">
            {students.map((s) => (
              <button
                key={s.studentId}
                type="button"
                onClick={() => setStudentId(s.studentId)}
                className={`whitespace-nowrap rounded-control px-3 py-2 text-sm font-bold ${
                  studentId === s.studentId ? "bg-brand text-white" : "border border-line bg-surface"
                }`}
              >
                {s.name}
              </button>
            ))}
            {!loading && students.length === 0 ? (
              <p className="text-sm font-bold text-muted">연결된(active) 학생이 없어요.</p>
            ) : null}
          </div>
        </section>

        <section className="grid gap-3 rounded-card border border-line bg-surface p-5">
          <h2 className="text-base font-extrabold">숙제 내용</h2>
          <label className="grid gap-1">
            <span className="text-xs font-bold text-muted">제목</span>
            <input
              className="rounded-control border border-line px-3 py-2 text-sm"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="예: 쌤 B단계 p.112~118"
            />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-bold text-muted">과목</span>
            <select
              className="rounded-control border border-line px-3 py-2 text-sm"
              value={subject}
              onChange={(e) => setSubject(e.target.value as SubjectCode)}
            >
              {(Object.keys(SUBJECT_LABELS) as SubjectCode[]).map((s) => (
                <option key={s} value={s}>
                  {SUBJECT_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-bold text-muted">마감일(선택)</span>
            <input
              className="rounded-control border border-line px-3 py-2 text-sm"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              placeholder="YYYY-MM-DD"
            />
          </label>
          <label className="flex items-center justify-between rounded-control bg-canvas px-3 py-2">
            <span className="text-sm font-bold">AI 완료검사 (출제 시 결정 · 학생 잠금)</span>
            <input type="checkbox" checked={aiCheck} onChange={(e) => setAiCheck(e.target.checked)} />
          </label>
          <button
            type="button"
            disabled={!studentId || !title.trim()}
            onClick={() => void assign()}
            className="rounded-control bg-brand px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            숙제 출제하기
          </button>
        </section>
      </div>
    </TeacherShell>
  );
}

function VerdictBadge({ verdict }: { verdict: HomeworkVerdict }) {
  const tone = VERDICT_TONES[verdict];
  const toneClass =
    tone === "success"
      ? "bg-success/10 text-success"
      : tone === "danger"
        ? "bg-danger/10 text-danger"
        : "bg-warning/10 text-warning";
  return <span className={`rounded-chip px-3 py-1 text-sm font-extrabold ${toneClass}`}>{HOMEWORK_VERDICT_LABELS[verdict]}</span>;
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone: HomeworkVerdictTone }) {
  const toneClass = tone === "success" ? "text-success" : tone === "danger" ? "text-danger" : "text-warning";
  return (
    <div className="rounded-card border border-line bg-surface p-4">
      <p className="text-xs font-bold text-muted">{label}</p>
      <p className={`font-mono text-2xl font-extrabold ${toneClass}`}>{value}</p>
    </div>
  );
}
