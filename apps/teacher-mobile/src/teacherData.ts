import { useCallback, useEffect, useState } from "react";

import { colors } from "@ssamplanner/design-tokens";
import type { Database } from "@ssamplanner/shared";

import { useAuth } from "./auth";
import { supabase } from "./supabaseClient";

type Connection = Database["public"]["Tables"]["connections"]["Row"];
type Profile = Pick<Database["public"]["Tables"]["profiles"]["Row"], "id" | "name" | "grade" | "subjects">;
type Disclosure = Database["public"]["Tables"]["disclosure_settings"]["Row"];

export type StudentSummary = Profile & {
  connection: Connection;
  disclosure?: Disclosure;
  pendingReviewCount: number;
  submittedCount: number;
  weekMinutes: number;
};

function weekStart() {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return `${date.toISOString().slice(0, 10)}T00:00:00.000Z`;
}

function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : "학생 정보를 불러오지 못했습니다.";
}

export function useTeacherStudents() {
  const { session } = useAuth();
  const [students, setStudents] = useState<StudentSummary[]>([]);
  const [todayLessonCount, setTodayLessonCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!session) {
      setStudents([]);
      setTodayLessonCount(0);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [connectionsResult, lessonsResult] = await Promise.all([
        supabase
          .from("connections")
          .select("*")
          .eq("teacher_id", session.user.id)
          .eq("status", "active"),
        supabase
          .from("lessons")
          .select("id")
          .eq("teacher_id", session.user.id)
          .eq("taught_on", today())
      ]);
      const connections = connectionsResult.data ?? [];
      const studentIds = connections.map((connection) => connection.student_id);

      setTodayLessonCount((lessonsResult.data ?? []).length);

      if (!studentIds.length) {
        setStudents([]);
        setError(connectionsResult.error?.message ?? lessonsResult.error?.message ?? null);
        return;
      }

      const connectionIds = connections.map((connection) => connection.id);
      const [profilesResult, disclosuresResult, sessionsResult, submissionsResult] = await Promise.all([
        supabase.from("profiles").select("id,name,grade,subjects").in("id", studentIds),
        supabase.from("disclosure_settings").select("*").in("connection_id", connectionIds),
        supabase
          .from("v_teacher_study_sessions")
          .select("student_id,duration_sec")
          .in("student_id", studentIds)
          .gte("started_at", weekStart()),
        supabase
          .from("homework_submissions")
          .select("student_id,teacher_status")
          .in("student_id", studentIds)
      ]);

      const profileById = new Map((profilesResult.data ?? []).map((profile) => [profile.id, profile]));
      const disclosureByConnectionId = new Map(
        (disclosuresResult.data ?? []).map((disclosure) => [disclosure.connection_id, disclosure])
      );
      const minutesByStudentId = new Map<string, number>();
      const submissionsByStudentId = new Map<string, number>();
      const pendingByStudentId = new Map<string, number>();

      for (const studySession of sessionsResult.data ?? []) {
        if (!studySession.student_id) continue;
        const minutes = Math.round((studySession.duration_sec ?? 0) / 60);
        minutesByStudentId.set(
          studySession.student_id,
          (minutesByStudentId.get(studySession.student_id) ?? 0) + minutes
        );
      }

      for (const submission of submissionsResult.data ?? []) {
        submissionsByStudentId.set(
          submission.student_id,
          (submissionsByStudentId.get(submission.student_id) ?? 0) + 1
        );
        if (submission.teacher_status === "pending") {
          pendingByStudentId.set(
            submission.student_id,
            (pendingByStudentId.get(submission.student_id) ?? 0) + 1
          );
        }
      }

      setStudents(
        connections
          .map((connection) => {
            const profile = profileById.get(connection.student_id);
            return {
              ...(profile ?? {
                grade: null,
                id: connection.student_id,
                name: "이름 미입력",
                subjects: null
              }),
              connection,
              disclosure: disclosureByConnectionId.get(connection.id),
              name: profile?.name.trim() || "이름 미입력",
              pendingReviewCount: pendingByStudentId.get(connection.student_id) ?? 0,
              submittedCount: submissionsByStudentId.get(connection.student_id) ?? 0,
              weekMinutes: minutesByStudentId.get(connection.student_id) ?? 0
            };
          })
          .sort((left, right) => left.weekMinutes - right.weekMinutes)
      );

      setError(
        connectionsResult.error?.message ??
          lessonsResult.error?.message ??
          profilesResult.error?.message ??
          disclosuresResult.error?.message ??
          sessionsResult.error?.message ??
          submissionsResult.error?.message ??
          null
      );
    } catch (loadError) {
      setStudents([]);
      setTodayLessonCount(0);
      setError(messageFrom(loadError));
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { error, loading, refresh, students, todayLessonCount };
}

export function statusFor(student: StudentSummary) {
  if (!student.disclosure?.share_study_time) return { color: colors.muted, label: "비공개" };
  if (!student.weekMinutes) return { color: colors.muted, label: "기록 없음" };
  if (student.weekMinutes < 60) return { color: colors.warning, label: "주의" };
  return { color: colors.success, label: "양호" };
}
