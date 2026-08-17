# A4 — 출시 차단 묶음

작성: 2026-08-17 · 분기 기준: `bed7ac7` (**A3 / PR #47 위에 쌓았다** — §6)
Supabase: `khssgcagudjimrezebxq` 단일 프로젝트만 접근
마이그레이션 2개 (둘 다 원격 적용 완료):
- `20260818000000_storage_purge_worker.sql`
- `20260818010000_consent_records.sql`

Edge Function: `account-delete` 재배포 (sweep 모드 수정)
**실제 사용자 사진·데이터 삭제 0건** — 삭제 검증은 이 작업에서 만든 테스트 객체로만 했다.

---

## 1. 작업 1 — 교사 웹 가격 표시 3곳 제거

| # | 위치 | before | after |
|---|---|---|---|
| 1 | `m1.tsx:369-373` 대시보드 StatCard | `label="이번 달 구독료"` · `value={monthlyAmount}원` · `hint="학생당 4,900원"` | 카드 삭제 |
| 2 | `m1.tsx:668-672` 설정 "구독·정산" 패널 | `"이번 달 앱 구독료"` · `{monthlyAmount}원` · `"연동 학생 N명 · 학생당 4,900원"` | 금액 3줄 삭제, 제목만 `"앱 구독"` |
| 3 | `m6.tsx:113-115` 청구 화면 | `"예상 월 청구 = active N명 × ₩4,900 = ₩N"` | 삭제 |

미확정 가격을 화면에 숫자로 박으면 사용자는 확정가로 읽는다. 대체 문구는 넣지 않았다.

정리로 함께 사라진 것: `PRICE_PER_STUDENT_KRW`·`getTeacherMonthlySubscriptionAmount` import,
`monthlyAmount`·`estimated` 변수, `m6.tsx` 의 **불필요해진 connections 조회**
(activeCount 전용이었다 → 쿼리 하나가 줄었다).

지시대로 `pricing.ts` 의 상수 자체는 **남겼다** — AI 한도 예산 계산이 물려 있다.
남은 참조: `pricing.ts` 정의 · `m6.ts` 재수출 · `m4.schema.test.ts` 예산 테스트 · 인보이스 금액 표시
(`m6.tsx:144` `formatKrw(invoice.amount)` — 이건 **실제 발행된 청구서의 금액**이라 확정값이다).

---

## 2. 작업 2 — 보관정리 dry-run (읽기 전용)

**`scripts/storage-retention-dry-run.mjs`** — 아무것도 지우지 않는다. `--json` 지원.

```bash
node scripts/storage-retention-dry-run.mjs
```

### 현재 수치 (2026-08-17 실행)

| 항목 | 값 |
|---|---|
| 버킷 / 보관기간 | `homework-photos` / **180일** (DB 함수가 정본) |
| 전체 객체 | **0건** (0.00 MB) |
| 만료 대상 | **0건** (0.00 MB) |
| 행만 있고 객체 없음 | **0개 경로** |
| 고아 객체(객체만 있고 참조 없음) | **0건** |
| 탈퇴 대기열과 중복 | **0건** |

전부 0 이다. Storage 가 비어 있어서다(실사용자 0명 · 테스트 사진은 매번 정리했다).

### ⚠️ 0 이 "정상" 인지 "못 세는 것" 인지 — 심어서 확인했다

전부 0 인 결과만 보고 "스크립트가 동작한다" 고 말할 수는 없다. 테스트 객체 3개 + 없는 경로
1개를 심고 각 카운터가 실제로 올라가는지 확인했다(끝나고 전부 삭제, 잔여 0).

| 심은 것 | 기대 카운터 | 실측 |
|---|---|---|
| 200일 전 객체 1개(제출이 참조) | 만료 대상 1 | **1** ✅ |
| 방금 올린 객체 1개(제출이 참조) | 만료 아님 | 만료 표본에 없음 ✅ |
| 아무 제출도 참조 안 하는 객체 1개 | 고아 1 | **1** ✅ |
| 제출이 가리키는데 없는 경로 1개 | 행만 있음 1 | **1** ✅ |
| 대기열 행 1개(같은 폴더) | 중복 3 (그 폴더 객체 전부) | **3** ✅ |
| 만료 표본 | `dry-old.png` 만 | **dry-old.png** ✅ |

`created_at` 을 실제로 기다릴 수 없어 `storage.objects.created_at` 을 200일 전으로 직접 세팅해
재현했다.

### 고아 객체를 왜 따로 세는가

객체는 있는데 어떤 제출도 가리키지 않으면 **보관기간을 계산할 기준이 없다.**
`storage.objects.created_at` 은 업로드 시각일 뿐 "어느 숙제의 사진인지" 를 모른다.
만료 대상에 섞으면 "언제 올라온 것인지 모르는 파일" 을 "180일 지난 파일" 로 오판해 지운다.
그래서 별도 분류하고, 처분은 정책 판단에 남긴다.

**삭제 로직·스케줄은 만들지 않았다** — 지시대로 정책(보존 예외, 파일럿 검증용 사진의 별도
동의 보관)이 확정된 뒤다.

---

## 3. 작업 3 — 탈퇴 Storage 대기열 처리기

### 3-1. 현재 구조와 적재 경로 (조사 결과)

| 요소 | 내용 |
|---|---|
| 표 | `storage_purge_queue` — `user_id`·`bucket_id`·`prefix`·`status`·`attempts`·`deleted_count`·`last_error` |
| 안전장치 | `check (prefix = user_id::text \|\| '/')` — 남의 파일을 지울 수 없게 **DB 가** 강제 |
| FK | **없음(의도)** — 사용자가 사라진 뒤에도 행이 살아 있어야 한다 |
| 적재 | `enqueue_storage_purge_on_profile_delete` BEFORE DELETE 트리거 (profiles) |
| 조회·삭제 도우미 | `storage_paths_for_prefix()`(service_role) + Storage API |

**처리기는 이미 있었다.** `account-delete` Edge Function 의 `mode: "sweep"` 이다
(service_role 만 호출 가능). 그래서 **새 함수를 만들지 않고 그것을 고쳤다** — 새로 만들면
같은 일을 하는 표면이 둘이 되고, 어느 쪽이 진짜인지 모르게 된다.

### 3-2. 무엇이 부족했고 무엇을 더했나

| 요구 | before | after |
|---|---|---|
| 멱등 | 삭제 자체는 멱등(지울 게 없으면 0건) | 유지 + `nothing_to_delete` 로 로그에 구분 기록 |
| 동시 실행 | ❌ `.neq("status","done")` 로 직접 읽어 두 sweep 이 같은 행을 처리 | ✅ `claim_storage_purge_batch()` — `for update skip locked` + `claimed_at` 리스(10분) |
| 재시도 | ❌ 오류 즉시 `failed` 로 못 박아 아무도 다시 안 함 | ✅ 최대 **5회** 까지 `pending` 으로 되돌림 |
| 최종 실패 보존 | ❌ (failed 를 매번 다시 집어 무한 재시도) | ✅ 5회 넘기면 `failed` 로 굳히고 **행을 지우지 않음**. failed 는 더 이상 선점되지 않음 |
| 감사 로그 | ❌ 합계·마지막 오류만 | ✅ `storage_purge_log` — 시도별 1행, **삭제한 경로 배열**·결과·오류·시각 |
| 크래시 복구 | ❌ | ✅ 리스 만료(10분) 후 다음 실행이 탈환 |

`storage_purge_log` 는 **클라이언트 정책 0개**다(경로에 학생 UUID 가 들어 있다). 큐 행이 사라져도
남도록 FK 를 걸지 않았다.

### 3-3. 실행 방식 — 수동 트리거(service_role), 스케줄은 사람 몫

**지금은 수동으로 뒀다.** 근거:

- **pg_cron 이 이 프로젝트에 없다**(마이그레이션 전체에 cron 참조 0건). 켜는 것은 대시보드 작업이다.
- **Free 플랜은 미사용 시 프로젝트가 정지된다**(`LAUNCH-CHECKLIST.md` A5). 정지된 프로젝트의
  스케줄은 돌지 않으므로, Pro 전환 **전에** 스케줄을 붙이면 "돌고 있다고 착각" 하게 된다.
- 큐가 채워지는 사건은 **탈퇴뿐**이고 드물다. 정상 경로(`account-delete` 기본 모드)는 이미
  인라인으로 즉시 처리한다. sweep 은 그 경로가 실패했거나 RPC 만 직접 호출된 경우의 **그물**이다.

즉 지금 필요한 것은 "빠짐없이 처리되는 그물" 이고, 그 그물이 자동으로 돌게 만드는 것은
Pro 전환과 같은 시점의 인프라 작업이다. `LAUNCH-CHECKLIST.md` 의 B4 항목이 그것을 가리킨다.

```bash
# 호출 예 (service_role 필요)
curl -X POST 'https://<ref>.supabase.co/functions/v1/account-delete' \
  -H 'apikey: <SERVICE_ROLE>' -H 'Authorization: Bearer <SERVICE_ROLE>' \
  -H 'Content-Type: application/json' -d '{"mode":"sweep"}'
```

### 3-4. 실측 (테스트 객체만 사용)

첫 실행에서 `swept: 20` 이 나오고 내 행이 처리되지 않았다 — 큐에 **과거 테스트 잔재 95행**
(91 done + 4 pending, 전부 사용자가 이미 사라진 행)이 쌓여 있어 20행 예산을 그쪽에 썼다.
storage.objects 가 0건이고 해당 user 가 전부 존재하지 않음을 확인한 뒤 그 잔재를 정리하고 다시 측정했다.
**이 자체가 "처리기가 도는지" 의 증거이기도 하다** — 80행이 `nothing_to_delete` 로 기록됐다.

| # | 시나리오 | 결과 |
|---|---|---|
| 1 | 테스트 객체 2개 업로드 → 큐 적재 → sweep | `deleted: 2` · Storage 잔존 **0** · 큐 `done` `attempts=1` `deleted_count=2` |
| 1 | 감사 로그 | `outcome=deleted` · `attempt_no=1` · **`deleted_paths` 2건** |
| 2 | 같은 행을 pending 으로 되돌려 재처리(멱등) | `deleted: 0` · 오류 없음 · 로그에 `nothing_to_delete` `attempt_no=2` |
| 3 | 실패 사다리 1~4회차 | `status=pending` · `attempts` 1→4 · `last_error` 기록 · **선점 해제**(다음 실행이 즉시 집을 수 있음) |
| 3 | 실패 5회차(최대 도달) | `status=failed` · `attempts=5` |
| 3 | failed 재선점 | **0건** — 무한 재시도 없음 |
| 3 | failed 행 보존 | **1건** — 조용히 버리지 않는다 |
| 3 | 감사 로그 | **5건** 전부 `outcome=failed` + 오류 문자열 |

> ⚠️ **실패 시나리오를 Edge Function 층에서 강제하지 못했다.** 처음 "존재하지 않는 버킷" 으로
> 시도했더니 `storage_paths_for_prefix` 가 빈 목록을 돌려주고 조기 반환해 **실패가 아니라
> `nothing_to_delete`** 가 됐다. Storage API 오류를 인위적으로 만들 수단이 없어,
> 재시도 사다리는 로직이 있는 **RPC 계층에서 직접** 검증했다(위 3번). Edge Function 은 오류
> 문자열을 그 RPC 에 그대로 넘길 뿐이다.

---

## 4. 작업 4 — 약관 동의 증적

### 4-1. 스키마

```sql
create table consent_records (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references profiles(id) on delete cascade,
  subject      text not null default 'self',      -- self | guardian
  document     text not null,                     -- terms_of_service | privacy_policy | marketing_optional
  version      text not null,                     -- 'draft-0' (정식 문안 확정 전)
  action       text not null default 'accepted',  -- accepted | withdrawn
  method       text not null default 'signup_checkbox',
  recorded_at  timestamptz not null default now()
);
create index consent_records_user_doc_idx on consent_records (user_id, document, recorded_at desc);
```

| 정책 | cmd | 내용 |
|---|---|---|
| `consent_records_select_self` | SELECT | `user_id = auth.uid()` |
| `consent_records_insert_self` | INSERT | `user_id = auth.uid() **and subject = 'self'**` |
| (UPDATE·DELETE) | — | **정책 없음 = 전면 거부** |

권한도 좁혔다: `anon` 전부 회수 / `authenticated` 는 `SELECT, INSERT` 만.

**append-only 인 이유**: 동의는 "그 시점의 사실" 이다. 고쳐 쓸 수 있으면 증적이 아니다.
**철회도 새 행**(`action='withdrawn'`)으로 기록한다 — 기존 행을 지우면 "동의했던 사실" 이 사라져
그 사이 처리한 데이터의 근거를 설명할 수 없다.

**동의 주체 컬럼(`subject`)** 을 지금부터 둔 이유: 만 14세 미만은 보호자가 동의한다(이번 범위 밖).
나중에 컬럼을 붙이면 기존 행의 주체가 불명확해진다. 기본값 `'self'` 이고,
클라이언트는 `subject='self'` 만 넣을 수 있다 — 보호자 동의는 확인 절차가 필요하므로 RLS 가 막는다.

`my_consent_status()` (security **invoker**) — 문서별 최신 상태만 준다. 화면이 "다시 받아야 하나" 를 판단한다.

### 4-2. UI 골격 (문안은 placeholder)

| 앱 | 위치 | 내용 |
|---|---|---|
| 과외쌤 웹 | `m1.tsx` `ConsentChecklist` + `AuthForm` | 체크박스 3개(필수 2·선택 1). **필수 미동의 시 제출 버튼 비활성 + 제출 시 재확인**(폼은 Enter 로도 제출된다) |
| 과외쌤 웹 | `AuthForm` / `TeacherProfileContent` | 세션이 있으면 즉시 기록, 없으면(이메일 인증 경로) localStorage 에 보관해 **온보딩 프로필 저장 시점**에 기록 |
| 학생 앱 | `m1Screens.tsx` 약관 화면 | 기존 토글 유지 + `CONSENT_PENDING_NOTICE` 추가 |
| 학생 앱 | `completeSignup` | 가입 완료 시 동의 기록 |

문안·버전은 `packages/shared/src/consent.ts` 한 곳에서 온다. 버전은 **`draft-0`**.
안내 문구는 `"약관 전문은 준비 중이에요. 정식 문안이 확정되면 다시 동의를 받아요."` —
**문서 내용을 요약하지 않는다**(요약도 약속이고, 확정 전 요약은 거짓이 될 수 있다).

> ⚠️ 세션 없는 가입 경로를 왜 따로 다루는가: RLS 가 본인 행만 허용하므로 **인증된 세션이
> 없으면 동의를 기록할 수 없다.** 지금은 `mailer_autoconfirm=true` 라 가입 즉시 세션이 생기지만,
> 그걸 끄는 것이 출시 전 필수 작업(`LAUNCH-CHECKLIST.md` A1)이다. 끄면 이 경로가 기본이 된다.

### 4-3. 실측

| # | 시도 | 결과 |
|---|---|---|
| 1 | 본인 동의 INSERT (필수 2건) | **성공** |
| 2 | 본인 동의 SELECT | 2행 반환 (`draft-0` · `accepted`) |
| 3 | 남의 동의 SELECT | **0행** |
| 4 | 남의 `user_id` 로 INSERT | **거부** `42501` |
| 5 | `subject='guardian'` 으로 INSERT | **거부** `42501` |
| 6 | 동의 UPDATE(고쳐쓰기) | **거부** `42501` |
| 7 | 동의 DELETE | **거부** `42501` |
| 8 | 철회를 새 행으로 INSERT | **성공** |
| 9 | `my_consent_status()` | 문서별 최신 1행씩 — 철회한 문서는 `withdrawn` 으로 나온다 |

단위 테스트 18건 추가(`consent.test.ts`): 필수 게이트 · 선택 항목이 필수가 되지 않음 ·
페이로드 생성 · 버전 기록 · 옛 버전은 현재 동의가 아님 · 철회는 동의로 세지 않음 ·
append-only 불변식 · 두 앱의 배선.

---

## 5. 검증

| 항목 | 결과 |
|---|---|
| `lint` (shared·student·teacher) | green |
| `typecheck` (3개) | green |
| `check:functions` | green |
| `test` | **361 passed / 33 files** (A3 의 343 → +18) |
| `build` (teacher `.next` 삭제 후 · student) | green |
| A1~A2 회귀 (음성 11건) | 전부 이전 상태 유지 (§5-1) |
| 잔여 데이터 | `profiles` 12 · `auth.users` 15 · queue 0 · log 0 · consent 0 · **storage.objects 0** |
| 실제 사용자 데이터 삭제 | **0건** |
| `apps/teacher-mobile/` | 변경 **0줄** |

### 5-1. 회귀 실측

| 출처 | 시도 | 결과 |
|---|---|---|
| A1 | `ad_unlocks` INSERT (anon / 학생) | **401 / 403** `42501` |
| A1 | `ad_unlocks` SELECT (본인) | **200** (허용) |
| A1.5 | `apply_homework_ai_verdict` (anon / 학생) | **401 / 403** `42501` |
| A1.5 | `ai_recommendations` INSERT (학생) | **403** `42501` |
| A2 | `fail_homework_check_attempt` (학생) | **403** `42501` |
| A2 | `claim_homework_check_attempt` (학생) | **403** `42501` |
| A4 | `storage_purge_queue` SELECT (학생) | **200 `[]`** — 정책 0개라 0행(SELECT 는 오류가 아니라 빈 결과다) |
| A4 | `storage_purge_log` SELECT (학생) | **200 `[]`** |
| A4 | `claim_storage_purge_batch` (학생) | **403** `42501` |

---

## 6. 브랜치 — A3 위에 쌓았다

작업 시작 시 `main` 은 `27464e3`(PR #46)이었고 **A3(PR #47)이 아직 열려 있었다.**
작업 1 이 "A3 보고서에서 남긴 것" 을 지우는 일이라 A3 없이는 성립하지 않는다 →
`chore/copy-cleanup` 위로 분기했다.

⚠️ 이 PR 의 diff 는 **A3 + A4 를 함께** 싣는다. base 는 `main` 이다 —
PR #32 를 자기 base 브랜치로 머지해 main 에 도달하지 못한 전례를 피한다.
PR #47 을 먼저 머지하면 이 diff 는 자동으로 A4 만 남는다.

---

## 7. 확인 불가 항목

| 항목 | 이유 |
|---|---|
| Edge Function 층의 진짜 Storage 실패 | 오류를 인위적으로 만들 수단이 없다. 존재하지 않는 버킷은 목록이 비어 조기 반환된다. 재시도 사다리는 RPC 계층에서 검증했다 |
| 파일럿에서 실제 만료될 사진의 양 | 지금 Storage 가 비어 있다. 스크립트는 파일럿부터 진실을 말한다 |
| 스케줄 실행(자동) | pg_cron 미설치 + Free 플랜 정지 문제로 붙이지 않았다(§3-3). Pro 전환 시점의 인프라 작업이다 |
| 정식 약관 문안·URL | 법률 검토 대기. 버전 `draft-0` 으로 기록해 두고, 확정 시 새 버전으로 다시 받는다 |
| 보호자(만14세 미만) 동의 흐름 | 이번 범위 밖. `subject` 컬럼만 열어 뒀다 |
| 화면 실제 렌더 확인 | 문구·체크박스 추가라 빌드·타입·단위 테스트로 갈음했다. 동의 기록 자체는 실계정으로 실측했다 |
