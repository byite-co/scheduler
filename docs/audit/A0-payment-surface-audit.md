# A0 — 결제·구독 화면 읽기 전용 감사

작성: 2026-08-16 · 기준 커밋: `d5c8b1f` (main)
Supabase: `khssgcagudjimrezebxq` (읽기 쿼리만 실행)
**코드 변경 0건.** 이 문서 외에 생성·수정한 파일 없음.

---

## 1. 요약 표

| 영역 | 결제 화면 존재 | 구매 진입점 | 가격 표시 | 외부 링크 | 결제 SDK | 서버 게이트 |
|---|---|---|---|---|---|---|
| teacher-mobile | ✅ 1개 (`/billing`) | ❌ 없음 | ✅ 4,900원(상수) | ❌ 없음 | ❌ 없음 | ❌ 이 앱 기능엔 없음 |
| student | ✅ 2개 (`/subscribe`, `/settings/subscription`) | ❌ 없음(문구만) | ✅ 8,900원(상수) | ❌ 없음 | ❌ 없음 | ✅ AI 검사만 |
| teacher(web) | ✅ 2개 (`/billing`, `/billing/cancel`) | ❌ 없음 | ✅ 4,900원(상수) | ❌ 없음 | ❌ 없음 | ❌ 없음 |

**세 앱 어디에도 실제 구매를 시작하는 코드가 없다.** 결제 SDK 의존성 0, 외부 결제 URL 0.
모든 화면이 "상태 조회 + 연동 예정 안내"까지만 한다.

---

## 2. 영역별 상세

### A. `apps/teacher-mobile/` (과외쌤 모바일, Expo)

**1. 화면 파일과 라우트**

| 라우트 | 라우트 파일 | 화면 구현 |
|---|---|---|
| `/billing` | `apps/teacher-mobile/app/billing/index.tsx:1` | `apps/teacher-mobile/src/billingScreen.tsx:36` |

**2. 진입점 — 1곳뿐**

- `apps/teacher-mobile/src/settingsScreen.tsx:44` — 설정 탭 › "구독·계정" 카드 › `router.push("../billing")`
- 탭 바에는 없다 (`app/(tabs)/_layout.tsx:11` — 대시보드·학생·알림·설정 4개뿐)
- 대시보드에 구독 카드 없음 (`app/(tabs)/index.tsx` 에 billing/구독 문자열 0건)
- 딥링크·알림·배너·온보딩 진입점: **없음**

**3. 표시 문구 (원문 인용)**

| 종류 | 문자열 | 위치 |
|---|---|---|
| 가격 | `active 학생 {activeCount}명 × {formatKrw(PRICE_PER_STUDENT_KRW)}` → 런타임 "4,900원" | `billingScreen.tsx:101` |
| 금액 | `{formatKrw(estimated)}` (38pt 대형) | `billingScreen.tsx:99` |
| 안내 | `"쌤플래너 앱 사용료예요"` | `billingScreen.tsx:88` |
| 안내 | `"학생에게 받는 과외비는 '수업료 관리'에서 별도로 기록합니다."` | `billingScreen.tsx:89` |
| **결제 장소** | `"모바일 인앱결제는 별도 출시 작업에서 연결합니다. 이 화면에서는 실제 결제·재결제·해지를 처리하지 않습니다."` | `billingScreen.tsx:119` |
| 결제수단 | `"등록된 결제수단이 없습니다."` | `billingScreen.tsx:116` |
| 인보이스 | `"결제 연동 후 월별 청구 내역이 여기에 표시돼요."` | `billingScreen.tsx:126` |

요금제 비교표: 없음. 무료체험 안내: 없음. "업그레이드/구독하기" CTA: **없음**.

**4. 버튼 — 0개.** `billingScreen.tsx` 전체에 `Pressable`·`onPress`·`Button` 이 하나도 없다. 순수 읽기 화면.

**5. 외부 URL 이동: 없음.** `Linking`·`WebBrowser`·`WebView` 임포트 0건.

**6. 결제 SDK: 없음.** `package.json` 및 전체 소스에서 RevenueCat/Purchases/StoreKit/expo-in-app-purchases/Play Billing 0건. 유일한 "stripe" 문자열은 DB 컬럼명 선택(`billingScreen.tsx:53` `stripe_customer_id`).

**7. 결제 없이 잠기는 기능: 없음.** 이 앱에는 게이트가 하나도 없다. `getReportGating`·프리미엄 판정 코드 0건 (`homeworkAssignScreen.tsx:108` 의 `ai_check_enabled` 는 숙제별 검사 여부 토글이지 과금 게이트가 아니다).

**8. iOS/Android 분기: 없음.** `Platform.OS` 0건.

**9. 구독 행이 없는 계정의 기본 표시** (`billingScreen.tsx:79`, `getTeacherBillingState("none")`)
- 상태 칩: `getTeacherBillingState("none").label`
- 금액: `active N명 × 4,900원` (구독 없어도 금액이 계산되어 표시됨)
- 결제수단: "등록된 결제수단이 없습니다."
- 인보이스: EmptyState "아직 인보이스가 없어요"

**10. 와이어프레임**

```
[구독·정산]                                   ← 헤더
┌ 쌤플래너 앱 사용료예요 ─────────────────┐
│ 학생에게 받는 과외비는 '수업료 관리'에서…  │
└──────────────────────────────────────┘
┌ (검정 카드) ─────────────────────────┐
│ 이번 달 예상 앱 구독료        [상태 칩]  │
│ 14,700원                        ← 38pt │
│ active 학생 3명 × 4,900원              │
│ (billing.reason)                       │
│ 현재 이용 기간 · 2026-09-15까지         │
└──────────────────────────────────────┘
┌ 결제 연결 상태 ────────────────────────┐
│ 등록된 결제수단이 없습니다.              │
│ 모바일 인앱결제는 별도 출시 작업에서 …    │
└──────────────────────────────────────┘
인보이스
┌ 2026-08 · 학생 3명 / 결제 예정  14,700원 ┐
└──────────────────────────────────────┘
                        ← 버튼 0개
```

---

### B. `apps/student/` (학생 앱, Expo)

**1. 화면 파일과 라우트**

| 라우트 | 라우트 파일 | 화면 구현 |
|---|---|---|
| `/subscribe` | `apps/student/app/subscribe.tsx:1` | `apps/student/src/m6Screens.tsx:49` `SubscribeScreen` |
| `/settings/subscription` | `apps/student/app/settings/subscription.tsx:1` | `m6Screens.tsx:91` `SubscriptionManageScreen` |

**2. 진입점**

| → 대상 | 위치 | 트리거 |
|---|---|---|
| `/subscribe` | `apps/student/src/m5Screens.tsx:116` | 잠금 안내 안의 "월 구독하고 광고 없이 무제한" 버튼 |
| `/subscribe` | `m6Screens.tsx:120` | 구독 관리 화면의 "프리미엄 보러가기" (비프리미엄일 때만) |
| `/settings/subscription` | `apps/student/src/m7Screens.tsx:107` | 설정 › 계정 › "구독 관리" |
| `/settings/subscription` | `m6Screens.tsx:76` | 구독 화면의 "구독 관리" (프리미엄일 때만) |

`m5Screens.tsx:116` 의 잠금 안내는 **`/ai` 탭(AI 추천)과 `/report` 화면 두 곳**에서 렌더된다.
딥링크·푸시·온보딩 진입점: 없음.

**3. 표시 문구 (원문 인용)**

| 종류 | 문자열 | 위치 |
|---|---|---|
| **가격** | `{formatKrw(PRICE_STUDENT_PREMIUM_KRW)} / 월` → 런타임 "8,900원 / 월" | `m6Screens.tsx:59` |
| 제목 | `"광고 없이, 무제한으로"` | `m6Screens.tsx:58` |
| **플랜 혜택** | `"프리미엄 혜택"` / `"• 나의 리포트 · AI 추천 무제한"` / `"• 혼공 AI 검사 무제한 (광고 없이)"` | `m6Screens.tsx:62-64` |
| **결제 안내** | `"결제 준비 중"` / `"인앱 결제 연동 후 여기서 바로 구독할 수 있어요. 그때까지는 광고 보상으로 열어서 써주세요."` | `m6Screens.tsx:82-84` |
| **결제 장소** | `"구독 해지는 결제하신 스토어(App Store · Google Play)의 구독 관리에서 할 수 있어요."` | `m6Screens.tsx:117` |
| CTA | `"월 구독하고 광고 없이 무제한"` | `m5Screens.tsx:118` |
| CTA | `"광고 없이 매주 받고 싶다면? 월 구독 →"` | `m5Screens.tsx:121` |
| CTA | `"광고 보고 무료로 열기"` | `m5Screens.tsx:113` |
| CTA | `"프리미엄 보러가기"` | `m6Screens.tsx:121` |

무료체험 안내: 없음. 요금제 **비교표**: 없음(혜택 나열만).

**4. 버튼 라벨 ↔ 동작**

| 화면 | 라벨 | 동작 |
|---|---|---|
| `/subscribe` (프리미엄) | "구독 관리" | `router.push("/settings/subscription")` — `m6Screens.tsx:76` |
| `/subscribe` (비프리미엄) | — | **버튼 없음.** "결제 준비 중" 카드만 (`m6Screens.tsx:81-86`) |
| `/settings/subscription` (프리미엄) | — | **버튼 없음.** "해지 안내" 카드만 (`m6Screens.tsx:114-119`) |
| `/settings/subscription` (비프리미엄) | "프리미엄 보러가기" | `router.push("/subscribe")` — `m6Screens.tsx:120` |
| 잠금 안내 | "광고 보고 무료로 열기" | `watchAdToUnlock()` → `ad_unlocks` INSERT — `m5Screens.tsx:85-95` |
| 잠금 안내 | "월 구독하고 광고 없이 무제한" | `<Link href="/subscribe">` — `m5Screens.tsx:116` |

**5. 외부 URL 이동: 없음.** `Linking.openURL`·`WebBrowser`·`WebView` 0건.

**6. 결제 SDK: 없음.** 소스 전체 0건. `m6Screens.tsx:44` 는 주석("실제 결제는 IAP/RevenueCat 웹훅이 담당한다")일 뿐 코드 아님.

**7. 잠기는 기능과 판정 위치**

| 기능 | 잠금 판정 | 클라이언트/서버 |
|---|---|---|
| 나의 리포트(`/report`) | `m5Screens.tsx:213` `useGatedFeature("report")` | **클라이언트만** |
| AI 공부량 추천(`/ai`) | `m5Screens.tsx:127` `useGatedFeature("ai_rec")` | **클라이언트만** |
| 혼공 AI 숙제검사 | `supabase/functions/ai-homework-check/index.ts:232` `has_active_student_premium()` | **서버** |
| 타이머·플래너·또래비교·집중모드 | 게이트 코드 0건 | 잠기지 않음 |

판정 함수는 `packages/shared/src/m5.ts:117` `getFeatureGateState()` — 구독 or `ad_unlocks` 행. 이 함수를 호출하는 곳은 `m5Screens.tsx` 뿐이며 서버에는 같은 판정이 **없다**.

**8. iOS/Android 분기:** 결제 관련 분기 없음. 앱 전체에서 `Platform.OS` 는 2곳뿐이고 둘 다 결제와 무관 (`focusCamera.native.tsx:133` 카메라 가용성, `m7Screens.tsx:231` 푸시 토큰 platform 값).

**9. 구독 행이 없는 계정의 기본 표시**
`m6Screens.tsx:32` `.maybeSingle()` → `status = "none"`, `expiresAt = null` → `getStudentPremiumState` → `{ isPremium: false, label: "무료" }`.
- `/subscribe`: 가격 8,900원 + 혜택 2줄 + "현재 상태: 무료" + **"결제 준비 중"** 카드 (구매 버튼 없음)
- `/settings/subscription`: 제목 "무료" + "프리미엄 보러가기" 버튼

**10. 와이어프레임**

```
/subscribe                          /settings/subscription
프리미엄                             구독 관리
광고 없이, 무제한으로                  무료  ← premium.label
8,900원 / 월                        (message)
┌ 프리미엄 혜택 ──────────┐          ┌ 만료 예정 ─────┐ (expiresAt 있을 때만)
│ • 나의 리포트·AI 추천 무제한 │          │ 2026-09-15    │
│ • 혼공 AI 검사 무제한       │          └──────────────┘
└──────────────────────┘          [ 프리미엄 보러가기 ]  ← 비프리미엄
┌ 현재 상태 ────────────┐          ┌ 해지 안내 ──────┐  ← 프리미엄
│ 무료                  │          │ 스토어에서 해지…  │
└──────────────────────┘          └──────────────┘
┌ 결제 준비 중 ──────────┐
│ 인앱 결제 연동 후 …      │
└──────────────────────┘
```

---

### C. `apps/teacher/` (과외쌤 웹, Next.js)

**1. 화면 파일과 라우트**

| 라우트 | 라우트 파일 | 화면 구현 |
|---|---|---|
| `/billing` | `apps/teacher/src/app/billing/page.tsx:1` | `apps/teacher/src/app/m6.tsx:31` `TeacherBilling` |
| `/billing/cancel` | `apps/teacher/src/app/billing/cancel/page.tsx:1` | 같은 컴포넌트 재사용 |

**2. 진입점**

| 위치 | 형태 |
|---|---|
| `m1.tsx:825` | 좌측 내비게이션 `{ href: "/billing", label: "구독·정산", short: "정산", icon: Wallet }` |
| `m1.tsx:675` | 설정 화면 "구독 · 정산" 패널 › `<a href="/billing">결제 관리</a>` |
| `m5.tsx:556` | **리포트 빌더의 무료 플랜 배너 › `<a href="/billing">구독 시작</a>`** |

`/billing/cancel` 로 가는 링크는 **레포 전체에 0건** — 고아 라우트.

**3. 표시 문구 (원문 인용)**

| 종류 | 문자열 | 위치 |
|---|---|---|
| **가격** | `예상 월 청구 = active {activeCount}명 × {formatKrw(PRICE_PER_STUDENT_KRW)} = {formatKrw(estimated)}` | `m6.tsx:114` |
| 가격 | `연동 학생 {activeCount}명 · 학생당 {PRICE_PER_STUDENT_KRW}원` | `m1.tsx:671` |
| 제목 | `"앱 구독료"` / `"우리에게 내는 앱 구독료예요. 학생이 내는 수업·수업료와는 완전히 별개입니다."` | `m6.tsx:98-99` |
| **결제 장소** | `"구독 시작은 결제 연동(Stripe) 후 이 화면에서 할 수 있어요."` | `m6.tsx:123` |
| 결제 장소 | `"해지·일시정지는 결제 연동 후 이 화면에서 처리할 수 있어요."` | `m6.tsx:120` |
| 결제 장소 | `"미납 복구는 결제 연동 후 결제수단 업데이트로 처리돼요."` | `m6.tsx:122` |
| **플랜 비교** | `"무료 플랜은 자동 그래프 없이 직접 쓴 코멘트로 보내요. 구독하면 공부량·수행률 그래프가 리포트에 들어가요."` | `packages/shared/src/parentReport.ts:449` |
| 플랜 라벨 | `"자동 그래프"` / `"수기 기록"` | `parentReport.ts:441,448` |
| **CTA** | `"구독 시작"` | `m5.tsx:557` |
| CTA | `"결제 관리"` | `m1.tsx:678` |
| 인보이스 | `"'이번 달 인보이스 생성'을 누르면 연동 학생 수 기준 앱 구독료 청구서가 만들어져요."` | `m6.tsx:140` |

무료체험 안내: 없음.

**4. 버튼 라벨 ↔ 동작**

| 라벨 | 동작 | 위치 |
|---|---|---|
| "이번 달 인보이스 생성" | `generateInvoice()` → `supabase.rpc("generate_teacher_invoice", { p_period: currentPeriod() })` | `m6.tsx:130`, 함수 `m6.tsx:69` |
| "구독 시작" | `<a href="/billing">` — 페이지 이동만 | `m5.tsx:556` |
| "결제 관리" | `<a href="/billing">` — 페이지 이동만 | `m1.tsx:675` |

`m6.tsx:64-66` 주석에 따르면 예전에 있던 상태 변경 mock 버튼은 제거됐다.
구독을 시작·해지·일시정지하는 버튼은 **현재 0개**.

**5. 외부 URL 이동: 없음.** `window.open` 0건. `<a href>` 는 전부 앱 내부 경로(`m1.tsx:411,879,915,1044,1047`, `m4.tsx:142`, `m5.tsx:556,734`, `students/[id]/page.tsx:107,221`).

**6. 결제 SDK: 없음.** Stripe JS/Elements 임포트 0건. `package.json`에 결제 의존성 없음.

**7. 잠기는 기능과 판정 위치**

| 기능 | 판정 | 클라이언트/서버 |
|---|---|---|
| 리포트 자동 그래프 | `m5.tsx:500` `getReportGating(getTeacherBillingState(subStatus).active)` | **클라이언트만** |
| 리포트 발급 한도 | `enforce_report_quota` 트리거 (`20260815020000_lessons_and_report_quota.sql:170`) | 서버 (구독 무관) |
| 그 외 전부 | 게이트 없음 | — |

자동 그래프 게이팅은 **스냅샷 저장 시점에 데이터를 빼는** 방식이다:
`m5.tsx:409` `data: { ...(gating.autoGraphs ? report : {}), lessons, branding, gating: gating.mode }`

**8. iOS/Android 분기:** 해당 없음(웹).

**9. 구독 행이 없는 계정의 기본 표시**
`m6.tsx:51` `.maybeSingle()` → `status = "none"` → `getTeacherBillingState("none")`.
- 상태 카드: label/reason + `예상 월 청구 = active N명 × 4,900원 = …`
- 안내: "구독 시작은 결제 연동(Stripe) 후 이 화면에서 할 수 있어요."
- 인보이스: EmptyState
- 리포트 빌더(`/reports/weekly`)에는 "수기 기록" 칩 + 무료 안내 + "구독 시작" 버튼이 뜨고 자동 그래프 섹션이 렌더되지 않음

**10. 와이어프레임**

```
[좌측 내비] 대시보드 / 학생 관리 / 숙제 검사 / 리포트 / 구독·정산 / 설정
────────────────────────────────────────────────
앱 구독료
우리에게 내는 앱 구독료예요. 학생이 내는 수업·수업료와는 완전히 별개입니다.

※ 수업·수업료 기록은 [수업료 트래커]에서 따로 관리해요.

┌ (상태 톤 테두리) ───────────────────────────┐
│ 미구독                                        │
│ (billing.reason)                              │
│ 예상 월 청구 = active 3명 × 4,900원 = 14,700원 │
│ ┌ 구독 시작은 결제 연동(Stripe) 후 … ────────┐ │
│ └────────────────────────────────────────┘ │
└──────────────────────────────────────────┘

인보이스                        [ 이번 달 인보이스 생성 ]
┌ 아직 인보이스가 없어요 (EmptyState) ─────────┐
└──────────────────────────────────────────┘
```

---

## 3. 서버 코드 (11~15)

### 11. Stripe 관련 전부

| 항목 | 값 | 위치 |
|---|---|---|
| Edge Function | `billing-stripe` — **STUB** | `supabase/functions/billing-stripe/index.ts` |
| 501 반환 지점 | `index.ts:16-21` — `{ stub: true, error: "billing-stripe not configured (no keys yet)" }`, `status: 501` | 같은 파일 |
| 환경변수명 | `STRIPE_WEBHOOK_SECRET` — **주석에만 등장**(`index.ts:9`). 실제 `Deno.env.get()` 호출 0건 | — |
| DB 컬럼 | `teacher_subscriptions.stripe_customer_id` (text, 사용처 없음), `provider sub_provider default 'stripe'` | `schema.sql:1355,1354` |
| enum | `sub_provider as enum ('iap','stripe')` | `20260621000000_initial_schema.sql:28` |
| 배포 상태 | **미배포**(파일 헤더 "not yet deployed"). 실제 배포 여부는 확인 불가 — 아래 §5 참조 |

국내 PG(tosspayments/iamport/portone) 관련 코드: **0건.**

### 12. IAP 관련 서버 코드

| 항목 | 값 |
|---|---|
| Edge Function | `iap-webhook` — **STUB**, `supabase/functions/iap-webhook/index.ts:14-19` 에서 501 반환 |
| 영수증 검증 | **없음.** 코드 0줄 |
| 서명 검증 | 없음 (`index.ts:8` 주석 "RevenueCat 서명/공유 시크릿 검증" = 할 일 목록) |
| 환경변수 | 없음 |
| 대체 수단 | `mock_set_student_subscription(sub_status, timestamptz)` — service_role 전용 |

### 13. 구독/권한 관련 테이블 (원격 DB 실측)

| 테이블 | 컬럼 |
|---|---|
| `student_subscriptions` | `student_id`(PK) · `status`(sub_status) · `provider`(sub_provider) · `expires_at` · `updated_at` |
| `teacher_subscriptions` | `teacher_id`(PK) · `status` · `provider` · `stripe_customer_id` · `payment_method_last4` · `current_period_end` · `updated_at` |
| `billing_invoices` | `id` · `teacher_id` · `period` · `student_count` · `amount` · `status` · `issued_at` · `paid_at` |
| `ad_unlocks` | `id` · `student_id` · `feature`(unlock_feature) · `unlocked_at` · `expires_at` |
| `per_student_settings` | `connection_id`(PK) · `ai_check_subjects` · `report_cycle` · `updated_at` |

- **`ai_enabled` 컬럼: 존재하지 않음.**
- **`ai_entitlement_periods` 테이블: 존재하지 않음** (`information_schema.tables` 에서 `%entitle%` 조회 결과 0행).
- `ai_check_enabled` 는 **`todos` 테이블의 컬럼**이다(`schema.sql:313`, 숙제별 검사 여부). 과금 권한과 무관.

**데이터 실측: `teacher_subscriptions` 0행 · `student_subscriptions` 0행 · `billing_invoices` 0행.**

### 14. 구독 관련 함수와 권한 (원격 DB 실측)

| 함수 | SECURITY DEFINER | anon | authenticated | service_role |
|---|---|---|---|---|
| `has_active_student_premium()` | ❌ INVOKER | ✗ | ✅ | ✅ |
| `generate_teacher_invoice(text)` | ✅ | **✅** | ✅ | ✅ |
| `price_per_student_krw()` | ❌ | ✅ | ✅ | ✅ |
| `mock_set_student_subscription(...)` | ✅ | ✗ | ✗ | ✅ |
| `mock_set_teacher_subscription(...)` | ✅ | ✗ | ✗ | ✅ |
| `ai_check_usage()` | ✅ | ✗ | ✅ | ✅ |
| `report_monthly_quota(uuid)` | ✅ | ✗ | ✅ | ✅ |
| `ai_check_max_*()` / `report_quota_*()` | ❌ | ✅ | ✅ | ✅ |

RLS 정책:

| 테이블 | 정책 | cmd | 내용 |
|---|---|---|---|
| `student_subscriptions` | `studsub_self` | SELECT | `student_id = auth.uid()` |
| `teacher_subscriptions` | `tsub_self` | SELECT | `teacher_id = auth.uid()` |
| `billing_invoices` | `inv_self` | SELECT | 본인 |
| `ad_unlocks` | `unlock_self` | **ALL** | `using/with check (student_id = auth.uid())` — `schema.sql:1458` |
| `per_student_settings` | `pss_teacher_rw` | ALL | 그 연결의 과외쌤 |

구독 테이블 3개는 SELECT 전용이라 클라이언트가 자기 구독 상태를 못 바꾼다(정상).
`ad_unlocks` 만 ALL 이다 — §4 위험 항목 참조.

### 15. AI 숙제검사 호출 경로의 유료 판정 지점

호출 경로: `apps/student/src/m4Screens.tsx:183` `supabase.functions.invoke("ai-homework-check")`
→ `supabase/functions/ai-homework-check/index.ts`

| 순서 | 판정 | 위치 |
|---|---|---|
| 1 | `ai_check_enabled` 꺼진 숙제 거절 | `index.ts:205` |
| 2 | `scope_text` 없으면 거절 | `index.ts:208` |
| 3 | **`source='teacher'` → active 연결만 확인** | `index.ts:218-228` |
| 4 | **`source='self'` → `has_active_student_premium()`** | `index.ts:232-239` |
| 5 | 사용량 한도(40회·100장) | `start_homework_check_attempt` RPC 내부, `20260807020000_ai_check_limits_rebalance.sql:189,194` |

**3번에서 `teacher_subscriptions` 를 읽지 않는다.** 레포 전체에서 그 테이블을 읽는 코드는
`apps/teacher/src/app/m5.tsx:205`, `apps/teacher/src/app/m6.tsx:47`,
`apps/teacher-mobile/src/billingScreen.tsx:52` 세 곳이고 **모두 표시용**이다.

TS 쌍둥이 구현: `packages/shared/src/m4.ts:521` `getAiCheckEntitlement()` — 같은 분기(연결만 확인).

---

## 4. 위험 항목

### 🟢 앱 심사 충돌 — 현재 없음

| 점검 항목 | 결과 |
|---|---|
| 모바일 앱 안에 실제 구매 버튼 | **없음.** student·teacher-mobile 모두 구매 버튼 0개 |
| 모바일 앱 → 웹 결제 링크/WebView | **없음.** `Linking.openURL`·`WebBrowser`·`WebView` 0건 |
| 모바일 앱에 가격 표시 | **있음** — student `8,900원 / 월`(`m6Screens.tsx:59`), teacher-mobile `4,900원`(`billingScreen.tsx:101`) |

가격 표시 자체는 심사 위반이 아니다(구매 수단이 앱 내 IAP 여야 한다는 것이 요건).
**단, 새 구조("교사=웹 국내 PG")에서는 teacher-mobile 의 가격·금액 표시가 문제가 된다** —
앱 안에서 가격을 보여 주고 결제는 앱 밖에서 하게 되면 스토어 정책과 충돌한다.
teacher-mobile `billingScreen.tsx:119` 의 현재 문구는 오히려 **"모바일 인앱결제는 별도 출시 작업에서
연결합니다"** 라고 되어 있어, 웹 PG 로 확정된 방향과 어긋난다(수정 대상).

### 🔴 잠금 판정이 클라이언트에만 있음 → 우회 가능

| 기능 | 판정 위치 | 우회 방법 |
|---|---|---|
| 학생 "나의 리포트" | `m5Screens.tsx:213` | PostgREST 직접 조회로 원본 데이터 접근 |
| 학생 "AI 공부량 추천" | `m5Screens.tsx:127` | 같음 |
| 과외쌤 리포트 자동 그래프 | `m5.tsx:500` | `reports` INSERT 를 직접 호출해 자동 데이터가 담긴 스냅샷 저장 |
| **광고 시청 보상** | `m5Screens.tsx:85` | `ad_unlocks` 정책이 **ALL** 이라 광고를 안 보고 INSERT 가능(`schema.sql:1458`) |

### 🔴 과외쌤 구독이 아무것도 잠그지 않음

`ai-homework-check/index.ts:218` 이 `teacher_subscriptions` 를 보지 않는다.
**구독하지 않은 과외쌤이 낸 숙제도 AI 검사가 그대로 실행된다.** 원가가 발생하는 유일한 기능이
과외쌤 쪽에서는 무료다. 구독 행이 0개라 아직 사고가 드러나지 않았을 뿐이다.

### 🟡 고아 화면·라우트

| 대상 | 상태 |
|---|---|
| `apps/student/app/report.tsx` (`/report`, "나의 주간 리포트") | **진입점 0건.** 학생 앱 전체의 `href`/`router.push` 대상 17개 중 `/report` 없음. 탭에도 없음(`(tabs)/` 는 today·planner·records·class·ai) |
| `apps/teacher/src/app/billing/cancel/page.tsx` (`/billing/cancel`) | **링크 0건.** URL 직접 입력으로만 도달 |

`/report` 는 유료 게이트가 걸린 화면인데 도달 자체가 불가능하다 —
프리미엄 혜택 문구(`"• 나의 리포트 · AI 추천 무제한"`, `m6Screens.tsx:63`)가 **절반은 거짓**이다.

### 🟡 가격 하드코딩 위치

소스 코드에 숫자를 직접 쓴 곳은 **없다.** 모두 상수를 참조한다.

| 값 | 정의 위치 | 성격 |
|---|---|---|
| `8900` | `packages/shared/src/pricing.ts:9` | 단일 출처 |
| `4900` | `packages/shared/src/pricing.ts:10` | 단일 출처 |
| `4900` | `supabase/schema.sql:1378` `price_per_student_krw()` | **DB 이중화** — 서버가 청구액을 계산하므로 필요. `m6.schema.test.ts:48` 이 두 값을 대조 |
| `4900` | `supabase/migrations/20260810010000_pricing_increase.sql:18` | 마이그레이션(불변) |
| 테스트 기대값 | `pricing.test.ts:13,14,20-22`, `page.test.ts:10`(`19600`) | 값 변경 시 함께 수정 필요 |

문서에 박힌 가격: `docs/PRD.md:65,66,75,76`, `docs/PROJECT-GUIDE.md:193,195,198`.

### 🟡 `generate_teacher_invoice` 가 anon 에 열려 있음

원격 DB 실측 결과 `anon` 에 EXECUTE 가 있다. 함수 내부 `auth.uid() is null` 체크로
실제 실행은 막히지만(`schema.sql:1390`), 불필요하게 열린 권한이다.
또한 `authenticated` 에도 열려 있어 **과외쌤이 자기 인보이스를 임의 시점에 스스로 발행**할 수 있다.

---

## 5. 확인 불가 항목과 그 이유

| 항목 | 이유 |
|---|---|
| Edge Function 의 **실제 배포 여부** | Management API 의 Functions 조회를 이번 감사에서 실행하지 않았다(읽기 전용 범위를 DB 쿼리로 한정). 소스 헤더에 "not yet deployed" 라고 적혀 있으나 그것은 주석일 뿐 배포 상태의 증거가 아니다 |
| Edge Function **환경변수(시크릿) 실제 설정값** | Supabase 시크릿은 API 로 값을 읽을 수 없다. `STRIPE_WEBHOOK_SECRET` 이 설정돼 있는지 확인 불가 |
| **스토어 콘솔 상태** (App Store Connect / Play Console 의 인앱 상품 등록 여부) | 레포 밖 정보 |
| **국내 PG 계약·가맹점 상태** | 레포 밖 정보. 코드에 PG 관련 문자열이 0건이라 코드로는 추론 불가 |
| teacher-mobile 의 `dist/` 산출물이 현재 소스와 일치하는지 | `apps/teacher-mobile/dist/_expo/.routes.json` 은 빌드 산출물이며 최신 여부를 확인하지 않았다 |
| `getTeacherBillingState()` 가 상태별로 내놓는 **정확한 label/reason 문자열** | `packages/shared/src/m6.ts:22` 에 있으나 이번 감사에서 본문을 열지 않았다. 화면은 이 값을 그대로 출력하므로, 문구 전수가 필요하면 추가 확인이 필요하다 |
| 광고 SDK 연동 여부 | `m5Screens.tsx:88` 에 `NOTE(mock)` 로 "실제 리워드 광고 SDK 대신"이라고 명시돼 있어 **미연동이 확실**하나, 어떤 SDK 를 쓸 계획인지는 코드에 없다 |
