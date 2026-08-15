# STOP — 사람 승인/입력이 필요한 항목

> ⚠️ **출시 블로커는 `docs/LAUNCH-CHECKLIST.md` 로 옮겼다(2026-08-16).**
> 이 문서는 2026-06-24 자율 빌드 시점의 STOP 지점 기록이다. 이후 해결된 항목이 섞여 있으니
> 출시 준비는 체크리스트를 보고, 여기는 이력으로만 참고해라.
> 자율 빌드(M4~M8)는 mock/스텁까지 완료하고 main에 머지했다. 아래는 **설계상 STOP 지점**이라
> 자율 모드에서 진행하지 않은 것들이다(모두 블로커 아님 — 기능 플로우는 mock으로 완성·검증됨).
> 작성 시점: 2026-06-24 기준.

## ⚠️ 0. [출시 전 필수 복원] 이메일 autoconfirm 되돌리기 — 임시 개발 설정
- **2026-06-24, 테스트 편의를 위해 링크된 Supabase 프로젝트의 `mailer_autoconfirm`을 `true`로 켰다.**
  (가입 직후 이메일 인증 없이 즉시 로그인됨 — 로컬 클릭 테스트용.)
- **출시(프로덕션) 전에 반드시 다시 `false`로 꺼서 이메일 인증을 복원할 것.** 켜둔 채 배포하면
  미인증 이메일로 계정이 생성되어 보안/스팸 위험.
- 끄는 방법(둘 중 하나):
  - 대시보드: Supabase → Authentication → **Sign In / Providers → Email → "Confirm email" 켜기**
    (= autoconfirm 끄기). 또는 Authentication → Settings의 이메일 확인 옵션.
  - Management API:
    `curl -X PATCH "https://api.supabase.com/v1/projects/<ref>/config/auth" -H "Authorization: Bearer <ACCESS_TOKEN>" -H "Content-Type: application/json" -d '{"mailer_autoconfirm": false}'`
- 참고: 켜는 동안 테스트로 생성된 `autoconfirm-check-*@example.com` auth 유저가 남아 있을 수 있음 → 대시보드에서 삭제 가능(프로필 행 없음).

## 1. Edge Function 프로덕션 배포 (production deploy = STOP 조건)
레포에 구현/스텁이 있으나 **배포는 사람이 실행**해야 한다.
- `ai-homework-check` (M4): STUB(Anthropic 키 불필요, 결정적 응답). 배포 시 앱의 실시간 AI 검사 활성화.
  - 미배포 동안 앱은 H3 폴백("제출만 두고 나중에 결과")으로 우아하게 동작.
- `billing-stripe`, `iap-webhook` (M6): 501 스텁. 실제 키/서명검증 구현 후 배포.
- 실행 예: `supabase functions deploy ai-homework-check`

## 2. 실제 키 · 실결제 · 실 AI 호출
- Anthropic 키: `ai-homework-check` / `ai-study-rec` / `ai-report-draft` 실연동(현재 결정적 스텁).
- Stripe(과외쌤 앱 구독료) / RevenueCat·IAP(학생 프리미엄): 현재 `mock_set_*` RPC가 웹훅을 대신함.
  실제 결제·정산·환불은 키와 사람 승인 필요.

## 3. E2E 실행
- Playwright(teacher) / Maestro(student) 스캐폴딩 완료. 실행은 브라우저/에뮬레이터 + 구동 서버 필요 → CI/사람.
  - `pnpm --filter teacher test:e2e`, `pnpm --filter student test:e2e`
  - teacher e2e는 `@playwright/test` 설치 필요(`pnpm install` 후).

## 4. 화면 ↔ UI 카탈로그 대조
- `docs/ui-catalog/` PNG가 아직 비어 있음(AGENTS §9 TODO). 자산 도착 후 화면 1:1 대조.

## 5. 기타
- `gh` CLI 미설치 → GitHub PR 객체 미생성. 각 마일스톤은 main에 squash merge됨. 필요 시 사람이 PR 생성.
- 통합 테스트 Supabase auth rate-limit 플레이크: **코드로 해결됨**(`packages/shared/vitest.config.ts` — 원격 env 동반 시 파일 직렬화 + 재시도). 추가 사람 조치 불필요.
