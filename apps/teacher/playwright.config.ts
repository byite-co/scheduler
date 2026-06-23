import { defineConfig } from "@playwright/test";

// E2E 스캐폴딩 — CI에서 `pnpm --filter teacher test:e2e`로 실행한다.
// 로컬/헤드리스 자율 실행 대상 아님(브라우저 설치 + dev 서버 필요).
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000"
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "pnpm start",
        url: "http://localhost:3000",
        reuseExistingServer: true,
        timeout: 120_000
      }
});
