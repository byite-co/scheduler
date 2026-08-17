import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { colors, radii, spacing, tints } from "@ssamplanner/design-tokens";
import { SUBJECT_LABELS, type SubjectCode } from "@ssamplanner/shared";

import { useAuth } from "./auth";
import { AppIcon } from "./icons";
import { BrandMark, Field, LoadingState, PrimaryButton, TextButton, screenStyles } from "./ui";
import { supabase } from "./supabaseClient";

function AuthPage({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView
      contentContainerStyle={screenStyles.content}
      keyboardShouldPersistTaps="handled"
      style={screenStyles.screen}
    >
      {children}
    </ScrollView>
  );
}

function PublicOnly({ children }: { children: React.ReactNode }) {
  const { session, profile, loading } = useAuth();

  if (loading) return <LoadingState label="계정 정보를 확인하는 중…" />;
  if (session && profile?.onboarded) return <Redirect href="/(tabs)" />;
  if (session) return <Redirect href="/onboarding/profile" />;
  return <>{children}</>;
}

function BackButton() {
  return (
    <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.backButton}>
      <AppIcon color={colors.brand} name="arrowLeft" size={20} />
      <Text style={styles.backButtonText}>돌아가기</Text>
    </Pressable>
  );
}

export function LoginScreen() {
  const { setMessage } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function login() {
    if (!email.trim() || !password) {
      setMessage("이메일과 비밀번호를 입력해 주세요.");
      return;
    }

    setSubmitting(true);
    setMessage(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setSubmitting(false);
    if (error) setMessage(error.message);
  }

  return (
    <PublicOnly>
      <AuthPage>
        <View style={styles.loginHero}>
          <BrandMark />
          <Text style={styles.brandName}>쌤플래너</Text>
          <Text style={screenStyles.subtitle}>과외쌤을 위한 학생 관리 앱</Text>
        </View>
        <View style={styles.form}>
          <Field label="이메일" value={email} onChangeText={setEmail} placeholder="name@example.com" />
          <Field label="비밀번호" value={password} onChangeText={setPassword} secureTextEntry placeholder="8자 이상" />
          <View style={styles.alignEnd}>
            <TextButton onPress={() => router.push("/forgot")}>비밀번호 찾기</TextButton>
          </View>
          <PrimaryButton disabled={submitting} onPress={() => void login()}>
            {submitting ? "로그인 중…" : "로그인"}
          </PrimaryButton>
        </View>
        <View style={screenStyles.linkRow}>
          <Text style={screenStyles.muted}>아직 계정이 없나요?</Text>
          <TextButton onPress={() => router.push("/signup")}>가입하기</TextButton>
        </View>
      </AuthPage>
    </PublicOnly>
  );
}

export function SignupScreen() {
  const { setMessage } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [serviceTerms, setServiceTerms] = useState(false);
  const [privacyTerms, setPrivacyTerms] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function signup() {
    if (!email.trim()) {
      setMessage("이메일을 입력해 주세요.");
      return;
    }
    if (password.length < 8) {
      setMessage("비밀번호는 8자 이상 입력해 주세요.");
      return;
    }
    if (!serviceTerms || !privacyTerms) {
      setMessage("필수 약관에 동의해 주세요.");
      return;
    }

    setSubmitting(true);
    setMessage(null);
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { role: "teacher" } }
    });
    setSubmitting(false);

    if (error) {
      setMessage(error.message);
      return;
    }
    if (!data.session) {
      setMessage("인증 메일을 보냈어요. 이메일 인증 후 로그인해 주세요.");
      return;
    }
    router.replace("/onboarding/profile");
  }

  return (
    <PublicOnly>
      <AuthPage>
        <View style={styles.topRow}>
          <BrandMark />
          <View style={styles.compactTitle}>
            <Text style={screenStyles.heading}>과외쌤으로 가입</Text>
            <Text style={screenStyles.subtitle}>학생을 초대하고 공부를 관리하세요</Text>
          </View>
        </View>
        <View style={styles.form}>
          <Field label="이메일" value={email} onChangeText={setEmail} placeholder="name@example.com" />
          <Field label="비밀번호" value={password} onChangeText={setPassword} secureTextEntry placeholder="8자 이상" />
          <TermsRow
            checked={serviceTerms}
            label="(필수) 서비스 이용약관"
            onPress={() => setServiceTerms((current) => !current)}
            onView={() => router.push("/legal/service")}
          />
          <TermsRow
            checked={privacyTerms}
            label="(필수) 개인정보 처리방침"
            onPress={() => setPrivacyTerms((current) => !current)}
            onView={() => router.push("/legal/privacy")}
          />
          <PrimaryButton disabled={submitting} onPress={() => void signup()}>
            {submitting ? "가입 중…" : "동의하고 가입하기"}
          </PrimaryButton>
        </View>
        <View style={screenStyles.linkRow}>
          <Text style={screenStyles.muted}>이미 계정이 있나요?</Text>
          <TextButton onPress={() => router.replace("/login")}>로그인</TextButton>
        </View>
      </AuthPage>
    </PublicOnly>
  );
}

function TermsRow({
  checked,
  label,
  onPress,
  onView
}: {
  checked: boolean;
  label: string;
  onPress: () => void;
  onView: () => void;
}) {
  return (
    <View style={styles.terms}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        onPress={onPress}
        style={styles.termsChoice}
      >
        <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
          {checked ? <AppIcon color={colors.surface} name="check" size={15} /> : null}
        </View>
        <Text style={styles.termsLabel}>{label}</Text>
      </Pressable>
      <TextButton onPress={onView}>보기</TextButton>
    </View>
  );
}

export function ForgotPasswordScreen() {
  const { setMessage } = useAuth();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function sendReset() {
    if (!email.trim()) {
      setMessage("이메일을 입력해 주세요.");
      return;
    }

    setSubmitting(true);
    setMessage(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
    setSubmitting(false);
    setMessage(error ? error.message : "재설정 안내를 이메일로 보냈어요.");
  }

  return (
    <PublicOnly>
      <AuthPage>
        <BackButton />
        <View style={styles.iconCircle}>
          <AppIcon name="mail" size={40} color={colors.brand} />
        </View>
        <Text style={screenStyles.heading}>비밀번호를 잊으셨나요?</Text>
        <Text style={screenStyles.subtitle}>가입한 이메일을 입력하면 재설정 안내를 보내드려요.</Text>
        <View style={styles.form}>
          <Field label="이메일" value={email} onChangeText={setEmail} placeholder="name@example.com" />
          <PrimaryButton disabled={submitting} onPress={() => void sendReset()}>
            {submitting ? "보내는 중…" : "재설정 코드 받기"}
          </PrimaryButton>
        </View>
      </AuthPage>
    </PublicOnly>
  );
}

export function ProfileScreen() {
  const { session, profile, setMessage, refreshProfile } = useAuth();
  const [name, setName] = useState(profile?.name ?? "");
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [subjects, setSubjects] = useState<SubjectCode[]>(
    profile?.subjects?.length ? profile.subjects : ["math", "english"]
  );
  const [submitting, setSubmitting] = useState(false);

  if (!session) return <Redirect href="/login" />;
  const teacherSession = session;

  async function save() {
    if (!name.trim()) {
      setMessage("이름을 입력해 주세요.");
      return;
    }

    setSubmitting(true);
    setMessage(null);
    const { error } = await supabase.from("profiles").upsert({
      id: teacherSession.user.id,
      role: "teacher",
      name: name.trim(),
      bio: bio.trim() || null,
      subjects,
      onboarded: true
    });
    setSubmitting(false);

    if (error) {
      setMessage(error.message);
      return;
    }
    await refreshProfile();
    router.replace("/(tabs)");
  }

  function toggle(subject: SubjectCode) {
    setSubjects((current) =>
      current.includes(subject) ? current.filter((item) => item !== subject) : [...current, subject]
    );
  }

  return (
    <AuthPage>
      <View style={styles.progress}>
        <View style={styles.progressDone} />
        <View style={styles.progressDone} />
        <View style={styles.progressTodo} />
      </View>
      <Text style={screenStyles.heading}>선생님 프로필</Text>
      <Text style={screenStyles.subtitle}>학생·학부모에게 이렇게 보여요.</Text>
      <View style={styles.form}>
        <Field label="이름" value={name} onChangeText={setName} autoCapitalize="words" placeholder="이름" />
        <Text style={styles.label}>담당 과목</Text>
        <View style={styles.chips}>
          {(Object.keys(SUBJECT_LABELS) as SubjectCode[]).map((subject) => {
            const selected = subjects.includes(subject);
            return (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected }}
                key={subject}
                onPress={() => toggle(subject)}
                style={[styles.subjectChip, selected && styles.subjectChipSelected]}
              >
                <Text style={[styles.subjectChipText, selected && styles.subjectChipTextSelected]}>
                  {SUBJECT_LABELS[subject]}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Field label="한 줄 소개" value={bio} onChangeText={setBio} autoCapitalize="words" placeholder="수업 소개를 입력해 주세요" />
        <PrimaryButton disabled={submitting} onPress={() => void save()}>
          {submitting ? "저장 중…" : "다음"}
        </PrimaryButton>
      </View>
    </AuthPage>
  );
}

export function LegalScreen() {
  const { doc } = useLocalSearchParams<{ doc: string }>();
  const isPrivacy = doc === "privacy";
  const title = isPrivacy ? "개인정보 처리방침" : "서비스 이용약관";

  return (
    <AuthPage>
      <BackButton />
      <View style={styles.iconCircle}>
        <AppIcon name="book" size={38} color={colors.brand} />
      </View>
      <Text style={screenStyles.heading}>{title}</Text>
      <Text style={screenStyles.subtitle}>정식 문서 준비 중 · 출시 전에 확정된 전문으로 교체합니다.</Text>
      <View style={styles.legal}>
        <Text style={styles.legalTitle}>제1조 목적</Text>
        <Text style={styles.legalBody}>
          이 문서는 쌤플래너 과외쌤 앱의 기본 이용 조건을 안내합니다. 정식 약관 전문은 출시 전 법무 검토 및 운영 문서와 함께 확정됩니다.
        </Text>
        <Text style={styles.legalTitle}>데이터 이용</Text>
        <Text style={styles.legalBody}>
          학생 데이터는 활성 연결 및 학생의 공개범위 안에서만 조회됩니다. 이 앱은 해당 접근 범위를 우회하지 않습니다.
        </Text>
      </View>
    </AuthPage>
  );
}

const styles = StyleSheet.create({
  alignEnd: { alignItems: "flex-end", marginTop: -spacing.sm },
  backButton: { alignItems: "center", alignSelf: "flex-start", flexDirection: "row", gap: spacing.xs },
  backButtonText: { color: colors.brand, fontSize: 15, fontWeight: "800" },
  brandName: { color: colors.ink, fontSize: 30, fontWeight: "900", marginTop: spacing.lg },
  checkbox: {
    alignItems: "center",
    borderColor: colors.line,
    borderRadius: radii.control,
    borderWidth: 1.5,
    height: 24,
    justifyContent: "center",
    width: 24
  },
  checkboxChecked: { backgroundColor: colors.brand, borderColor: colors.brand },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  compactTitle: { flex: 1, gap: spacing.xs },
  form: { gap: spacing.md },
  iconCircle: {
    alignItems: "center",
    backgroundColor: tints.brandSoft,
    borderRadius: 28,
    height: 96,
    justifyContent: "center",
    marginTop: spacing.xl,
    width: 96
  },
  label: { color: colors.ink, fontSize: 15, fontWeight: "700" },
  legal: { backgroundColor: colors.surface, borderRadius: radii.card, gap: spacing.md, padding: spacing.lg },
  legalBody: { color: colors.muted, fontSize: 15, fontWeight: "500", lineHeight: 23 },
  legalTitle: { color: colors.ink, fontSize: 17, fontWeight: "800" },
  loginHero: { alignItems: "center", gap: spacing.sm, marginTop: 70 },
  progress: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  progressDone: { backgroundColor: colors.brand, borderRadius: radii.chip, flex: 1, height: 8 },
  progressTodo: { backgroundColor: colors.line, borderRadius: radii.chip, flex: 1, height: 8 },
  subjectChip: {
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: radii.chip,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  subjectChipSelected: { backgroundColor: colors.brand, borderColor: colors.brand },
  subjectChipText: { color: colors.ink, fontSize: 14, fontWeight: "800" },
  subjectChipTextSelected: { color: colors.surface },
  terms: {
    alignItems: "center",
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between"
  },
  termsChoice: { alignItems: "center", flex: 1, flexDirection: "row", gap: spacing.sm, paddingVertical: spacing.sm },
  termsLabel: { color: colors.ink, flexShrink: 1, fontSize: 14, fontWeight: "700" },
  topRow: { alignItems: "center", flexDirection: "row", gap: spacing.md, marginTop: spacing.lg }
});
