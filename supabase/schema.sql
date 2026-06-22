-- ============================================================================
-- 쌤플래너 (Ssamplanner) — Supabase / Postgres 스키마 (초안)
-- 화면 카탈로그 + 유저플로우에서 역산. Codex는 `supabase db reset`으로 적용 후
-- 이후 변경은 supabase/migrations/* 로 관리한다.
--
-- ⚠️ 규칙(AGENTS.md):
--  - 모든 테이블 RLS 필수. 학생=본인만 / 과외쌤=active 연결 + 학생이 공개(disclosure)한 범위만 /
--    학부모=reports.share_token로만(인증 없이, 토큰 한정).
--  - 집중 모드 카메라 프레임/영상은 서버에 저장하지 않는다(메타데이터만).
--  - "앱 구독료(teacher_subscriptions, Stripe)"와 "수업·수업료(lesson_fees, 수기)"는 별개.
--  - 가격 상수: 학생 ₩2,900/월, 과외쌤 연결 학생당 ₩2,900/월(= active connections × 2900).
--  - RLS는 row 단위라 "열(column) 공개범위"는 아래 *teacher view*로 강제(예: v_teacher_study_sessions).
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------- ENUMs ----------
create type user_role            as enum ('student','teacher');
create type connection_status    as enum ('pending','active','rejected','disconnected');
create type subject_code         as enum ('math','english','korean','science','social','etc'); -- 수학/영어/국어/과학/사회/기타
create type todo_source          as enum ('self','teacher');     -- 본인 할 일 / 선생님 숙제
create type todo_status          as enum ('todo','done');
create type submission_verdict   as enum ('pass','insufficient','ambiguous'); -- 통과/미흡/애매 (채점 아님)
create type review_status        as enum ('pending','confirmed','rejected');  -- 쌤 확인 전/완료/반려(다시 제출)
create type report_type          as enum ('weekly','lesson');     -- 주간(학부모)/수업 리포트
create type report_status        as enum ('draft','sent');
create type sub_status           as enum ('none','active','past_due','canceled','paused'); -- 구독 상태(미납=past_due)
create type sub_provider         as enum ('iap','stripe');
create type activity_type        as enum ('school','academy','self','class'); -- 시간표 블록: 학교/학원/자습/수업
create type notif_type           as enum ('reminder','homework','resubmit','check_done','report','connection','billing','cheer','system');
create type unlock_feature       as enum ('report','ai_check','ai_rec'); -- 광고 보상 언락 대상

-- ============================================================================
-- 1. 프로필 (auth.users 1:1)
-- ============================================================================
create table profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  role          user_role not null,
  name          text not null,
  avatar_url    text,
  -- 학생 전용
  grade         text,                 -- 예: '고3'
  target_univ   text,
  birth_date    date,                 -- 만14세 미만 보호자 동의 판단
  guardian_consented_at timestamptz,  -- 만14세 미만 가입 완료 시 보호자 동의 시각
  -- 과외쌤 전용
  subjects      subject_code[],       -- 담당 과목
  bio           text,                 -- 한 줄 소개
  onboarded     boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table profiles enable row level security;
create policy profiles_self_rw on profiles
  for all using (id = auth.uid()) with check (id = auth.uid());
-- 과외쌤은 연결된 학생 프로필(기본 정보) 조회 가능 / 학생은 연결된 쌤 프로필 조회 가능 → 아래 함수 정의 후 정책 추가(§연결)

-- ---------- helper: 현재 사용자 역할 ----------
create or replace function current_role_is(p user_role) returns boolean
language sql stable as $$
  select exists(select 1 from profiles where id = auth.uid() and role = p);
$$;

-- ============================================================================
-- 2. 연결(과외쌤 ↔ 학생) + 초대코드 + 핸드셰이크
-- ============================================================================
create table invite_codes (
  code        text primary key,                          -- 예: 6~8자리
  teacher_id  uuid not null references profiles(id) on delete cascade,
  expires_at  timestamptz,
  used_by     uuid references profiles(id),
  created_at  timestamptz not null default now()
);
alter table invite_codes enable row level security;
create policy invite_owner on invite_codes for all
  using (teacher_id = auth.uid()) with check (teacher_id = auth.uid());

create table connections (
  id          uuid primary key default gen_random_uuid(),
  teacher_id  uuid not null references profiles(id) on delete cascade,
  student_id  uuid not null references profiles(id) on delete cascade,
  status      connection_status not null default 'pending',
  invite_code text references invite_codes(code),
  requested_by uuid references profiles(id),             -- 누가 요청했는지
  created_at  timestamptz not null default now(),
  activated_at timestamptz,
  unique (teacher_id, student_id)
);
alter table connections enable row level security;
create policy conn_party_read on connections for select
  using (teacher_id = auth.uid() or student_id = auth.uid());
create policy conn_student_insert_pending on connections for insert
  with check (
    student_id = auth.uid()
    and requested_by = auth.uid()
    and status = 'pending'
  );
create policy conn_teacher_update_status on connections for update
  using (teacher_id = auth.uid())
  with check (teacher_id = auth.uid());

create or replace function request_connection_by_invite(p_code text)
returns connections
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_code text;
  invite_row invite_codes%rowtype;
  existing_row connections%rowtype;
  result_row connections%rowtype;
begin
  normalized_code := upper(regexp_replace(coalesce(p_code, ''), '[\s-]+', '', 'g'));

  if auth.uid() is null then
    raise exception 'authentication_required';
  end if;

  if not current_role_is('student') then
    raise exception 'student_profile_required';
  end if;

  if normalized_code !~ '^[A-Z0-9]{6,8}$' then
    raise exception 'invalid_invite_code';
  end if;

  select *
    into invite_row
    from invite_codes
    where code = normalized_code
      and (expires_at is null or expires_at > now())
    for update;

  if not found then
    raise exception 'invite_code_not_found';
  end if;

  if invite_row.used_by is not null and invite_row.used_by <> auth.uid() then
    raise exception 'invite_code_already_used';
  end if;

  select *
    into existing_row
    from connections
    where teacher_id = invite_row.teacher_id
      and student_id = auth.uid()
    for update;

  if found then
    if existing_row.status in ('rejected', 'disconnected') then
      update connections
        set status = 'pending',
            invite_code = normalized_code,
            requested_by = auth.uid(),
            created_at = now(),
            activated_at = null
        where id = existing_row.id
        returning * into result_row;
    else
      result_row := existing_row;
    end if;
  else
    insert into connections (teacher_id, student_id, status, invite_code, requested_by)
    values (invite_row.teacher_id, auth.uid(), 'pending', normalized_code, auth.uid())
    returning * into result_row;
  end if;

  update invite_codes
    set used_by = auth.uid()
    where code = normalized_code
      and used_by is null;

  insert into disclosure_settings (connection_id)
  values (result_row.id)
  on conflict (connection_id) do nothing;

  return result_row;
end;
$$;

revoke all on function request_connection_by_invite(text) from public;
grant execute on function request_connection_by_invite(text) to authenticated;

-- "이 과외쌤이 이 학생과 active 연결인가" — 다른 정책에서 재사용
create or replace function is_connected_active(p_teacher uuid, p_student uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from connections
    where teacher_id = p_teacher and student_id = p_student and status = 'active'
  );
$$;

-- 이제 프로필 상호 조회 정책(연결 당사자 한정)
create policy profiles_connected_read on profiles for select using (
  exists(select 1 from connections c
         where c.status='active'
           and ((c.teacher_id=auth.uid() and c.student_id=profiles.id)
             or (c.student_id=auth.uid() and c.teacher_id=profiles.id)))
);

-- ============================================================================
-- 3. 공개 범위(학생 통제) + 과외쌤 학생별 설정(검사 과목·리포트 주기)
-- ============================================================================
create table disclosure_settings (
  connection_id        uuid primary key references connections(id) on delete cascade,
  share_study_time     boolean not null default true,   -- 공부 시간·과목
  share_homework_photos boolean not null default true,  -- 숙제·검사 사진
  share_focus_data     boolean not null default false,  -- 집중도·졸음 데이터
  updated_at           timestamptz not null default now()
);
alter table disclosure_settings enable row level security;
-- 학생만 수정, 과외쌤은 읽기 전용
create policy disclosure_student_rw on disclosure_settings for all using (
  exists(select 1 from connections c where c.id=connection_id and c.student_id=auth.uid())
) with check (
  exists(select 1 from connections c where c.id=connection_id and c.student_id=auth.uid())
);
create policy disclosure_teacher_read on disclosure_settings for select using (
  exists(select 1 from connections c where c.id=connection_id and c.teacher_id=auth.uid())
);

create table per_student_settings (
  connection_id    uuid primary key references connections(id) on delete cascade,
  ai_check_subjects subject_code[] not null default '{}', -- 이 학생의 AI 검사 대상 과목(과외쌤 지정)
  report_cycle     text not null default 'weekly',        -- weekly|biweekly|none
  updated_at       timestamptz not null default now()
);
alter table per_student_settings enable row level security;
create policy pss_teacher_rw on per_student_settings for all using (
  exists(select 1 from connections c where c.id=connection_id and c.teacher_id=auth.uid())
) with check (
  exists(select 1 from connections c where c.id=connection_id and c.teacher_id=auth.uid())
);

-- ============================================================================
-- 4. 할 일 / 숙제 (통합) + AI 완료검사
-- ============================================================================
create table todos (
  id            uuid primary key default gen_random_uuid(),
  student_id    uuid not null references profiles(id) on delete cascade,
  connection_id uuid references connections(id) on delete set null, -- 선생님 숙제면 출처 연결
  title         text not null,
  subject       subject_code,
  source        todo_source not null default 'self',
  ai_check_enabled boolean not null default false,  -- self는 학생 토글 / teacher는 출제 때 결정
  locked        boolean not null default false,     -- teacher 숙제는 학생이 ai_check 변경 불가
  due_date      date,
  status        todo_status not null default 'todo',
  created_by    uuid not null references profiles(id),
  created_at    timestamptz not null default now()
);
alter table todos enable row level security;
create policy todos_student_rw on todos for all
  using (student_id = auth.uid()) with check (student_id = auth.uid());
-- 과외쌤: 연결된 학생의 숙제(자기가 만든 것) 읽기/쓰기
create policy todos_teacher_rw on todos for all using (
  exists(select 1 from connections c where c.id=todos.connection_id and c.teacher_id=auth.uid() and c.status='active')
) with check (
  exists(select 1 from connections c where c.id=todos.connection_id and c.teacher_id=auth.uid() and c.status='active')
);

-- 학생은 선생님 숙제(source=teacher)의 완료 상태 등은 바꿀 수 있지만
-- AI 검사 여부/출처/연결/작성자는 바꿀 수 없다. 선생님 숙제는 항상 locked=true.
create or replace function guard_student_todo_source_lock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() = new.student_id and new.source = 'teacher' then
      raise exception 'students_cannot_create_teacher_todos';
    end if;
  end if;

  if tg_op = 'UPDATE'
    and auth.uid() = old.student_id
    and old.source = 'teacher'
    and old.locked = true then
    if new.ai_check_enabled is distinct from old.ai_check_enabled
      or new.locked is distinct from old.locked
      or new.source is distinct from old.source
      or new.connection_id is distinct from old.connection_id
      or new.created_by is distinct from old.created_by
      or new.student_id is distinct from old.student_id then
      raise exception 'locked_teacher_todo_fields';
    end if;
  end if;

  if new.source = 'teacher' then
    new.locked := true;
  end if;

  return new;
end;
$$;

create trigger guard_student_todo_source_lock_trigger
before insert or update on todos
for each row execute function guard_student_todo_source_lock();

create table homework_submissions (
  id             uuid primary key default gen_random_uuid(),
  todo_id        uuid not null references todos(id) on delete cascade,
  student_id     uuid not null references profiles(id) on delete cascade,
  photo_paths    text[] not null default '{}',     -- Storage 경로(숙제 사진 — 집중모드 영상과 무관)
  submitted_at   timestamptz not null default now(),
  ai_verdict     submission_verdict,               -- 통과/미흡/애매
  ai_confidence  numeric,                           -- 0~1 확신도
  ai_reason      text,                              -- 사유(예: "p.116~118 풀이 일부 누락")
  teacher_status review_status not null default 'pending', -- 혼공생은 teacher_* 사용 안 함
  teacher_comment text,
  resubmit_requested boolean not null default false,
  created_at     timestamptz not null default now()
);
alter table homework_submissions enable row level security;
create policy subs_student_rw on homework_submissions for all
  using (student_id = auth.uid()) with check (student_id = auth.uid());
-- 과외쌤: 학생이 사진 공개(share_homework_photos)한 경우에만 사진 접근(앱/뷰 레이어에서 강제 권장)
create policy subs_teacher_read on homework_submissions for select using (
  exists(select 1 from connections c
         join disclosure_settings d on d.connection_id=c.id
         where c.student_id=homework_submissions.student_id and c.teacher_id=auth.uid()
           and c.status='active' and d.share_homework_photos)
);
create policy subs_teacher_update on homework_submissions for update using (
  exists(select 1 from connections c where c.student_id=homework_submissions.student_id and c.teacher_id=auth.uid() and c.status='active')
);

-- M4: AI 판정은 서버 권위적 — ai_* 는 서비스롤(정의자 RPC)로만 기록(채점 아님, 완료 확인).
create or replace function apply_homework_ai_verdict(
  p_submission_id uuid,
  p_verdict submission_verdict,
  p_confidence numeric,
  p_reason text
)
returns homework_submissions
language plpgsql
security definer
set search_path = public
as $$
declare
  result_row homework_submissions%rowtype;
begin
  update homework_submissions
    set ai_verdict = p_verdict,
        ai_confidence = case when p_confidence is null then null else greatest(0, least(1, p_confidence)) end,
        ai_reason = p_reason
    where id = p_submission_id
    returning * into result_row;
  if not found then
    raise exception 'homework_submission_not_found';
  end if;
  return result_row;
end;
$$;
revoke all on function apply_homework_ai_verdict(uuid, submission_verdict, numeric, text) from public;
revoke all on function apply_homework_ai_verdict(uuid, submission_verdict, numeric, text) from authenticated;
grant execute on function apply_homework_ai_verdict(uuid, submission_verdict, numeric, text) to service_role;

-- 무결성: ai_* 는 인증 사용자가 못 쓰고(서버 전용), teacher_* 는 학생이 못 바꾼다.
create or replace function guard_homework_submission_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    if tg_op = 'INSERT'
      and (new.ai_verdict is not null or new.ai_confidence is not null or new.ai_reason is not null) then
      raise exception 'ai_fields_are_server_set';
    end if;
    if tg_op = 'UPDATE'
      and (new.ai_verdict is distinct from old.ai_verdict
        or new.ai_confidence is distinct from old.ai_confidence
        or new.ai_reason is distinct from old.ai_reason) then
      raise exception 'ai_fields_are_server_set';
    end if;
  end if;
  if tg_op = 'UPDATE' and auth.uid() = new.student_id then
    if new.teacher_status is distinct from old.teacher_status
      or new.teacher_comment is distinct from old.teacher_comment
      or new.resubmit_requested is distinct from old.resubmit_requested then
      raise exception 'teacher_fields_not_student_editable';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists guard_homework_submission_fields_trigger on homework_submissions;
create trigger guard_homework_submission_fields_trigger
  before insert or update on homework_submissions
  for each row execute function guard_homework_submission_fields();

-- ============================================================================
-- 5. 공부 세션(타이머) + 집중 모드(졸음=메타데이터만, 영상 미저장)
-- ============================================================================
create table study_sessions (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references profiles(id) on delete cascade,
  subject      subject_code,
  started_at   timestamptz not null,
  ended_at     timestamptz,
  duration_sec integer not null default 0,
  timer_state  text not null default 'completed' check (timer_state in ('running', 'paused', 'completed')),
  last_resumed_at timestamptz,
  focus_mode   boolean not null default false,
  focus_score  numeric,        -- 집중률(%) — 집중 모드 시
  drowsy_count integer,        -- 졸음 감지 횟수(메타데이터)
  check_total  integer,        -- 점검 횟수
  created_at   timestamptz not null default now()
);
alter table study_sessions enable row level security;
create policy sessions_student_rw on study_sessions for all
  using (student_id = auth.uid()) with check (student_id = auth.uid());

-- ⚠️ 졸음 감지 프레임/영상은 저장하지 않는다. 필요한 점검 '결과'만 남길 경우:
create table focus_checks (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references study_sessions(id) on delete cascade,
  checked_at  timestamptz not null default now(),
  drowsy      boolean not null default false      -- 결과 boolean만(이미지 없음)
);
alter table focus_checks enable row level security;
create policy focus_student_rw on focus_checks for all using (
  exists(select 1 from study_sessions s where s.id=session_id and s.student_id=auth.uid())
) with check (
  exists(select 1 from study_sessions s where s.id=session_id and s.student_id=auth.uid())
);

create or replace function can_teacher_read_focus_check(
  p_teacher uuid,
  p_session uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from study_sessions s
    join connections c
      on c.student_id = s.student_id
     and c.status = 'active'
    join disclosure_settings d
      on d.connection_id = c.id
    where s.id = p_session
      and c.teacher_id = p_teacher
      and d.share_focus_data = true
  );
$$;

revoke all on function can_teacher_read_focus_check(uuid, uuid) from public;
grant execute on function can_teacher_read_focus_check(uuid, uuid) to authenticated;

create policy focus_teacher_read_disclosed on focus_checks for select using (
  can_teacher_read_focus_check(auth.uid(), focus_checks.session_id)
);

drop function if exists record_focus_check(uuid, boolean, timestamptz);

create or replace function save_focus_check(
  p_session_id uuid,
  p_drowsy boolean,
  p_checked_at timestamptz default now()
)
returns table (
  session_id uuid,
  focus_score numeric,
  drowsy_count integer,
  check_total integer
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  session_student_id uuid;
  next_total integer;
  next_drowsy integer;
begin
  if auth.uid() is null then
    raise exception 'authentication_required';
  end if;

  select student_id
    into session_student_id
    from study_sessions
    where id = p_session_id
      and focus_mode = true
    for update;

  if session_student_id is null then
    raise exception 'focus_session_not_found';
  end if;

  if session_student_id <> auth.uid() then
    raise exception 'focus_session_owner_required';
  end if;

  insert into focus_checks (session_id, checked_at, drowsy)
  values (p_session_id, coalesce(p_checked_at, now()), coalesce(p_drowsy, false));

  select
    count(*)::integer,
    count(*) filter (where drowsy)::integer
    into next_total, next_drowsy
    from focus_checks
    where focus_checks.session_id = p_session_id;

  return query
    update study_sessions
      set check_total = next_total,
          drowsy_count = next_drowsy,
          focus_score = round(((next_total - next_drowsy)::numeric / greatest(next_total, 1)::numeric) * 100, 2)
      where id = p_session_id
      returning id, study_sessions.focus_score, study_sessions.drowsy_count, study_sessions.check_total;
end;
$$;

revoke all on function save_focus_check(uuid, boolean, timestamptz) from public;
grant execute on function save_focus_check(uuid, boolean, timestamptz) to authenticated;

-- 과외쌤이 보는 공부/집중 데이터는 '공개 범위' 적용 → 뷰로 강제(예시):
drop view if exists v_teacher_focus_checks;
drop view if exists v_teacher_study_sessions;

create or replace view v_teacher_study_sessions as
  select
    s.id,
    s.student_id,
    s.subject,
    s.started_at,
    s.ended_at,
    s.duration_sec,
    s.timer_state,
    s.last_resumed_at,
    s.focus_mode,
    case when d.share_focus_data then s.focus_score else null end as focus_score,
    case when d.share_focus_data then s.drowsy_count else null end as drowsy_count,
    case when d.share_focus_data then s.check_total else null end as check_total,
    s.created_at,
    c.teacher_id
  from study_sessions s
  join connections c on c.student_id = s.student_id and c.status='active'
  join disclosure_settings d on d.connection_id = c.id
  where d.share_study_time = true
    and c.teacher_id = auth.uid();
grant select on v_teacher_study_sessions to authenticated;
create or replace view v_teacher_focus_checks as
  select
    fc.id,
    fc.session_id,
    fc.checked_at,
    fc.drowsy,
    c.teacher_id
  from focus_checks fc
  join study_sessions s on s.id = fc.session_id
  join connections c on c.student_id = s.student_id and c.status = 'active'
  join disclosure_settings d on d.connection_id = c.id
  where d.share_focus_data = true
    and c.teacher_id = auth.uid();
grant select on v_teacher_focus_checks to authenticated;

-- 혼공생 홈의 또래 랭킹은 같은 학년 학생의 익명 집계만 반환한다(개별 학생 노출 없음).
create or replace function get_peer_study_ranking(
  p_days integer default 7,
  p_min_cohort integer default 5
)
returns table (
  peer_count integer,
  min_cohort integer,
  can_show_peer_ranking boolean,
  current_user_minutes integer,
  peer_average_minutes integer,
  rank_percentile integer
)
language sql
stable
security definer
set search_path = public
as $$
  with limits as (
    select
      greatest(1, least(coalesce(p_days, 7), 30)) as days,
      greatest(5, coalesce(p_min_cohort, 5)) as min_cohort
  ),
  me as (
    select id, grade
    from profiles
    where id = auth.uid()
      and role = 'student'
  ),
  peers as (
    select p.id
    from profiles p
    join me on true
    where p.role = 'student'
      and coalesce(p.grade, '') = coalesce(me.grade, '')
  ),
  totals as (
    select
      peers.id,
      coalesce(sum(greatest(s.duration_sec, 0)), 0)::integer as seconds
    from peers
    left join study_sessions s
      on s.student_id = peers.id
     and s.started_at >= now() - make_interval(days => (select days from limits))
    group by peers.id
  ),
  ranked as (
    select
      id,
      seconds,
      rank() over (order by seconds desc) as rank_position,
      count(*) over () as cohort_count
    from totals
  ),
  mine as (
    select *
    from ranked
    where id = auth.uid()
  )
  select
    greatest(mine.cohort_count - 1, 0)::integer as peer_count,
    limits.min_cohort::integer as min_cohort,
    (mine.cohort_count >= limits.min_cohort)::boolean as can_show_peer_ranking,
    floor(mine.seconds / 60.0)::integer as current_user_minutes,
    case
      when mine.cohort_count >= limits.min_cohort
      then floor(coalesce((select avg(seconds) from totals where id <> auth.uid()), 0) / 60.0)::integer
      else null::integer
    end as peer_average_minutes,
    case
      when mine.cohort_count < limits.min_cohort then null::integer
      when mine.cohort_count <= 1 then null::integer
      else round(((mine.cohort_count - mine.rank_position)::numeric / (mine.cohort_count - 1)::numeric) * 100)::integer
    end as rank_percentile
  from mine
  cross join limits;
$$;

revoke all on function get_peer_study_ranking(integer, integer) from public;
grant execute on function get_peer_study_ranking(integer, integer) to authenticated;

-- ============================================================================
-- 6. 시간표
-- ============================================================================
create table timetable_blocks (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references profiles(id) on delete cascade,
  type         activity_type not null,
  day_of_week  smallint not null check (day_of_week between 0 and 6),
  start_min    smallint not null,   -- 0~1439 (자정 기준 분)
  end_min      smallint not null,
  label        text                 -- 예: '학교','수학 학원'
);
alter table timetable_blocks enable row level security;
create policy tt_student_rw on timetable_blocks for all
  using (student_id = auth.uid()) with check (student_id = auth.uid());

-- ============================================================================
-- 7. AI 공부량 추천 (입시데이터 기반)
-- ============================================================================
create table ai_recommendations (
  id            uuid primary key default gen_random_uuid(),
  student_id    uuid not null references profiles(id) on delete cascade,
  week_start    date not null,
  subject       subject_code not null,
  recommended_hours numeric not null,
  reason        text,
  generated_at  timestamptz not null default now(),
  unique (student_id, week_start, subject)
);
alter table ai_recommendations enable row level security;
create policy airec_student_rw on ai_recommendations for all
  using (student_id = auth.uid()) with check (student_id = auth.uid());

-- ============================================================================
-- 8. 리포트(학생 나의 리포트 / 과외쌤 수업·주간) + 학부모 공유
-- ============================================================================
create table reports (
  id             uuid primary key default gen_random_uuid(),
  student_id     uuid not null references profiles(id) on delete cascade,
  teacher_id     uuid references profiles(id),      -- 학생 본인 리포트면 null
  type           report_type not null,
  period_start   date not null,
  period_end     date not null,
  data           jsonb not null default '{}',       -- 차트용 집계(공부시간·수행률·성적·집중도)
  ai_draft       text,                              -- AI 코멘트 초안
  teacher_comment text,
  included_subjects subject_code[] not null default '{}',
  status         report_status not null default 'draft',
  share_token    text unique,                       -- 학부모 웹뷰 토큰(만료 가능)
  share_expires_at timestamptz,
  sent_at        timestamptz,
  created_at     timestamptz not null default now()
);
alter table reports enable row level security;
create policy reports_student_read on reports for select using (student_id = auth.uid());
create policy reports_teacher_rw on reports for all using (
  teacher_id = auth.uid() or
  exists(select 1 from connections c where c.student_id=reports.student_id and c.teacher_id=auth.uid() and c.status='active')
) with check (
  teacher_id = auth.uid() or
  exists(select 1 from connections c where c.student_id=reports.student_id and c.teacher_id=auth.uid() and c.status='active')
);
-- 학부모: 인증 없이 share_token으로 조회 → Edge Function(anon)에서 토큰 검증 후 반환(직접 RLS 노출 금지).

create table report_views (
  id         uuid primary key default gen_random_uuid(),
  report_id  uuid not null references reports(id) on delete cascade,
  viewed_at  timestamptz not null default now()
);
alter table report_views enable row level security; -- 쓰기는 정의자 RPC(get_shared_report)로만

-- M5: 과외쌤이 공유 링크 발급(토큰+만료+발송).
create or replace function create_report_share(p_report_id uuid, p_ttl_hours integer default 168)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  report_row reports%rowtype;
  new_token text;
  expires timestamptz;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  select * into report_row from reports where id = p_report_id;
  if not found then raise exception 'report_not_found'; end if;
  if not (
    report_row.teacher_id = auth.uid()
    or exists (select 1 from connections c
               where c.student_id = report_row.student_id and c.teacher_id = auth.uid() and c.status = 'active')
  ) then
    raise exception 'not_authorized';
  end if;
  new_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  expires := now() + make_interval(hours => greatest(1, coalesce(p_ttl_hours, 168)));
  update reports
    set share_token = new_token, share_expires_at = expires, status = 'sent', sent_at = now()
    where id = p_report_id;
  return jsonb_build_object('token', new_token, 'expires_at', expires);
end;
$$;
revoke all on function create_report_share(uuid, integer) from public;
grant execute on function create_report_share(uuid, integer) to authenticated;

-- M5: 학부모(anon)가 토큰으로 조회 — 만료/무효 처리 + report_views 기록(테이블 직접 노출 금지).
create or replace function get_shared_report(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  report_row reports%rowtype;
begin
  if p_token is null or length(p_token) < 16 then
    return jsonb_build_object('status', 'not_found');
  end if;
  select * into report_row from reports where share_token = p_token;
  if not found or report_row.status <> 'sent' then
    return jsonb_build_object('status', 'not_found');
  end if;
  if report_row.share_expires_at is not null and report_row.share_expires_at < now() then
    return jsonb_build_object('status', 'expired');
  end if;
  insert into report_views (report_id) values (report_row.id);
  return jsonb_build_object(
    'status', 'ok',
    'report', jsonb_build_object(
      'id', report_row.id, 'type', report_row.type,
      'period_start', report_row.period_start, 'period_end', report_row.period_end,
      'data', report_row.data, 'ai_draft', report_row.ai_draft,
      'teacher_comment', report_row.teacher_comment,
      'included_subjects', report_row.included_subjects, 'sent_at', report_row.sent_at
    )
  );
end;
$$;
revoke all on function get_shared_report(text) from public;
grant execute on function get_shared_report(text) to anon, authenticated;

-- ============================================================================
-- 9. 수업·수업료 (수기 트래커 — 결제 처리 아님!)
-- ============================================================================
create table lesson_fees (
  id          uuid primary key default gen_random_uuid(),
  teacher_id  uuid not null references profiles(id) on delete cascade,
  student_id  uuid not null references profiles(id) on delete cascade,
  period      text not null,            -- 예: '2026-06'
  amount      integer not null,         -- 과외비(원) — 표시용
  paid        boolean not null default false,
  paid_at     timestamptz,
  memo        text,
  unique (teacher_id, student_id, period)
);
alter table lesson_fees enable row level security;
create policy fees_teacher_rw on lesson_fees for all
  using (teacher_id = auth.uid()) with check (teacher_id = auth.uid());

-- ============================================================================
-- 10. 구독/결제  (★ 앱 구독료 — 수업료와 별개)
-- ============================================================================
-- 학생 프리미엄(IAP)
create table student_subscriptions (
  student_id   uuid primary key references profiles(id) on delete cascade,
  status       sub_status not null default 'none',
  provider     sub_provider not null default 'iap',
  expires_at   timestamptz,
  updated_at   timestamptz not null default now()
);
alter table student_subscriptions enable row level security;
create policy studsub_self on student_subscriptions for select using (student_id = auth.uid());
-- 갱신은 RevenueCat/IAP 웹훅(서비스롤)로만.

-- 과외쌤 앱 구독료(Stripe) — 월 청구 = active 연결 수 × 2900
create table teacher_subscriptions (
  teacher_id        uuid primary key references profiles(id) on delete cascade,
  status            sub_status not null default 'none',
  provider          sub_provider not null default 'stripe',
  stripe_customer_id text,
  payment_method_last4 text,
  current_period_end timestamptz,
  updated_at        timestamptz not null default now()
);
alter table teacher_subscriptions enable row level security;
create policy tsub_self on teacher_subscriptions for select using (teacher_id = auth.uid());

create table billing_invoices (
  id            uuid primary key default gen_random_uuid(),
  teacher_id    uuid not null references profiles(id) on delete cascade,
  period        text not null,          -- '2026-06'
  student_count integer not null,       -- 과금 대상(active 연결) 수
  amount        integer not null,       -- = student_count * 2900
  status        text not null default 'open', -- open|paid|failed|past_due
  issued_at     timestamptz not null default now(),
  paid_at       timestamptz,
  unique (teacher_id, period)
);
alter table billing_invoices enable row level security;
create policy inv_self on billing_invoices for select using (teacher_id = auth.uid());

-- 광고 보상 언락(무료 사용자) — 리포트/AI검사(혼공)/AI추천
create table ad_unlocks (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references profiles(id) on delete cascade,
  feature     unlock_feature not null,
  unlocked_at timestamptz not null default now(),
  expires_at  timestamptz
);
alter table ad_unlocks enable row level security;
create policy unlock_self on ad_unlocks for all
  using (student_id = auth.uid()) with check (student_id = auth.uid());

-- ============================================================================
-- 11. 알림 + 푸시 토큰
-- ============================================================================
create table notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  type        notif_type not null,
  title       text not null,
  body        text,
  payload     jsonb,                 -- 딥링크용
  read        boolean not null default false,
  created_at  timestamptz not null default now()
);
alter table notifications enable row level security;
create policy notif_self on notifications for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create table push_tokens (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references profiles(id) on delete cascade,
  token     text not null,
  platform  text not null,           -- ios|android|web
  created_at timestamptz not null default now(),
  unique (user_id, token)
);
alter table push_tokens enable row level security;
create policy push_self on push_tokens for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- 인덱스(자주 쓰는 조회) ----------
create index on todos (student_id, status);
create index on todos (connection_id);
create index on homework_submissions (student_id, teacher_status);
create index if not exists homework_submissions_student_submitted_idx on homework_submissions (student_id, submitted_at desc);
create index if not exists homework_submissions_todo_submitted_idx on homework_submissions (todo_id, submitted_at desc);
create index on study_sessions (student_id, started_at);
create index if not exists sessions_student_active_timer_idx on study_sessions (student_id, timer_state, started_at) where ended_at is null;
create index if not exists focus_checks_session_checked_at_idx on focus_checks (session_id, checked_at);
create index on connections (teacher_id, status);
create index on connections (student_id, status);
create index on notifications (user_id, read);
create index on reports (student_id, type, period_start);
create index if not exists todos_student_due_date_idx on todos (student_id, due_date);
create index if not exists timetable_blocks_student_day_start_idx on timetable_blocks (student_id, day_of_week, start_min);

-- ============================================================================
-- Storage 버킷(앱에서 생성):
--   - homework-photos : 숙제 제출 사진(비공개, 학생 본인 + 공개 시 연결 쌤)
--   - avatars         : 프로필 이미지(공개/서명 URL)
--   ※ 집중 모드 졸음 영상/프레임 버킷은 만들지 않는다(온디바이스 전용).
--
-- Edge Functions(supabase/functions/):
--   - ai-homework-check : 제출 사진 → Anthropic 비전 → {verdict, confidence, reason}. 채점 아님.
--   - ai-study-rec      : 학생 데이터+코호트 → 과목별 주간 추천 시간 + 사유.
--   - ai-report-draft   : 주간 집계 → 선생님 코멘트 초안.
--   - report-share      : (anon) share_token 검증 → 리포트 반환 + report_views 기록.
--   - billing-stripe    : Stripe 웹훅 → teacher_subscriptions/billing_invoices 갱신, 미납(past_due) 처리.
--   - iap-webhook       : RevenueCat/IAP → student_subscriptions 갱신.
-- (AI/결제 키는 함수 환경변수로만. RLS 우회가 필요한 쓰기는 서비스롤로 함수 안에서.)
-- ============================================================================
