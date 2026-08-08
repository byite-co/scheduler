import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { colors } from "@ssamplanner/design-tokens";
import { AuthProvider } from "../src/auth";

export default function RootLayout() {
  return <AuthProvider><StatusBar style="dark" /><Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }} /></AuthProvider>;
}
