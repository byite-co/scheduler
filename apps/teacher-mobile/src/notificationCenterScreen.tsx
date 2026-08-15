import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { colors, spacing } from "@ssamplanner/design-tokens";
import { NOTIF_TYPE_LABELS, unreadCount, type Database, type NotifType } from "@ssamplanner/shared";

import { useAuth } from "./auth";
import { managementStyles as styles } from "./managementStyles";
import { supabase } from "./supabaseClient";
import { EmptyState, screenStyles } from "./ui";

type NotificationRow = Database["public"]["Tables"]["notifications"]["Row"];

function formatNotificationTime(value: string) {
  return new Date(value).toLocaleString("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

export function NotificationCenterScreen() {
  const { session, setMessage } = useAuth();
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    if (!session) {
      setNotifications([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const { data, error } = await supabase
      .from("notifications")
      .select("id, user_id, type, title, body, payload, read, created_at")
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false })
      .limit(50);
    setNotifications(data ?? []);
    setMessage(error?.message ?? null);
    setLoading(false);
  }, [session, setMessage]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function markRead(notification: NotificationRow) {
    if (notification.read) return;
    const { error } = await supabase.from("notifications").update({ read: true }).eq("id", notification.id);
    setMessage(error?.message ?? null);
    if (!error) {
      setNotifications((current) =>
        current.map((item) => (item.id === notification.id ? { ...item, read: true } : item))
      );
    }
  }

  async function markAllRead() {
    if (!session || unreadCount(notifications) === 0) return;
    setSaving(true);
    const { error } = await supabase
      .from("notifications")
      .update({ read: true })
      .eq("user_id", session.user.id)
      .eq("read", false);
    setSaving(false);
    setMessage(error?.message ?? null);
    if (!error) setNotifications((current) => current.map((item) => ({ ...item, read: true })));
  }

  const unread = unreadCount(notifications);

  return (
    <ScrollView style={screenStyles.screen} contentContainerStyle={screenStyles.content}>
      <View style={[styles.actionRow, { alignItems: "center", justifyContent: "space-between" }]}>
        <View style={{ gap: spacing.xs }}>
          <Text style={screenStyles.heading}>알림</Text>
          <Text style={screenStyles.subtitle}>{unread ? `읽지 않은 알림 ${unread}개` : "새 알림을 모두 확인했어요"}</Text>
        </View>
        <Pressable disabled={saving || unread === 0} onPress={() => void markAllRead()}>
          <Text style={{ color: unread ? colors.brand : colors.muted, fontWeight: "900" }}>모두 읽음</Text>
        </Pressable>
      </View>

      {!loading && notifications.length === 0 ? (
        <EmptyState title="아직 알림이 없어요" body="숙제 제출·검사·연결 요청과 리포트 소식이 여기에 모여요." />
      ) : null}

      {notifications.map((notification) => (
        <Pressable
          accessibilityRole="button"
          key={notification.id}
          onPress={() => void markRead(notification)}
          style={[styles.card, !notification.read && styles.unread]}
        >
          <View style={[styles.actionRow, { alignItems: "center" }]}>
            <Text style={{ color: colors.brand, fontSize: 13, fontWeight: "900" }}>
              {NOTIF_TYPE_LABELS[notification.type as NotifType]}
            </Text>
            {!notification.read ? <Text style={{ color: colors.brand, fontWeight: "900" }}>●</Text> : null}
            <Text style={[styles.meta, { marginLeft: "auto" }]}>{formatNotificationTime(notification.created_at)}</Text>
          </View>
          <Text style={styles.cardTitle}>{notification.title}</Text>
          {notification.body ? <Text style={styles.meta}>{notification.body}</Text> : null}
        </Pressable>
      ))}

      <Text style={styles.meta}>이 화면은 앱 안의 알림 목록입니다. 푸시 알림은 아직 연결하지 않았습니다.</Text>
    </ScrollView>
  );
}
