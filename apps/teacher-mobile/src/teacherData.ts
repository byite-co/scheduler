import { useCallback, useEffect, useState } from "react";
import type { Database } from "@ssamplanner/shared";
import { supabase } from "./supabaseClient";
import { useAuth } from "./auth";

type Connection = Database["public"]["Tables"]["connections"]["Row"];
type Profile = Pick<Database["public"]["Tables"]["profiles"]["Row"], "id" | "name" | "grade" | "subjects">;
type Disclosure = Database["public"]["Tables"]["disclosure_settings"]["Row"];
export type StudentSummary = Profile & { connection: Connection; disclosure?: Disclosure; weekMinutes: number; submittedCount: number };

function weekStart() { const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - d.getUTCDay()); return `${d.toISOString().slice(0, 10)}T00:00:00.000Z`; }
export function useTeacherStudents() {
  const { session } = useAuth(); const [students, setStudents] = useState<StudentSummary[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => { if (!session) { setStudents([]); setLoading(false); return; } setLoading(true); const con = await supabase.from("connections").select("*").eq("teacher_id", session.user.id).eq("status", "active"); const connections = con.data ?? []; const ids = connections.map((x) => x.student_id); if (!ids.length) { setStudents([]); setError(con.error?.message ?? null); setLoading(false); return; }
    const [profiles, disclosures, sessions, submissions] = await Promise.all([supabase.from("profiles").select("id,name,grade,subjects").in("id", ids), supabase.from("disclosure_settings").select("*").in("connection_id", connections.map((x) => x.id)), supabase.from("v_teacher_study_sessions").select("student_id,duration_sec").in("student_id", ids).gte("started_at", weekStart()), supabase.from("homework_submissions").select("student_id").in("student_id", ids)]);
    const byId = new Map((profiles.data ?? []).map((p) => [p.id, p])); const disclose = new Map((disclosures.data ?? []).map((d) => [d.connection_id, d])); const minutes = new Map<string, number>(); (sessions.data ?? []).forEach((s) => { if (s.student_id) minutes.set(s.student_id, (minutes.get(s.student_id) ?? 0) + Math.round((s.duration_sec ?? 0) / 60)); }); const submitted = new Map<string, number>(); (submissions.data ?? []).forEach((s) => submitted.set(s.student_id, (submitted.get(s.student_id) ?? 0) + 1));
    setStudents(connections.map((connection) => ({ ...(byId.get(connection.student_id) ?? { id: connection.student_id, name: "학생", grade: null, subjects: null }), connection, disclosure: disclose.get(connection.id), weekMinutes: minutes.get(connection.student_id) ?? 0, submittedCount: submitted.get(connection.student_id) ?? 0 })).sort((a,b) => a.weekMinutes-b.weekMinutes)); setError(con.error?.message ?? profiles.error?.message ?? null); setLoading(false);
  }, [session]); useEffect(() => { void refresh(); }, [refresh]); return { students, loading, error, refresh };
}
export function statusFor(student: StudentSummary) { if (!student.disclosure?.share_study_time) return { label: "비공개", color: "#646B7D" }; if (!student.weekMinutes) return { label: "기록 없음", color: "#646B7D" }; if (student.weekMinutes < 60) return { label: "주의", color: "#E0A100" }; return { label: "양호", color: "#15A66B" }; }
