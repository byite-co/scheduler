import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it } from "vitest";

import type { Database } from "./database.types";
import { createTeacherReviewPatch } from "./m4";
import { assertNoLeakedTestUsers, deleteTestUsers } from "./rlsTestCleanup";

type ApiKey = { api_key: string; name: string };
type TestEnv = { accessToken: string; projectRef: string; url: string };

const env = loadTestEnv();
const describeIfRemote = env ? describe : describe.skip;

describeIfRemote("M4 homework AI-check RLS against linked Supabase", () => {
  // 정리 실패는 finally 에서 throw 하면 원래 실패 원인을 덮어쓴다 → 여기서 따로 터뜨린다.
  afterAll(assertNoLeakedTestUsers);

  it("keeps AI verdict server-authoritative and teacher reads gated by photo disclosure", async () => {
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
    const soloClient = createClient<Database>(env.url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const suffix = randomUUID();
    const password = `M4-hw-${suffix}-12345678`;
    const teacherEmail = `teacher-${suffix}@m4-hw.test`;
    const studentEmail = `student-${suffix}@m4-hw.test`;
    const soloEmail = `solo-${suffix}@m4-hw.test`;
    let teacherId = "";
    let studentId = "";
    let soloId = "";

    try {
      const teacher = await admin.auth.admin.createUser({ email: teacherEmail, email_confirm: true, password });
      const student = await admin.auth.admin.createUser({ email: studentEmail, email_confirm: true, password });
      const solo = await admin.auth.admin.createUser({ email: soloEmail, email_confirm: true, password });
      if (teacher.error) throw teacher.error;
      if (student.error) throw student.error;
      if (solo.error) throw solo.error;
      teacherId = teacher.data.user.id;
      studentId = student.data.user.id;
      soloId = solo.data.user.id;

      assertOk(
        await admin.from("profiles").insert([
          { id: teacherId, role: "teacher", name: "M4 teacher", onboarded: true },
          { id: studentId, role: "student", name: "M4 tutored", onboarded: true },
          { id: soloId, role: "student", name: "M4 solo", onboarded: true }
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
          share_homework_photos: true,
          share_study_time: true,
          share_focus_data: false
        })
      );

      // 선생님 숙제(과외생) + 혼공 본인 할 일
      const teacherTodo = await admin
        .from("todos")
        .insert({
          student_id: studentId,
          connection_id: connectionId,
          title: "수학 p.116~118",
          subject: "math",
          source: "teacher",
          ai_check_enabled: true,
          locked: true,
          created_by: teacherId
        })
        .select("id")
        .single();
      assertOk(teacherTodo);
      const teacherTodoId = assertData(teacherTodo.data).id;

      const soloTodo = await admin
        .from("todos")
        .insert({
          student_id: soloId,
          title: "영어 단어 30개",
          subject: "english",
          source: "self",
          ai_check_enabled: true,
          created_by: soloId
        })
        .select("id")
        .single();
      assertOk(soloTodo);
      const soloTodoId = assertData(soloTodo.data).id;

      await signIn(studentClient, studentEmail, password);
      await signIn(teacherClient, teacherEmail, password);
      await signIn(soloClient, soloEmail, password);

      // 학생은 제출은 하되, AI 판정 필드는 직접 쓸 수 없다(서버 권위적).
      const forgedVerdict = await studentClient.from("homework_submissions").insert({
        todo_id: teacherTodoId,
        student_id: studentId,
        photo_paths: ["homework-photos/forged.jpg"],
        ai_verdict: "pass"
      });
      expect(forgedVerdict.error).not.toBeNull();

      const submitted = await studentClient
        .from("homework_submissions")
        .insert({
          todo_id: teacherTodoId,
          student_id: studentId,
          photo_paths: ["homework-photos/p1.jpg", "homework-photos/p2.jpg"]
        })
        .select("id, ai_verdict")
        .single();
      assertOk(submitted);
      const submissionId = assertData(submitted.data).id;
      expect(submitted.data?.ai_verdict).toBeNull();

      // 학생이 update로 ai_verdict 위조 시도 → 차단
      const forgedUpdate = await studentClient
        .from("homework_submissions")
        .update({ ai_verdict: "pass" })
        .eq("id", submissionId);
      expect(forgedUpdate.error).not.toBeNull();

      // 서버(서비스롤)만 AI 판정을 기록할 수 있다.
      const verdictRpc = await admin.rpc("apply_homework_ai_verdict", {
        p_submission_id: submissionId,
        p_verdict: "insufficient",
        p_confidence: 0.72,
        p_reason: "일부 분량 누락 (자동 점검 미리보기)"
      });
      assertOk(verdictRpc);

      const studentSees = await studentClient
        .from("homework_submissions")
        .select("ai_verdict, ai_confidence, ai_reason")
        .eq("id", submissionId)
        .single();
      assertOk(studentSees);
      expect(studentSees.data).toMatchObject({ ai_verdict: "insufficient", ai_confidence: 0.72 });

      // 사진 공개 ON → 과외쌤이 제출 조회 가능
      const teacherSeesOn = await teacherClient
        .from("homework_submissions")
        .select("id, ai_verdict")
        .eq("id", submissionId);
      assertOk(teacherSeesOn);
      expect(teacherSeesOn.data).toEqual([{ id: submissionId, ai_verdict: "insufficient" }]);

      // 사진 공개 OFF → 과외쌤이 못 본다(공개범위 RLS)
      assertOk(
        await admin
          .from("disclosure_settings")
          .update({ share_homework_photos: false })
          .eq("connection_id", connectionId)
      );
      const teacherSeesOff = await teacherClient
        .from("homework_submissions")
        .select("id")
        .eq("id", submissionId);
      assertOk(teacherSeesOff);
      expect(teacherSeesOff.data).toEqual([]);

      // 다시 공개 ON 후 과외쌤 반려(다시 제출 요청)
      assertOk(
        await admin
          .from("disclosure_settings")
          .update({ share_homework_photos: true })
          .eq("connection_id", connectionId)
      );
      const rejectPatch = createTeacherReviewPatch("reject", "p.118 풀이를 마저 채워볼까요");
      assertOk(
        await teacherClient.from("homework_submissions").update(rejectPatch).eq("id", submissionId)
      );

      // 학생은 teacher_* 를 바꿀 수 없다.
      const studentForgesTeacher = await studentClient
        .from("homework_submissions")
        .update({ teacher_status: "confirmed", resubmit_requested: false })
        .eq("id", submissionId);
      expect(studentForgesTeacher.error).not.toBeNull();

      const afterReject = await studentClient
        .from("homework_submissions")
        .select("teacher_status, teacher_comment, resubmit_requested")
        .eq("id", submissionId)
        .single();
      assertOk(afterReject);
      expect(afterReject.data).toEqual({
        teacher_status: "rejected",
        teacher_comment: "p.118 풀이를 마저 채워볼까요",
        resubmit_requested: true
      });

      // 혼공생 제출은 연결된 과외쌤이 없어 어떤 과외쌤에게도 안 보인다(AI 단독).
      const soloSubmission = await soloClient
        .from("homework_submissions")
        .insert({ todo_id: soloTodoId, student_id: soloId, photo_paths: ["homework-photos/solo.jpg"] })
        .select("id")
        .single();
      assertOk(soloSubmission);
      const soloSubmissionId = assertData(soloSubmission.data).id;
      const teacherSeesSolo = await teacherClient
        .from("homework_submissions")
        .select("id")
        .eq("id", soloSubmissionId);
      assertOk(teacherSeesSolo);
      expect(teacherSeesSolo.data).toEqual([]);
    } finally {
      await deleteTestUsers(admin, [studentId, soloId, teacherId]);
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
