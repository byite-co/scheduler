import { useCallback, useEffect, useState } from "react";

import { router } from "expo-router";
import type { Session } from "@supabase/supabase-js";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { colors, radii, spacing } from "@ssamplanner/design-tokens";
import { getStudentPremiumState, type SubStatus } from "@ssamplanner/shared";

import { supabase } from "./supabaseClient";

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
    setMessage(error?.message ?? "");
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 상태를 바꾸는 mock RPC 호출은 제거했다 — 클라이언트가 스스로 프리미엄이 되는 구멍이었고
  // 실행 권한을 회수했다(20260805000000). 실제 결제는 IAP/RevenueCat 웹훅이 담당한다.
  // 개발/테스트에서 상태를 만들려면 scripts/dev-set-subscription.mjs (service_role 필요).
  return { session, status, expiresAt, loading, message, refresh };
}

export function SubscribeScreen() {
  const sub = useSubscription();
  const premium = getStudentPremiumState(sub.status, sub.expiresAt);

  if (sub.loading) return <Center text={sub.message} />;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.kicker}>프리미엄</Text>
      {/*
        가격을 여기서 찍지 않는다. 학생 프리미엄은 인앱결제(IAP)로 확정됐고, 가격은 스토어
        메타데이터가 정본이다 — 앱에 하드코딩하면 스토어 값과 갈라지고 그 순간 거짓이 된다.

        혜택 목록도 지웠다. 세 항목 모두 지금 동작하지 않는다:
          · 나의 리포트   — /report 는 진입점 0건(고아 화면), 출시 비노출 확정
          · AI 추천       — 클라이언트 스텁이고 결과 쓰기가 서버에서 차단됨(20260816020000)
          · 혼공 AI 검사  — AI_CHECK_RESULTS_ENABLED=false, Edge Function 이 503 으로 거절
        남는 항목이 없어 목록 자체를 없앴다. 구체 기능명·가격을 약속하지 않는다.
      */}
      <Text style={styles.title}>준비 중</Text>

      <Text style={styles.notice}>{sub.message}</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>현재 상태</Text>
        <Text style={styles.cardBody}>{premium.label}</Text>
      </View>

      {premium.isPremium ? (
        <Pressable accessibilityRole="button" onPress={() => router.push("/settings/subscription")} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>구독 관리</Text>
        </Pressable>
      ) : (
        // 결제 진입은 실연동(IAP) 전까지 비워둔다. 예전엔 mock RPC 로 스스로 프리미엄이 됐는데
        // 그건 보안 구멍이라 제거했다 — 상태 표시는 남기고 상태를 바꾸는 버튼만 없앴다.
        <View style={styles.pendingCard}>
          <Text style={styles.pendingTitle}>결제 준비 중</Text>
          {/*
            "그때까지는 광고 보상으로 열어서 써주세요" 를 지웠다 — 광고 언락은 서버에서
            발급이 차단돼 있고(20260816010000) 버튼도 숨겨져 있어, 할 수 없는 일을 권하는
            문구였다. 대체 문구를 새로 넣지 않는다(약속을 늘리지 않는다).
          */}
        </View>
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

      {sub.expiresAt ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>만료 예정</Text>
          <Text style={styles.cardBody}>{new Date(sub.expiresAt).toLocaleDateString("ko-KR")}</Text>
        </View>
      ) : null}

      {premium.isPremium ? (
        // 해지 안내를 지웠다. IAP 연동이 없어 **결제한 사람이 존재할 수 없으므로**
        // "결제하신 스토어에서 해지하세요" 는 허위 안내다(그 상태는 service_role 로
        // 만든 테스트 데이터로만 도달한다). 연동이 붙으면 그때 실제 절차를 적는다.
        // 상태 표시(제목·만료 예정)는 위에 그대로 남는다.
        null
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
  content: { padding: spacing.lg, gap: spacing.md, width: "100%", maxWidth: 720, alignSelf: "center" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, backgroundColor: colors.canvas },
  centerText: { color: colors.muted, fontSize: 15, fontWeight: "700" },
  kicker: { color: colors.muted, fontSize: 13, fontWeight: "800", letterSpacing: 0.2 },
  title: { color: colors.ink, fontSize: 24, fontWeight: "900" },
  notice: { color: colors.muted, fontSize: 13, fontWeight: "700" },
  card: { gap: spacing.xs, padding: spacing.lg, borderWidth: 1, borderColor: colors.line, borderRadius: radii.card, backgroundColor: colors.surface },
  cardTitle: { color: colors.ink, fontSize: 16, fontWeight: "900", marginBottom: spacing.xs },
  cardBody: { color: colors.muted, fontSize: 14, fontWeight: "700", lineHeight: 22 },
  primaryButton: { minHeight: 52, alignItems: "center", justifyContent: "center", borderRadius: radii.button, backgroundColor: colors.brand, paddingHorizontal: spacing.xl },
  primaryButtonText: { color: colors.surface, fontSize: 15, fontWeight: "900" },
  secondaryButton: { minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: radii.button, borderWidth: 1, borderColor: colors.brand },
  secondaryButtonText: { color: colors.brand, fontSize: 15, fontWeight: "900" },
  pendingCard: {
    gap: spacing.xs,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.card,
    backgroundColor: colors.canvas
  },
  pendingTitle: { color: colors.muted, fontSize: 15, fontWeight: "900" }
});
