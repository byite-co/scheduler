import { useRouter } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";

import { colors, spacing } from "@ssamplanner/design-tokens";

import { useAuth } from "./auth";
import { managementStyles as styles } from "./managementStyles";
import { screenStyles } from "./ui";

export function SettingsScreen() {
  const router = useRouter();
  const { profile, signOut } = useAuth();

  return (
    <ScrollView style={screenStyles.screen} contentContainerStyle={screenStyles.content}>
      <Text style={screenStyles.heading}>설정</Text>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{profile?.name ?? "과외쌤"}</Text>
        <Text style={styles.meta}>{profile?.bio || "소개가 아직 없어요."}</Text>
        <Pressable style={styles.row} onPress={() => router.push("../settings/profile")}>
          <Text style={styles.cardTitle}>프로필 편집</Text>
          <Text style={{ color: colors.muted, fontSize: 22 }}>›</Text>
        </Pressable>
      </View>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>수업 운영</Text>
        <Pressable style={styles.row} onPress={() => router.push("../tools")}>
          <View style={{ flex: 1, gap: spacing.xs }}>
            <Text style={styles.cardTitle}>내 수업 노트</Text>
            <Text style={styles.meta}>수업 회차·결석·취소와 메모를 기록해요.</Text>
          </View>
          <Text style={{ color: colors.muted, fontSize: 22 }}>›</Text>
        </Pressable>
        <Pressable style={styles.row} onPress={() => router.push("../lesson-fees")}>
          <View style={{ flex: 1, gap: spacing.xs }}>
            <Text style={styles.cardTitle}>수업료 관리</Text>
            <Text style={styles.meta}>월 정액·예정 회차·입금 여부를 수기로 관리해요.</Text>
          </View>
          <Text style={{ color: colors.muted, fontSize: 22 }}>›</Text>
        </Pressable>
      </View>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>구독·계정</Text>
        <Pressable style={styles.row} onPress={() => router.push("../billing")}>
          <View style={{ flex: 1, gap: spacing.xs }}>
            <Text style={styles.cardTitle}>구독·정산</Text>
            <Text style={styles.meta}>과외쌤 앱 구독 상태와 월별 인보이스를 확인해요.</Text>
          </View>
          <Text style={{ color: colors.muted, fontSize: 22 }}>›</Text>
        </Pressable>
        <Pressable style={styles.row} onPress={() => router.push("../legal/service")}>
          <Text style={styles.cardTitle}>서비스 이용약관</Text>
          <Text style={{ color: colors.muted, fontSize: 22 }}>›</Text>
        </Pressable>
        <Pressable style={styles.row} onPress={() => router.push("../legal/privacy")}>
          <Text style={styles.cardTitle}>개인정보 처리방침</Text>
          <Text style={{ color: colors.muted, fontSize: 22 }}>›</Text>
        </Pressable>
        <Pressable style={[styles.row, { borderColor: colors.danger }]} onPress={() => router.push("../settings/account/delete")}>
          <View style={{ flex: 1, gap: spacing.xs }}>
            <Text style={[styles.cardTitle, { color: colors.danger }]}>회원 탈퇴</Text>
            <Text style={styles.meta}>계정과 데이터를 영구 삭제합니다.</Text>
          </View>
          <Text style={{ color: colors.danger, fontSize: 22 }}>›</Text>
        </Pressable>
      </View>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>알림</Text>
        <Text style={styles.meta}>앱 안 알림은 하단 알림 탭에서 확인할 수 있어요. 푸시 알림은 아직 지원하지 않습니다.</Text>
      </View>
      <Pressable style={styles.secondaryButton} onPress={() => void signOut()}>
        <Text style={styles.secondaryButtonText}>로그아웃</Text>
      </Pressable>
    </ScrollView>
  );
}
