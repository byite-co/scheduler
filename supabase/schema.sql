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
--  - 가격 상수: 학생 ₩8,900/월, 과외쌤 연결 학생당 ₩4,900/월(= active connections × 4900). 2026-08-10 인상.
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
-- AI 검사 실행 상태. ambiguous 는 판정 결과이므로 여기 섞지 않는다(verdict 로 간다).
-- queued 는 비동기 워커를 붙일 때를 위한 예비값 — 현재 실행은 동기라 곧바로 processing 이다.
create type check_attempt_status as enum ('queued', 'processing', 'completed', 'failed');

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
  used_by     uuid references profiles(id) on delete set null,  -- 탈퇴하면 NULL(코드 이력은 남긴다)
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
  requested_by uuid references profiles(id) on delete set null, -- 누가 요청했는지(탈퇴하면 NULL)
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
  -- AI 숙제검사가 제출 사진과 대조할 "수행 범위 원문". title(목록에 보이는 이름)과 역할이 다르다.
  -- 예) '쎈 112~118p, 115p 제외'. 일반 메모로 쓰지 않는다. 빈 문자열은 트리거가 NULL 로 정규화.
  scope_text    text,
  locked        boolean not null default false,     -- teacher 숙제는 학생이 ai_check 변경 불가
  due_date      date,
  status        todo_status not null default 'todo',
  -- 탈퇴하면 NULL(20260809010000). NOT NULL + 절 없음이면 과외쌤 탈퇴가 23503 으로 막힌다.
  created_by    uuid references profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  -- 길이 상한은 DB 에서 강제한다 — 클라이언트 검증만 두면 PostgREST 직접 호출로 우회된다.
  -- 공백 제외 글자 수 기준(\s = [[:space:]]). 하한 1 은 "빈 문자열은 NULL" 불변식을 못박는 것으로,
  -- 정규화 트리거가 사라지거나 우회되면 곧바로 드러난다.
  constraint todos_scope_text_len
    check (scope_text is null or length(regexp_replace(scope_text, '\s', '', 'g')) between 1 and 500),
  -- AI 완료검사를 켠 행은 범위가 있어야 한다. 없으면 AI 가 "무엇과" 대조할지 알 수 없고,
  -- 기준 없는 검사에 API 비용만 든다. UI 도 막지만 PostgREST 직접 호출은 UI 를 지나지 않는다.
  constraint todos_ai_check_needs_scope
    check (ai_check_enabled = false or scope_text is not null)
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

-- 학생의 todos UPDATE 는 '허용 목록(allowlist)'만 통과한다 — 목록에 없는 컬럼은 기본 잠김.
--  - source='teacher' 숙제: status(완료 체크)만. 범위(scope_text/title)·과목·마감일 포함 그 외 전부 금지.
--  - source='self' 할 일: title/subject/due_date/status/ai_check_enabled/scope_text.
--  - 어느 쪽에도 없는 id/student_id/connection_id/source/created_by/created_at/locked 는 항상 잠김.
-- 새 컬럼을 추가하면 자동으로 잠긴다(금지 목록 방식의 갱신 누락 사고 방지).
--   → scope_text 추가 때 실제로 값을 했다: teacher 행에서는 목록에 넣지 않는 것만으로 잠겼다.
-- 교사(active 연결)·서비스롤은 이 게이트를 지나지 않는다 → 기존 권한 유지. 교사 숙제는 항상 locked=true.
-- 이 함수는 scope_text 의 '빈 문자열 → NULL' 정규화도 함께 맡는다(아래 주석 참고).
create or replace function guard_student_todo_source_lock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  student_editable text[];
  old_frozen jsonb;
  new_frozen jsonb;
begin
  -- 빈 문자열·공백뿐인 입력은 NULL 로 정규화한다. "범위 없음"을 표현하는 값은 하나여야
  -- 한다 — '' 와 NULL 이 섞이면 AI 검사 분기가 두 값을 모두 다뤄야 한다.
  --
  -- 앞뒤 공백 제거에 btrim(v) 을 쓰면 안 된다 — 인자가 하나면 space 만 지우고 탭·개행이
  -- 남는다. 그러면 공백뿐인 입력이 NULL 이 되지 않고 위 CHECK 제약 위반으로 거부된다
  -- (20260806020000 에서 실제로 잡힌 버그). CHECK 와 같은 \s 클래스를 써야 갈라지지 않는다.
  --
  -- 별도 트리거로 분리하지 않고 이 함수 맨 앞에 둔 이유:
  --   · 같은 테이블의 BEFORE 트리거는 이름 알파벳순으로 실행된다 → 순서가 이름에 의존해 깨지기 쉽다.
  --   · 아래 INSERT 분기는 early return 하므로, INSERT 에도 적용되려면 그보다 앞이어야 한다.
  --   · 허용 목록 비교보다 먼저 정규화돼야 '' → NULL 같은 실질적 무변경이 오탐으로 막히지 않는다.
  new.scope_text := nullif(regexp_replace(new.scope_text, '^\s+|\s+$', '', 'g'), '');

  if tg_op = 'INSERT' then
    if auth.uid() = new.student_id and new.source = 'teacher' then
      raise exception 'students_cannot_create_teacher_todos';
    end if;
    if new.source = 'teacher' then
      new.locked := true;
    end if;
    return new;
  end if;

  if auth.uid() = old.student_id then
    if old.source = 'teacher' then
      student_editable := array['status'];
    else
      student_editable := array['title', 'subject', 'due_date', 'status', 'ai_check_enabled', 'scope_text'];
    end if;

    old_frozen := to_jsonb(old) - student_editable;
    new_frozen := to_jsonb(new) - student_editable;

    if old_frozen is distinct from new_frozen then
      if old.source = 'teacher' then
        raise exception 'locked_teacher_todo_fields';
      else
        raise exception 'locked_self_todo_fields';
      end if;
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
  created_at     timestamptz not null default now(),
  -- 사진 1~9장. coalesce 없이 array_length 를 쓰면 빈 배열(NULL)이 통과한다.
  constraint subs_photo_count
    check (coalesce(array_length(photo_paths, 1), 0) between 1 and 9)
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

create table homework_check_attempts (
  id                        uuid primary key default gen_random_uuid(),
  submission_id             uuid not null references homework_submissions(id) on delete cascade,
  -- profiles 참조에 ON DELETE 절을 빼면 계정 삭제가 막힌다(todos.created_by 로 이미 겪었다 —
  -- 테스트 계정 55건이 원격에 쌓였던 원인). 이 레포의 계정 탈퇴 정책은 전체 cascade 다.
  requested_by              uuid not null references profiles(id) on delete cascade,
  status                    check_attempt_status not null default 'queued',
  -- 스냅샷: 검사 시작 후 학생이 사진이나 범위를 바꾸면 AI 가 본 자료와 화면에 보이는 자료가
  -- 달라진다. 검사 슬롯을 확보하는 순간 범위·사진 경로를 함께 고정한다.
  scope_text_snapshot       text,
  photo_paths_snapshot      text[] not null,
  -- verdict/confidence/reason 은 **구 판정 경로**의 컬럼이다(20260807030000 이후 새로 쓰지 않는다).
  -- 지우지 않는 이유: 이전 실행 이력이 남아 있고, 되돌릴 때 근거가 된다.
  verdict                   submission_verdict,   -- 완료 전에는 NULL
  confidence                numeric,
  reason                    text,
  -- 관찰 원본(20260807030000). AI 는 판정하지 않고 보이는 표시만 기록한다 —
  -- 이건 **확정 사실이 아니다.** 서버 계산값·사람 확인값은 다음 단계에서 별도 컬럼에 둔다.
  raw_ai_observation        jsonb,
  -- 어느 프롬프트/스키마/범위설정에서 나온 관찰인지. 없으면 A/B 비교가 불가능하다.
  prompt_version            text,
  schema_version            text,
  scope_included            boolean,
  -- 정상 관찰로 인정한 근거(end_turn 아니면 폐기) + 검증 실패로 폐기한 이유.
  stop_reason               text,
  discard_reason            text,
  latency_ms                integer,
  idempotency_key           text not null,
  model                     text,
  input_tokens              integer,
  output_tokens             integer,
  -- 비용은 부동소수점으로 두면 합산할 때 오차가 쌓인다 → 정수(마이크로달러)로 저장한다.
  estimated_cost_usd_micros bigint,
  error_code                text,
  created_at                timestamptz not null default now(),
  started_at                timestamptz,
  completed_at              timestamptz,
  updated_at                timestamptz not null default now(),

  -- 동일 요청 재전송 방지. 실연동에서 이게 없으면 네트워크 재시도가 곧 중복 과금이다.
  constraint homework_check_attempts_idempotency_key
    unique (requested_by, idempotency_key),
  constraint attempts_idempotency_key_not_blank
    check (btrim(idempotency_key) <> ''),
  -- 완료된 실행에는 결과가 하나는 있어야 하고, 완료가 아니면 없어야 한다(양방향).
  -- 20260807030000 에서 완화: 관찰 전용 실행에는 verdict 가 없고 raw_ai_observation 만 있다.
  constraint attempts_completed_has_result
    check ((status = 'completed') = (verdict is not null or raw_ai_observation is not null)),
  constraint attempts_latency_non_negative
    check (latency_ms is null or latency_ms >= 0),
  -- 사진 1~9개. array_length 는 빈 배열에 NULL 을 돌려주므로 coalesce 가 없으면
  -- `NULL between 1 and 9` → NULL → 제약이 통과해 버린다(0개가 그대로 들어간다).
  constraint attempts_photo_count
    check (coalesce(array_length(photo_paths_snapshot, 1), 0) between 1 and 9),
  constraint attempts_confidence_range
    check (confidence is null or confidence between 0 and 1),
  constraint attempts_tokens_non_negative
    check (coalesce(input_tokens, 0) >= 0 and coalesce(output_tokens, 0) >= 0),
  constraint attempts_cost_non_negative
    check (coalesce(estimated_cost_usd_micros, 0) >= 0),
  constraint attempts_error_only_when_failed
    check (status = 'failed' or error_code is null),
  -- 끝난 실행에는 끝난 시각이 있고, 안 끝난 실행에는 없다.
  constraint attempts_completed_at_matches_status
    check ((status in ('completed', 'failed')) = (completed_at is not null))
);

-- 한 제출에 진행 중(queued/processing)인 검사는 동시에 하나만.
-- 부분 유니크 인덱스로 강제한다(같은 방식이 sessions_student_active_timer_idx 에 이미 쓰인다).
create unique index homework_check_attempts_one_active_idx
  on homework_check_attempts (submission_id)
  where status in ('queued', 'processing');

create index homework_check_attempts_submission_created_idx
  on homework_check_attempts (submission_id, created_at desc);
create index homework_check_attempts_requested_by_idx
  on homework_check_attempts (requested_by, created_at desc);

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- 읽기만 열고 쓰기 정책은 두지 않는다 → anon/authenticated 의 INSERT/UPDATE/DELETE 는
-- 통과할 정책이 없어 전부 거부된다. service_role 은 RLS 를 우회한다.
alter table homework_check_attempts enable row level security;

-- 학생: 자기 제출의 attempt 읽기만.
create policy attempts_student_read on homework_check_attempts for select using (
  exists (
    select 1 from homework_submissions s
    where s.id = homework_check_attempts.submission_id
      and s.student_id = auth.uid()
  )
);

-- 과외쌤: subs_teacher_read 와 **같은 조건**(active 연결 + share_homework_photos).
-- 제출을 볼 수 없는 과외쌤이 그 제출의 검사 이력을 보면 공개범위가 무의미해진다.
create policy attempts_teacher_read on homework_check_attempts for select using (
  exists (
    select 1
    from homework_submissions s
    join connections c on c.student_id = s.student_id
    join disclosure_settings d on d.connection_id = c.id
    where s.id = homework_check_attempts.submission_id
      and c.teacher_id = auth.uid()
      and c.status = 'active'
      and d.share_homework_photos
  )
);

-- 이중 잠금: RLS 가 1차 방어선이고, 이 트리거는 나중에 누가 실수로 쓰기 정책을 추가해도
-- 인증 세션의 쓰기가 조용히 통과하지 않게 한다(guard_homework_submission_fields 와 같은 원칙).
--
-- ⚠️ DELETE 에는 걸지 않는다. 학생이 자기 제출을 지우면 attempt 가 cascade 로 지워지는데,
--    cascade 는 호출자 컨텍스트(auth.uid() 존재)에서 실행된다. DELETE 를 막으면 학생이
--    자기 제출을 못 지우고 계정 탈퇴(delete_my_account)의 전체 cascade 도 깨진다.
create or replace function guard_homework_check_attempt_writes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    raise exception 'check_attempts_are_server_written';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_homework_check_attempt_writes_trigger on homework_check_attempts;
create trigger guard_homework_check_attempt_writes_trigger
before insert or update on homework_check_attempts
for each row execute function guard_homework_check_attempt_writes();

-- ── 실행 라이프사이클 RPC (service_role 전용) ────────────────────────────────
-- requested_by 를 auth.uid() 로 유도하지 않고 인자로 받는다. service_role 은 auth.uid() 가
-- null 이라 유도형으로 만들면 호출 자체가 불가능해진다(mock 구독 RPC 에서 겪은 문제).

-- start_homework_check_attempt 확장: 구조적 전제 + 사용량 한도를 슬롯 확보와 원자적으로 검사.
--
-- ⚠️ 과금 권한(프리미엄/연결) 분기는 Edge Function 이 담당한다. 여기서 다시 판정하지 않는
--    이유는 규칙을 두 곳에 두면 갈라지기 때문이다(이 레포에서 반복해 겪은 문제).
--    **새로운 호출자를 추가한다면 반드시 그 앞에서 과금 권한을 검사해야 한다.**
--    구조적 전제(ai_check_enabled/scope_text)는 데이터 유효성이라 여기서도 막는다.
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
  -- (todos_ai_check_needs_scope 제약이 있어 정상 경로에서는 둘이 함께 성립한다.)
  if not todo_row.ai_check_enabled then
    raise exception 'ai_check_disabled_for_todo';
  end if;
  if nullif(btrim(coalesce(todo_row.scope_text, '')), '') is null then
    raise exception 'scope_text_required_for_check';
  end if;

  -- 사용량 검사와 슬롯 확보를 직렬화한다. count 만으로는 동시 요청이 둘 다 통과할 수 있다.
  perform pg_advisory_xact_lock(hashtext('homework_check_attempt:' || p_requested_by::text));

  select count(*) into attempts_for_submission
    from homework_check_attempts
   where submission_id = p_submission_id;
  if attempts_for_submission >= ai_check_max_attempts_per_submission() then
    raise exception 'check_limit_submission_exceeded';
  end if;

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

-- 2) 완료 기록 + homework_submissions 캐시 갱신.
create or replace function complete_homework_check_attempt(
  p_attempt_id uuid,
  p_verdict submission_verdict,
  p_confidence numeric,
  p_reason text,
  p_model text default null,
  p_input_tokens integer default null,
  p_output_tokens integer default null,
  p_estimated_cost_usd_micros bigint default null
)
returns homework_check_attempts
language plpgsql
security definer
set search_path = public
as $$
declare
  result homework_check_attempts%rowtype;
begin
  update homework_check_attempts
     set status = 'completed',
         verdict = p_verdict,
         confidence = case when p_confidence is null then null else greatest(0, least(1, p_confidence)) end,
         reason = p_reason,
         model = p_model,
         input_tokens = p_input_tokens,
         output_tokens = p_output_tokens,
         estimated_cost_usd_micros = p_estimated_cost_usd_micros,
         completed_at = now(),
         updated_at = now()
   where id = p_attempt_id
     and status in ('queued', 'processing')
   returning * into result;
  if not found then
    raise exception 'check_attempt_not_open';
  end if;

  -- 전환 기간: ai_* 는 "최신 완료 결과의 복사본"이다. 원본은 이 attempt 행이다.
  update homework_submissions
     set ai_verdict = result.verdict,
         ai_confidence = result.confidence,
         ai_reason = result.reason
   where id = result.submission_id;

  return result;
end;
$$;

-- 3) 실패 기록. 실패해도 슬롯을 비워 재시도가 가능해야 한다.
create or replace function fail_homework_check_attempt(
  p_attempt_id uuid,
  p_error_code text
)
returns homework_check_attempts
language plpgsql
security definer
set search_path = public
as $$
declare
  result homework_check_attempts%rowtype;
begin
  update homework_check_attempts
     set status = 'failed',
         error_code = coalesce(nullif(btrim(p_error_code), ''), 'unknown'),
         completed_at = now(),
         updated_at = now()
   where id = p_attempt_id
     and status in ('queued', 'processing')
   returning * into result;
  if not found then
    raise exception 'check_attempt_not_open';
  end if;
  return result;
end;
$$;

revoke all on function start_homework_check_attempt(uuid, uuid, text) from public;
revoke all on function start_homework_check_attempt(uuid, uuid, text) from anon;
revoke all on function start_homework_check_attempt(uuid, uuid, text) from authenticated;
grant execute on function start_homework_check_attempt(uuid, uuid, text) to service_role;

revoke all on function complete_homework_check_attempt(uuid, submission_verdict, numeric, text, text, integer, integer, bigint) from public;
revoke all on function complete_homework_check_attempt(uuid, submission_verdict, numeric, text, text, integer, integer, bigint) from anon;
revoke all on function complete_homework_check_attempt(uuid, submission_verdict, numeric, text, text, integer, integer, bigint) from authenticated;
grant execute on function complete_homework_check_attempt(uuid, submission_verdict, numeric, text, text, integer, integer, bigint) to service_role;

revoke all on function fail_homework_check_attempt(uuid, text) from public;
revoke all on function fail_homework_check_attempt(uuid, text) from anon;
revoke all on function fail_homework_check_attempt(uuid, text) from authenticated;
grant execute on function fail_homework_check_attempt(uuid, text) to service_role;

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

  -- 모든 사진 경로는 제출 학생의 폴더(`${student_id}/...`) 안이어야 한다. 남의 폴더를
  -- 가리키면 과외쌤 검사 화면에 다른 학생의 사진이 뜬다. service_role 도 예외가 아니다.
  if exists (
    select 1
      from unnest(new.photo_paths) as p
     where p is null
        or p not like new.student_id::text || '/%'
  ) then
    raise exception 'photo_paths_must_be_in_own_folder';
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
    c.teacher_id,
    -- student_id 가 없으면 과외쌤이 학생별로 좁힐 수 없어 리포트에 남의 데이터가 섞인다(20260815010000).
    s.student_id
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
  teacher_id     uuid references profiles(id) on delete set null, -- 학생 본인 리포트이거나 쌤 탈퇴 시 null
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

-- ── 구독 상태의 의미를 여기서 고정한다 ────────────────────────────────────────
-- 결제 사업자(App Store/Google Play/Stripe)의 원본 상태값을 그대로 쓰지 않고
-- **"지금 이용할 권리가 있는가"** 라는 하나의 의미로 정규화한다. 사업자마다 상태 이름과
-- 개수가 다르고, 원본을 그대로 분기하면 사업자를 추가할 때마다 판정 코드가 갈라진다.
--
--   active                            → 이용 권리 있음
--   past_due / paused / canceled / none → 이용 권리 없음
--
-- 자동 갱신을 취소했지만 결제 기간이 남은 경우(=사용자는 "해지"했다고 느끼지만 아직 쓸 수
-- 있는 기간)는 **status 를 active 로 두고 expires_at 까지 유지**한다. canceled 로 즉시
-- 바꾸면 이미 낸 돈만큼의 이용 권리를 빼앗는 것이 된다. 웹훅(작업 5b 이후) 구현 시 이
-- 원칙을 지켜야 한다.
--
-- expires_at IS NULL 은 "권리 없음"으로 본다(fail-closed). `expires_at > now()` 가 NULL 에
-- 대해 false 가 되는 것을 그대로 이용한다 — 만료일을 모르는 구독을 무기한 프리미엄으로
-- 취급하면 결제 버그가 곧 무료 이용이 된다.
create or replace function has_active_student_premium()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  -- 호출자 본인만 조회한다. student_id 를 인자로 받지 않는 이유: 남의 구독 상태를 물어볼
  -- 필요가 없고, 인자를 받으면 그 자체가 정보 노출 경로가 된다.
  -- SECURITY INVOKER 로 충분하다 — studsub_self 정책이 본인 행 SELECT 를 허용한다.
  -- (service_role 이 부르면 auth.uid() 가 null 이라 항상 false 다. 서버는 이 함수를
  --  '사용자 컨텍스트'로 호출해야 한다 — Edge Function 의 asUser 클라이언트.)
  select exists (
    select 1
      from student_subscriptions
     where student_id = auth.uid()
       and status = 'active'
       and expires_at > now()
  );
$$;

revoke all on function has_active_student_premium() from public;
revoke all on function has_active_student_premium() from anon;
grant execute on function has_active_student_premium() to authenticated;

comment on function has_active_student_premium() is
  '호출자(auth.uid())의 학생 프리미엄 이용 권리. status=active AND expires_at > now(). expires_at IS NULL 은 권리 없음(fail-closed).';

-- ── 사용량 안전장치 ──────────────────────────────────────────────────────────
-- 사용자에게 보이는 상품 한도가 아니라 **서버 안전장치**다. 폭주·버그·재시도 루프가
-- 그대로 과금으로 이어지는 것을 막는 것이 목적이므로 넉넉하게 잡는다.
--
-- 한도 확인과 슬롯 확보는 **같은 트랜잭션**에서 일어난다. 따로 하면 동시 요청이 각각
-- "아직 한도 안 넘었다"를 보고 둘 다 통과해 한도를 넘길 수 있다. 게다가 count 만으로는
-- READ COMMITTED 에서 동시 삽입을 막지 못하므로, 요청자 단위 advisory lock 으로
-- 직렬화한다(트랜잭션 종료 시 자동 해제).
create or replace function ai_check_max_attempts_per_submission() returns integer
  language sql immutable as $$ select 5 $$;
create or replace function ai_check_max_attempts_per_day() returns integer
  language sql immutable as $$ select 50 $$;

comment on function ai_check_max_attempts_per_submission() is
  '같은 제출 재검사 상한(서버 안전장치). 상품 한도가 아니다.';
comment on function ai_check_max_attempts_per_day() is
  '요청자 1인 하루 검사 상한(서버 안전장치). 상품 한도가 아니다.';
-- 갱신은 RevenueCat/IAP 웹훅(서비스롤)로만.

-- 과외쌤 앱 구독료(Stripe) — 월 청구 = active 연결 수 × 4900
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
  amount        integer not null,       -- = student_count * price_per_student_krw() (발행 시점 단가로 확정)
  status        text not null default 'open', -- open|paid|failed|past_due
  issued_at     timestamptz not null default now(),
  paid_at       timestamptz,
  unique (teacher_id, period)
);
alter table billing_invoices enable row level security;
create policy inv_self on billing_invoices for select using (teacher_id = auth.uid());

-- M6: 단가 단일 SQL 출처(TS PRICE_PER_STUDENT_KRW와 교차검증). 월 청구 = active 연결 수 × 단가.
create or replace function price_per_student_krw() returns integer language sql immutable as $$ select 4900 $$;

create or replace function generate_teacher_invoice(p_period text)
returns billing_invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  active_count integer;
  result_row billing_invoices%rowtype;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  select count(*)::integer into active_count
    from connections where teacher_id = auth.uid() and status = 'active';
  insert into billing_invoices (teacher_id, period, student_count, amount, status)
  values (auth.uid(), p_period, active_count, active_count * price_per_student_krw(), 'open')
  on conflict (teacher_id, period) do update
    set student_count = excluded.student_count, amount = excluded.amount
  returning * into result_row;
  return result_row;
end;
$$;
revoke all on function generate_teacher_invoice(text) from public;
grant execute on function generate_teacher_invoice(text) to authenticated;

-- DEV MOCK(웹훅 대체): 실연동 시 billing-stripe / iap-webhook Edge Function으로 치환.
create or replace function mock_set_teacher_subscription(p_status sub_status)
returns teacher_subscriptions
language plpgsql security definer set search_path = public
as $$
declare result_row teacher_subscriptions%rowtype;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  insert into teacher_subscriptions (teacher_id, status, provider, current_period_end, updated_at)
  values (auth.uid(), p_status, 'stripe', now() + interval '30 days', now())
  on conflict (teacher_id) do update set status = excluded.status, updated_at = now()
  returning * into result_row;
  return result_row;
end;
$$;
-- SECURITY: 클라이언트가 도달하는 롤에는 절대 주지 않는다 — 주면 과외쌤이 스스로
-- 앱 구독료를 active 로 만들 수 있다(주 수입원이라 매출에 직접 영향).
-- 구독 상태 생성은 서버 키(service_role) 경로로만 — scripts/dev-set-subscription.mjs 참조.
-- 실연동 시 billing-stripe 가 이 자리를 대체한다.
revoke all on function mock_set_teacher_subscription(sub_status) from public;
revoke execute on function mock_set_teacher_subscription(sub_status) from anon;
revoke execute on function mock_set_teacher_subscription(sub_status) from authenticated;
grant execute on function mock_set_teacher_subscription(sub_status) to service_role;

create or replace function mock_set_student_subscription(p_status sub_status, p_expires_at timestamptz default null)
returns student_subscriptions
language plpgsql security definer set search_path = public
as $$
declare result_row student_subscriptions%rowtype;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  insert into student_subscriptions (student_id, status, provider, expires_at, updated_at)
  values (auth.uid(), p_status, 'iap', coalesce(p_expires_at, now() + interval '30 days'), now())
  on conflict (student_id) do update set status = excluded.status, expires_at = excluded.expires_at, updated_at = now()
  returning * into result_row;
  return result_row;
end;
$$;
-- SECURITY: 클라이언트가 도달하는 롤에는 절대 주지 않는다 — 주면 사용자가 스스로 프리미엄이 된다.
-- 프리미엄 상태 생성은 서버 키(service_role) 경로로만. 실연동 시 iap-webhook 이 이 자리를 대체한다.
revoke all on function mock_set_student_subscription(sub_status, timestamptz) from public;
revoke execute on function mock_set_student_subscription(sub_status, timestamptz) from anon;
revoke execute on function mock_set_student_subscription(sub_status, timestamptz) from authenticated;
grant execute on function mock_set_student_subscription(sub_status, timestamptz) to service_role;

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

-- M7: 회원 탈퇴(본인 auth.users 삭제 → 전 테이블 cascade) + 시스템 상태 설정.
create or replace function delete_my_account()
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  delete from auth.users where id = auth.uid();
end;
$$;
revoke all on function delete_my_account() from public;
grant execute on function delete_my_account() to authenticated;

create table if not exists app_config (
  id                  smallint primary key default 1,
  latest_build        integer not null default 1,
  min_supported_build integer not null default 1,
  maintenance         boolean not null default false,
  maintenance_message text,
  updated_at          timestamptz not null default now(),
  constraint app_config_singleton check (id = 1)
);
alter table app_config enable row level security;
drop policy if exists app_config_read on app_config;
create policy app_config_read on app_config for select to anon, authenticated using (true);
insert into app_config (id, latest_build, min_supported_build, maintenance)
values (1, 1, 1, false) on conflict (id) do nothing;

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
-- 앱 내 알림 생성 (20260809000000)
-- ============================================================================

-- ── 공통 삽입 헬퍼 ───────────────────────────────────────────────────────────
-- security definer 로 RLS(notif_self)를 넘어 상대방에게 알림을 남긴다.
-- 수신자가 없거나(연결 없는 혼공 할 일 등) 자기 자신이면 아무것도 하지 않는다.
create or replace function emit_notification(
  p_user_id uuid,
  p_type notif_type,
  p_title text,
  p_body text default null,
  p_payload jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null then
    return;
  end if;
  -- 자기가 한 일을 자기에게 알리지 않는다. service_role 실행 시 auth.uid() 는 null 이라
  -- 이 조건은 서버 경로를 막지 않는다.
  if p_user_id = auth.uid() then
    return;
  end if;

  insert into notifications (user_id, type, title, body, payload)
  values (p_user_id, p_type, p_title, p_body, p_payload);
end;
$$;

comment on function emit_notification(uuid, notif_type, text, text, jsonb) is
  '앱 내 알림 1건 생성. 트리거 전용 — 클라이언트가 직접 부를 일이 없다.';

revoke all on function emit_notification(uuid, notif_type, text, text, jsonb) from public;
revoke all on function emit_notification(uuid, notif_type, text, text, jsonb) from anon;
revoke all on function emit_notification(uuid, notif_type, text, text, jsonb) from authenticated;

-- ── 1. 선생님이 숙제를 냈다 → 학생 ───────────────────────────────────────────
create or replace function notify_teacher_homework_assigned()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.source = 'teacher' then
    perform emit_notification(
      new.student_id,
      'homework',
      '새 숙제가 등록됐어요',
      new.title,
      jsonb_build_object('todoId', new.id)
    );
  end if;
  return null;
exception when others then
  -- 알림 실패로 숙제 출제를 되돌리지 않는다.
  raise warning 'notify_teacher_homework_assigned failed: %', sqlerrm;
  return null;
end;
$$;

drop trigger if exists notify_teacher_homework_assigned_trigger on todos;
create trigger notify_teacher_homework_assigned_trigger
after insert on todos
for each row execute function notify_teacher_homework_assigned();

-- ── 2. 학생이 숙제를 제출했다 → 연결된 선생님 ────────────────────────────────
create or replace function notify_homework_submitted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_teacher_id uuid;
  v_title text;
begin
  -- 선생님 숙제만 알린다. 혼공 할 일은 connection_id 가 없어 수신자가 없다.
  select c.teacher_id, t.title
    into v_teacher_id, v_title
    from todos t
    join connections c on c.id = t.connection_id
   where t.id = new.todo_id
     and c.status = 'active';

  perform emit_notification(
    v_teacher_id,
    'homework',
    '학생이 숙제를 제출했어요',
    v_title,
    jsonb_build_object('todoId', new.todo_id, 'submissionId', new.id)
  );
  return null;
exception when others then
  raise warning 'notify_homework_submitted failed: %', sqlerrm;
  return null;
end;
$$;

drop trigger if exists notify_homework_submitted_trigger on homework_submissions;
create trigger notify_homework_submitted_trigger
after insert on homework_submissions
for each row execute function notify_homework_submitted();

-- ── 3. 선생님이 확인/반려했다 → 학생 ─────────────────────────────────────────
create or replace function notify_homework_reviewed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
begin
  select t.title into v_title from todos t where t.id = new.todo_id;

  -- 반려(다시 제출 요청). resubmit_requested 로도 판정하는 이유: 두 필드가 같은 UPDATE 에서
  -- 함께 바뀌지만, 한쪽만 바뀌는 경로가 생겨도 알림은 나가야 한다.
  if (new.teacher_status = 'rejected' and old.teacher_status is distinct from 'rejected')
     or (new.resubmit_requested and not old.resubmit_requested) then
    perform emit_notification(
      new.student_id,
      'resubmit',
      '숙제를 다시 제출해 주세요',
      coalesce(nullif(new.teacher_comment, ''), v_title),
      jsonb_build_object('todoId', new.todo_id)
    );
  elsif new.teacher_status = 'confirmed' and old.teacher_status is distinct from 'confirmed' then
    perform emit_notification(
      new.student_id,
      'check_done',
      '숙제 확인이 끝났어요',
      coalesce(nullif(new.teacher_comment, ''), v_title),
      jsonb_build_object('todoId', new.todo_id)
    );
  end if;
  return null;
exception when others then
  raise warning 'notify_homework_reviewed failed: %', sqlerrm;
  return null;
end;
$$;

drop trigger if exists notify_homework_reviewed_trigger on homework_submissions;
create trigger notify_homework_reviewed_trigger
after update on homework_submissions
for each row execute function notify_homework_reviewed();

-- ── 4. 연결 요청·수락·거절 → 상대방 ──────────────────────────────────────────
create or replace function notify_connection_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requester uuid := new.requested_by;
begin
  if new.status = 'pending'
     and (tg_op = 'INSERT' or old.status is distinct from 'pending') then
    -- 요청은 어느 쪽에서도 시작될 수 있다. 요청자가 아닌 쪽에 알린다.
    perform emit_notification(
      case when v_requester = new.student_id then new.teacher_id else new.student_id end,
      'connection',
      '새 연동 요청이 왔어요',
      null,
      jsonb_build_object('connectionId', new.id)
    );
  elsif tg_op = 'UPDATE' and new.status = 'active' and old.status is distinct from 'active' then
    perform emit_notification(
      new.student_id,
      'connection',
      '선생님과 연동됐어요',
      null,
      jsonb_build_object('connectionId', new.id)
    );
  elsif tg_op = 'UPDATE' and new.status = 'rejected' and old.status is distinct from 'rejected' then
    perform emit_notification(
      new.student_id,
      'connection',
      '연동 요청이 거절됐어요',
      null,
      jsonb_build_object('connectionId', new.id)
    );
  end if;
  return null;
exception when others then
  raise warning 'notify_connection_change failed: %', sqlerrm;
  return null;
end;
$$;

drop trigger if exists notify_connection_change_trigger on connections;
create trigger notify_connection_change_trigger
after insert or update on connections
for each row execute function notify_connection_change();

-- ── 5. 리포트를 보냈다 → 학생 ────────────────────────────────────────────────
-- 이 알림이 /report(나의 리포트)로 가는 딥링크가 된다(getNotificationRoute 의 report → /report).
create or replace function notify_report_sent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'sent' and old.status is distinct from 'sent' then
    perform emit_notification(
      new.student_id,
      'report',
      '새 리포트가 도착했어요',
      null,
      jsonb_build_object('reportId', new.id)
    );
  end if;
  return null;
exception when others then
  raise warning 'notify_report_sent failed: %', sqlerrm;
  return null;
end;
$$;

drop trigger if exists notify_report_sent_trigger on reports;
create trigger notify_report_sent_trigger
after update on reports
for each row execute function notify_report_sent();


-- ============================================================================
-- 사진 업로드 한도 (20260807010000)
-- ============================================================================

-- 숙제 사진 업로드에 서버측 한도를 건다.
--
-- [왜] 기존 정책은 "자기 폴더인가"만 봤다. 그래서 인증만 되면
--   ① 5MB 파일을 개수 제한 없이 올릴 수 있고
--   ② homework_submissions 행을 만들지 않아도 되며(파일만 쌓기)
--   ③ 계정을 지워도 파일이 남는다.
--   비용이 발생하는데 게이트가 하나도 없던 유일한 기능이었다.
--
-- [설계 판단 — 누적 상한이 아니라 이동 창(rolling window)이다]
--   "계정당 총 N MB" 로 걸면, 보관 정리(cleanup)가 붙기 전에 **정상 사용자가 막힌다**.
--   하루 6장씩 쓰는 학생은 몇 년 뒤 반드시 상한에 닿고, 그때 업로드가 실패한다.
--   그래서 상한을 **최근 30일 업로드량**에 건다. 이건 누적이 아니라 속도 제한이라
--   장기 사용자를 막지 않으면서 버스트 남용을 막는다.
--   ⚠️ 누적 총량은 여전히 무제한이다 — 보관 정리 작업이 붙어야 닫힌다(아래 주석 참조).
--
-- [한도 근거]
--   사진 1장은 클라이언트가 긴 변 1568px · JPEG q0.8 로 줄여 올린다(≈ 1MB 이하).
--   정상 사용 최대치: 하루 2건 제출 × 9장 = 18장/일 → 30일 540장 ≈ 540MB.
--   여기에 약 2배 여유를 둬서 1,000장 / 1 GiB 로 잡았다. 정상 사용은 닿지 않는다.

-- ── 한도 상수 ────────────────────────────────────────────────────────────────
create or replace function homework_photo_quota_window_days() returns integer
  language sql immutable as $$ select 30 $$;
create or replace function homework_photo_quota_objects() returns integer
  language sql immutable as $$ select 1000 $$;
create or replace function homework_photo_quota_bytes() returns bigint
  language sql immutable as $$ select 1073741824 $$;  -- 1 GiB

comment on function homework_photo_quota_window_days() is
  '사진 업로드 한도를 계산하는 이동 창(일). 누적이 아니라 속도 제한이다.';
comment on function homework_photo_quota_objects() is
  '학생 1인이 최근 창 안에 올릴 수 있는 사진 장수 상한.';
comment on function homework_photo_quota_bytes() is
  '학생 1인이 최근 창 안에 올릴 수 있는 총 바이트 상한.';

-- ── 업로드 허용 판정 ─────────────────────────────────────────────────────────
--
-- ⚠️ security definer 가 **필수**다. storage.objects 의 정책 안에서 같은 테이블을
--    조회하는데, invoker 로 두면 정책이 자기 자신을 다시 평가해
--    "infinite recursion detected in policy" 가 난다.
--    마이그레이션은 postgres 로 실행되고 postgres 는 rolbypassrls = true 라
--    definer 안에서는 RLS 가 적용되지 않는다(확인함).
--
-- ⚠️ 인자로 student_id 를 받지 않는다. auth.uid() 만 본다 —
--    has_active_student_premium() 과 같은 이유다(임의 id 를 받으면 그 자체가
--    남의 사용량을 캐내는 경로가 된다).
create or replace function homework_photo_upload_allowed(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, storage
as $$
declare
  parts   text[] := storage.foldername(p_name);
  v_uid   uuid   := auth.uid();
  v_todo  uuid;
  v_objs  integer;
  v_bytes bigint;
  v_since timestamptz := now() - make_interval(days => homework_photo_quota_window_days());
begin
  if v_uid is null then
    return false;
  end if;

  -- 경로 규약: {student_id}/{todo_id}/{submission_key}/page-N.jpg → 폴더 3단.
  -- (storage.foldername 은 마지막 파일명을 뺀 배열을 준다. 폴더가 없으면 빈 배열이고
  --  array_length(빈 배열, 1) 은 0 이 아니라 NULL 이다 — coalesce 가 필요하다.)
  if coalesce(array_length(parts, 1), 0) <> 3 then
    return false;
  end if;
  if parts[1] is distinct from v_uid::text then
    return false;
  end if;

  -- 제출 기록 없이 파일만 쌓는 경로를 막는다.
  --
  -- homework_submissions 행을 요구할 수는 없다 — 클라이언트는 사진을 먼저 올리고
  -- 그 경로들로 제출 행을 만든다(uploadHomeworkPhotos → insert). 순서를 뒤집으면
  -- 정상 업로드가 전부 막힌다.
  -- 대신 경로의 todo_id 가 **내 할 일로 실재**할 것을 요구한다. 임의 경로에 파일을
  -- 쏟아붓는 경로는 이걸로 닫힌다.
  begin
    v_todo := parts[2]::uuid;
  exception when invalid_text_representation then
    return false;
  end;

  if not exists (select 1 from public.todos where id = v_todo and student_id = v_uid) then
    return false;
  end if;

  -- 최근 창의 사용량. **지금 올리는 행은 세지 않는다** — 업로드 시점에 metadata.size 가
  -- 채워졌다고 보장할 수 없다. 그래서 초과분은 최대 파일 1개(버킷 상한 5MB)만큼이다.
  select count(*)::integer,
         coalesce(sum(coalesce((metadata->>'size')::bigint, 0)), 0)
    into v_objs, v_bytes
  from storage.objects
  where bucket_id = 'homework-photos'
    and (storage.foldername(name))[1] = v_uid::text
    and created_at >= v_since;

  if v_objs >= homework_photo_quota_objects() then
    return false;
  end if;
  if v_bytes >= homework_photo_quota_bytes() then
    return false;
  end if;

  return true;
end;
$$;

comment on function homework_photo_upload_allowed(text) is
  '숙제 사진 업로드 허용 판정. 경로 규약 + 내 할 일 실재 + 최근 30일 사용량 한도. RLS 정책에서 호출한다.';

revoke all on function homework_photo_upload_allowed(text) from public;
revoke all on function homework_photo_upload_allowed(text) from anon;
grant execute on function homework_photo_upload_allowed(text) to authenticated;

-- 사용량 조회(안내 UI 용). 호출자 자신만 볼 수 있다.
create or replace function homework_photo_usage()
returns table (window_days integer, objects integer, bytes bigint, max_objects integer, max_bytes bigint)
language sql
stable
security definer
set search_path = public, storage
as $$
  select homework_photo_quota_window_days(),
         count(*)::integer,
         coalesce(sum(coalesce((metadata->>'size')::bigint, 0)), 0)::bigint,
         homework_photo_quota_objects(),
         homework_photo_quota_bytes()
  from storage.objects
  where bucket_id = 'homework-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and created_at >= now() - make_interval(days => homework_photo_quota_window_days())
$$;

comment on function homework_photo_usage() is
  '호출자의 최근 창 사진 사용량과 상한. 인자를 받지 않는다(남의 사용량 조회 방지).';

revoke all on function homework_photo_usage() from public;
revoke all on function homework_photo_usage() from anon;
grant execute on function homework_photo_usage() to authenticated;

-- ── INSERT 정책 교체 ─────────────────────────────────────────────────────────
-- 기존 정책은 "자기 폴더"만 봤다. 판정을 함수로 옮겨 한도까지 함께 강제한다.
drop policy if exists homework_photos_student_insert on storage.objects;
create policy homework_photos_student_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'homework-photos'
    and homework_photo_upload_allowed(name)
  );

-- ── 보관 정리(retention) ─────────────────────────────────────────────────────
--
-- ⚠️ 여기서 실제 삭제는 하지 않는다. storage.objects 행을 지워도 **실제 파일(S3)은
--    남는다** — 삭제는 Storage API 를 거쳐야 한다. 그래서 이 함수는 "지울 대상 목록"만
--    돌려주고, 삭제는 service_role 로 Storage API 를 호출하는 작업이 담당한다.
--    (계정 탈퇴 시 파일 정리도 같은 수단이 필요하다 → 한 번에 만드는 게 맞다.)
create or replace function homework_photo_retention_days() returns integer
  language sql immutable as $$ select 180 $$;

comment on function homework_photo_retention_days() is
  '숙제 사진 보관 기간(일). 판정 결과는 homework_check_attempts 에 남으므로 사진이 지워져도 이력은 보존된다.';

create or replace function homework_photos_expired_paths(p_limit integer default 1000)
returns table (path text, created_at timestamptz)
language sql
stable
security definer
set search_path = public, storage
as $$
  select name, created_at
  from storage.objects
  where bucket_id = 'homework-photos'
    and created_at < now() - make_interval(days => homework_photo_retention_days())
  order by created_at
  limit greatest(1, least(coalesce(p_limit, 1000), 10000))
$$;

comment on function homework_photos_expired_paths(integer) is
  '보관 기간이 지난 사진 경로 목록. 실제 삭제는 Storage API 가 필요하다(행만 지우면 파일이 남는다). service_role 전용.';

revoke all on function homework_photos_expired_paths(integer) from public;
revoke all on function homework_photos_expired_paths(integer) from anon;
revoke all on function homework_photos_expired_paths(integer) from authenticated;
grant execute on function homework_photos_expired_paths(integer) to service_role;

-- ============================================================================
-- AI 검사 한도 재산정 (20260807020000)
-- ============================================================================

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

-- ============================================================================
-- AI 채점표시 **관찰** 기록 (20260807030000)
-- ============================================================================
-- [왜] 이전 설계는 AI 에게 전역 판정(pass/insufficient)을 시켰고, 그 판정을 verdict 에
--   "확정 사실"로 저장했다. 실사진 측정에서 다 푼 페이지를 "3·4·5번 미작성"으로
--   confidence 0.95 에 단정했다 — 결론을 만들어야 한다는 압박이 환각을 유발했다.
--   그래서 AI 출력은 확정 사실이 아니라 **원본 관찰**로만 보관한다.
--   프롬프트·출력 스키마·서버 의미 검증은
--   supabase/functions/ai-homework-check/observation.ts 에 있다.
--
-- 성공(폐기 사유 없음) → status='completed', raw_ai_observation 저장.
-- 폐기(폐기 사유 있음) → status='failed', 원본은 그대로 남기고 discard_reason 을 적는다.
--   폐기한 원본도 보관하는 이유: 무엇이 왜 폐기됐는지 못 보면 프롬프트를 고칠 근거가 없다.
--
-- ⚠️ 두 경우 모두 homework_submissions.ai_* 를 건드리지 않는다.
--    관찰은 판정이 아니므로 화면에 캐시할 값이 없다.
create or replace function record_homework_check_observation(
  p_attempt_id uuid,
  p_raw_observation jsonb,
  p_prompt_version text,
  p_schema_version text,
  p_scope_included boolean,
  p_stop_reason text default null,
  p_model text default null,
  p_input_tokens integer default null,
  p_output_tokens integer default null,
  p_cost_usd_micros bigint default null,
  p_latency_ms integer default null,
  p_discard_reason text default null
)
returns homework_check_attempts
language plpgsql
security definer
set search_path = public
as $$
declare
  result homework_check_attempts%rowtype;
begin
  update homework_check_attempts
     set status              = case when p_discard_reason is null then 'completed' else 'failed' end,
         raw_ai_observation  = p_raw_observation,
         prompt_version      = p_prompt_version,
         schema_version      = p_schema_version,
         scope_included      = p_scope_included,
         stop_reason         = p_stop_reason,
         model               = coalesce(p_model, model),
         input_tokens        = coalesce(p_input_tokens, input_tokens),
         output_tokens       = coalesce(p_output_tokens, output_tokens),
         estimated_cost_usd_micros = coalesce(p_cost_usd_micros, estimated_cost_usd_micros),
         latency_ms          = p_latency_ms,
         discard_reason      = p_discard_reason,
         -- error_code 는 status='failed' 일 때만 허용된다(attempts_error_only_when_failed).
         error_code          = case when p_discard_reason is null then null else 'observation_discarded' end,
         completed_at        = now(),
         updated_at          = now()
   where id = p_attempt_id
     and status in ('queued', 'processing')
  returning * into result;

  if not found then
    raise exception 'check_attempt_not_open';
  end if;

  return result;
end;
$$;

revoke all on function record_homework_check_observation(
  uuid, jsonb, text, text, boolean, text, text, integer, integer, bigint, integer, text
) from public;
revoke all on function record_homework_check_observation(
  uuid, jsonb, text, text, boolean, text, text, integer, integer, bigint, integer, text
) from anon;
revoke all on function record_homework_check_observation(
  uuid, jsonb, text, text, boolean, text, text, integer, integer, bigint, integer, text
) from authenticated;
grant execute on function record_homework_check_observation(
  uuid, jsonb, text, text, boolean, text, text, integer, integer, bigint, integer, text
) to service_role;

-- complete_homework_check_attempt(판정 기록)은 DEPRECATED(2026-08-07)다. 지우지 않는 이유:
-- 옛 경로가 남은 코드에서 깨지고, 되돌릴 때 근거가 없어진다. 2단계에서 정리한다.

-- ============================================================================
-- 학부모 리포트: 시험 기록 · 발송 상태 (20260815000000)
-- ============================================================================
create table if not exists exam_records (
  id          uuid primary key default gen_random_uuid(),
  teacher_id  uuid not null references profiles(id) on delete cascade,
  student_id  uuid not null references profiles(id) on delete cascade,
  subject     subject_code not null,
  exam_name   text not null,
  taken_on    date not null,
  -- 등급은 1~9, 점수는 0~100. 둘 다 없어도 된다(있는 것만 그래프에 찍힌다).
  grade       integer,
  score       integer,
  comment     text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint exam_records_name_not_blank check (btrim(exam_name) <> ''),
  constraint exam_records_grade_range check (grade is null or grade between 1 and 9),
  constraint exam_records_score_range check (score is null or score between 0 and 100),
  -- 코멘트는 "한 줄"이다. 길면 리포트 카드가 무너진다.
  constraint exam_records_comment_len check (comment is null or length(comment) <= 200)
);

create index if not exists exam_records_student_taken_idx
  on exam_records (student_id, subject, taken_on);

comment on table exam_records is
  '과외쌤이 적는 시험 기록. 리포트의 등급 추이에 누적된다. 필수는 과목·이름·날짜뿐.';

alter table exam_records enable row level security;

-- 과외쌤은 **active 연결된 학생**의 기록만 읽고 쓸 수 있다.
-- teacher_id = auth.uid() 만 보면 남의 학생 id 를 넣어 행을 만들 수 있다 → 연결도 함께 본다.
drop policy if exists exam_records_teacher_rw on exam_records;
create policy exam_records_teacher_rw on exam_records for all
  using (
    teacher_id = auth.uid()
    and exists (
      select 1 from connections c
      where c.teacher_id = auth.uid() and c.student_id = exam_records.student_id and c.status = 'active'
    )
  )
  with check (
    teacher_id = auth.uid()
    and exists (
      select 1 from connections c
      where c.teacher_id = auth.uid() and c.student_id = exam_records.student_id and c.status = 'active'
    )
  );

create or replace function touch_exam_records_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_exam_records_updated_at_trigger on exam_records;
create trigger touch_exam_records_updated_at_trigger
before update on exam_records
for each row execute function touch_exam_records_updated_at();

-- ── 발송 상태 ────────────────────────────────────────────────────────────────
--
-- ⚠️ 실제 카톡/PDF 연동은 **이번 범위가 아니다.** 상태만 기록한다.
--   나중에 연동을 붙일 때 "무엇을 언제 어떤 경로로 보냈고 실패했는지"가 이미 남아 있어야
--   재시도·이력 화면을 다시 만들지 않는다.
--
--   reports.status / sent_at 은 "리포트가 발송됐는가"라는 한 덩어리 상태다.
--   채널이 여러 개(링크·카톡·PDF)이고 각각 실패할 수 있으므로 행으로 나눈다.
create table if not exists report_deliveries (
  id          uuid primary key default gen_random_uuid(),
  report_id   uuid not null references reports(id) on delete cascade,
  channel     text not null,
  status      text not null default 'pending',
  -- 실패를 조용히 두지 않는다. 사람이 왜 실패했는지 볼 수 있어야 재시도할 수 있다.
  error       text,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,

  constraint report_deliveries_channel_check check (channel in ('link', 'kakao', 'pdf')),
  constraint report_deliveries_status_check check (status in ('pending', 'sent', 'failed')),
  constraint report_deliveries_sent_at_matches
    check ((status = 'sent') = (sent_at is not null)),
  constraint report_deliveries_error_only_when_failed
    check (status = 'failed' or error is null)
);

create index if not exists report_deliveries_report_idx on report_deliveries (report_id, created_at desc);

comment on table report_deliveries is
  '리포트 발송 시도 기록(채널별). 실연동 전에는 link 만 실제로 동작하고 나머지는 상태만 남는다.';

alter table report_deliveries enable row level security;

-- 리포트를 만든 과외쌤만 자기 리포트의 발송 이력을 보고 남길 수 있다.
drop policy if exists report_deliveries_teacher_rw on report_deliveries;
create policy report_deliveries_teacher_rw on report_deliveries for all
  using (
    exists (select 1 from reports r where r.id = report_deliveries.report_id and r.teacher_id = auth.uid())
  )
  with check (
    exists (select 1 from reports r where r.id = report_deliveries.report_id and r.teacher_id = auth.uid())
  );

-- ── 리포트 본문 칸 ───────────────────────────────────────────────────────────
--
-- 기존 reports.teacher_comment 하나로는 B7 의 글 **세 칸**을 담을 수 없다.
-- jsonb 에 뭉치지 않고 컬럼으로 나눈 이유: 학부모 웹뷰·PDF 가 각 칸을 다른 스타일로
-- 렌더하고, 나중에 AI 초안이 칸별로 들어온다(칸 구조가 곧 계약이다).
alter table reports
  add column if not exists home_support text,
  add column if not exists next_week_focus text;

comment on column reports.teacher_comment is '선생님 코멘트(B7 첫째 칸). 1단계에서는 과외쌤이 직접 작성한다.';
comment on column reports.home_support is '가정에서 도와주시면(B7 둘째 칸).';
comment on column reports.next_week_focus is '다음 주 방향(B7 셋째 칸).';
comment on column reports.ai_draft is
  'AI 초안 원본. 2단계에서 채운다 — teacher_comment 를 덮어쓰지 않고 따로 두어 사람이 고친 내용을 보존한다.';


-- ============================================================================
-- 수업 회차 · 리포트 발급 한도 (20260815020000)
-- ============================================================================
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


-- ============================================================================
-- 계정 탈퇴 시 Storage 정리 (20260810000000)
-- ============================================================================
create table if not exists storage_purge_queue (
  id           uuid primary key default gen_random_uuid(),
  -- FK 없음(의도적). 이 행은 사용자가 사라진 뒤에도 살아 있어야 한다.
  user_id      uuid not null,
  bucket_id    text not null,
  -- 지울 대상 폴더. 항상 '<user_id>/' 형태다 — 남의 파일을 지우지 않기 위한 유일한 기준.
  prefix       text not null,
  status       text not null default 'pending',
  attempts     integer not null default 0,
  deleted_count integer not null default 0,
  last_error   text,
  created_at   timestamptz not null default now(),
  completed_at timestamptz,

  constraint storage_purge_queue_status_check
    check (status in ('pending', 'done', 'failed')),
  -- prefix 가 user_id 로 시작하지 않으면 남의 파일을 지우게 된다. DB 에서 막는다.
  constraint storage_purge_queue_prefix_scoped
    check (prefix = user_id::text || '/'),
  constraint storage_purge_queue_attempts_non_negative
    check (attempts >= 0 and deleted_count >= 0)
);

create index if not exists storage_purge_queue_pending_idx
  on storage_purge_queue (status, created_at)
  where status <> 'done';

comment on table storage_purge_queue is
  '탈퇴한 사용자의 Storage 파일 정리 대기열. 실제 삭제는 Edge Function(account-delete)이 한다.';

-- 서버 전용. 클라이언트가 읽거나 쓸 이유가 없다(탈퇴한 사용자의 흔적이다).
alter table storage_purge_queue enable row level security;
-- 정책을 하나도 만들지 않는다 = authenticated/anon 은 아무것도 못 한다.
-- service_role 은 RLS 를 우회하므로 Edge Function 만 접근한다.

-- ── 삭제 시 대기열 적재 트리거 ───────────────────────────────────────────────
create or replace function enqueue_storage_purge_on_profile_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into storage_purge_queue (user_id, bucket_id, prefix)
  values (old.id, 'homework-photos', old.id::text || '/');
  return old;
exception when others then
  -- 대기열 적재 실패로 탈퇴 자체를 막지 않는다. 사용자의 삭제 요구가 우선이다.
  -- 대신 경고를 남겨 로그에서 추적할 수 있게 한다.
  raise warning 'enqueue_storage_purge_on_profile_delete failed for %: %', old.id, sqlerrm;
  return old;
end;
$$;

drop trigger if exists enqueue_storage_purge_on_profile_delete_trigger on profiles;
create trigger enqueue_storage_purge_on_profile_delete_trigger
before delete on profiles
for each row execute function enqueue_storage_purge_on_profile_delete();

-- ── Edge Function 이 쓰는 조회·기록 함수 ─────────────────────────────────────
--
-- Storage API 의 list() 는 폴더 단위 페이지네이션이라 하위 경로를 빠뜨리기 쉽다.
-- storage.objects 를 직접 조회하면 **정확히** 그 사용자의 객체만 얻는다.
create or replace function storage_paths_for_prefix(p_bucket text, p_prefix text)
returns table (path text)
language sql
stable
security definer
set search_path = public, storage
as $$
  select name
  from storage.objects
  where bucket_id = p_bucket
    -- like 는 _ 와 % 가 와일드카드다. prefix 는 'uuid/' 라 둘 다 없지만,
    -- 폴더 첫 조각을 직접 비교하는 편이 의도가 분명하고 우회 여지가 없다.
    and (storage.foldername(name))[1] = rtrim(p_prefix, '/')
  order by name
$$;

comment on function storage_paths_for_prefix(text, text) is
  '한 사용자 폴더의 Storage 객체 경로 목록. service_role 전용 — 삭제 대상을 정확히 좁히는 용도.';

revoke all on function storage_paths_for_prefix(text, text) from public;
revoke all on function storage_paths_for_prefix(text, text) from anon;
revoke all on function storage_paths_for_prefix(text, text) from authenticated;
grant execute on function storage_paths_for_prefix(text, text) to service_role;

create or replace function complete_storage_purge(
  p_id uuid,
  p_deleted_count integer,
  p_error text default null
)
returns storage_purge_queue
language plpgsql
security definer
set search_path = public
as $$
declare
  result storage_purge_queue%rowtype;
begin
  update storage_purge_queue
     set status        = case when p_error is null then 'done' else 'failed' end,
         attempts      = attempts + 1,
         deleted_count = deleted_count + greatest(coalesce(p_deleted_count, 0), 0),
         last_error    = p_error,
         completed_at  = case when p_error is null then now() else null end
   where id = p_id
  returning * into result;

  if not found then
    raise exception 'purge_row_not_found';
  end if;
  return result;
end;
$$;

comment on function complete_storage_purge(uuid, integer, text) is
  '정리 결과 기록. 실패는 status=failed 로 남겨 사람이 볼 수 있게 한다(조용히 사라지지 않는다).';

revoke all on function complete_storage_purge(uuid, integer, text) from public;
revoke all on function complete_storage_purge(uuid, integer, text) from anon;
revoke all on function complete_storage_purge(uuid, integer, text) from authenticated;
grant execute on function complete_storage_purge(uuid, integer, text) to service_role;


-- ============================================================================
-- Storage 버킷(앱에서 생성):
--   - homework-photos : 숙제 제출 사진(비공개, 학생 본인 + 공개 시 연결 쌤)
--     · 버킷 제한(20260806060000): file_size_limit 5MB,
--       allowed_mime_types = image/jpeg, image/png, image/webp
--       (HEIC 제외 — 비전 API 가 못 읽으므로 앱이 업로드 전에 JPEG 로 변환한다)
--     · Storage 정책: 학생은 자기 폴더 insert/select/delete,
--       과외쌤은 select 만 — subs_teacher_read 와 같은 조건
--       (active 연결 + disclosure_settings.share_homework_photos)
--     · 업로드 한도(20260807010000): 최근 30일 1,000장 / 1 GiB (학생 1인).
--       누적이 아니라 이동 창이다 — 누적 상한은 보관 정리가 붙기 전에 정상 사용자를 막는다.
--       경로의 todo_id 가 내 할 일로 실재해야 업로드된다(파일만 쌓기 차단).
--     · 보관 180일. 실제 파일 삭제는 Storage API 가 필요하다(행만 지우면 파일이 남는다).
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
