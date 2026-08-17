import { Redirect, Stack, usePathname } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";

import { colors } from "@ssamplanner/design-tokens";

import { AppMessageBanner } from "../src/appMessageBanner";
import { AuthProvider, useAuth } from "../src/auth";
import { LoadingState } from "../src/ui";

export default function RootLayout() {
  return (
    <AuthProvider>
      <AppNavigator />
    </AuthProvider>
  );
}

function AppNavigator() {
  const pathname = usePathname();
  const { loading, profile, session } = useAuth();
  const isPublicPath =
    pathname === "/login" ||
    pathname === "/signup" ||
    pathname === "/forgot" ||
    pathname.startsWith("/legal/");

  if (loading) return <LoadingState label="앱을 준비하는 중…" />;
  if (!session && !isPublicPath) return <Redirect href="/login" />;
  if (session && !profile?.onboarded && pathname !== "/onboarding/profile" && !pathname.startsWith("/legal/")) {
    return <Redirect href="/onboarding/profile" />;
  }

  return (
    <View style={{ flex: 1 }}>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }} />
      <AppMessageBanner />
    </View>
  );
}
