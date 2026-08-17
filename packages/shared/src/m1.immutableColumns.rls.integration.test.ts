import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it } from "vitest";

import type { Database } from "./database.types";
import { assertNoLeakedTestUsers, deleteTestUsers } from "./rlsTestCleanup";

type ApiKey = { name: string; api_key: string };
type TestEnv = { projectRef: string; accessToken: string; url: string };
type Redeem = { ok: boolean; reason: string; connection?: { id: string; status: string } };

const env = loadTestEnv();
const describeIfRemote = env ? describe : describe.skip;

describeIfRemote("불변 컬럼 스윕 (실행 테스트)", () => {
  afterAll(assertNoLeakedTestUsers);

  it("소유자가 바꿔서는 안 되는 컬럼은 막히고, 정상 흐름은 그대로 돈다", async () => {
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
        ["teacher", "teacher"],
        ["student", "student"],
        ["outsider", "student"]
      ] as const) {
        const created = await admin.auth.admin.createUser({
          email: `${tag}-${suffix}@a51.test`,
          password,
          email_confirm: true
        });
        if (created.error) throw created.error;
        const id = created.data.user.id;
        if (tag === "teacher") teacherId = id;
        else if (tag === "student") studentId = id;
        else outsiderId = id;

        assertOk(
          await admin.from("profiles").insert(
            role === "teacher"
              ? { id, role, name: `A51 ${tag}`, onboarded: true }
              : {
                  id,
                  role,
                  name: `A51 ${tag}`,
                  grade: "중1",
                  birth_date: "2013-06-23",
                  guardian_consented_at: new Date().toISOString(),
                  onboarded: true
                }
          )
        );
      }

      const teacher = await signIn(env.url, anonKey, `teacher-${suffix}@a51.test`, password);
      const student = await signIn(env.url, anonKey, `student-${suffix}@a51.test`, password);

      // ── profiles.role: 승격은 막히고, 같은 값으로 저장하는 정상 흐름은 통과 ──
      const escalate = await student.from("profiles").update({ role: "teacher" }).eq("id", studentId).select("id");
      expect(escalate.error?.message).toContain("role_is_not_self_assignable");
      const roleNow = await admin.from("profiles").select("role").eq("id", studentId).single();
      assertOk(roleNow);
      expect(roleNow.data!.role).toBe("student");

      // 세 앱의 프로필 저장은 upsert 이고 role 을 매번 같은 값으로 보낸다 — 깨지면 안 된다.
      const normalSave = await student
        .from("profiles")
        .upsert({
          id: studentId,
          role: "student",
          name: "A51 student 수정",
          birth_date: "2013-06-23",
          grade: "중2",
          onboarded: true
        })
        .select("name, grade");
      assertOk(normalSave);
      expect(normalSave.data).toEqual([{ name: "A51 student 수정", grade: "중2" }]);

      // ── connections: 직접 INSERT 는 막히고, RPC 경로는 돈다 ──────────────────
      const directInsert = await student
        .from("connections")
        .insert({ teacher_id: teacherId, student_id: studentId, status: "pending", requested_by: studentId })
        .select("id");
      expect(directInsert.error?.code).toBe("42501");

      const code = `D${suffix.replace(/-/g, "").slice(0, 5).toUpperCase()}`;
      assertOk(await admin.from("invite_codes").insert({ code, teacher_id: teacherId }));
      const redeemed = await student.rpc("request_connection_by_invite", { p_code: code });
      assertOk(redeemed);
      const result = redeemed.data as unknown as Redeem;
      expect(result.ok).toBe(true);
      const connectionId = result.connection!.id;

      const accepted = await teacher.rpc("accept_connection_request", { p_connection_id: connectionId });
      assertOk(accepted);
      expect((accepted.data as unknown as { status: string }).status).toBe("active");

      // ── todos: 선생님 숙제는 학생이 지울 수 없고, 자기 할 일은 지울 수 있다 ──
      const teacherTodo = await admin
        .from("todos")
        .insert({
          student_id: studentId,
          connection_id: connectionId,
          title: "선생님 숙제",
          subject: "math",
          scope_text: "p.1-2",
          source: "teacher",
          created_by: teacherId,
          ai_check_enabled: true
        })
        .select("id, locked")
        .single();
      assertOk(teacherTodo);
      expect(teacherTodo.data!.locked).toBe(true);

      const deleteTeacherTodo = await student.from("todos").delete().eq("id", teacherTodo.data!.id).select("id");
      expect(deleteTeacherTodo.error?.message).toContain("students_cannot_delete_teacher_todos");
      const survived = await admin.from("todos").select("id").eq("id", teacherTodo.data!.id);
      assertOk(survived);
      expect(survived.data).toHaveLength(1);

      const selfTodo = await student
        .from("todos")
        .insert({ student_id: studentId, title: "내 할 일", source: "self", created_by: studentId })
        .select("id")
        .single();
      assertOk(selfTodo);
      const deleteSelfTodo = await student.from("todos").delete().eq("id", selfTodo.data!.id).select("id");
      assertOk(deleteSelfTodo);
      expect(deleteSelfTodo.data).toHaveLength(1);

      // 학생이 상태는 바꿀 수 있어야 한다(선생님 숙제도 done 처리는 학생 몫이다).
      const markDone = await student
        .from("todos")
        .update({ status: "done" })
        .eq("id", teacherTodo.data!.id)
        .select("status");
      assertOk(markDone);
      expect(markDone.data).toEqual([{ status: "done" }]);

      // ── reports: 공유 토큰·귀속은 막히고, 발송 상태는 통과 ───────────────────
      const report = await admin
        .from("reports")
        .insert({
          teacher_id: teacherId,
          student_id: studentId,
          type: "weekly",
          period_start: "2026-08-10",
          period_end: "2026-08-16",
          status: "draft",
          share_token: "ORIGINAL"
        })
        .select("id")
        .single();
      assertOk(report);

      const forgeToken = await teacher
        .from("reports")
        .update({ share_token: "GUESSABLE" })
        .eq("id", report.data!.id)
        .select("id");
      expect(forgeToken.error?.code).toBe("42501");
      const retarget = await teacher
        .from("reports")
        .update({ student_id: outsiderId })
        .eq("id", report.data!.id)
        .select("id");
      expect(retarget.error?.code).toBe("42501");
      const tokenNow = await admin.from("reports").select("share_token, student_id").eq("id", report.data!.id).single();
      assertOk(tokenNow);
      expect(tokenNow.data!.share_token).toBe("ORIGINAL");
      expect(tokenNow.data!.student_id).toBe(studentId);

      // m5.tsx:445 의 정상 흐름.
      const send = await teacher
        .from("reports")
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("id", report.data!.id)
        .select("status");
      assertOk(send);
      expect(send.data).toEqual([{ status: "sent" }]);

      // ── invite_codes: 발급은 되고 UPDATE 는 안 된다 ──────────────────────────
      const newCode = `E${suffix.replace(/-/g, "").slice(0, 5).toUpperCase()}`;
      const issue = await teacher.from("invite_codes").insert({ code: newCode, teacher_id: teacherId }).select("code");
      assertOk(issue);
      const forgeUsedBy = await teacher
        .from("invite_codes")
        .update({ used_by: outsiderId })
        .eq("code", newCode)
        .select("code");
      expect(forgeUsedBy.error?.code).toBe("42501");

      // ── lesson_fees: 연결 없는 학생에게는 청구할 수 없다 ─────────────────────
      const feeForOutsider = await teacher
        .from("lesson_fees")
        .insert({ teacher_id: teacherId, student_id: outsiderId, period: "2026-09", amount: 999999 })
        .select("id");
      expect(feeForOutsider.error?.code).toBe("42501");

      const feeForStudent = await teacher
        .from("lesson_fees")
        .insert({ teacher_id: teacherId, student_id: studentId, period: "2026-08", amount: 400000 })
        .select("id, amount")
        .single();
      assertOk(feeForStudent);
      expect(feeForStudent.data!.amount).toBe(400000);

      // 납부 토글(양 앱의 정상 흐름)은 그대로 돈다.
      const togglePaid = await teacher
        .from("lesson_fees")
        .update({ paid: true, paid_at: new Date().toISOString() })
        .eq("id", feeForStudent.data!.id)
        .select("paid");
      assertOk(togglePaid);
      expect(togglePaid.data).toEqual([{ paid: true }]);

      // 연결이 끊긴 뒤에도 청구서에 접근할 수 있어야 한다(active 를 요구하지 않은 이유).
      assertOk(await admin.from("connections").update({ status: "disconnected" }).eq("id", connectionId));
      const afterDisconnect = await teacher.from("lesson_fees").select("id").eq("id", feeForStudent.data!.id);
      assertOk(afterDisconnect);
      expect(afterDisconnect.data).toHaveLength(1);
    } finally {
      await deleteTestUsers(admin, [studentId, teacherId, outsiderId].filter(Boolean));
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
