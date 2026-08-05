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

---

## 4. 알려진 함정

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
- **`homework_submissions`** — 제출 + AI 결과가 한 테이블.
  `photo_paths`, `ai_verdict`, `ai_confidence`, `ai_reason`, `teacher_status` 등
  - **검사 이력·상태·idempotency 없음.** AI 결과를 덮어써서 이전 판정이 소실된다.
- **`student_subscriptions`** — 프리미엄 권한. `status`, `provider`, `expires_at`.
  RLS는 select만 허용, 쓰기는 definer RPC(mock)로만.
- **사용량/비용 기록 테이블: 없음.**

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
3. **프리미엄 검증이 클라이언트에만 있고 `expires_at`을 보지 않는다.**
   서버(Edge Function) 측 구독 검증이 0곳이다. 유료 기능을 만들려면 서버 검증이 전제다.
   (mock RPC 를 막아 "스스로 유료가 되는" 경로는 사라졌지만, 이 판정 로직 구멍은 남아 있다.)

### 미구현 (스텁 상태)
- 숙제 사진 실제 업로드/열람 코드 — 현재는 경로 문자열만 저장
- `ai-homework-check` Edge Function — 코드는 있으나 **미배포**(라이브 404),
  내용도 사진 개수만 보는 스텁. Anthropic 미사용
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

### 아직 안 한 것
- **DB 제약 `ai_check_enabled=true → scope_text not null` 은 아직 없다.** UI 가 두 앱 모두에서
  막고 있지만, 기존 행에 위반이 있을 수 있어 별도 마이그레이션으로 넣어야 한다.
- AI 검사가 이 값을 실제로 쓰는 로직(`ai-homework-check`)은 미구현.
- 혼공생 AI 검사 진입점·프리미엄 게이트 미구현(입력 칸과 필수 규칙까지만 있다).

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
