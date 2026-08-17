import type { Session } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import type { SubjectCode } from "@ssamplanner/shared";

import { supabase } from "./supabaseClient";

type TeacherProfile = {
  id: string;
  name: string;
  bio: string | null;
  subjects: SubjectCode[] | null;
  onboarded: boolean;
  role: "teacher" | "student";
};

type AuthContextValue = {
  session: Session | null;
  profile: TeacherProfile | null;
  loading: boolean;
  message: string | null;
  setMessage: (message: string | null) => void;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<TeacherProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const loadProfile = useCallback(async (nextSession: Session | null) => {
    setSession(nextSession);
    if (!nextSession) {
      setProfile(null);
      return;
    }

    const { data: teacherProfile, error } = await supabase
      .from("profiles")
      .select("id, name, bio, subjects, onboarded, role")
      .eq("id", nextSession.user.id)
      .maybeSingle();

    if (error) {
      setMessage(error.message);
      setProfile(null);
      return;
    }
    if (teacherProfile?.role && teacherProfile.role !== "teacher") {
      setMessage("과외쌤 계정으로 로그인해 주세요.");
      setProfile(null);
      setSession(null);
      await supabase.auth.signOut();
      return;
    }
    setProfile(teacherProfile as TeacherProfile | null);
  }, []);

  const refreshProfile = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    await loadProfile(data.session);
  }, [loadProfile]);

  useEffect(() => {
    void refreshProfile().finally(() => setLoading(false));
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      void loadProfile(nextSession).finally(() => setLoading(false));
    });
    return () => data.subscription.unsubscribe();
  }, [loadProfile, refreshProfile]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      profile,
      loading,
      message,
      setMessage,
      refreshProfile,
      signOut: async () => {
        const { error } = await supabase.auth.signOut();
        if (error) setMessage(error.message);
      }
    }),
    [loading, message, profile, refreshProfile, session]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
