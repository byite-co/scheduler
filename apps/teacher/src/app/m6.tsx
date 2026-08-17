"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";

import {
  formatKrw,
  getTeacherBillingState,
  summarizeLessonFees,
  type SubStatus
} from "@ssamplanner/shared";
import type { Database } from "@ssamplanner/shared";

import { ReceiptText } from "lucide-react";

import { EmptyStatePanel, TeacherShell, type TeacherShellData } from "./m1";
import { supabase } from "./supabaseClient";

type InvoiceRow = Database["public"]["Tables"]["billing_invoices"]["Row"];
type LessonFeeRow = Database["public"]["Tables"]["lesson_fees"]["Row"];

function currentPeriod(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function TeacherBilling() {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<SubStatus>("none");
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
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
    const [subResult, invoiceResult] = await Promise.all([
      supabase.from("teacher_subscriptions").select("status").eq("teacher_id", active.user.id).maybeSingle(),
      supabase.from("billing_invoices").select("*").eq("teacher_id", active.user.id).order("issued_at", { ascending: false })
    ]);
    setStatus((subResult.data?.status as SubStatus) ?? "none");
    setInvoices(invoiceResult.data ?? []);
    setMessage(invoiceResult.error?.message ?? "");
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const billing = getTeacherBillingState(status);
  // 상태를 바꾸는 mock RPC 호출은 제거했다 — 과외쌤이 스스로 앱 구독료를 active 로 만들 수
  // 있는 구멍이었고 실행 권한을 회수했다(20260806000000). 실제 전이는 Stripe 웹훅이 담당한다.
  // 개발/테스트에서 상태를 만들려면 scripts/dev-set-subscription.mjs (service_role 필요).

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
      active="/billing"
      title="앱 구독료"
      subtitle="우리에게 내는 앱 구독료예요. 학생이 내는 수업·수업료와는 완전히 별개입니다."
      data={shellData}
    >
      <p className="text-xs font-bold text-muted">
        ※ 수업·수업료 기록은{" "}
        <a className="underline" href="/lesson-fees">
          수업료 트래커
        </a>
        에서 따로 관리해요.
      </p>

      <section className={`grid gap-2 rounded-card border bg-surface p-5 ${toneClass}`}>
          <p className="text-lg font-extrabold">{billing.label}</p>
          <p className="text-sm font-bold text-muted">{billing.reason}</p>
          {/*
            "예상 월 청구 = active N명 × 4,900원 = …" 를 지웠다. 가격이 확정되지 않았고 결제
            수단도 없다 — 예상 청구액을 보여 주면 그 금액이 청구될 것처럼 읽힌다.
            연동 학생 수는 대시보드에 있고, 실제 청구는 인보이스 목록이 보여 준다.
          */}
          {/* 상태를 바꾸는 버튼은 제거했다(보안). 상태·금액 표시는 위에 그대로 남는다.
              결제 사업자 이름(Stripe)은 지웠다 — 과외쌤 결제는 **웹 국내 PG** 로 확정됐고,
              사업자가 정해지지 않은 상태에서 특정 이름을 적으면 그 순간 거짓이 된다. */}
          <p className="mt-2 rounded-control border border-line bg-canvas px-4 py-3 text-sm font-bold text-muted">
            {billing.status === "active"
              ? "해지·일시정지는 결제 연동 후 이 화면에서 처리할 수 있어요."
              : billing.status === "past_due"
                ? "미납 복구는 결제 연동 후 결제수단 업데이트로 처리돼요."
                : "구독 시작은 결제 연동 후 이 화면에서 할 수 있어요."}
          </p>
        </section>

        <section className="grid gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-extrabold">인보이스</h2>
            <button className="rounded-control border border-line px-3 py-2 text-sm font-bold" onClick={() => void generateInvoice()} type="button">
              이번 달 인보이스 생성
            </button>
          </div>
          {invoices.length === 0 ? (
            <EmptyStatePanel
              icon={<ReceiptText className="h-6 w-6 text-brand" strokeWidth={2} />}
              title="아직 인보이스가 없어요"
              body="‘이번 달 인보이스 생성’을 누르면 연동 학생 수 기준 앱 구독료 청구서가 만들어져요. (수업·수업료와는 별개)"
            />
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
    </TeacherShell>
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
    setMessage(feeResult.error?.message ?? "");
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
      active="/billing"
      title="수업료 트래커"
      subtitle="학생이 내는 수업료를 수기로 기록해요. (결제 처리 아님 · 앱 구독료와 별개)"
      data={shellData}
    >
      <p className="rounded-control bg-warning/10 px-3 py-2 text-sm font-bold text-warning">
        결제 처리가 아니라 수기 기록입니다. 앱 구독료와 별개예요.
      </p>

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
    </TeacherShell>
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
