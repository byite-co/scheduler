"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient, type Session } from "@supabase/supabase-js";

import {
  PRICE_PER_STUDENT_KRW,
  formatKrw,
  getTeacherBillingState,
  getTeacherMonthlySubscriptionAmount,
  summarizeLessonFees,
  type SubStatus
} from "@ssamplanner/shared";
import type { Database } from "@ssamplanner/shared";

type InvoiceRow = Database["public"]["Tables"]["billing_invoices"]["Row"];
type LessonFeeRow = Database["public"]["Tables"]["lesson_fees"]["Row"];

const supabase = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""
);

function currentPeriod(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function TeacherBilling() {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<SubStatus>("none");
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [activeCount, setActiveCount] = useState(0);
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
    const [subResult, invoiceResult, connectionResult] = await Promise.all([
      supabase.from("teacher_subscriptions").select("status").eq("teacher_id", active.user.id).maybeSingle(),
      supabase.from("billing_invoices").select("*").eq("teacher_id", active.user.id).order("issued_at", { ascending: false }),
      supabase.from("connections").select("id").eq("teacher_id", active.user.id).eq("status", "active")
    ]);
    setStatus((subResult.data?.status as SubStatus) ?? "none");
    setInvoices(invoiceResult.data ?? []);
    setActiveCount((connectionResult.data ?? []).length);
    setMessage(invoiceResult.error?.message ?? "결제 정보를 불러왔습니다.");
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const billing = getTeacherBillingState(status);
  const estimated = getTeacherMonthlySubscriptionAmount(activeCount);

  async function setSub(next: SubStatus) {
    const { error } = await supabase.rpc("mock_set_teacher_subscription", { p_status: next });
    setMessage(error ? error.message : `구독 상태를 ${next}로 변경했습니다. (모의 웹훅)`);
    if (!error) await refresh();
  }

  async function generateInvoice() {
    const { error } = await supabase.rpc("generate_teacher_invoice", { p_period: currentPeriod() });
    setMessage(error ? error.message : "이번 달 인보이스를 생성했습니다.");
    if (!error) await refresh();
  }

  const toneClass =
    billing.tone === "success"
      ? "border-success text-success"
      : billing.tone === "danger"
        ? "border-danger text-danger"
        : billing.tone === "warning"
          ? "border-warning text-warning"
          : "border-line text-muted";

  return (
    <main className="min-h-screen bg-canvas text-ink">
      <div className="mx-auto grid w-full max-w-3xl gap-6 px-4 py-6 md:px-8">
        <header className="flex flex-col gap-2 border-b border-line pb-5">
          <p className="text-sm font-extrabold text-brand">구독 · 결제 (앱 구독료)</p>
          <h1 className="text-2xl font-extrabold">앱 구독료</h1>
          <p className="text-sm font-bold text-muted" aria-live="polite">{loading ? "불러오는 중…" : message}</p>
          <p className="text-xs font-bold text-muted">
            ※ 이 구독료는 학생이 내는 <a className="underline" href="/lesson-fees">수업·수업료</a>와 완전히 별개입니다.
          </p>
        </header>

        <section className={`grid gap-2 rounded-card border bg-surface p-5 ${toneClass}`}>
          <p className="text-lg font-extrabold">{billing.label}</p>
          <p className="text-sm font-bold text-muted">{billing.reason}</p>
          <p className="font-mono text-sm font-bold text-ink">
            예상 월 청구 = active {activeCount}명 × {formatKrw(PRICE_PER_STUDENT_KRW)} = {formatKrw(estimated)}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {billing.status === "active" ? (
              <>
                <button className="rounded-control border border-warning px-4 py-2 text-sm font-bold text-warning" onClick={() => void setSub("paused")} type="button">
                  일시정지
                </button>
                <button className="rounded-control border border-danger px-4 py-2 text-sm font-bold text-danger" onClick={() => void setSub("canceled")} type="button">
                  해지
                </button>
              </>
            ) : billing.status === "past_due" ? (
              <button className="rounded-control bg-brand px-4 py-2 text-sm font-bold text-surface" onClick={() => void setSub("active")} type="button">
                결제수단 업데이트로 복구 (모의)
              </button>
            ) : (
              <button className="rounded-control bg-brand px-4 py-2 text-sm font-bold text-surface" onClick={() => void setSub("active")} type="button">
                구독 시작 (모의 결제)
              </button>
            )}
            {billing.status === "active" ? (
              <button className="rounded-control border border-danger px-4 py-2 text-sm font-bold text-danger" onClick={() => void setSub("past_due")} type="button">
                결제 실패 시뮬레이트
              </button>
            ) : null}
          </div>
        </section>

        <section className="grid gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-extrabold">인보이스</h2>
            <button className="rounded-control border border-line px-3 py-2 text-sm font-bold" onClick={() => void generateInvoice()} type="button">
              이번 달 인보이스 생성
            </button>
          </div>
          {invoices.length === 0 ? (
            <p className="text-sm font-bold text-muted">아직 인보이스가 없습니다.</p>
          ) : (
            invoices.map((invoice) => (
              <div key={invoice.id} className="flex items-center justify-between rounded-control border border-line bg-surface px-4 py-3 text-sm">
                <span className="font-bold">{invoice.period} · {invoice.student_count}명</span>
                <span className="font-mono font-extrabold">{formatKrw(invoice.amount)}</span>
              </div>
            ))
          )}
        </section>

        {!session && !loading ? <p className="text-sm font-bold text-muted">로그인 후 청구 내역을 볼 수 있습니다.</p> : null}
      </div>
    </main>
  );
}

export function TeacherLessonFees() {
  const [session, setSession] = useState<Session | null>(null);
  const [fees, setFees] = useState<LessonFeeRow[]>([]);
  const [students, setStudents] = useState<Array<{ id: string; name: string }>>([]);
  const [studentId, setStudentId] = useState("");
  const [amount, setAmount] = useState("300000");
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
    const [feeResult, connectionResult] = await Promise.all([
      supabase.from("lesson_fees").select("*").eq("teacher_id", active.user.id).order("period", { ascending: false }),
      supabase.from("connections").select("student_id").eq("teacher_id", active.user.id).eq("status", "active")
    ]);
    const ids = (connectionResult.data ?? []).map((c) => c.student_id);
    const profiles = ids.length ? await supabase.from("profiles").select("id, name").in("id", ids) : { data: [] };
    setFees(feeResult.data ?? []);
    setStudents((profiles.data as Array<{ id: string; name: string }>) ?? []);
    setMessage(feeResult.error?.message ?? "수업료 기록을 불러왔습니다.");
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const summary = useMemo(() => summarizeLessonFees(fees.map((f) => ({ amount: f.amount, paid: f.paid }))), [fees]);

  async function addFee() {
    if (!session || !studentId) return;
    const { error } = await supabase.from("lesson_fees").insert({
      teacher_id: session.user.id,
      student_id: studentId,
      period: currentPeriod(),
      amount: Math.max(0, Number(amount) || 0),
      paid: false
    });
    setMessage(error ? error.message : "수업료 기록을 추가했습니다.");
    if (!error) await refresh();
  }

  async function togglePaid(fee: LessonFeeRow) {
    const { error } = await supabase
      .from("lesson_fees")
      .update({ paid: !fee.paid, paid_at: fee.paid ? null : new Date().toISOString() })
      .eq("id", fee.id);
    if (!error) await refresh();
  }

  return (
    <main className="min-h-screen bg-canvas text-ink">
      <div className="mx-auto grid w-full max-w-3xl gap-6 px-4 py-6 md:px-8">
        <header className="flex flex-col gap-2 border-b border-line pb-5">
          <p className="text-sm font-extrabold text-brand">수업 · 수업료</p>
          <h1 className="text-2xl font-extrabold">수업료 트래커</h1>
          <p className="rounded-control bg-warning/10 px-3 py-2 text-sm font-bold text-warning">
            결제 처리가 아니라 수기 기록입니다. 앱 구독료와 별개예요.
          </p>
          <p className="text-sm font-bold text-muted" aria-live="polite">{loading ? "불러오는 중…" : message}</p>
        </header>

        <section className="grid grid-cols-3 gap-3">
          <SummaryCard label="합계" value={formatKrw(summary.totalAmount)} />
          <SummaryCard label="받음" value={formatKrw(summary.paidAmount)} />
          <SummaryCard label={`미수금 ${summary.unpaidCount}건`} value={formatKrw(summary.unpaidAmount)} />
        </section>

        <section className="grid gap-2 rounded-card border border-line bg-surface p-5">
          <h2 className="text-base font-extrabold">기록 추가 ({currentPeriod()})</h2>
          <div className="flex flex-wrap gap-2">
            <select className="rounded-control border border-line px-3 py-2 text-sm" onChange={(e) => setStudentId(e.target.value)} value={studentId}>
              <option value="">학생 선택</option>
              {students.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <input className="w-32 rounded-control border border-line px-3 py-2 text-sm" inputMode="numeric" onChange={(e) => setAmount(e.target.value)} value={amount} />
            <button className="rounded-control bg-brand px-4 py-2 text-sm font-bold text-surface" disabled={!studentId} onClick={() => void addFee()} type="button">
              추가
            </button>
          </div>
        </section>

        <section className="grid gap-2">
          {fees.map((fee) => (
            <div key={fee.id} className="flex items-center justify-between rounded-control border border-line bg-surface px-4 py-3 text-sm">
              <span className="font-bold">{fee.period} · {formatKrw(fee.amount)}</span>
              <button
                className={`rounded-chip px-3 py-1 text-sm font-bold ${fee.paid ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}
                onClick={() => void togglePaid(fee)}
                type="button"
              >
                {fee.paid ? "받음" : "미수금"}
              </button>
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card border border-line bg-surface p-4">
      <p className="text-xs font-bold text-muted">{label}</p>
      <p className="font-mono text-lg font-extrabold">{value}</p>
    </div>
  );
}
