import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it } from "vitest";

import type { Database } from "./database.types";
import { HOMEWORK_PHOTO_MAX_BYTES, buildHomeworkPhotoPath } from "./m4";
import { assertNoLeakedTestUsers, deleteTestUsers } from "./rlsTestCleanup";

type ApiKey = { api_key: string; name: string };
type TestEnv = { accessToken: string; projectRef: string; url: string };

const BUCKET = "homework-photos";

// 1x1 JPEG (실제 유효한 파일). Storage 는 확장자가 아니라 contentType 으로 MIME 을 본다.
const TINY_JPEG = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
  0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x03, 0x02, 0x02, 0x03, 0x02, 0x02, 0x03, 0x03, 0x03, 0x03, 0x04, 0x03, 0x03,
  0x04, 0x05, 0x08, 0x05, 0x05, 0x04, 0x04, 0x05, 0x0a, 0x07, 0x07, 0x06, 0x08, 0x0c, 0x0a, 0x0c, 0x0c, 0x0b, 0x0b,
  0x0c, 0x09, 0x0b, 0x0b, 0x0d, 0x0e, 0x12, 0x10, 0x0d, 0x0e, 0x11, 0x0e, 0x0b, 0x0b, 0x10, 0x16, 0x10, 0x11, 0x13,
  0x14, 0x15, 0x15, 0x15, 0x0c, 0x0f, 0x17, 0x18, 0x16, 0x14, 0x15, 0x14, 0xff, 0xc9, 0x00, 0x0b, 0x08, 0x00, 0x01,
  0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xcc, 0x00, 0x06, 0x00, 0x10, 0x10, 0x05, 0xff, 0xda, 0x00, 0x08, 0x01,
  0x01, 0x00, 0x00, 0x3f, 0x00, 0xd2, 0xcf, 0x20, 0xff, 0xd9
]);

const env = loadTestEnv();
const describeIfRemote = env ? describe : describe.skip;

describeIfRemote("M4 숙제 사진 Storage 업로드·열람", () => {
  afterAll(assertNoLeakedTestUsers);

  it("uploads to the student's own folder and gates teacher access by disclosure", async () => {
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
    const otherClient = createClient<Database>(env.url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    const teacherClient = createClient<Database>(env.url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const suffix = randomUUID();
    const password = `M4-photo-${suffix}-12345678`;
    const teacherEmail = `teacher-${suffix}@m4-photo.test`;
    const studentEmail = `student-${suffix}@m4-photo.test`;
    const otherEmail = `other-${suffix}@m4-photo.test`;
    let teacherId = "";
    let studentId = "";
    let otherId = "";
    const uploadedPaths: string[] = [];

    try {
      const mk = async (email: string, role: "teacher" | "student", name: string, extra = {}) => {
        const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
        if (created.error) throw created.error;
        const id = created.data.user.id;
        assertOk(await admin.from("profiles").insert({ id, role, name, onboarded: true, ...extra }));
        return id;
      };
      const studentExtra = {
        grade: "고1",
        birth_date: "2010-03-01",
        guardian_consented_at: new Date().toISOString()
      };

      teacherId = await mk(teacherEmail, "teacher", "photo teacher");
      studentId = await mk(studentEmail, "student", "photo student", studentExtra);
      otherId = await mk(otherEmail, "student", "photo other", studentExtra);

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
      assertOk(
        await admin.from("disclosure_settings").insert({ connection_id: connectionId, share_homework_photos: true })
      );

      const todo = await admin
        .from("todos")
        .insert({
          student_id: studentId,
          connection_id: connectionId,
          title: "미적분 단원 마무리",
          scope_text: "쎈 112~118p",
          subject: "math",
          source: "teacher",
          ai_check_enabled: true,
          locked: true,
          created_by: teacherId
        })
        .select("id")
        .single();
      assertOk(todo);
      const todoId = assertData(todo.data).id;

      await signIn(studentClient, studentEmail, password);
      await signIn(otherClient, otherEmail, password);
      await signIn(teacherClient, teacherEmail, password);

      const submissionKey = `${Date.now()}`;
      const path = buildHomeworkPhotoPath({ studentId, todoId, submissionKey, index: 0 });

      // ── (1) 학생이 자기 폴더에 올리면 실제 파일이 생긴다 ─────────────────
      const upload = await studentClient.storage
        .from(BUCKET)
        .upload(path, TINY_JPEG, { contentType: "image/jpeg", upsert: false });
      expect(upload.error, upload.error?.message).toBeNull();
      uploadedPaths.push(path);

      const listed = await admin.storage.from(BUCKET).list(`${studentId}/${todoId}/${submissionKey}`);
      assertOk(listed);
      expect((listed.data ?? []).map((f) => f.name)).toContain("page-1.jpg");

      // ── (2) photo_paths 가 실제 경로를 담는다 ────────────────────────────
      const submission = await studentClient
        .from("homework_submissions")
        .insert({ todo_id: todoId, student_id: studentId, photo_paths: [path] })
        .select("id, photo_paths")
        .single();
      assertOk(submission);
      expect(assertData(submission.data).photo_paths).toEqual([path]);
      const submissionId = assertData(submission.data).id;

      // 제출 레코드가 남의 폴더를 가리키면 과외쌤 화면에 다른 학생 사진이 뜬다 → 가드가 막는다.
      const forged = await studentClient
        .from("homework_submissions")
        .insert({ todo_id: todoId, student_id: studentId, photo_paths: [`${otherId}/forged.jpg`] });
      expect(forged.error?.message ?? "").toContain("photo_paths_must_be_in_own_folder");

      // ── (7) 10장 이상 → 거부 ─────────────────────────────────────────────
      const tooMany = await studentClient.from("homework_submissions").insert({
        todo_id: todoId,
        student_id: studentId,
        photo_paths: Array.from({ length: 10 }, (_, i) => `${studentId}/x/page-${i + 1}.jpg`)
      });
      expect(tooMany.error?.message ?? "").toContain("subs_photo_count");
      const zero = await studentClient
        .from("homework_submissions")
        .insert({ todo_id: todoId, student_id: studentId, photo_paths: [] });
      expect(zero.error?.message ?? "").toContain("subs_photo_count");

      // ── (3) 남의 폴더에 업로드 → 거부 ────────────────────────────────────
      const intoOthersFolder = await studentClient.storage
        .from(BUCKET)
        .upload(`${otherId}/${todoId}/${submissionKey}/page-1.jpg`, TINY_JPEG, { contentType: "image/jpeg" });
      expect(intoOthersFolder.error).toBeTruthy();

      // ── (4) 남의 사진 조회 → 거부(서명 URL 미발급) ───────────────────────
      const otherReads = await otherClient.storage.from(BUCKET).createSignedUrl(path, 60);
      expect(otherReads.error).toBeTruthy();
      const otherDownload = await otherClient.storage.from(BUCKET).download(path);
      expect(otherDownload.error).toBeTruthy();

      // 학생 본인은 자기 사진을 볼 수 있다.
      const mine = await studentClient.storage.from(BUCKET).createSignedUrl(path, 60);
      assertOk(mine);
      expect(mine.data?.signedUrl).toBeTruthy();

      // ── (6) MIME·용량 제한이 서버에서 강제된다 ───────────────────────────
      const badMime = await studentClient.storage
        .from(BUCKET)
        .upload(`${studentId}/${todoId}/${submissionKey}/note.pdf`, TINY_JPEG, { contentType: "application/pdf" });
      expect(badMime.error, "application/pdf 는 버킷이 거부해야 한다").toBeTruthy();

      const tooBig = new Uint8Array(HOMEWORK_PHOTO_MAX_BYTES + 1024);
      tooBig.set(TINY_JPEG, 0);
      const oversize = await studentClient.storage
        .from(BUCKET)
        .upload(`${studentId}/${todoId}/${submissionKey}/big.jpg`, tooBig, { contentType: "image/jpeg" });
      expect(oversize.error, "5MB 초과는 버킷이 거부해야 한다").toBeTruthy();

      // ── (5) 과외쌤: 공개범위 안에서는 보이고, 끄면 못 본다 ───────────────
      const teacherSees = await teacherClient.storage.from(BUCKET).createSignedUrl(path, 60);
      expect(teacherSees.error, teacherSees.error?.message).toBeNull();
      expect(teacherSees.data?.signedUrl).toBeTruthy();

      assertOk(
        await admin
          .from("disclosure_settings")
          .update({ share_homework_photos: false })
          .eq("connection_id", connectionId)
      );
      const teacherBlocked = await teacherClient.storage.from(BUCKET).createSignedUrl(path, 60);
      expect(teacherBlocked.error, "공개범위를 끄면 서명 URL 이 발급되면 안 된다").toBeTruthy();

      // 연결이 끊기면 공개범위를 켜도 못 본다.
      assertOk(
        await admin
          .from("disclosure_settings")
          .update({ share_homework_photos: true })
          .eq("connection_id", connectionId)
      );
      assertOk(await admin.from("connections").update({ status: "disconnected" }).eq("id", connectionId));
      const afterDisconnect = await teacherClient.storage.from(BUCKET).createSignedUrl(path, 60);
      expect(afterDisconnect.error).toBeTruthy();

      // ── (8) 기존 흐름: 제출 조회·삭제가 여전히 동작한다 ──────────────────
      const readBack = await studentClient
        .from("homework_submissions")
        .select("id, photo_paths")
        .eq("id", submissionId)
        .single();
      assertOk(readBack);
      expect(readBack.data?.photo_paths).toEqual([path]);

      // 학생은 자기 사진을 지울 수 있다(재제출·정리 경로).
      const removed = await studentClient.storage.from(BUCKET).remove([path]);
      assertOk(removed);
      const goneList = await admin.storage.from(BUCKET).list(`${studentId}/${todoId}/${submissionKey}`);
      assertOk(goneList);
      expect((goneList.data ?? []).map((f) => f.name)).not.toContain("page-1.jpg");
      uploadedPaths.length = 0;
    } finally {
      // 계정 cascade 는 Storage 파일을 지우지 않는다 → 명시적으로 정리한다.
      if (uploadedPaths.length > 0) await admin.storage.from(BUCKET).remove(uploadedPaths);
      for (const id of [studentId, otherId]) {
        if (!id) continue;
        const leftover = await admin.storage.from(BUCKET).list(id, { limit: 100 });
        const folders = (leftover.data ?? []).map((entry) => `${id}/${entry.name}`);
        if (folders.length > 0) await admin.storage.from(BUCKET).remove(folders);
      }
      await deleteTestUsers(admin, [studentId, otherId, teacherId]);
    }
  }, 120_000);
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

function assertData<T>(data: T | null): T {
  if (!data) throw new Error("Expected Supabase response data");
  return data;
}
