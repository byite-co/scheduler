import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { PEER_RANKING_MIN_COHORT, TODO_SCOPE_TEXT_MAX_LENGTH } from "./m2";
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
          // AI 검사가 대조할 범위 원문. title 과 별개 컬럼이다.
          scope_text: "쎈 112~118p, 115p 제외",
          subject: "math",
          source: "teacher",
          ai_check_enabled: true,
          locked: false,
          status: "todo",
          created_by: teacherId
        })
        .select("id, ai_check_enabled, locked, status, scope_text")
        .single();
      assertOk(homework);
      const homeworkRow = assertData(homework.data);
      expect(homeworkRow.locked).toBe(true);
      expect(homeworkRow.scope_text).toBe("쎈 112~118p, 115p 제외");

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

      // SECURITY: 허용 목록 방식이라 범위(title)·과목·마감일도 학생이 못 바꿔야 한다.
      // (금지 목록 시절에는 이 3개가 통과했다 — 학생이 검사 범위를 좁혀 AI 검사를 우회할 수 있었다.)
      // scope_text 는 허용 목록에 넣지 않는 것만으로 잠긴다(허용 목록 방식의 효과).
      // 학생이 이걸 바꿀 수 있으면 검사 범위를 자기에게 유리하게 좁혀 AI 검사를 무력화한다.
      for (const patch of [
        { title: "학생이 좁힌 범위 p.1" },
        { scope_text: "쎈 112p만" },
        { scope_text: null },
        { subject: "english" as const },
        { due_date: "2030-01-01" }
      ]) {
        const tampered = await studentClient.from("todos").update(patch).eq("id", homeworkRow.id);
        expect(tampered.error?.message).toContain("locked_teacher_todo_fields");
      }

      // 회귀: 완료 체크(status)는 여전히 허용.
      assertOk(
        await studentClient
          .from("todos")
          .update({ status: "done" })
          .eq("id", homeworkRow.id)
      );
      const visible = await studentClient
        .from("todos")
        .select("ai_check_enabled, status, title, subject, due_date, scope_text")
        .eq("id", homeworkRow.id)
        .single();
      assertOk(visible);
      // 잠긴 필드는 원본 그대로여야 한다.
      expect(visible.data).toMatchObject({
        ai_check_enabled: true,
        status: "done",
        subject: "math",
        // 교사가 정한 검사 범위가 학생의 시도 뒤에도 원문 그대로 남아야 한다.
        scope_text: "쎈 112~118p, 115p 제외"
      });
      expect(visible.data?.title).not.toContain("학생이 좁힌 범위");
      expect(visible.data?.due_date).not.toBe("2030-01-01");

      // 회귀: 내가 만든 할 일(source=self)은 내용 편집이 여전히 가능해야 한다.
      const ownTodo = await studentClient
        .from("todos")
        .insert({
          student_id: studentId,
          title: "내 할 일",
          subject: "math",
          source: "self",
          status: "todo",
          created_by: studentId
        })
        .select("id")
        .single();
      assertOk(ownTodo);
      const ownId = assertData(ownTodo.data).id;
      assertOk(
        await studentClient
          .from("todos")
          .update({ title: "내 할 일(수정)", due_date: "2030-02-02", ai_check_enabled: true })
          .eq("id", ownId)
      );

      // source='self' 에서는 학생이 scope_text 를 직접 정할 수 있어야 한다(혼공 AI 검사 기준).
      const readScope = async () => {
        const row = await studentClient.from("todos").select("scope_text").eq("id", ownId).single();
        assertOk(row);
        return row.data?.scope_text ?? null;
      };
      assertOk(await studentClient.from("todos").update({ scope_text: "영단어 Day 12~14" }).eq("id", ownId));
      expect(await readScope()).toBe("영단어 Day 12~14");

      // 정규화: 빈 문자열·공백뿐인 입력은 NULL 로 저장된다("범위 없음"의 표현을 하나로 고정).
      for (const blank of ["", "   ", "\t\n "]) {
        assertOk(await studentClient.from("todos").update({ scope_text: blank }).eq("id", ownId));
        expect(await readScope()).toBeNull();
      }
      // 앞뒤 공백은 제거되고 내용은 보존된다.
      assertOk(await studentClient.from("todos").update({ scope_text: "  기출 21~30번  " }).eq("id", ownId));
      expect(await readScope()).toBe("기출 21~30번");

      // 길이 상한은 DB 가 강제한다 — 공백을 제외한 글자 수 기준.
      const maxLen = TODO_SCOPE_TEXT_MAX_LENGTH;
      assertOk(await studentClient.from("todos").update({ scope_text: "가".repeat(maxLen) }).eq("id", ownId));
      expect(await readScope()).toHaveLength(maxLen);
      // 공백은 세지 않으므로, 같은 글자수에 공백을 잔뜩 넣어도 통과해야 한다.
      assertOk(await studentClient.from("todos").update({ scope_text: "가 ".repeat(maxLen) }).eq("id", ownId));
      // 공백 제외 상한 초과는 거부된다(CHECK 제약 위반).
      const tooLong = await studentClient
        .from("todos")
        .update({ scope_text: "가".repeat(maxLen + 1) })
        .eq("id", ownId);
      expect(tooLong.error?.message ?? "").toContain("todos_scope_text_len");

      // 단, 자기 할 일에서도 소유·출처 컬럼은 잠긴다.
      const ownTampered = await studentClient
        .from("todos")
        .update({ source: "teacher" })
        .eq("id", ownId);
      expect(ownTampered.error?.message).toBeTruthy();
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
