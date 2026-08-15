import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { colors } from "@ssamplanner/design-tokens";
import { SUBJECT_LABELS, type SubjectCode } from "@ssamplanner/shared";

import { useAuth } from "./auth";
import { managementStyles as styles } from "./managementStyles";
import { supabase } from "./supabaseClient";
import { PrimaryButton, screenStyles } from "./ui";

const SUBJECTS: SubjectCode[] = ["math", "english", "korean", "science", "social", "etc"];

export function ProfileSettingsScreen() {
  const { session, profile, refreshProfile } = useAuth();
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [subjects, setSubjects] = useState<SubjectCode[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setName(profile?.name ?? "");
    setBio(profile?.bio ?? "");
    setSubjects(profile?.subjects ?? []);
  }, [profile]);

  function toggleSubject(subject: SubjectCode) {
    setSubjects((current) =>
      current.includes(subject) ? current.filter((item) => item !== subject) : [...current, subject]
    );
  }

  async function saveProfile() {
    if (!session) {
      setMessage("로그인이 필요합니다.");
      return;
    }
    if (!name.trim()) {
      setMessage("표시 이름을 입력해 주세요.");
      return;
    }

    setSaving(true);
    const { error } = await supabase.from("profiles").upsert({
      id: session.user.id,
      role: "teacher",
      name: name.trim(),
      bio: bio.trim() || null,
      subjects,
      onboarded: true
    });
    setSaving(false);
    setMessage(error?.message ?? "프로필을 저장했습니다.");
    if (!error) await refreshProfile();
  }

  return (
    <ScrollView style={screenStyles.screen} contentContainerStyle={screenStyles.content}>
      <Text style={screenStyles.heading}>프로필 편집</Text>
      <Text style={screenStyles.subtitle}>리포트와 공유 화면에 표시되는 과외쌤 정보를 관리해요.</Text>
      <View style={styles.card}>
        <Text style={styles.label}>표시 이름</Text>
        <TextInput value={name} onChangeText={setName} placeholder="과외쌤 이름" placeholderTextColor={colors.muted} style={styles.field} />
        <Text style={styles.label}>소개</Text>
        <TextInput
          value={bio}
          onChangeText={setBio}
          placeholder="담당 과목과 수업 방식을 소개해 주세요"
          placeholderTextColor={colors.muted}
          multiline
          style={[styles.field, styles.fieldMultiline]}
        />
      </View>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>담당 과목</Text>
        <Text style={styles.meta}>숙제·리포트에 사용할 과목을 선택해요.</Text>
        <View style={styles.actionRow}>
          {SUBJECTS.map((subject) => {
            const selected = subjects.includes(subject);
            return (
              <Pressable key={subject} onPress={() => toggleSubject(subject)} style={[styles.chip, selected && styles.chipSelected]}>
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{SUBJECT_LABELS[subject]}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      {message ? <Text style={{ color: message.includes("저장했습니다") ? colors.success : colors.danger, fontWeight: "800" }}>{message}</Text> : null}
      <PrimaryButton disabled={saving} onPress={() => void saveProfile()}>{saving ? "저장 중…" : "프로필 저장"}</PrimaryButton>
    </ScrollView>
  );
}
