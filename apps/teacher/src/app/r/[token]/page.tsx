"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

import { SUBJECT_LABELS, getSharedReportStatusCopy, type SharedReportStatus } from "@ssamplanner/shared";
import type { SubjectCode } from "@ssamplanner/shared";

import { supabase } from "../../supabaseClient";

type SharedReport = {
  id: string;
  type: string;
  period_start: string;
  period_end: string;
  data: { totalMinutes?: number } | null;
  ai_draft: string | null;
  teacher_comment: string | null;
  included_subjects: SubjectCode[] | null;
  sent_at: string | null;
};

type SharedResult = { status: SharedReportStatus; report?: SharedReport };

export default function ParentReportPage() {
  const params = useParams<{ token: string }>();
  const token = typeof params.token === "string" ? params.token : "";
  const [result, setResult] = useState<SharedResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      // 학부모는 로그인 없이 토큰으로만 조회한다(정의자 RPC가 만료/유효 검증 + 조회 기록).
      const { data, error } = await supabase.rpc("get_shared_report", { p_token: token });
      if (cancelled) return;
      setResult(error ? { status: "not_found" } : (data as unknown as SharedResult));
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (loading) {
    return <Shell title="리포트 불러오는 중" body="잠시만 기다려 주세요." />;
  }

  const status = result?.status ?? "not_found";
  const copy = getSharedReportStatusCopy(status);

  if (status !== "ok" || !result?.report) {
    return <Shell title={copy.title} body={copy.body} />;
  }

  const report = result.report;
  const totalMinutes = report.data?.totalMinutes ?? 0;

  return (
    <main className="min-h-screen bg-canvas text-ink">
      <div className="mx-auto grid w-full max-w-2xl gap-5 px-4 py-8">
        <header className="grid gap-1 border-b border-line pb-5">
          <p className="text-base font-extrabold text-brand">쌤플래너</p>
          <h1 className="mt-2 text-2xl font-extrabold">
            {report.period_start} ~ {report.period_end} 주간 리포트
          </h1>
          <p className="text-sm font-bold text-muted">{copy.body}</p>
        </header>

        <section className="rounded-card border border-line bg-surface p-5">
          <p className="font-mono text-lg font-extrabold">
            이번 주 공부 {Math.floor(totalMinutes / 60)}시간 {totalMinutes % 60}분
          </p>
          {report.included_subjects && report.included_subjects.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {report.included_subjects.map((subject) => (
                <span key={subject} className="rounded-chip border border-line px-3 py-1 text-sm font-bold">
                  {SUBJECT_LABELS[subject]}
                </span>
              ))}
            </div>
          ) : null}
        </section>

        {report.teacher_comment ? (
          <section className="rounded-card border border-line bg-surface p-5">
            <h2 className="text-base font-extrabold">선생님 코멘트</h2>
            <p className="mt-2 text-sm font-semibold leading-6 text-ink">{report.teacher_comment}</p>
          </section>
        ) : null}

        <p className="text-center text-xs font-bold text-muted">쌤플래너 · 인증 없이 이 링크로만 열람돼요</p>
      </div>
    </main>
  );
}

function Shell({ title, body }: { title: string; body: string }) {
  return (
    <main className="grid min-h-screen place-items-center bg-canvas px-4 text-ink">
      <div className="grid max-w-md gap-2 rounded-card border border-line bg-surface p-8 text-center">
        <h1 className="text-xl font-extrabold">{title}</h1>
        <p className="text-sm font-bold text-muted">{body}</p>
      </div>
    </main>
  );
}
