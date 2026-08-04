# AGENTS.md — 쌤플래너 (Ssamplanner)

> Codex/에이전트가 **가장 먼저** 읽는 파일입니다. 작업 시작 전에 이 문서 전체를 읽고,
> 여기 적힌 스택·구조·규칙·금지사항을 반드시 따르세요. 충돌 시 이 문서가 우선합니다.

---

## 0. 한 줄 요약 / 제품 취지
독립 과외쌤과 학생을 잇는 **입시 공부관리 앱**. 학생은 *열품타급 습관 앱*으로 공부하고,
과외쌤은 *데스크톱형 관리도구*로 숙제·검사·리포트를 운영한다. 핵심 차별점:
① 공부 타이머·연속(streak) 습관 ② **AI 완료검사**(통과/미흡/애매 — 채점이 아니라 "다 했는지" 확인)
③ 입시데이터 기반 **AI 공부량 추천** ④ **AI 리포트 초안** ⑤ **집중 모드**(온디바이스 졸음 감지, 포그라운드 전용, 영상 미업로드)
⑥ 쌤버십(멘토 마켓) 환류. 자세한 기능 정의는 함께 제공된 **기획서**와 **유저/워크플로우 보고서**, **화면 카탈로그(UI 총집본)** 참조.

---

## 1. ⚠️ 시작 전에 사람에게 확인할 것 (STACK 확정)
아래는 **권장 기본값**이다. 사람이 명시적으로 바꾸지 않으면 이대로 진행하되,
첫 작업(M0) 시작 전에 이 선택이 맞는지 한 번 확인 질문을 남겨라.

- **학생 앱**: Expo (React Native) + TypeScript + Expo Router → iOS/Android + 태블릿.
  - *이유*: 집중 모드의 **온디바이스 카메라/졸음 감지**(포그라운드, 무업로드)는 네이티브가 필수.
- **과외쌤 앱**: Next.js (App Router) + TypeScript + Tailwind → 데스크톱 우선, 태블릿/모바일 반응형.
- **백엔드**: Supabase (Postgres · Auth · Storage · Realtime · Edge Functions(Deno)).
- **AI**: Anthropic API(Claude)를 **Supabase Edge Function 안에서** 호출(키는 서버에만).
- **결제**: 학생 프리미엄 = 모바일 IAP(RevenueCat 권장) / 과외쌤 앱 구독료 = 웹 결제(Stripe).
- **모노레포**: pnpm workspaces(+Turborepo). 구조는 §3.

> 사람이 "단일 코드베이스로" 원하면: 학생/과외쌤을 한 Expo 앱(+Expo Web)으로 통합 가능.
> 단, 과외쌤 데스크톱 밀도와 학생 네이티브 카메라를 둘 다 만족해야 함을 고지할 것.

---

## 2. 절대 규칙 (NON-NEGOTIABLE)
0. **프로젝트 격리 — 이 컴퓨터에는 다른 제품(쌤버십)의 Supabase 프로젝트가 함께 있다.**
   쌤플래너의 원격 ref 는 **`khssgcagudjimrezebxq`** 하나뿐이며,
   `lbeqxarxothkmzqvpudy`(ssambership-staging)·`wqaykrzfciznptntsvwl`(사내전산망)는
   **조회조차 금지**다. CLI 토큰이 조직 전체에 접근되므로 `--project-ref` 생략은 사고로 이어진다.
   → 원격 명령은 맨손 `supabase` 대신 **`pnpm sb ...`**(가드가 대상 검사 후 중단),
   세션 시작 시 **`pnpm sb:check`**. 전체 규칙·우회 경로는 `docs/PROJECT-GUIDE.md` §0-2·§0-3.
1. **시크릿 금지**: API 키·서비스롤 키·Stripe 키·Anthropic 키를 코드/레포에 절대 커밋하지 않는다.
   `.env.example`만 만들고 실제 값은 사람이 채운다. 서버 키는 Edge Function 환경변수로만.
2. **RLS 필수**: 모든 테이블에 Row Level Security. 학생은 본인 데이터만, 과외쌤은 **연결된(active)**
   학생의 데이터만, 그것도 학생이 **공개 설정(disclosure)**한 범위만 본다. 학부모는 리포트
   `share_token`으로만(인증 없이, 토큰 범위 한정) 접근. 자세한 정책은 `supabase/schema.sql` 주석 참조.
3. **프라이버시(집중 모드)**: 졸음 감지 카메라 프레임/영상은 **기기를 떠나지 않는다**. Storage·서버로
   업로드 금지. 저장하는 것은 메타데이터(집중률·졸음 횟수·점검 시각)뿐. UI엔 "영상은 기기를 떠나지 않아요" 노출.
4. **아동/미성년 안전 + 개인정보(PIPA)**: 만 14세 미만은 가입/연동 시 **보호자 동의** 플로우. 회원 탈퇴·데이터
   삭제 화면 제공(영구 삭제·복구 불가 고지). 미성년자 대상 부적절 콘텐츠 없음.
5. **가격은 하드코딩하지 말고 상수/설정으로**: 학생 프리미엄 ₩2,900/월 · 과외쌤 **연결 학생당 ₩2,900/월**.
   과외쌤 월 청구액 = `count(active connections) × 2900`. 단일 상수 `PRICE_PER_STUDENT_KRW = 2900` 등으로.
6. **"앱 구독료" ≠ "수업·수업료"**: 과외쌤이 *우리에게* 내는 앱 구독료(Stripe 처리)와, 학생이 *과외쌤에게*
   내는 과외비(수업·수업료, **수기 트래커일 뿐 결제 처리 아님**)는 **완전히 다른 모듈**. 절대 섞지 말 것.
7. **AI 완료검사는 채점이 아니다**: 결과는 통과/미흡/애매 + 확신도 + 사유. "맞았다/틀렸다"가 아니라 "다 했는지".
8. **병합 전 사람 리뷰**: 마일스톤마다 PR을 열고 멈춰서 리뷰를 받는다(§6). 한 번에 전부 머지 금지.

---

## 3. 레포 구조 (목표)
```
/
├─ AGENTS.md                  # 이 문서
├─ MILESTONES.md              # 단계별 작업 + 수용 기준 (작업 순서의 진실)
├─ docs/
│   ├─ PRD.md                 # 기획서(제공본 반영)
│   ├─ user-flow.md           # 유저/워크플로우 보고서(제공본 반영)
│   └─ ui-catalog/            # 화면 카탈로그(UI 총집본) PNG — 시각적 진실 소스
├─ packages/
│   ├─ shared/                # 공용 TS 타입(Supabase 생성), supabase 클라이언트, 공용 유틸
│   └─ design-tokens/         # 색·타이포·radius 토큰(§5) — 양 앱이 import
├─ apps/
│   ├─ student/               # Expo (RN) — 학생 모바일/태블릿
│   └─ teacher/               # Next.js — 과외쌤 데스크톱/태블릿/모바일
├─ supabase/
│   ├─ schema.sql             # 스키마 + RLS (제공본)
│   ├─ migrations/            # 이후 변경은 마이그레이션으로
│   └─ functions/             # Edge Functions: ai-homework-check, ai-study-rec, ai-report-draft, billing/*
└─ .github/workflows/         # CI: lint · typecheck · test · build
```

---

## 4. 명령어 (작업 전 반드시 통과시킬 것)
> 패키지 매니저는 **pnpm**. 실제 명령은 스캐폴딩 후 `package.json`에 정의하고 여기 갱신.

```bash
pnpm install
pnpm -w lint            # ESLint
pnpm -w typecheck       # tsc --noEmit (전 패키지)
pnpm -w test            # 단위 테스트(vitest/jest)
pnpm -w build           # 양 앱 빌드
# Supabase 로컬
supabase start
supabase db reset       # schema.sql + migrations 적용
# e2e (스캐폴딩 후)
pnpm --filter teacher test:e2e   # Playwright
pnpm --filter student test:e2e   # Maestro 또는 Detox
```
**PR을 열기 전에 `lint · typecheck · test`가 모두 green이어야 한다.** 실패하면 고치고 다시.

---

## 5. 디자인 시스템 (반드시 토큰으로, 임의 색 금지)
- **인디고 `#3D5AFE`** = 기본/브랜드/주요 액션.
- **불꽃 주황 `#FF6B3D`** = **"지금/시작/연속/긴급"에만**(공부 시작·타이머 작동·집중 모드 ON·streak·마감 임박). 남용 금지.
- 잉크 `#161A2E` · 서브텍스트 `#646B7D` · 캔버스 `#F5F7FB` · 성공 `#15A66B` · 경고 `#E0A100` · 위험 `#E2483B`.
- 폰트 **Pretendard**. 시간/숫자는 **tabular-nums**. 카드 radius ~18, 버튼 ~12.
- 칩·세그먼트·배지는 `white-space: nowrap`(두 줄 깨짐 금지).
- **이중 톤**: 학생 앱 = 따뜻·경쾌 / 과외쌤 앱 = 중립 프로 SaaS(Linear·Stripe 결).
- 화면의 시각적 진실은 `docs/ui-catalog/`(UI 총집본)다. 레이아웃·카피·상태는 그 PNG를 따른다.
- 접근성: 텍스트 대비 WCAG AA(4.5:1). 상태를 색만으로 전하지 말 것(아이콘/텍스트 병기).

---

## 6. 작업 방식 (에이전트 행동 규약)
1. **MILESTONES.md 순서대로** 진행한다(M0 → M1 → …). 한 마일스톤 = 한 단위.
2. 각 마일스톤은: 구현 → **테스트 작성** → `lint/typecheck/test` 통과 → **PR 1개** 열고 **멈춤**.
   PR 본문에 (a) 무엇을 했는지 (b) 어떤 수용 기준을 충족했는지 (c) 사람이 확인할 점을 적는다.
3. **제품 결정이 모호하면 멈추고 질문**한다(추측으로 진행 금지). 예: 미정의 정책, 누락 화면, 외부 키 필요.
4. 화면을 구현할 땐 항상 `docs/ui-catalog/`의 해당 PNG와 `docs/user-flow.md`의 흐름을 대조한다.
5. 데이터가 필요한 화면은 먼저 `supabase/schema.sql`의 테이블/RLS를 확인하고, 없으면 마이그레이션으로 추가(스키마 변경은 PR에 명시).
6. 외부 비용/부작용이 있는 것(결제·푸시·AI 호출)은 **개발용 mock/스텁** 우선, 실연동은 키가 준비된 뒤.
7. 큰 변경·아키텍처 전환은 먼저 짧은 계획을 PR/코멘트로 제안하고 승인받는다.
8. 커밋은 작게·의미 단위로. 비밀·대용량 바이너리 커밋 금지.

---

## 7. 핵심 도메인 규칙 (구현 시 자주 틀리는 것)
- **혼공생 vs 과외생 = 별도 앱이 아니라 연결 상태 차이**. `connections`에 active가 있으면 과외생.
  - 혼공생 홈: "선생님 숙제" 섹션 없음, "우리 반" 대신 또래 랭킹, 모든 할 일의 AI 검사는 **학생이 토글**.
  - 과외생 홈: 선생님 숙제 표시, 우리 반 표시.
- **AI 검사 여부 결정권**: 학생 본인 할 일 → 학생이 토글 / **선생님 숙제 → 선생님이 출제 때 결정(학생 잠금)**.
- **공개 범위(disclosure)는 학생이 통제, 과외쌤은 읽기 전용**. 과외쌤이 보는 학생 데이터는 disclosure로 필터.
- **AI 완료검사 결과**: 통과/미흡/애매 + 확신도 + 사유. 과외생은 선생님 코멘트 포함, **혼공생은 AI 단독**(선생님 언급 없음).
- **연결 핸드셰이크**는 한 번에 **하나의 상태**(pending/active/rejected) — UI에서 상태별 분기, 한 화면에 3개 동시 아님.
- **과외쌤 과금 = active 연결 수 × 2900**. 학생 연결 해제 시 다음 청구에서 감소. 미납 시 기능 제한 후 복구.
- **streak(연속)**: 하루 놓쳐도 비난 금지 톤. 회복 동선 제공.

---

## 8. 제공 문서(진실 소스 우선순위)
1. `docs/ui-catalog/` (UI 총집본) — **화면의 시각/카피/상태**.
2. `docs/user-flow.md` — **화면 간 흐름·분기**.
3. `docs/PRD.md` — **기능·취지·정책**.
4. 이 `AGENTS.md` + `MILESTONES.md` — **기술 규칙·작업 순서**.
충돌 시: 정책은 PRD, 흐름은 user-flow, 화면은 catalog, 기술/순서는 AGENTS/MILESTONES.

---

## 9. TODO (최종 UI 총집본 도착 후 갱신)
- [ ] `docs/ui-catalog/` 채우고 화면 코드 ↔ 라우트 매핑표 작성
- [ ] `docs/user-flow.md` 최신본 반영
- [ ] 스택 확정(사람 확인) 후 §1·§4 갱신
- [ ] 화면별 데이터 의존성 표(화면 → 테이블/엔드포인트) 작성
