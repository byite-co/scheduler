#!/usr/bin/env node
// 숙제 사진 보관정리 **dry-run**. 아무것도 지우지 않는다 — 세는 것만 한다.
//
// [왜 필요한가] 개인정보처리방침에 "180일 보관" 을 적을 예정인데, 실제로 지우는 코드가 없다.
//   방침과 실제가 다른 상태로 출시하면 그 자체가 위반이다. 삭제 로직·스케줄은 정책(보존 예외,
//   파일럿 검증용 사진의 별도 동의 보관)이 확정된 뒤에 만든다. 그때까지 이 스크립트가
//   "지금 지워야 할 것이 무엇이고 얼마인지" 를 정직하게 말한다.
//
// [무엇을 보는가]
//   1) 만료 대상 — storage.objects 중 created_at 이 보관기간을 지난 것
//   2) 불일치 — DB 행과 실제 객체의 어긋남. 두 방향을 **따로** 센다:
//        · 행만 있고 객체 없음 → 이미 지워졌거나 업로드가 중간에 끊긴 흔적
//        · 객체만 있고 행 없음 → **고아 객체**. 보관기간을 계산할 기준(created_at 행)이
//          없으므로 만료 대상에 섞지 않고 별도 분류한다. 섞으면 "언제 올라온 파일인지
//          모르는 것" 을 "180일 지난 것" 으로 오판해 지우게 된다.
//   3) 탈퇴 대기열(storage_purge_queue) 과의 중복 — 탈퇴로 이미 삭제 예정인 파일을
//      보관정리가 또 세면 같은 파일이 두 경로에서 지워진다(멱등이면 무해하지만 수치가 겹친다).
//
// 사용: node scripts/storage-retention-dry-run.mjs [--json]
//
// ⚠️ service_role 키가 필요하다(.env.local). 키를 로그에 찍지 않는다.

import { readFileSync } from "node:fs";

const asJson = process.argv.includes("--json");

const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith("#") || !t.includes("=")) continue;
  const i = t.indexOf("=");
  env[t.slice(0, i).trim()] = t
    .slice(i + 1)
    .trim()
    .replace(/^["']|["']$/g, "");
}

const ref = env.SUPABASE_PROJECT_REF;
const token = env.SUPABASE_ACCESS_TOKEN;
if (!ref || !token) {
  console.error("SUPABASE_PROJECT_REF / SUPABASE_ACCESS_TOKEN 이 .env.local 에 필요하다.");
  process.exit(1);
}
// 다른 프로젝트를 향해 실행되는 것을 막는다 — 이 저장소는 단일 프로젝트를 쓴다.
if (ref !== "khssgcagudjimrezebxq") {
  console.error(`거부: 예상과 다른 프로젝트(${ref}).`);
  process.exit(1);
}

async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query })
  });
  const body = await res.json();
  if (!res.ok || body?.message) throw new Error(`SQL 실패: ${body?.message ?? res.status}`);
  return body;
}

const BUCKET = "homework-photos";

// 보관기간은 DB 함수가 정본이다(TS 상수는 사본) — 여기서 숫자를 다시 쓰지 않는다.
const [{ days }] = await sql("select homework_photo_retention_days() as days");

// 1) 만료 대상: 건수 + 용량 + 가장 오래된/최근 것
const [expired] = await sql(`
  select count(*)::int                                   as objects,
         coalesce(sum((o.metadata->>'size')::bigint), 0)  as bytes,
         min(o.created_at)                                as oldest,
         max(o.created_at)                                as newest
  from storage.objects o
  where o.bucket_id = '${BUCKET}'
    and o.created_at < now() - make_interval(days => homework_photo_retention_days())`);

// 전체 대비 비율을 함께 본다 — "만료 0건" 이 정상인지 데이터가 없는 것인지 구분하려면 총량이 필요하다.
const [total] = await sql(`
  select count(*)::int                                  as objects,
         coalesce(sum((o.metadata->>'size')::bigint), 0) as bytes
  from storage.objects o
  where o.bucket_id = '${BUCKET}'`);

// 2-a) 제출 행이 가리키는데 객체가 없는 경로
const [danglingRows] = await sql(`
  with referenced as (
    select distinct unnest(s.photo_paths) as path
    from homework_submissions s
    where s.photo_paths is not null
  )
  select count(*)::int as paths
  from referenced r
  where not exists (
    select 1 from storage.objects o where o.bucket_id = '${BUCKET}' and o.name = r.path
  )`);

// 2-b) 객체는 있는데 어떤 제출도 가리키지 않는 것 = 고아.
//      보관기간 판단 기준(어느 제출의 사진인지)이 없으므로 **별도 분류**다.
const [orphanObjects] = await sql(`
  with referenced as (
    select distinct unnest(s.photo_paths) as path
    from homework_submissions s
    where s.photo_paths is not null
  )
  select count(*)::int                                  as objects,
         coalesce(sum((o.metadata->>'size')::bigint), 0) as bytes,
         min(o.created_at)                              as oldest
  from storage.objects o
  where o.bucket_id = '${BUCKET}'
    and not exists (select 1 from referenced r where r.path = o.name)`);

// 3) 탈퇴 대기열과 겹치는 객체 — 두 경로가 같은 파일을 지우려 하는지 본다.
const [queueOverlap] = await sql(`
  select count(*)::int as objects
  from storage.objects o
  where o.bucket_id = '${BUCKET}'
    and exists (
      select 1 from storage_purge_queue q
      where q.status = 'pending' and o.name like q.prefix || '%'
    )`);

// 4) 만료 대상 표본(최대 20건). 경로에 학생 UUID 가 들어 있어 **일부만** 보여 준다.
const sample = await sql(`
  select o.name, o.created_at, (o.metadata->>'size')::bigint as size
  from storage.objects o
  where o.bucket_id = '${BUCKET}'
    and o.created_at < now() - make_interval(days => homework_photo_retention_days())
  order by o.created_at
  limit 20`);

const result = {
  bucket: BUCKET,
  retentionDays: days,
  ranAt: new Date().toISOString(),
  total: { objects: total.objects, bytes: Number(total.bytes) },
  expired: {
    objects: expired.objects,
    bytes: Number(expired.bytes),
    oldest: expired.oldest,
    newest: expired.newest
  },
  mismatch: {
    // 행은 있는데 객체가 없다 → 지울 것이 없다(수치만 남긴다).
    rowsWithoutObject: danglingRows.paths,
    // 객체는 있는데 행이 없다 → 고아. 만료 대상에 **섞지 않는다**.
    orphanObjects: {
      objects: orphanObjects.objects,
      bytes: Number(orphanObjects.bytes),
      oldest: orphanObjects.oldest
    }
  },
  purgeQueueOverlap: queueOverlap.objects,
  sample
};

if (asJson) {
  console.log(JSON.stringify(result, null, 2));
} else {
  const mb = (b) => `${(Number(b) / 1024 / 1024).toFixed(2)} MB`;
  console.log(`[dry-run] 버킷 ${BUCKET} · 보관기간 ${days}일 · ${result.ranAt}`);
  console.log(`  전체            ${result.total.objects}건 (${mb(result.total.bytes)})`);
  console.log(`  만료 대상       ${result.expired.objects}건 (${mb(result.expired.bytes)})`);
  console.log(`    가장 오래된   ${result.expired.oldest ?? "-"}`);
  console.log(`    가장 최근     ${result.expired.newest ?? "-"}`);
  console.log(`  행만 있음       ${result.mismatch.rowsWithoutObject}개 경로 (객체 없음)`);
  console.log(
    `  고아 객체       ${result.mismatch.orphanObjects.objects}건 (${mb(
      result.mismatch.orphanObjects.bytes
    )}) — 보관기간 기준 없음, 별도 판단 필요`
  );
  console.log(`  탈퇴 대기열 중복 ${result.purgeQueueOverlap}건`);
  if (result.sample.length) {
    console.log("  표본(최대 20건):");
    for (const row of result.sample) console.log(`    ${row.created_at}  ${row.name}`);
  }
  console.log("\n삭제는 하지 않았다. 이 스크립트는 세는 것만 한다.");
}
