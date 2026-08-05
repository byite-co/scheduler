# 쌤플래너 — Codex 핸드오프 레포

> **이 레포 = 쌤플래너(scheduler).** Supabase 원격 프로젝트는 **`khssgcagudjimrezebxq`** 하나뿐이다.
> 이 컴퓨터에는 다른 제품(**쌤버십**)의 Supabase 프로젝트가 함께 있고 CLI 토큰이 조직 전체에 접근된다.
> 원격 명령은 맨손 `supabase` 대신 **`pnpm sb ...`** 를 쓴다(가드가 대상을 검사하고 어긋나면 중단).
> 세션 시작 시 `pnpm sb:check` 로 link 대상을 확인해라. 자세한 규칙: [docs/PROJECT-GUIDE.md](docs/PROJECT-GUIDE.md) §0-2

독립 과외쌤–학생 입시 공부관리 앱. **이 레포 하나로 Codex가 처음부터 끝까지 구현**하도록 기획·설계·화면이 모두 들어 있다.

---

## 0. 5단계 셋업 (이대로만 하면 됨)
1. **(선택) 스택 확정** — 기본값(아래 §2)으로 갈 거면 건너뛴다. 바꾸려면 `AGENTS.md §1`을 먼저 수정.
2. **기획서 보강(선택)** — `docs/PRD.md`는 이미 실질 내용이 채워져 있다. 별도 원본 기획서가 있으면 append.
3. **Supabase 준비** — Supabase 프로젝트 생성 → `.env.example`를 `.env`로 복사해 값 채우기 → (로컬은 `supabase start` → `supabase db reset`로 `supabase/schema.sql` 적용).
4. **GitHub에 push** — 이 레포 전체를 빈 GitHub 레포에 올린다(`docs/ui-catalog/`의 PNG 215개 포함).
5. **Codex 실행** — `CODEX_KICKOFF.md` 안의 코드블록을 **Codex 첫 메시지로 붙여넣기**. 이후 마일스톤마다 PR이 올라오면 리뷰→머지.

> 키(Anthropic/Stripe/RevenueCat 등)는 실연동 단계에서만 필요. 그 전까지 Codex는 mock/스텁으로 진행한다.

---

## 1. 레포 구성
```
README.md                 ← (이 문서) 시작점
AGENTS.md                 ← 에이전트 설정·절대 규칙·디자인 토큰·작업 방식
MILESTONES.md             ← 작업 순서 M0~M8 + 수용 기준(✅)
CODEX_KICKOFF.md          ← Codex에 붙여넣을 첫 메시지
.env.example              ← 환경변수 템플릿(실제 값은 .env)
docs/
  PRD.md                  ← 왜/무엇(제품 정의)
  user-flow.md            ← 화면 간 흐름·분기(텍스트)
  screen-route-map.md     ← 화면코드 ↔ 라우트 ↔ 상태/데이터
  ui-catalog/             ← 화면 PNG 215개(기기별) — 시각/카피/상태 진실 소스
  _flow_student.html / _flow_teacher.html / _catalog.html  ← 사람이 보는 시각 보고서(참고용)
supabase/schema.sql       ← 데이터 모델 + RLS
.github/workflows/ci.yml  ← lint·typecheck·test·build
(이후 Codex가 생성) packages/* , apps/student , apps/teacher , supabase/migrations , supabase/functions
```

## 2. 사전 결정 (Codex는 이걸 '결정됨'으로 보고 질문하지 않음)
한 방 통과를 위해 자주 묻게 되는 선택지를 미리 못 박았다. 바꾸려면 이 README와 AGENTS.md를 수정.
- **스택**: 모노레포(pnpm+Turborepo) · 학생=Expo(RN)+TS+Expo Router · 과외쌤=Next.js(App Router)+TS+Tailwind · 백엔드=Supabase · AI=Anthropic API(Edge Function) · 결제=학생 IAP(RevenueCat)/과외쌤 Stripe.
- **상태/데이터**: TanStack Query + Supabase 클라이언트. 타입은 Supabase 생성 타입(`packages/shared`).
- **집중 모드 카메라(가장 까다로운 네이티브)**: `react-native-vision-camera` + 프레임 프로세서로 얼굴/눈 랜드마크 기반 졸음 추정(또는 MediaPipe FaceLandmarker 네이티브 모듈). **포그라운드 전용 · 프레임/영상 미업로드 · 메타데이터만 저장.** 이 부분은 기기 의존이 커서 *유일하게 반복(iteration)이 예상되는 영역* — M3에서 우선 스파이크 후 구현.
- **AI 모델**: Edge Function에서 Anthropic API 사용(숙제검사=비전 입력). 모델 문자열은 `.env`/상수로 분리.
- **테스트**: 단위=vitest/jest, e2e=과외쌤 Playwright·학생 Maestro(또는 Detox).
- **정책 기본값**: 과목=수학/영어/국어/과학/사회/기타 · 리포트 주기=weekly/biweekly/none · 보호자 동의=만 14세 미만 · 가격=학생 ₩2,900/월, 과외쌤 연결 학생당 ₩2,900/월.

## 3. 절대 규칙 (요약 — 상세 `AGENTS.md §2`)
시크릿 커밋 금지 · 모든 테이블 RLS · **집중 모드 영상은 기기를 떠나지 않음** · 가격 상수화 · **"앱 구독료" ≠ "수업·수업료(수기)"** · AI 검사는 채점 아님 · 디자인 토큰만 · 만14세 미만 보호자 동의 · 회원 탈퇴 제공 · **마일스톤마다 PR 후 사람 리뷰**.

## 4. 진실 소스 우선순위
화면(시각/카피/상태)=`docs/ui-catalog/` · 흐름=`docs/user-flow.md` · 라우트=`docs/screen-route-map.md` · 정책=`docs/PRD.md` · 기술/순서=`AGENTS.md`·`MILESTONES.md`.

## 5. 한 방 통과 팁
- Codex가 **마일스톤 단위 PR**을 열 때마다 가볍게 리뷰만 해주면 됩니다(전체를 한 번에 보지 말 것).
- PR이 막히면(질문/실패) 그 마일스톤만 짚어 답을 주면 이어서 진행합니다.
- 실연동(결제·푸시·AI)은 M4·M6쯤 키를 준비하면 됩니다. 그 전 마일스톤은 mock으로 끝까지 갑니다.
- 화면이 PNG와 어긋나면 "해당 코드의 ui-catalog PNG에 맞춰라"라고 한 줄이면 됩니다.

> 현실 점검: Codex는 강력한 골격/MVP를 자율로 만들지만, *완성된 프로덕션*은 마일스톤별 리뷰·반복으로 닫힙니다. 당신은 아키텍트/PM, Codex는 빠른 구현팀입니다.
