import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it } from "vitest";

import type { Database } from "./database.types";
import { assertNoLeakedTestUsers, deleteTestUsers } from "./rlsTestCleanup";

type ApiKey = {
  api_key: string;
  name: string;
};

type TestEnv = {
  accessToken: string;
  projectRef: string;
  url: string;
};

const env = loadTestEnv();
const describeIfRemote = env ? describe : describe.skip;

describeIfRemote("M3 focus RLS integration against linked Supabase", () => {
  // 정리 실패는 finally 에서 throw 하면 원래 실패 원인을 덮어쓴다 → 여기서 따로 터뜨린다.
  afterAll(assertNoLeakedTestUsers);

  it("lets only the student save focus checks and reveals them to teachers only when focus disclosure is on", async () => {
    if (!env) throw new Error("Missing Supabase test environment");

    const keys = await fetchApiKeys(env);
    const anonKey = getApiKey(keys, "anon");
    const serviceRoleKey = getApiKey(keys, "service_role");
    const admin = createClient<Database>(env.url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    const teacherClient = createClient<Database>(env.url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    const studentClient = createClient<Database>(env.url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const suffix = randomUUID();
    const password = `M3-focus-${suffix}-12345678`;
    const teacherEmail = `teacher-${suffix}@m3-focus.test`;
    const studentEmail = `student-${suffix}@m3-focus.test`;
    let teacherId = "";
    let studentId = "";

    try {
      const teacher = await admin.auth.admin.createUser({
        email: teacherEmail,
        email_confirm: true,
        password
      });
      const student = await admin.auth.admin.createUser({
        email: studentEmail,
        email_confirm: true,
        password
      });
      if (teacher.error) throw teacher.error;
      if (student.error) throw student.error;
      teacherId = teacher.data.user.id;
      studentId = student.data.user.id;

      assertOk(
        await admin.from("profiles").insert([
          { id: teacherId, role: "teacher", name: "M3 focus teacher", onboarded: true },
          {
            birth_date: "2010-03-01",
            grade: "focus",
            guardian_consented_at: new Date().toISOString(),
            id: studentId,
            name: "M3 focus student",
            onboarded: true,
            role: "student"
          }
        ])
      );
      const connection = await admin
        .from("connections")
        .insert({
          activated_at: new Date().toISOString(),
          requested_by: studentId,
          status: "active",
          student_id: studentId,
          teacher_id: teacherId
        })
        .select("id")
        .single();
      assertOk(connection);
      const connectionId = assertData(connection.data).id;
      assertOk(
        await admin.from("disclosure_settings").upsert({
          connection_id: connectionId,
          share_focus_data: false,
          share_homework_photos: true,
          share_study_time: true
        })
      );
      const session = await admin
        .from("study_sessions")
        .insert({
          duration_sec: 1200,
          focus_mode: true,
          started_at: new Date().toISOString(),
          student_id: studentId,
          subject: "math"
        })
        .select("id")
        .single();
      assertOk(session);
      const sessionId = assertData(session.data).id;

      const studentSignIn = await studentClient.auth.signInWithPassword({
        email: studentEmail,
        password
      });
      if (studentSignIn.error) throw studentSignIn.error;
      const teacherSignIn = await teacherClient.auth.signInWithPassword({
        email: teacherEmail,
        password
      });
      if (teacherSignIn.error) throw teacherSignIn.error;

      const blockedTeacherWrite = await teacherClient.rpc("save_focus_check", {
        p_checked_at: new Date().toISOString(),
        p_drowsy: true,
        p_session_id: sessionId
      });
      expect(blockedTeacherWrite.error).not.toBeNull();

      const saved = await studentClient.rpc("save_focus_check", {
        p_checked_at: new Date().toISOString(),
        p_drowsy: true,
        p_session_id: sessionId
      });
      assertOk(saved);
      expect(saved.data?.[0]).toMatchObject({
        check_total: 1,
        drowsy_count: 1,
        focus_score: 0,
        session_id: sessionId
      });

      const studentVisible = await studentClient.from("focus_checks").select("session_id, drowsy");
      assertOk(studentVisible);
      expect(studentVisible.data).toEqual([{ drowsy: true, session_id: sessionId }]);

      const hiddenChecks = await teacherClient.from("focus_checks").select("session_id, drowsy");
      assertOk(hiddenChecks);
      expect(hiddenChecks.data).toEqual([]);

      const hiddenSummary = await teacherClient
        .from("v_teacher_study_sessions")
        .select("id, focus_score, drowsy_count, check_total")
        .eq("id", sessionId)
        .single();
      assertOk(hiddenSummary);
      expect(hiddenSummary.data).toEqual({
        check_total: null,
        drowsy_count: null,
        focus_score: null,
        id: sessionId
      });

      assertOk(
        await admin
          .from("disclosure_settings")
          .update({ share_focus_data: true })
          .eq("connection_id", connectionId)
      );

      const visibleChecks = await teacherClient.from("focus_checks").select("session_id, drowsy");
      assertOk(visibleChecks);
      expect(visibleChecks.data).toEqual([{ drowsy: true, session_id: sessionId }]);

      const visibleChecksView = await teacherClient.from("v_teacher_focus_checks").select("session_id, drowsy");
      assertOk(visibleChecksView);
      expect(visibleChecksView.data).toEqual([{ drowsy: true, session_id: sessionId }]);

      const visibleSummary = await teacherClient
        .from("v_teacher_study_sessions")
        .select("id, focus_score, drowsy_count, check_total")
        .eq("id", sessionId)
        .single();
      assertOk(visibleSummary);
      expect(visibleSummary.data).toEqual({
        check_total: 1,
        drowsy_count: 1,
        focus_score: 0,
        id: sessionId
      });
    } finally {
      await deleteTestUsers(admin, [studentId, teacherId]);
    }
  }, 60_000);
});

function loadTestEnv(): TestEnv | null {
  const envFile = readEnvFile(new URL("../../../.env.local", import.meta.url));
  const projectRef = process.env.SUPABASE_PROJECT_REF ?? envFile.SUPABASE_PROJECT_REF;
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN ?? envFile.SUPABASE_ACCESS_TOKEN;

  if (!projectRef || !accessToken) return null;

  return {
    accessToken,
    projectRef,
    url: `https://${projectRef}.supabase.co`
  };
}

function readEnvFile(url: URL): Record<string, string> {
  if (!existsSync(url)) return {};

  return Object.fromEntries(
    readFileSync(url, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^["']|["']$/g, "")];
      })
  );
}

async function fetchApiKeys(env: TestEnv): Promise<ApiKey[]> {
  const response = await fetch(`https://api.supabase.com/v1/projects/${env.projectRef}/api-keys`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${env.accessToken}`
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Supabase API keys: ${response.status}`);
  }

  return response.json() as Promise<ApiKey[]>;
}

function getApiKey(keys: ApiKey[], name: "anon" | "service_role"): string {
  const key = keys.find((candidate) => candidate.name === name)?.api_key;
  if (!key) throw new Error(`Missing Supabase ${name} key`);
  return key;
}

function assertOk(result: { error: unknown }): void {
  if (result.error) throw result.error;
}

function assertData<T>(data: T | null): T {
  if (!data) throw new Error("Expected Supabase response data");
  return data;
}
