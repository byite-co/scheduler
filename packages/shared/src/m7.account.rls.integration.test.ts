import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it } from "vitest";

import type { Database } from "./database.types";
import { assertNoLeakedTestUsers, deleteTestUsers } from "./rlsTestCleanup";

type ApiKey = { api_key: string; name: string };
type TestEnv = { accessToken: string; projectRef: string; url: string };

const env = loadTestEnv();
const describeIfRemote = env ? describe : describe.skip;

describeIfRemote("M7 account + system RLS against linked Supabase", () => {
  // 정리 실패는 finally 에서 throw 하면 원래 실패 원인을 덮어쓴다 → 여기서 따로 터뜨린다.
  afterAll(assertNoLeakedTestUsers);

  it("self-deletes the account with full cascade and exposes public app_config", async () => {
    if (!env) throw new Error("Missing Supabase test environment");

    const keys = await fetchApiKeys(env);
    const anonKey = getApiKey(keys, "anon");
    const serviceRoleKey = getApiKey(keys, "service_role");
    const admin = createClient<Database>(env.url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const studentClient = createClient<Database>(env.url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const anon = createClient<Database>(env.url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });

    const suffix = randomUUID();
    const password = `M7-acct-${suffix}-12345678`;
    const teacherEmail = `teacher-${suffix}@m7.test`;
    const studentEmail = `student-${suffix}@m7.test`;
    let teacherId = "";
    let studentId = "";

    try {
      const teacher = await admin.auth.admin.createUser({ email: teacherEmail, email_confirm: true, password });
      const student = await admin.auth.admin.createUser({ email: studentEmail, email_confirm: true, password });
      if (teacher.error) throw teacher.error;
      if (student.error) throw student.error;
      teacherId = teacher.data.user.id;
      studentId = student.data.user.id;

      assertOk(
        await admin.from("profiles").insert([
          { id: teacherId, role: "teacher", name: "M7 teacher", onboarded: true },
          { id: studentId, role: "student", name: "M7 student", onboarded: true }
        ])
      );
      const connection = await admin
        .from("connections")
        .insert({ teacher_id: teacherId, student_id: studentId, status: "active", requested_by: studentId, activated_at: new Date().toISOString() })
        .select("id")
        .single();
      assertOk(connection);
      assertOk(await admin.from("todos").insert({ student_id: studentId, title: "M7 todo", source: "self", created_by: studentId }));
      assertOk(await admin.from("notifications").insert({ user_id: studentId, type: "system", title: "M7" }));

      // app_config는 미로그인(anon)도 읽을 수 있어야 한다(부팅 게이트).
      const config = await anon.from("app_config").select("min_supported_build, maintenance").eq("id", 1).single();
      assertOk(config);
      expect(typeof config.data?.min_supported_build).toBe("number");

      await signIn(studentClient, studentEmail, password);

      // 본인 알림만 보인다.
      const myNotifs = await studentClient.from("notifications").select("user_id");
      assertOk(myNotifs);
      expect((myNotifs.data ?? []).every((n) => n.user_id === studentId)).toBe(true);

      // 회원 탈퇴 → cascade.
      const deleted = await studentClient.rpc("delete_my_account");
      assertOk(deleted);

      const profileGone = await admin.from("profiles").select("id").eq("id", studentId);
      assertOk(profileGone);
      expect(profileGone.data).toEqual([]);
      const todosGone = await admin.from("todos").select("id").eq("student_id", studentId);
      assertOk(todosGone);
      expect(todosGone.data).toEqual([]);
      const userGone = await admin.auth.admin.getUserById(studentId);
      expect(userGone.data.user).toBeNull();
      studentId = ""; // already removed
    } finally {
      await deleteTestUsers(admin, [studentId, teacherId]);
    }
  }, 60_000);
});

async function signIn(client: ReturnType<typeof createClient<Database>>, email: string, password: string): Promise<void> {
  const result = await client.auth.signInWithPassword({ email, password });
  if (result.error) throw result.error;
}

function loadTestEnv(): TestEnv | null {
  const envFile = readEnvFile(new URL("../../../.env.local", import.meta.url));
  const projectRef = process.env.SUPABASE_PROJECT_REF ?? envFile.SUPABASE_PROJECT_REF;
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN ?? envFile.SUPABASE_ACCESS_TOKEN;
  if (!projectRef || !accessToken) return null;
  return { accessToken, projectRef, url: `https://${projectRef}.supabase.co` };
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
    headers: { Accept: "application/json", Authorization: `Bearer ${env.accessToken}` }
  });
  if (!response.ok) throw new Error(`Failed to fetch Supabase API keys: ${response.status}`);
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
