import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import type { Database } from "./database.types";
import { PRICE_PER_STUDENT_KRW } from "./pricing";

type ApiKey = { api_key: string; name: string };
type TestEnv = { accessToken: string; projectRef: string; url: string };

const env = loadTestEnv();
const describeIfRemote = env ? describe : describe.skip;

describeIfRemote("M6 billing RLS against linked Supabase", () => {
  it("bills active connections × price, drops on disconnect, isolates per teacher", async () => {
    if (!env) throw new Error("Missing Supabase test environment");

    const keys = await fetchApiKeys(env);
    const anonKey = getApiKey(keys, "anon");
    const serviceRoleKey = getApiKey(keys, "service_role");
    const admin = createClient<Database>(env.url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const teacherClient = createClient<Database>(env.url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const otherClient = createClient<Database>(env.url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });

    const suffix = randomUUID();
    const password = `M6-bill-${suffix}-12345678`;
    const teacherEmail = `teacher-${suffix}@m6.test`;
    const otherEmail = `other-${suffix}@m6.test`;
    const s1Email = `s1-${suffix}@m6.test`;
    const s2Email = `s2-${suffix}@m6.test`;
    const ids: string[] = [];

    try {
      const mk = async (email: string, role: "teacher" | "student", name: string) => {
        const created = await admin.auth.admin.createUser({ email, email_confirm: true, password });
        if (created.error) throw created.error;
        const id = created.data.user.id;
        ids.push(id);
        assertOk(await admin.from("profiles").insert({ id, role, name, onboarded: true }));
        return id;
      };

      const teacherId = await mk(teacherEmail, "teacher", "M6 teacher");
      await mk(otherEmail, "teacher", "M6 other");
      const s1 = await mk(s1Email, "student", "M6 s1");
      const s2 = await mk(s2Email, "student", "M6 s2");

      const conn2 = await admin
        .from("connections")
        .insert([
          { teacher_id: teacherId, student_id: s1, status: "active", requested_by: s1, activated_at: new Date().toISOString() },
          { teacher_id: teacherId, student_id: s2, status: "active", requested_by: s2, activated_at: new Date().toISOString() }
        ])
        .select("id, student_id");
      assertOk(conn2);

      await signIn(teacherClient, teacherEmail, password);
      await signIn(otherClient, otherEmail, password);

      // 2명 active → 2 × 단가
      const inv2 = await teacherClient.rpc("generate_teacher_invoice", { p_period: "2026-06" });
      assertOk(inv2);
      expect(inv2.data).toMatchObject({ student_count: 2, amount: 2 * PRICE_PER_STUDENT_KRW, status: "open" });

      // s2 연결 해제 → 다음 청구에서 1명으로 감소
      assertOk(await admin.from("connections").update({ status: "disconnected" }).eq("teacher_id", teacherId).eq("student_id", s2));
      const inv1 = await teacherClient.rpc("generate_teacher_invoice", { p_period: "2026-06" });
      assertOk(inv1);
      expect(inv1.data).toMatchObject({ student_count: 1, amount: 1 * PRICE_PER_STUDENT_KRW });

      // 인보이스는 본인만 조회(다른 과외쌤은 못 봄)
      const mine = await teacherClient.from("billing_invoices").select("teacher_id, amount");
      assertOk(mine);
      expect((mine.data ?? []).every((row) => row.teacher_id === teacherId)).toBe(true);
      const others = await otherClient.from("billing_invoices").select("id").eq("teacher_id", teacherId);
      assertOk(others);
      expect(others.data).toEqual([]);

      // 모의 웹훅: 미납 전이 후 본인 구독만 조회
      const dunning = await teacherClient.rpc("mock_set_teacher_subscription", { p_status: "past_due" });
      assertOk(dunning);
      expect(dunning.data).toMatchObject({ status: "past_due" });
      const sub = await teacherClient.from("teacher_subscriptions").select("status").eq("teacher_id", teacherId).single();
      assertOk(sub);
      expect(sub.data?.status).toBe("past_due");

      // SECURITY: 학생 프리미엄 mock RPC 는 클라이언트 롤에서 차단돼야 한다.
      // (열려 있으면 사용자가 스스로 프리미엄이 되어 서버측 검증이 무의미해진다.)
      await signIn(teacherClient, s1Email, password); // reuse client as student session
      const selfServePremium = await teacherClient.rpc("mock_set_student_subscription", {
        p_status: "active"
      });
      expect(selfServePremium.error?.message ?? "").toMatch(/permission denied|not find the function/i);
      const notPremium = await teacherClient
        .from("student_subscriptions")
        .select("status")
        .eq("student_id", s1)
        .maybeSingle();
      assertOk(notPremium);
      expect(notPremium.data?.status ?? "none").not.toBe("active");

      // 개발/테스트용 프리미엄 상태는 서버 키(service_role)로 테이블에 직접 쓴다.
      // (mock RPC 는 auth.uid() 로 대상을 정하므로 service_role 로는 쓸 수 없다 — auth.uid() 가 null.
      //  service_role 은 RLS 를 우회하므로 RPC 없이 upsert 하면 된다.)
      const premium = await admin
        .from("student_subscriptions")
        .upsert({ student_id: s1, status: "active", provider: "iap" })
        .select("status, provider")
        .single();
      assertOk(premium);
      expect(premium.data).toMatchObject({ status: "active", provider: "iap" });
    } finally {
      for (const id of ids) await admin.auth.admin.deleteUser(id);
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
