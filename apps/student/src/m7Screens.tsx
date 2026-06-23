import { useCallback, useEffect, useState } from "react";

import { Link, router } from "expo-router";
import { createClient, type Session } from "@supabase/supabase-js";
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { colors, radii, spacing } from "@ssamplanner/design-tokens";
import {
  ACCOUNT_DELETE_STEPS,
  NOTIF_TYPE_LABELS,
  getNotificationRoute,
  getPushPrimingState,
  getSystemGateState,
  unreadCount,
  validateDeleteConfirmation,
  type NotifType,
  type PushPermissionStatus,
  type SystemConfig
} from "@ssamplanner/shared";
import type { Database } from "@ssamplanner/shared";

type NotificationRow = Database["public"]["Tables"]["notifications"]["Row"];

const supabase = createClient<Database>(
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""
);

const APP_BUILD = 1;

export function NotificationCenterScreen() {
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("불러오는 중");

  const refresh = useCallback(async () => {
    setLoading(true);
    const active = (await supabase.auth.getSession()).data.session;
    if (!active) {
      setMessage("로그인이 필요해요.");
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", active.user.id)
      .order("created_at", { ascending: false })
      .limit(50);
    setNotifications(data ?? []);
    setMessage(error?.message ?? "알림을 불러왔어요.");
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function open(notification: NotificationRow) {
    if (!notification.read) await supabase.from("notifications").update({ read: true }).eq("id", notification.id);
    const route = getNotificationRoute({
      id: notification.id,
      type: notification.type as NotifType,
      read: notification.read,
      payload: (notification.payload as { route?: string; todoId?: string } | null) ?? null
    });
    router.push(route as never);
  }

  if (loading) return <Center text={message} />;

  const unread = unreadCount(notifications);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.kicker}>알림 센터</Text>
      <Text style={styles.title}>알림 {unread > 0 ? `· 안 읽음 ${unread}` : ""}</Text>

      {notifications.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>아직 알림이 없어요</Text>
          <Text style={styles.cardBody}>숙제·검사 결과·응원이 도착하면 여기에 모여요.</Text>
        </View>
      ) : (
        notifications.map((notification) => (
          <Pressable key={notification.id} accessibilityRole="button" onPress={() => void open(notification)} style={[styles.notifRow, notification.read ? null : styles.notifUnread]}>
            <Text style={styles.notifBadge}>{NOTIF_TYPE_LABELS[notification.type as NotifType]}</Text>
            <View style={styles.notifBody}>
              <Text style={styles.notifTitle}>{notification.title}</Text>
              {notification.body ? <Text style={styles.notifSub}>{notification.body}</Text> : null}
            </View>
          </Pressable>
        ))
      )}
    </ScrollView>
  );
}

export function AccountSettingsScreen() {
  const items: Array<{ href: string; label: string }> = [
    { href: "/settings/profile", label: "프로필 편집" },
    { href: "/onboarding/disclosure", label: "공개 범위" },
    { href: "/settings/subscription", label: "구독 관리" },
    { href: "/onboarding/push", label: "푸시 알림" },
    { href: "/notifications", label: "알림 센터" },
    { href: "/legal/terms", label: "약관·개인정보" },
    { href: "/settings/account/delete", label: "회원 탈퇴" }
  ];
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.kicker}>설정</Text>
      <Text style={styles.title}>계정 · 설정</Text>
      {items.map((item) => (
        <Link key={item.href} href={item.href as never} asChild>
          <Pressable accessibilityRole="button" style={styles.settingRow}>
            <Text style={[styles.settingLabel, item.href.includes("delete") ? styles.dangerText : null]}>{item.label}</Text>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        </Link>
      ))}
    </ScrollView>
  );
}

export function AccountDeleteScreen() {
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const canDelete = validateDeleteConfirmation(confirm);

  async function deleteAccount() {
    if (!canDelete) return;
    setBusy(true);
    const { error } = await supabase.rpc("delete_my_account");
    if (error) {
      setMessage(error.message);
      setBusy(false);
      return;
    }
    await supabase.auth.signOut();
    router.replace("/" as never);
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.kicker}>회원 탈퇴</Text>
      <Text style={styles.title}>정말 탈퇴할까요?</Text>
      <View style={[styles.card, styles.dangerCard]}>
        {ACCOUNT_DELETE_STEPS.map((step) => (
          <Text key={step} style={styles.cardBody}>• {step}</Text>
        ))}
      </View>
      <TextInput
        accessibilityLabel="탈퇴 확인 입력"
        onChangeText={setConfirm}
        placeholder="삭제"
        style={styles.input}
        value={confirm}
      />
      {message ? <Text style={styles.dangerText}>{message}</Text> : null}
      <Pressable
        accessibilityRole="button"
        disabled={!canDelete || busy}
        onPress={() => void deleteAccount()}
        style={[styles.dangerButton, !canDelete || busy ? styles.disabled : null]}
      >
        <Text style={styles.dangerButtonText}>{busy ? "삭제 중…" : "영구 삭제하기"}</Text>
      </Pressable>
    </ScrollView>
  );
}

export function PushPrimingScreen() {
  const [status, setStatus] = useState<PushPermissionStatus>("undetermined");
  const [message, setMessage] = useState<string | null>(null);
  const state = getPushPrimingState(status);

  async function enable() {
    // NOTE(mock): 실제 expo-notifications 권한/토큰 대신 모의 토큰을 등록한다.
    const active = (await supabase.auth.getSession()).data.session as Session | null;
    if (!active) {
      setMessage("로그인이 필요해요.");
      return;
    }
    const { error } = await supabase
      .from("push_tokens")
      .upsert({ user_id: active.user.id, token: `expo-mock-${active.user.id}`, platform: Platform.OS }, { onConflict: "user_id,token" });
    setStatus("granted");
    setMessage(error ? error.message : "알림을 켰어요. (모의 토큰 등록)");
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.kicker}>푸시 알림</Text>
      <Text style={styles.title}>알림을 받아볼까요?</Text>
      <View style={styles.card}>
        <Text style={styles.cardBody}>{state.helper}</Text>
      </View>
      {message ? <Text style={styles.notice}>{message}</Text> : null}
      {!state.granted ? (
        <Pressable accessibilityRole="button" onPress={() => void enable()} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>{state.ctaLabel}</Text>
        </Pressable>
      ) : (
        <Text style={styles.notice}>{state.ctaLabel}</Text>
      )}
      <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.secondaryButton}>
        <Text style={styles.secondaryButtonText}>나중에</Text>
      </Pressable>
    </ScrollView>
  );
}

export function SystemStatusScreen() {
  const [config, setConfig] = useState<SystemConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data } = await supabase.from("app_config").select("latest_build, min_supported_build, maintenance, maintenance_message").eq("id", 1).maybeSingle();
      if (cancelled) return;
      setConfig(
        data
          ? { latest_build: data.latest_build, min_supported_build: data.min_supported_build, maintenance: data.maintenance, maintenance_message: data.maintenance_message }
          : { latest_build: 1, min_supported_build: 1, maintenance: false, maintenance_message: null }
      );
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading || !config) return <Center text="시스템 상태 확인 중" />;

  const gate = getSystemGateState(APP_BUILD, config);

  return (
    <View style={styles.center}>
      <Text style={styles.title}>
        {gate.gate === "force_update" ? "업데이트가 필요해요" : gate.gate === "maintenance" ? "잠시 점검 중이에요" : "정상 동작 중"}
      </Text>
      <Text style={styles.notice}>
        {gate.gate === "maintenance" ? config.maintenance_message ?? "잠시 후 다시 시도해 주세요." : gate.message ?? (gate.updateAvailable ? "새 버전이 있어요." : "최신 버전이에요.")}
      </Text>
    </View>
  );
}

export function ProfileEditScreen() {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("불러오는 중");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const active = (await supabase.auth.getSession()).data.session;
      if (!active) {
        if (!cancelled) {
          setMessage("로그인이 필요해요.");
          setLoading(false);
        }
        return;
      }
      const { data } = await supabase.from("profiles").select("name").eq("id", active.user.id).maybeSingle();
      if (cancelled) return;
      setName(data?.name ?? "");
      setMessage("프로필을 불러왔어요.");
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function save() {
    const active = (await supabase.auth.getSession()).data.session;
    if (!active || !name.trim()) return;
    const { error } = await supabase.from("profiles").update({ name: name.trim() }).eq("id", active.user.id);
    setMessage(error ? error.message : "저장했어요.");
  }

  if (loading) return <Center text={message} />;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.kicker}>프로필</Text>
      <Text style={styles.title}>프로필 편집</Text>
      <TextInput accessibilityLabel="이름" onChangeText={setName} placeholder="이름" style={styles.input} value={name} />
      <Text style={styles.notice}>{message}</Text>
      <Pressable accessibilityRole="button" disabled={!name.trim()} onPress={() => void save()} style={[styles.primaryButton, !name.trim() ? styles.disabled : null]}>
        <Text style={styles.primaryButtonText}>저장</Text>
      </Pressable>
    </ScrollView>
  );
}

const LEGAL_DOCS: Record<string, { title: string; body: string }> = {
  terms: { title: "이용약관", body: "쌤플래너 이용약관 요약본입니다. 자세한 전문은 발행본을 따릅니다." },
  privacy: { title: "개인정보 처리방침", body: "수집 항목·이용 목적·보관 기간을 고지합니다. 만 14세 미만은 보호자 동의가 필요해요." }
};

export function LegalViewerScreen({ doc }: { doc: string }) {
  const content = LEGAL_DOCS[doc] ?? LEGAL_DOCS.terms;
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.kicker}>약관·개인정보</Text>
      <Text style={styles.title}>{content.title}</Text>
      <View style={styles.card}>
        <Text style={styles.cardBody}>{content.body}</Text>
      </View>
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
  content: { padding: spacing.lg, gap: spacing.sm },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.sm, backgroundColor: colors.canvas },
  centerText: { color: colors.muted, fontSize: 15, fontWeight: "700" },
  kicker: { color: colors.flame, fontSize: 13, fontWeight: "900", letterSpacing: 0.4 },
  title: { color: colors.ink, fontSize: 22, fontWeight: "900", lineHeight: 28 },
  notice: { color: colors.muted, fontSize: 14, fontWeight: "700", textAlign: "center" },
  card: { gap: spacing.xs, padding: spacing.lg, borderWidth: 1, borderColor: colors.line, borderRadius: radii.card, backgroundColor: colors.surface, marginTop: spacing.sm },
  dangerCard: { borderColor: colors.danger },
  cardTitle: { color: colors.ink, fontSize: 16, fontWeight: "900" },
  cardBody: { color: colors.muted, fontSize: 14, fontWeight: "700", lineHeight: 22 },
  notifRow: { flexDirection: "row", gap: spacing.md, padding: spacing.md, borderWidth: 1, borderColor: colors.line, borderRadius: radii.control, backgroundColor: colors.surface },
  notifUnread: { borderColor: colors.brand, backgroundColor: "#EEF2FF" },
  notifBadge: { color: colors.brand, fontSize: 12, fontWeight: "900" },
  notifBody: { flex: 1, gap: 2 },
  notifTitle: { color: colors.ink, fontSize: 15, fontWeight: "800" },
  notifSub: { color: colors.muted, fontSize: 13, fontWeight: "700" },
  settingRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: spacing.lg, borderWidth: 1, borderColor: colors.line, borderRadius: radii.control, backgroundColor: colors.surface },
  settingLabel: { color: colors.ink, fontSize: 15, fontWeight: "800" },
  chevron: { color: colors.muted, fontSize: 20, fontWeight: "900" },
  dangerText: { color: colors.danger, fontSize: 14, fontWeight: "800" },
  input: { borderWidth: 1, borderColor: colors.line, borderRadius: radii.control, padding: spacing.md, fontSize: 16, backgroundColor: colors.surface, marginTop: spacing.sm },
  primaryButton: { minHeight: 52, alignItems: "center", justifyContent: "center", borderRadius: radii.button, backgroundColor: colors.brand, marginTop: spacing.sm },
  primaryButtonText: { color: colors.surface, fontSize: 15, fontWeight: "900" },
  secondaryButton: { minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: radii.button, borderWidth: 1, borderColor: colors.line },
  secondaryButtonText: { color: colors.muted, fontSize: 15, fontWeight: "900" },
  dangerButton: { minHeight: 52, alignItems: "center", justifyContent: "center", borderRadius: radii.button, backgroundColor: colors.danger, marginTop: spacing.sm },
  dangerButtonText: { color: colors.surface, fontSize: 15, fontWeight: "900" },
  disabled: { opacity: 0.5 }
});
