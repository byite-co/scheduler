import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it } from "vitest";

import type { Database } from "./database.types";
import { assertNoLeakedTestUsers, deleteTestUsers } from "./rlsTestCleanup";

type ApiKey = { name: string; api_key: string };
type TestEnv = { projectRef: string; accessToken: string; url: string };
type Redeem = { ok: boolean; reason: string; retry_after_seconds?: number; connection?: { id: string; status: string } };

const env = loadTestEnv();
const describeIfRemote = env ? describe : describe.skip;

describeIfRemote("연결 수락 원자성 + 초대 코드 시도 제한 (실행 테스트)", () => {
  afterAll(assertNoLeakedTestUsers);

  it("수락은 한 트랜잭션이고, 재호출은 안전하고, 남의 연결은 못 건드린다", async () => {
    if (!env) throw new Error("Missing Supabase test environment");

    const keys = await fetchApiKeys(env);
    const anonKey = getApiKey(keys, "anon");
    const admin = createClient<Database>(env.url, getApiKey(keys, "service_role"), {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const suffix = randomUUID();
    const password = `Tt-${suffix}-12345678`;
    const ids: Record<"teacherA" | "teacherB" | "student" | "victim", string> = {
      teacherA: "",
      teacherB: "",
      student: "",
      victim: ""
    };

    try {
      // ── 계정 4개: 교사 A(주인공), 교사 B(남), 학생, 피해자 학생 ──────────────
      for (const [tag, role] of [
        ["teacherA", "teacher"],
        ["teacherB", "teacher"],
        ["student", "student"],
        ["victim", "student"]
      ] as const) {
        const created = await admin.auth.admin.createUser({
          email: `${tag}-${suffix}@a5.test`,
          password,
          email_confirm: true
        });
        if (created.error) throw created.error;
        ids[tag] = created.data.user.id;
        assertOk(
          await admin.from("profiles").insert(
            role === "teacher"
              ? { id: ids[tag], role, name: `A5 ${tag}`, onboarded: true }
              : {
                  id: ids[tag],
                  role,
                  name: `A5 ${tag}`,
                  grade: "중1",
                  birth_date: "2013-06-23",
                  guardian_consented_at: new Date().toISOString(),
                  onboarded: true
                }
          )
        );
      }

      const teacherA = await signIn(env.url, anonKey, `teacherA-${suffix}@a5.test`, password);
      const teacherB = await signIn(env.url, anonKey, `teacherB-${suffix}@a5.test`, password);
      const student = await signIn(env.url, anonKey, `student-${suffix}@a5.test`, password);

      const inviteCode = `B${suffix.replace(/-/g, "").slice(0, 5).toUpperCase()}`;
      assertOk(await admin.from("invite_codes").insert({ code: inviteCode, teacher_id: ids.teacherA }));

      // ── 학생이 코드를 넣어 pending 연결을 만든다 ─────────────────────────────
      const requested = await student.rpc("request_connection_by_invite", { p_code: inviteCode });
      assertOk(requested);
      const redeemed = requested.data as unknown as Redeem;
      expect(redeemed.ok).toBe(true);
      const connectionId = redeemed.connection!.id;
      expect(redeemed.connection!.status).toBe("pending");

      // 수락 전에는 설정 행이 없다 — 이게 있으면 "수락이 만든다" 를 증명할 수 없다.
      const before = await admin.from("per_student_settings").select("connection_id").eq("connection_id", connectionId);
      assertOk(before);
      expect(before.data).toEqual([]);

      // ── 1) 타 교사(B)의 수락 시도는 거부된다 ────────────────────────────────
      const foreign = await teacherB.rpc("accept_connection_request", { p_connection_id: connectionId });
      expect(foreign.error?.message).toContain("not_connection_teacher");
      const stillPending = await admin.from("connections").select("status").eq("id", connectionId).single();
      assertOk(stillPending);
      expect(stillPending.data!.status).toBe("pending");
      // 거부됐으면 설정 행도 생기지 않았어야 한다(트랜잭션 롤백).
      const afterForeign = await admin
        .from("per_student_settings")
        .select("connection_id")
        .eq("connection_id", connectionId);
      assertOk(afterForeign);
      expect(afterForeign.data).toEqual([]);

      // ── 2) 정상 수락: 상태 전이 + 설정 생성이 함께 일어난다 ─────────────────
      const accepted = await teacherA.rpc("accept_connection_request", { p_connection_id: connectionId });
      assertOk(accepted);
      const acceptedRow = accepted.data as unknown as { id: string; status: string; activated_at: string | null };
      expect(acceptedRow.status).toBe("active");
      expect(acceptedRow.activated_at).not.toBeNull();

      const settings = await admin
        .from("per_student_settings")
        .select("connection_id, report_cycle, ai_check_subjects")
        .eq("connection_id", connectionId);
      assertOk(settings);
      expect(settings.data).toHaveLength(1);
      // 기본값은 표가 준다(shared 의 DEFAULT_TEACHER_STUDENT_SETTINGS 와 같은 값).
      expect(settings.data![0].report_cycle).toBe("weekly");
      expect(settings.data![0].ai_check_subjects).toEqual([]);

      // ── 3) 재호출 멱등: 오류 없이 같은 상태, 설정 행은 여전히 1개 ────────────
      const again = await teacherA.rpc("accept_connection_request", { p_connection_id: connectionId });
      assertOk(again);
      expect((again.data as unknown as { status: string }).status).toBe("active");
      const settingsAgain = await admin
        .from("per_student_settings")
        .select("connection_id")
        .eq("connection_id", connectionId);
      assertOk(settingsAgain);
      expect(settingsAgain.data).toHaveLength(1);

      // ── 4) 부분 실패가 불가능함을 반대편에서 확인한다 ────────────────────────
      // 설정 행을 지운 뒤 재호출하면 보정된다 = 두 쓰기가 같은 경로에 묶여 있다는 증거.
      assertOk(await admin.from("per_student_settings").delete().eq("connection_id", connectionId));
      const repaired = await teacherA.rpc("accept_connection_request", { p_connection_id: connectionId });
      assertOk(repaired);
      const settingsRepaired = await admin
        .from("per_student_settings")
        .select("connection_id")
        .eq("connection_id", connectionId);
      assertOk(settingsRepaired);
      expect(settingsRepaired.data).toHaveLength(1);

      // ── 5) 신원 컬럼 동결: 교사가 student_id 를 남의 학생으로 바꿀 수 없다 ──
      const swap = await teacherA
        .from("connections")
        .update({ student_id: ids.victim })
        .eq("id", connectionId)
        .select("id");
      expect(swap.error).not.toBeNull();
      expect(swap.error?.code).toBe("42501");
      const unchanged = await admin.from("connections").select("student_id").eq("id", connectionId).single();
      assertOk(unchanged);
      expect(unchanged.data!.student_id).toBe(ids.student);

      // 상태 전이 자체는 여전히 된다(거절 경로가 살아 있어야 한다).
      const reject = await teacherA
        .from("connections")
        .update({ status: "rejected", activated_at: null })
        .eq("id", connectionId)
        .select("status");
      assertOk(reject);
      expect(reject.data).toEqual([{ status: "rejected" }]);

      // ── 6) 되살리기 금지: rejected 를 수락으로 통과시키지 않는다 ─────────────
      const revive = await teacherA.rpc("accept_connection_request", { p_connection_id: connectionId });
      expect(revive.error?.message).toContain("connection_not_pending");
    } finally {
      await deleteTestUsers(admin, Object.values(ids).filter(Boolean));
    }
  }, 120_000);

  it("초대 코드 시도: 임계 내 성공 / 초과 시 차단 / 창이 지나면 해제", async () => {
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

    try {
      const teacher = await admin.auth.admin.createUser({
        email: `t-${suffix}@a5.test`,
        password,
        email_confirm: true
      });
      if (teacher.error) throw teacher.error;
      teacherId = teacher.data.user.id;
      const student = await admin.auth.admin.createUser({
        email: `s-${suffix}@a5.test`,
        password,
        email_confirm: true
      });
      if (student.error) throw student.error;
      studentId = student.data.user.id;

      assertOk(
        await admin.from("profiles").insert([
          { id: teacherId, role: "teacher", name: "A5 limit teacher", onboarded: true },
          {
            id: studentId,
            role: "student",
            name: "A5 limit student",
            grade: "중1",
            birth_date: "2013-06-23",
            guardian_consented_at: new Date().toISOString(),
            onboarded: true
          }
        ])
      );

      const realCode = `C${suffix.replace(/-/g, "").slice(0, 5).toUpperCase()}`;
      assertOk(await admin.from("invite_codes").insert({ code: realCode, teacher_id: teacherId }));

      const client = await signIn(env.url, anonKey, `s-${suffix}@a5.test`, password);
      const redeem = async (code: string) => {
        const r = await client.rpc("request_connection_by_invite", { p_code: code });
        assertOk(r); // 사용자 입력 실패는 error 가 아니다 — 이것 자체가 계약의 일부다.
        return r.data as unknown as Redeem;
      };

      // ── 임계 내(9회): 전부 통과하고 차단되지 않는다 ────────────────────────
      const firstNine: string[] = [];
      for (let i = 0; i < 9; i++) firstNine.push((await redeem(`ZZ${String(i).padStart(4, "0")}`)).reason);
      expect(firstNine).toEqual(Array(9).fill("not_found"));

      const recorded = await admin.from("invite_attempts").select("outcome").eq("student_id", studentId);
      assertOk(recorded);
      expect(recorded.data).toHaveLength(9);

      // 9회 실패한 상태에서도 진짜 코드는 아직 쓸 수 있다 — 정상 사용자를 먼저 막지 않는다.
      const stillWorks = await redeem(realCode);
      expect(stillWorks.ok).toBe(true);
      expect(stillWorks.reason).toBe("created");

      // ── 초과(10번째 실패 후): 차단된다 ─────────────────────────────────────
      const tenth = await redeem("ZZ9999");
      expect(tenth.reason).toBe("not_found"); // 10번째 실패까지는 판정을 받는다
      const blocked = await redeem("ZZ8888");
      expect(blocked.ok).toBe(false);
      expect(blocked.reason).toBe("rate_limited");
      expect(blocked.retry_after_seconds).toBeGreaterThan(0);
      expect(blocked.retry_after_seconds).toBeLessThanOrEqual(600);

      // 차단된 시도는 기록되지 않는다(기록하면 두드리는 동안 영구 차단이 된다).
      const afterBlock = await admin.from("invite_attempts").select("outcome").eq("student_id", studentId);
      assertOk(afterBlock);
      expect(afterBlock.data!.filter((row) => row.outcome !== "success")).toHaveLength(10);

      // 차단 중에는 진짜 코드도 통하지 않는다 — 그래야 추측을 막는 의미가 있다.
      const blockedReal = await redeem(realCode);
      expect(blockedReal.reason).toBe("rate_limited");

      // ── 창이 지나면 해제된다 ───────────────────────────────────────────────
      // 실제로 10분 기다리지 않는다. 기록의 시각을 창 밖으로 밀어 같은 상태를 만든다.
      assertOk(
        await admin
          .from("invite_attempts")
          .update({ attempted_at: new Date(Date.now() - 11 * 60 * 1000).toISOString() })
          .eq("student_id", studentId)
      );
      const released = await redeem("ZZ7777");
      expect(released.reason).toBe("not_found"); // 차단이 풀렸다

      // 창 밖 기록은 스스로 정리된다 — 방금 것 1건만 남는다.
      const pruned = await admin.from("invite_attempts").select("outcome").eq("student_id", studentId);
      assertOk(pruned);
      expect(pruned.data).toHaveLength(1);
    } finally {
      await deleteTestUsers(admin, [studentId, teacherId].filter(Boolean));
    }
  }, 120_000);
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

export type { SupabaseClient };
