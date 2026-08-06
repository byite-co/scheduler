"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";

import {
  AI_CHECK_PAUSED_TEACHER_NOTICE,
  AI_CHECK_RESULTS_ENABLED,
  HOMEWORK_REVIEW_STATUS_LABELS,
  HOMEWORK_VERDICT_LABELS,
  SUBJECT_LABELS,
  TODO_SCOPE_TEXT_ERROR_MESSAGES,
  TODO_SCOPE_TEXT_MAX_LENGTH,
  countTodoScopeTextLength,
  createTeacherReviewPatch,
  getHomeworkAiDisplay,
  getTodoScopeTextForDisplay,
  isTodoScopeTextRequired,
  normalizeTodoScopeText,
  summarizeReviewQueue,
  validateTodoScopeTextForSave,
  type HomeworkVerdict,
  type HomeworkVerdictTone
} from "@ssamplanner/shared";
import type { Database, SubjectCode } from "@ssamplanner/shared";

import { ClipboardCheck } from "lucide-react";

import { EmptyStatePanel, TeacherShell, type TeacherShellData } from "./m1";
import { supabase } from "./supabaseClient";

type SubmissionRow = Database["public"]["Tables"]["homework_submissions"]["Row"];
type TodoRow = Database["public"]["Tables"]["todos"]["Row"];
type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];

type ReviewItem = SubmissionRow & {
  todoTitle: string;
  todoScopeText: string;
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
        ? supabase.from("todos").select("id, title, subject, scope_text").in("id", todoIds)
        : Promise.resolve({ data: [] as Pick<TodoRow, "id" | "title" | "subject" | "scope_text">[] }),
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
        // 검사자는 "무엇을 하기로 했는지"를 봐야 한다. 제목과 범위를 분리한 뒤로는
        // 제목만 보면 범위를 알 수 없으므로 여기서도 함께 보여준다.
        todoScopeText: (() => {
          const todo = todoById.get(submission.todo_id);
          return todo ? getTodoScopeTextForDisplay(todo) : "";
        })(),
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
      {/* 통과·미흡·애매는 AI 판정 집계다 — 판정을 가릴 때는 이것도 같이 가려야 한다.
          카드만 남기고 숫자를 0 으로 두면 "전부 통과 0건" 으로 잘못 읽힌다. */}
      {AI_CHECK_RESULTS_ENABLED ? (
        <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <SummaryCard label="확인 대기" value={summary.awaitingTeacher} tone="warning" />
          <SummaryCard label="통과" value={summary.pass} tone="success" />
          <SummaryCard label="미흡" value={summary.insufficient} tone="danger" />
          <SummaryCard label="애매" value={summary.ambiguous} tone="warning" />
        </section>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <SummaryCard label="확인 대기" value={summary.awaitingTeacher} tone="warning" />
          </section>
          <p className="rounded-card border border-line bg-surface px-4 py-3 text-sm font-bold text-muted">
            {AI_CHECK_PAUSED_TEACHER_NOTICE}
          </p>
        </>
      )}

      <section className="flex flex-col gap-4">
          {!loading && items.length === 0 ? (
            <EmptyStatePanel
              icon={<ClipboardCheck className="h-6 w-6 text-brand" strokeWidth={2} />}
              title="아직 검사할 제출이 없어요"
              body="학생이 숙제 사진을 공개하면 여기에서 ‘다 했는지’ 확인할 수 있어요. 숙제를 내면 학생에게 알림이 가요."
              ctaHref="/homework/new"
              ctaLabel="숙제 내기"
            />
          ) : null}

          {items.map((item) => {
            // 관문을 shared 헬퍼로 둔다. show: false 면 verdict·확신도·사유가 애초에 담기지
            // 않아서, 아래 JSX 에서 조건을 빠뜨려도 노출될 값이 없다.
            const ai = getHomeworkAiDisplay(
              {
                ai_verdict: item.ai_verdict as HomeworkVerdict | null,
                ai_confidence: item.ai_confidence,
                ai_reason: item.ai_reason
              },
              { aiResultsEnabled: AI_CHECK_RESULTS_ENABLED }
            );
            return (
              <article key={item.id} className="grid gap-3 rounded-card border border-line bg-surface p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-base font-extrabold">{item.todoTitle}</p>
                    {item.todoScopeText && item.todoScopeText !== item.todoTitle ? (
                      <p className="text-sm font-bold text-ink">
                        <span className="text-muted">검사 범위 · </span>
                        {item.todoScopeText}
                      </p>
                    ) : null}
                    <p className="text-sm font-bold text-muted">
                      {item.studentName}
                      {item.todoSubject ? ` · ${SUBJECT_LABELS[item.todoSubject]}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {ai.show ? (
                      <>
                        {ai.verdict ? (
                          <VerdictBadge verdict={ai.verdict} />
                        ) : (
                          <span className="text-sm font-bold text-muted">검사 대기</span>
                        )}
                        {ai.confidencePercent !== null ? (
                          <span className="font-mono text-sm font-bold text-muted">확신도 {ai.confidencePercent}%</span>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </div>

                {/* 버킷이 private 이라 서명 URL 이 필요하다. 발급 권한은 Storage 정책
                    homework_photos_teacher_select 가 결정한다 — active 연결 +
                    share_homework_photos 로 subs_teacher_read 와 같은 조건이다.
                    공개범위가 꺼져 있으면 여기서 URL 이 발급되지 않아 사진이 안 보인다. */}
                <SubmissionPhotos paths={item.photo_paths} />

                {ai.show && ai.reason ? <p className="text-sm font-semibold text-ink">{ai.reason}</p> : null}

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
  // AI 완료검사가 제출 사진과 대조할 범위 원문. title(목록에 보이는 숙제 이름)과 별개 컬럼이다.
  const [scopeText, setScopeText] = useState("");
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
    // 범위 규칙은 DB(todos_scope_text_len + 정규화 트리거)에도 걸려 있지만, 저장 전에
    // 사용자가 알아야 하므로 shared 헬퍼로 같은 규칙을 앱에서 먼저 검사한다.
    const scopeError = validateTodoScopeTextForSave(scopeText, { aiCheckEnabled: aiCheck });
    if (scopeError) {
      setMessage(TODO_SCOPE_TEXT_ERROR_MESSAGES[scopeError]);
      return;
    }
    // teacher-todo: todos_teacher_rw 정책(active 연결)으로 허용. 학생은 잠금(locked).
    const { error } = await supabase.from("todos").insert({
      student_id: studentId,
      connection_id: conn.connectionId,
      source: "teacher",
      title: title.trim(),
      scope_text: normalizeTodoScopeText(scopeText),
      subject,
      due_date: dueDate.trim() || null,
      ai_check_enabled: aiCheck,
      locked: true,
      status: "todo",
      created_by: session.user.id
    });
    setMessage(error ? error.message : "숙제를 출제했어요.");
    if (!error) {
      setTitle("");
      setScopeText("");
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

  // 범위 검증은 shared 헬퍼로만 판단한다 — DB 제약과 규칙이 갈라지지 않게.
  const scopeRequired = isTodoScopeTextRequired({ aiCheckEnabled: aiCheck });
  const scopeCount = countTodoScopeTextLength(scopeText);
  const scopeSaveError = validateTodoScopeTextForSave(scopeText, { aiCheckEnabled: aiCheck });
  // 비어 있는데 필수인 경우는 라벨의 '(필수)'와 버튼 비활성으로 알린다 — 타이핑 전부터
  // 빨간 오류를 띄우면 잔소리처럼 보인다. 길이 초과만 인라인으로 표시한다.
  const scopeTooLong = scopeSaveError === "scope_text_too_long";

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
              // 범위를 제목에 적지 않도록 유도한다 — 예전 placeholder("쌤 B단계 p.112~118")가
              // 범위를 제목에 섞어 넣게 만든 원인이었다. 카탈로그 B4 의 제목 예시를 따른다.
              placeholder="예: 미적분 단원 마무리 — 쎈 C단계"
            />
          </label>
          {/* 카탈로그 B4: '숙제 내용'(제목) 바로 아래 "범위 지정 · AI 완료검사 기준이 됩니다". */}
          <label className="grid gap-1">
            <span className="text-xs font-bold text-muted">
              범위 지정 <span className="text-brand">· AI 완료검사 기준이 됩니다</span>{" "}
              {scopeRequired ? <span className="text-brand">(필수)</span> : <span>(선택)</span>}
            </span>
            <input
              className={`rounded-control border px-3 py-2 text-sm ${scopeTooLong ? "border-danger" : "border-line"}`}
              value={scopeText}
              onChange={(e) => setScopeText(e.target.value)}
              placeholder="예: 쎈 112-118p, 115 제외"
            />
            <span className="text-xs font-bold text-muted">
              제목과 달리 <b>AI 가 제출 사진과 대조하는 기준</b>이에요. 교재·페이지·문제번호를 적어 주세요.
            </span>
            {scopeTooLong ? (
              <span className="text-xs font-bold text-danger">
                {TODO_SCOPE_TEXT_ERROR_MESSAGES.scope_text_too_long}
              </span>
            ) : scopeCount > TODO_SCOPE_TEXT_MAX_LENGTH * 0.8 ? (
              <span className="text-xs font-bold text-muted">
                공백 제외 {scopeCount} / {TODO_SCOPE_TEXT_MAX_LENGTH}자
              </span>
            ) : null}
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
            disabled={!studentId || !title.trim() || Boolean(scopeSaveError)}
            onClick={() => void assign()}
            className="rounded-control bg-brand px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            숙제 출제하기
          </button>
          {scopeSaveError === "scope_text_required" ? (
            <p className="text-xs font-bold text-muted">
              {TODO_SCOPE_TEXT_ERROR_MESSAGES.scope_text_required} AI 검사가 필요 없으면 위 토글을 끄세요.
            </p>
          ) : null}
        </section>
      </div>
    </TeacherShell>
  );
}

// 비공개 버킷의 사진을 서명 URL 로 보여준다. 발급 자체가 권한 검사다 —
// Storage 정책(active 연결 + share_homework_photos)을 통과하지 못하면 URL 이 안 나온다.
function SubmissionPhotos({ paths }: { paths: string[] }) {
  const [urls, setUrls] = useState<string[]>([]);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (paths.length === 0) return;
      const { data, error } = await supabase.storage
        .from("homework-photos")
        .createSignedUrls(paths, 600);
      if (cancelled) return;
      const signed = (data ?? [])
        .map((item) => item.signedUrl)
        .filter((url): url is string => Boolean(url));
      setUrls(signed);
      // 공개범위가 꺼져 있으면 서명 URL 이 하나도 안 나온다.
      setBlocked(Boolean(error) || signed.length === 0);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [paths]);

  if (paths.length === 0) return null;
  if (blocked) {
    return (
      <p className="text-xs font-bold text-muted">
        사진 {paths.length}장 — 학생이 사진 공개를 꺼 두어 볼 수 없어요.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      {urls.map((url, index) => (
        <img
          key={url}
          src={url}
          alt={`제출 사진 ${index + 1}`}
          className="h-28 w-28 rounded-control border border-line object-cover"
        />
      ))}
    </div>
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
