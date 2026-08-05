#!/usr/bin/env node
// 개발/테스트용 구독 상태 설정기.
//
// ⚠️ 이 스크립트는 **service_role 키**를 요구한다. 그 키는:
//    · RLS 를 전부 우회한다 — 사실상 DB 관리자 권한이다.
//    · **앱 번들(apps/*)에 절대 들어가면 안 된다.** NEXT_PUBLIC_/EXPO_PUBLIC_ 접두사를
//      붙이지 마라 — 붙이면 클라이언트로 배포돼 누구나 DB 전체를 읽고 쓸 수 있다.
//    · 루트 .env 의 SUPABASE_SERVICE_ROLE_KEY 로만 두고, 이 스크립트처럼
//      개발자 로컬에서 직접 실행하는 도구에서만 읽는다.
//
// 왜 이 스크립트가 필요한가:
//   mock_set_{student,teacher}_subscription RPC 는 클라이언트가 스스로 유료 상태를
//   만들 수 있는 구멍이라 실행 권한을 회수했다(20260805000000 / 20260806000000).
//   그 RPC 들은 대상을 auth.uid() 로 정하므로 service_role 로는 호출조차 안 된다
//   (auth.uid() 가 null → authentication_required). service_role 은 RLS 를 우회하니
//   RPC 없이 구독 테이블에 직접 쓰면 된다 — 이 스크립트가 그 경로다.
//
// 사용:
//   node scripts/dev-set-subscription.mjs student <email> <none|active|past_due|canceled|paused>
//   node scripts/dev-set-subscription.mjs teacher <email> <none|active|past_due|canceled|paused>
//
// 예:
//   node scripts/dev-set-subscription.mjs student a@b.test active
//   node scripts/dev-set-subscription.mjs teacher t@b.test past_due

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STATUSES = ["none", "active", "past_due", "canceled", "paused"];

function readEnv() {
  const merged = {};
  for (const file of [".env", ".env.local"]) {
    try {
      const text = readFileSync(join(REPO_ROOT, file), "utf8");
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
        const index = trimmed.indexOf("=");
        merged[trimmed.slice(0, index).trim()] = trimmed
          .slice(index + 1)
          .trim()
          .replace(/^["']|["']$/g, "");
      }
    } catch {
      // 파일이 없으면 넘어간다.
    }
  }
  return { ...merged, ...process.env };
}

function die(message, extra = []) {
  console.error(`\n✗ ${message}\n`);
  for (const line of extra) console.error(`  ${line}`);
  console.error("");
  process.exit(1);
}

const [role, email, status] = process.argv.slice(2);

if (!role || !email || !status) {
  die("인자가 부족합니다.", [
    "사용: node scripts/dev-set-subscription.mjs <student|teacher> <email> <status>",
    `status: ${STATUSES.join(" | ")}`
  ]);
}
if (role !== "student" && role !== "teacher") die(`role 은 student 또는 teacher 여야 합니다: ${role}`);
if (!STATUSES.includes(status)) die(`status 가 올바르지 않습니다: ${status}`, [`가능: ${STATUSES.join(" | ")}`]);

const env = readEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL ?? env.EXPO_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!url) die("Supabase URL 이 없습니다.", ["루트 .env 의 NEXT_PUBLIC_SUPABASE_URL 을 확인하세요."]);
if (!serviceRoleKey) {
  die("SUPABASE_SERVICE_ROLE_KEY 가 없습니다.", [
    "루트 .env 에 넣으세요. Supabase 대시보드 → Project Settings → API → service_role.",
    "⚠️ NEXT_PUBLIC_/EXPO_PUBLIC_ 접두사를 붙이지 마세요 — 앱 번들로 유출됩니다."
  ]);
}

const admin = {
  headers: {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "content-type": "application/json"
  }
};

// 1) 이메일 → user id (Admin Auth API, service_role 필요)
const usersResponse = await fetch(
  `${url}/auth/v1/admin/users?filter=${encodeURIComponent(email)}&per_page=200`,
  admin
);
if (!usersResponse.ok) {
  die(`사용자 조회 실패 (${usersResponse.status})`, [await usersResponse.text()]);
}
const { users = [] } = await usersResponse.json();
const user = users.find((candidate) => candidate.email?.toLowerCase() === email.toLowerCase());
if (!user) die(`그 이메일의 사용자가 없습니다: ${email}`);

// 2) 구독 테이블에 직접 upsert (service_role 이라 RLS 우회)
const table = role === "student" ? "student_subscriptions" : "teacher_subscriptions";
const row =
  role === "student"
    ? {
        student_id: user.id,
        status,
        provider: "iap",
        expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString()
      }
    : {
        teacher_id: user.id,
        status,
        provider: "stripe",
        current_period_end: new Date(Date.now() + 30 * 86_400_000).toISOString()
      };

const upsert = await fetch(`${url}/rest/v1/${table}?on_conflict=${role === "student" ? "student_id" : "teacher_id"}`, {
  method: "POST",
  headers: { ...admin.headers, Prefer: "resolution=merge-duplicates,return=representation" },
  body: JSON.stringify(row)
});

if (!upsert.ok) die(`구독 상태 설정 실패 (${upsert.status})`, [await upsert.text()]);

const [result] = await upsert.json();
console.log(`\n✅ ${role} ${email} → status=${result.status} (${table})\n`);
