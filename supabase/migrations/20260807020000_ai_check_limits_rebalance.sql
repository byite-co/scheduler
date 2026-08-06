-- AI 숙제검사 한도를 실측 원가 기준으로 재산정한다.
--
-- [왜] 기존 한도(제출당 5회 · 하루 50회)는 매출 대비 과도했다.
--   하루 50회 × 사진 9장 ≈ 1,100원/일 → 월 33,000원. 학생 1인당 매출은 월 2,900원이다.
--   게다가 **월 한도가 없어** 매일 최대치를 쓰면 아무것도 막지 못했다.
--
-- [실측 원가 — Haiku 4.5, 2026-08-06 측정]
--   · 시스템 프롬프트: 936 토큰 (실측)
--   · 사진 1장: 약 1,600 토큰 (긴 변 1568px)
--   · 출력: 70~130 토큰 (실측, 아래 계산은 보수적으로 130)
--   · 단가: 입력 $1/Mtok · 출력 $5/Mtok · 환율 약 1,370원/$
--
--   호출 1회(사진 P장) 원가 = (936 + 1600P) + 130×5  µ$
--     P=1 →  3,186µ$ ≈ 4.4원      P=3 →  6,386µ$ ≈  8.8원
--     P=5 →  9,586µ$ ≈ 13.1원     P=9 → 15,986µ$ ≈ 21.9원
--   (문서에 기록된 실측 4.3원/22원과 일치한다)
--
-- [예산] 매출 2,900원 × 30% = 870원/월 이 원가 상한이다.
--
--   한 달 원가 = 호출수 A × 2.173원 + 사진수 T × 2.192원
--   (A×(936+650)µ$ + T×1600µ$ 를 원으로 환산)
--
-- [왜 "호출 수"만으로는 안 되는가]
--   호출 수만 제한하면 사진 장수에 따라 원가가 5배 차이 난다.
--   월 70회를 전부 9장으로 쓰면 1,533원(53%)이 되어 예산을 넘는다.
--   그래서 **호출 수와 사진 장수를 둘 다** 제한한다. 이러면 어떤 조합에서도 예산을 넘지 않는다:
--     · 최대 조합 A=70, T=280 → 152 + 614 = 766원 (26.4%) ✅
--     · 전부 9장 (A=31, T=279) → 67 + 612 = 679원 (23.4%) ✅
--     · 전부 1장 (A=70, T=70)  → 152 + 153 = 306원 (10.5%) ✅
--   사진을 많이 쓰는 사용자가 호출 횟수를 덜 받는 것은 원가를 그대로 반영한 결과다.
--
-- [정상 사용을 막지 않는가]
--   평일 숙제 제출 약 20건/월 × 검사 1~2회 = 25~30회, 사진 평균 2~3장 = 50~90장.
--   월 70회 / 280장은 정상 사용의 2배 이상 여유가 있다.
--
-- [이동 창을 쓰는 이유] 달력 월로 끊으면 말일과 1일에 연속으로 최대치를 쓸 수 있다
--   (이틀에 140회). 최근 30일 이동 창은 그 구멍이 없다.

-- ── 한도 상수 ────────────────────────────────────────────────────────────────
create or replace function ai_check_window_days() returns integer
  language sql immutable as $$ select 30 $$;

-- 제출당 재검사: 5 → 3.
-- 재검사는 사진을 다시 찍었을 때만 의미가 있다. 같은 사진을 5번 돌려도 판정은 거의 같고
-- (temperature 낮음) 비용만 5배다. 최초 1회 + 사진 교체 2회면 충분하다.
create or replace function ai_check_max_attempts_per_submission() returns integer
  language sql immutable as $$ select 3 $$;

-- 하루: 50 → 8.
-- 정상 사용은 하루 2~4회다. 8회는 2배 여유이면서 버스트를 막는다.
-- (하루 8회 × 30일 = 240회 > 월 70회 이므로 **월 한도가 실제 구속력을 갖는다**.
--  하루 한도만 있으면 매일 최대치를 쓸 수 있다는 문제를 이걸로 닫는다.)
create or replace function ai_check_max_attempts_per_day() returns integer
  language sql immutable as $$ select 8 $$;

-- 최근 30일 호출 수 / 사진 장수 (신규). 이 둘이 상품 한도다.
create or replace function ai_check_max_attempts_per_month() returns integer
  language sql immutable as $$ select 70 $$;
create or replace function ai_check_max_photos_per_month() returns integer
  language sql immutable as $$ select 280 $$;

comment on function ai_check_window_days() is
  '월 한도를 계산하는 이동 창(일). 달력 월로 끊으면 말일·1일에 연속 최대치를 쓸 수 있다.';
comment on function ai_check_max_attempts_per_submission() is
  '같은 제출 재검사 상한. 사진을 바꾸지 않은 재검사는 비용만 늘고 판정은 같다.';
comment on function ai_check_max_attempts_per_day() is
  '요청자 1인 하루 검사 상한(버스트 방어). 누적 방어는 월 한도가 담당한다.';
comment on function ai_check_max_attempts_per_month() is
  '요청자 1인 최근 30일 검사 상한. 매출 2,900원의 30%(870원) 원가 예산에서 나온 상품 한도다.';
comment on function ai_check_max_photos_per_month() is
  '요청자 1인 최근 30일 검사 사진 장수 상한. 원가는 사진 토큰이 지배하므로 호출 수만으로는 예산을 지킬 수 없다.';

-- 호출자의 남은 한도(안내 UI 용). 인자를 받지 않는다 — 남의 사용량 조회 방지.
create or replace function ai_check_usage()
returns table (
  window_days      integer,
  attempts_today   integer,
  max_per_day      integer,
  attempts_window  integer,
  max_per_window   integer,
  photos_window    integer,
  max_photos       integer
)
language sql
stable
security definer
set search_path = public
as $$
  select ai_check_window_days(),
         count(*) filter (where created_at >= date_trunc('day', now()))::integer,
         ai_check_max_attempts_per_day(),
         count(*)::integer,
         ai_check_max_attempts_per_month(),
         coalesce(sum(coalesce(array_length(photo_paths_snapshot, 1), 0)), 0)::integer,
         ai_check_max_photos_per_month()
  from homework_check_attempts
  where requested_by = auth.uid()
    and created_at >= now() - make_interval(days => ai_check_window_days())
$$;

comment on function ai_check_usage() is
  '호출자의 검사 사용량과 상한. 한도 안내 UI 가 쓴다.';

revoke all on function ai_check_usage() from public;
revoke all on function ai_check_usage() from anon;
grant execute on function ai_check_usage() to authenticated;

-- ── 슬롯 확보 함수 재정의 (월 한도 + 사진 한도 추가) ─────────────────────────
--
-- 20260806050000 판과 달라진 점은 한도 검사 4종뿐이다. 나머지(멱등, 구조적 전제,
-- advisory lock, 스냅샷, unique_violation 처리)는 그대로다.
--
-- ⚠️ 과금 권한(프리미엄/연결) 분기는 Edge Function 이 담당한다. 여기서 다시 판정하지 않는
--    이유는 규칙을 두 곳에 두면 갈라지기 때문이다.
--    **새로운 호출자를 추가한다면 반드시 그 앞에서 과금 권한을 검사해야 한다.**
create or replace function start_homework_check_attempt(
  p_submission_id uuid,
  p_requested_by uuid,
  p_idempotency_key text
)
returns homework_check_attempts
language plpgsql
security definer
set search_path = public
as $$
declare
  sub homework_submissions%rowtype;
  todo_row todos%rowtype;
  snapshot_scope text;
  existing homework_check_attempts%rowtype;
  result homework_check_attempts%rowtype;
  attempts_for_submission integer;
  attempts_today integer;
  attempts_window integer;
  photos_window integer;
  photos_requested integer;
  window_start timestamptz;
begin
  select * into sub from homework_submissions where id = p_submission_id;
  if not found then
    raise exception 'homework_submission_not_found';
  end if;

  -- 같은 요청의 재전송이면 새로 만들지 않고 기존 실행을 돌려준다(중복 과금 방지).
  -- 한도 검사보다 앞에 둔다 — 재전송은 새 사용량이 아니다.
  select * into existing
    from homework_check_attempts
   where requested_by = p_requested_by and idempotency_key = p_idempotency_key;
  if found then
    return existing;
  end if;

  select * into todo_row from todos where id = sub.todo_id;
  if not found then
    raise exception 'homework_submission_not_found';
  end if;

  -- 구조적 전제: AI 검사가 꺼진 숙제나 범위 없는 숙제는 검사할 대상이 아니다.
  if not todo_row.ai_check_enabled then
    raise exception 'ai_check_disabled_for_todo';
  end if;
  if nullif(btrim(coalesce(todo_row.scope_text, '')), '') is null then
    raise exception 'scope_text_required_for_check';
  end if;

  -- 사용량 검사와 슬롯 확보를 직렬화한다. count 만으로는 동시 요청이 둘 다 통과할 수 있다.
  perform pg_advisory_xact_lock(hashtext('homework_check_attempt:' || p_requested_by::text));

  window_start := now() - make_interval(days => ai_check_window_days());
  photos_requested := coalesce(array_length(sub.photo_paths, 1), 0);

  -- (1) 이 제출의 재검사 상한. 가장 구체적이고 사용자가 바로 대응할 수 있어 먼저 본다.
  select count(*) into attempts_for_submission
    from homework_check_attempts
   where submission_id = p_submission_id;
  if attempts_for_submission >= ai_check_max_attempts_per_submission() then
    raise exception 'check_limit_submission_exceeded';
  end if;

  -- (2)(3) 창 단위 한도를 하루 한도보다 **먼저** 본다.
  --   창이 소진됐는데 "오늘 다 썼어요"라고 하면 사용자가 내일 다시 시도해 또 막힌다.
  select count(*),
         coalesce(sum(coalesce(array_length(photo_paths_snapshot, 1), 0)), 0)
    into attempts_window, photos_window
    from homework_check_attempts
   where requested_by = p_requested_by
     and created_at >= window_start;

  if attempts_window >= ai_check_max_attempts_per_month() then
    raise exception 'check_limit_monthly_exceeded';
  end if;

  -- 지금 요청할 사진까지 더해서 본다. 과거분만 세면 마지막 요청이 상한을 넘겨버린다.
  if photos_window + photos_requested > ai_check_max_photos_per_month() then
    raise exception 'check_limit_photos_monthly_exceeded';
  end if;

  -- (4) 하루 한도(버스트 방어).
  select count(*) into attempts_today
    from homework_check_attempts
   where requested_by = p_requested_by
     and created_at >= date_trunc('day', now());
  if attempts_today >= ai_check_max_attempts_per_day() then
    raise exception 'check_limit_daily_exceeded';
  end if;

  -- 검사 기준이 되는 범위는 todos.scope_text 다. 없으면 title 로 되돌아간다 —
  -- scope_text 도입 전 숙제는 범위를 title 에 적어 뒀다(앱의 getTodoScopeTextForDisplay 와 같은 규칙).
  snapshot_scope := nullif(btrim(coalesce(todo_row.scope_text, todo_row.title)), '');

  begin
    insert into homework_check_attempts (
      submission_id, requested_by, status,
      scope_text_snapshot, photo_paths_snapshot,
      idempotency_key, started_at
    ) values (
      p_submission_id, p_requested_by, 'processing',
      snapshot_scope, sub.photo_paths,
      p_idempotency_key, now()
    )
    returning * into result;
  exception
    when unique_violation then
      -- 경쟁 조건: 같은 idempotency_key 가 방금 들어왔다면 그 행을 돌려준다.
      select * into existing
        from homework_check_attempts
       where requested_by = p_requested_by and idempotency_key = p_idempotency_key;
      if found then
        return existing;
      end if;
      -- 그게 아니면 같은 제출에 이미 진행 중인 검사가 있다(부분 유니크 인덱스).
      raise exception 'check_already_in_progress';
  end;

  return result;
end;
$$;

revoke all on function start_homework_check_attempt(uuid, uuid, text) from public;
revoke all on function start_homework_check_attempt(uuid, uuid, text) from anon;
revoke all on function start_homework_check_attempt(uuid, uuid, text) from authenticated;
grant execute on function start_homework_check_attempt(uuid, uuid, text) to service_role;
