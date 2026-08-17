import { useCallback, useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { colors, radii, spacing, tints } from "@ssamplanner/design-tokens";
import { formatInviteCode, type Database } from "@ssamplanner/shared";

import { useAuth } from "./auth";
import { getInviteExpiry } from "./connectionExpiry";
import { createSecureInviteCode } from "./inviteCode";
import { managementStyles } from "./managementStyles";
import { supabase } from "./supabaseClient";
import { ErrorState, LoadingState, PrimaryButton, screenStyles } from "./ui";

type InviteCode = Database["public"]["Tables"]["invite_codes"]["Row"];

function inviteExpiryColor(state: "valid" | "urgent" | "expired" | undefined) {
  if (state === "urgent") return colors.flame;
  if (state === "expired") return colors.danger;
  return colors.muted;
}

export function InviteCodeScreen() {
  const router = useRouter();
  const { session, setMessage } = useAuth();
  const [invite, setInvite] = useState<InviteCode | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const loadInvite = useCallback(async () => {
    if (!session) {
      setInvite(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadError(null);
    const result = await supabase
      .from("invite_codes")
      .select("*")
      .eq("teacher_id", session.user.id)
      .order("created_at", { ascending: false })
      .limit(1);
    const errorMessage = result.error?.message ?? null;
    setInvite(result.data?.[0] ?? null);
    setLoadError(errorMessage);
    setMessage(errorMessage);
    setLoading(false);
  }, [session, setMessage]);

  useEffect(() => {
    void loadInvite();
  }, [loadInvite]);

  async function createInvite() {
    if (!session || creating) return;

    let code: string;
    try {
      code = createSecureInviteCode();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "초대 코드를 만들지 못했습니다.");
      return;
    }

    setCreating(true);
    const result = await supabase.from("invite_codes").insert({
      code,
      teacher_id: session.user.id,
      expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
    });
    setCreating(false);

    if (result.error) {
      setMessage(result.error.message);
      return;
    }

    await loadInvite();
    setMessage("초대 코드를 발급했습니다.");
  }

  if (loading) {
    return (
      <ScrollView style={screenStyles.screen} contentContainerStyle={screenStyles.content}>
        <Text style={screenStyles.heading}>학생 초대</Text>
        <LoadingState label="초대 코드를 확인하는 중…" />
      </ScrollView>
    );
  }

  if (loadError) {
    return (
      <ScrollView style={screenStyles.screen} contentContainerStyle={screenStyles.content}>
        <Text style={screenStyles.heading}>학생 초대</Text>
        <ErrorState body={loadError} onRetry={() => void loadInvite()} />
      </ScrollView>
    );
  }

  const expiry = invite?.expires_at ? getInviteExpiry(invite.expires_at) : null;
  const expiryColor = inviteExpiryColor(expiry?.state);

  return (
    <ScrollView style={screenStyles.screen} contentContainerStyle={screenStyles.content}>
      <Text style={screenStyles.heading}>학생 초대</Text>
      <Text style={screenStyles.subtitle}>학생이 코드를 입력하면 연결 요청이 도착해요.</Text>
      <View style={styles.codeCard}>
        <Text style={styles.codeLabel}>초대 코드</Text>
        <Text selectable style={styles.code}>{invite ? formatInviteCode(invite.code) : "------"}</Text>
        <Text style={[styles.expiry, { color: expiryColor }]}>{expiry?.label ?? "새 코드를 발급해 주세요"}</Text>
        {expiry?.state === "expired" ? (
          <Text style={styles.expiredNotice}>이 코드는 더 이상 사용할 수 없어요. 새 코드를 발급해 주세요.</Text>
        ) : null}
      </View>
      <PrimaryButton disabled={creating} onPress={() => void createInvite()}>
        {creating ? "발급 중…" : "새 코드 발급"}
      </PrimaryButton>
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push("/students/requests")}
        style={managementStyles.secondaryButton}
      >
        <Text style={managementStyles.secondaryButtonText}>연결 요청 보기</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  code: {
    color: colors.brand,
    fontFamily: "monospace",
    fontSize: 34,
    fontVariant: ["tabular-nums"],
    fontWeight: "900",
    letterSpacing: 2
  },
  codeCard: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: radii.card,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.xl
  },
  codeLabel: { color: colors.muted, fontSize: 14, fontWeight: "800" },
  expiredNotice: {
    backgroundColor: tints.dangerSoft,
    borderRadius: radii.button,
    color: colors.danger,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
    padding: spacing.md,
    textAlign: "center"
  },
  expiry: { fontSize: 15, fontWeight: "900" }
});
