"use client";

// 학부모 웹뷰 (J16) — 카톡 링크를 눌러 **폰으로** 보는 화면.
//
// [로그인 없이 본다] 학부모는 가입하지 않는다. anon 으로 get_shared_report(token) 하나만 부른다.
//   reports 테이블에는 anon 정책이 없어 직접 접근이 안 되고, 이 RPC 가 유일한 통로다.
//
// [스냅샷만 그린다] 값은 전부 발송 시점 reports.data 에서 온다. **실시간 재조회를 하지 않는다** —
//   보낸 뒤 학생 기록이 바뀌어도 학부모가 본 내용은 그대로여야 한다.
//
// [모바일 우선] 과외쌤 웹은 데스크탑 기준이지만 이 화면만은 세로 폰이 기준이다.
//   최대 폭을 좁게 잡고 한 열로 쌓는다. TeacherShell(사이드바)을 쓰지 않는다.

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

import {
  SUBJECT_LABELS,
  buildParentWebviewReport,
  buildWebviewHighlights,
  describeMetricState,
  describeLessonBlock,
  formatReportPeriod,
  getSharedReportStatusCopy,
  type ParentWebviewReport,
  type ReportMetric,
  type SharedReportStatus
} from "@ssamplanner/shared";

import { supabase } from "../../supabaseClient";

type SharedResult = { status: SharedReportStatus; report?: Record<string, unknown> };

const TONE_CLASS = {
  brand: "text-brand",
  success: "text-success",
  flame: "text-flame"
} as const;

function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-3 rounded-card bg-surface p-4">
      {title ? <h2 className="text-sm font-extrabold text-ink">{title}</h2> : null}
      {children}
    </section>
  );
}

/** 값이 없는 항목은 카드를 통째로 안내로 바꾼다. 0 을 그리면 거짓이 된다. */
function Missing({ metric, title }: { metric: ReportMetric<unknown>; title: string }) {
  return (
    <section className="grid gap-1 rounded-card bg-surface p-4">
      <h2 className="text-sm font-extrabold text-ink">{title}</h2>
      <p className="text-sm font-bold text-muted">{describeMetricState(metric.state)}</p>
    </section>
  );
}

function Bars({ values, labels }: { values: number[]; labels: string[] }) {
  const max = Math.max(1, ...values);
  return (
    <div className="grid gap-1">
      <div className="flex items-end gap-1.5" style={{ height: 108 }}>
        {values.map((value, index) => (
          <div key={index} className="flex flex-1 flex-col items-center justify-end gap-1">
            <div
              className={`w-full rounded-t bg-brand ${value === 0 ? "opacity-20" : index === values.length - 1 ? "" : "opacity-40"}`}
              style={{ height: 6 + (value / max) * 84 }}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-1.5">
        {labels.map((label, index) => (
          <span key={index} className="flex-1 text-center text-[10px] font-bold text-muted">
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function ParentReportPage() {
  const params = useParams<{ token: string }>();
  const token = typeof params.token === "string" ? params.token : "";
  const [result, setResult] = useState<SharedResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // 토큰만으로 부른다. 세션이 없어도(로그아웃 상태여도) 열려야 한다.
      const { data, error } = await supabase.rpc("get_shared_report", { p_token: token });
      if (cancelled) return;
      setResult(error ? { status: "not_found" } : (data as SharedResult));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (loading) {
    return (
      <main className="grid min-h-screen place-items-center bg-canvas px-4">
        <p className="text-sm font-bold text-muted">리포트를 불러오는 중이에요…</p>
      </main>
    );
  }

  // 없는 토큰·만료·미발송은 전부 여기로 온다. 어느 쪽인지 구분해 알려주되,
  // "토큰이 존재하는가"는 흘리지 않는다(없는 토큰과 미발송은 같은 응답이다).
  if (!result || result.status !== "ok" || !result.report) {
    const copy = getSharedReportStatusCopy(result?.status ?? "not_found");
    return (
      <main className="grid min-h-screen place-items-center bg-canvas px-4">
        <div className="grid max-w-sm gap-2 rounded-card bg-surface p-6 text-center">
          <h1 className="text-lg font-extrabold text-ink">{copy.title}</h1>
          <p className="text-sm font-bold text-muted">{copy.body}</p>
          {/* 만료 안내에는 이미 "새 링크를 요청" 문구가 들어 있다 — 두 번 적지 않는다. */}
          {result?.status === "expired" ? null : (
            <p className="text-xs font-bold text-muted">보내주신 선생님께 새 링크를 요청해 주세요.</p>
          )}
        </div>
      </main>
    );
  }

  const report: ParentWebviewReport = buildParentWebviewReport(result.report as never);
  const highlights = buildWebviewHighlights(report);
  const dayLabels = ["일", "월", "화", "수", "목", "금", "토"];
  const narrativeCards = [
    { label: "선생님 코멘트", text: report.narrative.teacherComment, tone: "bg-surface" },
    { label: "가정에서 도와주시면", text: report.narrative.homeSupport, tone: "bg-flame/10" },
    { label: "다음 주 방향", text: report.narrative.nextWeekFocus, tone: "bg-success/10" }
  ].filter((c) => c.text.trim().length > 0);

  return (
    // 모바일 우선: 한 열, 좁은 최대 폭. 데스크탑에서는 가운데 정렬된 폰 폭으로 보인다.
    <main className="min-h-screen bg-canvas px-4 py-6">
      <div className="mx-auto grid w-full max-w-md gap-3">
        <header className="grid gap-1 text-center">
          <p className="text-xs font-extrabold text-brand">주간 학습 리포트</p>
          <h1 className="text-xl font-extrabold text-ink">
            {report.studentName} 학생 · {formatReportPeriod(report.periodStart, report.periodEnd)}
          </h1>
          <p className="text-sm font-bold text-muted">
            {report.branding.name} 선생님
            {report.branding.subjectLabel ? ` (${report.branding.subjectLabel})` : ""}
          </p>
        </header>

        {highlights.length > 0 ? (
          <div className="grid grid-cols-3 gap-2">
            {highlights.map((h) => (
              <div key={h.label} className="grid gap-0.5 rounded-card bg-surface px-2 py-3 text-center">
                <span className={`font-mono text-xl font-extrabold ${TONE_CLASS[h.tone]}`}>{h.value}</span>
                <span className="text-[11px] font-bold text-muted">{h.label}</span>
              </div>
            ))}
          </div>
        ) : null}

        {/* 자동 수집이 하나도 없는 리포트(무료 플랜 등)도 정상 화면이어야 한다. */}
        {!report.autoDataAvailable ? (
          <Card>
            <p className="text-sm font-bold text-muted">
              이번 리포트는 선생님이 직접 쓴 기록으로 전해 드려요.
            </p>
          </Card>
        ) : null}

        {report.studyTime ? (
          report.studyTime.state === "value" ? (
            <Card title="주간 공부시간">
              <p className="font-mono text-lg font-extrabold text-ink">
                {Math.floor(report.studyTime.value.totalMinutes / 60)}시간{" "}
                {report.studyTime.value.totalMinutes % 60}분
                {report.studyTime.value.deltaMinutes !== null ? (
                  <span className="ml-2 text-sm font-extrabold text-brand">
                    지난주 대비 {report.studyTime.value.deltaMinutes >= 0 ? "+" : "−"}
                    {Math.round(Math.abs(report.studyTime.value.deltaMinutes) / 60)}시간
                  </span>
                ) : null}
              </p>
              <Bars values={report.studyTime.value.perDayMinutes} labels={dayLabels} />
            </Card>
          ) : (
            <Missing metric={report.studyTime} title="주간 공부시간" />
          )
        ) : null}

        {report.homework ? (
          report.homework.state === "value" ? (
            <Card title="숙제 수행">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-2xl font-extrabold text-success">
                  {Math.round(report.homework.value.rate * 100)}%
                </span>
                <span className="text-sm font-bold text-muted">
                  {report.homework.value.done} / {report.homework.value.total}건 완료
                </span>
              </div>
              <div className="h-2 rounded-chip bg-canvas">
                <div
                  className="h-2 rounded-chip bg-success"
                  style={{ width: `${Math.round(report.homework.value.rate * 100)}%` }}
                />
              </div>
            </Card>
          ) : (
            <Missing metric={report.homework} title="숙제 수행" />
          )
        ) : null}

        {report.subjectRates && report.subjectRates.state === "value" && report.subjectRates.value.length > 0 ? (
          <Card title="과목별 수행률">
            <div className="grid gap-2">
              {report.subjectRates.value.map((row) => (
                <div key={row.subject} className="grid gap-1">
                  <div className="flex justify-between text-sm font-bold text-ink">
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
        ) : null}

        {report.focus && report.focus.state === "value" ? (
          <Card title="집중도">
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-2xl font-extrabold text-flame">{report.focus.value.averageScore}%</span>
              <span className="text-sm font-bold text-muted">
                졸음 {report.focus.value.drowsyCount}회
                {report.focus.value.peakHour !== null ? ` · 주로 ${report.focus.value.peakHour}시` : ""}
              </span>
            </div>
            <p className="text-xs font-bold text-muted">집중 모드 세션 후 집계예요.</p>
          </Card>
        ) : null}

        {report.lessons && report.lessons.state === "value" ? (
          <Card title="이번 달 수업">
            <p className="font-mono text-xl font-extrabold text-ink">{describeLessonBlock(report.lessons.value)}</p>
          </Card>
        ) : null}

        {report.exams.length > 0 ? (
          <Card title="시험 기록">
            <div className="grid gap-2">
              {report.exams.map((exam) => (
                <div key={exam.subject} className="flex items-center justify-between gap-2">
                  <span className="grid gap-0.5">
                    <span className="text-sm font-extrabold text-ink">
                      {SUBJECT_LABELS[exam.subject]} · {exam.latest.exam_name}
                    </span>
                    <span className="text-xs font-bold text-muted">
                      {exam.latest.taken_on}
                      {exam.latest.comment ? ` · ${exam.latest.comment}` : ""}
                    </span>
                  </span>
                  {exam.latest.grade !== null ? (
                    <span className="shrink-0 rounded-chip bg-ink px-2 py-1 text-xs font-extrabold text-surface">
                      {exam.latest.grade}등급
                    </span>
                  ) : exam.latest.score !== null ? (
                    <span className="shrink-0 rounded-chip bg-ink px-2 py-1 text-xs font-extrabold text-surface">
                      {exam.latest.score}점
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          </Card>
        ) : null}

        {narrativeCards.map((card) => (
          <section key={card.label} className={`grid gap-2 rounded-card p-4 ${card.tone}`}>
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-control bg-ink text-xs font-extrabold text-surface">
                {report.branding.initial}
              </span>
              <span className="text-xs font-extrabold text-muted">{card.label}</span>
            </div>
            <p className="whitespace-pre-wrap text-sm font-bold leading-relaxed text-ink">{card.text}</p>
          </section>
        ))}

        <footer className="grid gap-1 py-4 text-center">
          <p className="text-xs font-bold text-muted">쌤플래너 · 영상은 기기를 떠나지 않아요</p>
          <p className="text-[11px] font-bold text-muted">
            학생이 공개한 항목만 담겨 있어요. 이 링크는 보내주신 선생님만 만들 수 있어요.
          </p>
        </footer>
      </div>
    </main>
  );
}
