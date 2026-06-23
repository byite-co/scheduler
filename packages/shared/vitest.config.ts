import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// M7 플레이크 보완: 원격 Supabase 통합 테스트(*.rls.integration.test.ts)는 여러 파일이
// 병렬로 auth 사용자를 동시 생성하면 Supabase auth rate-limit이 간헐 발생한다.
// → 원격 env가 있어 통합 테스트가 "실제로 도는" 경우에만 파일을 직렬 실행해
//   동시 createUser를 제거하고, 일시적 실패는 재시도로 흡수한다.
//   원격 env가 없으면 통합 테스트는 describe.skip 되므로 단위 테스트만 병렬로 빠르게 돈다.
// 게이팅 조건은 통합 테스트의 loadTestEnv()와 동일하게 유지한다.
function remoteIntegrationEnabled(): boolean {
  const envLocal = new URL("../../.env.local", import.meta.url);
  let fileVars: Record<string, string> = {};
  if (existsSync(envLocal)) {
    fileVars = Object.fromEntries(
      readFileSync(fileURLToPath(envLocal), "utf8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#") && line.includes("="))
        .map((line) => {
          const index = line.indexOf("=");
          return [
            line.slice(0, index).trim(),
            line.slice(index + 1).trim().replace(/^["']|["']$/g, "")
          ];
        })
    );
  }
  const projectRef = process.env.SUPABASE_PROJECT_REF ?? fileVars.SUPABASE_PROJECT_REF;
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN ?? fileVars.SUPABASE_ACCESS_TOKEN;
  return Boolean(projectRef && accessToken);
}

const remote = remoteIntegrationEnabled();

export default defineConfig({
  test: {
    // 루트 config와 동일한 제외(빌드 산출물의 컴파일된 테스트 중복 수집 방지).
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/.expo/**",
      "**/coverage/**"
    ],
    // 원격 통합 테스트가 켜진 경우에만 직렬화 + 재시도(플레이크 흡수).
    retry: remote ? 2 : 0,
    fileParallelism: remote ? false : undefined
  }
});
