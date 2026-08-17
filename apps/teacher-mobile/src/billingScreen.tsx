import { useCallback, useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { colors, tints } from "@ssamplanner/design-tokens";
import {
  getTeacherBillingState,
  type Database,
  type SubStatus
} from "@ssamplanner/shared";

import { useAuth } from "./auth";
import { managementStyles as styles } from "./managementStyles";
import { supabase } from "./supabaseClient";
import { ErrorState, LoadingState, screenStyles } from "./ui";

type SubscriptionRow = Pick<
  Database["public"]["Tables"]["teacher_subscriptions"]["Row"],
  "status" | "current_period_end"
>;

function statusColors(status: SubStatus) {
  if (status === "active") return { background: tints.successSoft, color: colors.success };
  if (status === "past_due") return { background: tints.dangerSoft, color: colors.danger };
  if (status === "paused") return { background: tints.warningSoft, color: colors.warning };
  return { background: tints.brandSoft, color: colors.muted };
}

export function BillingScreen() {
  const { session, setMessage } = useAuth();
  const [subscription, setSubscription] = useState<SubscriptionRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!session) {
      setSubscription(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadError(null);
    const subscriptionResult = await supabase
      .from("teacher_subscriptions")
      .select("status, current_period_end")
      .eq("teacher_id", session.user.id)
      .maybeSingle();

    setSubscription(subscriptionResult.data);
    setLoadError(subscriptionResult.error?.message ?? null);
    setMessage(subscriptionResult.error?.message ?? null);
    setLoading(false);
  }, [session, setMessage]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (loading) {
    return (
      <ScrollView style={screenStyles.screen} contentContainerStyle={screenStyles.content}>
        <Text style={screenStyles.heading}>구독·정산</Text>
        <LoadingState label="구독 상태를 불러오는 중…" />
      </ScrollView>
    );
  }

  if (loadError) {
    return (
      <ScrollView style={screenStyles.screen} contentContainerStyle={screenStyles.content}>
        <Text style={screenStyles.heading}>구독·정산</Text>
        <ErrorState body={loadError} onRetry={() => void refresh()} />
      </ScrollView>
    );
  }

  const status = (subscription?.status ?? "none") as SubStatus;
  const billing = getTeacherBillingState(status);
  const tone = statusColors(status);

  return (
    <ScrollView style={screenStyles.screen} contentContainerStyle={screenStyles.content}>
      <Text style={screenStyles.heading}>구독·정산</Text>

      <View style={[styles.card, { backgroundColor: colors.ink, borderColor: colors.ink }]}>
        <View style={[styles.actionRow, { alignItems: "center", justifyContent: "flex-end" }]}>
          <View style={[styles.chip, { backgroundColor: tone.background, borderColor: tone.background }]}>
            <Text style={[styles.chipText, { color: tone.color }]}>{billing.label}</Text>
          </View>
        </View>
        {subscription?.current_period_end ? (
          <Text style={{ color: colors.line, fontSize: 14, fontWeight: "700" }}>
            현재 이용 기간 · {new Date(subscription.current_period_end).toLocaleDateString("ko-KR")}까지
          </Text>
        ) : null}
      </View>
    </ScrollView>
  );
}
