# PROGRESS — 쌤플래너 자율 빌드 로그

> 마일스톤 단위 누적 기록. 각 항목: 무엇을 / 실제 동작 vs mock / 검증 결과 / 다음 / 막힌 점.
> 검증은 `corepack pnpm -w lint && typecheck && test && build` + 원격 Supabase RLS 통합 테스트 기준.

---

## M0~M3 (이전 세션, main 머지 완료)
- M0 스캐폴딩, M1 인증·연결, M2 홈·플래너·할일, M3 타이머·집중모드(온디바이스 졸음 감지).
- M3 2-B(PR #5)는 이번 세션 시작 시 검수 후 squash merge(커밋 469cb6c).
  - 배포 노트: focus 마이그레이션 `20260623010000` → `20260623011000` 순서대로 적용 필수(커밋 메시지에 명시).

---

## M4 — AI 완료검사 (flagship)  ✅ 구현·검증 완료
브랜치: `codex/m4-ai-homework-check`

### 무엇을
- **AI 판정 서버 권위화**: `apply_homework_ai_verdict` RPC(service_role 전용) + `guard_homework_submission_fields` 트리거.
  - 인증 사용자(학생·과외쌤)는 `ai_verdict/ai_confidence/ai_reason`를 직접 못 씀(서버만).
  - 학생은 `teacher_status/teacher_comment/resubmit_requested`를 못 바꿈(과외쌤 전용).
  - 마이그레이션 `20260624000000_m4_homework_ai_check.sql` (+ schema.sql 미러).
- **숙제 사진 버킷**: `homework-photos`(비공개) + 학생 본인 폴더 RLS. 마이그레이션 `20260624010000`.
- **순수 로직**(`packages/shared/src/m4.ts`): `getStubHomeworkVerdict`(통과/미흡/애매 결정적 스텁), `getHomeworkResultView`(과외생=쌤 코멘트 / 혼공=AI 단독), `createTeacherReviewPatch`(확인/반려), `summarizeReviewQueue`.
- **학생 화면**(`apps/student/src/m4Screens.tsx` + `app/homework/[id]/{submit,result,index}.tsx`): 제출(C4)→업로드 실패(H2)→AI 검사(G1)→검사 실패(H3) 폴백→결과(J9, 과외생 쌤 코멘트/혼공 AI 단독), 반려 시 "다시 제출"(K-루프), "쌤 확인 전"(J8).
- **과외쌤 화면**(`apps/teacher/src/app/m4.tsx` + `homework/review/page.tsx`, B5): 검사 큐 요약 + 확인/반려(다시 제출 요청).
- **Edge Function**(`supabase/functions/ai-homework-check/index.ts`): 제출→판정→`apply_homework_ai_verdict` 기록. **현재 STUB**(Anthropic 키 없이 결정적 응답).

### 실제 동작 vs mock
- **실제**: 제출 저장, 서버 권위적 판정 기록(RPC), 공개범위 RLS, 과외쌤 확인/반려, 재제출 루프, DB 마이그레이션은 원격에 push 완료.
- **STUB(명시)**:
  - AI 판정 = 결정적 스텁(`getStubHomeworkVerdict`, 사진 장수 기반). 키 준비 후 Edge Function 내부를 Anthropic 비전으로 교체.
  - 숙제 사진 **캡처/바이트 업로드**는 실기기 전용 → 이 헤드리스 빌드에선 첨부 장수만 경로 메타로 기록(버킷/정책은 준비됨).
- **사람 대기(배포)**: `ai-homework-check` Edge Function의 **프로덕션 배포는 보류**(자동 모드에서 "프로덕션 배포"는 STOP 조건). 함수는 레포에 완성되어 있고, 미배포 상태에선 앱이 H3 폴백("제출만 두고 나중에 결과")으로 우아하게 처리됨. 사람이 `supabase functions deploy ai-homework-check`로 활성화.

### 검증 결과
- `lint` ✅ / `typecheck` ✅ / `test` ✅(전체 64개: shared 60 + student 2 + teacher 2) / `build` ✅(4 패키지).
- 원격 Supabase RLS 통합 테스트 ✅ `m4.homework.rls.integration.test.ts`:
  - 학생이 ai_* 위조(insert/update) → 차단됨.
  - service_role만 판정 기록 가능 → 학생이 결과 조회.
  - `share_homework_photos` ON일 때만 과외쌤 조회, OFF면 안 보임.
  - 과외쌤 반려 → 학생은 teacher_* 변경 불가.
  - 혼공생 제출은 어떤 과외쌤에게도 안 보임(AI 단독).
- 프라이버시 grep: `focusCamera.native.tsx` 등 집중 파일에 upload/photo/record/storage 없음(무변경, 재확인).

### 다음 / 막힌 점
- 다음: M5(AI 공부량 추천·리포트 + 학부모 공유 링크).
- 막힌 점 없음. (Edge Function 배포만 사람 승인 대기 — 블로커 아님.)

---

## M5 — AI 공부량 추천 · 리포트  ✅ 구현·검증 완료
브랜치: `codex/m5-recommendations-reports`

### 무엇을
- **학부모 공유(프라이버시 핵심)**: `create_report_share`(과외쌤 발급, 토큰+만료+발송) + `get_shared_report`(anon 토큰 조회, 만료 확인, `report_views` 기록). 마이그레이션 `20260625000000` + 토큰 생성 수정 `20260625010000`(gen_random_uuid 기반). schema.sql 미러.
- **순수 로직**(`packages/shared/src/m5.ts`): `getStubStudyRecommendation`, `aggregateWeeklyStudy`(차트 집계), `getStubReportDraft`, `getFeatureGateState`(무료=광고 언락/프리미엄=무제한), `isShareExpired`, `createPlannerTodosFromRecommendation`.
- **학생 화면**(`m5Screens.tsx` + `app/(tabs)/ai.tsx`, `app/report.tsx`): AI 추천(C7) 게이팅→추천→"플래너에 반영"(todos+ai_recommendations), 나의 리포트(C8) 주간 차트+초안, 게이팅.
- **과외쌤 화면**(`app/m5.tsx` + `reports/weekly/page.tsx`, B7): 학생 선택→주간 집계(공개범위 뷰)→AI 초안→담을 과목/코멘트→저장+공유 링크 발급→히스토리/만료 표시.
- **학부모 웹뷰**(`app/r/[token]/page.tsx`, J16): 인증 없이 토큰으로 리포트 열람, 만료/무효 카피.

### 실제 동작 vs mock
- **실제**: 공유 링크 발급/조회/만료/조회기록, 게이팅 판정, 추천→플래너 반영(todos 생성), 주간 집계 차트, DB 마이그레이션 원격 push 완료.
- **STUB(명시)**: AI 추천·리포트 초안 = 결정적 스텁(키 준비 후 Edge Function `ai-study-rec`/`ai-report-draft`로 교체).
- **MOCK(명시)**: 리워드 광고 = 모의(SDK 없이 언락 기록). 실제 광고 SDK 연동은 추후.

### 검증 결과
- `lint`/`typecheck`/`test`(71)/`build` 모두 green.
- 원격 RLS 통합 테스트 ✅ `m5.reports.rls.integration.test.ts`:
  - 미연결 과외쌤은 공유 링크 발급 불가.
  - 학부모(anon, 미로그인)는 reports 직접 조회 불가, 토큰 RPC로만 열람 + `report_views` 기록.
  - 잘못된 토큰→not_found, 만료→expired.
- 프라이버시 grep: 집중 파일 upload/photo/record 없음(무변경).

### 다음 / 막힌 점
- 다음: M6(수익화 — 구독/결제). **주의: 실제 키/실결제/실 AI 호출 직전에 STOP**(mock/스텁까지만 진행).
- 막힌 점 없음.

---

## M6 — 수익화 (구독/결제)  ✅ 구현·검증 완료 (mock/스텁까지)
브랜치: `codex/m6-monetization`

### 무엇을
- **단가 단일 출처**: SQL `price_per_student_krw()` + TS `PRICE_PER_STUDENT_KRW`, 스키마 테스트로 교차검증.
- **앱 구독료**(과외쌤→우리, Stripe): `generate_teacher_invoice`(active 연결 수 × 단가) RPC. 마이그레이션 `20260626000000`.
- **수업·수업료**(학생→과외쌤, 결제 아님): `lesson_fees` 수기 트래커 + `summarizeLessonFees`. 화면/테이블/카피로 앱 구독료와 명확히 분리.
- **순수 로직**(`m6.ts`): `getTeacherBillingState`(미납→복구 던닝), `buildInvoiceDraft`, `getStudentPremiumState`, `summarizeLessonFees`, `formatKrw`.
- **화면**: 과외쌤 `/billing`(상태·던닝·인보이스·해지/일시정지), `/billing/cancel`, `/lesson-fees`(수기). 학생 `/subscribe`(프리미엄), `/settings/subscription`(해지).

### 실제 동작 vs mock
- **실제**: 인보이스 계산(active×단가, 해제 시 감소), 단가 단일출처, 수업료 수기 트래커, 구독 상태 게이팅, DB 마이그레이션 원격 push.
- **MOCK(명시)**: 구독 상태 전이 = `mock_set_teacher_subscription` / `mock_set_student_subscription` RPC(웹훅 대체, DEV 전용). 학생 IAP 결제 = 모의.
- **STUB(미배포)**: `billing-stripe`, `iap-webhook` Edge Function = 레포에 501 스텁. 실제 Stripe/RevenueCat 키·서명 검증·실결제는 **STOP — 사람 승인/키 필요**.

### 검증 결과
- `lint`/`typecheck`/`test`(85)/`build` 모두 green.
- 원격 RLS 통합 테스트 ✅ `m6.billing.rls.integration.test.ts`: 2명 active→2×단가, 1명 해제→1×단가로 감소, 과외쌤별 인보이스/구독 격리, 모의 던닝/학생 프리미엄 전이.
- 프라이버시 grep: 집중 파일 무변경·청정.

### 다음 / 막힌 점
- 다음: M7(알림·계정·시스템 상태).
- 막힌 점: 실제 결제/웹훅은 키·사람 승인 필요(설계상 STOP 지점, 블로커 아님 — mock으로 플로우 완성).

---

## M7 — 알림 · 계정 · 시스템 상태  ✅ 구현·검증 완료
브랜치: `codex/m7-notifications-account`

### 무엇을
- **회원 탈퇴**: `delete_my_account()` RPC(본인 auth.users 삭제 → 전 테이블 cascade). 다단계 + 본인 확인('삭제' 입력). 마이그레이션 `20260627000000`.
- **시스템 상태**: `app_config`(공개 읽기) + `getSystemGateState`(강제 업데이트 > 점검 > 정상).
- **순수 로직**(`m7.ts`): 알림 딥링크 라우팅·미읽음 수, 푸시 프라이밍 상태(거부해도 기능 유지), 탈퇴 확인 검증, 시스템 게이트.
- **학생 화면**: 알림 센터(`/notifications`), 설정 허브(`/settings`), 프로필 편집(`/settings/profile`), 회원 탈퇴(`/settings/account/delete`), 푸시 프라이밍(`/onboarding/push`), 약관 뷰어(`/legal/[doc]`), 시스템 상태(`/system`).
- **과외쌤 화면**: 알림 센터(`/notifications`), 회원 탈퇴(`/settings/account/delete`).

### 실제 동작 vs mock
- **실제**: 회원 탈퇴 cascade, 알림 목록/읽음/딥링크, 시스템 게이트 판정(원격 app_config), 프로필 편집 저장.
- **MOCK(명시)**: 푸시 토큰 등록 = 모의(`expo-mock-*` 토큰; 실제 expo-notifications 권한/토큰은 실기기 전용). 실제 푸시 발송 없음.

### 검증 결과
- `lint`/`typecheck`/`test`(91 shared)/`build` 모두 green.
- 원격 RLS 통합 테스트 ✅ `m7.account.rls.integration.test.ts`: 회원 탈퇴 시 auth.users·profiles·todos cascade 삭제, 본인 알림만 조회, app_config anon 공개 읽기.
- 프라이버시 grep: 집중 파일 무변경·청정.
- ⚠️ 플레이크 노트: 통합 테스트를 전부 병렬 실행 시 Supabase auth 사용자 동시 생성으로 간헐적 rate-limit 실패가 한 번 관찰됨(재실행 시 전체 통과). CI에서 재시도/직렬화 권장 — M8에서 보완.

### 다음 / 막힌 점
- 다음: M8(폴리시 & QA — 접근성·카피·E2E).
- 막힌 점 없음.

---

## M8 — 폴리시 & QA  ✅ 구현·검증 완료
브랜치: `codex/m8-polish-qa`

### 무엇을
- **접근성(WCAG AA)**: `getContrastRatio`/`meetsAA` 유틸 + 토큰 대비 테스트(`a11y.test.ts`).
- **디자인 토큰 준수**: 승인된 시맨틱 틴트(`tints`) 추가 + `approvedColorValues`. `token-guard.test.ts`가 앱 화면(.tsx)의 모든 hex가 승인 팔레트에 속하는지 강제(임의색 0).
- **E2E 스캐폴딩**: 과외쌤 Playwright(`apps/teacher/e2e/report-share.e2e.ts` + config, `test:e2e`), 학생 Maestro(`apps/student/e2e/timer-focus.flow.yaml`, `test:e2e`).
- **통합 테스트 플레이크 보완(M7 관찰분 해결)**: `packages/shared/vitest.config.ts` 신설 — 원격 env가 있어 통합 테스트가 실제로 도는 경우에만 파일을 **직렬 실행(`fileParallelism: false`)** 하여 Supabase auth 동시 `createUser` rate-limit을 제거하고, 일시적 실패는 **재시도(`retry: 2`)** 로 흡수. 단위 테스트만 도는 일반 실행은 병렬 유지(속도). (게이팅은 통합 테스트 `loadTestEnv()`와 동일 조건.)

### 실제 동작 vs mock
- **실제**: 대비 계산·가드 테스트는 실제로 실행되어 토큰을 검증.
- **스캐폴딩(미실행)**: E2E는 브라우저/에뮬레이터 + 실행 서버가 필요해 헤드리스 자율 실행 대상 아님 → CI에서 `pnpm --filter <app> test:e2e`로 실행하도록 스캐폴딩.

### 검증 결과 / 접근성 발견
- `lint`/`typecheck`/`test`/`build` 모두 green (shared 91 단위 + design-tokens 8 + student 2 + teacher 2 = 103; 원격 env 동반 시 shared 통합 테스트 7개도 직렬 실행으로 통과).
- 접근성 발견: 흰 글씨는 **브랜드 위(5.13:1)만** 일반 텍스트 AA 충족, danger 위는 굵은 버튼(라지 3.0)만 충족. **flame/warning 위 흰 글씨는 AA 미달(2.83/2.27)** → 이 색들은 항상 ink/스트롱 텍스트로만 사용(테스트가 규칙을 강제·문서화).
- 토큰 가드: 앱 화면 내 임의색 0(모든 hex가 colors/tints 소속).

### 다음 / 막힌 점
- 막힌 점: (1) E2E는 실행 환경(브라우저/에뮬레이터) 필요 — 사람/CI 실행. (2) `docs/ui-catalog` PNG 미제공(AGENTS §9 TODO) → 화면-카탈로그 1:1 대조는 자산 도착 후. 둘 다 자율 빌드의 블로커 아님.

---

## 전체 요약 (M4~M8, 이 세션)
- M3 2-B(PR #5) squash merge 완료(배포 노트: focus 마이그레이션 순서).
- M4 AI 완료검사, M5 추천·리포트·학부모 공유, M6 수익화(mock), M7 알림·계정·시스템, M8 폴리시·QA — 각 마일스톤 브랜치→검증→main squash merge 완료.
- 모든 DB 마이그레이션은 링크된 Supabase(`khssgcagudjimrezebxq`)에 push + 타입 재생성 완료. 핵심 프라이버시/접근 규칙은 원격 RLS 통합 테스트로 증명(졸음 메타데이터 무업로드, AI 판정 서버권위, 사진 공개범위, 학부모 토큰 전용, 과금 격리, 회원탈퇴 cascade).
- **사람 승인 대기(블로커 아님)**: Edge Function 프로덕션 배포(ai-homework-check / billing-stripe / iap-webhook), 실제 결제·AI 키 연동, E2E 실행, ui-catalog 대조. 자세한 항목은 STOP-NEEDS-HUMAN.md.
- `gh` 미설치로 GitHub PR 객체는 생성하지 못함 → 각 마일스톤은 브랜치 push 후 main에 squash merge(커밋 메시지에 요약/배포 노트). 사람이 원하면 PR을 따로 열 수 있음.
