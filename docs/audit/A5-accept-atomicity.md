# A5 — A4 확인 2건 + 연결 수락 원자성 + 초대 코드 사용측 방어

작성: 2026-08-17 · 분기 기준: `2a8f9d3` (main — A3·A4 는 PR #49 로 이미 머지됐다)
Supabase: `khssgcagudjimrezebxq` 단일 프로젝트만 접근
`apps/teacher-mobile/` 변경 **0줄** · 실제 사용자 데이터 삭제 **0건**

마이그레이션 4개 (전부 원격 적용 완료, 객체 존재 확인):

| 파일 | 성격 |
|---|---|
| `20260819000000_connection_identity_freeze.sql` | **지시 밖 결함 — 권한상승 차단** |
| `20260819010000_revoke_stray_client_grants.sql` | **지시 밖 결함 — 이중 방어 복구** |
| `20260819020000_accept_connection_atomic.sql` | 작업 2 |
| `20260819030000_invite_attempt_limit.sql` | 작업 3 |

---

## 0. 지시 밖 결함 ① — 교사가 남의 학생을 연결에 붙일 수 있었다 🔴

작업 2를 조사하다 수락 경로의 UPDATE 정책을 읽으면서 발견했다. **A 시리즈에서 나온 것 중 가장 심각하다.**

```sql
create policy conn_teacher_update_status on connections for update
  using (teacher_id = auth.uid()) with check (teacher_id = auth.uid());
```

`teacher_id` 만 본다. 그래서 교사는 **자기 연결의 `student_id` 를 임의의 학생 UUID 로 바꿀 수 있었다.**

```sql
update connections set student_id = '<남의 학생>', status = 'active' where id = '<내 연결>';
```

초대 코드도, 그 학생의 수락도 필요 없다. UUID 하나만 알면 된다.

### 실측 (인증 계정 없이 JWT 클레임을 세팅해 재현, 계정은 즉시 삭제)

| 항목 | 교체 전 | 교체 후 |
|---|---|---|
| `student_id` 를 S2 로 변경 + `active` | — | **성공** |
| S2 의 학습기록 열람 (`v_teacher_study_sessions`) | **0건** | **1건** 🔴 |
| S2 의 `profiles` 행 열람 | — | **1건** |
| S2 에게 숙제(`todos`) 출제 | — | **성공** |
| S2 에 대한 리포트 생성 | — | **성공** |
| S2 의 `per_student_settings` 생성 | — | **성공** |

읽기만이 아니라 **쓰기까지** 열렸다. 동의하지 않은 학생에게 숙제를 넣고 리포트를 만들 수 있었다.

### 왜 RLS 로 못 막고 컬럼 권한으로 막았나

`with check` 는 UPDATE **후** 행만 본다. `OLD` 를 참조할 수 없으므로 "`student_id` 가 바뀌지 않았다" 를
정책으로 표현할 방법이 없다. 그래서 **컬럼 단위 권한**으로 막았다 — 권한 층은 RLS 보다 먼저
평가되고, 우회할 표현식이 없다.

```sql
revoke update on table connections from authenticated, anon;
grant update (status, activated_at) on table connections to authenticated;
```

**무엇이 깨지지 않는지 먼저 확인했다.** 클라이언트가 연결에 대해 실제로 쓰는 컬럼은
`status` 와 `activated_at` 뿐이다 — teacher web 수락·거절, teacher-mobile 수락·거절,
teacher-mobile 연결 해제(`studentSettingsScreen.tsx:135`) 전부. `request_connection_by_invite` 는
security definer 라 소유자 권한으로 돌아 영향이 없고, 테스트의 admin 은 service_role 이라 영향이 없다.

적용 후 실측: `authenticated` 의 connections UPDATE 권한 = `UPDATE(status), UPDATE(activated_at)` 둘뿐.

---

## 1. 지시 밖 결함 ② — 정책 0개 표에 클라이언트 쓰기 권한이 남아 있었다 🟡

전수 조회로 찾았다. RLS 가 켜져 있고 **정책이 0개**인(= 전면 거부가 의도인) 표 셋에
`ALTER DEFAULT PRIVILEGES` 로 붙은 권한이 그대로 있었다:

| 표 | 남아 있던 권한 |
|---|---|
| `report_views` | anon·authenticated 각각 INSERT, UPDATE, DELETE, TRUNCATE |
| `storage_purge_log` | 동일 |
| `storage_purge_queue` | 동일 |

**현재 뚫려 있지는 않다** — 정책이 0개라 RLS 가 막는다. 문제는 안전이 한 겹뿐이라는 것이다.
나중에 누가 조회용 정책 하나를 `for all` 로 잘못 붙이면 그 순간 쓰기까지 열린다.
A1 의 `ad_unlocks` 가 정확히 그 모양이었다.

`revoke ... from public` 으로는 안 된다 — 부여된 것은 public 이 아니라 **롤 각각**이다(A1 에서 확인한 함정).

적용 후 실측: 세 표의 anon·authenticated 쓰기 권한 **24건 → 0건**. service_role·postgres 는 건드리지 않았다.

> ⚠️ 이 회수 뒤에 A4 큐 처리기가 여전히 도는지 확인했다 — `account-delete` `mode:"sweep"` HTTP 200,
> 20행 처리. service_role 로 돈다는 주장을 실행으로 확인한 것이다.

---

## 2. 작업 1-1 — 탈퇴 큐 백로그의 상태와 유래

### "95행" 은 지금 없다 — A4 에서 이미 정리했다

A4 작업 중 그 95행(91 `done` + 4 `pending`)을 정리했고, A5 시작 시점 큐는 **0행**이었다.
그래서 "95행의 현재 분포" 는 존재하지 않는다. 대신 **유래를 실행으로 확인했다.**

### 유래: 계정 삭제 트리거. 테스트가 만든다

큐에 행을 넣는 경로는 하나뿐이다 — `profiles` 의 `BEFORE DELETE` 트리거
`enqueue_storage_purge_on_profile_delete_trigger`. 클라이언트 정책은 0개다.

A5 작업 중 이것이 눈앞에서 재현됐다. 시작 시 0행이던 큐가 내 테스트 실행 뒤 **24행**이 됐고,
전수 확인 결과 **24행 전부 `user_id` 가 실재하지 않는 사용자**였다(= 삭제된 테스트 계정).
타임스탬프도 이 세션의 테스트 구간(10:53–11:12)과 일치했다.

즉 백로그는 사고가 아니라 **RLS 통합 테스트가 계정을 만들고 지우는 정상 동작의 부산물**이다.
파일럿에서는 실제 탈퇴 1건당 1행이 쌓인다.

### 소진 + 최종 기준값

`pending` 을 sweep 으로 소진시켰다. 전체 테스트 스위트(392개)를 돌린 뒤 큐가 다시 차서 여러 번 호출했다.

| 항목 | 값 |
|---|---|
| `storage_purge_queue` 총 | **64행** (전부 `done`) |
| `pending` / `failed` | **0 / 0** |
| 실제 삭제된 파일 | **0개** (Storage 가 비어 있다) |
| `storage_purge_log` | **64행** (큐 행당 1건) |
| `storage.objects` | **0** |
| `profiles` / `auth.users` | 12 / 15 (A4 기준값과 동일 — 누수 없음) |
| `consent_records` / `invite_attempts` | 0 / 0 |
| A5 테스트 잔재 | **0건** |

> ⚠️ **A4 설계의 실측된 한계**: sweep 은 1회 호출에 **20행**만 처리한다. 테스트 스위트 한 번이
> 30~40행을 만들기 때문에 소진에 3회 호출이 필요했다. "비었을 때까지 돈다" 는 루프가 없다.
> 수동 트리거로 남긴 결정(A4 §3-3)과 합치면, **자동 스케줄을 붙일 때 한 번에 다 비우는 로프가
> 필요하다.** 지금은 파일럿 규모라 문제가 아니라서 이번 범위에서 바꾸지 않았다.

---

## 3. 작업 1-2 — 동의 차단은 클라이언트뿐이다 🔴

### (a) UI 경로 — 막힌다

| 앱 | 장치 |
|---|---|
| 과외쌤 웹 | 필수 미동의 시 제출 버튼 `disabled` + 제출 핸들러에서 재확인(폼은 Enter 로도 제출된다) |
| 학생 앱 | 약관 화면의 "동의하고 계속" 이 필수 두 개를 검사 |

### (b) API 직접 호출 — **뚫린다**

동의 기록 0행 상태로 클라이언트 권한으로 시도한 결과:

| 시도 | 결과 |
|---|---|
| 프로필 생성 | **성공** — 서버가 막지 않는다 |
| 그 계정의 `consent_records` | **0행** |
| 학습기록(`study_sessions`) 생성 | **성공 — 동의 없이 핵심 기능 사용 가능** |
| 할 일(`todos`) 생성 | **성공** |
| `request_connection_by_invite` 호출 | **실행됨** (동의 확인 없음) |
| `consent_records` 를 참조하는 RLS 정책 | **0개** |
| `consent_records` 를 참조하는 함수 | 1개 (`my_consent_status` — 조회용) |

**결론: 동의 강제는 전적으로 클라이언트 측이다.** 서버에는 동의를 요구하는 장치가 없다.
A4 가 만든 것은 "동의를 **기록**하는 곳" 이고, "동의 없으면 **못 쓰게** 하는 곳" 은 아니다.

### 설계 옵션 (지시대로 구현하지 않았다 — 결정 후 진행)

| # | 방식 | 장점 | 단점 |
|---|---|---|---|
| **A** | `profiles.onboarded` 를 동의와 묶는다: 동의 행이 있을 때만 `onboarded=true` 로 올릴 수 있게 트리거로 강제. 나머지 정책은 이미 `onboarded` 를 보는 곳이 있음 | 표면 하나만 손댄다. 기존 정책 재사용 | `onboarded` 의 의미가 두 가지가 된다 |
| **B** | `has_current_consent()` 헬퍼(security definer)를 만들고, 핵심 표(`study_sessions`·`todos`·`homework_submissions`)의 INSERT 정책에 `and has_current_consent()` 추가 | 강제 지점이 명시적. 표별로 켜고 끌 수 있다 | 정책 여러 개를 고쳐야 한다. 버전이 올라갈 때 기존 사용자가 **한꺼번에 잠긴다** |
| **C** | 게이트를 가입 완료 시점 한 번만: `complete_student_signup()` RPC 를 만들어 프로필 생성 + 동의 기록을 한 트랜잭션으로. 이후 검사는 없음 | 작업 2와 같은 패턴(원자화). 잠기는 사용자가 없다 | 이미 가입한 계정은 여전히 동의 0행일 수 있다 |

**추천은 C + A 조합**이다. C 로 앞으로 들어오는 계정은 동의 없이는 프로필이 생기지 않게 하고,
A 로 그 불변식을 DB 가 지키게 한다. B 는 문안 버전을 올릴 때 전체 사용자가 잠기는 위험이 커서
파일럿 전에 넣기에는 이르다. **다만 정식 문안이 `draft-0` 인 지금은 어느 것도 시작할 수 없다** —
잠금 기준이 되는 동의가 아직 임시본이다.

---

## 4. 작업 2 — 연결 수락 원자성

### 4-1. 현재 쓰기 경로 (양쪽 확인, mobile 은 읽기만)

수락은 쓰기가 **둘**이다: `per_student_settings` 행 생성 + `connections.status → active`.
두 앱이 이것을 클라이언트에서 순차로 했고 **순서가 서로 달라서 부분 실패 결과도 달랐다.**

| 앱 | 순서 | 부분 실패 시 남는 것 |
|---|---|---|
| teacher-mobile `connectionRequestsScreen.tsx:142` → `:157` | 설정 → 상태 | **`pending` 인데 설정 행만 있는 고아 설정** |
| teacher web `m1.tsx:1222` → `:1225` | 상태 → 설정 | **`active` 인데 설정 행이 없는 연결** |

> ⚠️ web 쪽에는 하나가 더 있었다. `per_student_settings.upsert(...)` 의 `error` 를 **아예 읽지 않았다.**
> 실패해도 "연결을 수락했습니다" 가 떴다. 조용한 실패다.

### 4-2. RPC

```
accept_connection_request(p_connection_id uuid) returns connections
```
security definer · `authenticated` 만 실행 · 해당 연결의 **교사 본인만** · **멱등**

설계 판단 세 개:

- **기본값을 SQL 에 복제하지 않는다.** `per_student_settings` 의 컬럼 기본값
  (`ai_check_subjects '{}'`, `report_cycle 'weekly'`)이 shared 의 `DEFAULT_TEACHER_STUDENT_SETTINGS`
  와 이미 같다. 그래서 컬럼을 명시하지 않고 기본값에 맡긴다 — 값을 두 곳에 적으면 언젠가 갈라진다.
- **`disclosure_settings` 는 만들지 않는다.** 공개범위 행은 요청 시점
  (`request_connection_by_invite`)에서 만든다. 여기서 또 만들면 `share_study_time` 기본값 `true` 로
  **공개를 켜 주는** 일이 된다. 행이 없으면 교사에게 아무것도 안 보인다 — 실패 방향이 안전한 쪽이다.
- **`rejected`·`disconnected` 를 수락으로 되살리지 않는다.** 그 경로는 학생이 코드를 다시 넣어야
  한다(= 학생의 재동의). `connection_not_pending` 으로 거부한다.

거절은 쓰기가 하나뿐이라 그대로 UPDATE 한다(원자화할 것이 없다).

### 4-3. teacher web 전환

`m1.tsx` `decide()` 가 수락 시 RPC 하나만 부른다. 클라이언트의 `per_student_settings` 쓰기와
`DEFAULT_TEACHER_STUDENT_SETTINGS` import 가 함께 사라졌다.

### 4-4. teacher-mobile 전환 인수인계 (Codex 지시문용 — 이번에 건드리지 않았다)

**RPC 시그니처**

```ts
const { data, error } = await supabase.rpc("accept_connection_request", {
  p_connection_id: connection.id
});
// data: connections 행 (status='active', activated_at 세팅됨)
// error.message: 'not_connection_teacher' | 'connection_not_found' | 'connection_not_pending' | 'authentication_required'
```

**교체할 지점** — `apps/teacher-mobile/src/connectionRequestsScreen.tsx`

| 줄 | 현재 | 해야 할 일 |
|---|---|---|
| `142-152` | `supabase.from("per_student_settings").upsert({...})` + 에러 처리 | **블록 전체 삭제** (RPC 가 한다) |
| `154-156` | `const patch = accept ? {status:'active',...} : {status:'rejected',...}` | 수락 분기를 RPC 로, 거절 분기만 patch 유지 |
| `157` | `supabase.from("connections").update(patch)` | 거절일 때만 호출 |
| import | `DEFAULT_TEACHER_STUDENT_SETTINGS`, `Database["public"]["Enums"]["subject_code"]` | 다른 데서 안 쓰면 제거 |

**건드리지 않아도 되는 곳**: `studentSettingsScreen.tsx:134-135` 의 연결 해제는
`status`·`activated_at` 만 쓰므로 §0 의 컬럼 동결에 걸리지 않는다. 그대로 둔다.

⚠️ mobile 의 현재 수락 코드는 §0 변경 뒤에도 **동작한다**(두 쓰기 모두 허용된 컬럼·표다).
깨져서 고치는 게 아니라, 비원자성이 남아 있어서 고치는 것이다.

### 4-5. 실행 테스트 (실계정, 끝나고 전부 삭제)

`packages/shared/src/m1.accept.rls.integration.test.ts`

| # | 시나리오 | 결과 |
|---|---|---|
| 1 | 수락 전 설정 행 | **0건** (수락이 만든다는 것을 증명할 기준선) |
| 2 | **타 교사(B) 수락 시도** | `not_connection_teacher` 거부 · 연결 여전히 `pending` · **설정 행도 0건**(롤백) |
| 3 | **정상 수락** | `status='active'` · `activated_at` 세팅 · 설정 행 **1건** · `report_cycle='weekly'` · `ai_check_subjects=[]` |
| 4 | **재호출 멱등** | 오류 없음 · `active` 유지 · 설정 행 여전히 **1건** |
| 5 | **부분 실패 불가** | 설정 행을 지우고 재호출 → **1건으로 보정**(두 쓰기가 같은 경로에 묶여 있다는 증거) |
| 6 | **신원 컬럼 동결** | `student_id` 교체 시도 **42501 거부** · 실제 값 불변 |
| 7 | 거절 경로 생존 | `status='rejected'` UPDATE **성공** (동결이 정상 동작을 막지 않는다) |
| 8 | 되살리기 금지 | `rejected` 를 수락 → `connection_not_pending` 거부 |

---

## 5. 작업 3 — 초대 코드 사용측 방어

### 5-1. 서버 경로

`request_connection_by_invite(p_code text)` (security definer). 프로덕션 호출자는 **한 곳**뿐이다 —
`apps/student/src/m1Screens.tsx:484`.

### 5-2. 무제한 시도가 가능했다 — 실측

| 항목 | 값 |
|---|---|
| 연속 오입력 | **30회** |
| 결과 | `invite_code_not_found` **30건** (전부 판정을 받았다) |
| 차단된 시도 | **0회** |
| 소요 | 18ms (DB 내부 실행, 네트워크 제외) |

생성 엔트로피(32자 알파벳 6자리 ≈ 2^30, #48)는 전수 탐색을 막는다. 하지만 유효한 코드가 N개일 때
추측 1회의 성공 확률은 N/2^30 이고, **시도에 비용이 없으면 그 확률을 무한히 곱할 수 있다.**

### 5-3. 왜 함수의 반환 형태를 바꿔야 했나 — 측정 근거

시도를 세려면 실패해도 그 기록이 커밋돼야 한다. 그런데 PostgREST 는 요청 하나를 트랜잭션
하나로 돌리므로, 함수가 `raise exception` 으로 끝나면 **직전에 넣은 시도 기록까지 롤백된다.**
추측이 아니라 측정으로 확인했다:

| 함수 모양 | 호출 뒤 기록 |
|---|---|
| 기록 후 `raise exception` | **0행** |
| 기록 후 값 반환 | **1행** |

즉 "실패 시 예외" 와 "실패를 세는 것" 은 동시에 성립하지 않는다. 그래서 **사용자 입력 실패를
예외가 아니라 결과값**으로 돌린다.

**옛 함수를 남겨 두지 않았다.** 남기면 공격자는 제한이 없는 그쪽을 부른다.
반환형이 바뀌므로 `drop` 후 재생성했다(`create or replace` 로는 불가).

```
request_connection_by_invite(p_code text) returns jsonb
  성공: { ok: true,  reason: 'created'|'reopened'|'existing', connection: {...} }
  실패: { ok: false, reason: 'invalid_format'|'not_found'|'already_used'|'rate_limited',
          retry_after_seconds?: number }
```

`authentication_required`·`student_profile_required` 는 계속 예외다 — 사용자의 입력 실수가 아니라
호출 자체가 잘못된 경우이고, 셀 필요가 없다.

### 5-4. 구현

`invite_attempts` — 계정당 시도 기록. 임계값 **10분에 10회 실패**.

| 판단 | 이유 |
|---|---|
| **입력한 코드를 저장하지 않는다** | 방어에 필요한 것은 "몇 번 틀렸나" 뿐이다. 남기면 운 좋게 맞힌 코드가 표에 남는다 |
| **성공은 실패로 세지 않는다** | 연결에 성공한 학생이 다른 선생님 코드를 넣는 것은 정상이다 |
| **차단된 시도는 기록하지 않는다** | 기록하면 계속 두드리는 동안 창이 갱신돼 **영구 차단**이 된다 |
| **창 밖 기록을 함수가 스스로 지운다** | 호출한 학생 것만, 인덱스 한 번. 스케줄러를 만들지 않는다(과한 인프라 금지) |
| **정책 0개 + 권한 회수** | 클라이언트는 이 표를 직접 만지지 않는다. §1 의 교훈을 처음부터 적용했다 |
| `not_found` 와 `already_used` 를 구분한다 | 추측 쪽에 "그 코드는 실재한다" 가 새지만, 오타 낸 학생과 남이 먼저 쓴 코드를 받은 학생은 할 일이 다르다. 추측 1회의 비용은 시도 제한이 담당한다 — 문구로 감추는 쪽이 아니다 |

학생 앱은 `describeInviteRedeemResult()`(shared)로 `reason` 을 문구로 바꾼다. `error` 만 보면
실패를 성공으로 표시하게 된다.

### 5-5. 실행 테스트

| # | 시나리오 | 결과 |
|---|---|---|
| 1 | **임계 내 9회 오입력** | 전부 `not_found` 판정 · 기록 **9행** · 차단 없음 |
| 2 | 9회 실패 상태에서 **진짜 코드** | **성공**(`created`) — 정상 사용자를 먼저 막지 않는다 |
| 3 | 10번째 실패 | `not_found` (10회까지는 판정을 받는다) |
| 4 | **11번째 시도** | **`rate_limited`** · `retry_after_seconds` 0 초과 ~600 이하 |
| 5 | 차단 중 기록 증가 | **10행 유지** — 차단된 시도는 기록되지 않는다 |
| 6 | 차단 중 **진짜 코드** | `rate_limited` — 그래야 추측을 막는 의미가 있다 |
| 7 | **창 경과 후**(기록 시각을 11분 전으로) | `not_found` — **차단 해제** |
| 8 | 창 밖 기록 정리 | **1행**(방금 것만) — 스스로 지운다 |

> 시계 의존 구간은 실제로 10분 기다리지 않고 `attempted_at` 을 과거로 밀어 재현했다(A2.1 과 같은 방식).

### 5-6. 남는 한계

**계정당 제한이므로 계정을 여러 개 만들면 우회된다.** 지시대로 "계정당 시도 기록" 을 구현했고,
계정 생성 자체는 Supabase Auth 의 시간당 요청 제한이 억제한다(이 세션의 통합 테스트가 그 한도에
걸린 적이 있다). IP 단위 제한은 외부 rate limiter 가 필요해 범위 밖으로 뒀다.

---

## 6. 검증

| 항목 | 결과 |
|---|---|
| `lint` (shared·student·teacher) | green |
| `typecheck` (3개) | green |
| `check:functions` | green |
| `test` | **392 passed / 35 files** (A4 의 361/33 → **+31, +2 파일**) |
| `build` (teacher `.next` 삭제 후 · student) | green |
| A1~A5 회귀 (음성) | 아래 표, 전부 기대대로 |
| `apps/teacher-mobile/` | 변경 **0줄** |
| 실제 사용자 데이터 삭제 | **0건** |

### 6-1. 회귀 실측

| 출처 | 시도 | 결과 |
|---|---|---|
| A1 | `ad_unlocks` INSERT (학생) | 거부 `42501` ✓ |
| A1 | `ad_unlocks` SELECT (본인) | 허용 ✓ |
| A1.5 | `ai_recommendations` INSERT (학생) | 거부 `42501` ✓ |
| A1.5 | `apply_homework_ai_verdict` 실행권한 | `authenticated` **없음** ✓ |
| A2 | `fail_homework_check_attempt` 실행권한 | 없음 ✓ |
| A2 | `claim_homework_check_attempt` 실행권한 | 없음 ✓ |
| A2 | `generate_teacher_invoice` 실행권한 | **있음** — 의도된 상태다(A2 에서 `m6.tsx:70` 호출자를 확인하고 회수를 중단했다) |
| A4 | `claim_storage_purge_batch` 실행권한 | 없음 ✓ |
| A4 | `storage_purge_queue` / `_log` SELECT (학생) | 0행 ✓ |
| A4 | 본인 동의 INSERT | 성공 ✓ |
| A4 | 동의 UPDATE | 거부 `42501` ✓ |
| A4 | `subject='guardian'` INSERT | 거부 `42501` ✓ |
| A5 | `accept_connection_request` 실행권한 | `authenticated` 있음 (의도) |
| A5 | `invite_attempts` SELECT (학생) | 거부 `42501` ✓ |
| A5 | `connections.student_id` UPDATE (교사) | 거부 `42501` ✓ |
| A5 | `connections.status` UPDATE (교사) | **허용** ✓ (거절·해제 경로 유지) |

---

## 7. 확인 불가 / 별도 결정이 필요한 항목

| 항목 | 상태 |
|---|---|
| **마이그레이션 이력이 실제와 어긋나 있다** | `supabase_migrations.schema_migrations` 의 최신 항목이 `20260815030000` 이다. A1~A5 의 마이그레이션 13개는 Management API 로 적용해 이력에 기록되지 않았다. 객체는 13개 전부 존재를 확인했다(§검증 아님 — 별도 조회). **다음 `supabase db push` 가 이미 적용된 것들을 다시 적용하려 든다.** 이력 표를 손대는 것은 이번 지시 밖이고 운영 상태 변경이라 하지 않았다 — 진행 여부를 결정해 주면 이력 행만 넣겠다 |
| 서버측 동의 강제 | 설계 옵션만 냈다(§3). 정식 문안이 `draft-0` 인 동안은 잠금 기준 자체가 임시본이라 시작할 수 없다 |
| IP·기기 단위 초대 코드 제한 | 외부 rate limiter 가 필요해 범위 밖. 계정당 제한만 구현했다(§5-6) |
| sweep 의 20행 예산 | 실측된 한계로 기록했다(§2). 자동 스케줄을 붙이는 시점에 "빌 때까지" 루프가 필요하다 |
| 화면 실제 렌더 확인 | 수락 버튼의 호출 대상 변경과 문구 헬퍼 추가라 빌드·타입·단위 테스트 + RPC 실계정 실행으로 갈음했다 |
| `report_views` 의 SELECT 권한 | 정책 0개라 0행이므로 남겼다. 회수하면 오류 코드가 표의 존재를 알려 주는 쪽이 된다 |
