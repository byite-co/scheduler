# A2 — 파일럿 전 서버면 마무리

작성: 2026-08-17 · 기준 커밋: `c292f20` (main)
Supabase: `khssgcagudjimrezebxq` 단일 프로젝트만 접근
마이그레이션: `20260817000000_pilot_cost_safety.sql` (원격 적용 완료)
Edge Function: `ai-homework-check` **v6 → v7** 재배포

파일럿은 실사용 사진으로 **진짜 AI 과금**을 발생시킨다. 지금까지는 실사용자가 0명이라
새는 경로가 있어도 금액이 0 이었지만, 파일럿부터는 그대로 돈이 된다.

---

## 1. 수정 내역

### 작업 1 — 제약 분리의 빈틈: **뚫려 있었다. 막았다.**

20260816040000 이 양방향 등식을 단방향 두 개로 쪼개면서 한 방향이 비었다.
`verdict` 는 completed 에 묶였지만 `raw_ai_observation` 은 **아무 상태에서나** 가능했다.

식으로 직접 평가해 확인했다 (status=processing, verdict=null, raw={}):

| 제약 | 평가 |
|---|---|
| `status <> 'completed' or verdict is not null or raw is not null` | **true** (통과) |
| `verdict is null or status = 'completed'` | **true** (통과) |
| (신규) `raw is null or status in ('completed','failed')` | **false** (차단) |

즉 queued/processing 인 행이 관찰 결과를 들고 있을 수 있었다 — "아직 도는 중인데 결과가
있다"는 모순된 행이고, 부분 기록이 완료된 관찰로 읽힌다.

```sql
constraint attempts_observation_requires_settled
  check (raw_ai_observation is null or status in ('completed', 'failed'))
```

적용 후 실제 삽입을 시도해 `23514 attempts_observation_requires_settled` 로 막히는 것을 확인했다.

### 작업 2 — 실패해도 나간 돈은 기록한다

`fail_homework_check_attempt` 가 `status`·`error_code`·`completed_at` 만 써서,
AI 호출이 끝난 뒤 실패하면 토큰·비용이 아무 데도 남지 않았다(A1.6 §4 에서 실측).

**시그니처 확장** — 기존 2-인자 호출을 그대로 살리려고 새 인자는 전부 `default null` 이다.
다만 default 를 붙이면 시그니처가 달라져 `create or replace` 가 아니라 **새 함수**가 만들어지고
옛 2-인자 함수가 남아 오버로드 모호성이 생긴다. 그래서 `drop` 후 재생성하고 권한을 다시 줬다.

```sql
fail_homework_check_attempt(
  p_attempt_id uuid, p_error_code text,
  p_model text default null, p_input_tokens integer default null,
  p_output_tokens integer default null, p_cost_usd_micros bigint default null,
  p_latency_ms integer default null
)
```
본문은 전부 `coalesce(p_x, x)` 다 — 부분 성공 뒤 실패한 경우 이미 기록된 값을 덮어쓰지 않는다.

**Edge Function** 의 `failAttempt` 가 누적 토큰·비용을 함께 넘긴다. 아직 한 번도 호출하지
않았으면 전부 `null` 이라 기존 값을 건드리지 않는다.
`writeError` 분기(= **돈이 가장 크게 새던 지점**, AI 호출은 이미 전부 끝난 뒤)도 같은 경로로 바꿨다.

### 작업 3 — AI 호출 전 중복 차단

**먼저 사실 정정**: A1.6 §4-3 에서 "재전송이 AI 를 다시 호출한다"고 적었는데,
**순차 재전송은 이미 막혀 있었다** — `index.ts:274` 에 `status === "completed" || "failed"` 면
그대로 반환하는 가드가 있다. A1.6 의 그 서술은 과했다.

**실제로 남아 있던 구멍은 동시 요청**이다. 같은 키로 두 요청이 동시에 오면 둘 다 같은 행을
받고 둘 다 `status='processing'` 을 보므로 **둘 다 AI 를 호출한다.** `start` 안의 advisory lock 은
그 트랜잭션에서만 유효해 그 뒤의 AI 호출까지 직렬화하지 못한다.

**해결** — AI 실행 권리를 행에 1회만 발급한다.

```sql
alter table homework_check_attempts add column ai_started_at timestamptz;

create or replace function claim_homework_check_attempt(p_attempt_id uuid) returns boolean ...
  update homework_check_attempts
     set ai_started_at = now(), updated_at = now()
   where id = p_attempt_id and status in ('queued','processing') and ai_started_at is null;
  get diagnostics claimed = row_count;
```

`UPDATE ... WHERE ai_started_at is null` 이 행 잠금을 잡으므로 두 트랜잭션이 동시에 성공할 수
없다 — 뒤에 온 쪽은 갱신된 값을 다시 보고 조건에서 탈락한다.
Edge Function 은 claim 에 실패하면 **AI 를 부르지 않고** 409 `check_already_in_progress` 를 반환한다.
이 실행을 failed 로 마감하지도 않는다 — 권리를 가진 쪽이 아직 돌고 있기 때문이다.

### 작업 4 — `generate_teacher_invoice`: **중단하고 보고**

지시대로 호출자부터 확인했고, **클라이언트가 직접 호출한다.**

| 위치 | 내용 |
|---|---|
| `apps/teacher/src/app/m6.tsx:70` | `supabase.rpc("generate_teacher_invoice", { p_period: currentPeriod() })` |
| `m6.tsx:130` | 그 함수를 부르는 **"이번 달 인보이스 생성"** 버튼 |
| `packages/shared/src/m6.billing.rls.integration.test.ts:67,73` | `teacherClient`(authenticated)로 호출하는 통합 테스트 2건 |

`authenticated` EXECUTE 를 회수하면 그 버튼과 테스트가 즉시 깨진다.
**회수하지 않았다.** 구조 변경(서버 발행으로 이전 또는 버튼 제거)이 필요하며 범위 밖이다.

> 참고: anon 도 EXECUTE 를 갖고 있으나 함수 첫 줄이 `auth.uid() is null → authentication_required`
> 라 실질 경로는 아니다(A1 §3-6). 위험의 본질은 **과외쌤이 자기 인보이스를 임의 시점에 몇 번이든
> 발행할 수 있다**는 것이고, `on conflict (teacher_id, period) do update` 라 행이 증식하지는 않는다.

### 작업 5 — 조건부 4건 트리거 가드

RLS 정책이 `for all` 이라 **트리거 하나가 유일한 방어선**이다. 정책은 "본인 행" 까지만 보장하고,
"본인 행의 어느 컬럼을 바꿀 수 있는가" 는 전부 트리거가 정한다.

트리거 목록을 돌려주는 RPC 를 새로 만들지 **않았다** — 그 자체가 새 공개 표면이 된다.
대신 "막혀야 하는 것이 막힌다" 를 실측한다. 트리거가 지워지면 아래 단정이 전부 깨지므로
**존재 여부와 동작을 같은 테스트가 한 번에 지킨다.**

---

## 2. 실행 테스트 결과

전체 **343 passed / 32 files** (A1.6 의 342 → +1).

### 새로 추가한 실측 (`m4.checkAttempts.rls.integration.test.ts`)

| 검증 | 결과 |
|---|---|
| (7-c) processing 행에 관찰 주입 | `attempts_observation_requires_settled` 로 거부 |
| (7-d) 같은 attempt 에 claim 2회 | 1회차 `true` / 2회차 `false` |
| (7-d) 동시 claim 2개 | 한 쪽만 성공 |
| (7-e) 실패 마감에 비용 기록 | `estimated_cost_usd_micros=3542`·`input_tokens=2892`·`model` 남음 |
| (7-e) 기존 2-인자 호출 | 그대로 동작(호환 유지) |

### 트리거 가드 실측 (작업 5)

| 시도 | 결과 |
|---|---|
| 학생이 선생님 숙제 `status='done'` | **허용**(정상) |
| 학생이 선생님 숙제 제목·범위·AI검사 토글 변경 | `locked_teacher_todo_fields` |
| 학생이 `source='teacher'` 숙제 직접 생성 | `students_cannot_create_teacher_todos` |
| 학생이 `ai_verdict`·`ai_confidence`·`ai_reason` 변경 | `ai_fields_are_server_set` |
| 학생이 `teacher_status`·`teacher_comment`·`resubmit_requested` 변경 | `teacher_fields_not_student_editable` |
| **service_role** 이 남의 폴더 사진 경로 지정 | `photo_paths_must_be_in_own_folder` (예외 없음) |

---

## 3. 재배포와 정상 경로 실측

| | slug | version | status | verify_jwt |
|---|---|---|---|---|
| 배포 전 | `ai-homework-check` | v6 | ACTIVE | true |
| **배포 후** | `ai-homework-check` | **v7** | ACTIVE | true |
| (변경 없음) | `account-delete` | v4 | ACTIVE | true |

이로써 A1 의 "배포본 ↔ 레포 동일성 미확인" 이 해소된다 — v7 은 이 브랜치의 소스에서 배포됐다.

### 실측 결과 — **AI 는 호출되지 않았다. 비용 ₩0.**

배포된 v7 에 학생 토큰으로 실제 요청을 보냈다:

```
POST /functions/v1/ai-homework-check  {submissionId, idempotencyKey}
→ HTTP 503  {"error":"ai_check_paused","errorCode":"ai_check_paused"}
호출 후 attempt 수: 0
```

`AI_CHECK_RESULTS_ENABLED = false` 이므로 함수가 **첫 관문에서 끝낸다**(`index.ts:135`).
attempt 슬롯도, 사진 다운로드도, Anthropic 호출도 일어나지 않는다.

> **따라서 "정상 경로 1회 실측(과금 허용)" 은 수행하지 못했다.** AI 호출 구간을 지나가려면
> `AI_CHECK_RESULTS_ENABLED` 를 켜야 하는데, 그건 판정 정확도 재측정을 전제로 한 **제품 결정**이고
> (docs/PROJECT-GUIDE.md §3-2) 이번 지시 범위 밖이다. 임의로 켜지 않았다.
>
> **발생 비용: ₩0.**
>
> 대신 확인한 것: ① 배포된 v7 이 살아서 응답한다 ② 플래그 관문이 의도대로 아무것도 소모하지
> 않는다 ③ AI 이후 구간(claim → record → fail 비용 기록)은 DB RPC 직접 호출로 전부 실측했다.
> 플래그를 켜는 순간의 종단 검증은 그 결정과 함께 이뤄져야 한다.

---

## 4. 회귀 재실행 (A1 · A1.5 · A1.6)

| 출처 | 시도 | 결과 |
|---|---|---|
| A1 | anon `ad_unlocks` INSERT | **401** `42501` |
| A1 | 학생 `ad_unlocks` INSERT | **403** `42501` |
| A1 | 학생 `ad_unlocks` SELECT(허용) | **200** |
| A1.5 | anon `apply_homework_ai_verdict` | **401** `42501` |
| A1.5 | 학생 `apply_homework_ai_verdict` | **403** `42501` |
| A1.5 | 학생 `ai_recommendations` INSERT | **403** `42501` |
| A1.6 | `start_homework_check_attempt` | 성공 |
| A1.6 | `record_homework_check_observation` | 성공 `status=completed` `cost=100` |
| A2 | `claim` 1회차/2회차 | `true` / `false` |

전부 이전 상태를 유지한다. 이번 변경이 되돌린 보호는 없다.

---

## 5. 지시 밖에서 발견해 함께 고친 것

**통합 테스트가 중간 실패하면 검증 계정이 남는다.** 이번 작업 중 실제로 12개가 남았다
(`guard-*@a2-guard.test`). 새로 추가한 트리거 가드 테스트가 `try/finally` 없이 마지막에만
정리하고 있었기 때문이다. `try/finally` 로 감쌌고, 남아 있던 12개는 삭제했다.

정리 후 상태: `profiles` 12 · `auth.users` 15 · `homework_check_attempts` 0 · `ai_recommendations` 0
(모두 이전부터 있던 기준값).

---

## 6. 검증

- `lint` · `typecheck` · `check:functions` · `test`(**343 passed**) · `build` green
- `database.types.ts` 재생성 — `claim_homework_check_attempt`, 확장된 `fail_homework_check_attempt` 반영
- 검증 계정·attempt·추천 행 잔여 0
- **AI 과금 ₩0**
- `apps/teacher-mobile/` 변경 0줄

## 7. 확인 불가 항목

| 항목 | 이유 |
|---|---|
| AI 호출 구간을 포함한 종단 검증 | `AI_CHECK_RESULTS_ENABLED=false` 로 함수가 첫 관문에서 끝난다. 켜는 것은 제품 결정이라 하지 않았다 |
| 실제 동시 요청 2건이 **Edge Function 층에서** 한 번만 AI 를 부르는지 | 같은 이유로 함수가 AI 구간에 진입하지 않는다. DB 층(claim)에서는 동시 호출로 실측했다 |
| 파일럿에서 발생할 실제 비용 | 사진 장수·재검사 빈도에 달려 있다. 한도는 월 40회·100장(20260816000000) |
