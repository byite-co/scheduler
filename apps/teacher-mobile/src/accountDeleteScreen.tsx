import { useCallback, useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { colors, spacing, tints } from "@ssamplanner/design-tokens";
import {
  ACCOUNT_DELETE_STEPS,
  getAccountDeleteErrorMessage,
  getTeacherBillingState,
  validateDeleteConfirmation,
  type SubStatus
} from "@ssamplanner/shared";

import { useAuth } from "./auth";
import { managementStyles as styles } from "./managementStyles";
import { supabase } from "./supabaseClient";
import { ErrorState, LoadingState, screenStyles } from "./ui";
import { toUserMessage } from "./userMessage";

export function AccountDeleteScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const [confirmation, setConfirmation] = useState("");
  const [activeConnections, setActiveConnections] = useState(0);
  const [subscriptionStatus, setSubscriptionStatus] = useState<SubStatus>("none");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const canDelete = validateDeleteConfirmation(confirmation);

  const loadImpact = useCallback(async () => {
    if (!session) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    const [connectionsResult, subscriptionResult] = await Promise.all([
      supabase
        .from("connections")
        .select("id")
        .eq("teacher_id", session.user.id)
        .eq("status", "active"),
      supabase
        .from("teacher_subscriptions")
        .select("status")
        .eq("teacher_id", session.user.id)
        .maybeSingle()
    ]);
    setActiveConnections((connectionsResult.data ?? []).length);
    setSubscriptionStatus((subscriptionResult.data?.status as SubStatus | undefined) ?? "none");
    setLoadError(connectionsResult.error?.message ?? subscriptionResult.error?.message ?? null);
    setLoading(false);
  }, [session]);

  useEffect(() => {
    void loadImpact();
  }, [loadImpact]);

  async function deleteAccount() {
    if (!canDelete || busy) return;
    setBusy(true);
    setMessage(null);
    // account-delete 함수가 Storage 사진을 먼저 정리한 뒤, 사용자 권한으로 기존
    // delete_my_account RPC를 호출한다. RPC를 직접 호출하면 사진 정리가 빠진다.
    const { error } = await supabase.functions.invoke("account-delete");
    if (error) {
      setMessage(getAccountDeleteErrorMessage(error));
      setBusy(false);
      return;
    }
    await supabase.auth.signOut();
    router.replace("/login");
  }

  if (loading) {
    return (
      <ScrollView style={screenStyles.screen} contentContainerStyle={screenStyles.content}>
        <Text style={screenStyles.heading}>회원 탈퇴</Text>
        <LoadingState label="탈퇴 영향을 확인하는 중…" />
      </ScrollView>
    );
  }

  if (loadError) {
    return (
      <ScrollView style={screenStyles.screen} contentContainerStyle={screenStyles.content}>
        <Text style={screenStyles.heading}>회원 탈퇴</Text>
        <ErrorState body={loadError} onRetry={() => void loadImpact()} />
      </ScrollView>
    );
  }

  return (
    <ScrollView style={screenStyles.screen} contentContainerStyle={screenStyles.content}>
      <Text style={screenStyles.heading}>회원 탈퇴</Text>
      <Text style={[screenStyles.subtitle, { textAlign: "center" }]}>정말 탈퇴하시겠어요?</Text>
      <View style={[styles.notice, { backgroundColor: tints.dangerSoft, borderColor: tints.dangerBorder }]}>
        <Text style={[styles.noticeTitle, { color: colors.danger }]}>되돌릴 수 없어요</Text>
        {ACCOUNT_DELETE_STEPS.map((step) => <Text key={step} style={styles.meta}>• {step}</Text>)}
      </View>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>탈퇴 시 영향</Text>
        <Text style={styles.meta}>연결 학생 {activeConnections}명과의 연동이 해제됩니다.</Text>
        <Text style={styles.meta}>과외쌤 구독 상태: {getTeacherBillingState(subscriptionStatus).label}</Text>
        <Text style={styles.meta}>수업·숙제·리포트·정산 기록과 계정 데이터가 영구 삭제됩니다.</Text>
      </View>
      <View style={{ gap: spacing.sm }}>
        <Text style={styles.label}>본인 확인</Text>
        <TextInput
          accessibilityLabel="탈퇴 확인 입력"
          value={confirmation}
          onChangeText={setConfirmation}
          placeholder="삭제"
          placeholderTextColor={colors.muted}
          style={[styles.field, { borderColor: canDelete ? colors.danger : colors.line }]}
        />
      </View>
      {message ? <Text style={{ color: colors.danger, fontWeight: "800" }}>{toUserMessage(message)}</Text> : null}
      <Pressable
        accessibilityRole="button"
        disabled={!canDelete || busy}
        onPress={() => void deleteAccount()}
        style={[
          styles.secondaryButton,
          { backgroundColor: colors.danger, borderColor: colors.danger, opacity: !canDelete || busy ? 0.45 : 1 }
        ]}
      >
        <Text style={[styles.secondaryButtonText, { color: colors.surface }]}>{busy ? "탈퇴 처리 중…" : "영구 탈퇴하기"}</Text>
      </Pressable>
    </ScrollView>
  );
}
