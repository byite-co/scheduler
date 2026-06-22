import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { PEER_RANKING_MIN_COHORT } from "./m2";
import type { Database } from "./database.types";

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

describeIfRemote("M2 RLS integration against linked Supabase", () => {
  it("hides peer ranking aggregates when the same-grade cohort is below the minimum", async () => {
    if (!env) throw new Error("Missing Supabase test environment");

    const keys = await fetchApiKeys(env);
    const anonKey = getApiKey(keys, "anon");
    const serviceRoleKey = getApiKey(keys, "service_role");
    const admin = createClient<Database>(env.url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    const studentClient = createClient<Database>(env.url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const suffix = randomUUID();
    const password = `M2-privacy-${suffix}-12345678`;
    const studentEmail = `student-privacy-${suffix}@m2.test`;
    const uniqueGrade = `privacy-${suffix.slice(0, 8)}`;
    let studentId = "";

    try {
      const student = await admin.auth.admin.createUser({
        email: studentEmail,
        password,
        email_confirm: true
      });
      if (student.error) throw student.error;
      studentId = student.data.user.id;

      assertOk(
        await admin.from("profiles").insert({
          id: studentId,
          role: "student",
          name: "M2 privacy student",
          grade: uniqueGrade,
          birth_date: "2010-03-01",
          guardian_consented_at: new Date().toISOString(),
          onboarded: true
        })
      );
      assertOk(
        await admin.from("study_sessions").insert({
          student_id: studentId,
          subject: "math",
          started_at: new Date().toISOString(),
          ended_at: new Date().toISOString(),
          duration_sec: 3600
        })
      );

      const studentSignIn = await studentClient.auth.signInWithPassword({
        email: studentEmail,
        password
      });
      if (studentSignIn.error) throw studentSignIn.error;

      const rankingResult = await studentClient.rpc("get_peer_study_ranking", {
        p_days: 7,
        p_min_cohort: PEER_RANKING_MIN_COHORT
      });
      assertOk(rankingResult);
      const ranking = assertData(rankingResult.data?.[0] ?? null);

      expect(ranking).toMatchObject({
        peer_count: 0,
        min_cohort: PEER_RANKING_MIN_COHORT,
        can_show_peer_ranking: false,
        current_user_minutes: 60,
        peer_average_minutes: null,
        rank_percentile: null
      });
    } finally {
      if (studentId) await admin.auth.admin.deleteUser(studentId);
    }
  }, 60_000);

  it("prevents students from changing locked teacher homework AI-check settings", async () => {
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
    const password = `M2-${suffix}-12345678`;
    const teacherEmail = `teacher-${suffix}@m2.test`;
    const studentEmail = `student-${suffix}@m2.test`;
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
          { id: teacherId, role: "teacher", name: "M2 teacher", onboarded: true },
          {
            id: studentId,
            role: "student",
            name: "M2 student",
            grade: "고1",
            birth_date: "2010-03-01",
            guardian_consented_at: new Date().toISOString(),
            onboarded: true
          }
        ])
      );
      const connection = await admin
        .from("connections")
        .insert({
          teacher_id: teacherId,
          student_id: studentId,
          status: "active",
          requested_by: studentId,
          activated_at: new Date().toISOString()
        })
        .select("id")
        .single();
      assertOk(connection);
      const connectionId = assertData(connection.data).id;

      const teacherSignIn = await teacherClient.auth.signInWithPassword({
        email: teacherEmail,
        password
      });
      if (teacherSignIn.error) throw teacherSignIn.error;

      const homework = await teacherClient
        .from("todos")
        .insert({
          student_id: studentId,
          connection_id: connectionId,
          title: "선생님이 낸 숙제",
          subject: "math",
          source: "teacher",
          ai_check_enabled: true,
          locked: false,
          status: "todo",
          created_by: teacherId
        })
        .select("id, ai_check_enabled, locked, status")
        .single();
      assertOk(homework);
      const homeworkRow = assertData(homework.data);
      expect(homeworkRow.locked).toBe(true);

      const studentSignIn = await studentClient.auth.signInWithPassword({
        email: studentEmail,
        password
      });
      if (studentSignIn.error) throw studentSignIn.error;

      const blocked = await studentClient
        .from("todos")
        .update({ ai_check_enabled: false })
        .eq("id", homeworkRow.id);
      expect(blocked.error?.message).toContain("locked_teacher_todo_fields");

      assertOk(
        await studentClient
          .from("todos")
          .update({ status: "done" })
          .eq("id", homeworkRow.id)
      );
      const visible = await studentClient
        .from("todos")
        .select("ai_check_enabled, status")
        .eq("id", homeworkRow.id)
        .single();
      assertOk(visible);
      expect(visible.data).toEqual({
        ai_check_enabled: true,
        status: "done"
      });
    } finally {
      if (teacherId) await admin.auth.admin.deleteUser(teacherId);
      if (studentId) await admin.auth.admin.deleteUser(studentId);
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
