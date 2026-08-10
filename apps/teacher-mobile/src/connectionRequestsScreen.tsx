import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { DEFAULT_TEACHER_STUDENT_SETTINGS, type Database } from "@ssamplanner/shared";

import { useAuth } from "./auth";
import { supabase } from "./supabaseClient";
import { EmptyState, screenStyles } from "./ui";

type Connection = Database["public"]["Tables"]["connections"]["Row"];

export function ConnectionRequestsScreen() {
  const { session, setMessage } = useAuth();
  const [requests, setRequests] = useState<Connection[]>([]);

  const loadRequests = useCallback(async () => {
    if (!session) return;
    const result = await supabase
      .from("connections")
      .select("*")
      .eq("teacher_id", session.user.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    setRequests(result.data ?? []);
    if (result.error) setMessage(result.error.message);
  }, [session, setMessage]);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  async function decide(connection: Connection, accept: boolean) {
    const patch = accept
      ? { status: "active" as const, activated_at: new Date().toISOString() }
      : { status: "rejected" as const, activated_at: null };
    const result = await supabase.from("connections").update(patch).eq("id", connection.id);
    if (result.error) {
      setMessage(result.error.message);
      return;
    }
    if (accept) {
      const settings = await supabase.from("per_student_settings").upsert({
        connection_id: connection.id,
        ai_check_subjects: DEFAULT_TEACHER_STUDENT_SETTINGS.aiCheckSubjects as Database["public"]["Enums"]["subject_code"][],
        report_cycle: DEFAULT_TEACHER_STUDENT_SETTINGS.reportCycle
      });
      if (settings.error) {
        setMessage(settings.error.message);
        return;
      }
    }
    setMessage(accept ? "연결을 수락했습니다." : "연결을 거절했습니다.");
    await loadRequests();
  }

  return (
    <ScrollView style={screenStyles.screen} contentContainerStyle={screenStyles.content}>
      <Text style={screenStyles.heading}>연결 요청</Text>
      <Text style={screenStyles.subtitle}>학생이 초대 코드를 입력하면 여기에서 확인해요.</Text>
      {requests.length === 0 ? <EmptyState title="대기 중인 요청이 없어요" body="초대 코드를 학생에게 보내면 요청이 도착해요." /> : null}
      {requests.map((request) => (
        <View key={request.id}>
          <Text>{request.student_id}</Text>
          <Text>대기 중 · {request.invite_code ?? "초대 코드 없음"}</Text>
          <Pressable onPress={() => void decide(request, true)}><Text>수락</Text></Pressable>
          <Pressable onPress={() => void decide(request, false)}><Text>거절</Text></Pressable>
        </View>
      ))}
    </ScrollView>
  );
}
