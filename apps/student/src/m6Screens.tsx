import { useCallback, useEffect, useState } from "react";

import { router } from "expo-router";
import { createClient, type Session } from "@supabase/supabase-js";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { colors, radii, spacing } from "@ssamplanner/design-tokens";
import { PRICE_STUDENT_PREMIUM_KRW, formatKrw, getStudentPremiumState, type SubStatus } from "@ssamplanner/shared";
import type { Database } from "@ssamplanner/shared";

const supabase = createClient<Database>(
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""
);

function useSubscription() {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<SubStatus>("none");
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("불러오는 중");

  const refresh = useCallback(async () => {
    setLoading(true);
    const active = (await supabase.auth.getSession()).data.session;
    setSession(active);
    if (!active) {
      setMessage("로그인이 필요해요.");
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from("student_subscriptions")
      .select("status, expires_at")
      .eq("student_id", active.user.id)
      .maybeSingle();
    setStatus((data?.status as SubStatus) ?? "none");
    setExpiresAt(data?.expires_at ?? null);
    setMessage(error?.message ?? "구독 정보를 불러왔어요.");
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function setSub(next: SubStatus) {
    const { error } = await supabase.rpc("mock_set_student_subscription", { p_status: next });
    setMessage(error ? error.message : next === "active" ? "프리미엄이 활성화됐어요. (모의 결제)" : "구독을 해지했어요.");
    if (!error) await refresh();
  }

  return { session, status, expiresAt, loading, message, refresh, setSub };
}

export function SubscribeScreen() {
  const sub = useSubscription();
  const premium = getStudentPremiumState(sub.status, sub.expiresAt);

  if (sub.loading) return <Center text={sub.message} />;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.kicker}>프리미엄</Text>
      <Text style={styles.title}>광고 없이, 무제한으로</Text>
      <Text style={styles.price}>{formatKrw(PRICE_STUDENT_PREMIUM_KRW)} / 월</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>프리미엄 혜택</Text>
        <Text style={styles.cardBody}>• 나의 리포트 · AI 추천 무제한</Text>
        <Text style={styles.cardBody}>• 혼공 AI 검사 무제한 (광고 없이)</Text>
      </View>

      <Text style={styles.notice}>{sub.message}</Text>

      {premium.isPremium ? (
        <Pressable accessibilityRole="button" onPress={() => router.push("/settings/subscription")} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>구독 관리</Text>
        </Pressable>
      ) : (
        <Pressable accessibilityRole="button" onPress={() => void sub.setSub("active")} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>프리미엄 시작 (모의 결제)</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

export function SubscriptionManageScreen() {
  const sub = useSubscription();
  const premium = getStudentPremiumState(sub.status, sub.expiresAt);

  if (sub.loading) return <Center text={sub.message} />;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.kicker}>구독 관리</Text>
      <Text style={styles.title}>{premium.label}</Text>
      <Text style={styles.notice}>{sub.message}</Text>

      {premium.isPremium ? (
        <Pressable accessibilityRole="button" onPress={() => void sub.setSub("canceled")} style={styles.dangerButton}>
          <Text style={styles.dangerButtonText}>구독 해지</Text>
        </Pressable>
      ) : (
        <Pressable accessibilityRole="button" onPress={() => router.push("/subscribe")} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>프리미엄 보러가기</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

function Center({ text }: { text: string }) {
  return (
    <View style={styles.center}>
      <Text style={styles.centerText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: spacing.lg, gap: spacing.md },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, backgroundColor: colors.canvas },
  centerText: { color: colors.muted, fontSize: 15, fontWeight: "700" },
  kicker: { color: colors.flame, fontSize: 13, fontWeight: "900", letterSpacing: 0.4 },
  title: { color: colors.ink, fontSize: 24, fontWeight: "900" },
  price: { color: colors.brand, fontSize: 18, fontWeight: "900" },
  notice: { color: colors.muted, fontSize: 13, fontWeight: "700" },
  card: { gap: spacing.xs, padding: spacing.lg, borderWidth: 1, borderColor: colors.line, borderRadius: radii.card, backgroundColor: colors.surface },
  cardTitle: { color: colors.ink, fontSize: 16, fontWeight: "900", marginBottom: spacing.xs },
  cardBody: { color: colors.muted, fontSize: 14, fontWeight: "700", lineHeight: 22 },
  primaryButton: { minHeight: 52, alignItems: "center", justifyContent: "center", borderRadius: radii.button, backgroundColor: colors.brand, paddingHorizontal: spacing.xl },
  primaryButtonText: { color: colors.surface, fontSize: 15, fontWeight: "900" },
  secondaryButton: { minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: radii.button, borderWidth: 1, borderColor: colors.brand },
  secondaryButtonText: { color: colors.brand, fontSize: 15, fontWeight: "900" },
  dangerButton: { minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: radii.button, borderWidth: 1, borderColor: colors.danger },
  dangerButtonText: { color: colors.danger, fontSize: 15, fontWeight: "900" }
});
