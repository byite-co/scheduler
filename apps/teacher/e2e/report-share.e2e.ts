import { expect, test } from "@playwright/test";

// 핵심 플로우 스모크: 학부모 공유 링크(공개 라우트)가 인증 없이 열리고,
// 잘못된 토큰이면 "찾을 수 없어요" 상태를 보여준다(만료/무효 처리 확인).
test("parent report link shows not-found for an invalid token (no login)", async ({ page }) => {
  await page.goto("/r/invalid-token-1234567890");
  await expect(page.getByText(/찾을 수 없|만료/)).toBeVisible();
});

// 로그인 페이지가 렌더된다(기본 게이트 도달).
test("teacher login page renders", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator("body")).toBeVisible();
});
