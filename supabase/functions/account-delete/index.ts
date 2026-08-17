// Edge Function: account-delete
// 계정 탈퇴 — **Storage 사진을 먼저 지우고** 계정을 지운다.
//
// [왜 이 함수가 필요한가]
//   delete_my_account() 는 DB 만 정리한다. Storage 파일은 Postgres 트랜잭션에서 지울 수
//   없어(Storage API 필요) 그대로 남는다. "탈퇴했는데 사진이 서버에 남아 있다"는 상태를
//   없애려면 서버에서 Storage API 를 호출해야 하고, 그 자리가 여기다.
//
// [순서가 중요하다]
//   1) JWT 검증 → 호출자 uid 확정
//   2) 그 uid 폴더의 객체 경로를 **DB 에서** 조회 (storage.objects 직접 조회 = 정확)
//   3) Storage API 로 삭제
//   4) delete_my_account() 를 **호출자 권한으로** 실행 (auth.uid() 가 필요하다)
//   5) 대기열 행을 완료/실패로 기록
//
//   파일을 먼저 지우는 이유: 계정을 먼저 지우면 그 사이에 함수가 죽었을 때 파일만 남고
//   누가 주인이었는지 확인할 근거가 약해진다. 다만 profiles 삭제 트리거가 대기열에
//   행을 남기므로 그 경우에도 추적은 된다(2중 안전장치).
//
// [삭제 실패 처리] 사용자의 삭제 요구가 우선이므로 **계정 삭제는 진행한다.**
//   대신 대기열 행이 status=failed 로 남고 last_error 가 기록된다 → 조용히 사라지지 않는다.
//   sweep 모드로 재시도할 수 있다.
//
// ⚠️ 다른 사용자의 파일을 지우지 않는 것이 이 함수의 최우선 불변식이다.
//    경로는 항상 `<uid>/` 로 시작해야 하며, 삭제 직전에 한 번 더 검사한다(3중 방어:
//    DB 조회 조건 · 대기열 CHECK 제약 · 아래 assertScoped).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

import {
  corsForbiddenResponse,
  corsPolicyFor,
  corsPreflightResponse,
  jsonHeadersWithCors
} from "../_shared/cors.ts";

const PHOTO_BUCKET = "homework-photos";
// Storage remove() 한 번에 넘기는 경로 수. 너무 크면 요청이 거부된다.
const REMOVE_CHUNK = 100;
// sweep 한 번에 처리할 대기열 행 수.
const SWEEP_LIMIT = 20;

/**
 * 호출자가 service_role 인지 판정한다(sweep 전용).
 *
 * ⚠️ 함수 시크릿 SUPABASE_SERVICE_ROLE_KEY 와 **문자열 비교만 하면 안 된다.**
 *    프로젝트에 legacy JWT 키와 신형 `sb_secret_…` 키가 함께 존재하고, 호출자가 어느 쪽을
 *    쓰는지에 따라 값이 다르다(실측으로 403 이 났다). 그래서 두 경로를 모두 받는다:
 *      1) role 클레임이 service_role 인 JWT
 *      2) 함수 시크릿과 정확히 같은 문자열(신형 시크릿 키)
 *
 *    1번에서 서명을 직접 검증하지 않는 이유: Edge Functions 게이트웨이가 함수를 부르기
 *    **전에** JWT 서명을 검증한다(verify_jwt 기본값). 서명이 틀린 토큰은 여기까지 오지 않는다.
 *    게이트웨이 설정을 끄면 이 가정이 깨지므로 config 를 바꿀 때 함께 봐야 한다.
 */
function isServiceRole(authHeader: string, serviceKey: string): boolean {
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (token === serviceKey) return true;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  try {
    const pad = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(pad.padEnd(pad.length + ((4 - (pad.length % 4)) % 4), "=")));
    return payload?.role === "service_role";
  } catch {
    return false;
  }
}

/**
 * 경로가 이 사용자 폴더 안인지 확인한다. **하나라도 벗어나면 전부 중단한다** —
 * 남의 파일을 지우는 것보다 안 지우고 실패로 남기는 편이 낫다(삭제는 되돌릴 수 없다).
 */
function assertScoped(paths: string[], prefix: string): void {
  const stray = paths.filter((p) => !p.startsWith(prefix));
  if (stray.length > 0) {
    throw new Error(`scope_violation: ${stray.length}건이 ${prefix} 밖을 가리킨다`);
  }
}

/**
 * 한 사용자 폴더를 비운다.
 *
 * 지운 **경로 목록까지** 돌려준다 — 감사 로그(storage_purge_log)에 "무엇을 지웠는지" 를
 * 남기려면 건수만으로는 부족하다. 개인정보 삭제는 나중에 "정말 지웠나" 를 증명해야 한다.
 */
async function purgePrefix(
  service: SupabaseClient,
  bucket: string,
  prefix: string
): Promise<{ deleted: number; paths: string[] }> {
  const { data, error } = await service.rpc("storage_paths_for_prefix", {
    p_bucket: bucket,
    p_prefix: prefix
  });
  if (error) throw new Error(`list_failed: ${error.message}`);

  const paths = (data ?? []).map((row: { path: string }) => row.path);
  if (paths.length === 0) return { deleted: 0, paths: [] };

  assertScoped(paths, prefix);

  let deleted = 0;
  const removedPaths: string[] = [];
  for (let i = 0; i < paths.length; i += REMOVE_CHUNK) {
    const chunk = paths.slice(i, i + REMOVE_CHUNK);
    const { data: removed, error: removeError } = await service.storage.from(bucket).remove(chunk);
    if (removeError) throw new Error(`remove_failed: ${removeError.message}`);
    deleted += removed?.length ?? chunk.length;
    removedPaths.push(...chunk);
  }
  return { deleted, paths: removedPaths };
}

Deno.serve(async (req: Request) => {
  const cors = corsPolicyFor(req);
  if (!cors.allowed) return corsForbiddenResponse(cors);
  if (req.method === "OPTIONS") return corsPreflightResponse(cors);

  const jsonHeaders = jsonHeadersWithCors(cors);
  const fail = (code: string, status: number, extra?: Record<string, unknown>): Response =>
    new Response(JSON.stringify({ error: code, errorCode: code, ...extra }), { status, headers: jsonHeaders });

  if (req.method !== "POST") return fail("method_not_allowed", 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const service = createClient(url, serviceKey, { auth: { persistSession: false } });

  let mode: string | undefined;
  try {
    const body = await req.json().catch(() => ({}));
    mode = typeof body?.mode === "string" ? body.mode : undefined;
  } catch {
    mode = undefined;
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return fail("missing_authorization", 401);

  // ── sweep: 남은 대기열 재시도 (service_role 로만) ──────────────────────────
  if (mode === "sweep") {
    if (!isServiceRole(authHeader, serviceKey)) return fail("sweep_requires_service_role", 403);

    // 🚨 **선점해서 가져온다.** 예전에는 `.neq("status","done")` 로 직접 읽었는데 두 가지 문제가 있었다:
    //   · 두 sweep 이 동시에 돌면 같은 행을 둘 다 처리한다(시도 횟수·로그 이중 계상).
    //   · failed 행까지 매번 다시 집어, 최대 시도 횟수를 넘긴 영구 실패를 무한 재시도했다.
    // claim_storage_purge_batch 가 pending + 시도 여력 있음 + 미선점(또는 임차 만료)만 골라
    // claimed_at 을 채워 돌려준다. 처리기가 죽어도 임차가 만료되면 다음 실행이 탈환한다.
    const { data: rows, error } = await service.rpc("claim_storage_purge_batch", { p_limit: SWEEP_LIMIT });
    if (error) return fail("queue_read_failed", 500, { detail: error.message });

    const results: Array<Record<string, unknown>> = [];
    for (const row of (rows ?? []) as Array<{ id: string; bucket_id: string; prefix: string }>) {
      try {
        const { deleted, paths } = await purgePrefix(service, row.bucket_id, row.prefix);
        // 지운 경로를 함께 넘겨 감사 로그에 남긴다. 0건도 기록한다 —
        // "지울 것이 없었다" 도 사실이고, 나중에 "왜 안 지웠나" 를 설명해야 한다.
        await service.rpc("complete_storage_purge", {
          p_id: row.id,
          p_deleted_count: deleted,
          p_error: null,
          p_deleted_paths: paths
        });
        results.push({ id: row.id, deleted, status: "done" });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        // 실패는 조용히 버리지 않는다 — RPC 가 시도 여력이 남았으면 pending 으로 되돌리고,
        // 최대 횟수를 넘기면 failed 로 굳힌다(행은 지우지 않는다).
        await service.rpc("complete_storage_purge", {
          p_id: row.id,
          p_deleted_count: 0,
          p_error: message,
          p_deleted_paths: []
        });
        results.push({ id: row.id, status: "retry_or_failed", error: message });
      }
    }
    return new Response(JSON.stringify({ swept: results.length, results }), { status: 200, headers: jsonHeaders });
  }

  // ── 기본: 내 계정 탈퇴 ─────────────────────────────────────────────────────
  const asUser = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData } = await asUser.auth.getUser();
  const userId = userData?.user?.id;
  if (!userId) return fail("unauthenticated", 401);

  const prefix = `${userId}/`;

  // 1) 파일 먼저. 실패해도 계정 삭제는 막지 않는다(사용자의 삭제 요구가 우선).
  let deleted = 0;
  let deletedPaths: string[] = [];
  let purgeError: string | null = null;
  try {
    const purged = await purgePrefix(service, PHOTO_BUCKET, prefix);
    deleted = purged.deleted;
    deletedPaths = purged.paths;
  } catch (e) {
    purgeError = e instanceof Error ? e.message : String(e);
  }

  // 2) 계정 삭제. **호출자 권한으로** 실행해야 delete_my_account 의 auth.uid() 가 맞는다.
  const { error: deleteError } = await asUser.rpc("delete_my_account");
  if (deleteError) {
    // 계정이 안 지워졌으면 대기열 행도 안 생겼다(트리거는 profiles 삭제에 걸려 있다).
    // 파일만 지워진 상태일 수 있으므로 그 사실을 그대로 알린다.
    return fail("account_delete_failed", 500, { detail: deleteError.message, photosDeleted: deleted });
  }

  // 3) 트리거가 만든 대기열 행을 완료 처리한다. 파일 정리가 실패했으면 실패로 남긴다.
  //    (행이 없으면 — 트리거가 실패한 드문 경우 — 조용히 넘어가지 않고 응답에 표시한다.)
  const { data: queued } = await service
    .from("storage_purge_queue")
    .select("id")
    .eq("user_id", userId)
    .neq("status", "done")
    .order("created_at", { ascending: false })
    .limit(1);

  const queueRow = queued?.[0]?.id as string | undefined;
  if (queueRow) {
    await service.rpc("complete_storage_purge", {
      p_id: queueRow,
      p_deleted_count: deleted,
      p_error: purgeError,
      // 감사 로그용. 실패했으면 지운 것이 없으므로 빈 배열이다.
      p_deleted_paths: purgeError ? [] : deletedPaths
    });
  }

  return new Response(
    JSON.stringify({
      ok: true,
      photosDeleted: deleted,
      purgeError,
      queueTracked: Boolean(queueRow)
    }),
    { status: purgeError ? 207 : 200, headers: jsonHeaders }
  );
});
