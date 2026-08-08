import { ScrollView, Text, View } from "react-native";
import { useAuth } from "./auth";
import { EmptyState, screenStyles } from "./ui";

export function TabPlaceholder({ title }: { title: string }) {
  const { profile } = useAuth();
  return <ScrollView style={screenStyles.screen} contentContainerStyle={screenStyles.content}><Text style={screenStyles.heading}>{title}</Text><Text style={screenStyles.subtitle}>{profile?.name ? `${profile.name} 선생님, 반가워요.` : ""}</Text><View style={{ flex: 1, justifyContent: "center" }}><EmptyState title="다음 단계에서 준비돼요" body="탭 구조와 인증 가드는 준비됐습니다." /></View></ScrollView>;
}
