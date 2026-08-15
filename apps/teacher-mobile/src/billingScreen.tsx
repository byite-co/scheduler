import { useCallback, useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { colors, spacing, tints } from "@ssamplanner/design-tokens";
import {
  PRICE_PER_STUDENT_KRW,
  formatKrw,
  getTeacherBillingState,
  getTeacherMonthlySubscriptionAmount,
  type Database,
  type SubStatus
} from "@ssamplanner/shared";

import { useAuth } from "./auth";
import { managementStyles as styles } from "./managementStyles";
import { supabase } from "./supabaseClient";
import { EmptyState, screenStyles } from "./ui";

type SubscriptionRow = Database["public"]["Tables"]["teacher_subscriptions"]["Row"];
type InvoiceRow = Database["public"]["Tables"]["billing_invoices"]["Row"];

function statusColors(status: SubStatus) {
  if (status === "active") return { background: tints.successSoft, color: colors.success };
  if (status === "past_due") return { background: tints.dangerSoft, color: colors.danger };
  if (status === "paused") return { background: tints.warningSoft, color: colors.warning };
  return { background: tints.brandSoft, color: colors.muted };
}

function invoiceStatusLabel(status: string) {
  if (status === "paid") return "결제 완료";
  if (status === "past_due") return "미납";
  if (status === "void") return "취소";
  return "결제 예정";
}

export function BillingScreen() {
  const { session, setMessage } = useAuth();
  const [subscription, setSubscription] = useState<SubscriptionRow | null>(null);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [activeCount, setActiveCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!session) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const [subscriptionResult, invoicesResult, connectionsResult] = await Promise.all([
      supabase
        .from("teacher_subscriptions")
        .select("teacher_id, status, provider, current_period_end, payment_method_last4, stripe_customer_id, updated_at")
        .eq("teacher_id", session.user.id)
        .maybeSingle(),
      supabase
        .from("billing_invoices")
        .select("id, teacher_id, period, student_count, amount, status, issued_at, paid_at")
        .eq("teacher_id", session.user.id)
        .order("issued_at", { ascending: false }),
      supabase
        .from("connections")
        .select("id")
        .eq("teacher_id", session.user.id)
        .eq("status", "active")
    ]);
    setSubscription(subscriptionResult.data);
    setInvoices(invoicesResult.data ?? []);
    setActiveCount((connectionsResult.data ?? []).length);
    const error = subscriptionResult.error ?? invoicesResult.error ?? connectionsResult.error;
    setMessage(error?.message ?? null);
    setLoading(false);
  }, [session, setMessage]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const status = (subscription?.status ?? "none") as SubStatus;
  const billing = getTeacherBillingState(status);
  const tone = statusColors(status);
  const estimated = getTeacherMonthlySubscriptionAmount(activeCount);

  return (
    <ScrollView style={screenStyles.screen} contentContainerStyle={screenStyles.content}>
      <Text style={screenStyles.heading}>구독·정산</Text>
      <View style={[styles.notice, { backgroundColor: tints.brandSoft, borderColor: colors.line }]}>
        <Text style={styles.noticeTitle}>쌤플래너 앱 사용료예요</Text>
        <Text style={styles.meta}>학생에게 받는 과외비는 ‘수업료 관리’에서 별도로 기록합니다.</Text>
      </View>

      <View style={[styles.card, { backgroundColor: colors.ink, borderColor: colors.ink }]}>
        <View style={[styles.actionRow, { alignItems: "center" }]}>
          <Text style={{ color: colors.surface, fontSize: 16, fontWeight: "900" }}>이번 달 예상 앱 구독료</Text>
          <View style={[styles.chip, { backgroundColor: tone.background, borderColor: tone.background, marginLeft: "auto" }]}>
            <Text style={[styles.chipText, { color: tone.color }]}>{billing.label}</Text>
          </View>
        </View>
        <Text style={{ color: colors.surface, fontSize: 38, fontWeight: "900" }}>{formatKrw(estimated)}</Text>
        <Text style={{ color: colors.line, fontSize: 15, fontWeight: "700" }}>
          active 학생 {activeCount}명 × {formatKrw(PRICE_PER_STUDENT_KRW)}
        </Text>
        <Text style={{ color: colors.line, fontSize: 14, fontWeight: "600", lineHeight: 20 }}>{billing.reason}</Text>
        {subscription?.current_period_end ? (
          <Text style={{ color: colors.line, fontSize: 14, fontWeight: "700" }}>
            현재 이용 기간 · {new Date(subscription.current_period_end).toLocaleDateString("ko-KR")}까지
          </Text>
        ) : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>결제 연결 상태</Text>
        {subscription?.payment_method_last4 ? (
          <Text style={styles.meta}>등록된 결제수단 · •••• {subscription.payment_method_last4}</Text>
        ) : (
          <Text style={styles.meta}>등록된 결제수단이 없습니다.</Text>
        )}
        <Text style={styles.meta}>
          모바일 인앱결제는 별도 출시 작업에서 연결합니다. 이 화면에서는 실제 결제·재결제·해지를 처리하지 않습니다.
        </Text>
      </View>

      <View style={{ gap: spacing.md }}>
        <Text style={styles.cardTitle}>인보이스</Text>
        {!loading && invoices.length === 0 ? (
          <EmptyState title="아직 인보이스가 없어요" body="결제 연동 후 월별 청구 내역이 여기에 표시돼요." />
        ) : null}
        {invoices.map((invoice) => (
          <View key={invoice.id} style={styles.row}>
            <View style={{ flex: 1, gap: spacing.xs }}>
              <Text style={styles.cardTitle}>{invoice.period} · 학생 {invoice.student_count}명</Text>
              <Text style={styles.meta}>{invoiceStatusLabel(invoice.status)}</Text>
            </View>
            <Text style={{ color: colors.ink, fontSize: 18, fontWeight: "900" }}>{formatKrw(invoice.amount)}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
