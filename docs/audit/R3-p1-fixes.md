# R3 — 실기기 전 P1 수정 배치

작성: 2026-08-18 · 분기: `fix/p1-consent-report-atomicity` ← `main` @ `5c57e6d` (스택 없음)
Supabase: `khssgcagudjimrezebxq` 단일 프로젝트 · `apps/teacher-mobile/` 변경 **0줄**

마이그레이션 2개 (적용 + 이력 기록 완료, 최종 **52/52**):

| 파일 | 내용 |
|---|---|
| `20260821000000_onboarding_consent_atomic.sql` | `finish_onboarding_with_consent` — 동의 기록 + `onboarded` 원자화 |
| `20260821010000_publish_report_atomic.sql` | `publish_report` — 저장·토큰·sent·발송이력 원자화 |

> ⚠️ **`docs/audit/R2-cross-review.md` 는 레포에 없다.** 전 브랜치·전 커밋을 검색해도 없고
> (`git log --all --diff-filter=A -- "**/R2*"` 결과 0건), `R1-full-review.md` 는 아직 untracked 다.
> 그래서 R2 를 읽지 못했다 — 대신 지시문에 적힌 file:line 근거를 **전부 코드에서 직접 확인**하고
> 그 실측을 근거로 작업했다. 아래 각 항목의 "확인" 줄이 그 결과다.
> (R1 보고서는 이번 커밋에 함께 넣었다.)

---

## 작업 1 — 동의 기록 원자화

### 확인한 결함 (지시문 근거를 코드에서 재확인)

| 위치 | 실제 코드 | 결과 |
|---|---|---|
| `apps/student/src/m1Screens.tsx:401` | `profiles.upsert({… onboarded: true})` → **그 뒤** consent insert | 동의 기록 실패 시 메시지만 남기고 `/today` 로 이동. 주석에 "기록 실패가 가입을 되돌리지는 않는다" 고 명시돼 있었다 |
| `apps/teacher/src/app/m1.tsx:603` | 같은 순서 + consent insert 의 `error` 를 **읽지 않음** | 조용히 증적 없는 온보딩 완료 |
| `apps/teacher/src/app/m1.tsx:1109` | 가입 직후 consent insert, `error` 를 **읽지 않음** | 같음 |

동의 증적은 "그 시점에 동의했다" 의 유일한 근거다(A4). 증적 없는 계정이 생기는 경로를 남기면
그 계정이 처리한 데이터의 근거를 설명할 수 없다.

### 조치

**`finish_onboarding_with_consent(p_documents text[], p_version text, p_method text)`** —
동의 기록과 `onboarded = true` 를 **한 트랜잭션**에서 한다. 필수 문서(이용약관·개인정보)가 없으면
**아무것도 쓰지 않고 거부** → `onboarded` 는 `false` 로 남는다. 멱등(같은 문서·버전이 이미
`accepted` 면 넣지 않는다).

클라이언트는 프로필 필드만 저장하고 **`onboarded` 를 건드리지 않는다**(기본값 `false`).
RPC 가 실패하면 화면이 넘어가지 않고 사용자에게 이유가 보인다.

**설계 판단 두 개:**

- **프로필 필드를 RPC 가 받지 않는다.** 학생/과외쌤의 필드가 다르고 앞으로도 달라진다 —
  SQL 시그니처에 복제하면 화면이 필드를 하나 추가할 때마다 마이그레이션이 필요해진다.
  불변식은 "동의 없이 `onboarded=true` 가 되지 않는다" 하나뿐이므로 그 하나만 서버가 쥔다.
- **"이미 기록됐는지" 판정을 서버가 한다.** 처음에는 클라이언트가 스택된 값이 없을 때
  `{terms:true, privacy:true}` 를 채워 보내게 썼다가 **되돌렸다** — 그건 동의하지 않은 계정의
  증적을 **위조**하는 코드다(약관 이전에 가입한 계정이 체크박스를 본 적 없이 동의 기록을 얻는다).
  지금은 클라이언트가 가진 것만 그대로 넘기고, RPC 가 "넘어온 문서 ∪ 이미 이 버전으로
  accepted 인 문서" 로 판정한다. 둘 다 없으면 거부한다.

**A5 §3 의 서버 강제 C+A 중 C 다.** A(전역 트리거)는 아직 하지 않았다 — teacher-mobile 이
여전히 `onboarded` 를 직접 저장하고(`authScreens.tsx:256`, `profileSettingsScreen.tsx:46`)
이번 작업은 그 경로를 건드릴 수 없다. 지금 트리거를 걸면 teacher-mobile 가입이 막힌다.
mobile 이 이 RPC 로 옮겨온 뒤가 A 의 시점이다.

### ⚠️ 이 작업에서 내가 만든 버그 하나 — 실행 테스트가 잡았다

첫 구현은 필수 문서 검사를 이렇게 썼다:

```sql
from unnest(required) r
where not (r = any(p_documents))
  and not exists (select 1 from consent_records c where c.document = r and …)
```

`unnest(required) r` 는 **테이블 별칭과 컬럼 이름이 둘 다 `r`** 이 되고, 상관 서브쿼리 안의
맨 `r` 이 컬럼이 아니라 **행 전체(composite)** 로 해석될 수 있다. 그래서 `c.document = r` 이
**오류 없이 never-match** 가 됐다 — "이미 기록됨" 판정이 항상 실패했다.

문자열 단정으로는 절대 못 잡는다(SQL 문장은 멀쩡해 보인다). **실행 테스트가 잡았다**
(`p_documents: []` 로 부르는 케이스에서 `consent_required_missing`). `as req(doc)` 로 컬럼을
명시해 고쳤고, 회귀 방지 단정을 넣었다. A1.6 의 교훈이 그대로 재현된 사례다.

---

## 작업 2 — 리포트 조회 오류 차단 + 발송 원자화

### 2-1. 조회 실패를 "네 번째 상태" 로 분리

**확인**: `m5.tsx:191-326` 의 모든 조회가 `.error` 를 버리고 `?? []` 로 넘겼다
(9개: 공부기록·추이·숙제·집중도·시험·공개범위·발송이력·수업회차·예정회차).
그래서 **조회가 실패해도 `buildParentReport` 가 `no_data` 를 만들었다** — 학부모에게
"이번 주 기록이 없다" 가 사실처럼 나간다.

조치: `dataError` 상태를 세우고 9개 조회의 오류를 라벨과 함께 모은다. 오류가 있으면
- 발송 버튼 **전부 비활성**(`dataError !== null`)
- 붉은 안내 + **다시 불러오기** 버튼
- 발송 함수 진입 시에도 한 번 더 차단(버튼만 막으면 경로가 남는다)

`hidden`/`no_data` 로 **정규화하지 않는다** — 모르는 것과 없는 것은 다른 상태다.

### 2-2. 네 단계 원자화

**확인**: 발송이 쓰기 3~4개로 쪼개져 있었다.

| 단계 | 옛 코드 | 문제 |
|---|---|---|
| ① `reports` insert | `m5.tsx:424` | — |
| ② `create_report_share` | `:463` | 이 RPC 가 **이미** `status='sent'`, `sent_at` 를 세팅한다 |
| ③ `reports.update({status:'sent'…})` | `:470` | ②가 한 일의 **중복 쓰기**. `error` 읽지 않음 |
| ④ `report_deliveries` insert | `:474` | `error` **읽지 않음** |

그리고 성공 메시지는 ②의 결과만 보고 정해졌다 — **④가 실패해도 "공유 링크를 발급했어요"** 가
떴다. 링크는 살아 있고 발송 이력은 없는 상태를 과외쌤은 알 수 없다.

조치: **`publish_report(...)`** 하나로 묶었다. ③의 중복 쓰기는 사라졌다(토큰 발급과 상태 전이가
같은 자리에서 일어난다). 실패 시 아무것도 남지 않는다. 성공 메시지는 RPC 성공 확인 **뒤에만**
나온다(2-3).

권한을 표 정책보다 **좁게** 잡았다: `reports` 의 `with check` 는
`teacher_id = auth.uid() OR <active 연결>` 이라 첫 가지만으로 통과한다(A5.1 이 이걸로 미연결
학생에게 리포트를 붙일 수 있었다). 이 RPC 는 **active 연결을 요구**한다. 빌더가 active 학생만
나열하므로 정상 흐름은 영향이 없다.

---

## 작업 3 — 성공 선표시·fail-open 정리

| # | 확인한 결함 | 조치 |
|---|---|---|
| 3-1 | `m7Screens.tsx:232` — `setStatus("granted")` 가 **오류와 무관하게** 실행됐다. 등록 실패인데 화면은 "알림을 켰다" 고 말한다 | 실패 시 조기 반환. 성공 확인 뒤에만 `granted` |
| 3-2 | `m7Screens.tsx:265` — `const { data } = …` 로 `error` 를 버리고, `data` 가 null 이면 **하드코딩된 건강한 기본값**(`maintenance:false`, `min_supported_build:1`)으로 대체. 점검 중이거나 강제 업데이트가 필요해도 **조회만 실패하면 "정상 동작 중"** 이 됐다 | `loadError` 상태 + "상태를 확인할 수 없어요" + **다시 확인** 버튼 |

3-2 는 지시대로 **fail-closed 로 바꾸지 않았다** — 그러면 조회 실패마다 앱이 잠긴다.
"오류를 오류로 보이게" 만 했다. 행이 아예 없는 것(설정 미생성)은 오류와 구분해 기본값을 쓴다.

---

## 작업 4 — 삭제 파이프라인 실행 테스트

`packages/shared/src/m7.purgePipeline.rls.integration.test.ts` — **테스트 객체만** 사용,
끝에 계정·객체·큐·로그 전부 정리.

| # | 시나리오 | 실측 결과 |
|---|---|---|
| 1 | 테스트 객체 2개 업로드 | Storage 2건 |
| 2 | `profiles` 삭제 → BEFORE DELETE 트리거 | **큐 1행 생성**, `status=pending`, `prefix = <uid>/` (DB CHECK 가 강제) |
| 3 | `claim_storage_purge_batch` | 대상 행 선점됨 |
| 4 | **리스 경합** — 직후 재claim | 같은 행 **미포함** (두 sweep 이 같은 행을 동시 처리하지 않는다) |
| 5 | `storage_paths_for_prefix` | 업로드한 2경로와 정확히 일치 |
| 6 | 삭제 + `complete_storage_purge` | `status=done`, `deleted_count=2`, `attempts=1`, Storage **0건** |
| 7 | **감사 로그** | 1행, `outcome=deleted`, `attempt_no=1`, `deleted_paths` 2건 |
| 8 | **멱등** — done 행 재claim | **미포함** (무한 재처리 없음) |
| 9 | **5회 실패 굳힘** | 1~4회차 `pending`(재시도 가능), 5회차 **`failed`**, `attempts` 1→5 |
| 10 | failed 재claim | **미포함** (영구 실패를 무한 재시도하지 않는다) |
| 11 | failed 행 보존 | 남아 있고 `last_error` 기록됨 (조용히 버리지 않는다) |
| 12 | 실패 감사 로그 | **5행**, 전부 `outcome=failed` |

> ⚠️ **이 테스트가 단독 실행에서는 통과하고 전체 실행에서 떨어졌다.** 원인은 R1 이 기록한
> "sweep 1회 20행 예산" 의 현실이다 — 다른 통합 테스트가 계정을 만들고 지우면서 큐에 백로그를
> 쌓고, `claim(20)` 이 내 행이 아닌 남의 20행을 집는다. 한 번의 claim 이 대상 행을 포함한다고
> 가정할 수 없다. 실제 sweep 이 백로그를 훑는 것처럼 **대상 행이 나올 때까지 배치를 도는**
> 헬퍼로 바꿨고, 단독·전체 양쪽에서 통과를 확인했다.

---

## 작업 5 — 환경 위생

| 항목 | 조치 |
|---|---|
| `apps/student/.env.example` | **신규**. `EXPO_PUBLIC_SUPABASE_URL/ANON_KEY`. 없으면 빌드는 통과하고 **실행 시점에** 죽는다는 함정을 명시(클라이언트가 지연 생성이라 CI 정적 export 는 성공한다) |
| `apps/teacher/.env.example` | **신규**. `NEXT_PUBLIC_SUPABASE_URL/ANON_KEY` + `E2E_BASE_URL`(선택) |
| `BROWSER_ALLOWED_ORIGINS` | 루트 `.env.example` 에 문서화. **오설정 시 영향 명시**: 모든 Edge Function 의 브라우저 호출이 CORS 로 막힌다(웹만 조용히 깨지고 서버-서버 호출은 영향 없음). 읽는 곳 `_shared/cors.ts` |
| `AI_OBSERVATION_INCLUDE_SCOPE` | 같이 문서화. 오설정 시 관찰 프롬프트 입력이 바뀌어 **판정 성향이 달라진다**(과거 실험과 비교 불가) |
| `GEMINI_API_KEY` | `.env.local` 에서 **제거**(29줄→28줄, 다른 17개 변수 전부 보존 확인). 코드 참조 0건 |

> ⚠️ **`GEMINI_API_KEY` 는 실제 값이 들어 있던 키다.** `.env.local` 은 gitignore 대상이라
> 커밋된 적은 없지만, 쓰이지 않는 채로 파일에 남아 있었다. **제공자 콘솔에서 폐기(rotate)하는
> 것을 권한다** — 파일에서 지우는 것은 그 키를 무효화하지 않는다.
> 이 변경은 gitignore 대상이라 **커밋에 포함되지 않는다**(로컬 위생).

---

## 검증

| 항목 | 결과 |
|---|---|
| `lint` (shared·student·teacher·teacher-mobile) | green |
| `typecheck` (4개) | green |
| `check:functions` | green |
| `test` | **428 passed / 40 files** (R1 시점 408/37 → **+20, +3 파일**) |
| `build` (teacher `.next` 삭제 후 · student · teacher-mobile) | green |
| `pnpm sb db push --dry-run` | **`Remote database is up to date.`** |
| 마이그레이션 이력 | **52/52** 일치 |
| A1~A5.1 음성 회귀 | 21건 전부 이전 상태 유지 |
| 신규 RPC 권한 | `anon` 실행권한 **없음** ✓ / `authenticated` 있음(의도) |
| `apps/teacher-mobile/` | 변경 **0줄** |

### 새 RPC 실행 테스트 (필수 요건)

`packages/shared/src/r3.atomicity.rls.integration.test.ts` — 실계정 사용.

| # | `finish_onboarding_with_consent` | 결과 |
|---|---|---|
| 1 | 필수 문서 누락 | 거부 · `onboarded=false` 유지 · 동의 **0행**(부분 쓰기 없음) |
| 2 | 필수 2 + 선택 1 | 성공 · `onboarded=true` · 동의 3행 |
| 3 | 재호출(멱등) | 동의 **3행 유지** |
| 4 | 빈 목록 + 이미 기록됨 | 성공(가입 시점 기록 경로) |
| 5 | 새 버전 + 옛 동의만 | **거부** · `onboarded=false` |

| # | `publish_report` | 결과 |
|---|---|---|
| 6 | 미연결 학생 대상 | `not_connected_student` |
| 7 | 코멘트 공백 | `teacher_comment_required` |
| 8 | 잘못된 채널 | `invalid_delivery_channel` |
| 9 | 거부 3회 후 리포트 행 | **0행** (부분 쓰기 없음) |
| 10 | link 정상 | `delivery=sent` · 토큰 64자 · `status=sent` · `sent_at`·`share_expires_at` 세팅 · 발송이력 1건 |
| 11 | 익명 웹뷰 | `status=ok`, 코멘트 일치 |
| 12 | 무효화 후 익명 | **`not_found`** (R1 P2-5 의 미검증 지점 해소) |
| 13 | kakao(연동 전) | `delivery=pending` · `status=draft` · 토큰 **null** |

> ⚠️ 익명 웹뷰 검증에서 처음 `not_found` 가 나왔는데, **프로브 인공물**이었다 —
> 토큰을 읽는 서브쿼리가 `anon` 역할로 실행돼 `reports` SELECT 정책이 없어 NULL 을 넘겼다.
> 토큰을 역할 전환 **전에** 확보하니 `ok` 다. (같은 함정을 R1 의 알림 측정에서도 겪었다.)

### 기존 테스트 3건을 새 경로에 맞춰 수정 (약화 아님)

| 테스트 | 옛 단정 | 새 단정 |
|---|---|---|
| `consent.test.ts` 과외쌤 온보딩 | `buildConsentRows(…, "teacher_web_onboarding")` | `finish_onboarding_with_consent` + `p_method` |
| `consent.test.ts` 학생 가입 | `buildConsentRows(…, "student_app_signup")` | 같음 |
| `m5.test.ts` 만료 기본값 | `create_report_share` 직접 호출 | `publish_report` 호출 + 그 RPC 의 `default 2160` |

지키려는 **의도는 그대로**이고 기제만 바뀌었다. 오히려 강화한 것도 있다 —
"프로필 저장이 `onboarded` 를 직접 켜지 않는다"(순서 역전 회귀 감지) 단정을 새로 넣었다.

> ⚠️ 단정을 쓰다 **주석 산문에 걸리는 함정을 두 번** 밟았다("onboarded=true" 를 설명하는 주석,
> 나쁜 예로 적어 둔 `unnest(required) r`). 창을 좁히고 `codeOnly()`(줄 주석 제거) 헬퍼를 넣었다.

### 최종 기준값

이력 52 · `profiles` 12 · `auth.users` 15 · 테스트 잔재 **0** · `storage.objects` **0** ·
`reports`/`report_deliveries`/`consent_records` 0 · 큐 `failed` **0**

> `storage_purge_queue` `pending` **231행** — 전부 **이미 삭제된 테스트 계정**의 백로그이고,
> 전부 `claimed_at` 이 세팅된 **리스 상태**다(내 테스트가 `p_limit 500` 으로 배치 선점했다).
> 10분 리스가 만료되면 다음 sweep 이 자동으로 집는다(A2.1 의 리스 복구). 누수가 아니다.
> 다만 테스트가 백로그 전체를 10분간 잡아 두는 부작용이 있다 — 실제 sweep 을 그 동안 막는다.
> 파일럿 규모에서는 무해하나, 자동 스케줄을 붙이는 시점에는 테스트의 `p_limit` 을 줄이는 게 낫다.

---

## 남긴 것 / 확인 불가

| 항목 | 사유 |
|---|---|
| 서버 전역 강제(A5 §3 의 A) | teacher-mobile 이 `onboarded` 를 직접 저장한다 — 전역 트리거를 걸면 그 가입이 막힌다. mobile 이 RPC 로 옮겨온 뒤의 작업 |
| `guardian_consented_at` 서버 전용화 | A5.1 §3-4 그대로. 보호자 동의 구현과 같은 커밋에서 화면과 함께 해야 한다(지금 돌리면 가입이 막힌다) |
| 푸시 실토큰화 (R1 P1-2) | 이번 범위 밖. 3-1 은 "실패를 성공으로 표시하지 않는다" 만 고쳤고, 토큰 자체는 여전히 `expo-mock-*` 다 |
| 화면 실제 렌더 | 빌드·타입·단위 테스트 + RPC 실계정 실행으로 갈음. `dataError` UI 는 조회 실패를 인위적으로 만들 수단이 없어 렌더 확인은 못 했다(단정은 문자열) |
| `R2-cross-review.md` | 레포에 없다(§머리말). 지시문의 file:line 을 코드에서 직접 확인해 대체했다 |
