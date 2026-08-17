# A3 — 허위·미구현 문구 정리 (student + teacher web)

작성: 2026-08-17 · 기준 커밋: `27464e3` (main — #44·#45·#46 머지 완료)
범위: **UI 문구만.** 서버·마이그레이션 변경 0건 · `apps/teacher-mobile/` 변경 0건
원칙: **제거만 한다.** 새 약속·새 안내·새 버튼을 추가하지 않는다.

---

## 1. 검색어 목록

| 분류 | 검색어 |
|---|---|
| 가격 | `PRICE_STUDENT_PREMIUM_KRW` `PRICE_PER_STUDENT_KRW` `8,900` `4,900` `8900` `4900` |
| 스토어 | `App Store` `Google Play` `스토어` |
| 잠금 암시 | `구독하면` `열려요` `열립니다` `무제한` `프리미엄 혜택` `구독 시작` `업그레이드` |
| 고아 라우트 | `billing/cancel` `"/report"` `'/report'` |

대상: `apps/student/{src,app}` · `apps/teacher/src` · `packages/shared/src`
(문구가 shared 상수에 들어 있는 경우가 있어 shared 도 함께 훑었다 — 화면은 그 값을 그대로 출력한다.)

---

## 2. student — 변경 전후

### 2-1. 가격 표시 제거 (작업 1)

`apps/student/src/m6Screens.tsx:59`

| | 문자열 |
|---|---|
| before | `<Text style={styles.price}>{formatKrw(PRICE_STUDENT_PREMIUM_KRW)} / 월</Text>` → 화면 **"8,900원 / 월"** |
| after | (삭제) |

`PRICE_STUDENT_PREMIUM_KRW`·`formatKrw` import 와 이제 쓰이지 않는 `styles.price` 도 함께 제거했다.
**학생 앱에서 이 상수를 읽는 곳은 0건**이 됐다.

> 근거: 학생 프리미엄은 IAP 로 확정됐고 가격의 정본은 스토어 메타데이터다.
> 앱에 하드코딩하면 스토어 값과 갈라지고 그 순간 거짓이 된다.
> ⚠️ `packages/shared/src/pricing.ts:9` 의 상수 자체는 **남겼다** — AI 검사 한도 예산 계산
> (`getStudentPremiumNetKrw()`, `m4.schema.test.ts`)이 이 값을 쓴다. 표시가 아니라 계산용이다.

### 2-2. 스토어 해지 안내 제거 (작업 2)

`apps/student/src/m6Screens.tsx:117`

| | 문자열 |
|---|---|
| before | `"구독 해지는 결제하신 스토어(App Store · Google Play)의 구독 관리에서 할 수 있어요."` (+ "해지 안내" 카드) |
| after | 카드 전체 삭제 (`null`) |

> 근거: IAP 연동이 없어 **결제한 사람이 존재할 수 없다.** 그 분기(`premium.isPremium`)에
> 도달하는 유일한 방법은 service_role 로 만든 테스트 데이터다. 상태 표시(제목·만료 예정)는 남는다.

### 2-3. 프리미엄 혜택 목록 제거 (작업 3)

`apps/student/src/m6Screens.tsx:58,62-65`

| | 문자열 |
|---|---|
| before | `"광고 없이, 무제한으로"` (제목) |
| before | `"프리미엄 혜택"` / `"• 나의 리포트 · AI 추천 무제한"` / `"• 혼공 AI 검사 무제한 (광고 없이)"` |
| after | 제목 `"준비 중"` · 카드 전체 삭제 |

**세 항목의 실제 상태를 확인한 결과 남길 항목이 하나도 없었다:**

| 항목 | 상태 | 근거 |
|---|---|---|
| 나의 리포트 | 고아 화면 | `/report` 진입점 **0건** (실측) |
| AI 추천 무제한 | 쓰기 차단 | `AI_REC_CLIENT_WRITE_ENABLED = false` (20260816020000) |
| 혼공 AI 검사 무제한 | 노출 차단 | `AI_CHECK_RESULTS_ENABLED = false`, Edge Function 이 **503 ai_check_paused** |

지시대로 목록을 "준비 중" 으로 대체하고 **구체 기능명·가격을 약속하지 않았다.**
제목의 `"광고 없이, 무제한으로"` 도 지웠다 — 광고 언락은 차단됐고 "무제한" 은 지금 아무 기능도
열어 주지 않으므로 제목 자체가 약속이었다.

### 2-4. `/report` 진입점 (작업 4)

`grep -rn "\"/report\"|'/report'" apps/student` → **0건.** 추가하지 않았고, 그대로 0건이다.
(`focus/report` 는 집중 모드 결과 화면으로 별개다.)

### 2-5. 광고 언락 잔여 문구 (작업 8 · student)

| 위치 | before | after |
|---|---|---|
| `m6Screens.tsx:84` | `"인앱 결제 연동 후 여기서 바로 구독할 수 있어요. 그때까지는 광고 보상으로 열어서 써주세요."` | 문장 전체 삭제 ("결제 준비 중" 제목만 남김) |
| `m5Screens.tsx:124` | `"월 구독하고 무제한으로 쓰기"` (버튼) | 버튼 삭제 |
| `m5Screens.tsx:129` | `"광고 없이 매주 받고 싶다면? 월 구독 →"` | 삭제 (`AD_UNLOCK_DISABLED_NOTICE` 만 남김) |
| `packages/shared/src/m5.ts:146` | `"무료: 광고를 보면 한 번 열려요"` | `"지금은 이용할 수 없어요"` |
| `packages/shared/src/m5.ts:131` | `"프리미엄: 무제한 이용"` | `"프리미엄 이용 중"` |

`m5.ts:146` 은 잠금 화면에 그대로 출력되는 문자열이었다 — 광고를 봐도 열리지 않으므로
**할 수 없는 일을 안내**하고 있었다. `m5.ts:131` 은 현재 렌더 경로가 없지만(프리미엄이면 잠금
화면이 안 뜬다) 같은 종류의 "무제한" 주장이라 함께 지웠다.

`m5Screens.tsx` 의 구독 버튼을 없애며 쓰이지 않게 된 `Link`·`Href` import 도 제거했다.
**구독 화면은 설정 › 구독 관리로 여전히 도달한다** — 새 진입점을 만들지 않았다.

---

## 3. teacher web — 변경 전후

### 3-1. `getTeacherBillingState("none")` (작업 5)

`packages/shared/src/m6.ts:41`

| | 문자열 |
|---|---|
| before | `reason: "앱 구독을 시작하면 학생 관리 기능이 열려요."` |
| after | `reason: "현재 구독 중이 아니에요."` |

> 근거: **어떤 서버 게이트도 `teacher_subscriptions` 를 보지 않는다**(A0 §3-15 실측).
> 학생 관리는 구독과 무관하게 열려 있어 저 문장은 허위였다.
> `restricted: true` 값은 유지했다 — 소비하는 화면이 있고 문구 작업 범위를 넘는다.

### 3-2. 리포트 빌더 "구독 시작" 버튼 (작업 6)

`apps/teacher/src/app/m5.tsx:555-559`

| | 코드 |
|---|---|
| before | `<a href="/billing" className="...bg-brand...">구독 시작</a>` |
| after | 삭제 |

> 근거: `/billing` 에는 결제 수단이 없어(웹 PG 미연동) 눌러도 상태 표시 화면으로만 이동했다 —
> 뒤에 결제가 없는 구매 유도 CTA 다. 요금제 상태 표시(칩 + 안내)는 남는다.
> `/billing` 은 좌측 내비게이션으로 여전히 도달한다.

### 3-3. `/billing/cancel` 고아 라우트 삭제 (작업 7)

`apps/teacher/src/app/billing/cancel/page.tsx` — **링크 0건**(실측) 확인 후 `git rm`.
남은 `apps/teacher/src/app/billing/page.tsx` 는 그대로다.

⚠️ 삭제 후 `typecheck` 가 `.next/types/validator.ts` 에서 삭제된 라우트를 참조해 실패했다.
Next.js 가 생성한 **캐시 잔재**이므로 `.next` 를 지우고 재빌드해 해소했다(빌드 산출물, git 무관).

### 3-4. 잠금 암시 문구 (작업 8 · teacher)

| 위치 | before | after | 판단 |
|---|---|---|---|
| `packages/shared/src/parentReport.ts:449` | `"무료 플랜은 자동 그래프 없이 직접 쓴 코멘트로 보내요. **구독하면 공부량·수행률 그래프가 리포트에 들어가요.**"` | 뒷문장 삭제 | 제거 — 결제 수단이 없어 구독을 시작할 방법이 없다. 없는 경로를 조건으로 내걸면 안 된다. 사실 서술만 남겼다 |
| `apps/teacher/src/app/m6.tsx:123` | `"구독 시작은 결제 연동(**Stripe**) 후 이 화면에서 할 수 있어요."` | 벤더명만 삭제 | 부분 제거 — 과외쌤 결제는 **웹 국내 PG** 로 확정됐다. 정해지지 않은 사업자 이름을 적으면 그 순간 거짓이다 |
| `apps/teacher/src/app/m6.tsx:120,122` | `"해지·일시정지는 결제 연동 후 …"` / `"미납 복구는 결제 연동 후 …"` | 유지 | **검토 후 유지** — 미연동 사실을 정확히 말하는 안내다. 약속이 아니라 현재 상태 설명이며, 웹 PG 는 확정된 채널이다 |
| `apps/teacher/src/app/m1.tsx:372,671` · `m6.tsx:114` | `학생당 4,900원` / `예상 월 청구 = active N명 × 4,900원` | 유지 | **검토 후 유지** — 교사 결제는 웹 PG 로 확정됐고 스토어 심사 대상이 아니다. 우리가 정한 가격이라 앱에 두는 것이 정본이다 (작업 1 은 학생 프리미엄으로 한정된 지시였다) |

`parentReport.ts` 문구 변경으로 기존 단정이 깨졌다:
`parentReport.test.ts:309` 가 `expect(free.notice).toContain("구독")` 이었다 →
`not.toContain("구독")` 으로 뒤집고 이유를 주석에 적었다. **유도 문구가 다시 들어오면 이 테스트가 잡는다.**

---

## 4. 변경 파일

| 파일 | 성격 |
|---|---|
| `apps/student/src/m6Screens.tsx` | 가격·혜택 목록·스토어 해지 안내·광고 권유 제거 |
| `apps/student/src/m5Screens.tsx` | 구독 CTA·힌트 제거, 미사용 import 정리 |
| `apps/teacher/src/app/m5.tsx` | "구독 시작" 버튼 제거 |
| `apps/teacher/src/app/m6.tsx` | Stripe 벤더명 제거 |
| `apps/teacher/src/app/billing/cancel/page.tsx` | **삭제**(고아 라우트) |
| `packages/shared/src/m5.ts` | 게이트 reason 2건 |
| `packages/shared/src/m6.ts` | `getTeacherBillingState("none").reason` |
| `packages/shared/src/parentReport.ts` | 리포트 게이팅 notice |
| `packages/shared/src/parentReport.test.ts` | 단정 반전 + 이유 |

**추가한 버튼·링크·약속: 0건.** 새로 만든 문구는 `"준비 중"` 과 `"현재 구독 중이 아니에요."`
두 개뿐이고, 둘 다 기능·가격을 약속하지 않는 중립 표시다.

---

## 5. 검증

| 항목 | 결과 |
|---|---|
| `lint` (shared · student · teacher) | green |
| `typecheck` (3개) | green (`.next` 캐시 정리 후) |
| `test` | **343 passed / 32 files** |
| `build` (teacher · `.next` 삭제 후 전체 재빌드) | green |
| 학생 앱 가격 표시 | `PRICE_STUDENT_PREMIUM_KRW` 참조 **0건** |
| `/report` 진입점 | **0건** (유지) |
| `/billing/cancel` | 라우트 삭제됨 |
| 잔여 잠금 암시 문구 | 표시 문자열 **0건** (검색 결과는 전부 제거 이유를 적은 주석) |
| `apps/teacher-mobile/` | 변경 **0줄** |
| 서버·마이그레이션 | 변경 **0건** |

---

## 6. 남겨 둔 것과 이유 (판단이 필요한 항목)

| 항목 | 왜 남겼나 |
|---|---|
| `pricing.ts` 의 `PRICE_STUDENT_PREMIUM_KRW = 8900` | AI 검사 한도 예산 계산에 쓰인다(표시 아님). 지우면 예산 근거가 사라진다 |
| 교사 웹의 4,900원 표시 3곳 | 웹 PG 확정 채널이고 스토어 심사 대상이 아니다. 작업 1 은 학생 프리미엄 한정 지시였다 |
| `m6.tsx` 의 "결제 연동 후 …" 3문장 | 미연동 사실을 정확히 말하는 상태 설명. 약속이 아니다 |
| `getTeacherBillingState` 의 `restricted: true` | 값을 바꾸면 소비 화면 동작이 바뀐다 — 문구 작업 범위를 넘는다 |
| `/subscribe` · `/settings/subscription` 화면 자체 | 상태 조회 화면으로서 유효하다. 지시는 문구 제거였고 화면 삭제는 아니다 |

## 7. 확인 불가 항목

| 항목 | 이유 |
|---|---|
| 변경된 문구의 실제 화면 렌더 | 학생 앱은 Expo 웹으로 띄울 수 있으나 이번엔 문구 치환만이고 로직 변경이 없어 빌드·타입 검증으로 갈음했다. 교사 웹도 동일 |
| 스토어 메타데이터의 실제 가격 | IAP 상품이 등록돼 있지 않다(`docs/LAUNCH-CHECKLIST.md` C1). 등록 후 스토어 값이 정본이 된다 |
