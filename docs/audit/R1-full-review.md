# R1 — 전수 기능 리뷰 (수정 금지, 발견만)

작성: 2026-08-17 · 대상: `main` @ `aacfd7b` (PR #52 머지 시점, A1~A5.1 전부 포함)
Supabase: `khssgcagudjimrezebxq` 단일 프로젝트 · **코드·DB·설정 변경 0건** (읽기·실행 확인만)
근거: 모든 발견에 file:line 또는 실행 결과. 실행 가능한 것은 실행으로 확인(새 AI 과금 호출만 제외).

> 방법: 영역 1·2 는 원격 DB·Edge Function·통합 테스트를 직접 실행해 확인했다.
> 영역 3·4·5 는 세 개의 병렬 리뷰로 레포를 전수 조사했고, 그 결과를 여기서 검증·통합했다.
> RLS 재현은 `auth.users` 직접 삽입 + JWT 클레임 세팅으로 했고 계정은 매번 삭제했다(최종 잔여 0).

---

## 종합 — P0/P1/P2/P3

**P0 (지금 고쳐야) — 없음.** 라이브로 깨져 있는 결함은 찾지 못했다. 서버 게이트·권한·플래그가
일관되고, 위험한 mock RPC 는 전부 서버에서 fail-closed 다. 아래는 전부 "출시 전" 또는 "기록" 급이다.

**P1 (실기기 테스트 전)**

| # | 발견 | 근거 | 권장 조치 |
|---|---|---|---|
| P1-1 | **teacher-mobile 이 아직 옛 2단계 수락을 쓴다** (비원자적, 고아 설정 위험). 고칠 브랜치는 이미 있는데 **미머지**다 | `apps/teacher-mobile/src/connectionRequestsScreen.tsx:142,157`; 마이그 `20260819020000` 이 이 file:line 을 결함으로 명시; 수정본 `origin/fix/teacher-mobile-accept-rpc-stacked`(ff4b5e8, 미머지) | 그 브랜치 리뷰·머지. 머지 후 `accept_connection_request` RPC 로 전환됨을 확인 |
| P1-2 | **푸시 알림이 mock** — 실기기 전송 경로 없음. 알림 구동 흐름과 `/report` 딥링크의 유일 진입점을 막는다 | `apps/student/src/m7Screens.tsx:223,231` (`expo-mock-${id}` 토큰) | 실 expo-notifications 토큰 등록으로 교체 |
| P1-3 | **탈퇴·Storage 삭제 파이프라인이 실행 테스트 0건** (A1.6 와 같은 모양 — 되돌릴 수 없는 사용자 사진 삭제인데 마이그 텍스트 단정만) | `account-delete/index.ts:74-79,143-240`; `claim_storage_purge_batch`(schema 3117, 테스트 전무)·`complete_storage_purge`·`storage_paths_for_prefix` | 실계정 실행 테스트 추가(다음 작업). **본 리뷰에서 sweep 을 직접 실행해 동작은 확인**(§2-g), 부재한 것은 자동 테스트다 |

**P2 (파일럿 전)**

| # | 발견 | 근거 |
|---|---|---|
| P2-1 | **결제·IAP 가 501 stub** — 실제 결제 경로 없음. 구독 상태는 mock RPC 의존(학생 mock 은 프로덕션에서 회수됨) | `billing-stripe/index.ts:16`, `iap-webhook/index.ts:12` (미배포·stub) |
| P2-2 | **고아 라우트 6개가 번들에 포함** — 진입점 0. 둘은 매니페스트+테스트가 존재를 잠가 둠 | 학생 `/system`·`/focus/report`·`/todo/[id]/edit`·`/report`; 교사 `/onboarding/first-student`·`/students/demo/settings` (`M1_ROUTE_MANIFEST` m1.ts:59,64 + page.test.ts:19,22) |
| P2-3 | **미문서화 Edge Function 시크릿** — 잘못 설정 시 전 함수 CORS 붕괴 | `AI_OBSERVATION_INCLUDE_SCOPE`(ai-homework-check/index.ts:60), `BROWSER_ALLOWED_ORIGINS`(_shared/cors.ts:9) — 어느 `.env.example` 에도 없음 |
| P2-4 | **student·teacher 앱에 `.env.example` 부재** (teacher-mobile 만 있음). 키 누락 시 `""` 로 조용히 폴백 | `apps/student/src/supabaseClient.ts`, `apps/teacher/src/app/supabaseClient.ts` |
| P2-5 | **프라이버시 통제 RPC 실행 테스트 없음**: `revoke_report_share`(토큰 무효화)·`pending_connection_requests`(교사 인박스, 학생 이름 노출·교차 유출) 문자열 단정만 | schema 2839·288; m5.test.ts:214·m1.schema.test.ts:97. **본 리뷰에서 무효화·조회는 실행 확인**(§2-e) |
| P2-6 | **시간대 TODO(M8)** — streak/일 경계 계산이 Asia/Seoul 아님 → 한국 사용자 자정 경계에서 streak 오산 | `packages/shared/src/m2.ts:174` |
| P2-7 | **`guardian_consented_at` 를 본인이 쓸 수 있음** (미성년자가 보호자 동의를 자기 신고). 보호자 동의 구현 시 서버 전용 전환 전제 | A5.1 §3-4 (실측: 본인 UPDATE 영향 1행) |
| P2-8 | fail-closed 표(`report_views`·`storage_purge_queue`·`storage_purge_log`) 행위 테스트 없음 — "정책 텍스트 없음" 만 단정. 나중에 grant 가 잘못 붙어도 텍스트 테스트는 통과 | m7.schema.test.ts:152 |

**P3 (기록만)**

| # | 발견 | 근거 |
|---|---|---|
| P3-1 | **미머지 stale 브랜치** `chore/ai-model-cost-comparison`(Haiku 전환, 2026-08-06) — 5주 방치. 살릴지 버릴지 결정 필요 | `origin/chore/ai-model-cost-comparison` (01da14a, main 대비 1 ahead) |
| P3-2 | **`GEMINI_API_KEY` 가 `.env.local` 에 있으나 코드에서 미사용** — 실험 잔재, 제거 권장 | grep 0 hits; 실험 문서 `docs/ai-prompt-revision-negative-result` 잔재 |
| P3-3 | 미사용 문서화 env: `STUDENT_APP_SCHEME`·`TEACHER_APP_URL`·`STRIPE_*`·`REVENUECAT_API_KEY`·`PRICE_*`(가격은 `pricing.ts`/SQL 이 정본) | 3c 표 |
| P3-4 | **`schema.sql` 은 손유지 미러** — 구조적 드리프트 위험. 이번엔 일치 확인(§1) | — |
| P3-5 | `AI_CHECK_RESULTS_ENABLED` 가 shared 와 Edge Function 에 **쌍둥이 상수** — 스키마 테스트가 드리프트를 잡지만 유지보수 함정 | featureFlags.ts:38 ↔ ai-homework-check/index.ts:70 |
| P3-6 | `notify_*` 트리거 5종 실행 테스트 없음(문자열만). **단, 본 리뷰에서 실제 발화 확인**(§2-c) — 죽은 기능이 아니라 자동 테스트만 부재 | m7.schema.test.ts:45-49 |
| P3-7 | `ai_check_usage()` 등 사용량 미터 RPC 테스트 전무 | schema 2197 |

---

## 영역 1 — 레포·브랜치 위생

| 항목 | 결과 |
|---|---|
| 열린 PR | **없음** (`gh pr list --state open` → 0) |
| main tip | `aacfd7b` (PR #52 머지). A1~A5.1 전부 포함 |
| 커밋 안 된 로컬 변경 / 추적 안 되는 파일 | **없음** (`git status` clean) |
| 마이그레이션 이력 정합 | **50/50 일치**, 차집합 양쪽 공집합. `pnpm sb migration list` 전 행 `Local == Remote`. `db push --dry-run` → **`Remote database is up to date.`** |
| `database.types.ts` ↔ 현재 스키마 | 원격에서 재생성 → **committed 와 0 diff** (byte 동일) |
| `schema.sql` 미러 | schema.test 계열 전부 통과 + A5/A5.1 객체 실측 확인. 손유지라 구조적 드리프트 여지는 있음(P3-4) |
| 배포 Edge Function ↔ 레포 소스 | `ai-homework-check` v7 / `account-delete` v5 — **다운로드 소스가 레포와 byte 동일**(anthropic.ts·index.ts·observation.ts·_shared/cors.ts 전부 "동일") |

**미머지 작업물 (남은 작업 후보):**

| 브랜치 | main 대비 | 내용 | 판단 |
|---|---|---|---|
| `origin/fix/teacher-mobile-accept-rpc-stacked` | 1 ahead | teacher-mobile 수락을 `accept_connection_request` RPC 로 전환(Codex, 테스트 포함) | **P1-1** — 머지 대기. 현재 main 의 teacher-mobile 은 옛 2단계 수락(영역 4) |
| `origin/chore/ai-model-cost-comparison` | 1 ahead | 숙제검사 모델 Haiku 4.5 전환(2026-08-06) | **P3-1** — 5주 방치. 살릴지 결정 필요 |
| 그 외 로컬 브랜치 다수 | — | 전부 origin/main 에 병합됨(내용 중복) | 정리 대상(위험 없음) |

**미배포 Edge Function**: 레포에 `billing-stripe`·`iap-webhook` 소스가 있으나 배포되지 않음(둘 다 501 stub). 결제 미구현 상태와 일치 → **P2-1**.

---

## 영역 2 — 유저플로우 실행 점검

통합 테스트 **12개 파일 전부 통과**(실 DB 상대). 그 위에 서버측 플로우를 직접 실행해 단계별로 확인했다.

| 흐름 | 단계 | 결과 | 방법 |
|---|---|---|---|
| **a** 인증 | 로그인 | **성공** | 모든 통합 테스트가 실계정 `signInWithPassword` 로 로그인 후 검증 |
| a | 가입 + 동의 기록 | **성공** | 동의 2건 기록 실측(§h). 클라이언트 필수-동의 게이트는 `canProceedWithConsent`(consent.test.ts) |
| a | 비밀번호 재설정 | **실행 불가(사유)** | `resetPasswordForEmail` 은 메일 발송 — 수신함 없이는 링크 확인 불가. 코드 경로는 `m1Screens.tsx` 존재 |
| a | 로그아웃 | **실행 불가(사유)** | `supabase.auth.signOut()` 클라이언트 로컬 동작 — 서버 상태 없음, SQL 로 관측 불가 |
| **b** 연결 | 초대 발급 | **성공** | 교사 `invite_codes` INSERT |
| b | 학생 코드 사용 | **성공** | `request_connection_by_invite` → `ok=true reason=created status=pending` |
| b | 교사 수락(RPC) | **성공** | `accept_connection_request` → `status=active` + 설정행 1건(원자적) |
| b | 연결 해제 | **성공** | `status=disconnected` |
| b | 해제 후 접근 차단 | **성공** | 해제 후 교사가 학생 공부기록 조회 **0건**; 해제 후 숙제 출제 **42501 차단** |
| **c** 숙제 | 출제 → 학생 알림 | **성공** | todo 출제 시 학생에게 `homework` 알림 1건(트리거, 실측 §알림) |
| c | 제출(사진) | **성공** | 본인 폴더 경로 제출 → 교사에게 `homework` 알림 1건 |
| c | AI 검사(503) | **성공(일시정지 확인)** | Edge Function 실호출 → **HTTP 503 `ai_check_paused`** (AI 호출·과금·attempt 슬롯 이전에 차단) |
| c | 교사 수동 검사·완료 | **성공** | `teacher_status=confirmed` → 학생에게 `check_done` 알림 1건 |
| **d** 공부기록 | 생성 → 교사 뷰 반영 | **성공** | 학생 세션 생성 → `v_teacher_study_sessions` 반영 |
| d | 공개범위 변경 → 반영 | **성공** | `share_study_time=false` → 교사 뷰 **0건** |
| **e** 리포트 | 생성 → 토큰 → 웹뷰 → 무효화 | **성공** | 생성 → `create_report_share` 토큰 → 익명 `get_shared_report` 스냅샷 반환 → `revoke_report_share` 토큰 제거 |
| e | 발급 한도 | **미확인** | `enforce_report_quota` 트리거 존재하나 이번에 한도 초과는 실행 안 함(P2-5 계열) |
| **f** 운영 | 수업료 기록·납부 토글 | **성공** | `paid=true` |
| f | 수업 노트 | **성공** | `lessons` INSERT |
| f | 알림 읽음 | **성공** | 학생 알림 `read=true` |
| **g** 탈퇴 | 탈퇴 → 큐 적재 → sweep | **성공** | `delete_my_account`(m7 커버) + BEFORE DELETE 트리거 적재 + `account-delete` sweep 직접 실행(이번 리뷰에서 46행 처리, no-op 삭제) |
| g | 데이터·사진 잔존 | **잔존 0** | 최종 `storage.objects` 0, 테스트 계정 잔여 0 |
| **h** 동의 | 필수 미동의 가입 차단(클라) | **성공(클라)** | `canProceedWithConsent` — 서버 강제는 없음(A5 §3, 설계 옵션만) |
| h | 기록 행 생성 | **성공** | 본인 동의 2건(`terms_of_service`·`privacy_policy`, `draft-0`) |

> ⚠️ **알림은 실제로 발화한다.** 병렬 리뷰가 "아직 안 울릴 것"으로 추정했으나, RLS 없이(postgres)
> 집계한 실측은 학생 `homework:1, check_done:1, connection:1` / 교사 `homework:1, connection:1`.
> `notify_*` 트리거 5종은 end-to-end 로 동작한다. 부재한 것은 **자동 실행 테스트**뿐이다(P3-6).
> (RLS 때문에 다른 사용자로 로그인해 조회하면 0건으로 보이는 함정이 있어, 집계는 postgres 로 했다.)

---

## 영역 3 — 죽은 코드·플래그·환경

### 3a. 고아 라우트 (진입점 0)

| 앱 | 라우트 | 근거 |
|---|---|---|
| student | `/system` | `app/system.tsx` 참조 0건 |
| student | `/focus/report` | `app/focus/report.tsx:4` (`mode="report"`) — push 되는 건 `/focus/summary` 뿐 |
| student | `/todo/[id]/edit` | 네비게이션 타깃 0건 |
| student | `/report` | 인앱 링크 0 — push 딥링크(`m7.ts:76`)로만. 코드가 "고아 확정"으로 주석(`m6Screens.tsx:63`) |
| teacher | `/onboarding/first-student` | 온보딩은 profile→`/` 직행(`m1.tsx:71`). 링크 0 |
| teacher | `/students/demo/settings` | 하드코딩 `demo` 경로, 링크 0 |

두 교사 고아는 `M1_ROUTE_MANIFEST`(m1.ts:59,64) + `page.test.ts:19,22` 가 존재를 잠가 둠 → 진입 배선 or (라우트+매니페스트+테스트) 제거 결정 필요. **라우트 없는 진입점(깨진 링크)은 세 앱 모두 0건.**

### 3b. 기능 플래그 (전 3개, 전부 `packages/shared/src/featureFlags.ts`)

| 플래그 | 값 | 사용처 | 의도-값 일치 |
|---|---|---|---|
| `AI_CHECK_RESULTS_ENABLED` | `false` | student m4Screens, teacher m4.tsx, **쌍둥이** ai-homework-check/index.ts:70 | 일치 — 스키마 테스트가 쌍둥이 드리프트 감시 |
| `AD_UNLOCK_ENABLED` | `false` | student m5Screens:114 | 일치 — 서버도 fail-close(20260816010000) |
| `AI_REC_CLIENT_WRITE_ENABLED` | `false` | student m5Screens:164 | 일치 — 서버가 쓰기 차단(20260816020000) |

정의-미사용/사용-미정의/의도-모순 **없음**. 요청서의 세 플래그가 전부이고, 추가 플래그 없음.

### 3c. 환경 변수 (요지)

- **used-but-undocumented**: `AI_OBSERVATION_INCLUDE_SCOPE`, `BROWSER_ALLOWED_ORIGINS` (P2-3)
- **documented-but-unused**: `STRIPE_*`·`REVENUECAT_API_KEY`(stub 대기), `PRICE_*`(정본은 `pricing.ts`), `STUDENT_APP_SCHEME`(app.json 중복), `TEACHER_APP_URL`(코드 미참조)
- **`.env.local` 에 있으나 미사용·미문서화**: `GEMINI_API_KEY` (P3-2)
- **앱별 `.env.example`**: teacher-mobile 만 존재 (P2-4)
- `SUPABASE_URL`/`SUPABASE_ANON_KEY` 는 Supabase 런타임 자동 주입(정상적 미문서)

### 3d. TODO/mock/stub (핵심만)

| file:line | 유형 | 위험 |
|---|---|---|
| `m2.ts:174` | TODO(M8) | streak 시간대 미보정 → 한국 자정 경계 오산 (P2-6) |
| `m7Screens.tsx:223,231` | mock | 푸시 토큰 mock → 실기기 전송 불가 (P1-2) |
| `billing-stripe/index.ts:16` · `iap-webhook/index.ts:12` | stub 501 | 실 결제 경로 없음 (P2-1) |
| `m4.ts:77`·`m5.ts:21,83` | stub fn | 클라 가짜 AI 출력 — 플래그로 숨겨짐/서버 차단, 플래그 뒤집으면 위험 |

`FIXME`/`HACK`/`XXX` 마커는 레포 전체 0건. 마이그레이션의 `mock` 언급은 이미 제거된 구멍의 **문서**임.

---

## 영역 4 — 계약 일치

### 4a. RPC 시그니처 ↔ 클라이언트 (프로덕션 호출 11개)

전수 대조 결과 **인자명·인자수·반환 형태 불일치 0건**. 생성 타입도 일치.
(`my_consent_status`, `request_connection_by_invite`, `get_peer_study_ranking`, `save_focus_check`,
`pending_connection_requests`, `accept_connection_request`, `report_monthly_usage`,
`create_report_share`, `revoke_report_share`, `generate_teacher_invoice`, `get_shared_report`.)

### 4b. A-시리즈에서 바꾼 계약의 옛 호출 잔재

| 계약 | 잔재 | 결과 |
|---|---|---|
| `request_connection_by_invite` (row→jsonb `{ok,reason,connection}`) | 0건 | ✅ 유일 호출 `m1Screens.tsx:493` 신형(`describeInviteRedeemResult`) |
| `fail_homework_check_attempt` (+5 인자) | 0건 | ✅ 유일 호출 `ai-homework-check/index.ts:303-311` 7인자 전달 |
| `accept_connection_request` (2단계 대체) | **1건** | ❌ **teacher-mobile `connectionRequestsScreen.tsx:142,157` 이 옛 2단계 수락 유지** → **P1-1** (web `m1.tsx:1223` 는 전환 완료) |

### 4c. Edge Function 계약 ↔ 클라이언트

- `ai-homework-check`: 요청 `{submissionId, idempotencyKey?}` 일치. 게이트·한도 오류코드(402/403/409/429/404)는 전부 클라 매핑됨. **미매핑**: `ai_check_paused`(503)·`observation_discarded`(502) → 제네릭 "제출은 저장됨" 메시지로 graceful fallback(크래시 아님). AI 재활성화 시 전용 문구 권장 → P3.
- `account-delete`: 세 앱 모두 정상 호출. 부분 사진삭제 실패 시 **207** 반환을 클라가 성공 처리(계정은 삭제됨, 잔여는 큐로 sweep) — 정상.

---

## 영역 5 — 테스트 갭 (목록만)

### 실행 테스트 있는 것 (A1.6 교훈 — AI 파이프라인은 전부 닫힘)
`request_connection_by_invite`, `accept_connection_request`, `start/claim/complete/fail/record_homework_check_attempt`, `apply_homework_ai_verdict`, `has_active_student_premium`, `create_report_share`, `get_shared_report`, `generate_teacher_invoice`, `get_peer_study_ranking`, `save_focus_check`, `delete_my_account` — 전부 실행 테스트 존재.
가드: `guard_student_todo_source_lock`·`guard_locked_todo_delete`·`guard_profile_immutable_fields`·`guard_homework_submission_fields`·`guard_homework_check_attempt_writes` — 전부 실행 가드 테스트 존재. 연결 INSERT-RPC-only·초대 시도제한·리포트 토큰 동결·사진 경로 스코프·focus 공개 게이트도 실행 커버.

### 실행 테스트 없는 것 (위험순)

| 대상 | 커버리지 | 위험 | 등급 |
|---|---|---|---|
| `account-delete` 정상경로 + sweep, `claim_storage_purge_batch`(테스트 전무)·`complete_storage_purge`·`storage_paths_for_prefix` | 문자열/전무 | 되돌릴 수 없는 사진 삭제·스코프 위반 = 남의 파일 삭제. A1.6 와 동형 | **P1-3** |
| `ai-homework-check` 503 스위치·DB_ERROR_MAP→HTTP·fail-with-cost 배선 | 문자열/전무 | 이중과금·한도 오매핑이 실제로 실리는 층 | P2 |
| `enqueue_storage_purge_on_profile_delete`(탈퇴 시 큐 적재 보장) | 탈퇴는 호출하나 **큐 행 생성 미단정** | 삭제 안전망 2차선 미검증 | P1(P1-3 동반) |
| `revoke_report_share`(토큰 무효화) | 문자열만 | 학부모 웹뷰 프라이버시 통제 — 무효화가 실제로 막는지 미증명(본 리뷰서 수동 확인) | P2-5 |
| `pending_connection_requests`(교사 인박스·학생 이름) | 문자열만 | 교차 교사 유출 미검증 | P2-5 |
| `my_consent_status` + 동의 RLS | 문자열만 | GDPR/보호자 동의 DB 행위 미검증 | P2 |
| `enforce_report_quota` + `report_monthly_quota/usage` | 없음/텍스트 | 리포트 발급 한도 미검증 | P2 |
| fail-closed 표 3종 행위 테스트 | "정책 없음" 텍스트만 | 나중 stray grant 를 텍스트 테스트가 못 잡음 | P2-8 |
| `exam_records`·`lessons`·`report_deliveries` RLS | 통합 테스트 파일 없음 | 소유 정책 미검증 | P2 |
| `notify_*` 5종 | 문자열만 | **본 리뷰서 발화 실측 완료**(§2). 자동 테스트만 부재 | P3-6 |
| `ai_check_usage()` | 전무 | 사용자 노출 비용 미터 무커버 | P3-7 |

---

## 확인 불가 / 범위 밖

| 항목 | 사유 |
|---|---|
| 비밀번호 재설정 메일 링크 | 수신함 없이 확인 불가(코드 경로는 존재) |
| 로그아웃 서버 관측 | 클라이언트 로컬 동작 |
| 화면 실제 렌더 | 이번은 서버·계약·실행 리뷰. UI 렌더는 별도(빌드·타입·통합 테스트로 갈음) |
| 리포트 발급 한도 초과 동작 | 이번에 한도까지 채우지 않음(트리거 존재만 확인) |
| Edge Function 층 진짜 Storage 실패 | A5 와 동일 — 인위 유발 수단 없음. RPC 계층서 검증됨 |
