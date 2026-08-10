import { useCallback, useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { formatInviteCode, type Database } from "@ssamplanner/shared";

import { useAuth } from "./auth";
import { getInviteExpiry } from "./connectionExpiry";
import { supabase } from "./supabaseClient";
import { PrimaryButton, screenStyles } from "./ui";

type InviteCode = Database["public"]["Tables"]["invite_codes"]["Row"];

function generateCode() {
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}

export function InviteCodeScreen() {
  const { session, setMessage } = useAuth();
  const [invite, setInvite] = useState<InviteCode | null>(null);

  const loadInvite = useCallback(async () => {
    if (!session) return;
    const result = await supabase
      .from("invite_codes")
      .select("*")
      .eq("teacher_id", session.user.id)
      .order("created_at", { ascending: false })
      .limit(1);
    setInvite(result.data?.[0] ?? null);
  }, [session]);

  useEffect(() => {
    void loadInvite();
  }, [loadInvite]);

  async function createInvite() {
    if (!session) return;
    const result = await supabase.from("invite_codes").insert({
      code: generateCode(),
      teacher_id: session.user.id,
      expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
    });
    setMessage(result.error?.message ?? "초대 코드를 발급했습니다.");
    await loadInvite();
  }

  const expiry = invite?.expires_at ? getInviteExpiry(invite.expires_at) : null;
  return (
    <ScrollView style={screenStyles.screen} contentContainerStyle={screenStyles.content}>
      <Text style={screenStyles.heading}>학생 초대</Text>
      <Text style={screenStyles.subtitle}>학생이 코드를 입력하면 연결 요청이 도착해요.</Text>
      <View>
        <Text>{invite ? formatInviteCode(invite.code) : "------"}</Text>
        <Text style={{ color: expiry?.state === "urgent" ? "#FF6B3D" : undefined }}>
          {expiry?.label ?? "새 코드를 발급해 주세요"}
        </Text>
        {expiry?.state === "expired" ? <Text>만료된 코드입니다. 새 코드를 발급해 주세요.</Text> : null}
      </View>
      <PrimaryButton onPress={() => void createInvite()}>새 코드 발급</PrimaryButton>
    </ScrollView>
  );
}
