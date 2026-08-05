#!/usr/bin/env node
// 쌤플래너 전용 Supabase CLI 가드.
//
// 이 컴퓨터의 Supabase 토큰은 조직 전체 접근권을 갖는다(프로젝트 단위 토큰이 없다).
// 그래서 link 대상이 잘못돼 있거나 --project-ref 를 잘못 넣으면, 쌤플래너 작업이
// 다른 제품(쌤버십)의 DB에 적용될 수 있다. 이 스크립트는 CLI 를 실행하기 "전에"
// 대상을 검사해서, 조건이 어긋나면 아무 명령도 내보내지 않고 즉시 중단한다.
//
// 사용: pnpm sb <supabase 인자...>     예) pnpm sb db push --linked
//       pnpm sb:check                  현재 link 대상만 검사
//
// 설계 메모 — 왜 "--project-ref 자동 주입"이 아니라 "검사 후 통과"인가:
//   supabase 서브커맨드마다 --project-ref 수용 여부가 달라서(db push 는 링크를 사용),
//   무조건 주입하면 정상 명령이 깨진다. 대신 (1) 링크 대상 (2) 명시된 --project-ref
//   (3) 인자 안의 금지 ref 를 모두 검사한다. 실제 위험 경로는 이 3개가 전부다.

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** 유일하게 허용되는 원격 프로젝트 — 쌤플래너(scheduler). */
const ALLOWED_REF = "khssgcagudjimrezebxq";

/** 절대 건드리면 안 되는 프로젝트. 인자 어디에 등장해도 차단한다. */
const FORBIDDEN_REFS = new Map([
  ["lbeqxarxothkmzqvpudy", "ssambership-staging (쌤버십 — 다른 제품)"],
  ["wqaykrzfciznptntsvwl", "사내전산망"]
]);

/** 원격 프로젝트에 영향을 주는 서브커맨드 — link 대상이 확정돼야 실행을 허용한다. */
const REMOTE_SUBCOMMANDS = [
  "link",
  "db push",
  "db pull",
  "db dump",
  "db lint",
  "migration list",
  "migration up",
  "migration repair",
  "migration fetch",
  "functions deploy",
  "functions delete",
  "secrets set",
  "secrets unset",
  "secrets list",
  "projects",
  "branches",
  "inspect"
];

function fail(lines) {
  console.error("\n[41m[97m  SUPABASE GUARD — 중단  [0m\n");
  for (const line of lines) console.error(`  ${line}`);
  console.error(`\n  허용 프로젝트: ${ALLOWED_REF} (쌤플래너/scheduler)`);
  console.error("  이 명령은 실행되지 않았습니다.\n");
  process.exit(1);
}

function readLinkedRef() {
  try {
    return readFileSync(join(REPO_ROOT, "supabase", ".temp", "project-ref"), "utf8").trim();
  } catch {
    return null;
  }
}

function touchesRemote(args) {
  const words = args.filter((arg) => !arg.startsWith("-"));
  const head = words.slice(0, 2).join(" ");
  return REMOTE_SUBCOMMANDS.some((cmd) => head === cmd || head.startsWith(`${cmd} `) || words[0] === cmd);
}

const args = process.argv.slice(2);
const checkOnly = args[0] === "--check";
const cliArgs = checkOnly ? args.slice(1) : args;

// [1] 인자 안에 금지 ref 가 하나라도 있으면 즉시 중단.
for (const arg of cliArgs) {
  for (const [ref, label] of FORBIDDEN_REFS) {
    if (arg.includes(ref)) {
      fail([
        `인자에 금지된 프로젝트 ref 가 있습니다: ${ref}`,
        `  → ${label}`,
        "쌤플래너 작업에서 이 프로젝트를 대상으로 삼을 수 없습니다."
      ]);
    }
  }
}

// [2] --project-ref 를 명시했다면 허용 ref 와 일치해야 한다.
for (let i = 0; i < cliArgs.length; i += 1) {
  const arg = cliArgs[i];
  const explicit = arg.startsWith("--project-ref=")
    ? arg.slice("--project-ref=".length)
    : arg === "--project-ref"
      ? cliArgs[i + 1]
      : null;
  if (explicit && explicit !== ALLOWED_REF) {
    fail([`--project-ref 가 허용 프로젝트와 다릅니다: ${explicit}`]);
  }
}

// [3] 원격에 영향을 주는 명령이면 link 대상을 확인한다.
const linkedRef = readLinkedRef();
if (checkOnly || touchesRemote(cliArgs)) {
  if (!linkedRef) {
    fail([
      "이 레포가 어떤 Supabase 프로젝트에도 link 되어 있지 않습니다.",
      "원격 명령을 내보내기 전에 대상을 확정해야 합니다:",
      `  pnpm sb link --project-ref ${ALLOWED_REF}`
    ]);
  }
  if (linkedRef !== ALLOWED_REF) {
    fail([
      `link 대상이 쌤플래너가 아닙니다: ${linkedRef}`,
      FORBIDDEN_REFS.has(linkedRef) ? `  → ${FORBIDDEN_REFS.get(linkedRef)}` : "  → 알 수 없는 프로젝트",
      "다시 link 하세요:",
      `  pnpm sb link --project-ref ${ALLOWED_REF}`
    ]);
  }
}

if (checkOnly) {
  console.log(`✅ SUPABASE GUARD — link 대상 확인: ${linkedRef} (쌤플래너/scheduler)`);
  process.exit(0);
}

if (cliArgs.length === 0) {
  console.error("사용법: pnpm sb <supabase 인자...>   예) pnpm sb migration list --linked");
  process.exit(1);
}

console.log(
  `[42m[30m GUARD OK [0m 대상 ${linkedRef ?? "(link 무관 명령)"} → supabase ${cliArgs.join(" ")}`
);

// 자기 검증용: 스폰 없이 검사 결과만 확인한다(가드 시험 시 실제 명령이 나가지 않게).
if (process.env.SUPABASE_GUARD_DRY === "1") {
  console.log("SUPABASE_GUARD_DRY=1 — 검사만 수행하고 CLI 는 실행하지 않았습니다.");
  process.exit(0);
}

const child = spawn("pnpm", ["exec", "supabase", ...cliArgs], {
  cwd: REPO_ROOT,
  stdio: "inherit",
  shell: process.platform === "win32"
});
child.on("exit", (code) => process.exit(code ?? 1));
