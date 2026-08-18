import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it } from "vitest";

import type { Database } from "./database.types";
import { assertNoLeakedTestUsers, deleteTestUsers } from "./rlsTestCleanup";

type ApiKey = { name: string; api_key: string };
type TestEnv = { projectRef: string; accessToken: string; url: string };
type QueueRow = Database["public"]["Tables"]["storage_purge_queue"]["Row"];

const BUCKET = "homework-photos";

const env = loadTestEnv();
const describeIfRemote = env ? describe : describe.skip;

/**
 * 탈퇴 → Storage 큐 → sweep 전 경로의 **실행** 테스트.
 *
 * R1 리뷰의 P1: 이 파이프라인은 되돌릴 수 없는 사용자 사진 삭제인데 커버리지가
 * "마이그레이션 텍스트에 이 문장이 있다" 뿐이었다 — A1.6 이 실제로 깨져서 나갔던 것과 같은 모양이다
 * (그때도 파이프라인 RPC 하나만 문자열 단정이었고, 정확히 그것이 고장나 있었다).
 * `claim_storage_purge_batch` 는 어떤 종류의 테스트도 없었다.
 *
 * ⚠️ 테스트 객체만 쓴다. 계정·객체는 이 테스트가 만든 것만 다루고 끝에 지운다.
 */
describeIfRemote("탈퇴 Storage 큐 파이프라인 (실행 테스트)", () => {
  afterAll(assertNoLeakedTestUsers);

  it("정상 처리 / 멱등 / 리스 경합 / 5회 실패 굳힘 / 감사 로그", async () => {
    if (!env) throw new Error("Missing Supabase test environment");

    const keys = await fetchApiKeys(env);
    const admin = createClient<Database>(env.url, getApiKey(keys, "service_role"), {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const suffix = randomUUID();
    let studentId = "";
    const createdPaths: string[] = [];

    try {
      const created = await admin.auth.admin.createUser({
        email: `purge-${suffix}@r3.test`,
        password: `Tt-${suffix}-12345678`,
        email_confirm: true
      });
      if (created.error) throw created.error;
      studentId = created.data.user.id;
      assertOk(
        await admin.from("profiles").insert({
          id: studentId,
          role: "student",
          name: "R3 purge",
          grade: "중1",
          birth_date: "2013-06-23",
          guardian_consented_at: new Date().toISOString(),
          onboarded: true
        })
      );

      // ── 테스트 객체 2개를 이 학생 폴더에 올린다 ────────────────────────────
      for (const file of ["a.png", "b.png"]) {
        const path = `${studentId}/${file}`;
        const uploaded = await admin.storage
          .from(BUCKET)
          .upload(path, new Blob([`r3-${file}`], { type: "image/png" }), { upsert: true });
        if (uploaded.error) throw uploaded.error;
        createdPaths.push(path);
      }
      const before = await admin.storage.from(BUCKET).list(studentId);
      assertOk(before);
      expect(before.data).toHaveLength(2);

      // ── 탈퇴: profiles 삭제 → BEFORE DELETE 트리거가 큐에 적재 ──────────────
      // (R1 이 지적한 미검증 지점: 탈퇴는 테스트했지만 "큐 행이 생기는지" 는 단정하지 않았다.)
      assertOk(await admin.from("profiles").delete().eq("id", studentId));

      const queued = await admin
        .from("storage_purge_queue")
        .select("*")
        .eq("user_id", studentId)
        .order("created_at", { ascending: false });
      assertOk(queued);
      expect(queued.data, "탈퇴 시 큐 행이 생기지 않았다 — 삭제 안전망 2차선이 없다").toHaveLength(1);
      const queueRow = queued.data![0] as QueueRow;
      expect(queueRow.status).toBe("pending");
      expect(queueRow.bucket_id).toBe(BUCKET);
      // prefix 는 DB CHECK 로 `user_id || '/'` 가 강제된다 — 남의 폴더를 가리킬 수 없다.
      expect(queueRow.prefix).toBe(`${studentId}/`);

      // ── 리스 경합: 한 번 집힌 행은 다음 claim 이 다시 집지 못한다 ───────────
      // ⚠️ 큐에는 다른 통합 테스트가 계정을 만들고 지우면서 쌓인 백로그가 있다(R1 이 기록한
      //    "sweep 1회 20행 예산" 의 현실). 그래서 한 번의 claim 이 내 행을 포함한다고 가정할 수
      //    없다 — 실제 sweep 이 백로그를 훑는 것처럼 내 행이 나올 때까지 배치를 돈다.
      await claimUntilFound(admin, queueRow.id);

      const secondClaim = await admin.rpc("claim_storage_purge_batch", { p_limit: 500 });
      assertOk(secondClaim);
      expect(
        (secondClaim.data as QueueRow[]).map((r) => r.id),
        "리스가 걸린 행을 두 번째 호출이 또 집었다 — 두 sweep 이 같은 행을 동시 처리한다"
      ).not.toContain(queueRow.id);

      // ── 실제 삭제 + 완료 기록 ──────────────────────────────────────────────
      const paths = await admin.rpc("storage_paths_for_prefix", { p_bucket: BUCKET, p_prefix: queueRow.prefix });
      assertOk(paths);
      const targetPaths = (paths.data as Array<{ path: string }>).map((r) => r.path);
      expect(targetPaths.sort()).toEqual(createdPaths.sort());

      const removed = await admin.storage.from(BUCKET).remove(targetPaths);
      assertOk(removed);
      const afterRemove = await admin.storage.from(BUCKET).list(studentId);
      assertOk(afterRemove);
      expect(afterRemove.data, "사진이 남아 있다").toHaveLength(0);

      const completed = await admin.rpc("complete_storage_purge", {
        p_id: queueRow.id,
        p_deleted_count: targetPaths.length,
        p_error: undefined,
        p_deleted_paths: targetPaths
      });
      assertOk(completed);
      const doneRow = completed.data as unknown as QueueRow;
      expect(doneRow.status).toBe("done");
      expect(doneRow.deleted_count).toBe(2);
      expect(doneRow.attempts).toBe(1);

      // ── 감사 로그: 시도별 1행 + 삭제한 경로 배열 ───────────────────────────
      const log = await admin.from("storage_purge_log").select("*").eq("queue_id", queueRow.id);
      assertOk(log);
      expect(log.data, "감사 로그가 없다 — 무엇을 지웠는지 증명할 수 없다").toHaveLength(1);
      const logRow = log.data![0] as { outcome: string; attempt_no: number; deleted_paths: string[] | null };
      expect(logRow.outcome).toBe("deleted");
      expect(logRow.attempt_no).toBe(1);
      expect((logRow.deleted_paths ?? []).sort()).toEqual(createdPaths.sort());

      // ── 멱등: done 행은 다시 집히지 않는다 ─────────────────────────────────
      const afterDone = await admin.rpc("claim_storage_purge_batch", { p_limit: 500 });
      assertOk(afterDone);
      expect(
        (afterDone.data as QueueRow[]).map((r) => r.id),
        "완료된 행을 다시 집었다 — 무한 재처리"
      ).not.toContain(queueRow.id);

      // ── 5회 실패 굳힘: 최대 시도까지 pending, 넘기면 failed 로 굳고 안 집힌다 ──
      // 새 행을 직접 넣는다(이미 사라진 사용자 = 실제 탈퇴 후 상태와 같다. FK 가 없어서 가능).
      const failing = await admin
        .from("storage_purge_queue")
        .insert({ user_id: studentId, bucket_id: BUCKET, prefix: `${studentId}/` })
        .select("id")
        .single();
      assertOk(failing);
      const failId = failing.data!.id as string;

      const maxAttempts = await admin.rpc("storage_purge_max_attempts");
      assertOk(maxAttempts);
      const max = maxAttempts.data as unknown as number;
      expect(max).toBe(5);

      const ladder: Array<{ attempt: number; status: string }> = [];
      for (let i = 1; i <= max; i += 1) {
        await claimUntilFound(admin, failId, `${i}회차에서 실패 행을 집지 못했다 — 재시도가 멈췄다`);
        const failed = await admin.rpc("complete_storage_purge", {
          p_id: failId,
          p_deleted_count: 0,
          p_error: `r3-forced-failure-${i}`,
          p_deleted_paths: undefined
        });
        assertOk(failed);
        const row = failed.data as unknown as QueueRow;
        ladder.push({ attempt: row.attempts as number, status: row.status as string });
      }
      // 1~4회차는 pending 으로 되돌아가고(재시도 가능), 5회차에서 failed 로 굳는다.
      expect(ladder.slice(0, max - 1).map((r) => r.status)).toEqual(Array(max - 1).fill("pending"));
      expect(ladder[max - 1].status, "최대 시도를 넘겼는데 failed 로 굳지 않았다").toBe("failed");
      expect(ladder.map((r) => r.attempt)).toEqual([1, 2, 3, 4, 5]);

      // failed 는 다시 집히지 않는다(무한 재시도 방지)
      const afterFailed = await admin.rpc("claim_storage_purge_batch", { p_limit: 500 });
      assertOk(afterFailed);
      expect(
        (afterFailed.data as QueueRow[]).map((r) => r.id),
        "failed 행을 또 집었다 — 영구 실패를 무한 재시도한다"
      ).not.toContain(failId);

      // failed 행은 **지워지지 않고 남는다** — 조용히 버리면 사진이 남은 걸 아무도 모른다.
      const survivor = await admin.from("storage_purge_queue").select("status, last_error").eq("id", failId).single();
      assertOk(survivor);
      expect(survivor.data!.status).toBe("failed");
      expect(survivor.data!.last_error).toContain("r3-forced-failure-5");

      // 실패도 시도별로 감사 로그가 남는다.
      const failLog = await admin.from("storage_purge_log").select("outcome, attempt_no").eq("queue_id", failId);
      assertOk(failLog);
      expect(failLog.data).toHaveLength(max);
      expect(new Set((failLog.data as Array<{ outcome: string }>).map((r) => r.outcome))).toEqual(new Set(["failed"]));

      // 정리: 이 테스트가 만든 큐·로그 행을 지운다(사용자는 이미 삭제됐다).
      assertOk(await admin.from("storage_purge_log").delete().in("queue_id", [queueRow.id, failId]));
      assertOk(await admin.from("storage_purge_queue").delete().eq("user_id", studentId));
    } finally {
      // 남은 객체가 있으면 지운다(실패로 중단된 경우).
      if (createdPaths.length) await admin.storage.from(BUCKET).remove(createdPaths);
      if (studentId) {
        await admin.from("storage_purge_log").delete().eq("queue_id", studentId).select();
        await admin.from("storage_purge_queue").delete().eq("user_id", studentId);
        await deleteTestUsers(admin, [studentId]);
      }
    }
  }, 180_000);
});

/**
 * 대상 행이 나올 때까지 claim 배치를 돈다.
 *
 * 한 번의 claim 이 내 행을 포함한다고 가정할 수 없다 — 큐에는 다른 통합 테스트가 계정을
 * 만들고 지우면서 쌓아 둔 백로그가 있고, claim 은 배치 단위다. 실제 sweep 도 이렇게 훑는다.
 * (이 테스트가 단독 실행에서는 통과하고 전체 실행에서 떨어졌던 이유가 정확히 이것이다.)
 */
async function claimUntilFound(
  admin: SupabaseClient<Database>,
  id: string,
  failMessage = "claim 이 대상 행을 집지 못했다",
  rounds = 6
): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    const claim = await admin.rpc("claim_storage_purge_batch", { p_limit: 500 });
    if (claim.error) throw claim.error;
    const batch = claim.data as QueueRow[];
    if (batch.some((row) => row.id === id)) return;
    if (batch.length === 0) break; // 더 집을 게 없다
  }
  throw new Error(`${failMessage} (id=${id})`);
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
