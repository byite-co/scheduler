import { colors } from "@ssamplanner/design-tokens";
import { Redirect, Tabs } from "expo-router";
import { useAuth } from "../../src/auth";
import { AppIcon } from "../../src/icons";
import { LoadingState } from "../../src/ui";

function tabIconName(routeName: string): "dashboard" | "students" | "bell" | "settings" {
  switch (routeName) {
    case "index":
      return "dashboard";
    case "students":
      return "students";
    case "notifications":
      return "bell";
    default:
      return "settings";
  }
}

export default function TabsLayout() {
  const { loading, session, profile } = useAuth();

  if (loading) {
    return <LoadingState label="앱을 준비하는 중…" />;
  }
  if (!session) {
    return <Redirect href="/login" />;
  }
  if (!profile?.onboarded) {
    return <Redirect href="/onboarding/profile" />;
  }

  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { borderTopColor: colors.line, backgroundColor: colors.surface },
        tabBarIcon: ({ color, size }) => (
          <AppIcon name={tabIconName(route.name)} color={String(color)} size={size} />
        )
      })}
    >
      <Tabs.Screen name="index" options={{ title: "대시보드" }} />
      <Tabs.Screen name="students" options={{ title: "학생" }} />
      <Tabs.Screen name="notifications" options={{ title: "알림" }} />
      <Tabs.Screen name="settings" options={{ title: "설정" }} />
    </Tabs>
  );
}
