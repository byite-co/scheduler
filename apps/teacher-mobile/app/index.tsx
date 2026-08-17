import { Redirect } from "expo-router";
import { useAuth } from "../src/auth";
import { LoadingState } from "../src/ui";

export default function IndexRoute() {
  const { loading, session, profile } = useAuth();
  if (loading) return <LoadingState label="앱을 준비하는 중…" />;
  if (!session) return <Redirect href="/login" />;
  return <Redirect href={profile?.onboarded ? "/(tabs)" : "/onboarding/profile"} />;
}
