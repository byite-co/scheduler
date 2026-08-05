import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it } from "vitest";

import type { Database } from "./database.types";
import { assertNoLeakedTestUsers, deleteTestUsers } from "./rlsTestCleanup";

type ApiKey = { api_key: string; name: string };
type TestEnv = { accessToken: string; projectRef: string; url: string };
type SharedReportResult = { status: string; report?: { id: string; type: string } };

const env = loadTestEnv();
const describeIfRemote = env ? describe : describe.skip;

describeIfRemote("M5 report sharing RLS against linked Supabase", () => {
  // 정리 실패는 finally 에서 throw 하면 원래 실패 원인을 덮어쓴다 → 여기서 따로 터뜨린다.
  afterAll(assertNoLeakedTestUsers);

  it("lets parents open a report by token only (no login), logs views, and enforces expiry", async () => {
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
    const otherTeacherClient = createClient<Database>(env.url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    const parentClient = createClient<Database>(env.url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const suffix = randomUUID();
    const password = `M5-rep-${suffix}-12345678`;
    const teacherEmail = `teacher-${suffix}@m5-rep.test`;
    const otherEmail = `other-${suffix}@m5-rep.test`;
    const studentEmail = `student-${suffix}@m5-rep.test`;
    let teacherId = "";
    let otherId = "";
    let studentId = "";
    let reportId = "";

    try {
      const teacher = await admin.auth.admin.createUser({ email: teacherEmail, email_confirm: true, password });
      const other = await admin.auth.admin.createUser({ email: otherEmail, email_confirm: true, password });
      const student = await admin.auth.admin.createUser({ email: studentEmail, email_confirm: true, password });
      if (teacher.error) throw teacher.error;
      if (other.error) throw other.error;
      if (student.error) throw student.error;
      teacherId = teacher.data.user.id;
      otherId = other.data.user.id;
      studentId = student.data.user.id;

      assertOk(
        await admin.from("profiles").insert([
          { id: teacherId, role: "teacher", name: "M5 teacher", onboarded: true },
          { id: otherId, role: "teacher", name: "M5 other teacher", onboarded: true },
          { id: studentId, role: "student", name: "M5 student", onboarded: true }
        ])
      );
      assertOk(
        await admin.from("connections").insert({
          activated_at: new Date().toISOString(),
          requested_by: studentId,
          status: "active",
          student_id: studentId,
          teacher_id: teacherId
        })
      );

      const report = await admin
        .from("reports")
        .insert({
          student_id: studentId,
          teacher_id: teacherId,
          type: "weekly",
          period_start: "2026-06-15",
          period_end: "2026-06-21",
          data: { totalMinutes: 320 },
          ai_draft: "이번 주 잘했어요 (초안)",
          teacher_comment: "다음 주도 화이팅",
          included_subjects: ["math"],
          status: "draft"
        })
        .select("id")
        .single();
      assertOk(report);
      reportId = assertData(report.data).id;

      await signIn(teacherClient, teacherEmail, password);
      await signIn(otherTeacherClient, otherEmail, password);

      // 연결되지 않은 다른 과외쌤은 공유 링크를 발급할 수 없다.
      const blocked = await otherTeacherClient.rpc("create_report_share", { p_report_id: reportId, p_ttl_hours: 168 });
      expect(blocked.error).not.toBeNull();

      // 담당 과외쌤이 공유 링크 발급.
      const shared = await teacherClient.rpc("create_report_share", { p_report_id: reportId, p_ttl_hours: 168 });
      assertOk(shared);
      const token = (shared.data as { token: string }).token;
      expect(typeof token).toBe("string");

      // 학부모(anon, 미로그인)는 reports 테이블 직접 조회 불가.
      const directAnon = await parentClient.from("reports").select("id").eq("id", reportId);
      assertOk(directAnon);
      expect(directAnon.data).toEqual([]);

      // 토큰으로는 인증 없이 열람 가능 + 조회 기록.
      const opened = await parentClient.rpc("get_shared_report", { p_token: token });
      assertOk(opened);
      const openedData = opened.data as SharedReportResult;
      expect(openedData.status).toBe("ok");
      expect(openedData.report?.id).toBe(reportId);

      const viewCount = await admin.from("report_views").select("id").eq("report_id", reportId);
      assertOk(viewCount);
      expect((viewCount.data ?? []).length).toBeGreaterThanOrEqual(1);

      // 잘못된 토큰 → not_found.
      const notFound = await parentClient.rpc("get_shared_report", { p_token: "deadbeefdeadbeefdeadbeef" });
      assertOk(notFound);
      expect((notFound.data as SharedReportResult).status).toBe("not_found");

      // 만료 → expired.
      assertOk(
        await admin
          .from("reports")
          .update({ share_expires_at: "2020-01-01T00:00:00.000Z" })
          .eq("id", reportId)
      );
      const expired = await parentClient.rpc("get_shared_report", { p_token: token });
      assertOk(expired);
      expect((expired.data as SharedReportResult).status).toBe("expired");
    } finally {
      if (reportId) await admin.from("reports").delete().eq("id", reportId);
      await deleteTestUsers(admin, [studentId, otherId, teacherId]);
    }
  }, 60_000);
});

async function signIn(
  client: ReturnType<typeof createClient<Database>>,
  email: string,
  password: string
): Promise<void> {
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

function assertData<T>(data: T | null): T {
  if (!data) throw new Error("Expected Supabase response data");
  return data;
}
