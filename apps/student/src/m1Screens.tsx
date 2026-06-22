import type { ReactNode } from "react";

import { Link } from "expo-router";
import type { Href } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";

import { colors, radii, spacing } from "@ssamplanner/design-tokens";
import {
  DEFAULT_DISCLOSURE_SCOPE,
  M1_CONNECTION_STATUS_SCREENS,
  canCompleteStudentSignup,
  formatInviteCode,
  getMissingStudentSignupSteps,
  requiresGuardianConsent
} from "@ssamplanner/shared";

const sampleInviteCode = "SSAM24";
const signupSnapshot = {
  name: "김학생",
  birthDate: "2013-06-23",
  grade: "중1",
  termsAccepted: true,
  emailVerified: true,
  guardianConsentAccepted: false
};
const consentRequired = requiresGuardianConsent(signupSnapshot.birthDate, "2026-06-22");
const signupReady = canCompleteStudentSignup(
  { ...signupSnapshot, guardianConsentAccepted: true },
  "2026-06-22"
);
const missingSteps = getMissingStudentSignupSteps(signupSnapshot, "2026-06-22");

export function StudentHomeM1Screen() {
  return (
    <ScreenFrame
      eyebrow="학생 홈"
      title="오늘 공부를 시작하기 전"
      body="가입과 연결 상태를 확인하고, 선생님에게 공개할 범위를 학생이 직접 정합니다."
      primaryHref="/signup"
      primaryLabel="가입 시작"
    >
      <StatusBand label="현재 연결" value={M1_CONNECTION_STATUS_SCREENS.pending.label} />
      <StepList
        steps={[
          ["이메일", "인증 필요"],
          ["프로필", "학년과 목표 입력"],
          ["연결", "초대 코드 입력"],
          ["공개 범위", "학생이 직접 선택"]
        ]}
      />
    </ScreenFrame>
  );
}

export function StudentSignupScreen() {
  return (
    <ScreenFrame
      eyebrow="회원가입"
      title="이메일로 시작"
      body="Supabase Auth 이메일 가입을 기준으로 인증 메일을 보냅니다."
      primaryHref="/signup/terms"
      primaryLabel="인증 메일 확인"
      secondaryHref="/forgot"
      secondaryLabel="비밀번호 찾기"
    >
      <InputRow label="이메일" value="student@example.com" />
      <InputRow label="비밀번호" value="••••••••" secure />
    </ScreenFrame>
  );
}

export function StudentTermsScreen() {
  return (
    <ScreenFrame
      eyebrow="약관"
      title="약관과 보호자 동의"
      body="만 14세 미만이면 보호자 동의가 완료되어야 가입을 끝낼 수 있습니다."
      primaryHref="/signup/profile"
      primaryLabel="동의 완료"
    >
      <ToggleRow label="서비스 이용약관" value />
      <ToggleRow label="개인정보 처리방침" value />
      <ToggleRow label="보호자 동의" value={signupReady} highlight={consentRequired} />
      <Notice tone={consentRequired ? "warning" : "success"}>
        {consentRequired
          ? "생년월일 기준 보호자 동의 단계가 필요합니다."
          : "보호자 동의 없이 진행 가능한 나이입니다."}
      </Notice>
    </ScreenFrame>
  );
}

export function StudentProfileScreen() {
  return (
    <ScreenFrame
      eyebrow="프로필"
      title="공부 기준 입력"
      body="학년과 목표를 저장하면 혼공생 상태로 먼저 사용할 수 있습니다."
      primaryHref="/onboarding/connect"
      primaryLabel="저장"
    >
      <InputRow label="이름" value={signupSnapshot.name} />
      <InputRow label="생년월일" value={signupSnapshot.birthDate} />
      <InputRow label="학년" value={signupSnapshot.grade} />
      <InputRow label="목표 대학" value="서울 주요 대학" />
      <StatusBand label="가입 가능" value={signupReady ? "가능" : missingSteps.join(", ")} />
    </ScreenFrame>
  );
}

export function StudentConnectScreen() {
  return (
    <ScreenFrame
      eyebrow="선생님 연결"
      title="초대 코드 입력"
      body="코드를 입력하면 연결 요청이 pending 상태로 생성되고 선생님 확인을 기다립니다."
      primaryHref="/onboarding/connect/status"
      primaryLabel="요청 보내기"
      secondaryHref="/onboarding/disclosure"
      secondaryLabel="혼자 사용"
    >
      <View style={styles.codeBox}>
        <Text style={styles.codeText}>{formatInviteCode(sampleInviteCode)}</Text>
      </View>
      <StepList
        steps={[
          ["요청자", "학생"],
          ["초대 코드", formatInviteCode(sampleInviteCode)],
          ["다음 상태", M1_CONNECTION_STATUS_SCREENS.pending.label]
        ]}
      />
    </ScreenFrame>
  );
}

export function StudentConnectStatusScreen() {
  return (
    <ScreenFrame
      eyebrow="연결 상태"
      title={M1_CONNECTION_STATUS_SCREENS.pending.heading}
      body="선생님이 요청을 수락하면 active로 바뀌고, 거절되면 데이터 접근은 열리지 않습니다."
      primaryHref="/onboarding/disclosure"
      primaryLabel="공개 범위 설정"
    >
      <StatusBand
        label="현재 상태"
        value={M1_CONNECTION_STATUS_SCREENS.pending.label}
        tone="warning"
      />
      <StepList
        steps={[
          ["대기", "요청 전송 완료"],
          ["수락", "양쪽 화면 active 반영"],
          ["거절", "연결 데이터 비공개"]
        ]}
      />
    </ScreenFrame>
  );
}

export function StudentDisclosureScreen() {
  return (
    <ScreenFrame
      eyebrow="공개 범위"
      title="선생님에게 보일 데이터"
      body="공부 시간, 숙제 사진, 집중 데이터는 학생이 켜 둔 범위 안에서만 선생님에게 보입니다."
      primaryHref="/"
      primaryLabel="완료"
    >
      <ToggleRow label="공부 시간·과목" value={DEFAULT_DISCLOSURE_SCOPE.shareStudyTime} />
      <ToggleRow
        label="숙제·검사 사진"
        value={DEFAULT_DISCLOSURE_SCOPE.shareHomeworkPhotos}
      />
      <ToggleRow label="집중도·졸음 데이터" value={DEFAULT_DISCLOSURE_SCOPE.shareFocusData} />
      <Notice tone="success">공개 범위는 학생만 수정할 수 있습니다.</Notice>
    </ScreenFrame>
  );
}

export function StudentForgotPasswordScreen() {
  return (
    <ScreenFrame
      eyebrow="비밀번호 찾기"
      title="재설정 메일 받기"
      body="가입한 이메일로 Supabase Auth 재설정 링크를 보냅니다."
      primaryHref="/reset"
      primaryLabel="메일 보내기"
    >
      <InputRow label="이메일" value="student@example.com" />
    </ScreenFrame>
  );
}

export function StudentResetPasswordScreen() {
  return (
    <ScreenFrame
      eyebrow="비밀번호 재설정"
      title="새 비밀번호 입력"
      body="메일 링크로 돌아온 뒤 새 비밀번호를 저장하는 화면입니다."
      primaryHref="/"
      primaryLabel="변경 완료"
    >
      <InputRow label="새 비밀번호" value="••••••••" secure />
      <InputRow label="새 비밀번호 확인" value="••••••••" secure />
    </ScreenFrame>
  );
}

function ScreenFrame({
  eyebrow,
  title,
  body,
  primaryHref,
  primaryLabel,
  secondaryHref,
  secondaryLabel,
  children
}: {
  eyebrow: string;
  title: string;
  body: string;
  primaryHref: Href;
  primaryLabel: string;
  secondaryHref?: Href;
  secondaryLabel?: string;
  children: ReactNode;
}) {
  return (
    <ScrollView contentContainerStyle={styles.scrollContent} style={styles.screen}>
      <View style={styles.panel}>
        <Text style={styles.eyebrow}>{eyebrow}</Text>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>{body}</Text>
        <View style={styles.content}>{children}</View>
        <View style={styles.actions}>
          <ActionLink href={primaryHref} label={primaryLabel} variant="primary" />
          {secondaryHref && secondaryLabel ? (
            <ActionLink href={secondaryHref} label={secondaryLabel} variant="secondary" />
          ) : null}
        </View>
      </View>
    </ScrollView>
  );
}

function ActionLink({
  href,
  label,
  variant
}: {
  href: Href;
  label: string;
  variant: "primary" | "secondary";
}) {
  return (
    <Link href={href} asChild>
      <Pressable style={[styles.actionButton, variant === "primary" ? styles.primary : styles.secondary]}>
        <Text style={variant === "primary" ? styles.primaryText : styles.secondaryText}>{label}</Text>
      </Pressable>
    </Link>
  );
}

function InputRow({ label, value, secure = false }: { label: string; value: string; secure?: boolean }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        defaultValue={value}
        secureTextEntry={secure}
        style={styles.input}
        placeholderTextColor={colors.muted}
      />
    </View>
  );
}

function ToggleRow({
  label,
  value,
  highlight = false
}: {
  label: string;
  value: boolean;
  highlight?: boolean;
}) {
  return (
    <View style={styles.toggleRow}>
      <Text style={[styles.toggleLabel, highlight ? styles.warningText : null]}>{label}</Text>
      <Switch
        value={value}
        disabled
        trackColor={{ false: colors.line, true: colors.brand }}
        thumbColor={colors.surface}
      />
    </View>
  );
}

function StepList({ steps }: { steps: Array<[string, string]> }) {
  return (
    <View style={styles.list}>
      {steps.map(([label, value]) => (
        <View key={label} style={styles.stepRow}>
          <Text style={styles.stepLabel}>{label}</Text>
          <Text style={styles.stepValue}>{value}</Text>
        </View>
      ))}
    </View>
  );
}

function StatusBand({
  label,
  value,
  tone = "success"
}: {
  label: string;
  value: string;
  tone?: "success" | "warning";
}) {
  return (
    <View style={styles.statusBand}>
      <Text style={styles.stepLabel}>{label}</Text>
      <Text style={[styles.statusValue, tone === "warning" ? styles.warningText : styles.successText]}>
        {value}
      </Text>
    </View>
  );
}

function Notice({ tone, children }: { tone: "success" | "warning"; children: ReactNode }) {
  return (
    <View style={[styles.notice, tone === "warning" ? styles.noticeWarning : styles.noticeSuccess]}>
      <Text style={[styles.noticeText, tone === "warning" ? styles.warningText : styles.successText]}>
        {children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.canvas
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    padding: spacing.xl
  },
  panel: {
    gap: spacing.lg,
    width: "100%",
    maxWidth: 520,
    alignSelf: "center",
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.card,
    backgroundColor: colors.surface,
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.08,
    shadowRadius: 40,
    elevation: 4
  },
  eyebrow: {
    color: colors.brand,
    fontSize: 13,
    fontWeight: "800"
  },
  title: {
    color: colors.ink,
    fontSize: 28,
    fontWeight: "800",
    lineHeight: 34
  },
  body: {
    color: colors.muted,
    fontSize: 16,
    lineHeight: 24
  },
  content: {
    gap: spacing.md
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  actionButton: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.button
  },
  primary: {
    backgroundColor: colors.brand
  },
  secondary: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface
  },
  primaryText: {
    color: colors.surface,
    fontSize: 14,
    fontWeight: "800"
  },
  secondaryText: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: "800"
  },
  field: {
    gap: spacing.xs
  },
  fieldLabel: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "800"
  },
  input: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.control,
    backgroundColor: colors.canvas,
    color: colors.ink,
    fontSize: 15,
    fontWeight: "700"
  },
  codeBox: {
    alignItems: "center",
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.control,
    backgroundColor: colors.canvas
  },
  codeText: {
    color: colors.ink,
    fontSize: 30,
    fontVariant: ["tabular-nums"],
    fontWeight: "800"
  },
  list: {
    gap: spacing.sm
  },
  stepRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.line
  },
  stepLabel: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "800"
  },
  stepValue: {
    flex: 1,
    color: colors.ink,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
    textAlign: "right"
  },
  toggleRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.line
  },
  toggleLabel: {
    flex: 1,
    color: colors.ink,
    fontSize: 15,
    fontWeight: "800"
  },
  statusBand: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.control,
    backgroundColor: colors.canvas
  },
  statusValue: {
    fontSize: 14,
    fontWeight: "800"
  },
  notice: {
    padding: spacing.md,
    borderRadius: radii.control
  },
  noticeSuccess: {
    backgroundColor: "rgba(21, 166, 107, 0.1)"
  },
  noticeWarning: {
    backgroundColor: "rgba(224, 161, 0, 0.12)"
  },
  noticeText: {
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 20
  },
  successText: {
    color: colors.success
  },
  warningText: {
    color: "#7A5700"
  }
});
