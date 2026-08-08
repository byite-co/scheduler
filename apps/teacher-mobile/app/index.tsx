import { Redirect } from "expo-router";
import { useAuth } from "../src/auth";

export default function IndexRoute() {
  const { loading, session, profile } = useAuth();
  if (loading) return null;
  if (!session) return <Redirect href="/login" />;
  return <Redirect href={profile?.onboarded ? "/(tabs)" : "/onboarding/profile"} />;
}
