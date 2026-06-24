"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient, type Session } from "@supabase/supabase-js";

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

type SubmissionRow = Database["public"]["Tables"]["homework_submissions"]["Row"];
type TodoRow = Database["public"]["Tables"]["todos"]["Row"];
type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];

type ReviewItem = SubmissionRow & {
  todoTitle: string;
  todoSubject: SubjectCode | null;
  studentName: string;
};

const supabase = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""
);

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
    setMessage(submissionResult.error?.message ?? "검사 큐를 불러왔습니다.");
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
