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
create policy conn_party_write on connections for all
  using (teacher_id = auth.uid() or student_id = auth.uid())
  with check (teacher_id = auth.uid() or student_id = auth.uid());

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

-- 과외쌤이 보는 공부/집중 데이터는 '공개 범위' 적용 → 뷰로 강제(예시):
create or replace view v_teacher_study_sessions as
  select s.* , c.teacher_id
  from study_sessions s
  join connections c on c.student_id = s.student_id and c.status='active'
  join disclosure_settings d on d.connection_id = c.id
  where d.share_study_time = true;
-- (집중도까지 보려면 d.share_focus_data 조건 별도 뷰. 앱은 이 뷰로만 과외쌤 데이터 조회)

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
alter table report_views enable row level security; -- 쓰기는 Edge Function(서비스롤)로만

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
create index on study_sessions (student_id, started_at);
create index on connections (teacher_id, status);
create index on connections (student_id, status);
create index on notifications (user_id, read);
create index on reports (student_id, type, period_start);

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
