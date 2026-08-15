-- 리포트 2단계 — 수업 회차 · 리포트 발급 한도.
--
-- ── 수업 회차(lessons) ──────────────────────────────────────────────────────
--
-- [왜 새 테이블인가] 회차를 세는 곳이 없었다. lesson_fees 는 **월 금액**(period, amount, paid)
--   이고 회차 정보가 없다. 카탈로그 "회차·수업료"(/lessons)는 학생별 "진행 6/8회"를 보여주는데,
--   그 6 을 만들 데이터가 없었다.
--
-- [lesson_fees 와의 관계] **곱셈 관계가 아니다.**
--   카탈로그의 월 수업료는 학생마다 다른 정액(₩480,000 / ₩320,000 …)이고, 예상 수업료는
--   그 정액들의 합이다. 회차 × 단가가 아니다. 회차는 "얼마나 진행했나"를 보여주는 별개 축이다.
--   그래서 lessons 는 금액을 갖지 않고, lesson_fees 는 회차를 갖지 않는다.
--   (planned_sessions 를 lesson_fees 에 둔 이유: "이번 달 8회 예정"은 월 단위 약속이고
--    금액과 같은 주기로 정해지기 때문이다.)
--
-- [결석을 어떻게 다루는가] status 로 나눈다.
--   · done     — 진행함. 이게 학부모가 궁금해하는 "몇 번 했나"다.
--   · absent   — 학생이 빠짐. **진행 회차에 넣지 않되 숨기지도 않는다.**
--                합치면 "8회 했다"는 거짓이 되고, 지우면 학부모가 결석을 모른다.
--                리포트는 "이번 달 6회 · 결석 1회"처럼 **따로** 적는다.
--   · canceled — 수업 자체가 취소(쌤 사정·공휴일 등). 학생 책임이 아니므로 리포트에 안 낸다.
--                기록은 남긴다(다음 달 정산·분쟁 근거).

create table if not exists lessons (
  id          uuid primary key default gen_random_uuid(),
  teacher_id  uuid not null references profiles(id) on delete cascade,
  student_id  uuid not null references profiles(id) on delete cascade,
  taught_on   date not null,
  status      text not null default 'done',
  -- 몇 시에 했는지까지는 필수가 아니다. 가볍게 체크하는 트래커다.
  started_at_min integer,
  duration_min   integer,
  memo        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint lessons_status_check check (status in ('done', 'absent', 'canceled')),
  constraint lessons_duration_range check (duration_min is null or duration_min between 1 and 600),
  constraint lessons_start_range check (started_at_min is null or started_at_min between 0 and 1439),
  constraint lessons_memo_len check (memo is null or length(memo) <= 200),
  -- 같은 학생·같은 날 같은 시작시각이 두 번 기록되는 것은 실수다(연타·중복 저장).
  -- 시각을 안 적으면 하루 여러 회차가 가능하므로 시각이 있을 때만 막는다.
  unique nulls not distinct (teacher_id, student_id, taught_on, started_at_min)
);

create index if not exists lessons_student_taught_idx on lessons (student_id, taught_on desc);

comment on table lessons is
  '수업 회차 수기 기록. 금액은 lesson_fees 가 갖는다(회차 × 단가가 아니라 별개 축).';
comment on column lessons.status is
  'done=진행 / absent=학생 결석(리포트에 따로 표기) / canceled=수업 취소(리포트에 안 냄).';

alter table lessons enable row level security;

-- exam_records 와 같은 원칙: teacher_id 뿐 아니라 **active 연결**까지 본다.
-- 전자만 보면 남의 학생 id 로 행을 만들 수 있다.
drop policy if exists lessons_teacher_rw on lessons;
create policy lessons_teacher_rw on lessons for all
  using (
    teacher_id = auth.uid()
    and exists (
      select 1 from connections c
      where c.teacher_id = auth.uid() and c.student_id = lessons.student_id and c.status = 'active'
    )
  )
  with check (
    teacher_id = auth.uid()
    and exists (
      select 1 from connections c
      where c.teacher_id = auth.uid() and c.student_id = lessons.student_id and c.status = 'active'
    )
  );

drop trigger if exists touch_lessons_updated_at_trigger on lessons;
create trigger touch_lessons_updated_at_trigger
before update on lessons
for each row execute function touch_exam_records_updated_at();

-- 이번 달 몇 회 예정인지(카탈로그의 "6/8회"의 8). 금액과 같은 월 단위 약속이라 여기 둔다.
alter table lesson_fees
  add column if not exists planned_sessions integer;

alter table lesson_fees drop constraint if exists lesson_fees_planned_range;
alter table lesson_fees
  add constraint lesson_fees_planned_range
  check (planned_sessions is null or planned_sessions between 1 and 60);

comment on column lesson_fees.planned_sessions is
  '이번 달 예정 회차. 없으면 진행 회차만 보여준다(임의로 목표를 만들지 않는다).';

-- ── 리포트 발급 한도 ────────────────────────────────────────────────────────
--
-- [왜 한도가 있는가] 리포트 생성은 AI 를 쓰지 않아 **원가가 사실상 0** 이다.
--   그래서 한도는 비용 통제가 아니라 **남용 방지**다. 특히 발송은 공유 토큰(공개 URL)을
--   만들기 때문에, 막지 않으면 토큰을 무한히 찍어낼 수 있다.
--
-- [숫자의 근거] 정상 사용의 상한은 "학생 1명당 주 1회"다(월 약 4.3회).
--   고쳐 보내는 경우까지 감안해 **학생 1명당 월 8회**로 잡고,
--   학생이 적은 과외쌤도 시험해 볼 수 있게 **최소 30건**을 보장한다.
--     한도 = max(30, active 연결 학생 수 × 8)
--   · 학생 12명 → 96건 (주간 리포트 52건의 약 2배 여유)
--   · 학생 0~3명 → 30건
--   · 학생 20명 → 160건
--   고정값(예: 50)으로 두면 학생 12명만 넘어도 정상 사용이 막힌다. 그래서 학생 수에 연동한다.
create or replace function report_quota_per_student() returns integer
  language sql immutable as $$ select 8 $$;

create or replace function report_quota_floor() returns integer
  language sql immutable as $$ select 30 $$;

create or replace function report_monthly_quota(p_teacher_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select greatest(
    report_quota_floor(),
    (select count(*) from connections c
      where c.teacher_id = p_teacher_id and c.status = 'active') * report_quota_per_student()
  )::integer
$$;

comment on function report_monthly_quota(uuid) is
  '과외쌤 월 리포트 발급 한도. max(30, active 학생 × 8). 비용이 아니라 남용 방지 목적이다.';

create or replace function report_monthly_usage(p_teacher_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from reports r
  where r.teacher_id = p_teacher_id
    and r.created_at >= date_trunc('month', now())
$$;

comment on function report_monthly_usage(uuid) is
  '이번 달(월초 기준) 생성한 리포트 수. 초안도 센다 — 토큰을 안 만들어도 남용은 남용이다.';

revoke all on function report_monthly_quota(uuid) from public;
revoke all on function report_monthly_quota(uuid) from anon;
grant execute on function report_monthly_quota(uuid) to authenticated;
revoke all on function report_monthly_usage(uuid) from public;
revoke all on function report_monthly_usage(uuid) from anon;
grant execute on function report_monthly_usage(uuid) to authenticated;

-- 한도는 **DB 에서 막는다.** 화면에서만 막으면 PostgREST 직접 호출로 우회된다.
create or replace function enforce_report_quota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.teacher_id is null then
    return new; -- 학생 본인 리포트(teacher_id 없음)는 이 한도의 대상이 아니다.
  end if;
  if report_monthly_usage(new.teacher_id) >= report_monthly_quota(new.teacher_id) then
    raise exception 'report_monthly_quota_exceeded';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_report_quota_trigger on reports;
create trigger enforce_report_quota_trigger
before insert on reports
for each row execute function enforce_report_quota();
