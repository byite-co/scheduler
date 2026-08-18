import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it } from "vitest";

import { CONSENT_DOCUMENT_VERSION } from "./consent";
import type { Database } from "./database.types";
import { assertNoLeakedTestUsers, deleteTestUsers } from "./rlsTestCleanup";

type ApiKey = { name: string; api_key: string };
type TestEnv = { projectRef: string; accessToken: string; url: string };
type Redeem = { ok: boolean; connection?: { id: string } };

const env = loadTestEnv();
const describeIfRemote = env ? describe : describe.skip;

describeIfRemote("R3 원자화 RPC (실행 테스트)", () => {
  afterAll(assertNoLeakedTestUsers);

  it("finish_onboarding_with_consent: 동의 없이 onboarded 가 켜지지 않는다", async () => {
    if (!env) throw new Error("Missing Supabase test environment");
    const keys = await fetchApiKeys(env);
    const anonKey = getApiKey(keys, "anon");
    const admin = createClient<Database>(env.url, getApiKey(keys, "service_role"), {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const suffix = randomUUID();
    const password = `Tt-${suffix}-12345678`;
    let studentId = "";

    try {
      const created = await admin.auth.admin.createUser({
        email: `consent-${suffix}@r3.test`,
        password,
        email_confirm: true
      });
      if (created.error) throw created.error;
      studentId = created.data.user.id;
      // 화면이 프로필 필드만 저장한 상태 — onboarded 는 기본값 false 다.
      assertOk(
        await admin.from("profiles").insert({
          id: studentId,
          role: "student",
          name: "R3 consent",
          grade: "중1",
          birth_date: "2013-06-23",
          onboarded: false
        })
      );

      const student = await signIn(env.url, anonKey, `consent-${suffix}@r3.test`, password);

      // ── 필수 문서가 빠지면 아무것도 쓰지 않는다 ─────────────────────────────
      const missing = await student.rpc("finish_onboarding_with_consent", {
        p_documents: ["terms_of_service"],
        p_version: CONSENT_DOCUMENT_VERSION,
        p_method: "test"
      });
      expect(missing.error, "필수 문서가 없는데 통과했다").not.toBeNull();
      expect(missing.error?.message).toContain("consent_required_missing");

      const stillOff = await admin.from("profiles").select("onboarded").eq("id", studentId).single();
      assertOk(stillOff);
      expect(stillOff.data!.onboarded, "동의 실패인데 온보딩이 완료됐다").toBe(false);
      const noRows = await admin.from("consent_records").select("id").eq("user_id", studentId);
      assertOk(noRows);
      expect(noRows.data, "거부됐는데 동의 행이 남았다 — 부분 쓰기").toHaveLength(0);

      // ── 필수 2건 + 선택 1건 → 기록 + onboarded 가 함께 켜진다 ───────────────
      const ok = await student.rpc("finish_onboarding_with_consent", {
        p_documents: ["terms_of_service", "privacy_policy", "marketing_optional"],
        p_version: CONSENT_DOCUMENT_VERSION,
        p_method: "student_app_signup"
      });
      assertOk(ok);
      expect((ok.data as unknown as { onboarded: boolean }).onboarded).toBe(true);
      const rows = await admin.from("consent_records").select("document").eq("user_id", studentId);
      assertOk(rows);
      expect(rows.data).toHaveLength(3);

      // ── 멱등: 재호출해도 이력이 늘지 않는다 ─────────────────────────────────
      assertOk(
        await student.rpc("finish_onboarding_with_consent", {
          p_documents: ["terms_of_service", "privacy_policy", "marketing_optional"],
          p_version: CONSENT_DOCUMENT_VERSION,
          p_method: "student_app_signup"
        })
      );
      const again = await admin.from("consent_records").select("id").eq("user_id", studentId);
      assertOk(again);
      expect(again.data, "재호출로 중복 동의가 쌓였다").toHaveLength(3);

      // ── 이미 기록돼 있으면 빈 목록으로도 완료된다(가입 때 기록된 경로) ───────
      assertOk(await admin.from("profiles").update({ onboarded: false }).eq("id", studentId));
      const emptyDocs = await student.rpc("finish_onboarding_with_consent", {
        p_documents: [],
        p_version: CONSENT_DOCUMENT_VERSION,
        p_method: "teacher_web_onboarding"
      });
      assertOk(emptyDocs);
      expect((emptyDocs.data as unknown as { onboarded: boolean }).onboarded).toBe(true);

      // ── 버전이 올라가면 옛 동의로는 통과하지 못한다 ─────────────────────────
      assertOk(await admin.from("profiles").update({ onboarded: false }).eq("id", studentId));
      const newVersion = await student.rpc("finish_onboarding_with_consent", {
        p_documents: [],
        p_version: "r3-next",
        p_method: "test"
      });
      expect(newVersion.error, "새 버전인데 옛 동의로 통과했다").not.toBeNull();
      const offAgain = await admin.from("profiles").select("onboarded").eq("id", studentId).single();
      assertOk(offAgain);
      expect(offAgain.data!.onboarded).toBe(false);
    } finally {
      if (studentId) await deleteTestUsers(admin, [studentId]);
    }
  }, 120_000);

  it("publish_report: 네 단계가 함께 성립하거나 아무것도 남지 않는다", async () => {
    if (!env) throw new Error("Missing Supabase test environment");
    const keys = await fetchApiKeys(env);
    const anonKey = getApiKey(keys, "anon");
    const admin = createClient<Database>(env.url, getApiKey(keys, "service_role"), {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const suffix = randomUUID();
    const password = `Tt-${suffix}-12345678`;
    let teacherId = "";
    let studentId = "";
    let outsiderId = "";

    try {
      for (const [tag, role] of [
        ["t", "teacher"],
        ["s", "student"],
        ["o", "student"]
      ] as const) {
        const created = await admin.auth.admin.createUser({
          email: `pub${tag}-${suffix}@r3.test`,
          password,
          email_confirm: true
        });
        if (created.error) throw created.error;
        const id = created.data.user.id;
        if (tag === "t") teacherId = id;
        else if (tag === "s") studentId = id;
        else outsiderId = id;
        assertOk(
          await admin.from("profiles").insert(
            role === "teacher"
              ? { id, role, name: `R3 pub ${tag}`, onboarded: true }
              : {
                  id,
                  role,
                  name: `R3 pub ${tag}`,
                  grade: "중1",
                  birth_date: "2013-06-23",
                  guardian_consented_at: new Date().toISOString(),
                  onboarded: true
                }
          )
        );
      }

      const teacher = await signIn(env.url, anonKey, `pubt-${suffix}@r3.test`, password);
      const student = await signIn(env.url, anonKey, `pubs-${suffix}@r3.test`, password);

      const code = `P${suffix.replace(/-/g, "").slice(0, 5).toUpperCase()}`;
      assertOk(await admin.from("invite_codes").insert({ code, teacher_id: teacherId }));
      const redeemed = await student.rpc("request_connection_by_invite", { p_code: code });
      assertOk(redeemed);
      const connectionId = (redeemed.data as unknown as Redeem).connection!.id;
      assertOk(await teacher.rpc("accept_connection_request", { p_connection_id: connectionId }));

      const args = {
        p_period_start: "2026-08-10",
        p_period_end: "2026-08-16",
        p_data: { x: 1 } as never,
        p_included_subjects: ["math"] as never,
        p_channel: "link"
      };

      // ── 거부 경로들: 아무것도 남지 않아야 한다 ──────────────────────────────
      const notConnected = await teacher.rpc("publish_report", {
        ...args,
        p_student_id: outsiderId,
        p_teacher_comment: "코멘트"
      });
      expect(notConnected.error?.message, "미연결 학생에게 발송됐다").toContain("not_connected_student");

      const noComment = await teacher.rpc("publish_report", {
        ...args,
        p_student_id: studentId,
        p_teacher_comment: "   "
      });
      expect(noComment.error?.message, "코멘트 없이 발송됐다").toContain("teacher_comment_required");

      const badChannel = await teacher.rpc("publish_report", {
        ...args,
        p_channel: "sms",
        p_student_id: studentId,
        p_teacher_comment: "코멘트"
      });
      expect(badChannel.error?.message).toContain("invalid_delivery_channel");

      const nothing = await admin.from("reports").select("id").eq("teacher_id", teacherId);
      assertOk(nothing);
      expect(nothing.data, "거부됐는데 리포트가 저장됐다 — 부분 쓰기").toHaveLength(0);

      // ── 정상: 리포트 + 토큰 + status=sent + 발송 이력이 모두 성립 ───────────
      const published = await teacher.rpc("publish_report", {
        ...args,
        p_student_id: studentId,
        p_teacher_comment: "이번 주 잘했어요"
      });
      assertOk(published);
      const result = published.data as unknown as {
        report_id: string;
        delivery_status: string;
        token: string;
      };
      expect(result.delivery_status).toBe("sent");
      expect(result.token, "공유 토큰 길이가 다르다").toHaveLength(64);

      const saved = await admin
        .from("reports")
        .select("status, sent_at, share_token, share_expires_at")
        .eq("id", result.report_id)
        .single();
      assertOk(saved);
      expect(saved.data!.status).toBe("sent");
      expect(saved.data!.sent_at).not.toBeNull();
      expect(saved.data!.share_token).toBe(result.token);
      expect(saved.data!.share_expires_at).not.toBeNull();

      const delivery = await admin
        .from("report_deliveries")
        .select("channel, status, sent_at")
        .eq("report_id", result.report_id);
      assertOk(delivery);
      expect(delivery.data, "발송 이력이 없다 — 보냈는데 기록이 없다").toHaveLength(1);
      expect(delivery.data![0].status).toBe("sent");
      expect(delivery.data![0].sent_at).not.toBeNull();

      // ── 학부모 웹뷰가 이 토큰으로 열린다(익명) ──────────────────────────────
      const anon = createClient<Database>(env.url, anonKey, {
        auth: { autoRefreshToken: false, persistSession: false }
      });
      const viewed = await anon.rpc("get_shared_report", { p_token: result.token });
      assertOk(viewed);
      const view = viewed.data as unknown as { status: string; report?: { teacher_comment: string } };
      expect(view.status).toBe("ok");
      expect(view.report?.teacher_comment).toBe("이번 주 잘했어요");

      // 무효화하면 같은 토큰이 닫힌다(R1 P2-5 의 미검증 지점).
      assertOk(await teacher.rpc("revoke_report_share", { p_report_id: result.report_id }));
      const afterRevoke = await anon.rpc("get_shared_report", { p_token: result.token });
      assertOk(afterRevoke);
      expect((afterRevoke.data as unknown as { status: string }).status).toBe("not_found");

      // ── kakao: 연동 전이므로 pending + 토큰 없음 ────────────────────────────
      const pending = await teacher.rpc("publish_report", {
        ...args,
        p_channel: "kakao",
        p_period_start: "2026-08-03",
        p_period_end: "2026-08-09",
        p_student_id: studentId,
        p_teacher_comment: "코멘트2"
      });
      assertOk(pending);
      const pendingResult = pending.data as unknown as { report_id: string; delivery_status: string; token: string | null };
      expect(pendingResult.delivery_status).toBe("pending");
      expect(pendingResult.token).toBeNull();
      const pendingRow = await admin
        .from("reports")
        .select("status, share_token")
        .eq("id", pendingResult.report_id)
        .single();
      assertOk(pendingRow);
      expect(pendingRow.data!.status).toBe("draft");
      expect(pendingRow.data!.share_token, "연동 전 채널인데 토큰이 발급됐다").toBeNull();
    } finally {
      await deleteTestUsers(admin, [studentId, teacherId, outsiderId].filter(Boolean));
    }
  }, 180_000);
});

async function signIn(url: string, anonKey: string, email: string, password: string) {
  const client = createClient<Database>(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const result = await client.auth.signInWithPassword({ email, password });
  if (result.error) throw result.error;
  return client;
}

function loadTestEnv(): TestEnv | null {
  const envFile = readEnvFile(new URL("../../../.env.local", import.meta.url));
  const projectRef = process.env.SUPABASE_PROJECT_REF ?? envFile.SUPABASE_PROJECT_REF;
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN ?? envFile.SUPABASE_ACCESS_TOKEN;
  if (!projectRef || !accessToken) return null;
  return { projectRef, accessToken, url: `https://${projectRef}.supabase.co` };
}

function readEnvFile(url: URL): Record<string, string> {
  if (!existsSync(url)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(url, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!match) continue;
    const value = match[2].trim().replace(/^["']|["']$/g, "");
    if (value) out[match[1]] = value;
  }
  return out;
}

async function fetchApiKeys(testEnv: TestEnv): Promise<ApiKey[]> {
  const response = await fetch(`https://api.supabase.com/v1/projects/${testEnv.projectRef}/api-keys`, {
    headers: { Authorization: `Bearer ${testEnv.accessToken}`, Accept: "application/json" }
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
