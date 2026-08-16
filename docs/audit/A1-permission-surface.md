# A1 — 권한면 전수 조사 + ad_unlocks 실패-폐쇄

작성: 2026-08-16 · 기준 커밋: `d5c8b1f` (main)
Supabase: `khssgcagudjimrezebxq` 단일 프로젝트만 접근
변경 범위: ad_unlocks 정책·권한 / 광고 언락 UI 플래그 / 이 보고서 — **그 외 없음**

---

## 1. ad_unlocks 수정 내역

마이그레이션: **`supabase/migrations/20260816010000_ad_unlocks_fail_closed.sql`** (원격 DB 적용 완료)
mirror: `supabase/schema.sql:1458-1466`

### before (2026-08-16 적용 전, `pg_policies` 실측)

```
policyname : unlock_self
cmd        : ALL
roles      : {public}
qual       : (student_id = auth.uid())
with_check : (student_id = auth.uid())
```

테이블 권한(`information_schema.role_table_grants` 실측):

| grantee | 권한 |
|---|---|
| anon | DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE |
| authenticated | DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE |
| service_role | (동일 전부) |

정책 조건은 "본인 행 한정"이 맞다. 그런데 **본인이 스스로 발급하는 것이 곧 우회**다 —
소유 검증은 광고를 봤는지를 증명하지 못한다. 이게 A0 에서 지적된 구멍이다.

### after (적용 후 실측)

```
policyname : ad_unlocks_select_self
cmd        : SELECT
roles      : {authenticated}
qual       : (student_id = auth.uid())
with_check : null
```

| grantee | 권한 |
|---|---|
| anon | **(없음)** |
| authenticated | SELECT, TRIGGER |
| service_role | DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE |

- INSERT/UPDATE/DELETE 정책을 **만들지 않았다.** RLS 가 켜진 표에서 해당 명령의 정책이 없으면
  기본 거부다. 정책을 만들어 조건으로 막는 것보다 아예 없는 편이 실수로 완화될 여지가 적다.
- 정책 아래 테이블 권한도 회수했다(이중 방어). 정책만 고치면 나중에 정책이 추가되는 순간 열린다.
- SELECT 를 남긴 이유: `useGatedFeature`(`apps/student/src/m5Screens.tsx:65`)가 이 표를 읽는다.
  조회가 막히면 게이트가 "오류로 잠김"이 되어 왜 안 열리는지 알 수 없다.
- `authenticated` 에 `TRIGGER` 가 남아 있다. Supabase 기본 부여값이고 **다른 모든 표에도 동일**하다.
  쓰기 정책이 없는 표에 트리거를 걸어도 쓸 수 없으므로 쓰기 경로가 아니며,
  이 표만 예외로 두면 일관성이 깨져 그대로 두었다.

### 기존 행

`select count(*) from ad_unlocks` → **0행** (적용 전·후 모두). 삭제한 행 없음.

### 왜 "서버 발급만 허용"이 아니라 발급 자체를 막았는가

광고 시청 완료를 검증하는 서버 경로가 **없다.** 클라이언트가
`apps/student/src/m5Screens.tsx:88` 에서 `NOTE(mock): 실제 리워드 광고 SDK 대신, 시청 완료를
가정하고 언락을 기록한다` 라고 명시한 채 행을 넣을 뿐이다. 검증자가 없는데 발급구만 좁히면
"누가 넣었나"만 바뀌고 "정말 봤나"는 여전히 아무도 모른다.

### 클라이언트 UI

| 파일 | 내용 |
|---|---|
| `packages/shared/src/featureFlags.ts:78` | `export const AD_UNLOCK_ENABLED = false;` |
| `packages/shared/src/featureFlags.ts:81` | `AD_UNLOCK_DISABLED_NOTICE = "지금은 광고 보고 열기를 쓸 수 없어요."` |
| `apps/student/src/m5Screens.tsx:114` | `{AD_UNLOCK_ENABLED && gate.canUnlockByAd ? …}` — "광고 보고 무료로 열기" 버튼 숨김 |
| `apps/student/src/m5Screens.tsx:123` | 구독 버튼 문구를 "월 구독하고 무제한으로 쓰기" 로 교체(광고 언급 제거) |
| `apps/student/src/m5Screens.tsx:128` | 힌트를 `AD_UNLOCK_DISABLED_NOTICE` 로 교체 |

광고 언락 UI 는 **학생 앱에만** 있다. 과외쌤 웹·teacher-mobile 에서 `ad_unlocks`·`광고` 검색 결과 0건.

가드 테스트 4건 추가: `packages/shared/src/m5.test.ts` — for all 제거 / 쓰기 정책 부재 /
권한 회수 / 플래그 off 를 각각 단정한다.

---

## 2. 음성 테스트 결과

anon key 와 실제 학생 토큰으로 PostgREST 를 직접 호출했다.
3·4·5 번은 대상 행이 필요해 service_role 로 임시 1행을 심고 테스트 후 삭제했다(잔여 0행 확인).

| # | 실행 명령 | 기대 | 실제 | 판정 |
|---|---|---|---|---|
| 1 | `curl -X POST '…/rest/v1/ad_unlocks' -H 'apikey: <ANON_KEY>' -d '{"student_id":"<A_ID>","feature":"report"}'` | 실패 | **401** `42501 permission denied for table ad_unlocks` | ✅ 차단 |
| 2 | `curl -X POST '…/rest/v1/ad_unlocks' -H 'apikey: <ANON_KEY>' -H 'Authorization: Bearer <A_TOKEN>' -d '{"student_id":"<A_ID>","feature":"ai_rec"}'` | 실패 | **403** `42501 permission denied for table ad_unlocks` | ✅ 차단 |
| 3 | `curl '…/rest/v1/ad_unlocks?student_id=eq.<A_ID>&select=*' -H 'Authorization: Bearer <B_TOKEN>'` | 남의 행 안 보임 | **200 `[]`** (A 의 행이 실재하는데도 0건) | ✅ 차단 |
| 4 | `curl -X PATCH '…/rest/v1/ad_unlocks?id=eq.<ROW_ID>' -H 'Authorization: Bearer <A_TOKEN>' -d '{"expires_at":"2099-01-01T00:00:00Z"}'` | 실패 | **403** `42501 permission denied for table ad_unlocks` | ✅ 차단 |
| 5 | `curl -X DELETE '…/rest/v1/ad_unlocks?id=eq.<ROW_ID>' -H 'Authorization: Bearer <A_TOKEN>'` | 실패 | **403** `42501 permission denied for table ad_unlocks` | ✅ 차단 |
| 5b | `curl '…/rest/v1/ad_unlocks?select=*' -H 'Authorization: Bearer <A_TOKEN>' ` | 본인 행은 보임 | **200** 1건 반환 | ✅ 의도대로 |

**1~5 전부 차단 확인. 완료 기준 충족.**

### 6번 — 클라이언트 게이트가 지키는 데이터 (실태 기록만, A2 대상)

| # | 실행 명령 | 실제 | 의미 |
|---|---|---|---|
| 6a | `curl '…/rest/v1/study_sessions?select=id,subject,duration_sec,started_at&limit=5' -H 'Authorization: Bearer <A_TOKEN>'` | **200 `[]`** | **접근은 허용됐다.** 빈 배열인 이유는 탐침 계정에 세션 데이터가 없어서다. 정책이 본인 행을 허용하므로 데이터가 있으면 그대로 나온다 |
| 6b | `curl '…/rest/v1/ai_recommendations?select=*&limit=5' -H 'Authorization: Bearer <A_TOKEN>'` | **200 `[]`** | 동일 — 접근 허용, 데이터가 없었을 뿐 |
| 6c | `curl -X POST '…/rest/v1/ai_recommendations' -H 'Authorization: Bearer <A_TOKEN>' -d '{"student_id":"<A_ID>","week_start":"2026-08-10","subject":"math","recommended_hours":5,"reason":"probe"}'` | **201 Created** (행 생성됨, 테스트 후 삭제) | **학생이 AI 추천 결과를 직접 써 넣을 수 있다** |

즉 "나의 리포트"·"AI 추천"의 잠금은 화면 렌더링만 막는다. 원본 데이터(`study_sessions`)는
읽히고, 추천 결과 저장소(`ai_recommendations`)는 **쓰기까지** 된다. 지시대로 이번엔 고치지 않았다.

### 7번 — 조사 중 발견한 별건 (계획에 없던 탐침)

| # | 실행 명령 | 실제 |
|---|---|---|
| 7 | `curl -X POST '…/rest/v1/rpc/apply_homework_ai_verdict' -H 'apikey: <ANON_KEY>' -d '{"p_submission_id":"00000000-…-0000","p_verdict":"pass","p_confidence":1,"p_reason":"probe"}'` | **400** `P0001 homework_submission_not_found` |

400 은 **권한 거부가 아니라 함수 본문이 실행된 결과**다. 즉 anon 이 이 SECURITY DEFINER 함수를
호출할 수 있다. 존재하지 않는 id 를 써서 데이터는 바꾸지 않았다. 상세는 §3-4·§4 참조.

---

## 3. 권한면 조사 결과

### 3-1. Supabase security advisors 전문 (HTTP 200, lint 63건)

| level | name | 건수 | 대상 |
|---|---|---|---|
| ERROR | `security_definer_view` | 2 | `v_teacher_study_sessions`, `v_teacher_focus_checks` |
| WARN | `anon_security_definer_function_executable` | 17 | 아래 §3-4 |
| WARN | `authenticated_security_definer_function_executable` | 23 | 아래 §3-4 |
| WARN | `function_search_path_mutable` | 14 | `ai_check_window_days`, `ai_check_max_attempts_per_month`, `ai_check_max_photos_per_month`, `current_role_is`, `price_per_student_krw`, `ai_check_max_attempts_per_submission`, `ai_check_max_attempts_per_day`, `homework_photo_quota_window_days`, `homework_photo_quota_objects`, `homework_photo_quota_bytes`, `homework_photo_retention_days`, `touch_exam_records_updated_at`, `report_quota_per_student`, `report_quota_floor` |
| WARN | `auth_leaked_password_protection` | 1 | HaveIBeenPwned 대조 비활성 |
| INFO | `rls_enabled_no_policy` | 2 | `report_views`, `storage_purge_queue` |

- `security_definer_view` 2건은 **의도된 설계**다. 두 뷰는 공개범위(`disclosure_settings`)를
  서버에서 강제하기 위한 게이팅 뷰다. invoker 로 두면 게이팅이 무의미해진다.
- `function_search_path_mutable` 14건은 전부 인자 없는 `immutable` 상수 함수(`select 40` 류)다.
  본문이 테이블·연산자를 참조하지 않아 search_path 주입 표면이 없다.
- `rls_enabled_no_policy` 2건은 **정책 0개가 의도**다(클라이언트가 읽으면 안 되는 표).

### 3-2. RLS 가 꺼진 public 테이블

```sql
select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='r' and c.relrowsecurity = false;
```
→ **0건.** public 스키마의 모든 테이블에 RLS 가 켜져 있다.

### 3-3. FOR ALL 정책 전체 (판정 포함)

`ad_unlocks` 제거 후 **18개**. "FOR ALL = 취약"이 아니라 조건이 무엇을 보장하는지로 판정했다.

| 테이블 | 정책 | 조건 요약 | 판정 |
|---|---|---|---|
| `profiles` | `profiles_self_rw` | `id = auth.uid()` | 정상 — 본인 행 한정 |
| `study_sessions` | `sessions_student_rw` | `student_id = auth.uid()` | 정상 |
| `timetable_blocks` | `tt_student_rw` | `student_id = auth.uid()` | 정상 |
| `notifications` | `notif_self` | `user_id = auth.uid()` | **조건부** — 본인 행 한정이나 INSERT 도 허용이라 **자기 자신에게 가짜 알림을 만들 수 있다**. 피해가 자기 화면에 한정돼 등급을 낮춤 |
| `push_tokens` | `push_self` | `user_id = auth.uid()` | 정상 |
| `homework_submissions` | `subs_student_rw` | `student_id = auth.uid()` | **조건부** — 트리거 `guard_homework_submission_fields()` 가 `ai_*`·`teacher_*` 컬럼 직접 수정을 막는다. 그 트리거가 유일한 방어선이다 |
| `todos` | `todos_student_rw` | `student_id = auth.uid()` | **조건부** — 트리거 `guard_student_todo_source_lock()` 가 `source='teacher'` 숙제의 학생 편집을 막는다 |
| `todos` | `todos_teacher_rw` | `connection_id` 의 teacher + `status='active'` | 정상 — 소유 + 활성 연결 이중 확인 |
| `invite_codes` | `invite_owner` | `teacher_id = auth.uid()` | 정상 |
| `lesson_fees` | `fees_teacher_rw` | `teacher_id = auth.uid()` | 정상 |
| `lessons` | `lessons_teacher_rw` | `teacher_id = auth.uid()` **AND** active 연결 | 정상 — teacher_id 만 보면 남의 학생 id 로 행을 만들 수 있는데 그걸 막았다 |
| `exam_records` | `exam_records_teacher_rw` | 위와 동일 | 정상 |
| `reports` | `reports_teacher_rw` | `teacher_id = auth.uid()` **OR** active 연결 | **조건부** — OR 이라 teacher_id 를 자기로 넣으면 통과. 학생 id 는 임의로 넣을 수 있으나 연결 없는 학생의 리포트는 조회·발송 경로가 없어 실익이 없다. 발급 한도 트리거가 남용을 별도로 막는다 |
| `report_deliveries` | `report_deliveries_teacher_rw` | 부모 `reports.teacher_id = auth.uid()` | 정상 |
| `disclosure_settings` | `disclosure_student_rw` | 그 연결의 **학생**만 | 정상 — 과외쌤은 읽기 전용(별도 정책) |
| `per_student_settings` | `pss_teacher_rw` | 그 연결의 **과외쌤**만 | 정상 |
| `focus_checks` | `focus_student_rw` | 부모 `study_sessions.student_id = auth.uid()` | 정상 |
| `ai_recommendations` | `airec_student_rw` | `student_id = auth.uid()` | **뚫림** — 본인 행 한정이지만 **INSERT 가 허용**이라 학생이 유료 기능(AI 추천)의 결과를 직접 써 넣을 수 있다. §2-6c 에서 201 로 실증 |

### 3-4. anon·authenticated EXECUTE 함수 전체 (42개)

`definer` = SECURITY DEFINER 여부, `config` = search_path 설정.

| 함수 | grantee | definer | search_path |
|---|---|---|---|
| `apply_homework_ai_verdict` | **anon** | ✅ | public |
| `can_teacher_read_focus_check` | anon+auth | ✅ | public |
| `create_report_share` | anon+auth | ✅ | public |
| `delete_my_account` | anon+auth | ✅ | public |
| `enforce_report_quota` | anon+auth | ✅ | public |
| `enqueue_storage_purge_on_profile_delete` | anon+auth | ✅ | public |
| `generate_teacher_invoice` | anon+auth | ✅ | public |
| `get_peer_study_ranking` | anon+auth | ✅ | public |
| `get_shared_report` | anon+auth | ✅ | public |
| `guard_homework_check_attempt_writes` | anon+auth | ✅ | public |
| `guard_homework_submission_fields` | anon+auth | ✅ | public |
| `guard_student_todo_source_lock` | anon+auth | ✅ | public |
| `is_connected_active` | anon+auth | ✅ | public |
| `notify_connection_change` | anon+auth | ✅ | public |
| `notify_homework_reviewed` | anon+auth | ✅ | public |
| `notify_homework_submitted` | anon+auth | ✅ | public |
| `notify_report_sent` | anon+auth | ✅ | public |
| `notify_teacher_homework_assigned` | anon+auth | ✅ | public |
| `request_connection_by_invite` | anon+auth | ✅ | public |
| `ai_check_usage` | auth | ✅ | public |
| `homework_photo_upload_allowed` | auth | ✅ | public, storage |
| `homework_photo_usage` | auth | ✅ | public, storage |
| `pending_connection_requests` | auth | ✅ | public |
| `report_monthly_quota` / `report_monthly_usage` | auth | ✅ | public |
| `revoke_report_share` | auth | ✅ | public |
| `has_active_student_premium` | auth | ❌ INVOKER | public |
| `save_focus_check` | anon+auth | ❌ | public |
| `current_role_is` | anon+auth | ❌ | (없음) |
| `price_per_student_krw` · `ai_check_max_*` · `ai_check_window_days` · `report_quota_*` · `homework_photo_quota_*` · `homework_photo_retention_days` · `touch_exam_records_updated_at` | anon+auth | ❌ | (없음) |

관찰:
- **트리거 함수 9개**(`notify_*` 5, `guard_*` 3, `enqueue_storage_purge_*`, `enforce_report_quota`)가
  anon+authenticated 에 EXECUTE 가 열려 있다. 트리거 전용 함수는 `returns trigger` 라
  RPC 로 직접 호출하면 PostgREST 가 거부한다(반환형 불가). 실질 위험은 낮지만
  **불필요한 권한**이고 advisor 가 40건 중 대부분을 이걸로 경고한다.
- `apply_homework_ai_verdict` 만 grantee 가 **anon 단독**이다(authenticated 에는 없음).
  Edge Function 이 service_role 로 부르는 것을 전제한 함수인데 anon 에 열려 있다. §4 참조.

### 3-5. mock 구독 RPC 3개의 현재 상태

| 함수 | 존재 | definer | grantees | 내부 체크 |
|---|---|---|---|---|
| `mock_set_student_subscription(sub_status, timestamptz)` | ✅ 남아 있음 | ✅ | **postgres, service_role 뿐** | `if auth.uid() is null then raise exception 'authentication_required'` |
| `mock_set_teacher_subscription(sub_status)` | ✅ 남아 있음 | ✅ | **postgres, service_role 뿐** | 동일 |

**두 함수는 사실상 죽어 있다.** anon·authenticated 에 EXECUTE 가 없어 클라이언트가 못 부르고,
service_role 로 부르면 `auth.uid()` 가 null 이라 `authentication_required` 로 실패한다.
즉 지금 이 RPC 로 구독 상태를 만들 수 있는 주체가 **아무도 없다**. (개발용으로 쓰려면
`scripts/dev-set-subscription.mjs` 처럼 테이블을 직접 쓰는 경로가 필요하다.)

### 3-6. `generate_teacher_invoice` 의 anon EXECUTE 실태

grantees: `anon, authenticated, postgres, service_role` — **anon 에 열려 있다(확인).**

내부 체크 원문:
```sql
if auth.uid() is null then raise exception 'authentication_required'; end if;
select count(*)::integer into active_count
  from connections where teacher_id = auth.uid() and status = 'active';
insert into billing_invoices (teacher_id, period, student_count, amount, status)
values (auth.uid(), p_period, active_count, active_count * price_per_student_krw(), 'open')
```

anon 은 `auth.uid()` 가 null 이라 첫 줄에서 막힌다 → **실질 공격 경로 아님.**
다만 `authenticated` 는 통과하므로 **과외쌤이 자기 인보이스를 임의 시점에 몇 번이든 발행**할 수 있다.
`on conflict (teacher_id, period) do update` 라 같은 달은 덮어써지므로 행이 무한히 늘지는 않는다.

### 3-7. Storage 버킷별 정책

버킷은 **1개뿐**: `homework-photos` (`public: false`, 5MB 제한, `image/jpeg|png|webp` 만 허용).

| 정책 | cmd | roles | 조건 |
|---|---|---|---|
| `homework_photos_student_insert` | INSERT | authenticated | `bucket_id='homework-photos' AND homework_photo_upload_allowed(name)` |
| `homework_photos_student_select` | SELECT | authenticated | `(storage.foldername(name))[1] = auth.uid()::text` |
| `homework_photos_student_delete` | DELETE | authenticated | 동일(본인 폴더) |
| `homework_photos_teacher_select` | SELECT | authenticated | active 연결 **AND** `disclosure_settings.share_homework_photos` |

- anon 정책 **0개** — 비로그인 접근 불가.
- UPDATE 정책 **0개** — 덮어쓰기 불가(기본 거부).
- 과외쌤 읽기가 공개범위까지 확인한다. 학생이 사진 공개를 끄면 즉시 안 보인다.
- 판정: **정상.**

### 3-8. Edge Function 배포 목록 (조회만)

`GET /v1/projects/khssgcagudjimrezebxq/functions` → HTTP 200

| slug | version | status | verify_jwt | updated_at |
|---|---|---|---|---|
| `ai-homework-check` | 6 | ACTIVE | true | 1786791991374 |
| `account-delete` | 4 | ACTIVE | true | 1786791979669 |

**`billing-stripe` 와 `iap-webhook` 은 배포 목록에 없다.** 501 스텁은 레포에만 있고
외부에서 호출할 수 없다. (A0 에서 "확인 불가"로 남겼던 항목이 여기서 해소됐다.)
배포된 2개 모두 `verify_jwt: true` — 익명 호출이 게이트웨이에서 막힌다.

### 3-9. `getTeacherBillingState()` 상태별 문구 (`packages/shared/src/m6.ts:22`)

| status | active | restricted | canRecover | label | tone | reason (원문) |
|---|---|---|---|---|---|---|
| `active` | true | false | false | `"이용 중"` | success | `"정상 구독 중이에요."` |
| `past_due` | false | true | true | `"미납"` | danger | `"결제에 실패했어요. 결제수단을 업데이트하면 바로 복구돼요."` |
| `paused` | false | true | true | `"일시정지"` | warning | `"구독이 일시정지 상태예요."` |
| `canceled` | false | true | true | `"해지됨"` | muted | `"구독이 해지되었어요. 다시 시작할 수 있어요."` |
| `none`(default) | false | true | true | `"구독 없음"` | muted | `"앱 구독을 시작하면 학생 관리 기능이 열려요."` |

⚠️ `none` 의 문구가 **사실과 다르다.** "앱 구독을 시작하면 학생 관리 기능이 열려요" 라고 하지만
학생 관리는 구독과 무관하게 열려 있다(A0 §3-15: 어떤 서버 게이트도 `teacher_subscriptions` 를
보지 않는다). `restricted: true` 도 실제로 아무것도 제한하지 않는다.

### 3-10. auth.users 실사용자

```sql
select count(*) as total,
       count(*) filter (where email not like '%@example.com' and email not like '%.test') as non_test
from auth.users;
```
→ **total 15 · non_test 2**

non_test 2건은 `jundragon7@naver.com`(2026-06-23 가입, 최종 로그인 2026-06-24)과
`21jundragon@gmail.com`(2026-06-24 가입, 최종 로그인 2026-06-24) — 둘 다 개발자 본인 계정이다.
나머지 13건은 `@example.com` 테스트 계정(2026-06-23 ~ 2026-08-04 생성).

**외부 실사용자는 0명이다.** 지금까지 확인된 권한 구멍이 실제 피해로 이어지지 않은 이유이자,
지금이 고치기 가장 싼 시점이라는 근거다.

---

## 4. 위험 분류

### [지금 뚫림]

| # | 대상 | 근거 | 영향 |
|---|---|---|---|
| R1 | `apply_homework_ai_verdict` 가 **anon 실행 가능** | §2-7 실측 HTTP 400 `P0001`(권한 거부 아님) · §3-4 grantee=anon · 함수 본문에 **권한 검사 0줄**(`update homework_submissions set ai_verdict=… where id = p_submission_id`) | anon key 만으로 **아무 제출의 AI 판정·확신도·사유를 임의로 덮어쓸 수 있다.** submission id 는 UUID 라 추측이 어렵지만, 학생 본인은 자기 id 를 알고 있어 자기 숙제를 "통과"로 바꿀 수 있다 |
| R2 | `ai_recommendations` 학생 직접 INSERT | §2-6c 실측 HTTP 201 · §3-3 `airec_student_rw` FOR ALL | 유료 기능(AI 추천)의 결과를 학생이 직접 써 넣을 수 있다 |
| R3 | 리포트·AI 추천 게이트가 클라이언트 전용 | §2-6a/6b 실측 HTTP 200 · `m5Screens.tsx:213,127` | 유료 기능의 원본 데이터가 그대로 읽힌다 (A2 대상) |

R1 은 이번 범위(ad_unlocks) 밖이라 **고치지 않았다.** 규칙 2 에 따라 보고만 한다.

### [조건부]

| 대상 | 왜 조건부인가 |
|---|---|
| `homework_submissions` FOR ALL | 트리거 `guard_homework_submission_fields()` 하나가 `ai_*`·`teacher_*` 보호의 전부다. 트리거가 지워지면 즉시 뚫린다 |
| `todos` 학생 FOR ALL | 트리거 `guard_student_todo_source_lock()` 하나에 의존 |
| `reports` FOR ALL (OR 조건) | teacher_id 자기 지정으로 통과 가능. 연결 없는 학생 리포트는 실익이 없고 발급 한도 트리거가 남용을 막는다 |
| `notifications` FOR ALL | 자기 자신에게 가짜 알림 생성 가능. 피해가 자기 화면에 한정 |
| `generate_teacher_invoice` authenticated | 자기 인보이스 임의 발행 가능. `on conflict do update` 라 행 증식은 없음 |
| 트리거 함수 9개 anon EXECUTE | `returns trigger` 라 RPC 호출은 거부되지만 불필요한 권한 |
| `authenticated` 의 `ad_unlocks` TRIGGER 권한 | Supabase 기본값, 전 표 공통. 쓰기 정책이 없어 쓰기 경로는 아님 |

### [정상]

| 대상 | 근거 |
|---|---|
| `ad_unlocks` | **이번에 수정.** §2 음성 테스트 1~5 전부 차단 실증 |
| RLS 커버리지 | public 테이블 중 RLS 꺼진 것 0건 |
| Storage `homework-photos` | anon 0정책, UPDATE 0정책, 과외쌤 읽기에 공개범위까지 확인 |
| 구독 3표(`student_subscriptions`·`teacher_subscriptions`·`billing_invoices`) | SELECT 전용. 클라이언트가 자기 구독 상태를 못 바꾼다 |
| mock 구독 RPC 2개 | 권한 회수 + `auth.uid()` 체크로 **호출 가능한 주체가 없음** |
| `billing-stripe` · `iap-webhook` | **미배포** — 외부 호출 불가 |
| 배포된 Edge Function 2개 | 둘 다 `verify_jwt: true` |
| `has_active_student_premium()` | INVOKER + `expires_at > now()` fail-closed |

---

## 5. 확인 불가 항목과 이유

| 항목 | 이유 |
|---|---|
| Edge Function 시크릿 실제 설정값 | Supabase 시크릿은 API 로 값을 읽을 수 없다. `ANTHROPIC_API_KEY`·`BROWSER_ALLOWED_ORIGINS` 가 설정돼 있는지 확인 불가 |
| R1(`apply_homework_ai_verdict`)의 **실제 악용 가능성 끝까지 확인** | 실제 submission id 로 호출하면 프로덕션 데이터를 변조하게 된다. 존재하지 않는 id 로 "권한이 있다"까지만 확인하고 멈췄다 |
| `authenticated` 롤의 `CREATE ON SCHEMA public` 권한 | 조회하지 않았다. TRIGGER 권한의 실효성 판단에 필요하지만 이번 범위 밖이라 확인하지 않음 |
| 배포된 `ai-homework-check` v6 의 **소스가 레포와 동일한지** | 함수 본문 다운로드를 하지 않았다(조회만 허용 범위를 목록·버전으로 해석). `ezbr_sha256` 은 있으나 레포 산출물과 대조할 기준값이 없다 |
| advisors 의 `auth_leaked_password_protection` 을 켰을 때의 영향 | 설정 변경 금지 범위라 켜보지 않았다 |
| 과거 `ad_unlocks` 로 발급된 언락의 이력 | 현재 0행이고 삭제 이력을 남기는 표가 없다. 과거에 발급된 적이 있는지 확인 불가 |
