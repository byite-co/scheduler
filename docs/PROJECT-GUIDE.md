# 쌤플래너 — 프로젝트 지침 및 컨텍스트

> 이 문서는 이 프로젝트에서 작업하는 코딩 도구(Claude Code, Codex 등)가 먼저 읽어야 하는 규칙 모음이다.
> 새 세션을 시작할 때 이 문서를 먼저 전달할 것.

---

## 0. 가장 먼저 확인할 것 (매 세션)

**저장소 확인 — 반드시 아래가 맞는지 검증하고 시작한다.**

- 저장소: `https://github.com/byite1226-a11y/scheduler` (private)
- 로컬 경로: `C:\dev\ssamplanner`
- 검증법: `git remote -v` 로 위 주소인지 확인. `package.json`의 name이 `ssamplanner`인지 확인.

⚠️ **주의:** 인근에 `byite-website`, `C:\dev\byite-site-files` 등 **무관한 저장소/폴더가 존재**한다.
과거에 실제로 엉뚱한 저장소에서 작업이 시작된 사고가 있었다. 확신이 없으면 멈추고 사람에게 물어볼 것.

---

## 0-2. DB 연결 확인 (매 세션, 반드시)

⚠️ **이 컴퓨터에는 두 제품이 동시에 진행 중이다: 쌤플래너(scheduler)와 쌤버십.**
Supabase 연결(MCP)이 여러 개 붙어 있을 수 있고, 이름이 `supabase` / `Supabase`처럼
구분이 어렵게 되어 있을 수 있다.

**DB 관련 작업(조회·스키마 변경·마이그레이션·RPC 실행) 전에 반드시:**

1. 사용하려는 연결이 **어느 프로젝트인지 확인**해라.
2. 쌤플래너의 Supabase 프로젝트 ID는 **`khssgcagudjimrezebxq`** 다.
   이것이 아니면 **절대 사용하지 마라.**
3. 확신이 없으면 진행을 멈추고 사람에게 물어봐라.
4. 쌤플래너 연결이 없거나 권한이 없으면, MCP를 쓰지 말고
   **레포의 스키마 파일(`supabase/schema.sql`, `supabase/migrations/`)과
   앱의 정상 경로(사용자 JWT로 접근)로 조사해라.** 실제로 이 방법만으로
   전체 스키마·RLS·트리거 조사가 가능했다.

**⚠️ 실제 사고 직전 사례 (2026-08):**
연결된 Supabase MCP 2개가 **모두 쌤플래너가 아니었다.** 하나(`fa5d1e4e`)는
mentor_directory·community·payout 테이블을 가진 **쌤버십으로 추정되는 다른 제품 DB**였고,
다른 하나(`7579a1ae`)는 쌤플래너에 권한이 없었다. 조사 중 알아채고 즉시 손을 뗐기에
망정이지, 눈치채지 못했다면 **다른 서비스의 운영 데이터를 변경할 뻔했다.**

---

## 0-3. Supabase CLI — 프로젝트 격리 (2026-08-05 설치)

MCP만 위험한 게 아니다. **CLI에 저장된 토큰이 조직 전체 접근권을 갖는다.**
`supabase projects list` 에 세 프로젝트가 모두 보인다:

| ref | 프로젝트 | 판정 |
| --- | --- | --- |
| `khssgcagudjimrezebxq` | **scheduler (쌤플래너)** | ✅ 유일하게 허용 |
| `lbeqxarxothkmzqvpudy` | ssambership-staging | ⛔ 절대 금지 (다른 제품) |
| `wqaykrzfciznptntsvwl` | 사내전산망 | ⛔ 절대 금지 |

### 규칙
1. **원격 명령은 맨손 `supabase` 대신 `pnpm sb ...` 를 쓴다.**
   가드(`scripts/supabase-guard.mjs`)가 실행 **전에** 대상을 검사하고, 어긋나면
   아무 명령도 내보내지 않고 중단한다. 예) `pnpm sb migration list --linked`
2. **`--project-ref` 를 생략하지 마라.** 생략하면 link 대상이 쓰이는데, link 는
   `supabase/.temp/project-ref`(gitignore, **머신별**)에 있어 새 clone 에는 없다.
3. **세션 시작 시 `pnpm sb:check`** 로 link 대상을 확인한다.
4. 쌤버십 프로젝트에는 **조회조차 하지 마라.**

### 가드가 막는 것 (전부 실측 확인)
- 인자에 금지 ref 등장 — `--project-ref X` / `--project-ref=X` 양쪽
- `--project-ref` 가 허용 ref 와 불일치
- link 대상이 쌤플래너가 아님 (쌤버십으로 오염 / 제3의 ref)
- link 자체가 없음 (새 clone 에서 원격 명령 시도)

### 가드가 막지 못하는 것 (알고 있어야 한다)
- **맨손 `supabase ...` / `pnpm exec supabase ...`** — 가드를 우회한다. `pnpm sb` 습관화가 유일한 방어.
- **MCP 연결** — 별개 경로다. §0-2 규칙을 따로 지켜야 한다.
- **Supabase 웹 대시보드** — 프로젝트를 눈으로 골라야 한다.
- **직접 DB 접속**(psql / pooler URL) — 가드를 지나지 않는다.

### 로컬 vs 원격 식별자 혼동 주의
`supabase/config.toml` 의 `project_id = "ssamplanner"` 는 **로컬 도커 스택 이름**이고
원격 ref 가 아니다. 여기를 ref 로 바꿔도 원격 타겟팅에는 아무 영향이 없다.
원격 대상을 결정하는 것은 `supabase/.temp/project-ref` 뿐이다.

---

## 1. 프로젝트가 무엇인가

쌤플래너는 **과외 선생님과 학생을 하나의 학습 흐름으로 연결하는 서비스**다.
학생이 앱으로 공부하면 그 데이터가 자동으로 과외 선생님에게 전달되어 **학부모 리포트**로 완성된다.

**핵심 차별점:** 경쟁 서비스(레슨노트, 학원관리 프로그램)는 선생님이 모든 항목을 수기 입력해야 한다.
쌤플래너는 학생이 앱을 쓰는 것만으로 데이터가 자동 축적되고, 선생님은 맥락(코멘트·다음 계획)만 더한다.
이 "자동으로 흘러가는 데이터"가 제품의 본질이므로, 이를 훼손하는 설계는 지양한다.

---

## 2. 기술 구조

### 모노레포 구성
```
C:\dev\ssamplanner
├── apps/student    — Expo / React Native, 모바일, dev 포트 8081
├── apps/teacher    — Next.js, 데스크탑 웹, dev 포트 3000
└── (shared 등 공용 모듈)
```

- 패키지 매니저: **pnpm** (npm 아님)
- Node: **22 LTS**
- 백엔드: **Supabase** (프로젝트 `khssgcagudjimrezebxq`, Seoul 리전) — 두 앱이 공유
- 실행: 루트에서 `pnpm dev`

### 환경변수 — 중요한 함정
**루트 `.env` 하나로는 동작하지 않는다.** Next.js와 Expo가 각자 자기 디렉터리의 `.env`만 읽는다.
앱별로 `.env` 파일이 필요하다:
- `apps/teacher/.env` → `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` 등
- `apps/student/.env` → `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` 등
- 루트 `.env`, `.env.local` → 통합 테스트용 토큰 등

정확한 변수명은 반드시 `.env.example`에서 확인할 것. 추측하지 말 것.

⚠️ README §0-3은 "`.env.example`을 `.env`로 복사"라고만 안내하는데 실제로는 앱별 파일이 필요하다.
(README와 실제가 어긋나 있음 — 다음 사람이 같은 데서 막힐 수 있음)

---

## 3. 절대 원칙 (어기면 안 되는 것)

### 3-1. 프라이버시
- **집중 모드 카메라:** 얼굴 이미지/프레임은 **기기를 절대 떠나지 않는다.** 저장·업로드·클라우드 전송 금지.
  온디바이스에서 숫자(눈 감김 정도, 고개 각도)만 추출하고 이미지는 즉시 폐기한다.
  저장하는 것은 판정 결과(참/거짓)와 시각뿐이다.
- **또래 비교:** 익명 집계만. 최소 5명 이상일 때만 노출. 개인 식별 불가해야 한다.
- **과외쌤의 학생 데이터 접근:** `active` 연결 상태 + 학생이 허용한 공개 범위 내에서만 read 가능.
  RLS로 강제되어야 하며, 학생이 공개하지 않으면 교사는 볼 수 없다.

### 3-2. AI 사용 원칙
**"AI는 감독관이 아니라 조수다."** 모든 AI 기능에 공통 적용한다.
- AI는 1차 정리·초안 작성까지만 한다.
- 최종 판단(통과/미흡, 리포트 발송 승인)은 항상 사람(과외쌤 또는 학생 본인)이 내린다.
- AI가 확신할 수 없는 것은 단정하지 말고 "확인 필요"로 사람에게 넘긴다.
- AI가 사실을 지어내거나 데이터를 왜곡하지 않도록 프롬프트에 명시적으로 제약한다.

#### 🚨 AI 숙제검사 판정 노출은 현재 **차단**되어 있다 (2026-08-07)

플래그: `AI_CHECK_RESULTS_ENABLED` — `packages/shared/src/featureFlags.ts`, 기본값 **`false`**.
Edge Function 에 **같은 이름의 쌍둥이 상수**가 있고(Deno 는 shared 를 import 할 수 없다)
`m4.schema.test.ts` 가 두 값이 같은지 대조한다. **한쪽만 바꾸면 CI 가 깨진다.**

**왜 껐는가 — 실제 모의고사 사진 3장 실측(2026-08-07, 6회 호출):**
- 다 푼 지구과학 1페이지를 보고 **"3번, 4번, 5번이 미작성 상태입니다"** 를 `confidence 0.95` 로 냈다.
  실제로는 1~5번 전부 답이 표기돼 있었다(확대 대조 확인).
- 인쇄된 문제 지문의 소제목(`[실험 목표]`, `[실험 과정]`)을 **빈칸이라고 단정**했다.
- **6회 전부 `confidence` 가 0.95** 였다. 틀린 2건도 0.95다 → 이 값에는 신호가 없다.
- **`ambiguous` 로 넘긴 적이 0회.** "확신할 수 없으면 ambiguous" 안전장치가 발동하지 않는다.
- 파일명 기대(오답 지목) 대비 0/6, 프롬프트 설계 기준(완료 여부) 대비 4/6.

프롬프트 문구를 다듬는 문제가 아니다 — **출력 구조를 바꿔야 한다**(문제별 표기 유무 + 근거를
구조화해서 받고 서버가 검증). 그 전까지 판정을 사용자에게 보여주지 않는다.

**꺼진 동안의 동작:**

| | |
| --- | --- |
| 학생 사진 제출·업로드 | **그대로 동작** |
| AI 검사 호출 | **하지 않는다**(비용 0). 클라이언트가 호출을 건너뛰고, Edge Function 도 `ai_check_paused`(503)로 스스로 거절 |
| 학생 화면 | 판정 대신 "제출됐어요…" 안내. 혼공생은 선생님 언급 없는 별도 문구 |
| 과외쌤 화면 | 판정 배지·확신도·사유 없음. 통과/미흡/애매 집계 카드도 숨김(0건으로 보이면 오독한다) |
| 과외쌤 사진 열람 | **그대로 동작** |
| 저장된 `homework_check_attempts` · `homework_submissions.ai_*` | **지우지 않는다.** 표시만 막는다 |

**되돌리는 절차(재설계 후):**
1. 출력 구조 재설계 + 실사진 테스트 세트로 정확도 재측정. 최소한 **진짜 빈칸이 있는 사진**이
   세트에 있어야 한다 — 이번 3장에는 없어서 `insufficient` 정확도를 측정하지 못했다.
2. `packages/shared/src/featureFlags.ts` 의 상수를 `true` 로.
3. `supabase/functions/ai-homework-check/index.ts` 의 쌍둥이 상수도 `true` 로. (안 바꾸면 CI 가 잡는다.)
4. `pnpm sb functions deploy ai-homework-check` 로 재배포.
5. 양 앱 재배포.

⚠️ 3번을 빼먹으면 **화면에는 판정 자리가 생기는데 서버가 503 을 돌려주는** 상태가 된다.

### 3-3. 디자인 규칙
- 기본 색: **인디고 `#3D5AFE`**
- 강조 색: **불꽃 주황 `#FF6B3D`** — "지금 / 시작 / 연속 / 긴급" 의미에만 사용. 남용 금지.
- 아이콘: 학생 앱은 `@expo/vector-icons`(MaterialCommunityIcons), 과외쌤 앱은 `lucide-react`. 이모지 사용 금지.
- 빈 상태(empty state)는 통일된 컴포넌트 사용.

### 3-4. 가격 구조 (혼동 금지)
- **앱 구독료:** 과외쌤 → 쌤플래너. active 연결 학생 1인당 월정액.
- **수업료:** 학생 → 과외쌤. 쌤플래너와 무관, 과외쌤이 직접 수기 관리.
- **학생 프리미엄:** 학생 → 쌤플래너. 선택 구독.
- 이 셋은 **완전히 분리**되어야 한다. 상수는 `PRICE_*` 네이밍 사용.

**AI 검사 원가와 상품 한도(2026-08-07 재산정, 20260807020000):**
학생 프리미엄이 월 2,900원인데 AI 검사 1회 원가가 **실제 사진 1장 ≈ 4.4원 · 9장 ≈ 21.9원**이다(§4-7).
원가 예산은 매출의 30% = **870원/월**.

| 한도 | 값 | 근거 |
| --- | --- | --- |
| 최근 30일 호출 | **70회** | 정상 사용(월 25~30회)의 2배 이상 여유 |
| 최근 30일 사진 | **280장** | 원가는 사진 토큰이 지배한다 — 호출 수만 막으면 예산을 못 지킨다 |
| 하루 | **8회** | 버스트 방어. 정상은 하루 2~4회 |
| 같은 제출 재검사 | **3회** | 사진을 안 바꾼 재검사는 비용만 늘고 판정은 같다 |

⚠️ **호출 수만 제한하면 안 된다.** 사진 장수에 따라 1회 원가가 5배 차이 난다.
월 70회를 전부 9장으로 쓰면 1,533원(53%)이 되어 예산을 넘는다. 그래서 둘 다 제한한다 —
어떤 조합에서도 **26.4% 이하**다(`m4.schema.test.ts` 가 이 계산을 고정한다).

⚠️ **하루 한도만 두면 아무것도 못 막는다.** 하루 8회 × 30일 = 240회 > 월 70회이므로
월 한도가 실제 구속력을 갖는다. 이전 판(하루 50회 · 월 한도 없음)은 매일 최대치를 써서
월 33,000원까지 갈 수 있었다.

**이동 창(rolling 30일)을 쓰는 이유:** 달력 월로 끊으면 말일과 1일에 연속으로 최대치를
쓸 수 있다(이틀에 140회).

**한도 초과 안내는 `errorCode` 로 전달된다.** Edge Function 이 게이트·한도 응답에
`errorCode` 를 담지 않으면 클라이언트(`body.errorCode`)가 코드를 못 읽어 전부
"확인 중 문제가 생겼어요"(unknown)로 표시된다 — **실제로 그 상태였고 한도 안내가 한 번도
보이지 않았다**(20260807 수정). 새 에러 응답은 반드시 `fail()` 헬퍼를 거쳐야 한다.

**숙제 사진 업로드 한도(20260807010000):**
최근 30일 **1,000장 / 1 GiB**(학생 1인). RLS INSERT 정책이 강제한다.

- **누적 상한이 아니라 이동 창이다.** 누적으로 걸면 보관 정리가 붙기 전에 정상 사용자가
  반드시 막힌다(하루 6장 쓰는 학생은 몇 년 뒤 업로드가 실패한다).
- 경로 규약(폴더 3단)과 **경로의 `todo_id` 가 내 할 일로 실재**할 것을 요구한다.
  `homework_submissions` 행은 요구할 수 없다 — 사진이 제출 행보다 먼저 올라간다.
- 판정 함수는 **`security definer` 여야 한다.** invoker 로 두면 `storage.objects` 정책이
  자기 자신을 평가해 `infinite recursion detected in policy` 가 난다.
  (마이그레이션은 `postgres` 로 실행되고 `postgres` 는 `rolbypassrls = true` 다.)
- 보관 180일. **실제 파일 삭제는 Storage API 가 필요하다** — `storage.objects` 행만 지우면
  파일은 남는다. 그래서 `homework_photos_expired_paths()` 는 목록만 돌려준다.
- ⚠️ **누적 총량은 아직 무제한이다.** 보관 정리 작업(계정 탈퇴 정리와 같은 수단)이 붙어야 닫힌다.

---

## 4. 알려진 함정

- **⚠️ 브랜치 base 를 확인하지 않으면 커밋이 main 에 안 들어간다 (2026-08-06 실제 사고):**
  PR #19(Haiku 전환)가 main 이 아니라 `feat/anthropic-homework-check` 로 머지됐다.
  PR #18 이 **12초 먼저** main 에 들어가면서, #19 의 base 가 이미 머지된 브랜치가 된 것이다.
  결과: **배포본은 Haiku인데 레포는 Sonnet 단가**였고, main 에서 재배포하면 비용 기록이 3배가
  된다. 커밋 이력만 보면 "머지됨"이라 드러나지 않았다 — 조사 중에 우연히 발견했다.
  - 브랜치를 딸 때 base 를 **명시**한다: `git checkout -B <name> origin/main`.
    현재 브랜치에서 `git checkout -b` 하면 base 가 우연에 좌우된다.
  - PR 을 만들 때 `--base main` 을 주고, 만든 뒤 `gh pr view <n> --json baseRefName` 으로 되읽는다.
  - 머지 전 `git merge-base --is-ancestor origin/main <branch>` 가 true 인지 본다.
    false 면 브랜치가 main 을 포함하지 않으므로 rebase 후 머지한다.
- **⚠️ Edge Function 을 배포했으면 배포본과 레포를 대조한다:**
  ```
  supabase functions download ai-homework-check --use-api --workdir <빈 디렉터리>
  ```
  `--output-dir` 은 없고 기본 동작이 **작업 트리를 덮어쓴다** — 반드시 `--workdir` 로 딴 데 받는다.
  위 12초 사고는 이 절차가 있었다면 그 자리에서 잡혔다.
- **⚠️ `String.replace` 의 치환 문자열에서 `$$` 는 리터럴 `$` 다:**
  SQL 을 스크립트로 조립할 때 달러 인용(`$$ ... $$`)이 전부 `$` 로 깨진다(schema.sql 을 한 번
  깨뜨렸다). 치환 **함수**를 써라: `s.replace(a, () => b)`.
- **Slot 패턴:** `<Link asChild>` 의 자식에 style 배열을 넘길 때 `StyleSheet.flatten` 필수.
- **`apps/teacher/next-env.d.ts`:** Next.js가 자동 생성하는 파일. `build`/`dev` 중 뭐가 마지막에 돌았냐에 따라
  내용이 바뀐다. 수정하지도, 커밋하지도 말 것.
- **turbo 캐시:** 검증 시 캐시 히트로 실제 실행이 안 될 수 있다. 진짜 검증이 필요하면 `--force`로 캐시 우회.
- **타입 캐스팅으로 라우트 검사 우회 금지:** 기존 코드 곳곳에 `as Href` / `as never` 캐스팅이 있고,
  이것이 존재하지 않는 라우트로 가는 끊긴 링크를 컴파일 단계에서 숨겨왔다.
  새로 만드는 링크에는 캐스팅을 쓰지 마라.
- **RLS 통합 테스트는 토큰이 없으면 조용히 skip 된다:** `*.rls.integration.test.ts` 는 루트
  `.env.local` 의 `SUPABASE_PROJECT_REF` **와** `SUPABASE_ACCESS_TOKEN` 이 **둘 다** 있어야
  실행된다(`describeIfRemote` 게이팅). 토큰이 비면 skip 되면서도 `pnpm test` 는 green 이라
  **RLS·트리거·권한이 검증되지 않았다는 사실이 드러나지 않는다.**
  - **2026-08-06 토큰 설정 완료** → 8건이 실제로 실행된다(shared 133 passed / **0 skipped**).
    그 전에는 `scope_text` 의 `btrim` 버그처럼 이 테스트가 잡아야 할 것을 별도 실계정
    검증에서야 발견했다.
  - 토큰이 비었는지 확인: `pnpm test` 출력에 `skipped` 가 있으면 게이팅이 걸린 것이다.
- **⚠️ turbo 캐시가 검증을 무력화한다:** `pnpm test` 가 캐시 히트면 실제 실행이 안 된다.
  진짜 검증은 `pnpm exec turbo run test --force` 로 해라.
  (`pnpm test --force` 는 pnpm 이 먹어서 `Unknown option: 'force'` 가 난다.)
- **Edge Function 은 turbo typecheck 에 안 잡힌다:** Deno 코드라 별도다. `pnpm check:functions` 로
  검사하고, CI 에도 그 단계가 있다. 자세한 내용은 §4-7.

---

## 4-2. DB 구조 현황 (2026-08 조사 결과)

### 주요 테이블
- **`todos`** — 과외쌤 숙제와 학생 할 일이 **같은 테이블**, `source`('self'|'teacher')로 구분.
  주요 컬럼: `student_id`, `connection_id`(교사 숙제만), `title`, `subject`, `source`,
  `ai_check_enabled`, `scope_text`, `locked`, `due_date`, `status`, `created_by`
  - **`scope_text`** — AI 숙제검사가 제출 사진과 대조할 **수행 범위 원문**(20260806010000 추가).
    자세한 규칙은 아래 "4-3. `todos.scope_text`" 참고.
  - ⚠️ **`created_by` 에 ON DELETE 절이 없다**(= NO ACTION). `connections.requested_by` 도 같다.
    그래서 교사가 만든 숙제 행이 남아 있으면 교사 프로필을 지울 수 없다. 게다가 Postgres 는
    FK 트리거를 **제약 이름 알파벳순**으로 실행하므로, 같은 행을 CASCADE·NO ACTION 양쪽으로
    참조할 때 NO ACTION 이 먼저 발동해 삭제가 막힌다(`connections_requested_by_fkey` <
    `connections_student_id_fkey`). 계정을 지우는 코드는 **순서에 의존하지 말고**
    `packages/shared/src/rlsTestCleanup.ts` 처럼 "지워지는 것부터 지우고 반복"해야 한다.
    이 함정 때문에 테스트 계정 55건이 원격에 쌓였고, `deleteUser` 실패를 확인하지 않아
    아무도 몰랐다.
- **`homework_submissions`** — 제출 기록. `photo_paths`, `teacher_status` 등
  - ⚠️ `ai_verdict`·`ai_confidence`·`ai_reason` 은 **원본이 아니라 "최신 완료 결과의 복사본"**이다
    (20260806040000 이후). 원본은 `homework_check_attempts` 다. 아래 "4-4" 참고.
- **`homework_check_attempts`** — **AI 검사 실행 레코드(원본)**. 상태·스냅샷·idempotency·
  토큰·비용을 남긴다. 쓰기는 service_role RPC 만. 아래 "4-4" 참고.
- **`student_subscriptions`** — 프리미엄 권한. `status`, `provider`, `expires_at`.
  RLS는 select만 허용, 쓰기는 definer RPC(mock)로만.
- **사용량/비용 기록**: `homework_check_attempts` 의 `input_tokens`·`output_tokens`·
  `estimated_cost_usd_micros` 에 남는다(스텁은 0). 집계 뷰는 아직 없다.

### 보호 장치 (작동 확인됨)
- `guard_student_todo_source_lock` 트리거 — **허용 목록(allowlist) 방식**(20260805000000).
  학생 UPDATE 는 teacher 행=`status`만 / self 행=`title`·`subject`·`due_date`·`status`·`ai_check_enabled`·`scope_text`.
  목록에 없는 컬럼은 **기본 잠김**.
  - **실제로 값을 했다:** `scope_text` 추가(20260806010000) 때 teacher 행은 목록에 넣지 않는 것만으로
    잠겼다. 금지 목록 방식이었다면 "열린 채로" 추가됐을 컬럼이다.
- `guard_homework_submission_fields` 트리거 — 인증 사용자가 `ai_verdict` 등 AI 필드 직접 쓰기 불가
  (학생 계정으로 위조 시도 → 서버가 거부하는 것을 실증 확인)
- 제출 사진 열람 — active 연결 + `share_homework_photos` 공개범위로 게이팅
- **구독 mock RPC 차단** — `mock_set_student_subscription`(20260805000000) ·
  `mock_set_teacher_subscription`(20260806000000) 모두 anon/authenticated/public 에서 회수.
  둘의 권한 형태를 동일하게 유지한다(한쪽만 다시 열리는 사고 방지 — 스키마 테스트가 검사).

### 개발/테스트에서 구독 상태 만들기

mock RPC 는 막혔고 앱 UI 에도 "상태를 바꾸는 버튼"이 없다(보안). 구독 상태가 필요하면:

```bash
node scripts/dev-set-subscription.mjs student <email> active
node scripts/dev-set-subscription.mjs teacher <email> past_due
# status: none | active | past_due | canceled | paused
```

**⚠️ 이 스크립트는 `SUPABASE_SERVICE_ROLE_KEY` 를 요구한다.**
- 그 키는 **RLS 를 전부 우회**한다 — 사실상 DB 관리자 권한이다.
- **앱 번들(`apps/*`)에 절대 넣지 마라.** `NEXT_PUBLIC_`/`EXPO_PUBLIC_` 접두사를 붙이면
  클라이언트로 배포돼 누구나 DB 전체를 읽고 쓸 수 있다.
- 루트 `.env` 의 `SUPABASE_SERVICE_ROLE_KEY` 로만 두고, 개발자가 로컬에서 직접 실행하는
  도구에서만 읽는다. 현재 이 값은 **미발급** 상태라 스크립트를 쓰려면 먼저 발급해야 한다
  (Supabase 대시보드 → Project Settings → API → service_role).

왜 RPC 가 아니라 테이블 직접 upsert 인가: mock RPC 들은 대상을 `auth.uid()` 로 정하므로
service_role(`auth.uid()` 가 null)로는 호출 자체가 안 된다(`authentication_required`).
service_role 은 RLS 를 우회하니 RPC 없이 구독 테이블에 직접 쓰면 된다.

영구 대체는 실연동 Edge Function(`iap-webhook` / `billing-stripe`)이며 별도 작업이다.

### ⚠️ 확인된 보안 구멍 (수리 필요)
1. ~~학생이 교사 숙제의 `title`·`subject`·`due_date`를 변경할 수 있다~~
   **→ 수리·원격 적용 완료**(20260805000000, 허용 목록 전환). 라이브 검증 7/7 통과.
2. ~~mock 구독 RPC 로 사용자가 스스로 유료 상태가 될 수 있다~~
   **→ 학생 20260805000000 · 과외쌤 20260806000000 으로 양쪽 회수 완료.**
3. ~~프리미엄 검증이 클라이언트에만 있고 `expires_at`을 보지 않는다~~
   **→ 수리 완료**(20260806050000). 서버 판정 함수 `has_active_student_premium()` 추가,
   Edge Function 이 슬롯 확보 전에 게이트, 클라이언트 게이트도 `expires_at` 반영.
   아래 "4-5" 참고.

### 미구현 (스텁 상태)
- ~~숙제 사진 실제 업로드/열람 코드~~ **→ 구현 완료**(20260806060000). 아래 "4-6" 참고.
- ~~`ai-homework-check` Edge Function 미배포·스텁~~ **→ 배포·실연동 완료**(2026-08-06). 위 "4-7" 참고.
- Storage 버킷 `homework-photos`(private) — 용량·개수·MIME 제한 없음

---

## 4-3. `todos.scope_text` — AI 검사 범위 (20260806010000)

`scope_text` 는 **"AI 가 제출 사진과 대조할 기준이 되는, 사용자가 입력한 수행 범위 원문"** 이다.

```
예) '쎈 112~118p, 115p 제외'  /  '영단어 Day 12~14'  /  '기출 21~30번, 26번 제외'
```

### ⚠️ `title` 과 혼동하지 마라 — 역할이 다르다

| | 용도 |
| --- | --- |
| `title` | 목록에 보이는 **할 일 이름**. 양쪽 앱의 목록 표시가 이걸 쓴다. |
| `scope_text` | AI 가 대조할 **검사 범위**. 목록에 안 보여도 된다. |

**일반 메모로 쓰지 마라.** "열심히 하자" 같은 내용이 들어가면 AI 가 그걸 검사 기준으로 삼는다.
메모가 필요하면 별도 컬럼을 만들어라.

### 규칙 (DB 가 강제한다)
- `text`, **NULL 허용** — NULL 은 "범위 미지정"이다.
- **공백 제외 500자** (`todos_scope_text_len` CHECK 제약).
- **빈 문자열·공백뿐인 입력은 NULL 로 정규화**된다(`guard_student_todo_source_lock` 트리거).
  "범위 없음"의 표현을 하나로 고정하기 위한 것 — `''` 와 NULL 이 섞이면 AI 검사 분기가 둘 다 다뤄야 한다.
- 앱 쪽 같은 규칙: `packages/shared/src/m2.ts` 의 `normalizeTodoScopeText` ·
  `validateTodoScopeText` · `TODO_SCOPE_TEXT_MAX_LENGTH`.
  **DB 와 앱 규칙이 갈라지면 앱이 통과시킨 값을 DB 가 거부해 날 오류가 사용자에게 보인다.**
  실제로 그렇게 됐다 — 20260806020000 은 `btrim(v)` 이 인자 하나면 **space 만** 지우는 탓에
  탭·개행뿐인 입력이 NULL 이 되지 않고 제약 위반으로 거부된 버그를 고친 것이다.
  공백 정의는 양쪽 모두 `\s`(space·tab·CR·LF·FF·VT)로 맞춰 두었다.

### 수정 권한 (의미는 같고 권한만 다르다)
- `source='teacher'` → **교사만** 수정. 학생은 불가(허용 목록에 없어 자동 잠김).
  학생이 바꿀 수 있으면 검사 범위를 자기에게 유리하게 좁혀 AI 검사를 무력화한다.
- `source='self'` → 학생이 수정 가능.
- 판정 헬퍼: `canStudentEditTodoScopeText({ source })`.

### 기존 데이터 이전
`ai_check_enabled=true` 인 행에만 **`title` 전체를 복사**했다(원격 3행 복사, 0행 미복사).
`title` 은 그대로 남겼다. **제목에서 범위를 자동 분리하지 않는다** — 문장 패턴 추출은 잘못
분리돼도 사람이 발견하기 어렵고, 그 오류가 AI 판정에 그대로 들어간다.

### UI (2026-08-06 추가)
| 화면 | 하는 일 |
| --- | --- |
| 과외쌤 `/homework/new` | 제목과 범위를 분리 입력. 카탈로그 B4 의 "범위 지정 · AI 완료검사 기준이 됩니다" 라벨·위치를 따랐다. AI 검사 ON 이면 필수(버튼 비활성) |
| 학생 `/todo/new`·`/todo/[id]/edit` | 범위 선택 입력. AI 검사 ON 이면 필수(저장 시 메시지) |
| 학생 `/homework/[id]/submit` | `검사 범위` 표시 — `getTodoScopeTextForDisplay` 로 scope_text 우선, 없으면 title |
| 과외쌤 `/homework/review` | 제목 아래 `검사 범위 · …` 표시 |

- **편집 화면에서는 title fallback 을 쓰지 않는다.** 빈 범위를 title 로 채워 보여주면 저장 순간
  title 이 범위로 복사돼 버린다. fallback 은 **읽기 화면에서만** 쓴다.
- 검사 화면(`/homework/review`)에도 범위를 넣은 이유: 제목과 범위를 분리한 뒤로는 제목만 보면
  검사자가 "무엇을 하기로 했는지" 알 수 없다. 분리 이전에는 제목에 범위가 섞여 있어 보였다.

### DB 제약 (2026-08-06)
`todos` 에 걸린 scope_text 관련 제약 2개 — **둘 다 DB 가 최종 방어선**이다. UI 만 막으면
PostgREST 직접 호출로 우회된다(이 레포에서 mock 구독 RPC 로 이미 겪은 유형).

| 제약 | 내용 | 마이그레이션 |
| --- | --- | --- |
| `todos_scope_text_len` | 공백 제외 1~500자 (하한 1 = "빈 문자열은 NULL" 불변식) | `20260806010000` |
| `todos_ai_check_needs_scope` | `ai_check_enabled = false or scope_text is not null` | `20260806030000` |

- 적용 시점 실측: `ai_check=true AND scope_text IS NULL` **0건** → `NOT VALID` 2단계 불필요.
- ⚠️ 앞으로 위반 행이 생겨 제약을 다시 걸어야 하면 **`scope_text` 를 `title` 로 자동 채우지 마라.**
  AI 의 대조 기준을 사람 모르게 바꾸는 일이다. `NOT VALID` 로 걸고 사람이 범위를 입력한 뒤 `VALIDATE`.
- 앱 쪽 같은 규칙: `isTodoScopeTextRequired` · `validateTodoScopeTextForSave`.

### 아직 안 한 것
- AI 검사가 이 값을 실제로 쓰는 로직(`ai-homework-check`)은 미구현.
- 혼공생 AI 검사 진입점·프리미엄 게이트 미구현(입력 칸과 필수 규칙까지만 있다).

---

## 4-4. `homework_check_attempts` — AI 검사 실행 레코드 (20260806040000)

**원본은 이 테이블이다.** `homework_submissions.ai_verdict/ai_confidence/ai_reason` 은
**최신 완료 결과의 복사본**(구버전 앱 호환용)이다. 두 앱이 새 테이블을 읽도록 전환한 뒤에
`ai_*` 제거를 판단한다 — 지금 지우면 학생 앱과 과외쌤 웹이 동시에 깨진다.

### 왜 만들었나
덮어쓰기 구조에서는 ① 재검사 시 이전 판정 소실 ② 상태(대기/처리중/완료/실패) 구분 불가
③ 중복 호출 차단 없음(실연동 시 중복 과금) ④ 무엇을 보고 판정했는지 기록 없음
⑤ 사용량·비용 측정 불가. 감사 로그가 아니라 **AI 호출의 실행 레코드**다.

### 라이프사이클 (전부 service_role 전용 RPC)
| RPC | 하는 일 |
| --- | --- |
| `start_homework_check_attempt(submission, requested_by, idempotency_key)` | 슬롯 확보 + **범위·사진 스냅샷 고정**. 같은 키 재전송이면 기존 행 반환, 같은 제출에 진행 중이면 `check_already_in_progress` |
| `complete_homework_check_attempt(attempt, verdict, confidence, reason, model, in/out tokens, cost)` | 완료 기록 + `submissions.ai_*` 캐시 갱신 |
| `fail_homework_check_attempt(attempt, error_code)` | 실패 기록(슬롯을 비워 재시도 가능) |

`requested_by` 를 `auth.uid()` 로 유도하지 않고 **인자로 받는다** — service_role 은
`auth.uid()` 가 null 이라 유도형이면 호출 자체가 불가능하다(mock 구독 RPC 에서 겪은 문제).

### 알아둘 함정
- **가드 트리거는 `before insert or update` 만이다.** cascade DELETE 는 호출자 컨텍스트
  (`auth.uid()` 존재)에서 실행되므로 DELETE 까지 막으면 **학생이 자기 제출을 못 지우고
  계정 탈퇴의 전체 cascade 도 깨진다.**
- **클라이언트 쓰기는 오류가 아니라 "0행 처리"로 조용히 끝난다.** Postgres RLS 는 UPDATE/DELETE
  정책이 없으면 대상 행을 하나도 고르지 않는다(INSERT 만 42501 을 낸다). 검증할 때 오류 유무가
  아니라 **값이 바뀌었는지**로 확인해야 한다.
- `array_length(빈 배열, 1)` 은 0이 아니라 **NULL** 이다. `coalesce` 없이 `between 1 and 9` 를
  쓰면 사진 0개가 그대로 통과한다.
- 비용은 `estimated_cost_usd_micros`(정수, 마이크로달러). 부동소수점 합산 오차를 피한다.

### `apply_homework_ai_verdict` 는 DEPRECATED
attempt 없이 `ai_*` 만 덮어쓰므로 이력이 남지 않는다. 시그니처가 `submission_id` 라
"어느 실행이 완료됐는지" 알 수 없어 확장하지 않고 남겨 뒀다(전환 기간). 호출자를 전부
`complete_homework_check_attempt` 로 옮긴 뒤 제거한다. 남아 있는 동안은 attempt 없이
`ai_*` 를 쓸 수 있는 경로이기도 하다 — service_role 만 부를 수 있어 감수 중이다.

---

## 4-5. AI 검사 서버측 게이트 (20260806050000)

**클라이언트 게이트는 안내용이고 실제 판정은 서버다.** 클라이언트 판정은 우회 가능하다.

### 구독 상태의 의미 — "이용 권리"로 정규화
결제 사업자(App Store/Google Play/Stripe)의 원본 상태값을 그대로 분기하지 않는다.
사업자마다 상태 이름과 개수가 달라, 원본으로 분기하면 사업자를 추가할 때마다 판정이 갈라진다.

| 상태 | 이용 권리 |
| --- | --- |
| `active` | 있음 |
| `past_due` · `paused` · `canceled` · `none` | 없음 |

- **자동 갱신을 취소했지만 결제 기간이 남았으면 `status=active` 를 만료일까지 유지한다.**
  즉시 `canceled` 로 바꾸면 이미 낸 돈만큼의 이용 권리를 빼앗는 것이 된다. 웹훅 구현 시 지켜야 한다.
- **`expires_at IS NULL` 은 권리 없음**(fail-closed). `expires_at > now()` 가 NULL 에 false 인 것을
  그대로 이용한다. 만료일을 모르는 구독을 무기한 프리미엄으로 다루면 결제 버그가 곧 무료 이용이 된다.

### 판정 함수
| 계층 | 함수 | 성격 |
| --- | --- | --- |
| DB | `has_active_student_premium()` | **권위** — 인자 없음(`auth.uid()` 만), SECURITY INVOKER, `authenticated` 만 실행 |
| shared | `hasActiveStudentPremium(subscription, now)` | 안내용. DB 와 **같은 규칙** |

인자로 `student_id` 를 받지 않는다 — 남의 구독 상태를 물어볼 이유가 없고, 인자가 있으면 그 자체가
정보 노출 경로다. `studsub_self` 정책이 본인 SELECT 를 허용하므로 DEFINER 가 필요 없다.
**service_role 로 부르면 `auth.uid()` 가 null 이라 항상 false** — 서버는 반드시 사용자 컨텍스트
(Edge Function 의 `asUser`)로 호출해야 한다.

### 🚨 과금 분기 — 가장 중요
| `todo.source` | 필요한 권한 |
| --- | --- |
| `teacher` | 학생 프리미엄 **불필요**. active 연결이면 충분 (과외쌤이 이미 앱 구독료를 냈다) |
| `self` | 학생 프리미엄 **필요** |

이걸 틀리면 **"과외쌤이 돈을 냈는데 그 학생이 검사를 못 받는"** 상황이 된다.
규칙은 `getAiCheckEntitlement()`(shared)에 단위 테스트와 함께 고정돼 있고, Deno 런타임이
이 패키지를 import 할 수 없어 Edge Function 에 같은 분기가 인라인돼 있다 — 스키마 테스트가 대조한다.

### 검증 순서 (Edge Function)
1. JWT 검증 → 2. 호출자 RLS 로 제출+숙제 조회 → 3. 본인 소유 확인 →
4. `ai_check_enabled` + `scope_text` 확인 → 5. **과금 분기** → 6+7. **한도 확인 + 슬롯 확보(원자적)**

**게이트는 슬롯 확보보다 반드시 앞이다.** 뒤에 두면 거부된 요청이 슬롯을 점유해 정상 요청이 막힌다.

### 사용량 안전장치 (상품 한도가 아니다)
| 한도 | 값 | 함수 |
| --- | --- | --- |
| 같은 제출 재검사 | 5 | `ai_check_max_attempts_per_submission()` |
| 요청자 1인 하루 | 50 | `ai_check_max_attempts_per_day()` |

폭주·버그·재시도 루프가 그대로 과금이 되는 것을 막는 목적이라 넉넉하게 잡았다. 값 조정은 함수만 바꾸면 된다.

**원자성:** 한도 확인과 INSERT 가 `start_homework_check_attempt` 안(=같은 트랜잭션)에 있다.
`count` 만으로는 READ COMMITTED 에서 동시 요청이 둘 다 통과할 수 있어
`pg_advisory_xact_lock(요청자)` 으로 직렬화한다. 한도 초과로 거부되면 슬롯도 만들어지지 않는다.

### 클라이언트 입력을 신뢰하지 않는다
Edge Function 이 body 에서 받는 것은 **`submissionId` 와 `idempotencyKey` 뿐**이다.
범위·학생 ID·사진 경로는 전부 DB 에서 직접 읽는다.
- **`markedLowEffort` 를 제거했다.** 클라이언트가 보내는 플래그로 `pass` ↔ `insufficient` 를
  뒤집던 값이라, 그 자체가 "클라이언트가 AI 판정을 정하는" 경로였다.
- 판정 입력은 **스냅샷**(`photo_paths_snapshot`)만 본다.

### 실패 응답에서 존재 여부를 숨긴다
없는 제출과 남의 제출을 **같은 응답**(`submission_not_found`)으로 합친다. 구분해서 알려주면
남의 `submission_id` 를 넣어 보며 다른 학생의 데이터 존재 여부를 알아낼 수 있다.
DB 예외 원문(`detail`)도 흘리지 않는다. 단, **`premium_required`(402)는 명확히 구분**한다 —
작업 6 의 프리미엄 안내 UI 가 이 코드를 쓴다.

---

## 4-6. 숙제 사진 업로드·열람 (20260806060000)

### 라이브러리
| 라이브러리 | 용도 | 선택 근거 |
| --- | --- | --- |
| `expo-image-picker` | 촬영·갤러리 선택 | Expo 공식. 카메라/갤러리를 한 API 로 다루고 **웹에서는 파일 선택으로 동작**해 `:8081` 미리보기로도 경로 시험 가능 |
| `expo-image-manipulator` | 리사이즈·JPEG 변환 | 업로드 전 긴 변 축소 + HEIC→JPEG. 웹에서도 동작(canvas) |

`react-native-vision-camera` 가 이미 있지만 '카메라 뷰' 라이브러리라 문서 촬영 UI 를 처음부터
만들어야 해서 이 용도에는 맞지 않는다(집중 모드 전용으로 둔다).

### 크기·형식 규칙 (앱 ↔ 서버 동일)
| 항목 | 값 | 강제 위치 |
| --- | --- | --- |
| 장수 | 1~9 | `subs_photo_count` 제약 + `validateHomeworkPhotos` |
| 파일 용량 | **5MB** | 버킷 `file_size_limit` + 앱 |
| MIME | `image/jpeg`·`png`·`webp` | 버킷 `allowed_mime_types` + 앱 |
| 리사이즈 | 긴 변 **1568px**, JPEG q0.8 | 앱(업로드 전) |

**5MB·1568px 근거:** Claude 비전은 이미지를 긴 변 ~1568px 로 줄여서 읽는다. 원본 4000px 을
올려도 판독 품질은 같고 업로드·저장 비용만 늘어난다. 앱이 미리 줄이므로 실제 파일은 보통
1MB 미만이고, 5MB 는 "클라이언트를 우회한 요청까지 막는 상한"이다.

⚠️ **HEIC 는 버킷이 받지 않는다.** iOS 원본 형식이지만 비전 API 가 못 읽으므로 앱이 업로드 전에
JPEG 로 변환한다. 버킷이 HEIC 를 받아 주면 "올라갔는데 AI 가 못 읽는 사진"이 생긴다.

### 경로 규칙
```
${studentUid}/${todoId}/${submissionKey}/page-N.jpg
```
- **첫 폴더가 학생 uid** 여야 Storage 정책(`(storage.foldername(name))[1] = auth.uid()`)을 통과한다.
- `submissionKey`(제출 시각)로 **제출마다 폴더를 나눈다.** 같은 경로에 덮어쓰면 이전 제출의
  사진이 사라져 그 제출의 AI 판정 근거가 없어진다(attempt 는 경로 스냅샷만 갖는다).
- 제출 레코드도 본인 폴더만 가리킬 수 있다 — `photo_paths_must_be_in_own_folder` 가드.
  없으면 "남의 사진을 가리키는 제출"을 만들어 과외쌤 화면에 다른 학생 사진을 띄울 수 있다.

### 열람 (비공개 버킷 → 서명 URL)
| 주체 | 방식 |
| --- | --- |
| 학생 본인 | `homework_photos_student_select` 정책 → 클라이언트가 직접 `createSignedUrl` |
| 과외쌤 | `homework_photos_teacher_select` 정책 → 클라이언트가 직접 `createSignedUrl` |

과외쌤 조건은 `subs_teacher_read` 와 **완전히 같은 식**이다(active 연결 + `share_homework_photos`).
서버 경유(Edge Function) 대신 Storage RLS 로 택한 이유:
- 게이팅 규칙이 한 곳에만 있어 갈라지지 않는다.
- 서버 왕복이 없다.
- 선언적이라 통합 테스트로 검증된다 — Edge Function 경유는 배포 없이 검증할 수 없다.

**서명 URL 발급 자체가 권한 검사다.** 공개범위를 끄거나 연결이 끊기면 URL 이 아예 발급되지
않으므로, 과외쌤 화면은 "학생이 사진 공개를 꺼 두어 볼 수 없어요"를 보여준다.

### 삭제·정리
- **업로드 실패 / 제출 레코드 생성 실패 → 올린 파일을 되돌린다.** 남기면 아무 제출도 가리키지
  않는 고아 파일이 된다.
- 재제출은 새 폴더를 쓰므로 이전 사진을 덮어쓰지 않는다(위 경로 규칙).
- ⚠️ **계정 탈퇴 시 Storage 파일은 지워지지 않는다.** DB cascade 는 `storage.objects` 를 건드리지
  않는다. `delete_my_account` 는 DB 행만 지우므로 사진은 남는다.
  → **미해결로 남겨 뒀다.** Storage 삭제는 DB 트랜잭션 안에서 할 수 없어(외부 스토리지 API)
  Edge Function 이나 배치가 필요하고, 그건 배포가 전제다(5b-2 이후). 개인정보 보관 관점에서
  출시 전 반드시 처리해야 한다 — §7 출시 전 목록에 넣었다.

### 촬영 안내
카탈로그 C4(모바일·태블릿)에는 촬영 안내가 **없다.** AI 정확도가 촬영 품질에 직결되므로 새로
넣었다(`HOMEWORK_PHOTO_TIPS`): 페이지 번호가 보이게 / 한 페이지씩 한 장으로 / 밝은 곳에서 똑바로.
주황(`#FF6B3D`)은 "지금·시작·연속·긴급" 전용이라 쓰지 않고 중립 톤 카드로 뒀다.

---

## 4-7. AI 숙제검사 실연동 (2026-08-06 배포)

**`ai-homework-check` 는 이제 실제 Claude 비전을 호출한다.** 스텁은 제거됐다.

### 모델·비용 (실측)
| 항목 | 값 |
| --- | --- |
| 모델 | **`claude-haiku-4-5-20251001`** (함수 시크릿 `ANTHROPIC_MODEL`, 대비값은 `index.ts` 의 `DEFAULT_MODEL`) |
| 요금 상수 | 입력 $1 / 출력 $5 per Mtok — `anthropic.ts` 의 `INPUT_MICROS_PER_MTOK`·`OUTPUT_MICROS_PER_MTOK` |
| 실측 (작은 테스트 이미지 1장) | 입력 1,084 · 출력 75 토큰 → **1,459µ$ ≈ 2.0원** |
| **실제 사진 기준 추정** | **1장 ≈ 4.3원 · 9장 ≈ 22원** |

⚠️ **모델을 바꾸면 요금 상수도 반드시 함께 바꿔야 한다.** 안 바꾸면 `estimated_cost_usd_micros`
기록이 조용히 틀리고, 그 숫자로 상품 한도를 정하게 된다.

⚠️ **비용은 입력 토큰이 지배한다.** 입력은 ① 시스템 프롬프트(**936토큰**, 실측) ② 이미지 토큰
(긴 변 1568px 사진 장당 ~1,600토큰)으로 나뉜다. 출력은 70~130토큰에 불과하다.

**초기 추정 0.3원/회는 틀렸다.** Sonnet 시절 실측이 5.9원, Haiku 로 내려도 2.0원(작은 이미지)
· 4.3원(실제 사진 1장)이다. 상품 한도는 이 숫자로 정해야 한다.

### Sonnet → Haiku 전환 근거 (2026-08-06 실측 비교)
같은 프롬프트·같은 이미지로 6개 시나리오를 각 모델에 돌렸다.

| | Sonnet 5 | Haiku 4.5 |
| --- | --- | --- |
| 판정 정확 | 5/5 | **5/5** |
| 누락·오제출 구체 지목 | 3/3 | **3/3** |
| 평균 비용 | 4,730µ$ ≈ 6.6원 | **1,519µ$ ≈ 2.1원** |

정확도가 동등하고 비용이 1/3이라 Haiku 로 내렸다. 유일한 차이는 페이지 번호가 안 보일 때
Haiku 가 **재촬영 요청을 명시하지 않는** 경향이었고, 프롬프트에 "학생이 할 행동을 반드시
넣으세요" 한 줄을 더해 해결했다(재측정에서 확인).

### 추가 절감안 (검토 결과, 미적용)
| 방안 | 예상 절감 | 정확도 영향 | 난이도 | 판단 |
| --- | --- | --- | --- | --- |
| **프롬프트 캐싱** | 1장당 ~19% | 없음 | 낮음 | ❌ **불가** — 시스템 프롬프트가 **936토큰**이고 캐싱 최소 경계는 **1,024토큰**이다(실측). 넘기려고 프롬프트를 늘리는 것은 본말전도 |
| 사진 상한 9 → 5장 | 최악 22원 → 12.8원 (42%) | 없음 | 낮음 | 제안 — 기능 축소라 사람 판단 필요. 범위가 `112-118p`(7페이지)면 7장이 필요할 수 있다 |
| 이미지 1568 → 1092px | 1장당 ~26% | **측정 필요** | 낮음 | 제안 — 문제 번호·손글씨 판독이 걸린다. 줄이기 전에 비교 측정해야 한다 |
| 시스템 프롬프트 압축 | 1장당 ~12% | **위험** | 중간 | 권하지 않음 — 판정 품질이 이 프롬프트에서 나온다 |
| `max_tokens` 512 → 200 | **0** | 없음 | 낮음 | 무의미 — 상한일 뿐 과금은 실제 생성 토큰이다(실측 70~130) |

### 프롬프트 원칙 (§3-2 "AI 는 감독관이 아니라 조수다")
- **정답 여부를 판정하지 않는다.** 분량 수행만 본다.
- **확신 없으면 `ambiguous`** 로 넘겨 과외쌤이 보게 한다.
- **사진에서 읽을 수 없는 것을 추측하지 않는다.** 페이지 번호가 안 보이면 범위 대조를 포기하고
  "페이지 확인 어려움"을 적은 뒤 빈칸 여부만 판단한다.
- 범위 자유 텍스트(`112-118p, 115 제외` / `3, 5-12번`)의 구간·제외를 해석해 대조한다.

프롬프트는 `supabase/functions/ai-homework-check/anthropic.ts` 에 있고, 위 원칙 문장들은
스키마 테스트가 존재를 검사한다(문구를 지우면 CI 가 잡는다).

### error_code → 사용자 메시지
`CheckErrorCode`(Deno) ↔ `HOMEWORK_CHECK_ERROR_MESSAGES`(shared)는 **같은 집합**이어야 하고,
스키마 테스트가 두 목록을 정렬 비교한다. Deno 는 이 패키지를 import 할 수 없어 쌍둥이 구현이다.

| code | 상황 | 사용자에게 |
| --- | --- | --- |
| `photos_missing` | 스냅샷 경로의 객체가 Storage 에 없다 | 사진을 다시 올려 제출 |
| `photo_download_failed` | 다운로드 실패 | 잠시 후 재시도 |
| `photo_too_large` | 비전 입력 상한(12MB) 초과 | 더 작게 찍어 다시 |
| `auth_failed` | 키 문제(401/403) | 제출은 저장됨 · 선생님이 확인 |
| `rate_limited` | 429 | 잠시 후 재시도 |
| `upstream_timeout` | 60초 초과 | 제출은 저장됨 · 재시도 가능 |
| `upstream_error` | 그 외 API 실패 | 제출은 저장됨 · 선생님이 확인 |
| `response_malformed` | 응답이 기대 형식 아님 | 제출은 저장됨 · 선생님이 확인 |

**실패해도 학생을 막지 않는다.** 실패는 `fail_homework_check_attempt` 로 attempt 에 남고
슬롯이 비워져 재시도가 가능하며, 앱은 위 문구로 안내하고 과외쌤 수동 검사로 넘어간다.

### 안전장치
- **사진 존재 검증** — service_role 로 스냅샷 경로를 내려받는 과정이 곧 존재 검증이다.
  없으면 `photos_missing` 으로 끝내고 **AI 를 호출하지 않는다**(비용 낭비 방지).
- **타임아웃 60초** (`AbortController`), **총 이미지 12MB 상한**.
- **응답 방어** — 코드펜스·앞뒤 설명을 걷어내고 JSON 만 파싱, `verdict` 화이트리스트 검사,
  `confidence` 0~1 클램프, `reason` 500자 절단. 어긋나면 `response_malformed`.
- 판정은 **스냅샷만** 본다(라이브 `photo_paths`/`scope_text` 를 읽지 않는다).

### Edge Function 타입 검사
`supabase/functions` 는 turbo typecheck 대상이 아니다(Deno 코드). 배포되는 코드이므로 따로 검사한다.
```bash
pnpm check:functions   # deno check --config supabase/functions/deno.json
```
- `deno` 는 **레포 devDependency**(npm 배포판)다 — 시스템 설치가 아니라 `pnpm install` 만으로
  로컬·CI 가 같게 동작한다. **CI 에도 이 단계가 들어가 있다.**
- `supabase/functions/deno.json` 이 필요한 이유: 없으면 deno 가 상위 `pnpm-workspace.yaml` 을
  발견해 **루트 `package.json` 에 `workspaces` 필드를 써 넣는다**(실제로 그렇게 됐다).

---

## 5. 작업 방식

### 5-1. 작게 쪼갠다
한 번에 전체 기능을 만들지 않는다. 단계를 나누고, 각 단계가 통과한 뒤 다음으로 간다.
중간에 문제가 생겼을 때 원인을 특정할 수 있어야 한다.

예시(졸음 감지 실제 진행 방식):
1단계 얼굴 인식 토대 → 2단계 판단 규칙 → 3단계 알림·기록 연동

### 5-2. 매 단계 검증
`lint` · `typecheck` · `test` · `build` **전부 green** 확인 후 커밋·push.
실패하면 임의로 고치지 말고 먼저 보고한다(환경 문제일 수 있음).

### 5-3. 멈춰야 할 때
다음 상황에서는 진행을 멈추고 사람에게 묻는다:
- 비밀값(키·토큰)이 없을 때 → **절대 지어내지 말 것**
- 저장소/폴더가 맞는지 확신이 없을 때
- 시스템 도구 설치처럼 되돌리기 애매한 작업 전
- Supabase 프로젝트 설정 변경 등 운영 환경에 영향을 주는 작업
- 계정 생성·메일 발송 등 실제 부작용이 발생하는 동작을 테스트할 때

### 5-4. 보고 형식
작업 후 다음을 포함해 보고한다:
- 무엇을 했고 무엇을 하지 않았는지 (범위 밖은 명확히 밝힐 것)
- 검증 결과 (lint/typecheck/test/build)
- 사람이 해야 할 다음 일
- 발견한 문제·주의사항

---

## 6. 현재 상태 (2026-08 기준)

### 완료
- 학생 앱 · 과외쌤 앱 핵심 화면 디자인 및 기능 구현
- **졸음 감지 3단계 구현 완료** (얼굴 인식 → 판단 규칙 → 알림·기록)
  - MediaPipe Face Landmarker 사용, 온디바이스
  - 판단 규칙: 깜빡임/졸음 구분(1초+ 지속), 신호 합산(눈+고개+하품),
    개인화 기준선(초기 75초 학습), 환경 분리(측정 어려움 별도), 디바운스(3회 연속)
  - 넛지: 졸음 확정 시에만, 3분 쿨다운, 부드러운 문구
  - 기록: `focus_checks` 테이블 + `save_focus_check` RPC → `study_sessions.focus_score`/`drowsy_count`

- **Anthropic API 키 발급·등록 완료** — 루트 `.env`의 `ANTHROPIC_API_KEY`.
  앱별 `.env`가 아닌 루트에 둔 이유: Next/Expo 어느 쪽도 루트를 읽지 않으므로
  클라이언트 번들에 들어갈 경로가 구조적으로 없다. 인증 검증까지 완료.
  단, **키를 읽는 코드는 아직 없다**(AI 기능 전부 스텁).
- **화면 전환 감사 실시** — 정적 분석으로 심각 6건·보통 11건 발견.
  "화면은 잘 만들어져 있는데 화면 사이를 잇는 진입 링크가 체계적으로 빠져 있음"
- **Top 1 수리 완료** — 학생이 숙제 제출 화면에 진입할 수 있게 연결
  (홈: 체크박스=완료 / 제목·카메라=진입, 플래너: 제목=진입. 카탈로그 디자인 근거)

### 남은 수리 (감사에서 발견, 우선순위 순)
1. ~~숙제 진입 연결~~ (완료)
2. **알림 생성 구현** — 현재 notifications INSERT 코드가 프로덕션에 0건.
   과외쌤이 숙제를 내도 학생에게 아무 신호가 가지 않는다.
   이것 때문에 `/report`(나의 리포트), 알림 센터도 도달 불가 상태.
3. **학생 설정 허브 진입점** — `/settings`로 가는 링크가 앱 전체에 0건.
   그 아래 프로필 편집·알림 센터·약관·**회원 탈퇴**가 연쇄 도달 불가.
   **회원 탈퇴 도달 불가는 앱스토어 리젝 사유다.**
4. **과외쌤 설정에 탈퇴·알림 링크 추가** — 페이지와 RPC는 완성돼 있으나 링크가 없음
5. **학생별 설정을 실제 경로로** + 숙제 출제 시 studentId 전달

### 진행 예정
- **학부모 리포트 구현** (설계 완료, 별도 설계서 참조)
- **숙제 검사 AI 실연동** (설계 완료. 단, 위 보안 구멍 2개를 먼저 막아야 함)
- **혼공생 AI 검사** (설계 중) — 학생이 범위를 입력하고 'AI 검사 받기'를 켠 할 일만 검사,
  학생 프리미엄 전용. 범위 컬럼 추가 + 학생 변경 차단 + 서버 프리미엄 검증이 전제
- 졸음 감지 실기기 카메라 테스트 (수치 정확도·오탐률 확인, 임계값 튜닝)
- 졸음 데이터를 리포트 집중도 항목에 연결

### 미발급 키
- `ANTHROPIC_API_KEY` — 리포트·숙제검사 AI (최우선)
- `SUPABASE_ACCESS_TOKEN` — RLS 통합 테스트 활성화 (선택)
- `STRIPE_*`, `REVENUECAT_API_KEY` — 결제 실연동 (출시 준비 단계)
- `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_PASSWORD` — Edge Function 배포 시

---

## 7. 출시 전 필수 처리

- **계정 탈퇴 시 Storage 사진 삭제** — DB cascade 는 `storage.objects` 를 지우지 않는다.
  탈퇴한 학생의 숙제 사진이 버킷에 남는다(§4-6). 개인정보 보관 관점에서 반드시 처리.
- ⚠️ **`mailer_autoconfirm=true`가 켜져 있음** (테스트 편의용). 이대로 배포하면 미인증 이메일로
  계정 생성이 가능하다. **출시 전 반드시 해제.**
- 테스트용 계정 정리
- Edge Function 배포 (`ai-homework-check` 등) — 사람이 실행
- E2E 테스트 실행 (현재 스캐폴딩만 완료)
- `docs/ui-catalog/` PNG 대조 미완

---

## 8. 참고 문서

이 문서들은 레포 루트의 `docs/` 폴더에 함께 보관할 것을 권장한다.

- `ssamplanner-workflow-report.docx` — 전체 진행 현황 보고서 (사람용)
- `ssamplanner-service-overview.docx` — 서비스 소개서 (외부 공유용)
- `ai-features-master-design.md` — 리포트·숙제검사·졸음감지 통합 설계
- `report-final-design.md` — 학부모 리포트 상세 확정 설계
- `report-samples-2cases.md` — 리포트 출력 샘플 (잘한 주 / 못한 주)
- `report-ai-prompt-draft.md` — 리포트 AI 프롬프트 초안
- 레포 내 `STOP-NEEDS-HUMAN.md` — 사람 개입이 필요한 지점 목록 (레포에 이미 존재)
