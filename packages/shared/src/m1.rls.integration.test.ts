import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it } from "vitest";

import type { Database } from "./database.types";
import { assertNoLeakedTestUsers, deleteTestUsers } from "./rlsTestCleanup";

type ApiKey = {
  name: string;
  api_key: string;
};

type TestEnv = {
  projectRef: string;
  accessToken: string;
  url: string;
};

const env = loadTestEnv();
const describeIfRemote = env ? describe : describe.skip;

describeIfRemote("M1 RLS integration against linked Supabase", () => {
  // 정리 실패는 finally 에서 throw 하면 원래 실패 원인을 덮어쓴다 → 여기서 따로 터뜨린다.
  afterAll(assertNoLeakedTestUsers);

  it("hides study sessions from a connected teacher when share_study_time is off", async () => {
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
    const password = `Tt-${suffix}-12345678`;
    const teacherEmail = `teacher-${suffix}@m1.test`;
    const studentEmail = `student-${suffix}@m1.test`;
    const inviteCode = `A${suffix.replace(/-/g, "").slice(0, 5).toUpperCase()}`;
    let teacherId = "";
    let studentId = "";

    try {
      const teacher = await admin.auth.admin.createUser({
        email: teacherEmail,
        password,
        email_confirm: true
      });
      const student = await admin.auth.admin.createUser({
        email: studentEmail,
        password,
        email_confirm: true
      });
      if (teacher.error) throw teacher.error;
      if (student.error) throw student.error;
      teacherId = teacher.data.user.id;
      studentId = student.data.user.id;

      assertOk(
        await admin.from("profiles").insert([
          { id: teacherId, role: "teacher", name: "RLS teacher", onboarded: true },
          {
            id: studentId,
            role: "student",
            name: "RLS student",
            grade: "중1",
            birth_date: "2013-06-23",
            guardian_consented_at: new Date().toISOString(),
            onboarded: true
          }
        ])
      );
      assertOk(
        await admin.from("invite_codes").insert({
          code: inviteCode,
          teacher_id: teacherId,
          used_by: studentId
        })
      );
      const rejected = await admin
        .from("connections")
        .insert({
          teacher_id: teacherId,
          student_id: studentId,
          status: "rejected",
          invite_code: inviteCode,
          requested_by: studentId
        })
        .select("id")
        .single();
      assertOk(rejected);

      const studentSignIn = await studentClient.auth.signInWithPassword({
        email: studentEmail,
        password
      });
      if (studentSignIn.error) throw studentSignIn.error;

      const reopened = await studentClient.rpc("request_connection_by_invite", {
        p_code: inviteCode
      });
      assertOk(reopened);
      const reopenedConnection = assertData(reopened.data);
      expect(reopenedConnection.status).toBe("pending");

      const activated = await admin
        .from("connections")
        .update({ status: "active", activated_at: new Date().toISOString() })
        .eq("id", reopenedConnection.id);
      assertOk(activated);
      assertOk(
        await admin.from("disclosure_settings").upsert({
          connection_id: reopenedConnection.id,
          share_study_time: false,
          share_homework_photos: true,
          share_focus_data: false
        })
      );
      const session = await admin
        .from("study_sessions")
        .insert({
          student_id: studentId,
          subject: "math",
          started_at: new Date().toISOString(),
          ended_at: new Date().toISOString(),
          duration_sec: 1800
        })
        .select("id")
        .single();
      assertOk(session);
      const studySession = assertData(session.data);

      const teacherSignIn = await teacherClient.auth.signInWithPassword({
        email: teacherEmail,
        password
      });
      if (teacherSignIn.error) throw teacherSignIn.error;

      const hidden = await teacherClient
        .from("v_teacher_study_sessions")
        .select("id, student_id");
      assertOk(hidden);
      expect(hidden.data).toEqual([]);

      assertOk(
        await admin
          .from("disclosure_settings")
          .update({ share_study_time: true })
          .eq("connection_id", reopenedConnection.id)
      );

      const visible = await teacherClient
        .from("v_teacher_study_sessions")
        .select("id, student_id");
      assertOk(visible);
      expect(visible.data).toEqual([
        { id: studySession.id, student_id: studentId }
      ]);
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
    projectRef,
    accessToken,
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
      Authorization: `Bearer ${env.accessToken}`,
      Accept: "application/json"
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
