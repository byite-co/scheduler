import { useCallback, useEffect, useState, type ReactNode } from "react";

import { Link, useRouter } from "expo-router";
import type { Href } from "expo-router";
import type { Session } from "@supabase/supabase-js";
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";

import { colors, radii, spacing, tints } from "@ssamplanner/design-tokens";
import {
  DEFAULT_DISCLOSURE_SCOPE,
  canCompleteStudentSignup,
  canRequestConnectionAgain,
  formatInviteCode,
  getMissingStudentSignupSteps,
  normalizeInviteCode,
  requiresGuardianConsent
} from "@ssamplanner/shared";
import type { ConnectionStatus, Database } from "@ssamplanner/shared";

import { supabase } from "./supabaseClient";

type ConnectionRow = Database["public"]["Tables"]["connections"]["Row"];
type DisclosureRow = Database["public"]["Tables"]["disclosure_settings"]["Row"];
type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];

// 온보딩 단계 간 동의 상태 전달(약관 화면 → 프로필 화면). 같은 SPA 세션에서 유지된다.
const onboardingConsent = { termsAccepted: false, privacyAccepted: false };

// 가입/온보딩/로그인 후 갈 곳을 세션·온보딩 상태로 결정한다.
async function resolvePostAuthRoute(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user.id;
  if (!userId) return "/login";
  const profile = await supabase.from("profiles").select("onboarded").eq("id", userId).maybeSingle();
  return profile.data?.onboarded ? "/today" : "/signup/profile";
}

function useStudentData() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [connections, setConnections] = useState<ConnectionRow[]>([]);
  const [disclosures, setDisclosures] = useState<DisclosureRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("세션 확인 중");

  const refresh = useCallback(async (nextSession?: Session | null) => {
    const activeSession = nextSession ?? (await supabase.auth.getSession()).data.session;
    setSession(activeSession);

    if (!activeSession) {
      setProfile(null);
      setConnections([]);
      setDisclosures([]);
      setMessage("가입 또는 로그인이 필요합니다.");
      setLoading(false);
      return;
    }

    setLoading(true);
    const userId = activeSession.user.id;
    const [profileResult, connectionsResult] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      supabase
        .from("connections")
        .select("*")
        .eq("student_id", userId)
        .order("created_at", { ascending: false })
    ]);

    setProfile(profileResult.data);
    setConnections(connectionsResult.data ?? []);

    const connectionIds = (connectionsResult.data ?? []).map((connection) => connection.id);
    if (connectionIds.length) {
      const disclosureResult = await supabase
        .from("disclosure_settings")
        .select("*")
        .in("connection_id", connectionIds);
      setDisclosures(disclosureResult.data ?? []);
    } else {
      setDisclosures([]);
    }

    setMessage(profileResult.error?.message ?? "");
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      void refresh(nextSession);
    });

    return () => data.subscription.unsubscribe();
  }, [refresh]);

  return {
    session,
    profile,
    connections,
    disclosures,
    loading,
    message,
    refresh,
    setMessage
  };
}

function AuthFrame({
  title,
  subtitle,
  message,
  children,
  footer
}: {
  title: string;
  subtitle: string;
  message: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <ScrollView contentContainerStyle={styles.authScroll} style={styles.screen}>
      <View style={styles.authPanel}>
        <View style={styles.appIcon}>
          <Text style={styles.appIconText}>쌤</Text>
        </View>
        <Text style={styles.authTitle}>{title}</Text>
        <Text style={styles.authSubtitle}>{subtitle}</Text>
        <View style={styles.authForm}>{children}</View>
        {message ? <Notice tone="success">{message}</Notice> : null}
        {footer}
      </View>
    </ScrollView>
  );
}

function AuthFooter({ prompt, label, href }: { prompt: string; label: string; href: Href }) {
  return (
    <View style={styles.authFooter}>
      <Text style={styles.authFooterText}>{prompt} </Text>
      <Link href={href} asChild>
        <Pressable accessibilityRole="button">
          <Text style={styles.authFooterLink}>{label}</Text>
        </Pressable>
      </Link>
    </View>
  );
}

export function StudentSignupScreen() {
  const data = useStudentData();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function signUp() {
    const { data: result, error } = await supabase.auth.signUp({ email, password });
    if (error) {
      data.setMessage(error.message);
      return;
    }
    await data.refresh(result.session ?? undefined);
    if (result.session) {
      // 가입 즉시 로그인됨 → 온보딩(약관)으로 자동 이동.
      router.replace("/signup/terms");
    } else {
      data.setMessage("가입 요청을 보냈어요. 인증 메일의 링크를 누른 뒤 로그인해 주세요.");
    }
  }

  return (
    <AuthFrame
      title="쌤플래너 시작하기"
      subtitle="공부 타이머·플래너·집중 모드를 한 곳에서"
      message={data.message}
      footer={<AuthFooter href={"/login" as Href} label="로그인" prompt="이미 계정이 있나요?" />}
    >
      <InputRow keyboardType="email-address" onChange={setEmail} placeholder="이메일" value={email} />
      <InputRow onChange={setPassword} placeholder="비밀번호" secure value={password} />
      <ActionButton label="이메일로 가입" onPress={() => void signUp()} variant="primary" />
    </AuthFrame>
  );
}

export function StudentLoginScreen() {
  const data = useStudentData();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function logIn() {
    const { data: result, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      data.setMessage(error.message);
      return;
    }
    await data.refresh(result.session ?? undefined);
    // 온보딩 완료면 홈, 아니면 남은 온보딩(프로필)으로 자동 이동.
    router.replace((await resolvePostAuthRoute()) as Href);
  }

  return (
    <AuthFrame
      title="다시 만나서 반가워요"
      subtitle="이메일로 로그인하고 오늘 공부를 이어가요"
      message={data.message}
      footer={<AuthFooter href={"/signup" as Href} label="가입" prompt="처음이신가요?" />}
    >
      <InputRow keyboardType="email-address" onChange={setEmail} placeholder="이메일" value={email} />
      <InputRow onChange={setPassword} placeholder="비밀번호" secure value={password} />
      <ActionButton label="로그인" onPress={() => void logIn()} variant="primary" />
      <Link href={"/forgot" as Href} asChild>
        <Pressable accessibilityRole="button" style={styles.textLink}>
          <Text style={styles.textLinkLabel}>비밀번호 찾기</Text>
        </Pressable>
      </Link>
    </AuthFrame>
  );
}

export function StudentTermsScreen() {
  const data = useStudentData();
  const router = useRouter();
  const [termsAccepted, setTermsAccepted] = useState(onboardingConsent.termsAccepted);
  const [privacyAccepted, setPrivacyAccepted] = useState(onboardingConsent.privacyAccepted);
  const canContinue = termsAccepted && privacyAccepted;

  function continueToProfile() {
    onboardingConsent.termsAccepted = termsAccepted;
    onboardingConsent.privacyAccepted = privacyAccepted;
    router.replace("/signup/profile");
  }

  return (
    <ScreenFrame
      eyebrow="약관 동의 · 2/3"
      title="약관에 동의해 주세요"
      body="서비스 이용약관과 개인정보 처리방침에 동의하면 프로필 입력으로 넘어가요. (보호자 동의는 생년월일 입력 후 필요한 경우에만)"
      message={data.message}
    >
      <ToggleRow label="서비스 이용약관 (필수)" value={termsAccepted} onValueChange={setTermsAccepted} />
      <ToggleRow label="개인정보 처리방침 (필수)" value={privacyAccepted} onValueChange={setPrivacyAccepted} />
      <Notice tone={canContinue ? "success" : "warning"}>
        {canContinue ? "동의 완료! 다음 단계로 넘어가요." : "필수 약관에 모두 동의해야 계속할 수 있어요."}
      </Notice>
      <ActionButton
        label="동의하고 계속"
        onPress={() => {
          if (!canContinue) {
            data.setMessage("필수 약관에 동의해 주세요.");
            return;
          }
          continueToProfile();
        }}
        variant="primary"
      />
    </ScreenFrame>
  );
}

export function StudentProfileScreen() {
  const data = useStudentData();
  const router = useRouter();
  const [name, setName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [grade, setGrade] = useState("중1");
  const [targetUniv, setTargetUniv] = useState("");
  const [guardianConsentAccepted, setGuardianConsentAccepted] = useState(false);

  useEffect(() => {
    setName(data.profile?.name ?? "");
    setBirthDate(data.profile?.birth_date ?? "");
    setGrade(data.profile?.grade ?? "중1");
    setTargetUniv(data.profile?.target_univ ?? "");
    setGuardianConsentAccepted(Boolean(data.profile?.guardian_consented_at));
  }, [data.profile]);

  const consentRequired = requiresGuardianConsent(birthDate, new Date());

  async function saveProfile() {
    if (!data.session) {
      data.setMessage("로그인 후 프로필을 저장할 수 있습니다.");
      return;
    }

    const signupState = {
      name,
      birthDate,
      grade,
      // 약관 동의는 이전 약관 단계에서 받았다(이미 동의했거나, 재가입 시 기존 동의 인정).
      termsAccepted: onboardingConsent.termsAccepted || Boolean(data.profile?.onboarded),
      emailVerified: Boolean(data.session),
      guardianConsentAccepted
    };
    const missing = getMissingStudentSignupSteps(signupState, new Date());

    if (!canCompleteStudentSignup(signupState, new Date())) {
      data.setMessage(`가입 완료 불가: ${missing.join(", ")}`);
      return;
    }

    const { error } = await supabase.from("profiles").upsert({
      id: data.session.user.id,
      role: "student",
      name,
      birth_date: birthDate,
      grade,
      target_univ: targetUniv,
      guardian_consented_at: guardianConsentAccepted ? new Date().toISOString() : null,
      onboarded: true
    });

    if (error) {
      data.setMessage(error.message);
      return;
    }
    await data.refresh();
    // 프로필 저장 완료 → 바로 홈으로.
    router.replace("/today");
  }

  return (
    <ScreenFrame
      eyebrow="프로필 · 3/3"
      title="공부 기준 입력"
      body="이름·생년월일·학년을 저장하면 바로 홈에서 공부를 시작할 수 있어요."
      message={data.message}
    >
      <InputRow label="이름" value={name} onChange={setName} placeholder="이름" />
      <InputRow label="생년월일" value={birthDate} onChange={setBirthDate} placeholder="YYYY-MM-DD" />
      <InputRow label="학년" value={grade} onChange={setGrade} />
      <InputRow label="목표 대학(선택)" value={targetUniv} onChange={setTargetUniv} />
      {consentRequired ? (
        <>
          <ToggleRow
            label="보호자 동의 (만 14세 미만 필수)"
            value={guardianConsentAccepted}
            onValueChange={setGuardianConsentAccepted}
            highlight={!guardianConsentAccepted}
          />
          <Notice tone={guardianConsentAccepted ? "success" : "warning"}>
            {guardianConsentAccepted
              ? "보호자 동의가 확인됐어요."
              : "만 14세 미만이라 보호자 동의가 필요해요."}
          </Notice>
        </>
      ) : null}
      <ActionButton label="프로필 저장하고 시작" onPress={() => void saveProfile()} variant="primary" />
    </ScreenFrame>
  );
}

export function StudentConnectScreen() {
  const data = useStudentData();
  const [inviteCode, setInviteCode] = useState("");
  const latestStatus = data.connections[0]?.status as ConnectionStatus | undefined;

  async function requestConnection() {
    if (!data.session) {
      data.setMessage("로그인 후 연결 요청을 보낼 수 있습니다.");
      return;
    }
    if (!data.profile?.onboarded) {
      data.setMessage("학생 프로필 저장을 먼저 완료해 주세요.");
      return;
    }
    if (!canRequestConnectionAgain(latestStatus)) {
      data.setMessage("이미 진행 중이거나 active 상태인 연결이 있습니다.");
      return;
    }

    const { data: connection, error } = await supabase.rpc("request_connection_by_invite", {
      p_code: normalizeInviteCode(inviteCode)
    });

    data.setMessage(error ? error.message : `연결 요청이 ${connection.status} 상태로 저장되었습니다.`);
    await data.refresh();
  }

  return (
    <ScreenFrame
      eyebrow="선생님 연결"
      title="초대 코드 입력"
      body="코드를 입력하면 선생님께 연결 요청을 보내요. 거절돼도 언제든 다시 요청할 수 있어요."
      primaryHref="/onboarding/connect/status"
      primaryLabel="상태 확인"
      secondaryHref="/onboarding/disclosure"
      secondaryLabel="공개 범위"
      message={data.message}
    >
      <InputRow label="초대 코드" value={inviteCode} onChange={setInviteCode} autoCapitalize="characters" />
      <ActionButton label="요청 보내기" onPress={() => void requestConnection()} variant="primary" />
      <StepList
        steps={[
          ["최근 상태", latestStatus ?? "없음"],
          ["재요청 가능", canRequestConnectionAgain(latestStatus) ? "가능" : "불가"],
          ["입력 코드", inviteCode ? formatInviteCode(inviteCode) : "-"]
        ]}
      />
    </ScreenFrame>
  );
}

export function StudentConnectStatusScreen() {
  const data = useStudentData();

  return (
    <ScreenFrame
      eyebrow="연결 상태"
      title="DB 연결 상태"
      body="선생님이 수락하면 active, 거절하면 rejected로 실제 DB 상태가 바뀝니다."
      primaryHref="/onboarding/connect"
      primaryLabel="다시 요청"
      secondaryHref="/onboarding/disclosure"
      secondaryLabel="공개 범위 설정"
      message={data.message}
    >
      {data.connections.length ? (
        <StepList
          steps={data.connections.map((connection) => [
            connection.invite_code ? formatInviteCode(connection.invite_code) : connection.id.slice(0, 8),
            connection.status
          ])}
        />
      ) : (
        <Notice tone="warning">아직 연결 요청이 없습니다.</Notice>
      )}
    </ScreenFrame>
  );
}

export function StudentDisclosureScreen() {
  const data = useStudentData();
  const connection = data.connections.find((row) => row.status === "active") ?? data.connections[0];
  const disclosure = data.disclosures.find((row) => row.connection_id === connection?.id);
  const [shareStudyTime, setShareStudyTime] = useState(DEFAULT_DISCLOSURE_SCOPE.shareStudyTime);
  const [shareHomeworkPhotos, setShareHomeworkPhotos] = useState(DEFAULT_DISCLOSURE_SCOPE.shareHomeworkPhotos);
  const [shareFocusData, setShareFocusData] = useState(DEFAULT_DISCLOSURE_SCOPE.shareFocusData);

  useEffect(() => {
    setShareStudyTime(disclosure?.share_study_time ?? DEFAULT_DISCLOSURE_SCOPE.shareStudyTime);
    setShareHomeworkPhotos(disclosure?.share_homework_photos ?? DEFAULT_DISCLOSURE_SCOPE.shareHomeworkPhotos);
    setShareFocusData(disclosure?.share_focus_data ?? DEFAULT_DISCLOSURE_SCOPE.shareFocusData);
  }, [disclosure]);

  async function saveDisclosure() {
    if (!connection) {
      data.setMessage("공개 범위를 저장할 연결이 없습니다.");
      return;
    }

    const { error } = await supabase.from("disclosure_settings").upsert({
      connection_id: connection.id,
      share_study_time: shareStudyTime,
      share_homework_photos: shareHomeworkPhotos,
      share_focus_data: shareFocusData
    });

    data.setMessage(error ? error.message : "공개 범위를 저장했습니다.");
    await data.refresh();
  }

  return (
    <ScreenFrame
      eyebrow="공개 범위"
      title="선생님에게 보일 데이터"
      body="공부 시간, 숙제 사진, 집중 데이터는 학생이 켜 둔 범위 안에서만 선생님에게 보입니다."
      primaryHref="/"
      primaryLabel="홈"
      message={data.message}
    >
      <ToggleRow label="공부 시간·과목" value={shareStudyTime} onValueChange={setShareStudyTime} />
      <ToggleRow label="숙제·검사 사진" value={shareHomeworkPhotos} onValueChange={setShareHomeworkPhotos} />
      <ToggleRow label="집중도·졸음 데이터" value={shareFocusData} onValueChange={setShareFocusData} />
      <ActionButton label="공개 범위 저장" onPress={() => void saveDisclosure()} variant="primary" />
      <Notice tone="success">RLS 정책상 학생만 수정할 수 있고 선생님은 읽기만 가능합니다.</Notice>
    </ScreenFrame>
  );
}

export function StudentForgotPasswordScreen() {
  const data = useStudentData();
  const [email, setEmail] = useState("");

  async function resetPassword() {
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    data.setMessage(error ? error.message : "비밀번호 재설정 메일을 보냈습니다.");
  }

  return (
    <ScreenFrame
      eyebrow="비밀번호 찾기"
      title="재설정 메일 받기"
      body="가입한 이메일로 비밀번호 재설정 링크를 보내요."
      primaryHref="/reset"
      primaryLabel="새 비밀번호"
      message={data.message}
    >
      <InputRow label="이메일" value={email} onChange={setEmail} keyboardType="email-address" />
      <ActionButton label="메일 보내기" onPress={() => void resetPassword()} variant="primary" />
    </ScreenFrame>
  );
}

export function StudentResetPasswordScreen() {
  const data = useStudentData();
  const [password, setPassword] = useState("");

  async function updatePassword() {
    const { error } = await supabase.auth.updateUser({ password });
    data.setMessage(error ? error.message : "비밀번호를 변경했습니다.");
  }

  return (
    <ScreenFrame
      eyebrow="비밀번호 재설정"
      title="새 비밀번호 입력"
      body="메일 링크로 돌아온 뒤 새 비밀번호를 저장하는 화면입니다."
      primaryHref="/"
      primaryLabel="홈"
      message={data.message}
    >
      <InputRow label="새 비밀번호" value={password} onChange={setPassword} secure />
      <ActionButton label="변경 완료" onPress={() => void updatePassword()} variant="primary" />
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
  message,
  children
}: {
  eyebrow: string;
  title: string;
  body: string;
  primaryHref?: Href;
  primaryLabel?: string;
  secondaryHref?: Href;
  secondaryLabel?: string;
  message: string;
  children: ReactNode;
}) {
  return (
    <ScrollView contentContainerStyle={styles.scrollContent} style={styles.screen}>
      <View style={styles.panel}>
        <Text style={styles.eyebrow}>{eyebrow}</Text>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>{body}</Text>
        {message ? <Notice tone="success">{message}</Notice> : null}
        <View style={styles.content}>{children}</View>
        {primaryHref && primaryLabel ? (
          <View style={styles.actions}>
            <ActionLink href={primaryHref} label={primaryLabel} variant="primary" />
            {secondaryHref && secondaryLabel ? (
              <ActionLink href={secondaryHref} label={secondaryLabel} variant="secondary" />
            ) : null}
          </View>
        ) : null}
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
      <Pressable style={StyleSheet.flatten([styles.actionButton, variant === "primary" ? styles.primary : styles.secondary])}>
        <Text style={variant === "primary" ? styles.primaryText : styles.secondaryText}>{label}</Text>
      </Pressable>
    </Link>
  );
}

function ActionButton({
  label,
  onPress,
  variant
}: {
  label: string;
  onPress: () => void;
  variant: "primary" | "secondary";
}) {
  return (
    <Pressable onPress={onPress} style={[styles.actionButton, variant === "primary" ? styles.primary : styles.secondary]}>
      <Text style={variant === "primary" ? styles.primaryText : styles.secondaryText}>{label}</Text>
    </Pressable>
  );
}

function InputRow({
  label,
  value,
  onChange,
  secure = false,
  keyboardType = "default",
  autoCapitalize = "none",
  placeholder
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  secure?: boolean;
  keyboardType?: "default" | "email-address";
  autoCapitalize?: "none" | "characters";
  placeholder?: string;
}) {
  return (
    <View style={styles.field}>
      {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      <TextInput
        autoCapitalize={autoCapitalize}
        keyboardType={keyboardType}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        secureTextEntry={secure}
        style={styles.input}
        value={value}
      />
    </View>
  );
}

function ToggleRow({
  label,
  value,
  onValueChange,
  highlight = false
}: {
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  highlight?: boolean;
}) {
  return (
    <View style={styles.toggleRow}>
      <Text style={[styles.toggleLabel, highlight ? styles.warningText : null]}>{label}</Text>
      <Switch
        onValueChange={onValueChange}
        trackColor={{ false: colors.line, true: colors.brand }}
        thumbColor={colors.surface}
        value={value}
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
    color: tints.warningStrong
  },
  authScroll: {
    flexGrow: 1,
    justifyContent: "center",
    padding: spacing.xl
  },
  authPanel: {
    gap: spacing.md,
    width: "100%",
    maxWidth: 480,
    alignSelf: "center"
  },
  appIcon: {
    width: 64,
    height: 64,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
    backgroundColor: colors.ink,
    marginBottom: spacing.sm
  },
  appIconText: {
    color: colors.surface,
    fontSize: 22,
    fontWeight: "900"
  },
  authTitle: {
    color: colors.ink,
    fontSize: 28,
    fontWeight: "900",
    lineHeight: 34
  },
  authSubtitle: {
    color: colors.muted,
    fontSize: 15,
    fontWeight: "700",
    marginBottom: spacing.sm
  },
  authForm: {
    gap: spacing.md
  },
  authFooter: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginTop: spacing.lg
  },
  authFooterText: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: "700"
  },
  authFooterLink: {
    color: colors.brand,
    fontSize: 14,
    fontWeight: "900"
  },
  textLink: {
    alignItems: "center",
    paddingVertical: spacing.sm
  },
  textLinkLabel: {
    color: colors.brand,
    fontSize: 14,
    fontWeight: "800"
  }
});
